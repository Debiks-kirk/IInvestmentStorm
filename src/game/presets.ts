import { defaultRewards } from './engine'
import { createDefaultSettings } from './session'
import { normalizeIdentitySettings } from './identities'
import type { CustomBotProfile, GameMode, GamePreset, GameSettings, RelayMethod, RelaySeatConfig, SeatConfig } from './types'

export interface SystemPreset {
  id: string
  name: string
  description: string
  names: string[]
  settings: GameSettings
  seats: SeatConfig[]
}

export interface SharedPresetPayload {
  format: 'who-is-raising-preset'
  version: 1 | 2 | 3
  exportedAt: string
  preset: Pick<GamePreset, 'name' | 'names' | 'seats' | 'settings' | 'mode' | 'relayMethod' | 'relaySeats'>
}

export function cloneSettings(settings: GameSettings): GameSettings {
  return { ...settings, systemAuctionCardsPerRound: settings.systemAuctionCardsPerRound ?? (settings.playerCount === 10 ? 3 : 2), turnTimeLimitSeconds: settings.turnTimeLimitSeconds ?? 20, turnTimerEnabled: settings.turnTimerEnabled ?? false, rewardMultipliers: [...settings.rewardMultipliers], disabledCardIds: [...settings.disabledCardIds], identitySettings: { ...normalizeIdentitySettings(settings.identitySettings, false), disabledIdentityIds: [...normalizeIdentitySettings(settings.identitySettings, false).disabledIdentityIds] } }
}

function systemPreset(id: string, name: string, playerCount: number, withBots = false): SystemPreset {
  const settings = createDefaultSettings(playerCount)
  const systemBots = [
    ['adaptive', '变色龙'], ['steady', '小算盘'], ['aggressive', '火花'], ['collectorBot', '馆长'], ['observer', '狐狸'],
    ['revenge', '刺球'], ['cards', '戏法师'], ['identityBot', '演员'], ['comeback', '追风'], ['blocker', '守门员'],
  ] as const
  const seats: SeatConfig[] = Array.from({ length: playerCount }, (_, index) => index === 0 || !withBots
    ? { name: `玩家 ${index + 1}`, controller: { kind: 'human' } }
    : { name: systemBots[index - 1][1], controller: { kind: 'bot', profileId: systemBots[index - 1][0], difficulty: 'standard' } })
  return {
    id,
    name,
    description: `${playerCount} 人 · ${settings.rounds} 轮 · 每人 ${settings.initialCoins} 金币${withBots ? ` · 1 真人 + ${playerCount - 1} Bot` : ''}`,
    names: seats.map((seat) => seat.name),
    seats,
    settings: { ...settings, rewardMultipliers: defaultRewards(playerCount) },
  }
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  systemPreset('human-3', '3 人真人局', 3),
  systemPreset('bot-3', '3 人 Bot 局', 3, true),
  systemPreset('human-6', '6 人真人局', 6),
  systemPreset('bot-6', '6 人 Bot 局', 6, true),
  systemPreset('human-10', '10 人真人局', 10),
  systemPreset('bot-10', '10 人 Bot 局', 10, true),
]

function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneRelaySeats(relaySeats: RelaySeatConfig[]): RelaySeatConfig[] {
  return relaySeats.map((seat) => ({ name: seat.name, operators: seat.operators.map((operator) => ({ id: operator.id, name: operator.name, controller: operator.controller.kind === 'bot' ? { ...operator.controller, ...(operator.controller.customProfile ? { customProfile: { ...operator.controller.customProfile, identityPriority: [...operator.controller.customProfile.identityPriority] } } : {}) } : { ...operator.controller } })) }))
}

