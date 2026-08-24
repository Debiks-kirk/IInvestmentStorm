import { calculateFixedAssets } from './assets'
import { cardTargetScope, getCardDefinition } from './cards'
import { coinsToUnits } from './engine'
import { getIdentityDefinition } from './identities'
import type { AssetCategory, BotBehavior, BotDifficulty, BotMemory, BotProfileId, CardId, CardUse, GameSession, IdentityAction, IdentityId, Item, LobbyistTaskType, Player, StrategyMode } from './types'

export interface BotProfile {
  id: BotProfileId
  name: string
  summary: string
  risk: number
  revenge: number
  collect: number
  cards: number
  identity: number
}

export const BOT_PROFILES: BotProfile[] = [
  { id: 'steady', name: '小算盘', summary: '稳健攒钱，只有划算时才出手。', risk: .25, revenge: .05, collect: .2, cards: .25, identity: .25 },
  { id: 'aggressive', name: '火花', summary: '愿意抢第一，也敢承担波动。', risk: .82, revenge: .15, collect: .2, cards: .3, identity: .35 },
  { id: 'collectorBot', name: '馆长', summary: '盯着类别套装，长期收益优先。', risk: .5, revenge: .08, collect: .95, cards: .3, identity: .3 },
  { id: 'observer', name: '狐狸', summary: '擅长观察、预测和避开撞价。', risk: .45, revenge: .1, collect: .35, cards: .45, identity: .4 },
  { id: 'revenge', name: '刺球', summary: '被抢过就会记在心里。', risk: .62, revenge: .95, collect: .2, cards: .4, identity: .4 },
  { id: 'cards', name: '戏法师', summary: '偏爱攒牌和道具组合。', risk: .55, revenge: .15, collect: .25, cards: .95, identity: .35 },
  { id: 'identityBot', name: '演员', summary: '优先发挥自己的身份能力。', risk: .55, revenge: .2, collect: .35, cards: .35, identity: .95 },
  { id: 'comeback', name: '追风', summary: '落后时会果断追赶。', risk: .75, revenge: .2, collect: .35, cards: .4, identity: .4 },
  { id: 'blocker', name: '守门员', summary: '喜欢阻断最强的对手。', risk: .58, revenge: .55, collect: .3, cards: .4, identity: .45 },
  { id: 'adaptive', name: '变色龙', summary: '根据局势随时换打法。', risk: .55, revenge: .3, collect: .5, cards: .5, identity: .5 },
]

export function botProfile(id: BotProfileId): BotProfile {
  return BOT_PROFILES.find((profile) => profile.id === id) ?? BOT_PROFILES[0]
}

export function createBotBehavior(seed = 'default'): BotBehavior {
  const spread = (key: string) => unitRandom(`${seed}:${key}`) * 2 - 1
  return {
    reserveBias: spread('reserve'),
    bankrollBias: spread('bankroll'),
    assetFocusBias: spread('assets'),
    edgeBias: spread('edge'),
    riskBias: spread('risk'),
    antiLeaderBias: spread('leader'),
    predictionBias: spread('prediction'),
    cardBias: spread('cards'),
    quoteFingerprint: Math.floor(unitRandom(`${seed}:quote`) * 17),
  }
}

export function emptyBotMemory(seed = 'default'): BotMemory {
  return { grudgeByPlayerId: {}, lastMode: null, decisionLog: [], behavior: createBotBehavior(seed), recentBidUnits: [] }
}

export function isBot(player: Player | undefined): boolean {
  return player?.controller?.kind === 'bot'
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  return result >>> 0
}

/** Stable pseudo-random values keep a chosen Bot action reproducible after a refresh. */
function unitRandom(seed: string): number {
  return (hash(seed) + .5) / 4294967296
}

/** Box–Muller transform: a deterministic, zero-mean normal sample from a seed. */
function normalRandom(seed: string): number {
  const first = Math.max(.000001, unitRandom(`${seed}:a`))
  const second = unitRandom(`${seed}:b`)
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second)
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function choose<T>(values: T[], seed: string): T | undefined {
  return values.length ? values[hash(seed) % values.length] : undefined
}

export interface PublicRoundObservation {
  winnerId: string | null
  totalBidUnits: number
  minWinningBidUnits: number | null
  tiedPlayerIds: string[]
  itemCategory: AssetCategory
  rankings: Array<{ playerId: string; place: number; rewardUnits: number }>
  publicDeltaByPlayerId: Record<string, number>
}

export interface CashEstimate {
  playerId: string
  lowUnits: number
  expectedUnits: number
  highUnits: number
  expectedBidUnits: number
  categoryWins: number
}

export interface BotObservation {
  /** New sessions get a new ID, making the same Bot preset play differently across games. */
  sessionSeed: string
  playerId: string
  roundIndex: number
  totalRounds: number
  initialCoins: number
  rewardMultipliers: number[]
  correctPredictionMultiplier: number
  wrongPredictionMultiplier: number
  gamblerWrongPenaltyMultiplier: number
  gamblerSkipPenaltyMultiplier: number
  prophetIdentityCostUnits: number
  prophetDivinationLimit: number
  merchantAuctionLimit: number
  kidnapActivationLimit: number
  thiefActivationLimit: number
  reverserActivationLimit: number
  lobbyistActivationLimit: number
  nightwalkerUseLimit: number
  reverserActivationUnits: number
  kidnapActivationUnits: number
  thiefActivationUnits: number
  lobbyistFeeUnits: number
  item: GameSession['itemDeck'][number] | null
  self: Pick<Player, 'id' | 'name' | 'balanceUnits' | 'items' | 'cardInventory' | 'identity'>
  opponents: Array<{ id: string; name: string }>
  previousSubmitterIds: string[]
  publicRounds: PublicRoundObservation[]
  balanceEstimates: CashEstimate[]
  cardDeckSize: number
  activeTask?: { type: LobbyistTaskType; comparisonPlayerId?: string }
  nextItem?: GameSession['itemDeck'][number]
  intel?: { playerId: string; lowUnits: number; highUnits: number }
  legalPeek?: { playerId: string; bidUnits: number }
}

