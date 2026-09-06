import { describe, expect, it } from 'vitest'
import { botInvestmentCandidates, botMarketFrontier, buildBotObservation, chooseBotShadowOutcome, decideBotTurn, defaultBotStrategy, emptyBotMemory } from './bots'
import { createDefaultSettings, createSession } from './session'
import { createPlayerIdentity } from './identities'
import type { IdentityId } from './types'

function fixture(identity: IdentityId = 'investor', count = 6, seed = 'joint') {
  const session = createSession(Array.from({ length: count }, (_, i) => ({ name: `Bot${i}`, controller: { kind: 'bot' as const, profileId: 'adaptive' as const, difficulty: 'expert' as const } })), createDefaultSettings(count))
  session.id = seed
  session.roundIndex = 1
  session.settings.rounds = 8
  session.players.forEach((p, i) => { p.id = `p${i}`; p.balanceUnits = 80; p.items = []; p.cardInventory = [] })
  const player = session.players[0]
  player.identity = createPlayerIdentity(identity)
  player.botMemory = emptyBotMemory(seed, { ...defaultBotStrategy(), bankroll: 10, collection: 90 })
  session.itemDeck[1] = { ...session.itemDeck[1], id: 'round-item', category: 'leisure', value: 5 }
  session.roundAuctions = []
  session.roundAssetAuctions = []
  return { session, player, observation: buildBotObservation(session, player.id), memory: player.botMemory }
}

