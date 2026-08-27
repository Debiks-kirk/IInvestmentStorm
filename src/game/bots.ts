import { calculateFixedAssets, fixedAssetCoins, itemFixedAssetCoins } from './assets'
import { cardTargetScope, getCardDefinition } from './cards'
import { coinsToUnits } from './engine'
import { getIdentityDefinition } from './identities'
import type { AssetAuctionLot, AssetCategory, BotBehavior, BotDifficulty, BotMemory, BotProfileId, BotProfileSelection, BotStrategyConfig, CardId, CardUse, GameSession, IdentityAction, IdentityId, Item, LobbyistTaskType, Player, PlayerController, StrategyMode } from './types'

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

export function botProfile(id: BotProfileSelection): BotProfile {
  return BOT_PROFILES.find((profile) => profile.id === id) ?? BOT_PROFILES.find((profile) => profile.id === 'adaptive') ?? BOT_PROFILES[0]
}

const IDENTITY_IDS: IdentityId[] = ['prophet', 'gambler', 'assassin', 'collector', 'thief', 'merchant', 'reverser', 'lobbyist', 'nightwalker', 'investor']
type BotStrategyInput = Partial<BotStrategyConfig> & { identityTactics?: Partial<Record<IdentityId, number>> }

function boundedPercent(value: number | undefined, fallback: number): number {
  return Math.round(clamp(Number.isFinite(value) ? value as number : fallback, 0, 100))
}

/** System personalities are expressed through the same knobs as custom Bots. */
export function defaultBotStrategy(profileId: BotProfileSelection = 'adaptive'): BotStrategyConfig {
  const profile = botProfile(profileId === 'custom' ? 'adaptive' : profileId)
  const base = (value: number) => Math.round(value * 100)
  const identityScores: Record<IdentityId, number> = {
    collector: profile.collect * .72 + .22,
    assassin: profile.revenge * .55 + profile.risk * .35 + .12,
    thief: profile.cards * .58 + profile.revenge * .28 + .16,
    merchant: profile.cards * .7 + .15,
    reverser: profile.risk * .62 + profile.identity * .2 + .12,
    lobbyist: profile.identity * .62 + profile.revenge * .25 + .12,
    nightwalker: profile.risk * .52 + profile.identity * .35 + .12,
    investor: profile.collect * .42 + profile.risk * .35 + .15,
    prophet: profile.identity * .42 + profile.cards * .3 + .2,
    gambler: profile.risk * .72 + .12,
  }
  const identityPriority = [...IDENTITY_IDS].sort((left, right) => identityScores[right] - identityScores[left] || left.localeCompare(right))
  return {
    risk: base(profile.risk), bankroll: base(1 - profile.risk * .55), collection: base(profile.collect), market: base(profile.risk * .45 + profile.collect * .3 + .2), cards: base(profile.cards), identity: base(profile.identity), interference: base(profile.revenge), prediction: base(profile.risk * .45 + .25), comeback: base(profile.risk * .5 + .3), identityPriority,
  }
}

export function normalizeBotStrategy(value: BotStrategyInput | undefined, fallbackProfile: BotProfileSelection = 'adaptive'): BotStrategyConfig {
  const defaults = defaultBotStrategy(fallbackProfile)
  const fromLegacyTactics = value?.identityTactics
    ? [...IDENTITY_IDS].sort((left, right) => (value.identityTactics?.[right] ?? 0) - (value.identityTactics?.[left] ?? 0) || left.localeCompare(right))
    : undefined
  const preferred = Array.isArray(value?.identityPriority) ? value.identityPriority.filter((id): id is IdentityId => IDENTITY_IDS.includes(id)) : fromLegacyTactics
  const identityPriority = [...new Set([...(preferred ?? []), ...defaults.identityPriority, ...IDENTITY_IDS])]
  return {
    risk: boundedPercent(value?.risk, defaults.risk), bankroll: boundedPercent(value?.bankroll, defaults.bankroll), collection: boundedPercent(value?.collection, defaults.collection), market: boundedPercent(value?.market, defaults.market), cards: boundedPercent(value?.cards, defaults.cards), identity: boundedPercent(value?.identity, defaults.identity), interference: boundedPercent(value?.interference, defaults.interference), prediction: boundedPercent(value?.prediction, defaults.prediction), comeback: boundedPercent(value?.comeback, defaults.comeback),
    identityPriority,
  }
}

function profileFromStrategy(profileId: BotProfileSelection, strategy?: BotStrategyConfig): BotProfile {
  if (profileId !== 'custom') return botProfile(profileId)
  const config = normalizeBotStrategy(strategy)
  return {
    id: 'adaptive', name: '自定义', summary: '按自定义策略行动。',
    risk: config.risk / 100,
    revenge: config.interference / 100,
    collect: config.collection / 100,
    cards: config.cards / 100,
    identity: config.identity / 100,
  }
}

function effectiveProfile(controller: PlayerController | undefined, memory?: BotMemory): BotProfile {
  return controller?.kind === 'bot'
    ? profileFromStrategy(controller.profileId, memory?.strategy)
    : botProfile('adaptive')
}

export function strategyForController(controller: PlayerController): BotStrategyConfig {
  return controller.kind === 'bot'
    ? normalizeBotStrategy(controller.profileId === 'custom' ? controller.customProfile : undefined, controller.profileId)
    : defaultBotStrategy('adaptive')
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
    assetMarketBias: spread('asset-market'),
    quoteFingerprint: Math.floor(unitRandom(`${seed}:quote`) * 17),
  }
}

export function emptyBotMemory(seed = 'default', strategy: BotStrategyConfig = defaultBotStrategy('adaptive')): BotMemory {
  return { grudgeByPlayerId: {}, lastMode: null, decisionLog: [], behavior: createBotBehavior(seed), strategy: normalizeBotStrategy(strategy), recentBidUnits: [] }
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
  /** Final item owner after public transfers; old records fall back to winnerId. */
  itemWinnerId?: string | null
  totalBidUnits: number
  minWinningBidUnits: number | null
  tiedPlayerIds: string[]
  itemCategory: AssetCategory
  rankings: Array<{ playerId: string; place: number; rewardUnits: number }>
  publicDeltaByPlayerId: Record<string, number>
  /** Public asset-auction transfers, which keep collection estimates up to date. */
  assetAuctionResults?: Array<{ sellerId: string; winnerId: string | null; itemCategory: AssetCategory }>
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
  investorDividendMultiplier: number
  prophetIdentityCostUnits: number
  prophetDivinationLimit: number
  merchantAuctionLimit: number
  kidnapActivationLimit: number
  kidnapTargetCap: number
  kidnapLowRansomUnits: number
  kidnapHighRansomUnits: number
  kidnapHighRansomExtraUnits: number
  kidnapExtraTargetUnits: number
  thiefActivationLimit: number
  reverserActivationLimit: number
  lobbyistActivationLimit: number
  nightwalkerUseLimit: number
  reverserActivationUnits: number
  kidnapActivationUnits: number
  thiefActivationUnits: number
  lobbyistFeeUnits: number
  lobbyistSpecifiedFeeUnits: number
  item: GameSession['itemDeck'][number] | null
  self: Pick<Player, 'id' | 'name' | 'balanceUnits' | 'items' | 'cardInventory' | 'identity' | 'passivityFeeCount'>
  /** Only the bot's own frozen opening balance is exposed. */
  selfRoundStartBalanceUnits: number
  opponents: Array<{ id: string; name: string }>
  /** Controller kind is public seating information, not a hidden game resource. */
  humanOpponentIds: string[]
  previousSubmitterIds: string[]
  publicRounds: PublicRoundObservation[]
  balanceEstimates: CashEstimate[]
  cardDeckSize: number
  activeTask?: { type: LobbyistTaskType; comparisonPlayerId?: string }
  nextItem?: GameSession['itemDeck'][number]
  intel?: { playerId: string; lowUnits: number; highUnits: number }
  legalPeek?: { playerId: string; bidUnits: number }
  /** Only the prophet's own candidate cards and solved/excluded records are exposed. */
  prophetIdentityCandidates?: Record<string, IdentityId[]>
  prophetIdentityProgress?: Record<string, { excludedIdentityIds: IdentityId[]; solvedIdentityId?: IdentityId }>
}

