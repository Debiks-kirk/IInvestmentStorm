import { coinsToUnits, defaultRewards } from './engine'
import { createCardDeck } from './cards'
import { dealIdentityChoices, enabledIdentityIds, defaultIdentitySettings } from './identities'
import { createItemDeck, shuffle } from './items'
import type { CardGrant, CardId, GameSession, GameSettings, Player, RoundTurn } from './types'

export const PLAYER_COLORS = ['#b65f55', '#557f74', '#687c9b', '#a57a45', '#8b6f91', '#6c8556', '#9b6676', '#4f8191', '#8a7857', '#697079']

export function createDefaultSettings(playerCount = 3): GameSettings {
  return {
    playerCount,
    rounds: 6,
    initialCoins: 30,
    rewardMultipliers: defaultRewards(playerCount),
    correctPredictionMultiplier: 1,
    wrongPredictionMultiplier: 1.5,
    revealBids: false,
    revealBalanceLeader: false,
    cardGrantProbability: 80,
    disabledCardIds: [],
    identitySettings: defaultIdentitySettings(true),
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
    cardInventory: [],
  }))
  return {
    version: 4,
    id: createId('game'),
    phase: settings.identitySettings.enabled ? 'identityHandoff' : 'roundIntro',
    settings: { ...settings, playerCount: names.length, rewardMultipliers: [...settings.rewardMultipliers], disabledCardIds: [...settings.disabledCardIds], identitySettings: { ...settings.identitySettings, disabledIdentityIds: [...settings.identitySettings.disabledIdentityIds] } },
    players,
    itemDeck: createItemDeck(settings.rounds),
    cardDeck: createCardDeck(settings.disabledCardIds),
    pendingCardGrants: [],
    identityAvailableIds: enabledIdentityIds(settings.identitySettings),
    identityDraft: settings.identitySettings.enabled ? { playerIndex: 0, choiceIds: dealIdentityChoices(enabledIdentityIds(settings.identitySettings), settings.identitySettings) } : null,
    pendingIdentityCardAwards: [],
    pendingIdentityNotices: [],
    identityContracts: [],
    identityEvents: [],
    merchantAuction: null,
    cardRulesStartRound: 1,
    fairnessOrderIds: shuffle(players.map((player) => player.id)),
    roundIndex: 0,
    currentTurnIndex: 0,
    turns: [],
    results: [],
    createdAt: now,
    updatedAt: now,
  }
}

export interface CardGrantPreparation {
  players: Player[]
  cardDeck: CardId[]
  pendingCardGrants: CardGrant[]
}

/** 已使用卡在结算后的下一轮开始前回洗；未使用库存始终不动。 */
export function recycleUsedCards(cardDeck: CardId[], turns: RoundTurn[]): CardId[] {
  const returnedCards = [...new Set(
    turns
      .flatMap((turn) => turn.cardUse ? [turn.cardUse.cardId] : [])
      .filter((cardId) => !cardDeck.includes(cardId)),
  )]
  return returnedCards.length > 0 ? shuffle([...cardDeck, ...returnedCards]) : [...cardDeck]
}

export function prepareCardGrants({
  players,
  cardDeck,
  roundIndex,
  probability,
  roll = Math.random,
}: {
  players: Player[]
  cardDeck: CardId[]
  roundIndex: number
  probability: number
  roll?: () => number
}): CardGrantPreparation {
  if (roundIndex === 0 || cardDeck.length === 0 || probability <= 0) {
    return { players, cardDeck, pendingCardGrants: [] }
  }
  const lowestBalance = Math.min(...players.map((player) => player.balanceUnits))
  const lowestPlayers = players.filter((player) => player.balanceUnits === lowestBalance)
  const candidates = lowestPlayers.length > 1 && lowestBalance > 0 ? [] : lowestPlayers
  const nextPlayers = players.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory] }))
  const nextDeck = [...cardDeck]
  const grants: CardGrant[] = []
  for (const candidate of candidates) {
    if (nextDeck.length === 0 || roll() >= probability / 100) continue
    const isFirstOperator = players[0]?.id === candidate.id
    const cardIndex = isFirstOperator ? nextDeck.findIndex((cardId) => cardId !== 'peek') : 0
    if (cardIndex < 0) continue
    const [cardId] = nextDeck.splice(cardIndex, 1)
    const player = nextPlayers.find((entry) => entry.id === candidate.id)
    if (!player) continue
    player.cardInventory.push(cardId)
    grants.push({ playerId: candidate.id, cardId, announced: false })
  }
  return { players: nextPlayers, cardDeck: nextDeck, pendingCardGrants: grants }
}

export function validateNames(names: string[]): string[] {
  const trimmed = names.map((name) => name.trim())
  const errors: string[] = []
  if (trimmed.some((name) => name.length === 0)) errors.push('每位玩家都需要一个名字')
  if (trimmed.some((name) => name.length > 12)) errors.push('玩家名字最多 12 个字符')
  if (new Set(trimmed).size !== trimmed.length) errors.push('玩家名字不能重复')
  return errors
}
