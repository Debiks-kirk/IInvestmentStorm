import { calculateFixedAssets } from './assets'
import { getCardDefinition } from './cards'
import { coinsToUnits } from './engine'
import { getIdentityDefinition } from './identities'
import type { AssetCategory, BotDifficulty, BotMemory, BotProfileId, CardId, CardUse, GameSession, IdentityAction, IdentityId, Player, StrategyMode } from './types'

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

export function emptyBotMemory(): BotMemory {
  return { grudgeByPlayerId: {}, lastMode: null, decisionLog: [] }
}

export function isBot(player: Player | undefined): boolean {
  return player?.controller?.kind === 'bot'
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  return result >>> 0
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
  playerId: string
  roundIndex: number
  totalRounds: number
  initialCoins: number
  rewardMultipliers: number[]
  correctPredictionMultiplier: number
  wrongPredictionMultiplier: number
  item: GameSession['itemDeck'][number] | null
  self: Pick<Player, 'id' | 'name' | 'balanceUnits' | 'items' | 'cardInventory' | 'identity'>
  opponents: Array<{ id: string; name: string }>
  previousSubmitterIds: string[]
  publicRounds: PublicRoundObservation[]
  balanceEstimates: CashEstimate[]
  cardDeckSize: number
  activeTask?: { type: 'outbid' | 'underbid' | 'avoidPrize' | 'winFirst'; comparisonPlayerId?: string }
  nextItem?: GameSession['itemDeck'][number]
  intel?: { playerId: string; lowUnits: number; highUnits: number }
  legalPeek?: { playerId: string; bidUnits: number }
}