describe('Bot 联合预算与双影', () => {
  it('投资候选覆盖全部目标与全余额半金币金额，不再限制四人或六金币', () => {
    const { observation } = fixture('investor', 10)
    const entries = botInvestmentCandidates(observation)
    expect(entries).toHaveLength(9 * 80)
    for (const opponent of observation.opponents) {
      expect(entries.filter((v) => v.targetPlayerId === opponent.id).map((v) => v.investmentUnits).sort((a, b) => a - b)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1))
    }
    expect(entries[0].score).toBeGreaterThanOrEqual(entries.at(-1)!.score)
  })

  it('市场统一预算、不依赖卡片顺序、禁止自买和低于起拍价报价', () => {
    const { observation, memory } = fixture()
    observation.marketCards = [{ id: 'red', cardId: 'red', own: false }, { id: 'own', cardId: 'legendaryLoot', own: true }]
    observation.marketAssets = [{ id: 'asset', sellerId: 'p1', item: { ...observation.item!, id: 'asset-item', value: 12, category: 'property' }, itemRoundIndex: 0, roundIndex: 1, minimumBidUnits: 7 }]
    const before = JSON.stringify(observation)
    const frontier = botMarketFrontier(observation, memory.strategy)
    frontier.forEach((plan, budget) => {
      expect(plan.bids.reduce((sum, bid) => sum + bid.bidUnits, 0)).toBeLessThanOrEqual(budget)
      expect(plan.bids.find((bid) => bid.lotId === 'own')?.bidUnits ?? 0).toBe(0)
      const asset = plan.bids.find((bid) => bid.lotId === 'asset')?.bidUnits ?? 0
      expect(asset === 0 || asset >= 7).toBe(true)
    })
    expect(JSON.stringify(observation)).toBe(before)
    expect(botMarketFrontier({ ...observation, marketCards: [...observation.marketCards].reverse() }, memory.strategy)).toEqual(frontier)
    observation.marketAssets[0].minimumBidUnits = 10000
    expect(botMarketFrontier(observation, memory.strategy).at(-1)!.bids.find((bid) => bid.lotId === 'asset')?.bidUnits ?? 0).toBe(0)
  })

  it('最终动作也能投资超过六金币，并预留投资和市场总费用、禁止预测投资目标', () => {
    let large = 0
    for (let index = 0; index < 12; index += 1) {
      const { observation, memory } = fixture('investor', 10, `large-investment-${index}`)
      observation.item = { ...observation.item!, value: 15 }
      observation.rewardMultipliers = [6, 3, 1]
      observation.investorDividendMultiplier = 3
      observation.marketCards = [{ id: 'red', cardId: 'red', own: false }]
      const decision = decideBotTurn(observation, 'custom', 'expert', memory)
      const amount = decision.identityAction?.type === 'invest' ? decision.identityAction.investmentUnits : 0
      large += Number(amount > 12)
      expect(decision.bidUnits + amount + decision.auctionBids!.reduce((sum, bid) => sum + bid.bidUnits, 0)).toBeLessThanOrEqual(observation.self.balanceUnits)
      if (decision.identityAction?.type === 'invest') expect(decision.predictedPlayerId).not.toBe(decision.identityAction.targetPlayerId)
    }
    expect(large).toBeGreaterThan(0)
  })

  it('有价值的市场可以改变普通下注；道具不再先耗尽藏品预算', () => {
    let changed = 0
    let boughtAssets = 0
    for (let i = 0; i < 12; i += 1) {
      const { observation, memory } = fixture('collector', 6, `market-${i}`)
      const item = { ...observation.item!, id: 'set', category: 'property' as const, value: 12 }
      observation.self.items = Array.from({ length: 3 }, (_, j) => ({ item: { ...item, id: `held-${j}` }, roundIndex: j }))
      const base = decideBotTurn(observation, 'custom', 'expert', memory)
      observation.marketCards = [{ id: 'red', cardId: 'red', own: false }]
      observation.marketAssets = [{ id: 'asset', sellerId: 'p1', item, itemRoundIndex: 0, roundIndex: 1, minimumBidUnits: 8 }]
      const result = decideBotTurn(observation, 'custom', 'expert', memory)
      changed += Number(result.bidUnits !== base.bidUnits)
      boughtAssets += Number((result.auctionBids?.find((b) => b.lotId === 'asset')?.bidUnits ?? 0) > 0)
      expect(result.bidUnits + result.auctionBids!.reduce((sum, b) => sum + b.bidUnits, 0)).toBeLessThanOrEqual(80)
      expect(decideBotTurn(observation, 'custom', 'expert', memory)).toEqual(result)
    }
    expect(changed).toBeGreaterThan(0)
    expect(boughtAssets).toBeGreaterThan(0)
  })

  it('双影按净收益选择，相等用 A；藏品优先可接受较低净收益', () => {
    const a = { bid: 8, reward: 20, net: 12, item: false }
    const b = { bid: 16, reward: 24, net: 8, item: true }
    expect(chooseBotShadowOutcome(a, b, false)).toBe(a)
    expect(chooseBotShadowOutcome(a, b, true)).toBe(b)
    expect(chooseBotShadowOutcome(a, { ...b, net: 12 }, false)).toBe(a)
    expect(chooseBotShadowOutcome(a, { ...b, net: 14 }, false).bid).toBe(16)
  })

  it('双影参与计划竞争，按 B 预留竞购余额，次数耗尽时不发动', () => {
    let used = 0
    for (let i = 0; i < 12; i += 1) {
      const { observation, memory } = fixture('nightwalker', 6, `shadow-${i}`)
      observation.marketCards = [{ id: 'coin', cardId: 'fateCoin', own: false }]
      const result = decideBotTurn(observation, 'custom', 'expert', memory)
      const action = result.identityAction
      if (action?.type === 'nightwalkerDoubleBid') {
        used += 1
        expect(action.shadowBidUnits).toBeGreaterThan(result.bidUnits)
        expect(action.shadowBidUnits + result.auctionBids!.reduce((sum, b) => sum + b.bidUnits, 0)).toBeLessThanOrEqual(80)
        expect(result.cardUses.some((use) => ['doubleBid', 'swap', 'bananaPeel', 'reverseRank'].includes(use.cardId))).toBe(false)
      }
      expect(decideBotTurn(observation, 'custom', 'expert', memory)).toEqual(result)
      observation.self.identity!.nightwalkerUses = observation.nightwalkerUseLimit
      expect(decideBotTurn(observation, 'custom', 'expert', memory).identityAction?.type).not.toBe('nightwalkerDoubleBid')
    }
    expect(used).toBeGreaterThan(0)
  })

  it('十人高余额、多卡市场仍在有限时间内完成合法计划', () => {
    const started = performance.now()
    for (const identity of ['investor', 'nightwalker'] as const) {
      const { observation, memory } = fixture(identity, 10, `dense-${identity}`)
      observation.self.balanceUnits = 300
      observation.self.cardInventory = ['red', 'black', 'fateCoin', 'redistribute']
      observation.marketCards = Array.from({ length: 6 }, (_, index) => ({ id: `market-${index}`, cardId: 'red' as const, own: false }))
      const decision = decideBotTurn(observation, 'custom', 'expert', memory)
      const commitment = decision.identityAction?.type === 'nightwalkerDoubleBid' ? decision.identityAction.shadowBidUnits : decision.bidUnits + (decision.identityAction?.type === 'invest' ? decision.identityAction.investmentUnits : 0)
      expect(commitment + decision.auctionBids!.reduce((sum, bid) => sum + bid.bidUnits, 0)).toBeLessThanOrEqual(300)
    }
    expect(performance.now() - started).toBeLessThan(5000)
  })
})
