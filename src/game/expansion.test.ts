import { describe, expect, it } from 'vitest'
import { cardTargetScope, createCardDeck, validCardMultiplicity } from './cards'
import { chooseConnoisseurCard, connoisseurCategoryReward, rewardConnoisseurItem } from './connoisseur'
import { settleRound } from './engine'
import { createPlayerIdentity, defaultIdentitySettings, identitySkillMode } from './identities'
import { buildBotObservation, decideBotAssetAuctionBids, decideBotIdentity, decideBotTurn, defaultBotStrategy, emptyBotMemory } from './bots'
import { createDefaultSettings, createSession } from './session'
import type { AssetCategory, CardId, IdentityId, Item, Player, RoundTurn } from './types'

const prize: Item = { id: 'expansion-prize', name: '测试拍品', emoji: '♦', category: 'leisure', value: 5, tone: '#000' }
const players = (): Player[] => [0, 1, 2].map((i) => ({ id: `p${i}`, name: `玩家${i}`, color: '#000', balanceUnits: 100, items: [], cardInventory: [] }))
const turns = (bids = [20, 16, 12]): RoundTurn[] => bids.map((bidUnits, i) => ({ playerId: `p${i}`, bidUnits, predictedPlayerId: null, cardUses: [] }))
function settle(ps = players(), ts = turns(), extra: Partial<Parameters<typeof settleRound>[0]> = {}) {
  return settleRound({ playersAfterBids: ps, turns: ts, item: prize, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1,
    fairnessOrderIds: ps.map((p) => p.id), cardDeck: ['red', 'black', 'fateCoin', 'peek'], roll: () => 0, ...extra })
}
function uses(ts: RoundTurn[], index: number, ids: CardId[]) { ts[index].cardUses = ids.map((cardId) => ({ cardId })) }

describe('保险师', () => {
  it.each([{ bids: [12, 20, 16], refund: 12 }, { bids: [20, 20, 12], refund: 20 }])('落榜或并列全额返还真实普通下注（$refund）', ({ bids, refund }) => {
    const ps = players(); ps[0].identity = createPlayerIdentity('insurer')
    const result = settle(ps, turns(bids))
    expect(result.result.deltas[0].identityUnits).toBe(refund)
    expect(ps[0].balanceUnits).toBe(100)
  })
  it('香蕉皮先退一半，保险补足剩余损失，不重复退款', () => {
    const ps = players(); ps[0].identity = createPlayerIdentity('insurer')
    const ts = turns(); ts[1].cardUses = [{ cardId: 'bananaPeel', targetPlayerId: 'p0' }]
    const output = settle(ps, ts)
    expect(output.result.deltas[0]).toMatchObject({ cardUnits: 10, identityUnits: 10 })
  })
  it('获奖但被夺宝不退款；零下注不退款；永久免观望惩罚', () => {
    const ps = players(); ps[0].identity = createPlayerIdentity('insurer')
    const ts = turns(); uses(ts, 1, ['legendaryLoot'])
    expect(settle(ps, ts).result.deltas[0].identityUnits).toBe(0)
    const output = settle(ps, turns([0, 16, 12]), { roundStartBalanceUnits: { p0: 100, p1: 80, p2: 60 } })
    expect(output.result.deltas[0].identityUnits).toBe(0)
    expect(output.result.passivityFeePenalties).toEqual([])
  })
  it('不返还投资、市场报价或技能费用', () => {
    const ps = players(); ps[0].identity = createPlayerIdentity('insurer')
    const ts = turns([4, 20, 16]); ts[0].auctionBids = [{ lotId: 'lot', bidUnits: 80 }]
    expect(settle(ps, ts).result.deltas[0].identityUnits).toBe(4)
  })
})

