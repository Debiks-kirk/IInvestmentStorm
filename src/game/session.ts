import { coinsToUnits, defaultRewards } from './engine'
import { createCardDeck } from './cards'
import { emptyBotMemory } from './bots'
import { createPlayerIdentity, dealIdentityChoices, enabledIdentityIds, defaultIdentitySettings } from './identities'
import { createItemDeck, ITEM_POOL, shuffle } from './items'
import type { CardGrant, CardId, GameSession, GameSettings, Item, Player, RoundTurn, SeatConfig } from './types'

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
    firstRoundSystemAuction: true,
    turnTimeLimitSeconds: 20,
    identitySettings: defaultIdentitySettings(true),
    animationSpeed: 'full',
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createSession(seatsOrNames: SeatConfig[] | string[], settings: GameSettings): GameSession {
  const now = new Date().toISOString()
  const initialItemDeck = createItemDeck(settings.rounds)
  const seats: SeatConfig[] = seatsOrNames.map((seat) => typeof seat === 'string' ? { name: seat, controller: { kind: 'human' } } : seat)
  const players: Player[] = seats.map((seat, index) => ({
    id: createId('player'),
    name: seat.name.trim(),
    color: PLAYER_COLORS[index],
    balanceUnits: coinsToUnits(settings.initialCoins),
    items: [],
    cardInventory: [],
    controller: seat.controller,
    ...(seat.controller.kind === 'bot' ? { botMemory: emptyBotMemory() } : {}),
  }))
  const initialCardDeck = createCardDeck(settings.disabledCardIds)
  // 先把系统竞购卡从常规卡池中取出，保证同一张卡不会既参与竞购又被发放。
  const systemAuction = settings.firstRoundSystemAuction && initialCardDeck.length > 0
    ? { source: 'system' as const, merchantId: null, cardId: initialCardDeck[0], roundIndex: 0, bidderIndex: 0, bids: [] }
    : null
  return {
    version: 10,
    id: createId('game'),
    phase: settings.identitySettings.enabled ? 'identityHandoff' : systemAuction ? 'auctionIntro' : 'roundIntro',
    settings: { ...settings, playerCount: seats.length, rewardMultipliers: [...settings.rewardMultipliers], disabledCardIds: [...settings.disabledCardIds], identitySettings: { ...settings.identitySettings, disabledIdentityIds: [...settings.identitySettings.disabledIdentityIds] } },
    players,
    itemDeck: initialItemDeck,
    prophecyDeck: initialItemDeck.map((item) => ({ ...item })),
    pendingPrizeReroll: null,
    cardDeck: systemAuction ? initialCardDeck.slice(1) : initialCardDeck,
    pendingCardGrants: [],
    identityAvailableIds: enabledIdentityIds(settings.identitySettings),
    identityDraft: settings.identitySettings.enabled ? { playerIndex: 0, choiceIds: dealIdentityChoices([], settings.identitySettings) } : null,
    pendingIdentityCardAwards: [],
    pendingIdentityNotices: [],
    identityContracts: [],
    identityEvents: [],
    merchantAuction: systemAuction,
    operationDeadlineAt: null,
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

/** A compact three-round path that introduces bidding, prediction, then cards and active identities. */
export function createTutorialSession(): GameSession {
  const settings = createDefaultSettings(3)
  settings.rounds = 3
  settings.initialCoins = 30
  settings.rewardMultipliers = [2, 1]
  settings.cardGrantProbability = 0
  settings.firstRoundSystemAuction = false
  settings.revealBalanceLeader = false
  settings.identitySettings.enabled = true
  settings.identitySettings.reverserActivationCoins = 2
  const session = createSession(['新手', '小蓝', '小橙'], settings)
  const itemIds = ['basketball', 'camera', 'apartment']
  const itemDeck = itemIds.map((id) => ITEM_POOL.find((item) => item.id === id)!).map((item) => ({ ...item }))
  return {
    ...session,
    phase: 'roundIntro',
    identityDraft: null,
    itemDeck,
    prophecyDeck: itemDeck.map((item) => ({ ...item })),
    players: session.players.map((player) => ({ ...player, identity: createPlayerIdentity('reverser'), cardInventory: ['doubleBid'] })),
    tutorial: { kind: 'firstGame' },
  }
}

/** Starts fresh with the same seats and rules; revenge mode carries only Bot grudges keyed to the new seat IDs. */
export function createRematchSession(previous: GameSession, keepBotGrudges = false): GameSession {
  const seats: SeatConfig[] = previous.players.map((player) => ({
    name: player.name,
    controller: player.controller?.kind === 'bot' ? { ...player.controller } : { kind: 'human' },
  }))
  const settings: GameSettings = {
    ...previous.settings,
    rewardMultipliers: [...previous.settings.rewardMultipliers],
    disabledCardIds: [...previous.settings.disabledCardIds],
    identitySettings: { ...previous.settings.identitySettings, disabledIdentityIds: [...previous.settings.identitySettings.disabledIdentityIds] },
  }
  const next = createSession(seats, settings)
  if (!keepBotGrudges) return next
  const oldToNewId = new Map(previous.players.map((player, index) => [player.id, next.players[index]?.id]))
  return {
    ...next,
    players: next.players.map((player, index) => {
      const previousPlayer = previous.players[index]
      if (player.controller?.kind !== 'bot' || !previousPlayer?.botMemory) return player
      const grudgeByPlayerId = Object.fromEntries(Object.entries(previousPlayer.botMemory.grudgeByPlayerId)
        .map(([oldId, score]) => [oldToNewId.get(oldId), score] as const)
        .filter(([playerId]) => Boolean(playerId))) as Record<string, number>
      return { ...player, botMemory: { ...emptyBotMemory(), grudgeByPlayerId } }
    }),
  }
}

/** Draw fresh candidates outside the scheduled deck, preventing duplicate prizes after replacement. */
export function drawPrizeRerollOffers(itemDeck: Item[], count = 6): Item[] {
  const scheduledIds = new Set(itemDeck.map((item) => item.id))
  return shuffle(ITEM_POOL.filter((item) => !scheduledIds.has(item.id))).slice(0, count).map((item) => ({ ...item }))
}

export function replaceNextPrize(itemDeck: Item[], roundIndex: number, chosenItem: Item): Item[] {
  const nextIndex = roundIndex + 1
  if (!itemDeck[nextIndex]) return [...itemDeck]
  return itemDeck.map((item, index) => index === nextIndex ? { ...chosenItem } : item)
}

export interface CardGrantPreparation {
  players: Player[]
  cardDeck: CardId[]
  pendingCardGrants: CardGrant[]
}

/** 已使用卡在结算后的下一轮开始前回洗；未使用库存始终不动。 */
export function recycleUsedCards(cardDeck: CardId[], turns: RoundTurn[], autoConsumedCardIds: CardId[] = []): CardId[] {
  const returnedCards = [...new Set(
    [
      ...turns.flatMap((turn) => (turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])).map((use) => use.cardId)),
      ...autoConsumedCardIds,
    ]
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
