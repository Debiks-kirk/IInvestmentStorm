import { BOT_PROFILES, botProfile, defaultBotStrategy } from './bots'
import type { BotDifficulty, BotProfileSelection, CustomBotProfile, MemberAvatar, MemberProfile, PlayerController, SeatConfig } from './types'

export const MEMBER_ACCENTS = ['#a35b50', '#557f74', '#687c9b', '#a57a45', '#8b6f91', '#6c8556', '#9b6676', '#4f8191']

/** A career link must not replace the already configured controller or strategy snapshot. */
export function bindParticipantMember<T extends { name: string; memberId?: string }>(participant: T, member: MemberProfile): T {
  return { ...participant, memberId: member.id, name: member.name }
}

function createId(prefix: string): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function memberNameKey(value: string): string {
  return value.trim().normalize('NFC').toLocaleLowerCase()
}

export function normalizeMemberName(value: string): string {
  return value.trim().normalize('NFC').slice(0, 20)
}

export function avatarForMember(seed: string, accent?: string): MemberAvatar {
  let value = 0
  for (const character of seed) value = ((value << 5) - value + character.charCodeAt(0)) | 0
  return { shape: Math.abs(value) % 24, accent: accent ?? MEMBER_ACCENTS[Math.abs(value >> 3) % MEMBER_ACCENTS.length] }
}

export function createHumanMember(name: string, accent?: string): MemberProfile {
  const normalized = normalizeMemberName(name)
  const id = createId('member')
  const now = new Date().toISOString()
  return { id, kind: 'human', name: normalized, avatar: avatarForMember(id, accent), archived: false, createdAt: now, updatedAt: now }
}

export function createBotMember(name: string, profileId: BotProfileSelection = 'adaptive', difficulty: BotDifficulty = 'standard', customProfile?: CustomBotProfile, accent?: string): MemberProfile {
  const normalized = normalizeMemberName(name)
  const id = createId('bot')
  const now = new Date().toISOString()
  return {
    id,
    kind: 'bot',
    name: normalized,
    avatar: avatarForMember(id, accent),
    archived: false,
    createdAt: now,
    updatedAt: now,
    bot: { profileId, difficulty, ...(customProfile ? { customProfile: { ...customProfile, identityPriority: [...customProfile.identityPriority] } } : {}), memoryEnabled: true },
  }
}

export function memberController(member: MemberProfile): PlayerController {
  if (member.kind !== 'bot' || !member.bot) return { kind: 'human' }
  return {
    kind: 'bot',
    profileId: member.bot.profileId,
    difficulty: member.bot.difficulty,
    ...(member.bot.customProfile ? { customProfile: { ...member.bot.customProfile, identityPriority: [...member.bot.customProfile.identityPriority] } } : {}),
  }
}

export function memberToSeat(member: MemberProfile): SeatConfig {
  return { memberId: member.id, name: member.name, controller: memberController(member) }
}

export function memberBotName(member: MemberProfile): string {
  if (member.kind !== 'bot') return member.name
  return member.name || botProfile(member.bot?.profileId ?? 'adaptive').name
}

export function uniqueMemberName(raw: string, members: readonly MemberProfile[], excludingId?: string): string | null {
  const name = normalizeMemberName(raw)
  if (!name) return null
  const key = memberNameKey(name)
  return members.some((member) => member.id !== excludingId && memberNameKey(member.name) === key) ? null : name
}

/** A fresh installation starts with ten separate named opponents, not reusable archetype aliases. */
export function createSystemBotMembers(existing: readonly MemberProfile[] = []): MemberProfile[] {
  const used = new Set(existing.map((member) => memberNameKey(member.name)))
  return BOT_PROFILES.map((profile, index) => {
    let name = profile.name
    if (used.has(memberNameKey(name))) name = `${name} Bot`
    used.add(memberNameKey(name))
    return createBotMember(name, profile.id, 'standard', undefined, MEMBER_ACCENTS[(index + 2) % MEMBER_ACCENTS.length])
  })
}

/** Legacy custom templates become individual Bots while retaining their tactical settings. */
export function createLegacyCustomBotMembers(profiles: readonly CustomBotProfile[], existing: readonly MemberProfile[]): MemberProfile[] {
  const used = new Set(existing.map((member) => memberNameKey(member.name)))
  return profiles.map((profile, index) => {
    const base = normalizeMemberName(profile.name) || `自定义 Bot ${index + 1}`
    let name = base
    let copy = 2
    while (used.has(memberNameKey(name))) name = `${base} ${copy++}`.slice(0, 20)
    used.add(memberNameKey(name))
    return createBotMember(name, 'custom', 'standard', profile)
  })
}

export function defaultCustomBotProfile(name = '新 Bot'): CustomBotProfile {
  const now = new Date().toISOString()
  return { id: createId('custom-bot'), name, createdAt: now, updatedAt: now, ...defaultBotStrategy('adaptive') }
}

export function cloneMember(member: MemberProfile): MemberProfile {
  return {
    ...member,
    avatar: { ...member.avatar },
    ...(member.bot ? { bot: { ...member.bot, ...(member.bot.customProfile ? { customProfile: { ...member.bot.customProfile, identityPriority: [...member.bot.customProfile.identityPriority] } } : {}) } } : {}),
  }
}