/** Only this adapter sees the full session. The returned payload excludes opponent secrets. */
export function buildBotObservation(session: GameSession, playerId: string): BotObservation {
  const player = session.players.find((entry) => entry.id === playerId) as Player
  const prior = session.turns.map((turn) => turn.playerId).filter((id) => id !== playerId)
  const observation: BotObservation = {
    playerId,
    roundIndex: session.roundIndex,
    totalRounds: session.settings.rounds,
    initialCoins: session.settings.initialCoins,
    rewardMultipliers: [...session.settings.rewardMultipliers],
    correctPredictionMultiplier: session.settings.correctPredictionMultiplier,
    wrongPredictionMultiplier: session.settings.wrongPredictionMultiplier,
    item: session.itemDeck[session.roundIndex] ?? null,
    self: { id: player.id, name: player.name, balanceUnits: player.balanceUnits, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined },
    opponents: session.players.filter((entry) => entry.id !== playerId).map((entry) => ({ id: entry.id, name: entry.name })),
    previousSubmitterIds: prior,
    publicRounds: session.results.map((result) => ({ winnerId: result.winnerId, totalBidUnits: result.totalBidUnits, minWinningBidUnits: result.minWinningBidUnits, tiedPlayerIds: [...result.tiedPlayerIds], itemCategory: result.item.category, rankings: result.rankings.map((entry) => ({ playerId: entry.playerId, place: entry.place, rewardUnits: entry.publicRewardUnits })), publicDeltaByPlayerId: Object.fromEntries(result.deltas.map((delta) => [delta.playerId, delta.publicDeltaUnits])) })),
    balanceEstimates: [],
    cardDeckSize: session.cardDeck.length,
    activeTask: session.identityContracts.find((contract) => contract.targetPlayerId === playerId && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex) ? (() => { const contract = session.identityContracts.find((entry) => entry.targetPlayerId === playerId && entry.status === 'pending' && entry.executeRoundIndex === session.roundIndex)!; return { type: contract.taskType, comparisonPlayerId: contract.comparisonPlayerId } })() : undefined,
    nextItem: player.identity?.id === 'prophet' ? session.itemDeck[session.roundIndex + 1] : undefined,
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
  if (remaining <= 1) return 'finalSprint'
  if (observation.self.balanceUnits < estimatedAverage * .62) return 'comeback'
  if (observation.self.balanceUnits > estimatedAverage * 1.45 && profile.risk < .7) return 'conserve'
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
  if (!observation.item) return 0
  const category = observation.item.category
  const before = calculateFixedAssets(observation.self.items).find((entry) => entry.category === category)?.units ?? 0
  const after = calculateFixedAssets([...observation.self.items, { item: observation.item, roundIndex: observation.roundIndex }]).find((entry) => entry.category === category)?.units ?? 0
  return Math.max(0, after - before)
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
  return Math.max(coinsToUnits(.5), Math.min(estimate?.highUnits ?? itemPressure, (estimate?.expectedBidUnits ?? itemPressure) * .58 + itemPressure * .42))
}

function estimatePlaceAndChance(observation: BotObservation, rankingBidUnits: number, selfId: string): { place: number; uniqueChance: number; firstChance: number } {
  let expectedAbove = 0
  let uniqueChance = 1
  let firstChance = 1
  for (const opponent of observation.opponents) {
    if (opponent.id === selfId) continue
    const rivalBid = expectedCurrentBid(observation, opponent.id)
    const difference = rankingBidUnits - rivalBid
    const rivalAbove = sigmoid((-difference) / coinsToUnits(1.8))
    expectedAbove += rivalAbove
    firstChance *= 1 - rivalAbove
    uniqueChance *= 1 - Math.exp(-Math.abs(difference) / coinsToUnits(1.25)) * .24
  }
  return { place: Math.max(1, Math.min(observation.rewardMultipliers.length + 1, 1 + Math.round(expectedAbove))), uniqueChance: Math.max(.12, uniqueChance), firstChance: Math.max(.01, firstChance * uniqueChance) }
}

function candidateBids(observation: BotObservation, mode: StrategyMode, rankingMultiplier: number): number[] {
  const budget = observation.self.balanceUnits
  const values = new Set<number>([0, coinsToUnits(.5), coinsToUnits(1), coinsToUnits(2), coinsToUnits(4), coinsToUnits(6), coinsToUnits(8)])
  for (const opponent of observation.opponents) {
    const bid = expectedCurrentBid(observation, opponent.id) / Math.max(1, rankingMultiplier)
    for (const shift of [-2, -1, 0, 1, 2, 4]) values.add(Math.max(0, Math.round(bid + coinsToUnits(shift / 2))))
  }
  if (mode === 'comeback' || mode === 'finalSprint' || mode === 'pressure') values.add(budget)
  if (observation.activeTask?.type === 'avoidPrize') values.add(coinsToUnits(.5))
  return [...values].filter((value) => value <= budget).sort((left, right) => left - right)
}

function taskScore(observation: BotObservation, bidUnits: number, place: number): number {
  const task = observation.activeTask
  if (!task) return 0
  if (task.type === 'avoidPrize') return place > observation.rewardMultipliers.length ? coinsToUnits(3) : -coinsToUnits(3)
  if (task.type === 'winFirst') return place === 1 ? coinsToUnits(3) : -coinsToUnits(3)
  if (!task.comparisonPlayerId) return 0
  const targetBid = expectedCurrentBid(observation, task.comparisonPlayerId)
  if (task.type === 'outbid') return bidUnits > targetBid ? coinsToUnits(3) : -coinsToUnits(3)
  return bidUnits < targetBid ? coinsToUnits(3) : -coinsToUnits(3)
}

function predictionDecision(observation: BotObservation, ownRankingBidUnits: number, profile: BotProfile, mode: StrategyMode): { playerId: string | null; expectedUnits: number } {
  const valueUnits = coinsToUnits(observation.item?.value ?? 0)
  const gambler = observation.self.identity?.id === 'gambler'
  const wrongPenalty = valueUnits * (gambler ? .5 : observation.wrongPredictionMultiplier)
  const skipValue = gambler ? -valueUnits * .5 : 0
  let best = { playerId: null as string | null, expectedUnits: skipValue }
  for (const opponent of observation.opponents) {
    const targetBid = expectedCurrentBid(observation, opponent.id)
    const targetChance = estimatePlaceAndChance(observation, targetBid, opponent.id).firstChance
    const ownBlocks = 1 - sigmoid((targetBid - ownRankingBidUnits) / coinsToUnits(1.8))
    const probability = Math.max(.01, targetChance * ownBlocks)
    const estimate = estimateFor(observation, opponent.id)
    const available = Math.max(0, (estimate?.expectedUnits ?? 0) - targetBid + valueUnits * (observation.rewardMultipliers[0] ?? 0))
    const otherGuessers = 1 + Math.max(0, observation.opponents.length - 2) * (.2 + profile.risk * .12)
    const payout = Math.min(valueUnits * observation.correctPredictionMultiplier, available) / otherGuessers
    const expectedUnits = probability * payout - (1 - probability) * wrongPenalty
    if (expectedUnits > best.expectedUnits) best = { playerId: opponent.id, expectedUnits }
  }
  const threshold = gambler ? skipValue + coinsToUnits(.1) : mode === 'finalSprint' ? 0 : coinsToUnits(.25)
  return best.expectedUnits > threshold ? best : { playerId: null, expectedUnits: skipValue }
}

function selectCards(observation: BotObservation, mode: StrategyMode, memory: BotMemory): CardUse[] {
  const cards = observation.self.cardInventory
  const uses: CardUse[] = []
  const opponentId = preferredOpponent(observation, memory) ?? observation.opponents[0]?.id
  const previousId = observation.previousSubmitterIds[0]
  const itemValue = observation.item?.value ?? 0
  const push = (cardId: CardId, targetPlayerId?: string) => { if (cards.includes(cardId) && uses.length < 2 && !uses.some((use) => use.cardId === cardId)) uses.push({ cardId, ...(targetPlayerId ? { targetPlayerId } : {}) }) }
  if (mode === 'cards' || mode === 'pressure' || mode === 'finalSprint') {
    if (itemValue >= 8) push('red')
    if (opponentId) push('swap', opponentId)
    push('doubleBid')
    push('reverseRank')
  }
  if (mode === 'conserve') push('redistribute')
  if (mode === 'revenge' && opponentId) push('swap', opponentId)
  if (mode === 'value' && previousId) push('peek', previousId)
  if (mode === 'comeback' || mode === 'finalSprint') push('fateCoin')
  return uses.slice(0, 2)
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

export function decideBotTurn(observation: BotObservation, profileId: BotProfileId, difficulty: BotDifficulty, memory: BotMemory): BotTurnDecision {
  const profile = botProfile(profileId)
  const mode = modeFor(observation, profile, memory)
  const riskFactor = difficulty === 'easy' ? 1.14 : difficulty === 'expert' ? .91 : 1
  const cardUses = selectCards(observation, mode, memory).map((use) => use.cardId === 'fateCoin' ? { ...use, coinResult: hash(`${observation.playerId}:${observation.roundIndex}:coin`) % 2 === 0 ? 'heads' as const : 'tails' as const } : use)
  const rankingMultiplier = cardUses.some((use) => use.cardId === 'doubleBid') ? 2 : 1
  const valueMultiplier = cardUses.some((use) => use.cardId === 'red') ? 2 : cardUses.some((use) => use.cardId === 'black') ? .5 : 1
  const valueUnits = coinsToUnits(observation.item?.value ?? 0) * valueMultiplier
  const assetUnits = marginalAssetUnits(observation)
  const reserveUnits = mode === 'conserve' ? coinsToUnits(5) : mode === 'finalSprint' ? 0 : coinsToUnits(1)
  let best = { bidUnits: 0, score: Number.NEGATIVE_INFINITY, place: observation.rewardMultipliers.length + 1, firstChance: 0 }
  for (const bidUnits of candidateBids(observation, mode, rankingMultiplier)) {
    if (bidUnits > Math.max(0, observation.self.balanceUnits - reserveUnits) && mode === 'conserve') continue
    const estimate = estimatePlaceAndChance(observation, bidUnits * rankingMultiplier, observation.playerId)
    const rewardMultiplier = observation.rewardMultipliers[estimate.place - 1] ?? 0
    const expectedReward = estimate.uniqueChance * (valueUnits * rewardMultiplier + assetUnits * (mode === 'collect' ? 1 : .55))
    const cashRisk = bidUnits * (mode === 'conserve' ? 1.28 : mode === 'finalSprint' ? .78 : 1) * riskFactor
    const boldness = (mode === 'pressure' || mode === 'comeback' || mode === 'finalSprint') ? estimate.firstChance * coinsToUnits(1.25) : 0
    const blockTarget = preferredOpponent(observation, memory)
    const blockValue = blockTarget && bidUnits * rankingMultiplier > expectedCurrentBid(observation, blockTarget) ? coinsToUnits(profile.revenge * 1.4) : 0
    const score = expectedReward - cashRisk + boldness + blockValue + taskScore(observation, bidUnits, estimate.place)
    if (score > best.score || (score === best.score && bidUnits < best.bidUnits)) best = { bidUnits, score, place: estimate.place, firstChance: estimate.firstChance }
  }
  const bidUnits = best.bidUnits
  const prediction = predictionDecision(observation, bidUnits * rankingMultiplier, profile, mode)
  const target = preferredOpponent(observation, memory) ?? observation.publicRounds.at(-1)?.winnerId ?? observation.opponents[0]?.id ?? null
  const identity = observation.self.identity
  let identityAction: IdentityAction | undefined
  const reverserCost = coinsToUnits((observation.roundIndex >= observation.totalRounds - 2 ? 2 : 1) * 6)
  const invertedPlace = best.place <= observation.rewardMultipliers.length ? observation.rewardMultipliers.length - best.place + 1 : best.place
  const inversionGain = valueUnits * ((observation.rewardMultipliers[invertedPlace - 1] ?? 0) - (observation.rewardMultipliers[best.place - 1] ?? 0))
  if (identity?.id === 'reverser' && best.place <= observation.rewardMultipliers.length && inversionGain > reverserCost && observation.self.balanceUnits >= bidUnits + reverserCost) identityAction = { type: 'reverserInvert' }
  if (identity?.id === 'merchant' && !identity.merchantAuctionUsed && observation.cardDeckSize > 0 && (mode === 'cards' || mode === 'finalSprint')) identityAction = { type: 'merchantAuction' }
  if (identity?.id === 'lobbyist' && observation.roundIndex < observation.totalRounds - 1 && target) identityAction = { type: 'lobbyistContract', targetPlayerId: target }
  const intel = observation.intel ? `模糊情报：${observation.opponents.find((opponent) => opponent.id === observation.intel?.playerId)?.name ?? '一名对手'} 的投资约为 ${observation.intel.lowUnits / 2}–${observation.intel.highUnits / 2}。` : undefined
  const predictionText = prediction.playerId ? `预测 ${observation.opponents.find((opponent) => opponent.id === prediction.playerId)?.name ?? '对手'} 的期望收益 ${Math.round(prediction.expectedUnits) / 2}。` : '预测期望不够，选择跳过。'
  return { bidUnits, predictedPlayerId: prediction.playerId, cardUses, identityAction, mode, reason: `${modeLabel(mode)}：估算获奖机会 ${Math.round(best.firstChance * 100)}%，选择 ${bidUnits / 2} 金币。${predictionText}`, intel }
}

export function decideBotIdentity({ choices, player, players, cardOfferIds }: { choices: IdentityId[]; player: Player; players: Player[]; cardOfferIds?: CardId[] }): { identityId: IdentityId; targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId; mode: StrategyMode; reason: string } {
  const controller = player.controller?.kind === 'bot' ? player.controller : { profileId: 'adaptive' as BotProfileId }
  const profile = botProfile(controller.profileId)
  const scores: Record<IdentityId, number> = { prophet: .4, gambler: profile.risk, assassin: profile.revenge + profile.risk, collector: profile.collect, thief: profile.cards + profile.revenge, merchant: profile.cards, reverser: profile.risk, lobbyist: profile.identity + profile.revenge }
  const identityId = [...choices].sort((left, right) => scores[right] - scores[left] || left.localeCompare(right))[0] ?? choices[0]
  const target = players.filter((entry) => entry.id !== player.id)[hash(`${player.id}:${identityId}`) % Math.max(1, players.length - 1)]
  const categories: AssetCategory[] = ['leisure', 'transport', 'luxury', 'property']
  const collectorCategory = categories.sort((left, right) => (player.items.filter((won) => won.item.category === right).length - player.items.filter((won) => won.item.category === left).length))[0]
  const merchantCardId = cardOfferIds?.sort((left, right) => getCardDefinition(right).description.length - getCardDefinition(left).description.length)[0]
  return { identityId, ...(target && (identityId === 'assassin' || identityId === 'thief') ? { targetPlayerId: target.id } : {}), ...(identityId === 'collector' ? { collectorCategory } : {}), ...(identityId === 'merchant' && merchantCardId ? { merchantCardId } : {}), mode: 'identity', reason: `选择${getIdentityDefinition(identityId).name}以配合当前性格。` }
}

export function decideBotMerchantBid(player: Player, cardId: CardId): { bidUnits: number; mode: StrategyMode; reason: string } {
  const profile = player.controller?.kind === 'bot' ? botProfile(player.controller.profileId) : botProfile('adaptive')
  const value = cardId === 'red' || cardId === 'doubleBid' || cardId === 'reverseRank' ? 7 : cardId === 'fateCoin' ? 3 : 4
  const budget = Math.min(player.balanceUnits, coinsToUnits(value * (.55 + profile.cards * .35)))
  return { bidUnits: Math.max(0, budget), mode: 'cards', reason: '按道具的后续收益和当前现金决定报价。' }
}

export function modeLabel(mode: StrategyMode): string {
  return ({ value: '价值竞拍', conserve: '保守蓄力', collect: '收藏冲刺', pressure: '强势施压', revenge: '复仇阻击', cards: '道具组合', identity: '身份经营', comeback: '逆风追赶', finalSprint: '终局冲刺' })[mode]
}

export function appendBotRecord(player: Player, record: BotMemory['decisionLog'][number]): Player {
  const memory = player.botMemory ?? emptyBotMemory()
  return { ...player, botMemory: { ...memory, lastMode: record.mode, decisionLog: [...memory.decisionLog, record].slice(-80) } }
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
