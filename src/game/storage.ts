import type { GameSession } from './types'

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
    const parsed = JSON.parse(raw) as GameSession
    if (parsed.version !== 1 || !Array.isArray(parsed.players) || !Array.isArray(parsed.itemDeck)) return null
    if (parsed.phase === 'privateTurn') return { ...parsed, phase: 'handoff' }
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