/** Only this adapter sees the full session. The returned payload excludes opponent secrets. */
export function buildBotObservation(session: GameSession, playerId: string): BotObservation {
  const player = session.players.find((entry) => entry.id === playerId) as Player
  const prior = session.turns.map((turn) => turn.playerId).filter((id) => id !== playerId)
  const observation: BotObservation = {
    sessionSeed: session.id,
    playerId,
    roundIndex: session.roundIndex,
    totalRounds: session.settings.rounds,
    initialCoins: session.settings.initialCoins,
    rewardMultipliers: [...session.settings.rewardMultipliers],
    correctPredictionMultiplier: session.settings.correctPredictionMultiplier,
    wrongPredictionMultiplier: session.settings.wrongPredictionMultiplier,
    gamblerWrongPenaltyMultiplier: session.settings.identitySettings.gamblerWrongPenaltyMultiplier,
    gamblerSkipPenaltyMultiplier: session.settings.identitySettings.gamblerSkipPenaltyMultiplier,
    prophetIdentityCostUnits: coinsToUnits(session.settings.identitySettings.prophetDivinationCoins),
    prophetDivinationLimit: session.settings.identitySettings.prophetDivinationLimit,
    merchantAuctionLimit: session.settings.identitySettings.merchantAuctionLimit,
    kidnapActivationLimit: session.settings.identitySettings.kidnapActivationLimit,
    thiefActivationLimit: session.settings.identitySettings.thiefActivationLimit,
    reverserActivationLimit: session.settings.identitySettings.reverserActivationLimit,
    lobbyistActivationLimit: session.settings.identitySettings.lobbyistActivationLimit,
    nightwalkerUseLimit: session.settings.identitySettings.nightwalkerUseLimit,
    reverserActivationUnits: coinsToUnits(session.settings.identitySettings.reverserActivationCoins),
    kidnapActivationUnits: coinsToUnits(session.settings.identitySettings.kidnapActivationCoins),
    thiefActivationUnits: coinsToUnits(session.settings.identitySettings.thiefActivationCoins),
    lobbyistFeeUnits: ((session.roundIndex === 0 && session.settings.identitySettings.lobbyistFirstRoundFree) || player.identity?.lobbyistNextFree)
      ? 0
      : coinsToUnits(session.settings.identitySettings.lobbyistFeeCoins),
    item: session.itemDeck[session.roundIndex] ?? null,
    self: { id: player.id, name: player.name, balanceUnits: player.balanceUnits, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined },
    opponents: session.players.filter((entry) => entry.id !== playerId).map((entry) => ({ id: entry.id, name: entry.name })),
    previousSubmitterIds: prior,
    publicRounds: session.results.map((result) => ({ winnerId: result.winnerId, totalBidUnits: result.totalBidUnits, minWinningBidUnits: result.minWinningBidUnits, tiedPlayerIds: [...result.tiedPlayerIds], itemCategory: result.item.category, rankings: result.rankings.map((entry) => ({ playerId: entry.playerId, place: entry.place, rewardUnits: entry.publicRewardUnits })), publicDeltaByPlayerId: Object.fromEntries(result.deltas.map((delta) => [delta.playerId, delta.publicDeltaUnits])) })),
    balanceEstimates: [],
    cardDeckSize: session.cardDeck.length,
    activeTask: session.identityContracts.find((contract) => contract.targetPlayerId === playerId && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex) ? (() => { const contract = session.identityContracts.find((entry) => entry.targetPlayerId === playerId && entry.status === 'pending' && entry.executeRoundIndex === session.roundIndex)!; return { type: contract.taskType, comparisonPlayerId: contract.comparisonPlayerId } })() : undefined,
    nextItem: session.prophetDivinations.find((entry) => entry.playerId === playerId && entry.roundIndex === session.roundIndex && entry.mode === 'stars')?.starItemIds?.[0]
      ? session.prophecyDeck.find((item) => item.id === session.prophetDivinations.find((entry) => entry.playerId === playerId && entry.roundIndex === session.roundIndex && entry.mode === 'stars')?.starItemIds?.[0])
      : undefined,
  }
  observation.balanceEstimates = estimateBalances(observation)
  if (player.controller?.kind === 'bot' && player.controller.difficulty === 'expert' && prior.length > 0) {
    const targetId = choose(prior, `${session.id}:${playerId}:${session.roundIndex}:intel`)
    const targetTurn = session.turns.find((turn) => turn.playerId === targetId)
    if (targetTurn && targetId) observation.intel = { playerId: targetId, lowUnits: Math.max(0, targetTurn.bidUnits - coinsToUnits(2)), highUnits: targetTurn.bidUnits + coinsToUnits(2) }
  }
  if (player.cardInventory.includes('peek') && prior.length > 0) {
    const targetId = prior[0]
    const targetTurn = session.turns.find((turn) => turn.playerId === targetId)
    if (targetTurn) observation.legalPeek = { playerId: targetId, bidUnits: targetTurn.bidUnits }
  }
  return observation
}

/** Reconstructs a cash range from public totals, thresholds, rewards and winners only. */
export function estimateBalances(observation: Pick<BotObservation, 'initialCoins' | 'self' | 'opponents' | 'publicRounds'>): CashEstimate[] {
  const playerIds = [observation.self.id, ...observation.opponents.map((opponent) => opponent.id)]
  const expected = new Map(playerIds.map((id) => [id, coinsToUnits(observation.initialCoins)]))
  const uncertainty = new Map(playerIds.map((id) => [id, coinsToUnits(3)]))
  const averageBid = new Map(playerIds.map((id) => [id, coinsToUnits(3)]))
  const categoryWins = new Map(playerIds.map((id) => [id, 0]))
  for (const round of observation.publicRounds) {
    const average = round.totalBidUnits / Math.max(1, playerIds.length)
    const ranked = new Map(round.rankings.map((entry) => [entry.playerId, entry]))
    for (const id of playerIds) {
      const entry = ranked.get(id)
      const threshold = round.minWinningBidUnits ?? average
      const rankPressure = entry ? Math.max(0, round.rankings.length - entry.place) * coinsToUnits(.65) : -coinsToUnits(.5)
      const bid = Math.max(0, entry ? Math.max(average, threshold) + rankPressure : average * .78)
      const previousBid = averageBid.get(id) ?? bid
      averageBid.set(id, previousBid * .55 + bid * .45)
      expected.set(id, Math.max(0, (expected.get(id) ?? 0) - bid + (round.publicDeltaByPlayerId[id] ?? 0)))
      uncertainty.set(id, (uncertainty.get(id) ?? 0) + coinsToUnits(1.5) + Math.abs(bid - average) * .18)
    }
    if (round.winnerId) categoryWins.set(round.winnerId, (categoryWins.get(round.winnerId) ?? 0) + 1)
  }
  return playerIds.map((id) => {
    if (id === observation.self.id) return { playerId: id, lowUnits: observation.self.balanceUnits, expectedUnits: observation.self.balanceUnits, highUnits: observation.self.balanceUnits, expectedBidUnits: averageBid.get(id) ?? 0, categoryWins: categoryWins.get(id) ?? 0 }
    const value = Math.max(0, expected.get(id) ?? 0)
    const spread = Math.max(coinsToUnits(4), uncertainty.get(id) ?? 0)
    return { playerId: id, lowUnits: Math.max(0, Math.round(value - spread)), expectedUnits: Math.round(value), highUnits: Math.round(value + spread), expectedBidUnits: Math.max(0, Math.round(averageBid.get(id) ?? 0)), categoryWins: categoryWins.get(id) ?? 0 }
  })
}

function modeFor(observation: BotObservation, profile: BotProfile, memory: BotMemory): StrategyMode {
  const item = observation.item
  const remaining = observation.totalRounds - observation.roundIndex
  const categoryCount = item ? observation.self.items.filter((won) => won.item.category === item.category).length : 0
  const maxGrudge = Math.max(0, ...Object.values(memory.grudgeByPlayerId))
  const opponents = observation.balanceEstimates.filter((entry) => entry.playerId !== observation.self.id)
  const estimatedAverage = opponents.reduce((total, entry) => total + entry.expectedUnits, 0) / Math.max(1, opponents.length)
  const prophetNextBonus = observation.nextItem ? marginalAssetForItem(observation, observation.nextItem) : 0
  const currentBonus = observation.item ? marginalAssetUnits(observation) : 0
  const collectorTarget = observation.self.identity?.id === 'collector' && observation.self.identity.collectorCategory === item?.category
  if (remaining <= 1) return 'finalSprint'
  if (collectorTarget) return 'collect'
  if (observation.self.identity?.id === 'prophet' && prophetNextBonus > currentBonus + coinsToUnits(4)) return 'conserve'
  if (observation.self.balanceUnits < estimatedAverage * (.58 - memory.behavior.riskBias * .06)) return 'comeback'
  if (observation.self.balanceUnits > estimatedAverage * (1.35 + memory.behavior.reserveBias * .15) && profile.risk < .7) return 'conserve'
  if (profile.collect > .7 && categoryCount >= 1) return 'collect'
  if (profile.cards > .75 && observation.self.cardInventory.length > 0) return 'cards'
  if (profile.revenge > .6 && maxGrudge >= 30) return 'revenge'
  if (profile.id === 'comeback' && observation.self.balanceUnits <= coinsToUnits(10)) return 'comeback'
  if (profile.identity > .75 && observation.self.identity) return 'identity'
  if (profile.risk < .35 || observation.self.balanceUnits <= coinsToUnits(5)) return 'conserve'
  if (profile.risk > .7) return 'pressure'
  return 'value'
}