describe('凯旋礼金与失算保单', () => {
  it('逆转后的第一名获礼金，拍品被夺走不影响；多人同卡逐张播报', () => {
    const ts = turns(); uses(ts, 1, ['triumphRebate', 'triumphRebate', 'reverseRank']); uses(ts, 2, ['legendaryLoot'])
    const output = settle(players(), ts)
    expect(output.result.winnerId).toBe('p1')
    expect(output.result.itemWinnerId).toBe('p2')
    expect(output.result.deltas[1].cardUnits).toBe(10)
    expect(output.result.cardEffects.some((effect) => effect.description.includes('两张凯旋礼金生效'))).toBe(true)
  })
  it('0 下注第一名返 0，非第一名无返利', () => {
    const ts = turns([0, 8, 8]); uses(ts, 0, ['triumphRebate']); uses(ts, 1, ['triumphRebate'])
    const output = settle(players(), ts)
    expect(output.result.winnerId).toBe('p0')
    expect(output.result.deltas.every((delta) => delta.cardUnits === 0)).toBe(true)
  })
  it('礼金不计入投资分红', () => {
    const ps = players(); ps[1].identity = createPlayerIdentity('investor')
    const ts = turns(); uses(ts, 0, ['triumphRebate'])
    ts[1].identityAction = { type: 'invest', targetPlayerId: 'p0', investmentUnits: 20 }
    const withCard = settle(ps, ts); ts[0].cardUses = []
    const withoutCard = settle(ps, ts)
    expect(withCard.result.investments).toEqual(withoutCard.result.investments)
    expect(withCard.players[0].balanceUnits - withoutCard.players[0].balanceUnits).toBe(6)
  })
  it.each([1, 2, 3])('%i 张保单依次减半，只改变猜错罚款', (count) => {
    const ts = turns(); ts[1].predictedPlayerId = 'p2'; uses(ts, 1, Array.from({ length: count }, () => 'predictionPolicy'))
    const output = settle(players(), ts)
    expect(output.result.deltas[1].predictionUnits).toBe(-Math.floor(10 * .5 ** count))
  })
  it('赌徒真实与公开罚款均按保单减半，跳过不减免', () => {
    const ps = players(); ps[1].identity = createPlayerIdentity('gambler')
    const settings = { ...defaultIdentitySettings(true), gamblerWrongPenaltyMultiplier: .4, gamblerSkipPenaltyMultiplier: .6 }
    const ts = turns(); ts[1].predictedPlayerId = 'p2'; uses(ts, 1, ['predictionPolicy'])
    expect(settle(ps, ts, { identitySettings: settings }).result.deltas[1]).toMatchObject({ predictionUnits: -2, publicPredictionUnits: -5 })
    ts[1].predictedPlayerId = null
    expect(settle(ps, ts, { identitySettings: settings }).result.deltas[1].identityUnits).toBe(-6)
  })
  it('无唯一第一也减免；余额不足仍按应罚显示，不泄露余额', () => {
    const ps = players(); ps[1].balanceUnits = 1
    const ts = turns([4, 4, 4]); ts[1].predictedPlayerId = 'p0'; uses(ts, 1, ['predictionPolicy'])
    expect(settle(ps, ts).result.deltas[1]).toMatchObject({ predictionUnits: -1, publicPredictionUnits: -5 })
  })
  it('猜对与不预测不受保单影响', () => {
    for (const prediction of ['p0', null]) {
      const ts = turns(); ts[1].predictedPlayerId = prediction; uses(ts, 1, ['predictionPolicy'])
      const insured = settle(players(), ts); ts[1].cardUses = []
      expect(insured.result.predictionOutcomes).toEqual(settle(players(), ts).result.predictionOutcomes)
    }
  })
})

describe('鉴赏家实际获得与持久化', () => {
  it('四类别发 5/10/15/20 及 1/2/3/4 选一，各档锁定一次并归还未选卡', () => {
    const p = players()[0]; p.identity = createPlayerIdentity('connoisseur')
    let deck = createCardDeck([])
    const total = deck.length
    const categories: AssetCategory[] = ['property', 'leisure', 'luxury', 'transport']
    const bonuses = categories.map((category, roundIndex) => {
      const won = { item: { ...prize, id: category, category }, roundIndex }
      const reward = rewardConnoisseurItem(p, won, roundIndex, deck, [], () => 0); deck = reward.cardDeck
      return reward.event?.deltaUnits
    })
    expect(bonuses).toEqual([10, 20, 30, 40]); expect(deck).toHaveLength(total - 10)
    expect(p.balanceUnits).toBe(200); expect(p.cardInventory).toHaveLength(1)
    expect(p.identity.connoisseurOffers?.map(o => o.offeredCardIds.length)).toEqual([2, 3, 4])
    for (const offer of [...p.identity.connoisseurOffers!]) {
      expect(new Set(offer.offeredCardIds).size).toBe(offer.offeredCardIds.length)
      const choice = chooseConnoisseurCard(p, offer.offeredCardIds[0], deck)!
      Object.assign(p, choice.player); deck = choice.cardDeck
    }
    expect(p.cardInventory).toHaveLength(4); expect(deck).toHaveLength(total - 4)
    expect(chooseConnoisseurCard(p, 'red', deck)).toBeNull()
    expect(p.identity.connoisseurCategories).toEqual(categories)
  })
  it('卖掉再买回、JSON 刷新均不重复；同类另一件也不重复发卡', () => {
    let p = players()[0]; p.identity = createPlayerIdentity('connoisseur')
    const won = { item: prize, roundIndex: 0 }
    rewardConnoisseurItem(p, won, 0, ['red'], [], () => 0)
    p = JSON.parse(JSON.stringify(p)) as Player
    expect(rewardConnoisseurItem(p, won, 2, ['black']).event).toBeUndefined()
    const output = rewardConnoisseurItem(p, { ...won, item: { ...prize, id: 'another' } }, 2, ['black'], [], () => 0)
    expect(output.event).toBeUndefined(); expect(p.cardInventory).toEqual(['red'])
  })
  it('市场买入与本轮得标均奖励；不计收藏家虚拟件；不改输入', () => {
    const ps = players(); ps[0].identity = createPlayerIdentity('connoisseur')
    ps[0].items.push({ item: { ...prize, id: 'market', category: 'transport' }, roundIndex: 0 })
    const output = settle(ps, turns(), { roundIndex: 1 })
    expect(output.result.deltas[0].identityUnits).toBe(30)
    expect(output.players[0].cardInventory).toEqual(['red'])
    expect(output.players[0].identity?.connoisseurOffers?.[0].offeredCardIds).toEqual(['black', 'fateCoin'])
    expect(output.cardDeck).toEqual(['peek'])
    expect(ps[0].identity.connoisseurCategories).toBeUndefined()
    const resumed = settle(output.players, turns([0, 16, 12]), { roundIndex: 2, cardDeck: output.cardDeck })
    expect(resumed.players[0].cardInventory).toHaveLength(1)
    expect(resumed.players[0].identity?.connoisseurOffers).toEqual(output.players[0].identity?.connoisseurOffers)
  })
  it('绑票待决定不预发，赎回才奖励；夺宝优先按实际得主发放', () => {
    const ps = players(); ps[0].identity = createPlayerIdentity('connoisseur'); ps[1].identity = createPlayerIdentity('assassin')
    const ts = turns(); ts[1].identityAction = { type: 'kidnap', targetPlayerId: 'p0', targetPlayerIds: ['p0'], ransomUnits: 12 }
    const pending = settle(ps, ts)
    expect(pending.result.kidnapAttempt?.status).toBe('pending')
    expect(pending.players[0].cardInventory).toHaveLength(0)
    expect(pending.players[0].identity?.connoisseurCategories).toBeUndefined()
    const reward = rewardConnoisseurItem(pending.players[0], { item: prize, roundIndex: 0 }, 0, pending.cardDeck, [], () => 0)
    expect(reward.event?.deltaUnits).toBe(10)
    uses(ts, 2, ['legendaryLoot']); const lost = settle(ps, ts)
    expect(lost.players[0].cardInventory).toHaveLength(0)
    uses(ts, 0, ['legendaryLoot']); ts[2].cardUses = []
    expect(settle(ps, ts).players[0].cardInventory).toHaveLength(1)
  })
  it('禁用全部道具仍发类别金币，不捏造库存', () => {
    const p = players()[0]; p.identity = createPlayerIdentity('connoisseur')
    const all = [...new Set(createCardDeck([]))]
    const reward = rewardConnoisseurItem(p, { item: prize, roundIndex: 0 }, 0, [], all)
    expect(reward.event?.deltaUnits).toBe(10); expect(p.cardInventory).toEqual([])
  })
})

