import { describe, expect, it } from 'vitest'
import { buildBotObservation, decideBotAssetAuctionBids, decideBotAssetAuctionOffer, decideBotIdentity, decideBotKidnapResponse, decideBotMerchantBid, decideBotMerchantOffer, decideBotProphetAction, decideBotTurn, defaultBotStrategy, emptyBotMemory, estimateBalances } from './bots'
import { coinsToUnits } from './engine'
import { createDefaultSettings, createSession } from './session'
import { createGamePreset } from './presets'
import type { SeatConfig } from './types'

function seats(difficulty: 'easy' | 'standard' | 'expert' = 'standard'): SeatConfig[] {
  return [
    { name: '阿蓝', controller: { kind: 'bot', profileId: 'adaptive', difficulty } },
    { name: '玩家乙', controller: { kind: 'human' } },
    { name: '玩家丙', controller: { kind: 'human' } },
  ]
}

describe('Bot 信息边界与决策', () => {
  it('观察视图不携带对手余额、身份、库存或真实下注', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[1].balanceUnits = 77
    session.players[1].cardInventory.push('red')
    session.turns = [{ playerId: session.players[1].id, bidUnits: 33, predictedPlayerId: null }]
    const observation = buildBotObservation(session, session.players[0].id)
    expect(observation.opponents[0]).toEqual({ id: session.players[1].id, name: '玩家乙' })
    expect(observation).not.toHaveProperty('turns')
    expect(JSON.stringify(observation)).not.toContain('"bidUnits":33')
    expect(observation.opponents[0]).not.toHaveProperty('cardInventory')
    expect(observation.humanOpponentIds).toEqual([session.players[1].id, session.players[2].id])
  })

  it('高手每轮只得到一条已提交对手的模糊投资区间', () => {
    const session = createSession(seats('expert'), createDefaultSettings(3))
    session.turns = [{ playerId: session.players[1].id, bidUnits: 20, predictedPlayerId: null }]
    const observation = buildBotObservation(session, session.players[0].id)
    expect(observation.intel).toEqual({ playerId: session.players[1].id, lowUnits: 16, highUnits: 24 })
  })

  it('同一观察输入会给出相同的合法决策', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const observation = buildBotObservation(session, session.players[0].id)
    const first = decideBotTurn(observation, 'adaptive', 'standard', emptyBotMemory())
    const second = decideBotTurn(observation, 'adaptive', 'standard', emptyBotMemory())
    expect(first).toEqual(second)
    expect(first.bidUnits).toBeGreaterThanOrEqual(0)
    expect(first.bidUnits).toBeLessThanOrEqual(session.players[0].balanceUnits)
    expect(new Set(first.cardUses.map((use) => use.cardId)).size).toBe(first.cardUses.length)
  })

  it('相同资源的不同 Bot 种子会在高价值候选中做出不同报价，而非固定指向同一结果', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 11, category: 'luxury' }
    const base = buildBotObservation(session, session.players[0].id)
    const bids = new Set<number>()
    for (let index = 0; index < 18; index += 1) {
      const playerId = `同资源-bot-${index}`
      const observation = { ...base, playerId, self: { ...base.self, id: playerId } }
      const decision = decideBotTurn(observation, 'adaptive', 'standard', emptyBotMemory())
      expect(decision.bidUnits).toBeGreaterThanOrEqual(0)
      expect(decision.bidUnits).toBeLessThanOrEqual(base.self.balanceUnits)
      bids.add(decision.bidUnits)
    }
    expect(bids.size).toBeGreaterThan(1)
  })

  it('同一 Bot 预设重开多局时会因会话种子产生不同走向', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 11, category: 'luxury' }
    const base = buildBotObservation(session, session.players[0].id)
    const bids = new Set<number>()
    for (let index = 0; index < 18; index += 1) {
      const decision = decideBotTurn({ ...base, sessionSeed: `新局-${index}` }, 'adaptive', 'standard', emptyBotMemory())
      bids.add(decision.bidUnits)
    }
    expect(bids.size).toBeGreaterThan(1)
  })

  it('100 个相同公开局面会产生丰富报价，并把六个 Bot 的顶部撞价压到低频', () => {
    const botSeats: SeatConfig[] = Array.from({ length: 6 }, (_, index) => ({ name: `Bot ${index + 1}`, controller: { kind: 'bot' as const, profileId: 'adaptive' as const, difficulty: 'standard' as const } }))
    const session = createSession(botSeats, createDefaultSettings(6))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 12, category: 'luxury' }
    const bidValues = new Set<number>()
    let topTies = 0
    for (let seed = 0; seed < 100; seed += 1) {
      const bids = session.players.map((player) => {
        const observation = { ...buildBotObservation(session, player.id), sessionSeed: `simulation-${seed}` }
        const memory = emptyBotMemory(`simulation-${seed}:${player.id}`)
        return decideBotTurn(observation, 'adaptive', 'standard', memory).bidUnits
      })
      bids.forEach((bid) => bidValues.add(bid))
      const top = Math.max(...bids)
      if (bids.filter((bid) => bid === top).length > 1) topTies += 1
    }
    expect(bidValues.size).toBeGreaterThan(20)
    expect(topTies).toBeLessThan(35)
  })

  it('道具竞购也会随 Bot 行为指纹产生半金币级的不同报价', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const bids = new Set<number>()
    for (let index = 0; index < 30; index += 1) {
      const player = { ...session.players[0], id: `auction-bot-${index}`, botMemory: emptyBotMemory(`auction-${index}`) }
      bids.add(decideBotMerchantBid(player, 'reverseRank').bidUnits)
    }
    expect(bids.size).toBeGreaterThan(5)
  })

  it('拍品竞购会拒绝远高于自身价值的起拍价，并为同类套装保留更高的出价空间', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const player = { ...session.players[0], botMemory: emptyBotMemory('asset-auction') }
    const luxury = { ...session.itemDeck[0], id: 'auction-luxury', value: 9, category: 'luxury' as const }
    const expensive = { id: 'expensive', sellerId: session.players[1].id, item: luxury, itemRoundIndex: 0, minimumBidUnits: 60, roundIndex: 1 }
    const affordable = { ...expensive, id: 'affordable', minimumBidUnits: 4 }
    const first = decideBotAssetAuctionBids({ player, lots: [expensive, affordable], budgetUnits: 50, roundIndex: 1, totalRounds: 5, sessionSeed: 'asset-auction' })
    expect(first.find((bid) => bid.lotId === 'expensive')?.bidUnits).toBe(0)
    expect(first.find((bid) => bid.lotId === 'affordable')?.bidUnits).toBeGreaterThanOrEqual(4)

    const collecting = { ...player, items: [{ item: { ...luxury, id: 'held-luxury' }, roundIndex: 0 }], identity: { id: 'collector' as const, collectorCategory: 'luxury' as const, thiefSuccesses: 0, merchantAuctionCount: 0, merchantLastAuctionRound: null, lobbyistNextFree: false, lobbyistLastIssuedRound: null } }
    const collectorBid = decideBotAssetAuctionBids({ player: collecting, lots: [affordable], budgetUnits: 50, roundIndex: 1, totalRounds: 5, sessionSeed: 'asset-auction' })[0].bidUnits
    expect(collectorBid).toBeGreaterThanOrEqual(first.find((bid) => bid.lotId === 'affordable')!.bidUnits)
  })

  it('热门类别会保留少量高价抢拍可能，而不是只按固定估值报价', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const hotItem = { ...session.itemDeck[0], id: 'hot-luxury', value: 14, category: 'luxury' as const }
    const player = {
      ...session.players[0],
      balanceUnits: 70,
      items: [{ item: { ...hotItem, id: 'owned-luxury' }, roundIndex: 0 }],
      controller: { kind: 'bot' as const, profileId: 'aggressive' as const, difficulty: 'expert' as const },
      botMemory: { ...emptyBotMemory('hot-market'), behavior: { ...emptyBotMemory('hot-market').behavior, riskBias: 1, assetFocusBias: 1 } },
    }
    const lot = { id: 'hot-lot', sellerId: session.players[1].id, item: hotItem, itemRoundIndex: 1, minimumBidUnits: 8, roundIndex: 2 }
    const observation = buildBotObservation({ ...session, players: [player, ...session.players.slice(1)] }, player.id)
    observation.publicRounds = Array.from({ length: 4 }, (_, index) => ({ winnerId: session.players[1 + (index % 2)].id, totalBidUnits: 30, minWinningBidUnits: 12, tiedPlayerIds: [], itemCategory: 'luxury' as const, rankings: [], publicDeltaByPlayerId: {} }))
    const bids = Array.from({ length: 80 }, (_, seed) => decideBotAssetAuctionBids({ player, lots: [lot], budgetUnits: 60, roundIndex: 2, totalRounds: 7, sessionSeed: `hot-market-${seed}`, observation })[0].bidUnits)
    expect(new Set(bids).size).toBeGreaterThan(6)
    expect(Math.max(...bids) - Math.min(...bids)).toBeGreaterThanOrEqual(10)
  })

  it('会从公开总下注、门槛与收益变化推算对手现金区间', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const observation = buildBotObservation(session, session.players[0].id)
    observation.publicRounds = [{ winnerId: session.players[1].id, totalBidUnits: 30, minWinningBidUnits: 10, tiedPlayerIds: [], itemCategory: 'luxury', rankings: [{ playerId: session.players[1].id, place: 1, rewardUnits: 20 }], publicDeltaByPlayerId: { [session.players[1].id]: 20, [session.players[2].id]: -4 } }]
    const estimate = estimateBalances(observation).find((entry) => entry.playerId === session.players[1].id)
    expect(estimate?.expectedUnits).toBe(70)
    expect(estimate?.expectedBidUnits).toBeGreaterThan(0)
    expect(estimate?.lowUnits).toBeLessThanOrEqual(estimate?.expectedUnits ?? 0)
    expect(estimate?.highUnits).toBeGreaterThanOrEqual(estimate?.expectedUnits ?? 0)
  })

  it('预测期望为负时会选择跳过，而不是机械预测第一名', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const observation = buildBotObservation(session, session.players[0].id)
    observation.balanceEstimates = observation.balanceEstimates.map((entry) => entry.playerId === session.players[0].id ? entry : { ...entry, lowUnits: 0, expectedUnits: 0, highUnits: 0 })
    const decision = decideBotTurn(observation, 'observer', 'standard', emptyBotMemory())
    expect(decision.predictedPlayerId).toBeNull()
  })

  it('收藏家会把命中类别的即时金币与资产跳档一起计入竞拍计划', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[0].identity = { id: 'collector', collectorCategory: 'luxury', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    session.players[0].items = [{ item: { ...session.itemDeck[0], id: 'old-luxury', category: 'luxury', value: 7 }, roundIndex: -1 }]
    session.itemDeck[0] = { ...session.itemDeck[0], id: 'current-luxury', category: 'luxury', value: 9 }
    const target = decideBotTurn(buildBotObservation(session, session.players[0].id), 'collectorBot', 'standard', emptyBotMemory('collector-focus'))
    const unrelatedSession = { ...session, itemDeck: [{ ...session.itemDeck[0], category: 'transport' as const }, ...session.itemDeck.slice(1)] }
    const unrelated = decideBotTurn(buildBotObservation(unrelatedSession, unrelatedSession.players[0].id), 'collectorBot', 'standard', emptyBotMemory('collector-focus'))
    expect(target.mode).toBe('collect')
    expect(target.reason).toContain('即时奖励与套装增量')
    expect(unrelated.mode).not.toBe('collect')
  })

  it('稳健 Bot 会在非终局保留周转金，而不是把全部余额投入普通拍品', () => {
    const session = createSession(seats(), createDefaultSettings(6))
    session.players[0].balanceUnits = 60
    session.itemDeck[0] = { ...session.itemDeck[0], value: 7, category: 'leisure' }
    const decision = decideBotTurn(buildBotObservation(session, session.players[0].id), 'steady', 'standard', emptyBotMemory('cash-buffer'))
    expect(decision.bidUnits).toBeLessThan(session.players[0].balanceUnits)
    expect(decision.reason).toContain('预留约')
  })

  it('命运硬币被 Bot 纳入计划时会在提交前固定正反面', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[0].cardInventory = ['fateCoin']
    session.players[0].balanceUnits = 10
    const decisions = Array.from({ length: 40 }, (_, index) => decideBotTurn(buildBotObservation(session, session.players[0].id), 'comeback', 'standard', emptyBotMemory(`coin-${index}`)))
    const coins = decisions.flatMap((decision) => decision.cardUses.filter((use) => use.cardId === 'fateCoin'))
    // Smart bots are allowed to decline a bad coin flip; any selected coin must nevertheless be locked.
    coins.forEach((coin) => expect(coin.coinResult === 'heads' || coin.coinResult === 'tails').toBe(true))
  })

  it('逆行者会用较低投资挤进获奖区，再发动逆转排名', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 20 }
    session.players[0].identity = { id: 'reverser', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: true, lobbyistLastIssuedRound: null }
    session.players[0].balanceUnits = 100
    const observation = buildBotObservation(session, session.players[0].id)
    observation.balanceEstimates = [
      { playerId: session.players[0].id, lowUnits: 100, expectedUnits: 100, highUnits: 100, expectedBidUnits: 0, categoryWins: 0 },
      { playerId: session.players[1].id, lowUnits: 70, expectedUnits: 80, highUnits: 90, expectedBidUnits: 80, categoryWins: 0 },
      { playerId: session.players[2].id, lowUnits: 30, expectedUnits: 40, highUnits: 50, expectedBidUnits: 40, categoryWins: 0 },
    ]
    const decision = decideBotTurn(observation, 'identityBot', 'expert', emptyBotMemory())
    expect(decision.identityAction).toEqual({ type: 'reverserInvert' })
    expect(decision.bidUnits).toBeGreaterThan(0)
    expect(decision.bidUnits).toBeLessThan(80)
    expect(decision.reason).toContain('先以第')
  })

  it('偷天换日会用零投资换走高投资，避免替目标抬价', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 20 }
    session.players[0].cardInventory = ['swap']
    session.players[0].balanceUnits = 80
    const observation = buildBotObservation(session, session.players[0].id)
    observation.balanceEstimates = [
      { playerId: session.players[0].id, lowUnits: 80, expectedUnits: 80, highUnits: 80, expectedBidUnits: 0, categoryWins: 0 },
      { playerId: session.players[1].id, lowUnits: 60, expectedUnits: 70, highUnits: 80, expectedBidUnits: 48, categoryWins: 0 },
      { playerId: session.players[2].id, lowUnits: 10, expectedUnits: 20, highUnits: 30, expectedBidUnits: 12, categoryWins: 0 },
    ]
    const decision = decideBotTurn(observation, 'observer', 'expert', emptyBotMemory())
    expect(decision.cardUses).toContainEqual({ cardId: 'swap', targetPlayerId: session.players[1].id })
    expect(decision.bidUnits).toBe(0)
    expect(decision.cardUses.some((use) => use.cardId === 'doubleBid')).toBe(false)
  })

  it('绑匪会把目标胜率、同类固定资产与失败成本一起纳入抢劫决策', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.itemDeck[0] = { ...session.itemDeck[0], value: 20, category: 'leisure' }
    session.players[0].identity = { id: 'assassin', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    session.players[0].items = [{ item: { ...session.itemDeck[0], id: 'previous-leisure', value: 4 }, roundIndex: -1 }]
    session.players[0].balanceUnits = 100
    const observation = buildBotObservation(session, session.players[0].id)
    observation.balanceEstimates = [
      { playerId: session.players[0].id, lowUnits: 100, expectedUnits: 100, highUnits: 100, expectedBidUnits: 0, categoryWins: 1 },
      { playerId: session.players[1].id, lowUnits: 70, expectedUnits: 80, highUnits: 100, expectedBidUnits: 72, categoryWins: 2 },
      { playerId: session.players[2].id, lowUnits: 4, expectedUnits: 8, highUnits: 12, expectedBidUnits: 6, categoryWins: 0 },
    ]
    const decision = decideBotTurn(observation, 'identityBot', 'expert', emptyBotMemory())
    expect(decision.identityAction).toMatchObject({ type: 'kidnap', targetPlayerIds: [session.players[1].id] })
    expect(decision.reason).toContain('绑票谈判')
  })

  it('身份与道具的特判计划在同一观察下保持稳定', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[0].cardInventory = ['swap']
    const observation = buildBotObservation(session, session.players[0].id)
    const first = decideBotTurn(observation, 'adaptive', 'standard', emptyBotMemory())
    const second = decideBotTurn(observation, 'adaptive', 'standard', emptyBotMemory())
    expect(first).toEqual(second)
  })

  it('预设会保存 Bot 座位与难度', () => {
    const preset = createGamePreset('Bot 局', seats('expert'), createDefaultSettings(3))
    expect(preset.seats?.[0].controller).toEqual({ kind: 'bot', profileId: 'adaptive', difficulty: 'expert' })
  })

  it('自定义 Bot 的收藏权重会提高同类拍品竞购预算，而不是只看标价', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const item = { ...session.itemDeck[0], id: 'custom-collection-lot', value: 8, category: 'property' as const }
    const lot = { id: 'custom-collection-auction', sellerId: session.players[1].id, item, itemRoundIndex: 0, minimumBidUnits: 4, roundIndex: 1 }
    const lowStrategy = { ...defaultBotStrategy('steady'), collection: 0 }
    const highStrategy = { ...defaultBotStrategy('collectorBot'), collection: 100 }
    const base = { ...session.players[0], items: [{ item: { ...item, id: 'held-property' }, roundIndex: -1 }] }
    const low = { ...base, controller: { kind: 'bot' as const, profileId: 'custom' as const, difficulty: 'expert' as const, customProfile: { id: 'low', name: '低收藏', createdAt: '', updatedAt: '', ...lowStrategy } }, botMemory: emptyBotMemory('custom-collection', lowStrategy) }
    const high = { ...base, controller: { kind: 'bot' as const, profileId: 'custom' as const, difficulty: 'expert' as const, customProfile: { id: 'high', name: '高收藏', createdAt: '', updatedAt: '', ...highStrategy } }, botMemory: emptyBotMemory('custom-collection', highStrategy) }
    const lowBid = decideBotAssetAuctionBids({ player: low, lots: [lot], budgetUnits: 50, roundIndex: 1, totalRounds: 6, sessionSeed: 'custom-collection' })[0].bidUnits
    const highBid = decideBotAssetAuctionBids({ player: high, lots: [lot], budgetUnits: 50, roundIndex: 1, totalRounds: 6, sessionSeed: 'custom-collection' })[0].bidUnits
    expect(highBid).toBeGreaterThanOrEqual(lowBid)
  })

  it('预言家只会从自己尚未排除的候选中猜身份，并跳过已识破目标', () => {
    const session = createSession(seats('expert'), createDefaultSettings(3))
    session.players[0].identity = { id: 'prophet', thiefSuccesses: 0, merchantAuctionCount: 0, merchantLastAuctionRound: null, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const [prophet, solved, open] = session.players
    session.prophetIdentityCandidates[prophet.id] = {
      [solved.id]: ['collector', 'merchant', 'prophet', 'gambler', 'assassin', 'thief'],
      [open.id]: ['collector', 'merchant', 'prophet', 'gambler', 'assassin', 'thief'],
    }
    session.prophetIdentityProgress[prophet.id] = {
      [solved.id]: { excludedIdentityIds: ['collector'], solvedIdentityId: 'merchant' },
      [open.id]: { excludedIdentityIds: ['collector', 'gambler'] },
    }
    const action = decideBotProphetAction(buildBotObservation(session, prophet.id), prophet.botMemory ?? emptyBotMemory('prophet'), 'identity')
    expect(action).toMatchObject({ mode: 'identity', targetPlayerId: open.id })
    expect(['collector', 'gambler']).not.toContain(action?.identityId)
  })

  it('道具商人会从已锁定的三张候选中稳定挑选一张，而不是刷新重抽', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const player = { ...session.players[0], controller: { kind: 'bot' as const, profileId: 'cards' as const, difficulty: 'expert' as const }, botMemory: emptyBotMemory('merchant-offer', defaultBotStrategy('cards')) }
    const offered = ['red', 'fateCoin', 'legendaryLoot'] as const
    const first = decideBotMerchantOffer(player, [...offered], 2, 'merchant-offer')
    const second = decideBotMerchantOffer(player, [...offered], 2, 'merchant-offer')
    expect(first).toBe(second)
    expect(offered).toContain(first)
  })

  it('身份选取会把自定义身份优先顺序纳入二选一评分', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const defaults = defaultBotStrategy('adaptive')
    const strategy = { ...defaults, identityPriority: ['investor' as const, ...defaults.identityPriority.filter((id) => id !== 'investor')] }
    const player = { ...session.players[0], controller: { kind: 'bot' as const, profileId: 'custom' as const, difficulty: 'expert' as const, customProfile: { id: 'identity', name: '投资优先', createdAt: '', updatedAt: '', ...strategy } }, botMemory: emptyBotMemory('identity-custom', strategy) }
    expect(decideBotIdentity({ choices: ['collector', 'investor'], player, players: [player, ...session.players.slice(1)] }).identityId).toBe('investor')
  })
})