function preferredOpponent(observation: BotObservation, memory: BotMemory): string | undefined {
  return [...observation.opponents].sort((left, right) => (memory.grudgeByPlayerId[right.id] ?? 0) - (memory.grudgeByPlayerId[left.id] ?? 0))[0]?.id
}

function marginalAssetUnits(observation: BotObservation): number {
  return observation.item ? marginalAssetForItem(observation, observation.item) : 0
}

function marginalAssetForItem(observation: BotObservation, item: NonNullable<BotObservation['item']>): number {
  const category = item.category
  const collectorCategory = observation.self.identity?.id === 'collector' ? observation.self.identity.collectorCategory : undefined
  const before = calculateFixedAssets(observation.self.items, collectorCategory).find((entry) => entry.category === category)?.units ?? 0
  const after = calculateFixedAssets([...observation.self.items, { item, roundIndex: observation.roundIndex }], collectorCategory).find((entry) => entry.category === category)?.units ?? 0
  // Collector's matching-item income is real cash at settlement, while the set value stays end-game only.
  const collectorBonus = observation.self.identity?.id === 'collector' && collectorCategory === category ? coinsToUnits(5) : 0
  return Math.max(0, after - before) + collectorBonus
}

function reserveForPlan(observation: BotObservation, profile: BotProfile, mode: StrategyMode, behavior: BotBehavior, assetUnits: number): number {
  const remaining = observation.totalRounds - observation.roundIndex
  if (remaining <= 1 || mode === 'finalSprint') return 0
  const cautiousness = (1 - profile.risk) * 1.45 + Math.max(0, behavior.bankrollBias) * 1.35 + Math.max(0, behavior.reserveBias) * .7
  // Resource-oriented Bots need a little liquidity to turn cards and active identities into real options.
  const cardLiquidity = observation.self.cardInventory.length > 0 ? profile.cards * .45 + Math.max(0, behavior.cardBias) * .35 : 0
  const identityLiquidity = observation.self.identity && profile.identity > .65 ? .45 + Math.max(0, behavior.bankrollBias) * .2 : 0
  const baseCoins = 2.4 + cautiousness + cardLiquidity + identityLiquidity + (remaining >= 5 ? .85 : 0)
  const collectionRelease = mode === 'collect' && assetUnits >= coinsToUnits(5) ? 1.25 + Math.max(0, behavior.assetFocusBias) * .65 : 0
  const desired = coinsToUnits(Math.max(1.25, baseCoins - collectionRelease))
  const ratio = clamp(.14 + (1 - profile.risk) * .16 + behavior.bankrollBias * .08, .07, .36)
  // Low stacks still need a chance to recover; a reserve cannot consume most of a short stack.
  return Math.max(0, Math.min(desired, Math.round(observation.self.balanceUnits * ratio)))
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

function estimateFor(observation: BotObservation, playerId: string): CashEstimate | undefined {
  return observation.balanceEstimates.find((entry) => entry.playerId === playerId)
}

function expectedCurrentBid(observation: BotObservation, playerId: string): number {
  const intel = observation.intel?.playerId === playerId ? (observation.intel.lowUnits + observation.intel.highUnits) / 2 : undefined
  const peek = observation.legalPeek?.playerId === playerId ? observation.legalPeek.bidUnits : undefined
  if (peek !== undefined) return peek
  if (intel !== undefined) return intel
  const estimate = estimateFor(observation, playerId)
  const itemPressure = coinsToUnits((observation.item?.value ?? 0) * .72)
  const publicCategoryWins = observation.item
    ? observation.publicRounds.filter((round) => round.winnerId === playerId && round.itemCategory === observation.item?.category).length
    : 0
  const collectionPressure = publicCategoryWins >= 2 ? coinsToUnits(2.5) : publicCategoryWins === 1 ? coinsToUnits(1) : 0
  return Math.max(coinsToUnits(.5), Math.min(estimate?.highUnits ?? itemPressure, (estimate?.expectedBidUnits ?? itemPressure) * .58 + itemPressure * .42 + collectionPressure))
}

function opponentQuoteSamples(observation: BotObservation, opponentId: string, viewerId: string, count = 11): number[] {
  const estimate = estimateFor(observation, opponentId)
  const mean = expectedCurrentBid(observation, opponentId)
  const cashSpread = Math.max(coinsToUnits(1.5), ((estimate?.highUnits ?? mean) - (estimate?.lowUnits ?? mean)) * .16)
  const historySpread = Math.max(coinsToUnits(.75), Math.abs((estimate?.expectedBidUnits ?? mean) - mean) * .45)
  const deviation = cashSpread + historySpread
  return Array.from({ length: count }, (_, index) => Math.max(0, Math.min(estimate?.highUnits ?? observation.self.balanceUnits, Math.round(mean + normalRandom(`${observation.sessionSeed}:${viewerId}:${opponentId}:${observation.roundIndex}:${observation.item?.id ?? 'item'}:belief:${index}`) * deviation))))
}

function estimatePlaceAndChance(observation: BotObservation, rankingBidUnits: number, selfId: string, rivalBidOverrides: Record<string, number> = {}, quoteCache?: Map<string, number[]>): { place: number; uniqueChance: number; firstChance: number; tieChance: number } {
  let expectedAbove = 0
  let uniqueChance = 1
  let firstChance = 1
  for (const opponent of observation.opponents) {
    if (opponent.id === selfId) continue
    const samples = rivalBidOverrides[opponent.id] === undefined
      ? quoteCache?.get(opponent.id) ?? opponentQuoteSamples(observation, opponent.id, selfId)
      : [rivalBidOverrides[opponent.id]]
    const above = samples.filter((bid) => bid > rankingBidUnits).length / samples.length
    const equal = samples.filter((bid) => bid === rankingBidUnits).length / samples.length
    expectedAbove += above + equal * .5
    firstChance *= 1 - above - equal
    uniqueChance *= 1 - equal
  }
  const tieChance = Math.max(0, 1 - uniqueChance)
  return { place: Math.max(1, Math.min(observation.rewardMultipliers.length + 1, 1 + Math.round(expectedAbove))), uniqueChance: Math.max(.01, uniqueChance), firstChance: Math.max(.001, firstChance * uniqueChance), tieChance }
}

function candidateBids(capUnits: number): number[] {
  // Every half-coin amount is legal candidate space. This removes the old fixed 8-coin attractor.
  return Array.from({ length: Math.max(0, capUnits) + 1 }, (_, units) => units)
}

function taskScore(observation: BotObservation, bidUnits: number, place: number): number {
  const task = observation.activeTask
  if (!task) return 0
  if (task.type === 'avoidPrize') return place > observation.rewardMultipliers.length ? coinsToUnits(3) : -coinsToUnits(3)
  if (task.type === 'winFirst') return place === 1 ? coinsToUnits(3) : -coinsToUnits(3)
  if (task.type === 'winSecond') return place === 2 ? coinsToUnits(3) : -coinsToUnits(3)
  if (task.type === 'bidZero') return bidUnits === 0 ? coinsToUnits(3) : -coinsToUnits(3)
  if (!task.comparisonPlayerId) return 0
  const targetBid = expectedCurrentBid(observation, task.comparisonPlayerId)
  if (task.type === 'outbid') return bidUnits > targetBid ? coinsToUnits(3) : -coinsToUnits(3)
  return bidUnits < targetBid ? coinsToUnits(3) : -coinsToUnits(3)
}

function predictionDecision(observation: BotObservation, ownRankingBidUnits: number, profile: BotProfile, mode: StrategyMode, behavior: BotBehavior): { playerId: string | null; expectedUnits: number } {
  const valueUnits = coinsToUnits(observation.item?.value ?? 0)
  const gambler = observation.self.identity?.id === 'gambler'
  const wrongPenalty = valueUnits * (gambler ? observation.gamblerWrongPenaltyMultiplier : observation.wrongPredictionMultiplier)
  const skipValue = gambler ? -valueUnits * observation.gamblerSkipPenaltyMultiplier : 0
  let best = { playerId: null as string | null, expectedUnits: skipValue }
  for (const opponent of observation.opponents) {
    const targetBid = expectedCurrentBid(observation, opponent.id)
    const targetChance = estimatePlaceAndChance(observation, targetBid, opponent.id).firstChance
    const ownBlocks = 1 - sigmoid((targetBid - ownRankingBidUnits) / coinsToUnits(1.8))
    const probability = Math.max(.01, targetChance * ownBlocks)
    const estimate = estimateFor(observation, opponent.id)
    // Treat a likely winner's ranking prize as uncertain rather than guaranteed cash. This avoids
    // mechanically predicting a nominal first place whose estimated wallet cannot really pay.
    const available = Math.max(0, (estimate?.expectedUnits ?? 0) - targetBid)
    const otherGuessers = 1 + Math.max(0, observation.opponents.length - 2) * (.16 + profile.risk * .10 + Math.max(0, behavior.predictionBias) * .08)
    const payout = Math.min(valueUnits * observation.correctPredictionMultiplier, available) / otherGuessers
    const expectedUnits = probability * payout - (1 - probability) * wrongPenalty
    if (expectedUnits > best.expectedUnits) best = { playerId: opponent.id, expectedUnits }
  }
  const threshold = (gambler ? skipValue + coinsToUnits(.1) : mode === 'finalSprint' ? 0 : coinsToUnits(.25))
    + behavior.predictionBias * coinsToUnits(.45)
  return best.expectedUnits > threshold ? best : { playerId: null, expectedUnits: skipValue }
}

interface TurnPlan {
  id: string
  cardUses: CardUse[]
  rankingMultiplier: number
  rivalBidOverrides?: Record<string, number>
  rankingBidFromTargetId?: string
  identityAction?: IdentityAction
  reversalCount: number
  specialReason?: string
}

interface ScoredPlan extends TurnPlan {
  bidUnits: number
  rankingBidUnits: number
  score: number
  place: number
  effectivePlace: number
  firstChance: number
}

function cardUseVariants(observation: BotObservation): CardUse[][] {
  const candidates: CardUse[] = []
  for (const cardId of [...new Set(observation.self.cardInventory)]) {
    if (cardId === 'reflectShield' || (cardId === 'prizeReroll' && observation.roundIndex >= observation.totalRounds - 1)) continue
    const scope = cardTargetScope(cardId)
    const targets = scope === 'previous' ? observation.previousSubmitterIds : scope === 'other' ? observation.opponents.map((opponent) => opponent.id) : [undefined]
    for (const targetPlayerId of targets) candidates.push({ cardId, ...(targetPlayerId ? { targetPlayerId } : {}) })
  }
  const variants: CardUse[][] = [[]]
  for (const candidate of candidates) variants.push([candidate])
  for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
    if (candidates[left].cardId === 'prizeReroll' || candidates[right].cardId === 'prizeReroll') continue
    if (candidates[left].cardId !== candidates[right].cardId) variants.push([candidates[left], candidates[right]])
  }
  // The player-facing rule has no per-round card cap. Keep planning bounded, but
  // include a combined multi-card option so Bots can still exploit a full hand.
  const combined = candidates.filter((candidate, index, all) => candidate.cardId !== 'prizeReroll' && all.findIndex((entry) => entry.cardId === candidate.cardId) === index)
  if (combined.length > 2) variants.push(combined)
  const seen = new Set<string>()
  const unique = variants.filter((variant) => {
    const key = variant.map((use) => `${use.cardId}:${use.targetPlayerId ?? ''}`).sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [unique[0], ...unique.slice(1).sort((left, right) => hash(`${observation.sessionSeed}:${observation.playerId}:${left.map((use) => use.cardId).join('')}`) - hash(`${observation.sessionSeed}:${observation.playerId}:${right.map((use) => use.cardId).join('')}`)).slice(0, 17)].filter(Boolean) as CardUse[][]
}

function planCandidates(observation: BotObservation): TurnPlan[] {
  const plans: TurnPlan[] = []
  const cardVariants = cardUseVariants(observation)
  for (const cardUses of cardVariants) {
    const swap = cardUses.find((use) => use.cardId === 'swap')
    const rankingMultiplier = cardUses.some((use) => use.cardId === 'doubleBid') ? 2 : 1
    plans.push({ id: `cards:${cardUses.map((use) => `${use.cardId}:${use.targetPlayerId ?? ''}`).join('|') || 'none'}`, cardUses, rankingMultiplier, ...(swap?.targetPlayerId ? { rivalBidOverrides: { [swap.targetPlayerId]: 0 }, rankingBidFromTargetId: swap.targetPlayerId } : {}), reversalCount: cardUses.filter((use) => use.cardId === 'reverseRank').length, ...(swap ? { specialReason: '偷天换日会将自己的实际低下注与目标的排名下注互换。' } : {}) })
  }
  if (observation.self.identity?.id === 'reverser' && (observation.self.identity.activeSkillUses ?? 0) < observation.reverserActivationLimit) {
    const multiplier = observation.roundIndex >= observation.totalRounds - 2 ? 2 : 1
    plans.push(...plans.filter((plan) => !plan.cardUses.some((use) => use.cardId === 'reverseRank')).map((plan) => ({ ...plan, id: `${plan.id}:reverser`, identityAction: { type: 'reverserInvert' as const }, reversalCount: plan.reversalCount + 1, specialReason: `发动逆转排名，支付 ${observation.reverserActivationUnits * multiplier / 2} 金币后将获奖区倒序。` })))
  }
  if (observation.self.identity?.id === 'assassin' && (observation.self.identity.activeSkillUses ?? 0) < observation.kidnapActivationLimit && observation.self.balanceUnits >= kidnapActionCost(observation)) {
    for (const opponent of observation.opponents) plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:kidnap:${opponent.id}`, identityAction: { type: 'kidnap' as const, targetPlayerId: opponent.id }, specialReason: `盯上 ${opponent.name}；若他拿下拍品，就抢走藏品，并赢得下回合的免费行动与道具奖励。` })))
  }
  if (observation.self.identity?.id === 'thief' && (observation.self.identity.activeSkillUses ?? 0) < observation.thiefActivationLimit && observation.roundIndex < observation.totalRounds - 1) {
    plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:thief`, identityAction: { type: 'thiefSteal' as const }, specialReason: '发动偷卡，争取从其他玩家的未使用库存中夺取机会。' })))
  }
  if (observation.self.identity?.id === 'merchant' && observation.roundIndex < observation.totalRounds - 1 && observation.cardDeckSize > 0 && (observation.self.identity.merchantAuctionCount ?? 0) < observation.merchantAuctionLimit && observation.self.identity.merchantLastAuctionRound !== observation.roundIndex) {
    plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:merchant`, identityAction: { type: 'merchantAuction' as const }, specialReason: '发起下轮道具竞购，争取将循环道具转化为现金。' })))
  }
  if (observation.self.identity?.id === 'lobbyist' && (observation.self.identity.activeSkillUses ?? 0) < observation.lobbyistActivationLimit && observation.roundIndex < observation.totalRounds - 1) {
    for (const opponent of observation.opponents) plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:lobby:${opponent.id}`, identityAction: { type: 'lobbyistContract' as const, targetPlayerId: opponent.id }, specialReason: `向 ${opponent.name} 发布随机任务，争取下轮获得违约收益。` })))
  }
  if (observation.self.identity?.id === 'investor' && observation.self.balanceUnits >= coinsToUnits(.5)) {
    const target = observation.opponents[hash(`${observation.sessionSeed}:${observation.playerId}:invest-target`) % Math.max(1, observation.opponents.length)]
    const investmentUnits = Math.max(1, Math.min(observation.self.balanceUnits, coinsToUnits(1 + unitRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:invest-size`) * 5)))
    if (target) plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:invest:${target.id}:${investmentUnits}`, identityAction: { type: 'invest' as const, targetPlayerId: target.id, investmentUnits }, specialReason: `秘密跟投 ${target.name}，争取按出资比例分享排名奖励。` })))
  }
  // Keep the plan set rich, but bounded: a 10-player spectator game must not spend a turn
  // evaluating the full target-card × identity-action cross product.
  const base = plans.find((plan) => plan.id === 'cards:none')
  const rest = plans.filter((plan) => plan !== base)
    .sort((left, right) => hash(`${observation.sessionSeed}:${observation.playerId}:${left.id}`) - hash(`${observation.sessionSeed}:${observation.playerId}:${right.id}`))
    .slice(0, 55)
  return base ? [base, ...rest] : rest
}

