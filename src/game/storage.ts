import { createCardDeck } from './cards'
import type { CardId, GameSession, GameSettings, Player } from './types'

const STORAGE_KEY = 'who-is-raising:session:v1'

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
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.itemDeck) || (parsed.version !== 1 && parsed.version !== 2)) return null
    const migrated = migrateSession(parsed)
    const safeSession = migrated.phase === 'privateTurn' ? { ...migrated, phase: 'handoff' as const } : migrated
    if (parsed.version !== 2 || migrated.phase !== safeSession.phase) saveSession(safeSession)
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
    wrongPredictionMultiplier: oldSettings.wrongPredictionMultiplier ?? 0.5,
    revealBids: oldSettings.revealBids ?? false,
    revealBalanceLeader: oldSettings.revealBalanceLeader ?? true,
    cardGrantProbability: oldSettings.cardGrantProbability ?? 50,
    disabledCardIds: (oldSettings.disabledCardIds ?? []) as CardId[],
    animationSpeed: oldSettings.animationSpeed ?? 'full',
  }
  const players = (session.players ?? []).map((player) => ({
    ...(player as Player),
    items: [...((player as Player).items ?? [])],
    cardInventory: [...((player as Player).cardInventory ?? [])],
  }))
  const migrated: GameSession = {
    ...(session as GameSession),
    version: 2,
    settings,
    players,
    cardDeck: [...(session.cardDeck ?? createCardDeck(settings.disabledCardIds))],
    pendingCardGrants: [...(session.pendingCardGrants ?? [])],
    cardRulesStartRound: session.cardRulesStartRound ?? Math.max((session.roundIndex ?? 0) + 1, 1),
  }
  return migrated
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