export function createGamePreset(name: string, seatsOrNames: SeatConfig[] | string[], settings: GameSettings, existing?: GamePreset, relay: { mode?: GameMode; relayMethod?: RelayMethod; relaySeats?: RelaySeatConfig[] } = {}): GamePreset {
  const now = new Date().toISOString()
  const seats = seatsOrNames.map((seat) => typeof seat === 'string' ? { name: seat, controller: { kind: 'human' as const } } : { ...seat, controller: seat.controller.kind === 'bot' ? { ...seat.controller, ...(seat.controller.customProfile ? { customProfile: { ...seat.controller.customProfile, identityPriority: [...seat.controller.customProfile.identityPriority] } } : {}) } : { ...seat.controller } })
  return {
    id: existing?.id ?? createId(),
    name: name.trim(),
    names: seats.map((seat) => seat.name),
    seats,
    settings: cloneSettings(settings),
    mode: relay.mode ?? 'standard',
    relayMethod: relay.relayMethod ?? 'rotation',
    ...(relay.mode === 'relay' && relay.relaySeats ? { relaySeats: cloneRelaySeats(relay.relaySeats) } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** A portable, deliberately small JSON format for sharing a setup without game progress. */
export function exportGamePreset(preset: GamePreset): string {
  const seats = preset.seats ?? preset.names.map((name) => ({ name, controller: { kind: 'human' as const } }))
  const payload: SharedPresetPayload = {
    format: 'who-is-raising-preset',
    version: 3,
    exportedAt: new Date().toISOString(),
    preset: {
      name: preset.name,
      names: [...preset.names],
      seats: seats.map((seat) => ({ name: seat.name, controller: seat.controller.kind === 'bot' ? { ...seat.controller, ...(seat.controller.customProfile ? { customProfile: { ...seat.controller.customProfile, identityPriority: [...seat.controller.customProfile.identityPriority] } } : {}) } : { ...seat.controller } })),
      ...(preset.mode === 'relay' && preset.relaySeats ? { mode: 'relay' as const, relayMethod: preset.relayMethod ?? 'rotation', relaySeats: cloneRelaySeats(preset.relaySeats) } : { mode: 'standard' as const }),
      settings: cloneSettings(preset.settings),
    },
  }
  return JSON.stringify(payload, null, 2)
}

/** Parses an exported setup into safe, normalized configuration data. It never imports IDs or timestamps. */
export function importGamePreset(raw: string): { name: string; seats: SeatConfig[]; settings: GameSettings; customProfiles: CustomBotProfile[]; mode: GameMode; relayMethod: RelayMethod; relaySeats: RelaySeatConfig[] } | null {
  try {
    const payload = JSON.parse(raw) as Partial<SharedPresetPayload>
    if (payload.format !== 'who-is-raising-preset' || (payload.version !== 1 && payload.version !== 2 && payload.version !== 3) || !payload.preset || typeof payload.preset.name !== 'string' || !payload.preset.settings) return null
    const sourceSeats = Array.isArray(payload.preset.seats) && payload.preset.seats.length > 0
      ? payload.preset.seats
      : Array.isArray(payload.preset.names) ? payload.preset.names.map((name) => ({ name, controller: { kind: 'human' as const } })) : []
    if (sourceSeats.length < 3 || sourceSeats.length > 10) return null
    const seats: SeatConfig[] = sourceSeats.map((seat) => {
      const source = seat as Partial<SeatConfig>
      if (!source || typeof source.name !== 'string') throw new Error('invalid seat')
      const controller = source.controller?.kind === 'bot'
        ? { kind: 'bot' as const, profileId: source.controller.profileId === 'custom' ? 'custom' as const : source.controller.profileId, difficulty: source.controller.difficulty, ...(source.controller.profileId === 'custom' && source.controller.customProfile ? { customProfile: source.controller.customProfile } : {}) }
        : { kind: 'human' as const }
      return { name: source.name.slice(0, 12), controller: controller as SeatConfig['controller'] }
    })
    const defaults = createDefaultSettings(seats.length)
    const sourceSettings = payload.preset.settings as Partial<GameSettings>
    const settings = cloneSettings({
      ...defaults,
      ...sourceSettings,
      playerCount: seats.length,
      rewardMultipliers: Array.isArray(sourceSettings.rewardMultipliers) ? sourceSettings.rewardMultipliers : defaults.rewardMultipliers,
      disabledCardIds: Array.isArray(sourceSettings.disabledCardIds) ? sourceSettings.disabledCardIds : defaults.disabledCardIds,
      identitySettings: { ...defaults.identitySettings, ...(sourceSettings.identitySettings ?? {}) },
    })
    const rawRelaySeats = Array.isArray((payload.preset as GamePreset).relaySeats) ? (payload.preset as GamePreset).relaySeats as RelaySeatConfig[] : []
    const mode: GameMode = (payload.preset as GamePreset).mode === 'relay' && rawRelaySeats.length === seats.length ? 'relay' : 'standard'
    const relaySeats = mode === 'relay' ? rawRelaySeats.map((seat, index) => ({ name: typeof seat.name === 'string' ? seat.name.slice(0, 12) : seats[index].name, operators: Array.isArray(seat.operators) && seat.operators.length ? seat.operators.map((operator, operatorIndex) => ({ id: typeof operator.id === 'string' ? operator.id : `operator-${index}-${operatorIndex}`, name: typeof operator.name === 'string' ? operator.name.slice(0, 12) : `操作者 ${operatorIndex + 1}`, controller: operator.controller?.kind === 'bot' ? { ...operator.controller } : { kind: 'human' as const } })) : [{ id: `operator-${index}-0`, name: seats[index].name, controller: seats[index].controller }] })) : []
    const relayProfiles = relaySeats.flatMap((seat) => seat.operators.flatMap((operator) => operator.controller.kind === 'bot' && operator.controller.customProfile ? [operator.controller.customProfile] : []))
    const customProfiles = [...seats.flatMap((seat) => seat.controller.kind === 'bot' && seat.controller.customProfile ? [seat.controller.customProfile] : []), ...relayProfiles]
    return { name: payload.preset.name.trim().slice(0, 20), seats, settings, customProfiles, mode, relayMethod: (payload.preset as GamePreset).relayMethod === 'segments' ? 'segments' : 'rotation', relaySeats }
  } catch {
    return null
  }
}
