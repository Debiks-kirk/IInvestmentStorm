import { createCardDeck } from './cards'
import { normalizeItem } from './items'
import { cloneSettings } from './presets'
import { dealIdentityChoices, enabledIdentityIds, normalizeIdentitySettings } from './identities'
import type { CardId, GamePreset, GameSession, GameSettings, Player, RoundResult } from './types'

const STORAGE_KEY = 'who-is-raising:session:v1'
const PRESETS_STORAGE_KEY = 'who-is-raising:presets:v1'

export function saveSession(session: GameSession): void {
  try {
    const next = { ...session, updatedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The game remains playable when storage is blocked or full.
  }
}

export function loadSession(): GameSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Omit<GameSession, 'version'>> & { version?: number }
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.itemDeck) || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5)) return null
    const migrated = migrateSession(parsed)
    const safeSession = migrated.phase === 'privateTurn' ? { ...migrated, phase: 'handoff' as const }
      : migrated.phase === 'identityDraft' ? { ...migrated, phase: 'identityHandoff' as const }
        : migrated.phase === 'auctionBid' ? { ...migrated, phase: 'auctionHandoff' as const }
          : migrated
    if (parsed.version !== 5 || migrated.phase !== safeSession.phase) saveSession(safeSession)
    return safeSession
  } catch {
    return null
  }
}

function migrateSession(session: Partial<Omit<GameSession, 'version'>> & { version?: number }): GameSession {
  const oldSettings = session.settings as Partial<GameSettings>
  const settings: GameSettings = {
    playerCount: oldSettings.playerCount ?? session.players?.length ?? 3,
    rounds: oldSettings.rounds ?? 6,
    initialCoins: oldSettings.initialCoins ?? 30,
    rewardMultipliers: oldSettings.rewardMultipliers ?? [2, 1],
    correctPredictionMultiplier: oldSettings.correctPredictionMultiplier ?? 1,
    wrongPredictionMultiplier: oldSettings.wrongPredictionMultiplier ?? 1.5,
    revealBids: oldSettings.revealBids ?? false,
    revealBalanceLeader: oldSettings.revealBalanceLeader ?? false,
    cardGrantProbability: oldSettings.cardGrantProbability ?? 80,
    disabledCardIds: (oldSettings.disabledCardIds ?? []) as CardId[],
    animationSpeed: oldSettings.animationSpeed ?? 'full',
    identitySettings: session.version === 4 || session.version === 5 ? normalizeIdentitySettings(oldSettings.identitySettings, true) : normalizeIdentitySettings(undefined, false),
  }
  const players: Player[] = (session.players ?? []).map((player) => {
    const legacy = player as Player
    const identity = legacy.identity
    return {
      ...legacy,
      items: (legacy.items ?? []).map((won) => ({ ...won, item: normalizeItem(won.item) })),
      cardInventory: [...(legacy.cardInventory ?? [])],
      identity: identity ? {
        id: identity.id,
        targetPlayerId: identity.targetPlayerId,
        collectorCategory: identity.collectorCategory,
        thiefSuccesses: identity.thiefSuccesses ?? 0,
        merchantAuctionUsed: identity.merchantAuctionUsed ?? false,
        lobbyistNextFree: identity.lobbyistNextFree ?? false,
        lobbyistLastIssuedRound: identity.lobbyistLastIssuedRound ?? null,
      } : undefined,
    }
  })
  const results = ((session.results ?? []) as RoundResult[]).map((result) => ({
    ...result,
    item: normalizeItem(result.item),
    redistributionTransferUnits: result.redistributionTransferUnits ?? null,
    identityEvents: result.identityEvents ?? [],
  }))
  const migrated: GameSession = {
    ...(session as GameSession),
    version: 5,
    settings,
    players,
    itemDeck: (session.itemDeck ?? []).map((item) => normalizeItem(item)),
    results,
    cardDeck: [...(session.cardDeck ?? createCardDeck(settings.disabledCardIds))],
    pendingCardGrants: [...(session.pendingCardGrants ?? [])],
    identityAvailableIds: [...(session.identityAvailableIds ?? enabledIdentityIds(settings.identitySettings))],
    identityDraft: session.identityDraft ?? (settings.identitySettings.enabled && (session.roundIndex ?? 0) === 0 && !players.some((player) => player.identity) ? { playerIndex: 0, choiceIds: dealIdentityChoices(enabledIdentityIds(settings.identitySettings), settings.identitySettings) } : null),
    pendingIdentityCardAwards: [...(session.pendingIdentityCardAwards ?? [])],
    pendingIdentityNotices: [...(session.pendingIdentityNotices ?? [])],
    identityContracts: [...(session.identityContracts ?? [])].map((contract) => ({ ...contract, specified: contract.specified ?? true })),
    identityEvents: [...(session.identityEvents ?? [])],
    merchantAuction: session.merchantAuction ?? null,
    cardRulesStartRound: session.cardRulesStartRound ?? Math.max((session.roundIndex ?? 0) + 1, 1),
  }
  return migrated
}

function isPreset(value: unknown): value is GamePreset {
  if (!value || typeof value !== 'object') return false
  const preset = value as Partial<GamePreset>
  return typeof preset.id === 'string' && typeof preset.name === 'string' && Array.isArray(preset.names) && Boolean(preset.settings)
}

export function loadPresets(): GamePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: number; presets?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.presets)) return []
    return parsed.presets.filter(isPreset).map((preset) => ({ ...preset, names: [...preset.names], settings: cloneSettings(preset.settings) }))
  } catch {
    return []
  }
}

export function savePresets(presets: GamePreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify({ version: 1, presets }))
  } catch {
    // Presets remain usable for the current setup form when storage is unavailable.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
