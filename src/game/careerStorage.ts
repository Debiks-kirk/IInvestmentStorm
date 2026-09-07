import { cloneMember, memberNameKey, normalizeMemberName } from './members'
import { createMatchCareerRecord, type MatchCareerRecord } from './career'
import type { GameSession, MemberProfile } from './types'

const DB_NAME = 'auction-battle-career'
const DB_VERSION = 1
const MEMBER_STORE = 'members'
const MATCH_STORE = 'matches'
const REPLAY_STORE = 'replays'

export interface CareerData {
  members: MemberProfile[]
  records: MatchCareerRecord[]
}

export interface CareerBackup {
  format: 'auction-battle-career'
  version: 1
  exportedAt: string
  members: MemberProfile[]
  records: MatchCareerRecord[]
  replays?: GameSession[]
}

export interface CareerImportPreview {
  backup: CareerBackup
  sameIdMembers: number
  nameConflicts: Array<{ imported: MemberProfile; local: MemberProfile }>
  newMatches: number
}

function supportsIndexedDb(): boolean { return typeof indexedDB !== 'undefined' }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MEMBER_STORE)) db.createObjectStore(MEMBER_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MATCH_STORE)) db.createObjectStore(MATCH_STORE, { keyPath: 'sessionId' })
      if (!db.objectStoreNames.contains(REPLAY_STORE)) db.createObjectStore(REPLAY_STORE, { keyPath: 'sessionId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本机档案库'))
  })
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('本机档案读写失败')) })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('本机档案事务中断')); transaction.onerror = () => reject(transaction.error ?? new Error('本机档案事务失败')) })
}

function validMember(value: unknown): value is MemberProfile {
  if (!value || typeof value !== 'object') return false
  const member = value as Partial<MemberProfile>
  return typeof member.id === 'string' && (member.kind === 'human' || member.kind === 'bot') && typeof member.name === 'string' && Boolean(member.avatar) && typeof member.archived === 'boolean'
}

function validRecord(value: unknown): value is MatchCareerRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<MatchCareerRecord>
  if (record.finalSeats !== undefined && (!Array.isArray(record.finalSeats) || record.finalSeats.some(s => !s || typeof s.playerId !== 'string' || !Number.isInteger(s.place) || s.place < 1 || !Number.isFinite(s.totalAssetUnits) || s.totalAssetUnits < 0))) return false
  return record.version === 1 && typeof record.sessionId === 'string' && typeof record.completedAt === 'string' && Array.isArray(record.summaries) && Array.isArray(record.events)
}

function clonedRecord(record: MatchCareerRecord): MatchCareerRecord { return JSON.parse(JSON.stringify(record)) as MatchCareerRecord }

export async function loadCareerData(): Promise<CareerData> {
  if (!supportsIndexedDb()) return { members: [], records: [] }
  const db = await database()
  try {
    const tx = db.transaction([MEMBER_STORE, MATCH_STORE], 'readonly')
    const [rawMembers, rawRecords] = await Promise.all([
      requestValue(tx.objectStore(MEMBER_STORE).getAll()),
      requestValue(tx.objectStore(MATCH_STORE).getAll()),
    ])
    await transactionDone(tx)
    return {
      members: rawMembers.filter(validMember).map(cloneMember).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      records: rawRecords.filter(validRecord).map(clonedRecord).sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt)),
    }
  } finally { db.close() }
}

export async function saveCareerMembers(members: readonly MemberProfile[]): Promise<void> {
  if (!supportsIndexedDb()) throw new Error('当前浏览器不支持本机档案库')
  const db = await database()
  try {
    const tx = db.transaction(MEMBER_STORE, 'readwrite')
    const store = tx.objectStore(MEMBER_STORE)
    for (const member of members) store.put(cloneMember(member))
    await transactionDone(tx)
  } finally { db.close() }
}

/** Idempotently stores a completed v36 match and its replay in one transaction. */
export async function archiveCareerMatch(session: GameSession, completedAt = new Date().toISOString()): Promise<boolean> {
  const record = createMatchCareerRecord(session, completedAt)
  if (!record || !supportsIndexedDb()) return false
  const db = await database()
  try {
    const tx = db.transaction([MATCH_STORE, REPLAY_STORE], 'readwrite')
    const matches = tx.objectStore(MATCH_STORE)
    const existing = await requestValue(matches.get(record.sessionId))
    if (!existing) {
      matches.put(clonedRecord(record))
      tx.objectStore(REPLAY_STORE).put({ sessionId: record.sessionId, session: JSON.parse(JSON.stringify(session)) as GameSession })
    }
    await transactionDone(tx)
    return !existing
  } finally { db.close() }
}

export async function loadCareerReplay(sessionId: string): Promise<GameSession | null> {
  if (!supportsIndexedDb()) return null
  const db = await database()
  try {
    const tx = db.transaction(REPLAY_STORE, 'readonly')
    const value = await requestValue(tx.objectStore(REPLAY_STORE).get(sessionId)) as { session?: GameSession } | undefined
    await transactionDone(tx)
    return value?.session ? JSON.parse(JSON.stringify(value.session)) as GameSession : null
  } finally { db.close() }
}