function planBidCandidates(plan: TurnPlan, capUnits: number): number[] {
  if (!plan.rankingBidFromTargetId) return candidateBids(capUnits)
  // 偷天换日的关键是把自己的实际投资压低；这样交换后不会把对手抬进奖区。
  // The useful swap tactic is to keep the real payment at zero; any own bid only gifts
  // ranking pressure back to the target after the exchange.
  return [0]
}

function kidnapSuccessChance(observation: BotObservation, targetPlayerId: string): number {
  const targetBid = expectedCurrentBid(observation, targetPlayerId)
  return estimatePlaceAndChance(observation, targetBid, targetPlayerId).firstChance
}

function kidnapActionCost(observation: BotObservation): number {
  return observation.self.identity?.kidnapFreeRoundIndex === observation.roundIndex ? 0 : observation.kidnapActivationUnits
}

function behavioralTemperatureUnits(observation: BotObservation, profile: BotProfile, difficulty: BotDifficulty, mode: StrategyMode, memory: BotMemory): number {
  const difficultyFactor = difficulty === 'easy' ? 1.32 : difficulty === 'expert' ? .62 : .95
  const profileVolatility = .45 + profile.risk * .42 + profile.cards * .13
  const earlyRoundFactor = observation.roundIndex < observation.totalRounds - 2 ? 1.12 : mode === 'finalSprint' ? .64 : .88
  const repetitionFactor = memory.lastMode === mode ? 1.16 : 1
  return coinsToUnits(.75 + profileVolatility * difficultyFactor * earlyRoundFactor * repetitionFactor + Math.abs(memory.behavior.riskBias) * .45)
}

