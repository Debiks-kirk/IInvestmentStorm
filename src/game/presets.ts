import { defaultRewards } from './engine'
import { createDefaultSettings } from './session'
import { normalizeIdentitySettings } from './identities'
import type { GamePreset, GameSettings } from './types'

export interface SystemPreset {
  id: string
  name: string
  description: string
  names: string[]
  settings: GameSettings
}

export function cloneSettings(settings: GameSettings): GameSettings {
  return { ...settings, rewardMultipliers: [...settings.rewardMultipliers], disabledCardIds: [...settings.disabledCardIds], identitySettings: { ...normalizeIdentitySettings(settings.identitySettings, false), disabledIdentityIds: [...normalizeIdentitySettings(settings.identitySettings, false).disabledIdentityIds] } }
}

function systemPreset(id: string, name: string, playerCount: number, rounds: number, initialCoins: number): SystemPreset {
  const settings = createDefaultSettings(playerCount)
  return {
    id,
    name,
    description: `${playerCount} 人 · ${rounds} 轮 · 每人 ${initialCoins} 金币`,
    names: Array.from({ length: playerCount }, (_, index) => `玩家 ${index + 1}`),
    settings: { ...settings, rounds, initialCoins, rewardMultipliers: defaultRewards(playerCount) },
  }
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  systemPreset('quick-3', '3 人快速局', 3, 4, 30),
  systemPreset('standard-6', '6 人标准局', 6, 6, 30),
  systemPreset('party-10', '10 人派对局', 10, 8, 40),
]

function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createGamePreset(name: string, names: string[], settings: GameSettings, existing?: GamePreset): GamePreset {
  const now = new Date().toISOString()
  return {
    id: existing?.id ?? createId(),
    name: name.trim(),
    names: [...names],
    settings: cloneSettings(settings),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}