describe('新增内容接入', () => {
  it('普通卡各 5 张、无需目标、可按物理数量叠加，两身份均被动', () => {
    for (const id of ['triumphRebate', 'predictionPolicy'] as const) {
      expect(createCardDeck([]).filter((card) => card === id)).toHaveLength(5)
      expect(cardTargetScope(id)).toBe('none'); expect(validCardMultiplicity([id, id])).toBe(true)
    }
    expect(identitySkillMode('insurer')).toBe('passive'); expect(identitySkillMode('connoisseur')).toBe('passive')
    expect(defaultBotStrategy().identityPriority).toEqual(expect.arrayContaining(['insurer', 'connoisseur']))
  })
  it.each(['insurer', 'connoisseur'] as IdentityId[])('Bot 可选 %s，持新卡的计划合法且同局确定', (identityId) => {
    const settings = createDefaultSettings(3)
    const session = createSession(['甲', '乙', '丙'], settings)
    const p = session.players[0]; p.identity = createPlayerIdentity(identityId)
    p.controller = { kind: 'bot', profileId: 'adaptive', difficulty: 'expert' }
    p.botMemory = emptyBotMemory('expansion'); p.cardInventory = ['triumphRebate', 'predictionPolicy']
    expect(decideBotIdentity({ choices: [identityId], player: p, players: session.players }).identityId).toBe(identityId)
    const observation = buildBotObservation(session, p.id)
    const decision = decideBotTurn(observation, p.controller.profileId, p.controller.difficulty, p.botMemory)
    expect(decision).toEqual(decideBotTurn(observation, p.controller.profileId, p.controller.difficulty, p.botMemory))
    expect(decision.bidUnits).toBeGreaterThanOrEqual(0); expect(decision.bidUnits).toBeLessThanOrEqual(p.balanceUnits)
  })
  it('鉴赏家新类别有真实增益；Bot 愿为第四类支付合理溢价', () => {
    const p = players()[0]; p.identity = createPlayerIdentity('connoisseur')
    p.identity.connoisseurCategories = ['transport', 'luxury', 'property']
    expect(connoisseurCategoryReward(p, 'leisure')).toBe(40)
    p.controller = { kind: 'bot', profileId: 'collectorBot', difficulty: 'expert' }; p.botMemory = emptyBotMemory('fourth')
    const quote = decideBotAssetAuctionBids({ player: p, lots: [{ id: 'lot', sellerId: 'p1', item: prize, itemRoundIndex: 0, roundIndex: 2, minimumBidUnits: 40 }], budgetUnits: 100, roundIndex: 2, totalRounds: 5, sessionSeed: 'fourth' })
    expect(quote[0].bidUnits).toBeGreaterThanOrEqual(40)
  })
})
