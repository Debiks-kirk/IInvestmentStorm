import { coinsToUnits, defaultRewards } from './engine'
import { createCardDeck, drawCard, getCardDefinition } from './cards'
import { emptyBotMemory, strategyForController } from './bots'
import { createPlayerIdentity, dealIdentityChoices, enabledIdentityIds, defaultIdentitySettings } from './identities'
import { createItemDeck, ITEM_POOL, shuffle } from './items'
import type { CardGrant, CardId, GameMode, GameSession, GameSettings, Item, PendingPrizeChange, Player, RelayMethod, RelayOperator, RelaySeatConfig, RoundTurn, SeatConfig } from './types'

export const PLAYER_COLORS = ['#b65f55', '#557f74', '#687c9b', '#a57a45', '#8b6f91', '#6c8556', '#9b6676', '#4f8191', '#8a7857', '#697079']

/** Seats never move. Each round simply advances the first operator one seat clockwise. */
export function roundStartPlayerIndex(roundIndex: number, playerCount: number): number {
  return playerCount > 0 ? ((roundIndex % playerCount) + playerCount) % playerCount : 0
}

/** Returns the fixed seat index for a position within a round's circular passing order. */
export function playerIndexForRoundPosition(roundIndex: number, position: number, playerCount: number): number {
  return playerCount > 0 ? (roundStartPlayerIndex(roundIndex, playerCount) + position) % playerCount : 0
}

export function roundPlayerIndices(roundIndex: number, playerCount: number): number[] {
  return Array.from({ length: playerCount }, (_, position) => playerIndexForRoundPosition(roundIndex, position, playerCount))
}