/** Only this adapter sees the full session. The returned payload excludes opponent secrets. */
export function buildBotObservation(session: GameSession, playerId: string): BotObservation {
  const player = session.players.find((entry) => entry.id === playerId) as Player
  const prior = session.turns.map((turn) => turn.playerId).filter((id) => id !== playerId)
  const pendingPrizeChange = session.pendingPrizeReroll
  const concealedPrizeSwap = pendingPrizeChange?.cardId === 'prizeSwap'
    && pendingPrizeChange.roundIndex === session.roundIndex
    && pendingPrizeChange.playerId !== playerId
  const visibleItem = concealedPrizeSwap ? pendingPrizeChange!.originalItem : session.itemDeck[session.roundIndex]
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
    investorDividendMultiplier: session.settings.identitySettings.investorDividendMultiplier,
    prophetIdentityCostUnits: coinsToUnits(session.settings.identitySettings.prophetDivinationCoins),
    prophetDivinationLimit: session.settings.identitySettings.prophetDivinationLimit,
    merchantAuctionLimit: session.settings.identitySettings.merchantAuctionLimit,
    kidnapActivationLimit: session.settings.identitySettings.kidnapActivationLimit,
    kidnapTargetCap: Math.max(1, Math.min(session.players.length - 1, session.settings.identitySettings.kidnapTargetLimit > 0 ? session.settings.identitySettings.kidnapTargetLimit : Math.ceil(session.players.length / 4))),
    kidnapLowRansomUnits: coinsToUnits(session.settings.identitySettings.kidnapLowRansomCoins),
    kidnapHighRansomUnits: coinsToUnits(session.settings.identitySettings.kidnapHighRansomCoins),
    kidnapHighRansomExtraUnits: coinsToUnits(session.settings.identitySettings.kidnapHighRansomExtraCoins),
    kidnapExtraTargetUnits: coinsToUnits(session.settings.identitySettings.kidnapExtraTargetCoins),
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
    lobbyistSpecifiedFeeUnits: coinsToUnits(session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins),
    item: visibleItem ?? null,
    self: { id: player.id, name: player.name, balanceUnits: player.balanceUnits, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined, passivityFeeCount: player.passivityFeeCount ?? 0 },
    selfRoundStartBalanceUnits: session.roundStartBalanceUnits?.[player.id] ?? player.balanceUnits,
    opponents: session.players.filter((entry) => entry.id !== playerId).map((entry) => ({ id: entry.id, name: entry.name })),
    humanOpponentIds: session.players.filter((entry) => entry.id !== playerId && entry.controller?.kind !== 'bot').map((entry) => entry.id),
    previousSubmitterIds: prior,
    publicRounds: session.results.map((result) => ({ winnerId: result.winnerId, itemWinnerId: result.itemWinnerId, totalBidUnits: result.totalBidUnits, minWinningBidUnits: result.minWinningBidUnits, tiedPlayerIds: [...result.tiedPlayerIds], itemCategory: result.item.category, rankings: result.rankings.map((entry) => ({ playerId: entry.playerId, place: entry.place, rewardUnits: entry.publicRewardUnits })), publicDeltaByPlayerId: Object.fromEntries(result.deltas.map((delta) => [delta.playerId, delta.publicDeltaUnits])), assetAuctionResults: result.assetAuctionResults.map((entry) => ({ sellerId: entry.sellerId, winnerId: entry.winnerId, itemCategory: entry.item.category })) })),
    balanceEstimates: [],
    cardDeckSize: session.cardDeck.length,
    activeTask: session.identityContracts.find((contract) => contract.targetPlayerId === playerId && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex) ? (() => { const contract = session.identityContracts.find((entry) => entry.targetPlayerId === playerId && entry.status === 'pending' && entry.executeRoundIndex === session.roundIndex)!; return { type: contract.taskType, comparisonPlayerId: contract.comparisonPlayerId } })() : undefined,
    nextItem: session.prophetDivinations.find((entry) => entry.playerId === playerId && entry.roundIndex === session.roundIndex && entry.mode === 'stars')?.starItemIds?.[0]
      ? session.prophecyDeck.find((item) => item.id === session.prophetDivinations.find((entry) => entry.playerId === playerId && entry.roundIndex === session.roundIndex && entry.mode === 'stars')?.starItemIds?.[0])
      : undefined,
    ...(player.identity?.id === 'prophet' ? {
      prophetIdentityCandidates: Object.fromEntries(Object.entries(session.prophetIdentityCandidates[playerId] ?? {}).map(([targetId, candidates]) => [targetId, [...candidates]])),
      prophetIdentityProgress: Object.fromEntries(Object.entries(session.prophetIdentityProgress[playerId] ?? {}).map(([targetId, progress]) => [targetId, { excludedIdentityIds: [...progress.excludedIdentityIds], ...(progress.solvedIdentityId ? { solvedIdentityId: progress.solvedIdentityId } : {}) }])),
    } : {}),
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
  if (collectorTarget || (memory.strategy.collection >= 72 && categoryCount >= 1)) return 'collect'
  if (observation.self.identity?.id === 'prophet' && prophetNextBonus > currentBonus + coinsToUnits(4)) return 'conserve'
  if (observation.self.balanceUnits < estimatedAverage * (.58 - memory.behavior.riskBias * .06) && memory.strategy.comeback >= 35) return 'comeback'
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

function reserveForPlan(observation: BotObservation, profile: BotProfile, mode: StrategyMode, behavior: BotBehavior, strategy: BotStrategyConfig, assetUnits: number): number {
  const remaining = observation.totalRounds - observation.roundIndex
  if (remaining <= 1 || mode === 'finalSprint') return 0
  const cautiousness = (1 - profile.risk) * 1.45 + strategy.bankroll / 100 * 1.7 + Math.max(0, behavior.bankrollBias) * 1.35 + Math.max(0, behavior.reserveBias) * .7
  // Resource-oriented Bots need a little liquidity to turn cards and active identities into real options.
  const cardLiquidity = observation.self.cardInventory.length > 0 ? profile.cards * .45 + Math.max(0, behavior.cardBias) * .35 : 0
  const identityLiquidity = observation.self.identity && profile.identity > .65 ? .45 + Math.max(0, behavior.bankrollBias) * .2 : 0
  const baseCoins = 2.4 + cautiousness + cardLiquidity + identityLiquidity + (remaining >= 5 ? .85 : 0)
  const collectionRelease = mode === 'collect' && assetUnits >= coinsToUnits(5) ? 1.25 + Math.max(0, behavior.assetFocusBias) * .65 : 0
  const desired = coinsToUnits(Math.max(1.25, baseCoins - collectionRelease))
  const ratio = clamp(.10 + strategy.bankroll / 100 * .2 + (1 - profile.risk) * .12 + behavior.bankrollBias * .08, .06, .42)
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

function predictionDecision(observation: BotObservation, ownRankingBidUnits: number, profile: BotProfile, mode: StrategyMode, behavior: BotBehavior, strategy: BotStrategyConfig): { playerId: string | null; expectedUnits: number } {
  const valueUnits = coinsToUnits(observation.item?.value ?? 0)
  const gambler = observation.self.identity?.id === 'gambler'
  const wrongPenalty = valueUnits * (gambler ? observation.gamblerWrongPenaltyMultiplier : observation.wrongPredictionMultiplier)
  const skipValue = gambler ? -valueUnits * observation.gamblerSkipPenaltyMultiplier : 0
  let best = { playerId: null as string | null, expectedUnits: skipValue }
  for (const opponent of observation.opponents) {
    // A public cash reconstruction can be imperfect, but an opponent whose
    // entire estimated range is empty should not be treated as a credible winner.
    if ((estimateFor(observation, opponent.id)?.highUnits ?? 0) <= 0) continue
    const targetBid = expectedCurrentBid(observation, opponent.id)
    const targetChance = estimatePlaceAndChance(observation, targetBid, opponent.id).firstChance
    const ownBlocks = 1 - sigmoid((targetBid - ownRankingBidUnits) / coinsToUnits(1.8))
    const probability = Math.max(.01, targetChance * ownBlocks)
    const otherGuessers = 1 + Math.max(0, observation.opponents.length - 2) * (.16 + profile.risk * .10 + Math.max(0, behavior.predictionBias) * .08)
    // The system covers a first-place shortfall, so a correct prediction always receives its
    // advertised reward; only sharing it with other guessers remains uncertain.
    const payout = valueUnits * observation.correctPredictionMultiplier / otherGuessers
    const expectedUnits = probability * payout - (1 - probability) * wrongPenalty
    if (expectedUnits > best.expectedUnits) best = { playerId: opponent.id, expectedUnits }
  }
  const predictionDrive = behavior.predictionBias + (strategy.prediction - 50) / 100 + (gambler ? .35 : 0)
  const threshold = (gambler ? skipValue + coinsToUnits(.1) : mode === 'finalSprint' ? 0 : coinsToUnits(.25))
    + predictionDrive * coinsToUnits(.45)
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
    if (['prizeReroll', 'prizeSwap'].includes(candidates[left].cardId) || ['prizeReroll', 'prizeSwap'].includes(candidates[right].cardId)) continue
    if (candidates[left].cardId !== candidates[right].cardId) variants.push([candidates[left], candidates[right]])
  }
  // The player-facing rule has no per-round card cap. Keep planning bounded, but
  // include a combined multi-card option so Bots can still exploit a full hand.
  const combined = candidates.filter((candidate, index, all) => !['prizeReroll', 'prizeSwap'].includes(candidate.cardId) && all.findIndex((entry) => entry.cardId === candidate.cardId) === index)
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

function planCandidates(observation: BotObservation, difficulty: BotDifficulty, memory: BotMemory): TurnPlan[] {
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
  if (observation.self.identity?.id === 'assassin') {
    // Expert Bots occasionally lean toward one randomly selected human seat. This
    // is deliberately a tiny nudge, never privileged information or a fixed grudge.
    const favouredHumanId = difficulty === 'expert'
      && unitRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:expert-human-pressure`) < .38
      ? choose(observation.humanOpponentIds, `${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:expert-human-target`)
      : undefined
    const targetScore = (targetId: string) => kidnapSuccessChance(observation, targetId)
      * (.7 + memory.strategy.interference / 330)
      + normalRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:${targetId}:kidnap-target`) * .026
      + (targetId === favouredHumanId ? .038 : 0)
    const orderedTargets = [...observation.opponents].sort((left, right) => targetScore(right.id) - targetScore(left.id))
    const lowTargets = orderedTargets.slice(0, 1)
    const broadTargets = orderedTargets.slice(0, observation.kidnapTargetCap)
    const actions: Array<Extract<IdentityAction, { type: 'kidnap' }>> = lowTargets.length ? [{ type: 'kidnap', targetPlayerIds: lowTargets.map((target) => target.id), ransomUnits: observation.kidnapLowRansomUnits }] : []
    if (broadTargets.length > 1) actions.push({ type: 'kidnap', targetPlayerIds: broadTargets.map((target) => target.id), ransomUnits: observation.kidnapHighRansomUnits })
    for (const action of actions.filter((action) => observation.self.balanceUnits >= kidnapActionCost(observation, action))) plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:kidnap:${action.targetPlayerIds?.join('-')}:${action.ransomUnits}`, identityAction: action, specialReason: `发起绑票谈判，锁定 ${action.targetPlayerIds?.length ?? 0} 名潜在得标者。` })))
  }
  if (observation.self.identity?.id === 'thief' && observation.roundIndex < observation.totalRounds - 1) {
    plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:thief`, identityAction: { type: 'thiefSteal' as const }, specialReason: '发动偷卡，争取从其他玩家的未使用库存中夺取机会。' })))
  }
  if (observation.self.identity?.id === 'merchant' && observation.roundIndex < observation.totalRounds - 1 && observation.cardDeckSize > 0 && (observation.self.identity.merchantAuctionCount ?? 0) < observation.merchantAuctionLimit && observation.self.identity.merchantLastAuctionRound !== observation.roundIndex) {
    plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:merchant`, identityAction: { type: 'merchantAuction' as const }, specialReason: '发起下轮道具竞购，争取将循环道具转化为现金。' })))
  }
  if (observation.self.identity?.id === 'lobbyist' && (observation.self.identity.activeSkillUses ?? 0) < observation.lobbyistActivationLimit && observation.roundIndex < observation.totalRounds - 1) {
    const comparator = [...observation.opponents].sort((left, right) => expectedCurrentBid(observation, right.id) - expectedCurrentBid(observation, left.id))[0]
    const targets = [...observation.opponents].sort((left, right) => expectedCurrentBid(observation, right.id) - expectedCurrentBid(observation, left.id)).slice(0, Math.min(3, observation.opponents.length))
    for (const opponent of targets) {
      plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:lobby:${opponent.id}`, identityAction: { type: 'lobbyistContract' as const, targetPlayerId: opponent.id }, specialReason: `向 ${opponent.name} 发布随机任务，争取下轮获得违约收益。` })))
      if (comparator && comparator.id !== opponent.id) {
        const taskType: LobbyistTaskType = expectedCurrentBid(observation, opponent.id) > expectedCurrentBid(observation, comparator.id) * .72 ? 'underbid' : 'outbid'
        plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:lobby:specified:${opponent.id}:${taskType}:${comparator.id}`, identityAction: { type: 'lobbyistContract' as const, targetPlayerId: opponent.id, specified: true, taskType, comparisonPlayerId: comparator.id }, specialReason: `向 ${opponent.name} 发出指定任务，挑选较难完成的比较条件。` })))
      }
    }
  }
  if (observation.self.identity?.id === 'investor' && observation.self.balanceUnits >= coinsToUnits(.5)) {
    const targets = [...observation.opponents].sort((left, right) => kidnapSuccessChance(observation, right.id) - kidnapSuccessChance(observation, left.id)).slice(0, Math.min(4, observation.opponents.length))
    const maxInvestment = Math.min(observation.self.balanceUnits, coinsToUnits(6))
    const amounts = candidateBids(maxInvestment).filter((units) => units > 0 && (units <= coinsToUnits(3) || units % 2 === 0 || units === maxInvestment))
    for (const target of targets) for (const investmentUnits of amounts) plans.push(...plans.filter((plan) => !plan.identityAction).map((plan) => ({ ...plan, id: `${plan.id}:invest:${target.id}:${investmentUnits}`, identityAction: { type: 'invest' as const, targetPlayerId: target.id, investmentUnits }, specialReason: `秘密跟投 ${target.name}，争取按出资比例分享排名奖励。` })))
  }
  // Keep the plan set rich, but bounded: a 10-player spectator game must not spend a turn
  // evaluating the full target-card × identity-action cross product.
  const base = plans.find((plan) => plan.id === 'cards:none')
  const rest = plans.filter((plan) => plan !== base)
  const activeIdentity = observation.self.identity?.id
  // Targeted identities (especially Investor) can create hundreds of legal
  // amount/target combinations. Keep a generous, deterministic slice of their
  // plans before filling the rest of the planning budget, so an identity never
  // disappears merely because a Bot happens to hold many cards.
  const isIdentityPlan = (plan: TurnPlan) => Boolean(plan.identityAction)
  const order = (left: TurnPlan, right: TurnPlan) => hash(`${observation.sessionSeed}:${observation.playerId}:${left.id}`) - hash(`${observation.sessionSeed}:${observation.playerId}:${right.id}`)
  const identityBudget = activeIdentity ? 28 : 0
  const identityPlans = rest.filter(isIdentityPlan).sort(order).slice(0, identityBudget)
  const selectedIdentityIds = new Set(identityPlans.map((plan) => plan.id))
  const otherPlans = rest.filter((plan) => !selectedIdentityIds.has(plan.id)).sort(order).slice(0, Math.max(0, 55 - identityPlans.length))
  const bounded = [...identityPlans, ...otherPlans]
  return base ? [base, ...bounded] : bounded
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

function kidnapActionCost(observation: BotObservation, action?: Extract<IdentityAction, { type: 'kidnap' }>): number {
  if (!action) return 0
  const targetCount = action.targetPlayerIds?.length ?? (action.targetPlayerId ? 1 : 0)
  return Math.max(0, targetCount - 1) * observation.kidnapExtraTargetUnits
    + (action.ransomUnits === observation.kidnapHighRansomUnits ? observation.kidnapHighRansomExtraUnits : 0)
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
    : best.identityAction?.type === 'kidnap' ? kidnapActionCost(observation, best.identityAction)
      : best.identityAction?.type === 'thiefSteal' ? observation.thiefActivationUnits
        : best.identityAction?.type === 'lobbyistContract' ? observation.lobbyistFeeUnits + (best.identityAction.specified ? observation.lobbyistSpecifiedFeeUnits : 0)
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

/** The prophet has two independent channels: one main read (wealth/stars) and
 * up to two identity guesses. Bots only see their own persisted candidate cards. */
export function decideBotProphetAction(observation: BotObservation, memory: BotMemory, channel: 'main' | 'identity' = 'main'): { mode: 'wealth' | 'stars' | 'identity'; targetPlayerId?: string; identityId?: IdentityId } | null {
  if (observation.self.identity?.id !== 'prophet') return null
  const strategy = memory.strategy ?? defaultBotStrategy('adaptive')
  if (channel === 'identity') {
    const targets = observation.opponents.map((opponent) => {
      const progress = observation.prophetIdentityProgress?.[opponent.id]
      const candidates = (observation.prophetIdentityCandidates?.[opponent.id] ?? IDENTITY_IDS).filter((id) => !progress?.excludedIdentityIds.includes(id))
      const estimate = estimateFor(observation, opponent.id)
      const importance = (estimate?.expectedUnits ?? 0) * .08 + expectedCurrentBid(observation, opponent.id) * .12 + candidates.length * -coinsToUnits(.35)
      return { opponent, candidates, solved: Boolean(progress?.solvedIdentityId), importance }
    }).filter((entry) => !entry.solved && entry.candidates.length > 0)
    if (targets.length === 0) return null
    const target = [...targets].sort((left, right) => right.importance - left.importance || left.candidates.length - right.candidates.length || hash(`${observation.sessionSeed}:${observation.playerId}:${left.opponent.id}:prophet-target`) - hash(`${observation.sessionSeed}:${observation.playerId}:${right.opponent.id}:prophet-target`))[0]
    // Every remaining candidate is formally equally possible. The fixed draw merely
    // prevents a prophet from visibly repeating the same alphabetical guess pattern.
    const identityId = choose(target.candidates, `${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:${target.opponent.id}:prophet-guess`)
    return identityId ? { mode: 'identity', targetPlayerId: target.opponent.id, identityId } : null
  }
  if (observation.roundIndex >= observation.totalRounds - 1) return { mode: 'wealth' }
  const roll = unitRandom(`${observation.sessionSeed}:${observation.playerId}:${observation.roundIndex}:prophet:${memory.behavior.quoteFingerprint}`)
  const collectValue = marginalAssetUnits(observation)
  const futureValue = observation.nextItem ? marginalAssetForItem(observation, observation.nextItem) : 0
  const savesForFuture = futureValue > collectValue + coinsToUnits(1.5)
  if (savesForFuture || (strategy.collection >= 62 && observation.roundIndex < observation.totalRounds - 2 && roll < .82)) return { mode: 'stars' }
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

/** Merchant keeps cards that strongly fit its own hand, and auctions the card with
 * the best public demand minus private opportunity cost. */
export function decideBotMerchantOffer(player: Player, offeredCardIds: CardId[], roundIndex: number, sessionSeed: string): CardId | undefined {
  const profile = effectiveProfile(player.controller, player.botMemory)
  const strategy = player.botMemory?.strategy ?? defaultBotStrategy('adaptive')
  const cardValue = (cardId: CardId) => cardId === 'legendaryLoot' ? 12
    : ['red', 'doubleBid', 'reverseRank'].includes(cardId) ? 8
      : ['bananaPeel', 'swap', 'prizeReroll'].includes(cardId) ? 6.5
        : cardId === 'prizeSwap' ? 10
        : cardId === 'fateCoin' ? 5 : 4
  return [...offeredCardIds].sort((left, right) => {
    const score = (cardId: CardId) => {
      const publicDemand = cardValue(cardId) * (.65 + strategy.market / 180 + profile.risk * .12)
      const selfUse = cardValue(cardId) * (.25 + strategy.cards / 170 + (player.cardInventory.includes(cardId) ? .18 : 0))
      const variety = normalRandom(`${sessionSeed}:${player.id}:${roundIndex}:${cardId}:merchant-offer`) * .22
      return publicDemand - selfUse + variety
    }
    return score(right) - score(left) || left.localeCompare(right)
  })[0]
}

export function decideBotTurn(observation: BotObservation, profileId: BotProfileSelection, difficulty: BotDifficulty, memory: BotMemory): BotTurnDecision {
  const profile = profileFromStrategy(profileId, memory.strategy)
  const mode = modeFor(observation, profile, memory)
  const behavior = memory.behavior
  const riskFactor = difficulty === 'easy' ? 1.14 : difficulty === 'expert' ? .91 : 1
  const assetUnits = marginalAssetUnits(observation)
  const reserveUnits = reserveForPlan(observation, profile, mode, behavior, memory.strategy, assetUnits)
  const quoteCache = new Map(observation.opponents.map((opponent) => [opponent.id, opponentQuoteSamples(observation, opponent.id, observation.playerId)]))
  const collectorTarget = observation.self.identity?.id === 'collector' && observation.self.identity.collectorCategory === observation.item?.category
  const categoryItems = observation.item ? observation.self.items.filter((won) => won.item.category === observation.item?.category).length : 0
  const scored: ScoredPlan[] = []
  const identityCost = (action: IdentityAction | undefined): number => action?.type === 'reverserInvert'
    ? observation.reverserActivationUnits * (observation.roundIndex >= observation.totalRounds - 2 ? 2 : 1)
    : action?.type === 'kidnap' ? kidnapActionCost(observation, action)
      : action?.type === 'thiefSteal' ? observation.thiefActivationUnits
        : action?.type === 'lobbyistContract' ? observation.lobbyistFeeUnits + (action.specified ? observation.lobbyistSpecifiedFeeUnits : 0)
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
    if (use.cardId === 'prizeSwap') return total + Math.max(coinsToUnits(1.5), assetUnits * .75)
    if (use.cardId === 'legendaryLoot') return total + coinsToUnits((observation.item?.value ?? 0) * (.72 + profile.collect * .28)) + assetUnits * (1 + profile.collect)
    return total
  }, 0)
  for (const plan of planCandidates(observation, difficulty, memory)) {
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
      // The collectible itself has immediate category value (including the one-item
      // bonus) and can cross a later set threshold, so it is scored separately from V.
      const categorySetValue = assetUnits * (1 + Math.min(1.1, categoryItems * .16) + (collectorTarget ? .45 : 0))
      const expectedReward = estimate.uniqueChance * (valueUnits * rewardMultiplier + categorySetValue * assetWeight)
      const kidnappedTarget = plan.identityAction?.type === 'kidnap' ? (plan.identityAction.targetPlayerIds?.[0] ?? plan.identityAction.targetPlayerId) : undefined
      const kidnapChance = kidnappedTarget ? kidnapSuccessChance(observation, kidnappedTarget) : 0
      const kidnapAssetValue = kidnappedTarget ? marginalAssetUnits(observation) + coinsToUnits((observation.item?.value ?? 0) * .28) : 0
      const kidnapValue = kidnapChance * kidnapAssetValue
      const kidnapRisk = (plan.identityAction?.type === 'kidnap' ? kidnapActionCost(observation, plan.identityAction) : 0) * (1 - kidnapChance)
      const cashRisk = bidUnits * (mode === 'conserve' ? 1.28 : mode === 'finalSprint' ? .78 : 1) * riskFactor + actionCost + kidnapRisk
      const remainingCash = observation.self.balanceUnits - bidUnits - actionCost
      const bankruptcyFloor = coinsToUnits(1.5 + Math.max(0, behavior.bankrollBias) * .8)
      const bankruptcyPenalty = observation.roundIndex < observation.totalRounds - 2 && remainingCash < bankruptcyFloor
        ? (bankruptcyFloor - Math.max(0, remainingCash)) * (1.15 + (1 - profile.risk) * .8)
        : 0
      // A bot does not know anyone else's exact opening balance, but it knows
      // its own snapshot and public cash ranges. Treat a likely minimum
      // commitment as costly unless it is probably being rewarded or is itself
      // genuinely short-stacked (the rule's exemption).
      const estimatedOtherOpeningFloor = Math.min(...observation.balanceEstimates
        .filter((entry) => entry.playerId !== observation.playerId)
        .map((entry) => entry.lowUnits))
      const likelyOpeningLow = observation.selfRoundStartBalanceUnits <= estimatedOtherOpeningFloor + coinsToUnits(.5)
      const estimatedCommitmentFloor = Math.min(...observation.opponents.map((opponent) => Math.max(0, expectedCurrentBid(observation, opponent.id) * .42)))
      const likelyMinimumCommitment = bidUnits <= estimatedCommitmentFloor + 1
      const likelyRewarded = estimate.place <= observation.rewardMultipliers.length && estimate.uniqueChance >= .38
      const nextPassivityFee = (observation.self.passivityFeeCount ?? 0) === 0 ? coinsToUnits(1)
        : (observation.self.passivityFeeCount ?? 0) === 1 ? coinsToUnits(3)
          : coinsToUnits(5)
      const passivityCardRisk = (observation.self.passivityFeeCount ?? 0) >= 2 && observation.self.cardInventory.length > 0 ? coinsToUnits(1.5 + profile.cards) : 0
      const passivityPenalty = likelyMinimumCommitment && !likelyRewarded && !likelyOpeningLow
        ? (nextPassivityFee + passivityCardRisk) * (1.25 + Math.max(0, behavior.reserveBias) * .2)
        : 0
      const categoryMomentum = categoryItems > 0 ? estimate.uniqueChance * coinsToUnits(Math.min(1.6, categoryItems * (.28 + profile.collect * .18))) * (collectorTarget ? 1.6 : 1) : 0
      const boldness = (mode === 'pressure' || mode === 'comeback' || mode === 'finalSprint') ? estimate.firstChance * coinsToUnits(1.25) : 0
      const blockTarget = preferredOpponent(observation, memory)
      const blockValue = blockTarget && rankingBidUnits > (overrides[blockTarget] ?? expectedCurrentBid(observation, blockTarget)) ? coinsToUnits(profile.revenge * 1.4) : 0
      const inversionSetup = plan.identityAction?.type === 'reverserInvert' && estimate.place > 1 ? coinsToUnits((estimate.place - 1) * .4) : 0
      const grudgeKidnapBonus = kidnappedTarget && kidnappedTarget === preferredOpponent(observation, memory) ? coinsToUnits(profile.revenge * .7) * kidnapChance : 0
      const tiePenalty = estimate.tieChance * coinsToUnits(2.2 + Math.max(0, behavior.edgeBias) * .8)
      const fingerprintBonus = ((bidUnits + behavior.quoteFingerprint) % 5 === 0 ? coinsToUnits(.12) : 0) + behavior.edgeBias * Math.min(coinsToUnits(.7), bidUnits * .04)
      const tactic = (_id: IdentityId) => 1
      const investmentValue = plan.identityAction?.type === 'invest' ? (() => {
        const targetId = plan.identityAction.targetPlayerId
        const targetBid = expectedCurrentBid(observation, targetId) + plan.identityAction.investmentUnits
        const targetChance = estimatePlaceAndChance(observation, targetBid, targetId, {}, quoteCache).uniqueChance
        const targetPlace = estimatePlaceAndChance(observation, targetBid, targetId, {}, quoteCache).place
        const share = plan.identityAction.investmentUnits / Math.max(1, targetBid)
        const reward = valueUnits * (observation.rewardMultipliers[targetPlace - 1] ?? 0)
        const categoryUpside = targetPlace === 1 ? assetUnits * (.35 + profile.collect * .35) : 0
        return targetChance * (share * reward * observation.investorDividendMultiplier + share * categoryUpside) * tactic('investor')
      })() : 0
      const reverserFutureValue = plan.identityAction?.type === 'reverserInvert' && effectivePlace === 1
        ? coinsToUnits(.8 + profile.identity * .6)
        : 0
      const thiefOpportunity = observation.cardDeckSize > 0 ? coinsToUnits(.45 + memory.strategy.cards / 220) : coinsToUnits(.18)
      const identityValue = plan.identityAction?.type === 'kidnap' ? kidnapChance * coinsToUnits(2.4 + profile.revenge) * tactic('assassin')
        : plan.identityAction?.type === 'merchantAuction' ? coinsToUnits(.8 + behavior.cardBias * .5) * tactic('merchant')
        : plan.identityAction?.type === 'thiefSteal' ? (coinsToUnits(.6 + behavior.cardBias * .45) + thiefOpportunity) * tactic('thief')
          : plan.identityAction?.type === 'lobbyistContract' ? coinsToUnits(.7 + behavior.antiLeaderBias * .35 + (plan.identityAction.specified ? .8 : 0)) * tactic('lobbyist')
            : plan.identityAction?.type === 'reverserInvert' ? (inversionSetup + reverserFutureValue) * tactic('reverser')
              : investmentValue
      const score = expectedReward - cashRisk - bankruptcyPenalty - passivityPenalty + categoryMomentum + kidnapValue + boldness + blockValue + grudgeKidnapBonus + inversionSetup + taskScore(observation, rankingBidUnits, estimate.place) + cardUtility(plan.cardUses) + identityValue + fingerprintBonus - tiePenalty
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
    const prioritizeItem = memory.strategy.collection >= 48 || profile.collect + behavior.cardBias * .12 >= .42
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
  const prediction = predictionDecision(observation, best.rankingBidUnits, profile, mode, behavior, memory.strategy)
  const intel = observation.intel ? `模糊情报：${observation.opponents.find((opponent) => opponent.id === observation.intel?.playerId)?.name ?? '一名对手'} 的投资约为 ${observation.intel.lowUnits / 2}–${observation.intel.highUnits / 2}。` : undefined
  const predictionText = prediction.playerId ? `预测 ${observation.opponents.find((opponent) => opponent.id === prediction.playerId)?.name ?? '对手'} 的期望收益 ${Math.round(prediction.expectedUnits) / 2}。` : '预测期望不够，选择跳过。'
  const specialText = best.specialReason ? `${best.specialReason}${best.identityAction?.type === 'reverserInvert' ? ` 预计先以第 ${best.place} 名进入获奖区，再倒转为第 ${best.effectivePlace} 名。` : ''}` : identityAction?.type === 'nightwalkerDoubleBid' ? `发动双影下注：先报 ${best.bidUnits / 2}，再保留 ${identityAction.shadowBidUnits / 2} 的夜行影价。` : ''
  const mixedText = !best.specialReason && !identityAction ? ' 在高价值方案中按性格、资金底线与局势做了带权混合，并加入受控的报价波动。' : ''
  const financeText = reserveUnits > 0 ? ` 预留约 ${reserveUnits / 2} 金币周转。` : ''
  const collectionText = collectorTarget ? ' 当前拍品命中收藏类别，已计入即时奖励与套装增量。' : ''
  const passivityText = observation.roundIndex < observation.totalRounds - 1 ? ' 已将观望惩罚风险计入报价。' : ''
  return { bidUnits: best.bidUnits, predictedPlayerId: prediction.playerId, cardUses, identityAction, mode, reason: `${modeLabel(mode)}：估算获奖机会 ${Math.round(best.firstChance * 100)}%，选择 ${best.bidUnits / 2} 金币。${collectionText}${financeText}${specialText}${mixedText}${passivityText}${predictionText}`, intel }
}

export function decideBotIdentity({ choices, player, players, cardOfferIds }: { choices: IdentityId[]; player: Player; players: Player[]; cardOfferIds?: CardId[] }): { identityId: IdentityId; targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId; mode: StrategyMode; reason: string } {
  const controller = player.controller?.kind === 'bot' ? player.controller : undefined
  const profile = effectiveProfile(controller, player.botMemory)
  const strategy = player.botMemory?.strategy ?? strategyForController(player.controller ?? { kind: 'human' })
  const priorityBonus = (id: IdentityId) => {
    const index = strategy.identityPriority.indexOf(id)
    return index < 0 ? 0 : (IDENTITY_IDS.length - index) * .18
  }
  const scores: Record<IdentityId, number> = { prophet: .4 + priorityBonus('prophet'), gambler: profile.risk + priorityBonus('gambler'), assassin: profile.revenge + profile.risk + priorityBonus('assassin'), collector: profile.collect + priorityBonus('collector'), thief: profile.cards + profile.revenge + priorityBonus('thief'), merchant: profile.cards + priorityBonus('merchant'), reverser: profile.risk + priorityBonus('reverser'), lobbyist: profile.identity + profile.revenge + priorityBonus('lobbyist'), nightwalker: profile.risk + profile.identity * .55 + priorityBonus('nightwalker'), investor: profile.collect + profile.risk * .35 + priorityBonus('investor') }
  const identityId = [...choices].sort((left, right) => scores[right] - scores[left] || left.localeCompare(right))[0] ?? choices[0]
  const target = players.filter((entry) => entry.id !== player.id)[hash(`${player.id}:${identityId}`) % Math.max(1, players.length - 1)]
  const categories: AssetCategory[] = ['leisure', 'transport', 'luxury', 'property']
  const collectorCategory = categories.sort((left, right) => (player.items.filter((won) => won.item.category === right).length - player.items.filter((won) => won.item.category === left).length))[0]
  const merchantCardId = cardOfferIds?.sort((left, right) => getCardDefinition(right).description.length - getCardDefinition(left).description.length)[0]
  return { identityId, ...(target && identityId === 'thief' ? { targetPlayerId: target.id } : {}), ...(identityId === 'collector' ? { collectorCategory } : {}), ...(identityId === 'merchant' && merchantCardId ? { merchantCardId } : {}), mode: 'identity', reason: `选择${getIdentityDefinition(identityId).name}以配合当前性格。` }
}

export function decideBotMerchantBid(player: Player, cardId: CardId): { bidUnits: number; mode: StrategyMode; reason: string } {
  const profile = effectiveProfile(player.controller, player.botMemory)
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

/** Chooses asset-auction quotes as a budgeted collection decision, not a blind
 * "minimum price plus random" bid. A high reserve price is ignored unless the
 * item can realistically improve this bot's end-game collection. */
export function decideBotAssetAuctionBids({ player, lots, budgetUnits, roundIndex, totalRounds, sessionSeed, observation }: {
  player: Player
  lots: AssetAuctionLot[]
  budgetUnits: number
  roundIndex: number
  totalRounds: number
  sessionSeed: string
  /** Public category history lets a Bot recognise that a category is heating up. */
  observation?: Pick<BotObservation, 'publicRounds' | 'balanceEstimates'>
}): Array<{ lotId: string; bidUnits: number }> {
  const controller = player.controller?.kind === 'bot' ? player.controller : undefined
  const profile = effectiveProfile(controller, player.botMemory)
  const behavior = player.botMemory?.behavior ?? createBotBehavior(`${sessionSeed}:${player.id}`)
  const strategy = player.botMemory?.strategy ?? defaultBotStrategy('adaptive')
  const collectorCategory = player.identity?.id === 'collector' ? player.identity.collectorCategory : undefined
  const beforeAssets = calculateFixedAssets(player.items, collectorCategory).reduce((total, entry) => total + entry.units, 0)
  const categoryHeat = (category: AssetCategory) => {
    const rounds = observation?.publicRounds.filter((round) => round.itemCategory === category) ?? []
    const distinctWinners = new Set(rounds.map((round) => round.winnerId).filter(Boolean)).size
    const contested = rounds.filter((round) => round.tiedPlayerIds.length > 0 || round.totalBidUnits >= coinsToUnits(12)).length
    return Math.min(4, rounds.length * .42 + distinctWinners * .36 + contested * .32)
  }
  const candidates = lots
    .filter((lot) => lot.sellerId !== player.id)
    .map((lot) => {
      const afterAssets = calculateFixedAssets([...player.items, { item: lot.item, roundIndex }], collectorCategory).reduce((total, entry) => total + entry.units, 0)
      const assetGain = Math.max(0, afterAssets - beforeAssets)
      const matchingItems = player.items.filter((won) => won.item.category === lot.item.category).length
      const collectorMatch = collectorCategory === lot.item.category
      const marketHeat = categoryHeat(lot.item.category)
      const baseValue = coinsToUnits(.9 + lot.item.value * .36)
      const currentSetCount = matchingItems + (collectorMatch ? 1 : 0)
      const setJumpUnits = coinsToUnits(Math.max(0, fixedAssetCoins(lot.item.category, currentSetCount + 1) - fixedAssetCoins(lot.item.category, currentSetCount)))
      // Fixed assets settle only at game end, but a real set jump is still close
      // to cash in the final standings. Earlier versions discounted it so hard
      // that Bots routinely donated 12–30 coin jumps for a token reserve.
      const collectionWeight = .78 + profile.collect * .3 + strategy.collection / 550 + Math.max(0, behavior.assetFocusBias) * .18 + (collectorMatch ? .25 : 0)
      const collectionPremium = assetGain * collectionWeight + setJumpUnits * (.28 + profile.collect * .2) + coinsToUnits(matchingItems * (.55 + profile.collect * .35) + (collectorMatch ? 1.5 : 0))
      const endGameWeight = roundIndex >= totalRounds - 2 ? 1.12 : 1
      const fairValue = Math.round((baseValue + collectionPremium + coinsToUnits(marketHeat * .45)) * endGameWeight)
      const maxBid = Math.max(0, Math.round(fairValue * (0.86 + profile.risk * .12 + Math.max(0, behavior.riskBias) * .06)))
      const moonshotPotential = matchingItems * 1.15 + (collectorMatch ? 2.5 : 0) + marketHeat + assetGain / coinsToUnits(8) + lot.item.value / 18
      return { lot, assetGain, matchingItems, marketHeat, fairValue, maxBid, moonshotPotential, urgency: fairValue - lot.minimumBidUnits }
    })
    .sort((left, right) => right.urgency - left.urgency || right.assetGain - left.assetGain || left.lot.id.localeCompare(right.lot.id))

  // A rare "this category is about to break out" purchase is intentional. It is
  // limited to one lot, only when the category has real personal/public signals,
  // and remains part of the Bot's fixed per-game temperament.
  const moonshotPool = candidates.filter((candidate) => candidate.moonshotPotential >= 1.7)
  const moonshotChance = clamp(.018 + strategy.market / 2500 + Math.max(0, behavior.riskBias) * .035 + Math.max(0, profile.risk - .45) * .045 + Math.max(0, behavior.assetFocusBias) * .025, .018, .14)
  const moonshotCandidate = unitRandom(`${sessionSeed}:${player.id}:${roundIndex}:asset-moonshot`) < moonshotChance
    ? choose([...moonshotPool].sort((left, right) => right.moonshotPotential + unitRandom(`${sessionSeed}:${player.id}:${right.lot.id}:moonshot-order`) * .18 - (left.moonshotPotential + unitRandom(`${sessionSeed}:${player.id}:${left.lot.id}:moonshot-order`) * .18)), `${sessionSeed}:${player.id}:${roundIndex}:asset-moonshot-pick`)
    : undefined

  let remaining = Math.max(0, budgetUnits)
  const bidByLotId = new Map<string, number>()
  for (const candidate of candidates) {
    const { lot, matchingItems } = candidate
    const moonshot = moonshotCandidate?.lot.id === lot.id
    const moonshotBoost = moonshot
      ? coinsToUnits(2.5 + lot.item.value * .45 + candidate.marketHeat * .8 + Math.max(0, behavior.riskBias) * 2)
      : 0
    const maxBid = candidate.maxBid + moonshotBoost
    // Never chase a reserve price that already exceeds the item's personalised
    // value. Only a genuine category/collector payoff can cross this line.
    if (lot.minimumBidUnits > maxBid || remaining < lot.minimumBidUnits) {
      bidByLotId.set(lot.id, 0)
      continue
    }
    const room = Math.min(remaining, maxBid) - lot.minimumBidUnits
    const fingerprint = unitRandom(`${sessionSeed}:${player.id}:${roundIndex}:${lot.id}:asset-auction`)
    const categoryPush = matchingItems > 0 ? .22 : 0
    const desired = lot.minimumBidUnits + Math.max(0, Math.round(room * (moonshot ? .72 + fingerprint * .22 : .18 + categoryPush + fingerprint * .34)))
    const bidUnits = Math.max(lot.minimumBidUnits, Math.min(remaining, maxBid, desired))
    // A tiny asymmetry helps Bots avoid mechanically tying exactly at reserve.
    const offset = (behavior.quoteFingerprint + hash(lot.id)) % 3 === 0 && bidUnits < Math.min(remaining, maxBid) ? 1 : 0
    const finalBid = Math.min(remaining, maxBid, bidUnits + offset)
    bidByLotId.set(lot.id, finalBid)
    remaining -= finalBid
  }
  return lots.map((lot) => ({ lotId: lot.id, bidUnits: lot.sellerId === player.id ? 0 : bidByLotId.get(lot.id) ?? 0 }))
}

/**
 * Rebuilds only the collection facts that every player can see in completed
 * round recaps. This deliberately excludes inventories, identities and hidden
 * transfers, while still letting a seller notice a rival sitting one item away
 * from a public set-bonus breakpoint.
 */
function publicCategoryCounts(rounds: PublicRoundObservation[]): Map<string, Map<AssetCategory, number>> {
  const counts = new Map<string, Map<AssetCategory, number>>()
  const adjust = (playerId: string, category: AssetCategory, delta: number) => {
    const byCategory = counts.get(playerId) ?? new Map<AssetCategory, number>()
    byCategory.set(category, Math.max(0, (byCategory.get(category) ?? 0) + delta))
    counts.set(playerId, byCategory)
  }
  for (const round of rounds) {
    for (const transfer of round.assetAuctionResults ?? []) {
      if (!transfer.winnerId) continue
      adjust(transfer.sellerId, transfer.itemCategory, -1)
      adjust(transfer.winnerId, transfer.itemCategory, 1)
    }
    const ownerId = round.itemWinnerId ?? round.winnerId
    if (ownerId) adjust(ownerId, round.itemCategory, 1)
  }
  return counts
}

/**
 * A seller Bot only lists an item when the expected reserve can compensate for
 * its own collection loss and does not hand a large, cheap set bonus to a
 * visible rival. Category-win history is public, so this stays within the
 * same information boundary as the rest of Bot planning.
 */
export function decideBotAssetAuctionOffer({ player, observation, roundIndex, totalRounds, sessionSeed }: {
  player: Player
  observation: BotObservation
  roundIndex: number
  totalRounds: number
  sessionSeed: string
}): { itemId: string; itemRoundIndex: number; minimumBidUnits: number } | undefined {
  if (roundIndex >= totalRounds - 1 || player.items.length === 0) return undefined
  const controller = player.controller?.kind === 'bot' ? player.controller : undefined
  const profile = effectiveProfile(controller, player.botMemory)
  const behavior = player.botMemory?.behavior ?? createBotBehavior(`${sessionSeed}:${player.id}`)
  const strategy = player.botMemory?.strategy ?? defaultBotStrategy('adaptive')
  const collectorCategory = player.identity?.id === 'collector' ? player.identity.collectorCategory : undefined
  const beforeAssets = calculateFixedAssets(player.items, collectorCategory).reduce((total, entry) => total + entry.units, 0)
  const visibleCollections = publicCategoryCounts(observation.publicRounds)
  const reserveFloor = Math.round(player.balanceUnits * (.12 + Math.max(0, behavior.reserveBias) * .08))
  const sellMood = clamp(.08 + strategy.market / 320 + Math.max(0, behavior.assetMarketBias) * .24 + profile.risk * .05, .08, .48)
  const candidates = player.items.map((won, index) => {
    const remainingItems = player.items.filter((_, itemIndex) => itemIndex !== index)
    const afterAssets = calculateFixedAssets(remainingItems, collectorCategory).reduce((total, entry) => total + entry.units, 0)
    const ownLossUnits = Math.max(0, beforeAssets - afterAssets)
    const ownCategoryCount = player.items.filter((entry) => entry.item.category === won.item.category).length
    const publicRivalWins = observation.publicRounds.filter((round) => round.itemCategory === won.item.category && (round.itemWinnerId ?? round.winnerId) && (round.itemWinnerId ?? round.winnerId) !== player.id).length
    const categoryHeat = observation.publicRounds.filter((round) => round.itemCategory === won.item.category).length
    const likelyBuyerCount = observation.balanceEstimates.filter((estimate) => estimate.playerId !== player.id && estimate.expectedUnits >= reserveFloor).length
    const rivalBreakpoints = observation.opponents.map((opponent) => {
      const count = visibleCollections.get(opponent.id)?.get(won.item.category) ?? 0
      const setGainCoins = Math.max(0, fixedAssetCoins(won.item.category, count + 1) - fixedAssetCoins(won.item.category, count))
      return { playerId: opponent.id, count, gainUnits: coinsToUnits(setGainCoins + itemFixedAssetCoins(won.item.value)) }
    }).filter((entry) => entry.count > 0)
    const largestRivalGainUnits = Math.max(0, ...rivalBreakpoints.map((entry) => entry.gainUnits))
    const breakpointBuyerCount = rivalBreakpoints.filter((entry) => entry.gainUnits >= coinsToUnits(10)).length
    const rivalSetPressure = publicRivalWins * (1.1 + profile.collect * .35) + breakpointBuyerCount * 2.4 + Math.max(0, likelyBuyerCount - 1) * .35
    const denyWeight = .45 + profile.revenge * .34 + (controller?.profileId === 'blocker' ? .3 : 0) + Math.max(0, behavior.antiLeaderBias) * .16
    const demandWeight = publicRivalWins * (1.2 + profile.risk * .25) + categoryHeat * .26 + likelyBuyerCount * .25
    const selfNeed = ownLossUnits + coinsToUnits(ownCategoryCount * (.35 + profile.collect * .24)) + (collectorCategory === won.item.category ? coinsToUnits(8) : 0)
    const baseReserve = ownLossUnits + coinsToUnits(Math.max(1, .5 + won.item.value * .18))
    const premium = coinsToUnits(Math.max(0, demandWeight * (.7 + Math.max(0, behavior.edgeBias) * .35) + Math.max(0, behavior.assetMarketBias) * .35))
    const protectionWeight = .62 + profile.revenge * .16 + profile.collect * .12 + (controller?.profileId === 'blocker' ? .12 : 0) + Math.max(0, behavior.antiLeaderBias) * .1
    const antiGiftFloor = largestRivalGainUnits > 0 ? Math.round(largestRivalGainUnits * protectionWeight) : 0
    const minimumBidUnits = Math.max(2, Math.ceil(Math.max(baseReserve + premium, antiGiftFloor) / 2) * 2)
    const timing = roundIndex >= totalRounds - 2 ? -.8 : .35
    const proactiveSale = unitRandom(`${sessionSeed}:${player.id}:${roundIndex}:${won.item.id}:${won.roundIndex}:seller-mood`) < sellMood
    const variance = normalRandom(`${sessionSeed}:${player.id}:${won.item.id}:${won.roundIndex}:seller`) * 1.05
    const score = demandWeight * 1.35 + (minimumBidUnits - ownLossUnits) * .34 + timing + variance + (proactiveSale ? 1.15 + Math.max(0, behavior.assetMarketBias) * 1.35 : 0) - selfNeed * .18 - rivalSetPressure * denyWeight - largestRivalGainUnits * (.14 + denyWeight * .12)
    return { won, ownLossUnits, publicRivalWins, largestRivalGainUnits, breakpointBuyerCount, proactiveSale, minimumBidUnits, score }
  }).filter((candidate) => {
    // A collector keeps its chosen category unless an explicit future rule says
    // otherwise; selling it cheaply is almost always a strategic own goal.
    if (collectorCategory === candidate.won.item.category) return false
    // If a public rival is one purchase from a large set jump, selling is only
    // allowed when the reserve captures most of that gain. Otherwise the bot
    // keeps the item and denies the easy comeback route.
    if (candidate.largestRivalGainUnits >= coinsToUnits(10) && candidate.minimumBidUnits < Math.round(candidate.largestRivalGainUnits * .58)) return false
    return candidate.minimumBidUnits > candidate.ownLossUnits && (candidate.publicRivalWins > 0 || candidate.proactiveSale)
  }).sort((left, right) => right.score - left.score || left.won.item.id.localeCompare(right.won.item.id))
  const best = candidates[0]
  if (!best || best.score < .6 + Math.max(0, behavior.reserveBias) * .8 - Math.max(0, behavior.assetMarketBias) * .65) return undefined
  return { itemId: best.won.item.id, itemRoundIndex: best.won.roundIndex, minimumBidUnits: best.minimumBidUnits }
}

/** Decides whether a captured Bot pays to keep its item during public talks. */
export function decideBotKidnapResponse({ player, item, ransomUnits, roundIndex, totalRounds, sessionSeed }: {
  player: Player
  item: Item
  ransomUnits: number
  roundIndex: number
  totalRounds: number
  sessionSeed: string
}): boolean {
  if (player.balanceUnits < ransomUnits) return false
  const profile = effectiveProfile(player.controller, player.botMemory)
  const behavior = player.botMemory?.behavior ?? createBotBehavior(`${sessionSeed}:${player.id}`)
  const collectorCategory = player.identity?.id === 'collector' ? player.identity.collectorCategory : undefined
  const beforeAssets = calculateFixedAssets(player.items, collectorCategory).reduce((total, entry) => total + entry.units, 0)
  const itemIndex = player.items.findIndex((won) => won.item.id === item.id && won.roundIndex === roundIndex)
  const withoutItem = itemIndex >= 0 ? player.items.filter((_, index) => index !== itemIndex) : player.items.filter((won) => won.item.id !== item.id)
  const afterAssets = calculateFixedAssets(withoutItem, collectorCategory).reduce((total, entry) => total + entry.units, 0)
  const assetLossUnits = Math.max(0, beforeAssets - afterAssets)
  const collectorCashUnits = player.identity?.id === 'collector' && player.identity.collectorCategory === item.category ? coinsToUnits(5) : 0
  const remainingCash = player.balanceUnits - ransomUnits
  const roundsLeft = Math.max(0, totalRounds - roundIndex - 1)
  const cashFloor = coinsToUnits(2 + roundsLeft * (1.2 + Math.max(0, behavior.reserveBias)))
  const itemUrgency = coinsToUnits(item.value * (.18 + profile.collect * .12)) + assetLossUnits * (.72 + profile.collect * .32) + collectorCashUnits + Math.max(0, behavior.assetFocusBias) * coinsToUnits(.45)
  const cashStress = Math.max(0, cashFloor - remainingCash) * (1.05 - profile.risk * .28)
  const lateGameWeight = roundIndex >= totalRounds - 2 ? 1.2 : 1
  // Paying ransom is a personality decision around an economic threshold. The
  // variation is seeded, so it differs between games but never changes on refresh.
  const keepBias = (profile.collect - .45 + Math.max(0, behavior.assetFocusBias) * .28 - Math.max(0, behavior.assetMarketBias) * .22) * coinsToUnits(1.2)
  const variation = normalRandom(`${sessionSeed}:${player.id}:${item.id}:${roundIndex}:kidnap-response`) * coinsToUnits(1.35)
  return itemUrgency * lateGameWeight + keepBias + variation >= ransomUnits + cashStress
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
