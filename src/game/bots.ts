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
}

export interface BotObservation {
  playerId: string
  roundIndex: number
  totalRounds: number
  item: GameSession['itemDeck'][number] | null
  self: Pick<Player, 'id' | 'name' | 'balanceUnits' | 'items' | 'cardInventory' | 'identity'>
  opponents: Array<{ id: string; name: string }>
  previousSubmitterIds: string[]
  publicRounds: PublicRoundObservation[]
  cardDeckSize: number
  activeContractTargeted: boolean
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
    item: session.itemDeck[session.roundIndex] ?? null,
    self: { id: player.id, name: player.name, balanceUnits: player.balanceUnits, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined },
    opponents: session.players.filter((entry) => entry.id !== playerId).map((entry) => ({ id: entry.id, name: entry.name })),
    previousSubmitterIds: prior,
    publicRounds: session.results.map((result) => ({ winnerId: result.winnerId, totalBidUnits: result.totalBidUnits, minWinningBidUnits: result.minWinningBidUnits, tiedPlayerIds: [...result.tiedPlayerIds] })),
    cardDeckSize: session.cardDeck.length,
    activeContractTargeted: session.identityContracts.some((contract) => contract.targetPlayerId === playerId && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex),
  }
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

function modeFor(observation: BotObservation, profile: BotProfile, memory: BotMemory): StrategyMode {
  const item = observation.item
  const remaining = observation.totalRounds - observation.roundIndex
  const categoryCount = item ? observation.self.items.filter((won) => won.item.category === item.category).length : 0
  const maxGrudge = Math.max(0, ...Object.values(memory.grudgeByPlayerId))
  if (remaining <= 1) return 'finalSprint'
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
  const value = observation.item?.value ?? 0
  const assetBonus = marginalAssetUnits(observation) / 2
  const base = value * (1.05 + profile.risk * .85) + assetBonus * (profile.collect > .45 ? .35 : .15)
  const noiseRange = difficulty === 'easy' ? 5 : difficulty === 'expert' ? 1 : 2
  const noise = (hash(`${observation.playerId}:${observation.roundIndex}:${mode}`) % (noiseRange * 2 + 1)) - noiseRange
  const intelMid = observation.intel ? (observation.intel.lowUnits + observation.intel.highUnits) / 4 : null
  const reserve = mode === 'conserve' ? 4 : mode === 'finalSprint' ? 0 : 1
  const target = preferredOpponent(observation, memory) ?? observation.publicRounds.at(-1)?.winnerId ?? observation.opponents[0]?.id ?? null
  const cardUses = selectCards(observation, mode, memory).map((use) => use.cardId === 'fateCoin' ? { ...use, coinResult: hash(`${observation.playerId}:${observation.roundIndex}:coin`) % 2 === 0 ? 'heads' as const : 'tails' as const } : use)
  const peekMid = cardUses.some((use) => use.cardId === 'peek') && observation.legalPeek ? observation.legalPeek.bidUnits / 2 : null
  const targetCoins = Math.max(0, base + noise + (intelMid !== null && mode !== 'conserve' ? .75 : 0) + (peekMid !== null ? Math.max(0, peekMid - base) + .5 : 0))
  let bidUnits = Math.min(observation.self.balanceUnits, Math.max(0, coinsToUnits(targetCoins)))
  bidUnits = Math.min(bidUnits, Math.max(0, observation.self.balanceUnits - coinsToUnits(reserve)))
  if (mode === 'conserve') bidUnits = Math.min(bidUnits, coinsToUnits(Math.max(0, value * .65)))
  if (cardUses.some((use) => use.cardId === 'doubleBid') && bidUnits === 0) bidUnits = Math.min(observation.self.balanceUnits, coinsToUnits(Math.max(1, value * .55)))
  const identity = observation.self.identity
  let identityAction: IdentityAction | undefined
  if (identity?.id === 'reverser' && (mode === 'finalSprint' || mode === 'pressure') && observation.self.balanceUnits >= coinsToUnits(6)) identityAction = { type: 'reverserInvert' }
  if (identity?.id === 'merchant' && !identity.merchantAuctionUsed && observation.cardDeckSize > 0 && (mode === 'cards' || mode === 'finalSprint')) identityAction = { type: 'merchantAuction' }
  if (identity?.id === 'lobbyist' && observation.roundIndex < observation.totalRounds - 1 && target) identityAction = { type: 'lobbyistContract', targetPlayerId: target }
  const intel = observation.intel ? `模糊情报：${observation.opponents.find((opponent) => opponent.id === observation.intel?.playerId)?.name ?? '一名对手'} 的投资约为 ${observation.intel.lowUnits / 2}–${observation.intel.highUnits / 2}。` : undefined
  return { bidUnits, predictedPlayerId: target === observation.playerId ? null : target, cardUses, identityAction, mode, reason: `${modeLabel(mode)}：综合拍品价值、固定资产与现金风险后行动。`, intel }
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
