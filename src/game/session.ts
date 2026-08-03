import { coinsToUnits, defaultRewards } from './engine'
import { createItemDeck, shuffle } from './items'
import type { GameSession, GameSettings, Player } from './types'

export const PLAYER_COLORS = ['#b65f55', '#557f74', '#687c9b', '#a57a45', '#8b6f91', '#6c8556', '#9b6676', '#4f8191', '#8a7857', '#697079']

export function createDefaultSettings(playerCount = 3): GameSettings {
  return {
    playerCount,
    rounds: 6,
    initialCoins: 30,
    rewardMultipliers: defaultRewards(playerCount),
    correctPredictionMultiplier: 1,
    wrongPredictionMultiplier: 0.5,
    revealBids: false,
    animationSpeed: 'full',
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createSession(names: string[], settings: GameSettings): GameSession {
  const now = new Date().toISOString()
  const players: Player[] = names.map((name, index) => ({
    id: createId('player'),
    name: name.trim(),
    color: PLAYER_COLORS[index],
    balanceUnits: coinsToUnits(settings.initialCoins),
    items: [],
  }))
  return {
    version: 1,
    id: createId('game'),
    phase: 'roundIntro',
    settings: { ...settings, playerCount: names.length, rewardMultipliers: [...settings.rewardMultipliers] },
    players,
    itemDeck: createItemDeck(settings.rounds),
    fairnessOrderIds: shuffle(players.map((player) => player.id)),
    roundIndex: 0,
    currentTurnIndex: 0,
    turns: [],
    results: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function validateNames(names: string[]): string[] {
  const trimmed = names.map((name) => name.trim())
  const errors: string[] = []
  if (trimmed.some((name) => name.length === 0)) errors.push('每位玩家都需要一个名字')
  if (trimmed.some((name) => name.length > 12)) errors.push('玩家名字最多 12 个字符')
  if (new Set(trimmed).size !== trimmed.length) errors.push('玩家名字不能重复')
  return errors
}