/** Removes only the full snapshot; cumulative profile statistics remain intact. */
export async function removeCareerReplay(sessionId: string): Promise<void> {
  if (!supportsIndexedDb()) return
  const db = await database()
  try {
    const tx = db.transaction(REPLAY_STORE, 'readwrite')
    tx.objectStore(REPLAY_STORE).delete(sessionId)
    await transactionDone(tx)
  } finally { db.close() }
}

/** This is deliberately separate from replay cleanup because it changes permanent career statistics. */
export async function removeCareerMatch(sessionId: string): Promise<void> {
  if (!supportsIndexedDb()) return
  const db = await database()
  try {
    const tx = db.transaction([MATCH_STORE, REPLAY_STORE], 'readwrite')
    tx.objectStore(MATCH_STORE).delete(sessionId)
    tx.objectStore(REPLAY_STORE).delete(sessionId)
    await transactionDone(tx)
  } finally { db.close() }
}

export async function exportCareerBackup(includeReplays = false): Promise<string> {
  const data = await loadCareerData()
  let replays: GameSession[] | undefined
  if (includeReplays && supportsIndexedDb()) {
    const db = await database()
    try {
      const tx = db.transaction(REPLAY_STORE, 'readonly')
      const raw = await requestValue(tx.objectStore(REPLAY_STORE).getAll()) as Array<{ session?: GameSession }>
      await transactionDone(tx)
      replays = raw.flatMap((entry) => entry.session ? [entry.session] : [])
    } finally { db.close() }
  }
  const backup: CareerBackup = { format: 'auction-battle-career', version: 1, exportedAt: new Date().toISOString(), members: data.members, records: data.records, ...(replays ? { replays } : {}) }
  return JSON.stringify(backup, null, 2)
}

export function inspectCareerBackup(raw: string, local: CareerData): CareerImportPreview | null {
  try {
    const backup = JSON.parse(raw) as Partial<CareerBackup>
    if (backup.format !== 'auction-battle-career' || backup.version !== 1 || !Array.isArray(backup.members) || !Array.isArray(backup.records)) return null
    const safe: CareerBackup = { format: 'auction-battle-career', version: 1, exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : '', members: backup.members.filter(validMember).map(cloneMember), records: backup.records.filter(validRecord).map(clonedRecord), ...(Array.isArray(backup.replays) ? { replays: backup.replays.filter((entry): entry is GameSession => Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string')) } : {}) }
    const localById = new Map(local.members.map((member) => [member.id, member]))
    const localByName = new Map(local.members.map((member) => [memberNameKey(member.name), member]))
    const nameConflicts = safe.members.flatMap((member) => {
      const collision = localByName.get(memberNameKey(member.name))
      return collision && collision.id !== member.id ? [{ imported: member, local: collision }] : []
    })
    return { backup: safe, sameIdMembers: safe.members.filter((member) => localById.has(member.id)).length, nameConflicts, newMatches: safe.records.filter((record) => !local.records.some((entry) => entry.sessionId === record.sessionId)).length }
  } catch { return null }
}

/** Name conflicts are only renamed after the user explicitly chose this import action. */
export async function importCareerBackup(preview: CareerImportPreview, local: CareerData, renameConflicts: boolean): Promise<CareerData> {
  if (!supportsIndexedDb()) throw new Error('当前浏览器不支持本机档案库')
  if (preview.nameConflicts.length && !renameConflicts) throw new Error('存在同名但不同 ID 的成员，请先确认如何处理')
  const names = new Set(local.members.map((member) => memberNameKey(member.name)))
  const localIds = new Set(local.members.map((member) => member.id))
  const imported = preview.backup.members.flatMap((source) => {
    if (localIds.has(source.id)) return []
    const member = cloneMember(source)
    if (names.has(memberNameKey(member.name))) {
      const base = normalizeMemberName(member.name)
      let suffix = 2
      let next = `${base} ${suffix}`.slice(0, 20)
      while (names.has(memberNameKey(next))) next = `${base} ${++suffix}`.slice(0, 20)
      member.name = next
    }
    names.add(memberNameKey(member.name))
    return [member]
  })
  const existingMatches = new Set(local.records.map((record) => record.sessionId))
  const records = preview.backup.records.filter((record) => !existingMatches.has(record.sessionId)).map(clonedRecord)
  const db = await database()
  try {
    const tx = db.transaction([MEMBER_STORE, MATCH_STORE, REPLAY_STORE], 'readwrite')
    for (const member of imported) tx.objectStore(MEMBER_STORE).put(member)
    for (const record of records) tx.objectStore(MATCH_STORE).put(record)
    for (const session of preview.backup.replays ?? []) if (!existingMatches.has(session.id)) tx.objectStore(REPLAY_STORE).put({ sessionId: session.id, session })
    await transactionDone(tx)
  } finally { db.close() }
  return loadCareerData()
}