export function createDefaultSettings(playerCount = 3): GameSettings {
  const sizeTuning = playerCount === 3
    ? { rounds: 5, wrongPredictionMultiplier: 1.5, merchantAuctionLimit: 1, nightwalkerUseLimit: 2, gamblerCorrectBonusMultiplier: .33, gamblerPenaltyMultiplier: .5 }
    : playerCount === 6
      ? { rounds: 8, wrongPredictionMultiplier: 1, merchantAuctionLimit: 3, nightwalkerUseLimit: 2, gamblerCorrectBonusMultiplier: .67, gamblerPenaltyMultiplier: .33 }
      : playerCount === 10
        ? { rounds: 10, wrongPredictionMultiplier: .5, merchantAuctionLimit: 3, nightwalkerUseLimit: 3, gamblerCorrectBonusMultiplier: 1, gamblerPenaltyMultiplier: .2 }
        : null
  const identitySettings = {
    ...defaultIdentitySettings(true),
    ...(sizeTuning ? {
      merchantAuctionLimit: sizeTuning.merchantAuctionLimit,
      nightwalkerUseLimit: sizeTuning.nightwalkerUseLimit,
      gamblerCorrectBonusMultiplier: sizeTuning.gamblerCorrectBonusMultiplier,
      ...(sizeTuning.gamblerPenaltyMultiplier === undefined ? {} : { gamblerWrongPenaltyMultiplier: sizeTuning.gamblerPenaltyMultiplier, gamblerSkipPenaltyMultiplier: sizeTuning.gamblerPenaltyMultiplier }),
    } : {}),
  }
  return {
    playerCount,
    rounds: sizeTuning?.rounds ?? 6,
    initialCoins: 30,
    rewardMultipliers: defaultRewards(playerCount),
    correctPredictionMultiplier: 1,
    wrongPredictionMultiplier: sizeTuning?.wrongPredictionMultiplier ?? 1.5,
    revealBids: false,
    revealBalanceLeader: false,
    cardGrantProbability: 100,
    disabledCardIds: [],
    systemAuctionCardsPerRound: playerCount === 10 ? 3 : 2,
    turnTimeLimitSeconds: 20,
    turnTimerEnabled: false,
    identitySettings,
    animationSpeed: 'full',
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneRelayOperator(operator: RelayOperator, seed: string): RelayOperator {
  const controller = operator.controller.kind === 'bot'
    ? { ...operator.controller, ...(operator.controller.customProfile ? { customProfile: { ...operator.controller.customProfile, identityPriority: [...operator.controller.customProfile.identityPriority] } } : {}) }
    : { ...operator.controller }
  return {
    id: operator.id || createId('operator'),
    name: operator.name.trim(),
    controller,
    ...(controller.kind === 'bot' ? { botMemory: emptyBotMemory(`${seed}:${operator.id}`, strategyForController(controller)) } : {}),
  }
}

/** Resolve who is making a competitive player's decision in a particular round. */
export function relayOperatorForRound(player: Player, roundIndex: number, totalRounds: number, method: RelayMethod = 'rotation'): RelayOperator {
  const operators = player.relayOperators?.length ? player.relayOperators : [{ id: player.id, name: player.name, controller: player.controller ?? { kind: 'human' as const }, ...(player.botMemory ? { botMemory: player.botMemory } : {}) }]
  if (operators.length === 1) return operators[0]
  if (method === 'rotation') return operators[roundIndex % operators.length]
  const base = Math.floor(totalRounds / operators.length)
  const extra = totalRounds % operators.length
  let start = 0
  for (let index = 0; index < operators.length; index += 1) {
    const span = base + (index < extra ? 1 : 0)
    if (roundIndex < start + span) return operators[index]
    start += span
  }
  return operators[operators.length - 1]
}

export function activeOperator(session: Pick<GameSession, 'players' | 'roundIndex' | 'settings' | 'relayMethod'>, player: Player, roundIndex = session.roundIndex): RelayOperator {
  return relayOperatorForRound(player, roundIndex, session.settings.rounds, session.relayMethod)
}

export function allOperatorsAreBots(players: Player[]): boolean {
  return players.length > 0 && players.every((player) => (player.relayOperators?.length ? player.relayOperators : [{ controller: player.controller }]).every((operator) => operator.controller?.kind === 'bot'))
}

export function createSession(seatsOrNames: SeatConfig[] | RelaySeatConfig[] | string[], settings: GameSettings, relay: { mode?: GameMode; relayMethod?: RelayMethod } = {}): GameSession {
  const now = new Date().toISOString()
  const gameId = createId('game')
  const initialItemDeck = createItemDeck(settings.rounds)
  const mode: GameMode = relay.mode === 'relay' ? 'relay' : 'standard'
  const seats: SeatConfig[] = (mode === 'relay' ? (seatsOrNames as RelaySeatConfig[]).map((seat) => ({ name: seat.name, controller: seat.operators[0]?.controller ?? { kind: 'human' } })) : (seatsOrNames as SeatConfig[] | string[]).map((seat) => typeof seat === 'string'
    ? { name: seat, controller: { kind: 'human' } }
    : { ...seat, controller: seat.controller.kind === 'bot'
      ? { ...seat.controller, ...(seat.controller.customProfile ? { customProfile: { ...seat.controller.customProfile, identityPriority: [...seat.controller.customProfile.identityPriority] } } : {}) }
      : { ...seat.controller } })) as SeatConfig[]
  const relaySeats = mode === 'relay' ? (seatsOrNames as RelaySeatConfig[]).map((seat) => ({ ...seat, operators: seat.operators.length ? seat.operators : [{ id: createId('operator'), name: seat.name, controller: { kind: 'human' as const } }] })) : []
  const players: Player[] = seats.map((seat, index) => {
    const id = createId('player')
    const relayOperators = mode === 'relay' ? relaySeats[index].operators.map((operator) => cloneRelayOperator(operator, `${gameId}:${id}`)) : undefined
    const primaryController = relayOperators?.[0]?.controller ?? seat.controller
    return {
      id,
      name: seat.name.trim(),
      color: PLAYER_COLORS[index],
      balanceUnits: coinsToUnits(settings.initialCoins),
      items: [],
      cardInventory: [],
      passivityFeeCount: 0,
      controller: primaryController,
      ...(mode === 'relay' && relayOperators ? { relayOperators } : {}),
      ...(mode === 'standard' && primaryController.kind === 'bot' ? { botMemory: emptyBotMemory(`${gameId}:${id}`, strategyForController(primaryController)) } : {}),
    }
  })
  let cardDeck = createCardDeck(settings.disabledCardIds)
  const initialRoundAuctions: GameSession['roundAuctions'] = []
  if (settings.rounds > 1) {
    for (let index = 0; index < settings.systemAuctionCardsPerRound; index += 1) {
      const draw = drawCard(cardDeck, settings.disabledCardIds)
      if (!draw.cardId) break
      cardDeck = draw.cardDeck
      initialRoundAuctions.push({ id: `system-0-${draw.cardId}-${index}`, source: 'system', merchantId: null, cardId: draw.cardId, roundIndex: 0 })
    }
  }
  const initialAuctionNotices = initialRoundAuctions.length === 0 ? [] : players.map((player) => {
    return {
      id: `card-auction-open-0-${player.id}`,
      playerId: player.id,
      title: '本轮道具竞购',
      detail: initialRoundAuctions.map((lot) => {
        const card = getCardDefinition(lot.cardId)
        return `「${card.symbol} ${card.name}」正在竞购：${card.description}`
      }).join('\n'),
    }
  })
  // 先把系统竞购卡从常规卡池中取出，保证同一张卡不会既参与竞购又被发放。
  return {
    version: 35,
    id: gameId,
    phase: settings.identitySettings.enabled ? 'identityHandoff' : 'roundIntro',
    mode,
    relayMethod: relay.relayMethod ?? 'rotation',
    settings: { ...settings, playerCount: seats.length, rewardMultipliers: [...settings.rewardMultipliers], disabledCardIds: [...settings.disabledCardIds], identitySettings: { ...settings.identitySettings, disabledIdentityIds: [...settings.identitySettings.disabledIdentityIds] } },
    players,
    itemDeck: initialItemDeck,
    prophecyDeck: initialItemDeck.map((item) => ({ ...item })),
    roundStartBalanceUnits: Object.fromEntries(players.map((player) => [player.id, player.balanceUnits])),
    pendingPrizeReroll: null,
    pendingPrizeChanges: [],
    pendingFateCoinUse: null,
    cardDeck,
    pendingCardGrants: [],
    identityAvailableIds: enabledIdentityIds(settings.identitySettings),
    identityDraft: settings.identitySettings.enabled ? { playerIndex: 0, choiceIds: dealIdentityChoices([], settings.identitySettings) } : null,
    pendingIdentityCardAwards: [],
    pendingIdentityNotices: initialAuctionNotices,
    identityContracts: [],
    identityEvents: [],
    prophetDivinations: [],
    merchantAuction: null,
    auctionQueue: [],
    roundAuctions: initialRoundAuctions,
    pendingAssetAuctions: [],
    roundAssetAuctions: [],
    pendingMerchantOffers: [],
    merchantShops: [],
    prophetIdentityCandidates: {},
    prophetIdentityProgress: {},
    pendingProphetCardOffers: [],
    pendingKidnapCardOffers: [],
    pendingKidnapNegotiation: null,
    finalReceiptIndex: null,
    operationDeadlineAt: null,
    cardRulesStartRound: 1,
    fairnessOrderIds: shuffle(players.map((player) => player.id)),
    roundIndex: 0,
    currentTurnIndex: 0,
    turns: [],
    results: [],
    spectatorMode: allOperatorsAreBots(players),
    spectatorEvents: [],
    pendingSpectatorEvents: [],
    spectatorTakeoverPlayerIds: [],
    spectatorTakeoverRoundIndex: null,
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
  settings.systemAuctionCardsPerRound = 0
  settings.revealBalanceLeader = false
  settings.identitySettings.enabled = true
  settings.identitySettings.reverserActivationCoins = 2
  const session = createSession(['新手', '小蓝', '小橙'], settings)
  const itemIds = ['basketball', 'camera', 'apartment']
  const itemDeck = itemIds.map((id) => ITEM_POOL.find((item) => item.id === id)!).map((item) => ({ ...item }))
  return {
    ...session,
    phase: 'roundIntro',
    cardDeck: [...session.cardDeck, ...session.roundAuctions.map((auction) => auction.cardId)],
    roundAuctions: [],
    pendingIdentityNotices: [],
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
  const relaySeats: RelaySeatConfig[] = previous.players.map((player) => ({
    name: player.name,
    operators: (player.relayOperators?.length ? player.relayOperators : [{ id: player.id, name: player.name, controller: player.controller ?? { kind: 'human' } }]).map((operator) => ({ id: operator.id, name: operator.name, controller: operator.controller.kind === 'bot' ? { ...operator.controller } : { kind: 'human' } })),
  }))
  const next = createSession(previous.mode === 'relay' ? relaySeats : seats, settings, { mode: previous.mode, relayMethod: previous.relayMethod })
  if (!keepBotGrudges) return next
  const oldToNewId = new Map(previous.players.map((player, index) => [player.id, next.players[index]?.id]))
  return {
    ...next,
    players: next.players.map((player, index) => {
      const previousPlayer = previous.players[index]
      if (player.relayOperators?.length) {
        const previousOperators = previousPlayer?.relayOperators ?? []
        return {
          ...player,
          relayOperators: player.relayOperators.map((operator) => {
            const previousOperator = previousOperators.find((entry) => entry.id === operator.id)
            if (operator.controller.kind !== 'bot' || !previousOperator?.botMemory) return operator
            const grudgeByPlayerId = Object.fromEntries(Object.entries(previousOperator.botMemory.grudgeByPlayerId)
              .map(([oldId, score]) => [oldToNewId.get(oldId), score] as const)
              .filter(([playerId]) => Boolean(playerId))) as Record<string, number>
            return {
              ...operator,
              botMemory: {
                ...(operator.botMemory ?? emptyBotMemory(`${next.id}:${operator.id}`)),
                grudgeByPlayerId,
              },
            }
          }),
        }
      }
      if (player.controller?.kind !== 'bot' || !previousPlayer?.botMemory) return player
      const grudgeByPlayerId = Object.fromEntries(Object.entries(previousPlayer.botMemory.grudgeByPlayerId)
        .map(([oldId, score]) => [oldToNewId.get(oldId), score] as const)
        .filter(([playerId]) => Boolean(playerId))) as Record<string, number>
      // Revenge carries only social memory. The newly created session keeps its own latent behaviour seed.
      return { ...player, botMemory: { ...(player.botMemory ?? emptyBotMemory(`${next.id}:${player.id}`)), grudgeByPlayerId } }
    }),
  }
}

/** Draw fresh candidates outside the scheduled deck and never offer the item being replaced. */
export function drawPrizeRerollOffers(itemDeck: Item[], count = 6, replacingItem?: Item): Item[] {
  const scheduledIds = new Set(itemDeck.map((item) => item.id))
  return shuffle(ITEM_POOL.filter((item) => !scheduledIds.has(item.id) && item.id !== replacingItem?.id && item.name !== replacingItem?.name)).slice(0, count).map((item) => ({ ...item }))
}

export function replaceNextPrize(itemDeck: Item[], roundIndex: number, chosenItem: Item): Item[] {
  return replacePrizeAt(itemDeck, roundIndex + 1, chosenItem)
}

/** Replaces a single scheduled prize without ever touching the prophet deck. */
export function replacePrizeAt(itemDeck: Item[], targetRoundIndex: number, chosenItem: Item): Item[] {
  if (!itemDeck[targetRoundIndex]) return [...itemDeck]
  return itemDeck.map((item, index) => index === targetRoundIndex ? { ...chosenItem } : item)
}

/** The selected prize of a 调包令 stays hidden until settlement. */
export function visibleRoundItem(itemDeck: Item[], pendingPrizeChanges: PendingPrizeChange[], roundIndex: number, viewerId: string): Item {
  const concealedChange = pendingPrizeChanges.find((change) => change.cardId === 'prizeSwap' && change.roundIndex === roundIndex && change.targetRoundIndex === roundIndex && change.confirmedItemId)
  if (!concealedChange || concealedChange.playerId === viewerId) return itemDeck[roundIndex] as Item
  return concealedChange.originalItem
}

/** Resolves a confirmed 调包令 only once everyone has submitted. */
export function resolveRoundPrize(itemDeck: Item[], turns: RoundTurn[], roundIndex: number): { item: Item | undefined; itemDeck: Item[] } {
  const swapUse = turns.flatMap((turn) => turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])).find((use) => use.cardId === 'prizeSwap' && use.prizeReroll?.targetRoundIndex === roundIndex)
  const chosenItem = swapUse?.prizeReroll?.chosenItemId ? ITEM_POOL.find((item) => item.id === swapUse.prizeReroll?.chosenItemId) : undefined
  return { item: chosenItem ?? itemDeck[roundIndex], itemDeck: chosenItem ? replacePrizeAt(itemDeck, roundIndex, chosenItem) : itemDeck }
}

export interface CardGrantPreparation {
  players: Player[]
  cardDeck: CardId[]
  pendingCardGrants: CardGrant[]
}

/** 已使用卡在结算后的下一轮开始前回洗；未使用库存始终不动。 */
export function recycleUsedCards(cardDeck: CardId[], turns: RoundTurn[], autoConsumedCardIds: CardId[] = []): CardId[] {
  const returnedCards = [
    ...turns.flatMap((turn) => (turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])).map((use) => use.cardId)),
    ...autoConsumedCardIds,
  ]
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
  if (roundIndex === 0 || probability <= 0) {
    return { players, cardDeck, pendingCardGrants: [] }
  }
  const lowestBalance = Math.min(...players.map((player) => player.balanceUnits))
  const lowestPlayers = players.filter((player) => player.balanceUnits === lowestBalance)
  const candidates = lowestPlayers.length > 1 && lowestBalance > 0 ? [] : lowestPlayers
  const nextPlayers = players.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory] }))
  const nextDeck = [...cardDeck]
  const grants: CardGrant[] = []
  for (const candidate of candidates) {
    if (roll() >= probability / 100) continue
    if (nextDeck.length === 0) {
      const refill = drawCard(nextDeck, [], roll)
      if (refill.cardId) nextDeck.push(refill.cardId)
    }
    const isFirstOperator = players[roundStartPlayerIndex(roundIndex, players.length)]?.id === candidate.id
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