function nearOptimalChoice(candidates: ScoredPlan[], observation: BotObservation, profile: BotProfile, difficulty: BotDifficulty, memory: BotMemory): ScoredPlan {
  const ordered = [...candidates].sort((left, right) => right.score - left.score || left.bidUnits - right.bidUnits || left.id.localeCompare(right.id))
  const best = ordered[0]
  // 身份和目标道具的组合应明确执行最佳计划；普通下注才在近似最优解间混合，避免可被轻易读透。
  const temperature = behavioralTemperatureUnits(observation, profile, difficulty, modeFor(observation, profile, memory), memory)
  // 只让价值足够接近的方案参与；分数越高，按 softmax 被选中的机会越大，而不是均匀乱选。
  const qualityWindow = Math.max(coinsToUnits(1), temperature * 3.2)
  const plausible = ordered.filter((candidate) => candidate.score >= best.score - qualityWindow)
  const weights = plausible.map((candidate) => Math.exp(clamp((candidate.score - best.score) / Math.max(1, temperature), -7, 0)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = unitRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:${observation.item?.id ?? 'unknown'}:${profile.id}:${memory.behavior.quoteFingerprint}:plan`) * total
  for (let index = 0; index < plausible.length; index += 1) {
    cursor -= weights[index]
    if (cursor <= 0) return plausible[index]
  }
  return plausible[0] ?? best
}

/**
 * 让普通竞拍在近似最优解周围做极小、可复现的扰动。以玩家 ID 和对局进度为种子，刷新不会改写
 * 已作出的 Bot 决策；而换日、逆转排名等需要精确语义的计划绝不扰动。
 */
function applyBidJitter(best: ScoredPlan, observation: BotObservation, profile: BotProfile, difficulty: BotDifficulty, mode: StrategyMode, memory: BotMemory): ScoredPlan {
  if (best.rankingBidFromTargetId) return best
  const identityCost = best.identityAction?.type === 'reverserInvert'
    ? observation.reverserActivationUnits * (observation.roundIndex >= observation.totalRounds - 2 ? 2 : 1)
    : best.identityAction?.type === 'kidnap' ? kidnapActionCost(observation)
      : best.identityAction?.type === 'thiefSteal' ? observation.thiefActivationUnits
        : best.identityAction?.type === 'lobbyistContract' ? observation.lobbyistFeeUnits
          : best.identityAction?.type === 'invest' ? best.identityAction.investmentUnits : 0
  const cap = Math.max(0, observation.self.balanceUnits - identityCost)
  const standardDeviation = behavioralTemperatureUnits(observation, profile, difficulty, mode, memory) * .65
  // 绝大多数报价落在中心附近，少量较大胆/保守的偏移来自正态尾部；截断避免无意义的梭哈或归零。
  const fingerprintOffset = (memory.behavior.quoteFingerprint % 5) - 2
  const offsetUnits = Math.round(clamp(normalRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:${observation.item?.id ?? 'unknown'}:${profile.id}:bid-jitter`) * standardDeviation + fingerprintOffset * .38 + memory.behavior.edgeBias * .6, -6, 6))
  const bidUnits = Math.max(0, Math.min(cap, best.bidUnits + offsetUnits))
  if (bidUnits === best.bidUnits) return best
  const rankingBidUnits = bidUnits * best.rankingMultiplier
  const estimate = estimatePlaceAndChance(observation, rankingBidUnits, observation.playerId)
  return { ...best, bidUnits, rankingBidUnits, place: estimate.place, effectivePlace: estimate.place, firstChance: estimate.firstChance }
}