describe('Bot 藏品出售与绑票谈判', () => {
  it('会把自身收益较低、已有公开竞争需求的藏品挂到下一轮竞购，同时保留收藏家目标类', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const player = { ...session.players[0], controller: { kind: 'bot' as const, profileId: 'aggressive' as const, difficulty: 'expert' as const }, botMemory: emptyBotMemory('seller-bot') }
    const item = { ...session.itemDeck[0], id: 'seller-leisure', category: 'leisure' as const, value: 4 }
    player.items = [{ item, roundIndex: 0 }]
    const observation = buildBotObservation({ ...session, players: [player, ...session.players.slice(1)] }, player.id)
    observation.publicRounds = [
      { winnerId: session.players[1].id, totalBidUnits: 20, minWinningBidUnits: 8, tiedPlayerIds: [], itemCategory: 'leisure', rankings: [], publicDeltaByPlayerId: {} },
      { winnerId: session.players[2].id, totalBidUnits: 22, minWinningBidUnits: 8, tiedPlayerIds: [], itemCategory: 'leisure', rankings: [], publicDeltaByPlayerId: {} },
    ]
    const offer = decideBotAssetAuctionOffer({ player, observation, roundIndex: 2, totalRounds: 6, sessionSeed: 'seller-bot' })
    expect(offer).toMatchObject({ itemId: 'seller-leisure', itemRoundIndex: 0 })
    expect(offer?.minimumBidUnits).toBeGreaterThanOrEqual(2)

    const collector = { ...player, identity: { id: 'collector' as const, collectorCategory: 'leisure' as const, thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null } }
    expect(decideBotAssetAuctionOffer({ player: collector, observation, roundIndex: 2, totalRounds: 6, sessionSeed: 'seller-bot' })).toBeUndefined()
  })

  it('不会低价挂牌给公开可见、正好能补齐套装的对手', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const player = { ...session.players[0], controller: { kind: 'bot' as const, profileId: 'steady' as const, difficulty: 'expert' as const }, botMemory: emptyBotMemory('deny-set-gift') }
    const item = { ...session.itemDeck[0], id: 'deny-leisure', category: 'leisure' as const, value: 5 }
    player.items = [{ item, roundIndex: 0 }]
    const observation = buildBotObservation({ ...session, players: [player, ...session.players.slice(1)] }, player.id)
    observation.publicRounds = [{ winnerId: session.players[1].id, itemWinnerId: session.players[1].id, totalBidUnits: 18, minWinningBidUnits: 8, tiedPlayerIds: [], itemCategory: 'leisure', rankings: [], publicDeltaByPlayerId: {} }]
    const offer = decideBotAssetAuctionOffer({ player, observation, roundIndex: 2, totalRounds: 6, sessionSeed: 'deny-set-gift' })
    expect(offer === undefined || offer.minimumBidUnits >= coinsToUnits(8)).toBe(true)
  })

  it('会按对手真实套装跳档选择封锁或高价出售，而不是低价送出关键拍品', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const item = { ...session.itemDeck[0], id: 'jump-fourth', category: 'leisure' as const, value: 8 }
    const memory = emptyBotMemory('major-jump-market')
    const seller = {
      ...session.players[0],
      controller: { kind: 'bot' as const, profileId: 'aggressive' as const, difficulty: 'expert' as const },
      items: [{ item, roundIndex: 0 }],
      botMemory: { ...memory, behavior: { ...memory.behavior, assetMarketBias: 1, antiLeaderBias: .5 } },
    }
    const observation = buildBotObservation({ ...session, players: [seller, ...session.players.slice(1)] }, seller.id)
    observation.publicRounds = Array.from({ length: 3 }, () => ({
      winnerId: session.players[1].id, itemWinnerId: session.players[1].id, totalBidUnits: 20, minWinningBidUnits: 8, tiedPlayerIds: [], itemCategory: 'leisure' as const, rankings: [], publicDeltaByPlayerId: {},
    }))
    const offers = Array.from({ length: 40 }, (_, seed) => decideBotAssetAuctionOffer({ player: seller, observation, roundIndex: 3, totalRounds: 8, sessionSeed: `major-jump-market-${seed}` }))
    const priced = offers.filter((offer): offer is NonNullable<typeof offer> => Boolean(offer))
    expect(priced.length).toBeGreaterThan(0)
    // 生活娱乐从 3 件到 4 件会多出 23 金币套装收益；市场型出售时不能按物品 8 金币低价放出。
    expect(Math.min(...priced.map((offer) => offer.minimumBidUnits))).toBeGreaterThanOrEqual(coinsToUnits(15))
    expect(offers.some((offer) => !offer)).toBe(true)
  })

  it('高干扰 Bot 会把公开对手的大额套装跳档纳入竞购报价，但仍受总预算约束', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const item = { ...session.itemDeck[0], id: 'block-fourth', category: 'property' as const, value: 9 }
    const memory = emptyBotMemory('block-fourth')
    const player = {
      ...session.players[0],
      controller: { kind: 'bot' as const, profileId: 'blocker' as const, difficulty: 'expert' as const },
      botMemory: { ...memory, behavior: { ...memory.behavior, antiLeaderBias: 1 } },
    }
    const observation = buildBotObservation({ ...session, players: [player, ...session.players.slice(1)] }, player.id)
    observation.publicRounds = Array.from({ length: 3 }, () => ({ winnerId: session.players[1].id, itemWinnerId: session.players[1].id, totalBidUnits: 20, minWinningBidUnits: 8, tiedPlayerIds: [], itemCategory: 'property' as const, rankings: [], publicDeltaByPlayerId: {} }))
    const lot = { id: 'blocker-lot', sellerId: session.players[2].id, item, itemRoundIndex: 1, minimumBidUnits: coinsToUnits(2), roundIndex: 3 }
    const bids = Array.from({ length: 48 }, (_, seed) => decideBotAssetAuctionBids({ player, lots: [lot], budgetUnits: coinsToUnits(22), roundIndex: 3, totalRounds: 8, sessionSeed: `block-fourth-${seed}`, observation })[0].bidUnits)
    expect(Math.max(...bids)).toBeGreaterThanOrEqual(coinsToUnits(12))
    expect(Math.max(...bids)).toBeLessThanOrEqual(coinsToUnits(22))
    expect(new Set(bids).size).toBeGreaterThan(5)
  })

  it('绑票谈判会根据拍品加成与赎金压力决定保住或放弃藏品', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const item = { ...session.itemDeck[0], id: 'kidnap-luxury', category: 'luxury' as const, value: 12 }
    const collector = { ...session.players[0], balanceUnits: 50, identity: { id: 'collector' as const, collectorCategory: 'luxury' as const, thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }, items: [{ item, roundIndex: 3 }], botMemory: emptyBotMemory('kidnap-keep') }
    expect(decideBotKidnapResponse({ player: collector, item, ransomUnits: 12, roundIndex: 3, totalRounds: 6, sessionSeed: 'kidnap-keep' })).toBe(true)
    expect(decideBotKidnapResponse({ player: { ...collector, balanceUnits: 8 }, item, ransomUnits: 12, roundIndex: 3, totalRounds: 6, sessionSeed: 'kidnap-drop' })).toBe(false)
  })

  it('带有全局卖货倾向的 Bot 会偶尔挂出非目标类藏品，但不会每局机械上架', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    const item = { ...session.itemDeck[0], id: 'seller-mood-item', category: 'transport' as const, value: 8 }
    const memory = emptyBotMemory('seller-mood')
    const player = { ...session.players[0], items: [{ item, roundIndex: 0 }], botMemory: { ...memory, behavior: { ...memory.behavior, assetMarketBias: 1 } } }
    const observation = buildBotObservation({ ...session, players: [player, ...session.players.slice(1)] }, player.id)
    const outcomes = Array.from({ length: 40 }, (_, seed) => Boolean(decideBotAssetAuctionOffer({ player, observation, roundIndex: 2, totalRounds: 7, sessionSeed: `seller-mood-${seed}` })))
    expect(outcomes.some(Boolean)).toBe(true)
    expect(outcomes.some((outcome) => !outcome)).toBe(true)
  })
})
