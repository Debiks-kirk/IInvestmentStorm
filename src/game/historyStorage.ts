import { database } from './careerStorage'
import { rankFinalPlayers } from './engine'
import { loadGameHistory } from './storage'
import type { GameHistoryEntry, GameSession } from './types'

export const HISTORY_PAGE_SIZE = 12
export interface HistorySummary {
  id: string
  completedAt: string
  playerCount: number
  rounds: number
  winner: string
  mode: GameSession['mode']
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('历史保存失败，请检查浏览器存储空间'))
  })
}
function summary(entry: GameHistoryEntry): HistorySummary {
  return { id: entry.id, completedAt: new Date(entry.completedAt).toISOString(), playerCount: entry.session.players.length,
    rounds: entry.session.settings.rounds, mode: entry.session.mode,
    winner: rankFinalPlayers(entry.session.players).filter(s => s.place === 1).map(s => s.player.name).join('、') || '未产生赢家' }
}

/** One-time import: preserve legacy localStorage and index every existing career replay. */
export async function migrateHistory(): Promise<void> {
  const db = await database()
  try {
    const tx = db.transaction(['history', 'historyMeta', 'replays', 'matches'], 'readwrite')
    const finished = done(tx)
    // Attach the rejection handler immediately, even if a preceding request also fails.
    void finished.catch(() => {})
    if (!await request(tx.objectStore('historyMeta').get('migrated'))) {
      const histories = tx.objectStore('history')
      const replays = tx.objectStore('replays')
      for (const entry of loadGameHistory()) {
        if (!Number.isFinite(Date.parse(entry.completedAt))) continue
        if (!await request(histories.get(entry.id))) {
          histories.put(summary(entry))
          replays.put({ sessionId: entry.id, session: entry.session })
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.addEventListener('abort', () => reject(tx.error ?? new Error('历史迁移失败')), { once: true })
        const cursor = replays.openCursor()
        cursor.onerror = () => reject(cursor.error)
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) { resolve(); return }
          const session = current.value.session as GameSession | undefined
          if (session?.phase === 'finalResult') {
            const existing = histories.get(session.id)
            existing.onerror = () => reject(existing.error)
            existing.onsuccess = () => {
              if (!existing.result) {
                const match = tx.objectStore('matches').get(session.id)
                match.onerror = () => reject(match.error)
                match.onsuccess = () => {
                  const completedAt = match.result?.completedAt ?? session.updatedAt
                  if (Number.isFinite(Date.parse(completedAt))) histories.put(summary({ id: session.id, session, completedAt }))
                  current.continue()
                }
              } else current.continue()
            }
          } else current.continue()
        }
      })
      tx.objectStore('historyMeta').put(true, 'migrated')
    }
    await finished
  } finally { db.close() }
}

/** Atomic, idempotent and unbounded by count. Never delete a previous match on quota errors. */
export async function saveHistory(session: GameSession, completedAt = new Date().toISOString()): Promise<void> {
  if (session.phase !== 'finalResult') return
  const db = await database()
  try {
    const tx = db.transaction(['history', 'replays'], 'readwrite')
    const finished = done(tx); void finished.catch(() => {})
    if (!await request(tx.objectStore('history').get(session.id))) {
      tx.objectStore('history').put(summary({ id: session.id, session, completedAt }))
      tx.objectStore('replays').put({ sessionId: session.id, session })
    }
    await finished
  } finally { db.close() }
}

/** Local calendar dates, including DST boundaries; end date is inclusive. */
export function historyDateRange(from = '', to = ''): { start?: string; end?: string } {
  const parse = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期')
    const [y, m, d] = date.split('-').map(Number)
    const value = new Date(y, m - 1, d)
    if (value.getFullYear() !== y || value.getMonth() !== m - 1 || value.getDate() !== d) throw new Error('请选择有效日期')
    return value
  }
  const start = from ? parse(from) : undefined
  const end = to ? parse(to) : undefined
  if (start && end && start > end) throw new Error('开始日期不能晚于结束日期')
  if (end) end.setDate(end.getDate() + 1)
  return { start: start?.toISOString(), end: end?.toISOString() }
}
export async function historyPage(page = 0, from = '', to = ''): Promise<{ entries: HistorySummary[]; total: number }> {
  const { start, end } = historyDateRange(from, to)
  const range = start && end ? IDBKeyRange.bound(start, end, false, true) : start ? IDBKeyRange.lowerBound(start) : end ? IDBKeyRange.upperBound(end, true) : undefined
  const db = await database()
  try {
    const tx = db.transaction('history', 'readonly')
    const index = tx.objectStore('history').index('completedAt')
    const totalRequest = request(index.count(range))
    const entriesRequest = new Promise<HistorySummary[]>((resolve, reject) => {
      const cursor = index.openCursor(range, 'prev')
      const entries: HistorySummary[] = []
      let skip = Math.max(0, Math.floor(page)) * HISTORY_PAGE_SIZE
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current || entries.length === HISTORY_PAGE_SIZE) { resolve(entries); return }
        if (skip) { const count = skip; skip = 0; current.advance(count); return }
        entries.push(current.value); current.continue()
      }
    })
    const [total, entries] = await Promise.all([totalRequest, entriesRequest])
    return { entries, total }
  } finally { db.close() }
}