export interface BotTurnDecision {
  bidUnits: number
  predictedPlayerId: string | null
  cardUses: CardUse[]
  identityAction?: IdentityAction
  mode: StrategyMode
  reason: string
  intel?: string
}

/** Choose a prophet action before making the combined auction plan. Free information is useful,
 * but each bot commits to at most one read and only pays for identity guesses with enough upside. */
export function decideBotProphetAction(observation: BotObservation, memory: BotMemory): { mode: 'wealth' | 'stars' | 'identity'; targetPlayerId?: string; identityId?: IdentityId } | null {
  if (observation.self.identity?.id !== 'prophet' || observation.roundIndex >= observation.totalRounds - 1) return null
  const roll = unitRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:prophet:${memory.behavior.quoteFingerprint}`)
  const collectValue = marginalAssetUnits(observation)
  if (roll < .34 + Math.max(0, memory.behavior.reserveBias) * .14) return { mode: 'wealth' }
  if (observation.roundIndex < observation.totalRounds - 2 && (collectValue > coinsToUnits(2) || roll < .82)) return { mode: 'stars' }
  // Identity remains deliberately rare: the paid read must still leave enough cash to compete.
  if (memory.behavior.cardBias + memory.behavior.riskBias > 1.45 && observation.self.balanceUnits >= observation.prophetIdentityCostUnits + coinsToUnits(4)) {
    const targetPlayerId = choose(observation.opponents.map((opponent) => opponent.id), `${observation.sessionSeed}:${observation.playerId}:prophet-target`)
  const identities: IdentityId[] = ['prophet', 'gambler', 'assassin', 'collector', 'thief', 'merchant', 'reverser', 'lobbyist', 'nightwalker', 'investor']
    const identityId = choose(identities, `${observation.sessionSeed}:${observation.playerId}:prophet-identity`)
    if (targetPlayerId && identityId) return { mode: 'identity', targetPlayerId, identityId }
  }
  return { mode: 'wealth' }
}

/** The replacement card is already irrevocably drawn. Choose its best private long-term fit. */
export function decideBotPrizeReroll(player: Player, offers: Item[], roundIndex: number, sessionSeed: string): Item | undefined {
  const before = calculateFixedAssets(player.items).reduce((total, entry) => total + entry.units, 0)
  return [...offers].sort((left, right) => {
    const leftAssets = calculateFixedAssets([...player.items, { item: left, roundIndex }]).reduce((total, entry) => total + entry.units, 0) - before
    const rightAssets = calculateFixedAssets([...player.items, { item: right, roundIndex }]).reduce((total, entry) => total + entry.units, 0) - before
    const leftScore = left.value * 2 + leftAssets + (hash(`${sessionSeed}:${player.id}:${left.id}`) % 3)
    const rightScore = right.value * 2 + rightAssets + (hash(`${sessionSeed}:${player.id}:${right.id}`) % 3)
    return rightScore - leftScore
  })[0]
}

export function decideBotTurn(observation: BotObservation, profileId: BotProfileId, difficulty: BotDifficulty, memory: BotMemory): BotTurnDecision {
  const profile = botProfile(profileId)
  const mode = modeFor(observation, profile, memory)
  const behavior = memory.behavior
  const riskFactor = difficulty === 'easy' ? 1.14 : difficulty === 'expert' ? .91 : 1
  const assetUnits = marginalAssetUnits(observation)
  const reserveUnits = reserveForPlan(observation, profile, mode, behavior, assetUnits)
  const quoteCache = new Map(observation.opponents.map((opponent) => [opponent.id, opponentQuoteSamples(observation, opponent.id, observation.playerId)]))
  const collectorTarget = observation.self.identity?.id === 'collector' && observation.self.identity.collectorCategory === observation.item?.category
  const categoryItems = observation.item ? observation.self.items.filter((won) => won.item.category === observation.item?.category).length : 0
  const scored: ScoredPlan[] = []
  const identityCost = (action: IdentityAction | undefined): number => action?.type === 'reverserInvert'
    ? observation.reverserActivationUnits * (observation.roundIndex >= observation.totalRounds - 2 ? 2 : 1)
    : action?.type === 'kidnap' ? kidnapActionCost(observation)
      : action?.type === 'thiefSteal' ? observation.thiefActivationUnits
        : action?.type === 'lobbyistContract' ? observation.lobbyistFeeUnits
          : action?.type === 'invest' ? action.investmentUnits : 0
  const cardUtility = (uses: CardUse[]): number => uses.reduce((total, use) => {
    if (use.cardId === 'red') return total + coinsToUnits((observation.item?.value ?? 0) >= 8 ? 1.5 : .25) * (1 + behavior.cardBias * .25)
    if (use.cardId === 'black') return total - coinsToUnits(.35)
    if (use.cardId === 'doubleBid') return total + coinsToUnits(.6)
    if (use.cardId === 'bananaPeel') return total + coinsToUnits(1 + behavior.antiLeaderBias * .35)
    if (use.cardId === 'swap') return total + coinsToUnits(1.4)
    if (use.cardId === 'reverseRank') return total + coinsToUnits(.45)
    if (use.cardId === 'redistribute') return total + (mode === 'conserve' ? coinsToUnits(1.4) : coinsToUnits(.15))
    if (use.cardId === 'fateCoin') return total + coinsToUnits(1) * (1 + behavior.riskBias * .5)
    if (use.cardId === 'peek') return total + coinsToUnits(.35)
    if (use.cardId === 'prizeReroll') return total + Math.max(coinsToUnits(.25), assetUnits * .35)
    if (use.cardId === 'legendaryLoot') return total + coinsToUnits((observation.item?.value ?? 0) * (.72 + profile.collect * .28)) + assetUnits * (1 + profile.collect)
    return total
  }, 0)
  for (const plan of planCandidates(observation)) {
    const valueMultiplier = plan.cardUses.reduce((multiplier, use) => use.cardId === 'red' ? multiplier * 2 : use.cardId === 'black' ? multiplier * .5 : multiplier, 1)
    const valueUnits = coinsToUnits(observation.item?.value ?? 0) * valueMultiplier
    const actionCost = identityCost(plan.identityAction)
    const capUnits = Math.max(0, observation.self.balanceUnits - actionCost - reserveUnits)
    for (const bidUnits of planBidCandidates(plan, capUnits)) {
      if (bidUnits + actionCost > observation.self.balanceUnits) continue
      const rankingBidUnits = (plan.rankingBidFromTargetId ? expectedCurrentBid(observation, plan.rankingBidFromTargetId) : bidUnits) * plan.rankingMultiplier
      const overrides = plan.rivalBidOverrides ? { ...plan.rivalBidOverrides } : {}
      if (plan.rankingBidFromTargetId) overrides[plan.rankingBidFromTargetId] = bidUnits
      const bananaTarget = plan.cardUses.find((use) => use.cardId === 'bananaPeel')?.targetPlayerId
      if (bananaTarget) overrides[bananaTarget] = 0
      const estimate = estimatePlaceAndChance(observation, rankingBidUnits, observation.playerId, overrides, quoteCache)
      if (plan.identityAction?.type === 'reverserInvert' && estimate.place > observation.rewardMultipliers.length) continue
      const effectivePlace = plan.reversalCount % 2 === 1 && estimate.place <= observation.rewardMultipliers.length
        ? observation.rewardMultipliers.length - estimate.place + 1
        : estimate.place
      const rewardMultiplier = observation.rewardMultipliers[effectivePlace - 1] ?? 0
      // Collector income and set breakpoints are deliberate bidding advantages, not decorative end-game data.
      const assetWeight = collectorTarget ? 2.35 + Math.max(0, behavior.assetFocusBias) * .55
        : mode === 'collect' ? 1.55 + Math.max(0, behavior.assetFocusBias) * .35
          : .28 + profile.collect * .62 + Math.max(0, behavior.assetFocusBias) * .16
      const expectedReward = estimate.uniqueChance * (valueUnits * rewardMultiplier + assetUnits * assetWeight)
      const kidnappedTarget = plan.identityAction?.type === 'kidnap' ? plan.identityAction.targetPlayerId : undefined
      const kidnapChance = kidnappedTarget ? kidnapSuccessChance(observation, kidnappedTarget) : 0
      const kidnapAssetValue = kidnappedTarget ? marginalAssetUnits(observation) + coinsToUnits((observation.item?.value ?? 0) * .28) : 0
      const kidnapValue = kidnapChance * kidnapAssetValue
      const kidnapRisk = (plan.identityAction?.type === 'kidnap' ? kidnapActionCost(observation) : 0) * (1 - kidnapChance)
      const cashRisk = bidUnits * (mode === 'conserve' ? 1.28 : mode === 'finalSprint' ? .78 : 1) * riskFactor + actionCost + kidnapRisk
      const remainingCash = observation.self.balanceUnits - bidUnits - actionCost
      const bankruptcyFloor = coinsToUnits(1.5 + Math.max(0, behavior.bankrollBias) * .8)
      const bankruptcyPenalty = observation.roundIndex < observation.totalRounds - 2 && remainingCash < bankruptcyFloor
        ? (bankruptcyFloor - Math.max(0, remainingCash)) * (1.15 + (1 - profile.risk) * .8)
        : 0
      const categoryMomentum = categoryItems > 0 ? estimate.uniqueChance * coinsToUnits(Math.min(1.6, categoryItems * (.28 + profile.collect * .18))) * (collectorTarget ? 1.6 : 1) : 0
      const boldness = (mode === 'pressure' || mode === 'comeback' || mode === 'finalSprint') ? estimate.firstChance * coinsToUnits(1.25) : 0
      const blockTarget = preferredOpponent(observation, memory)
      const blockValue = blockTarget && rankingBidUnits > (overrides[blockTarget] ?? expectedCurrentBid(observation, blockTarget)) ? coinsToUnits(profile.revenge * 1.4) : 0
      const inversionSetup = plan.identityAction?.type === 'reverserInvert' && estimate.place > 1 ? coinsToUnits((estimate.place - 1) * .4) : 0
      const grudgeKidnapBonus = kidnappedTarget && kidnappedTarget === preferredOpponent(observation, memory) ? coinsToUnits(profile.revenge * .7) * kidnapChance : 0
      const tiePenalty = estimate.tieChance * coinsToUnits(2.2 + Math.max(0, behavior.edgeBias) * .8)
      const fingerprintBonus = ((bidUnits + behavior.quoteFingerprint) % 5 === 0 ? coinsToUnits(.12) : 0) + behavior.edgeBias * Math.min(coinsToUnits(.7), bidUnits * .04)
      const identityValue = plan.identityAction?.type === 'kidnap' ? kidnapChance * coinsToUnits(2.4 + profile.revenge)
        : plan.identityAction?.type === 'merchantAuction' ? coinsToUnits(.8 + behavior.cardBias * .5)
        : plan.identityAction?.type === 'thiefSteal' ? coinsToUnits(.6 + behavior.cardBias * .45)
          : plan.identityAction?.type === 'lobbyistContract' ? coinsToUnits(.7 + behavior.antiLeaderBias * .35) : 0
      const score = expectedReward - cashRisk - bankruptcyPenalty + categoryMomentum + kidnapValue + boldness + blockValue + grudgeKidnapBonus + inversionSetup + taskScore(observation, rankingBidUnits, estimate.place) + cardUtility(plan.cardUses) + identityValue + fingerprintBonus - tiePenalty
      scored.push({ ...plan, bidUnits, rankingBidUnits, score, place: estimate.place, effectivePlace, firstChance: estimate.firstChance })
    }
  }
  const fallback: ScoredPlan = { id: 'safe', cardUses: [], rankingMultiplier: 1, reversalCount: 0, bidUnits: 0, rankingBidUnits: 0, score: 0, place: observation.rewardMultipliers.length + 1, effectivePlace: observation.rewardMultipliers.length + 1, firstChance: 0 }
  const best = applyBidJitter(nearOptimalChoice(scored.length > 0 ? scored : [fallback], observation, profile, difficulty, memory), observation, profile, difficulty, mode, memory)
  const cardUses = best.cardUses.map((use) => use.cardId === 'fateCoin' ? { ...use, coinResult: hash(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:coin`) % 2 === 0 ? 'heads' as const : 'tails' as const } : use)
  let identityAction = best.identityAction
  // Nightwalkers choose a human-looking A first. Collecting-minded nightwalkers
  // also value a B that is likely to turn a non-winning A into the item winner;
  // the engine still resolves the exact choice only after every bid is known.
  if (observation.self.identity?.id === 'nightwalker' && (observation.self.identity.nightwalkerUses ?? 0) < observation.nightwalkerUseLimit && !cardUses.some((use) => ['doubleBid', 'swap', 'bananaPeel', 'reverseRank'].includes(use.cardId))) {
    const valueUnits = coinsToUnits(observation.item?.value ?? 0) * cardUses.reduce((factor, use) => use.cardId === 'red' ? factor * 2 : use.cardId === 'black' ? factor * .5 : factor, 1)
    const baseEstimate = estimatePlaceAndChance(observation, best.rankingBidUnits, observation.playerId, {}, quoteCache)
    const baseReward = valueUnits * (observation.rewardMultipliers[baseEstimate.place - 1] ?? 0) * baseEstimate.uniqueChance
    const baseNet = baseReward - best.bidUnits
    const availableAfterImmediateCards = observation.self.balanceUnits + (cardUses.some((use) => use.cardId === 'fateCoin' && use.coinResult === 'heads') ? coinsToUnits(10) : 0)
    const shadows = Array.from({ length: Math.max(0, availableAfterImmediateCards - best.bidUnits) }, (_, index) => best.bidUnits + index + 1)
    const prioritizeItem = profile.collect + behavior.cardBias * .12 >= .42
    const baseLikelyWinsItem = baseEstimate.place === 1 && baseEstimate.uniqueChance >= .42
    const shadowCandidates = shadows.map((shadowBidUnits) => {
      const estimate = estimatePlaceAndChance(observation, shadowBidUnits, observation.playerId, {}, quoteCache)
      const reward = valueUnits * (observation.rewardMultipliers[estimate.place - 1] ?? 0) * estimate.uniqueChance
      return { bidUnits: shadowBidUnits, net: reward - shadowBidUnits, likelyWinsItem: estimate.place === 1 && estimate.uniqueChance >= .42 }
    })
    const shadow = shadowCandidates.sort((left, right) => {
      const leftItemUpgrade = Number(prioritizeItem && left.likelyWinsItem && !baseLikelyWinsItem)
      const rightItemUpgrade = Number(prioritizeItem && right.likelyWinsItem && !baseLikelyWinsItem)
      return rightItemUpgrade - leftItemUpgrade || right.net - left.net || left.bidUnits - right.bidUnits
    })[0]
    const makesItemPush = Boolean(prioritizeItem && shadow?.likelyWinsItem && !baseLikelyWinsItem)
    if (shadow && (makesItemPush || shadow.net > baseNet + coinsToUnits(.2))) {
      identityAction = { type: 'nightwalkerDoubleBid', shadowBidUnits: shadow.bidUnits, prioritizeItem }
    }
  }
  const prediction = predictionDecision(observation, best.rankingBidUnits, profile, mode, behavior)
  const intel = observation.intel ? `模糊情报：${observation.opponents.find((opponent) => opponent.id === observation.intel?.playerId)?.name ?? '一名对手'} 的投资约为 ${observation.intel.lowUnits / 2}–${observation.intel.highUnits / 2}。` : undefined
  const predictionText = prediction.playerId ? `预测 ${observation.opponents.find((opponent) => opponent.id === prediction.playerId)?.name ?? '对手'} 的期望收益 ${Math.round(prediction.expectedUnits) / 2}。` : '预测期望不够，选择跳过。'
  const specialText = best.specialReason ? `${best.specialReason}${best.identityAction?.type === 'reverserInvert' ? ` 预计先以第 ${best.place} 名进入获奖区，再倒转为第 ${best.effectivePlace} 名。` : ''}` : identityAction?.type === 'nightwalkerDoubleBid' ? `发动双影下注：先报 ${best.bidUnits / 2}，再保留 ${identityAction.shadowBidUnits / 2} 的夜行影价。` : ''
  const mixedText = !best.specialReason && !identityAction ? ' 在高价值方案中按性格、资金底线与局势做了带权混合，并加入受控的报价波动。' : ''
  const financeText = reserveUnits > 0 ? ` 预留约 ${reserveUnits / 2} 金币周转。` : ''
  const collectionText = collectorTarget ? ' 当前拍品命中收藏类别，已计入即时奖励与套装增量。' : ''
  return { bidUnits: best.bidUnits, predictedPlayerId: prediction.playerId, cardUses, identityAction, mode, reason: `${modeLabel(mode)}：估算获奖机会 ${Math.round(best.firstChance * 100)}%，选择 ${best.bidUnits / 2} 金币。${collectionText}${financeText}${specialText}${mixedText}${predictionText}`, intel }
}

export function decideBotIdentity({ choices, player, players, cardOfferIds }: { choices: IdentityId[]; player: Player; players: Player[]; cardOfferIds?: CardId[] }): { identityId: IdentityId; targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId; mode: StrategyMode; reason: string } {
  const controller = player.controller?.kind === 'bot' ? player.controller : { profileId: 'adaptive' as BotProfileId }
  const profile = botProfile(controller.profileId)
  const scores: Record<IdentityId, number> = { prophet: .4, gambler: profile.risk, assassin: profile.revenge + profile.risk, collector: profile.collect, thief: profile.cards + profile.revenge, merchant: profile.cards, reverser: profile.risk, lobbyist: profile.identity + profile.revenge, nightwalker: profile.risk + profile.identity * .55, investor: profile.collect + profile.risk * .35 }
  const identityId = [...choices].sort((left, right) => scores[right] - scores[left] || left.localeCompare(right))[0] ?? choices[0]
  const target = players.filter((entry) => entry.id !== player.id)[hash(`${player.id}:${identityId}`) % Math.max(1, players.length - 1)]
  const categories: AssetCategory[] = ['leisure', 'transport', 'luxury', 'property']
  const collectorCategory = categories.sort((left, right) => (player.items.filter((won) => won.item.category === right).length - player.items.filter((won) => won.item.category === left).length))[0]
  const merchantCardId = cardOfferIds?.sort((left, right) => getCardDefinition(right).description.length - getCardDefinition(left).description.length)[0]
  return { identityId, ...(target && identityId === 'thief' ? { targetPlayerId: target.id } : {}), ...(identityId === 'collector' ? { collectorCategory } : {}), ...(identityId === 'merchant' && merchantCardId ? { merchantCardId } : {}), mode: 'identity', reason: `选择${getIdentityDefinition(identityId).name}以配合当前性格。` }
}

export function decideBotMerchantBid(player: Player, cardId: CardId): { bidUnits: number; mode: StrategyMode; reason: string } {
  const profile = player.controller?.kind === 'bot' ? botProfile(player.controller.profileId) : botProfile('adaptive')
  const behavior = player.botMemory?.behavior ?? createBotBehavior(player.id)
  const value = cardId === 'legendaryLoot' ? 12
    : cardId === 'red' || cardId === 'doubleBid' || cardId === 'reverseRank' ? 7.5
      : cardId === 'bananaPeel' || cardId === 'swap' ? 6.2
        : cardId === 'fateCoin' ? 3.5 : 4.5
  const center = coinsToUnits(value * (.42 + profile.cards * .24 + behavior.cardBias * .08))
  const reserve = Math.max(0, coinsToUnits(1.5 + behavior.reserveBias * 1.2))
  const cap = Math.max(0, player.balanceUnits - reserve)
  const scored = Array.from({ length: cap + 1 }, (_, bidUnits) => {
    const distance = Math.abs(bidUnits - center)
    const uniqueness = ((bidUnits + behavior.quoteFingerprint) % 7 === 0 ? .28 : 0) - (bidUnits % 4 === 0 ? .08 : 0)
    return { bidUnits, score: -distance * (.38 - profile.cards * .08) - bidUnits * .08 + uniqueness + behavior.riskBias * bidUnits * .025 }
  }).sort((left, right) => right.score - left.score)
  const window = scored.filter((entry) => entry.score >= scored[0].score - 1.8)
  const selected = choose(window, `${player.id}:${cardId}:${player.botMemory?.decisionLog.length ?? 0}:auction`) ?? scored[0]
  return { bidUnits: selected.bidUnits, mode: 'cards', reason: '按道具协同性、现金保留与报价指纹，在半金币报价中选择了不易撞价的竞购方案。' }
}

export function modeLabel(mode: StrategyMode): string {
  return ({ value: '价值竞拍', conserve: '保守蓄力', collect: '收藏冲刺', pressure: '强势施压', revenge: '复仇阻击', cards: '道具组合', identity: '身份经营', comeback: '逆风追赶', finalSprint: '终局冲刺' })[mode]
}

export function appendBotRecord(player: Player, record: BotMemory['decisionLog'][number]): Player {
  const memory = player.botMemory ?? emptyBotMemory()
  const recentBidUnits = record.bidUnits === undefined ? memory.recentBidUnits : [...memory.recentBidUnits, record.bidUnits].slice(-8)
  return { ...player, botMemory: { ...memory, lastMode: record.mode, recentBidUnits, decisionLog: [...memory.decisionLog, record].slice(-80) } }
}

export function updateBotGrudges(players: Player[], result: { winnerId: string | null; rankings: Array<{ playerId: string; place: number }> }): Player[] {
  return players.map((player) => {
    if (!isBot(player) || !result.winnerId || result.winnerId === player.id) return player
    const own = result.rankings.find((entry) => entry.playerId === player.id)
    if (!own || own.place <= 1) return player
    const memory = player.botMemory ?? emptyBotMemory()
    const previous = memory.grudgeByPlayerId[result.winnerId] ?? 0
    return { ...player, botMemory: { ...memory, grudgeByPlayerId: { ...memory.grudgeByPlayerId, [result.winnerId]: Math.min(100, previous + 12) } } }
  })
}
