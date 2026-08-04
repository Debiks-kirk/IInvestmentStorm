import { describe, expect, it } from 'vitest'
import { calculateFixedAssets, fixedAssetCoins } from './assets'
import { coinsToUnits, defaultRewards, rankFinalPlayers, settleRound } from './engine'
import { createCardDeck } from './cards'
import { ITEM_POOL } from './items'
import { SYSTEM_PRESETS } from './presets'
import { createDefaultSettings, prepareCardGrants } from './session'
import type { CardUse, Item, Player, RoundTurn } from './types'

const item: Item = { id: 'test', name: '测试物品', value: 5, emoji: '🎁', tone: '#000', category: 'leisure' }

function players(balances: number[]): Player[] {
  return balances.map((balance, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`,
    color: '#000',
    balanceUnits: coinsToUnits(balance),
    items: [],
    cardInventory: [],
  }))
}

function turn(playerId: string, bid: number, predictedPlayerId: string | null = null, cardUse?: CardUse): RoundTurn {
  return { playerId, bidUnits: coinsToUnits(bid), predictedPlayerId, ...(cardUse ? { cardUse } : {}) }
}

function settle(basePlayers: Player[], turns: RoundTurn[], rewardMultipliers = [2, 1, 0.5]) {
  return settleRound({
    playersAfterBids: basePlayers,
    turns,
    item,
    roundIndex: 0,
    rewardMultipliers,
    correctPredictionMultiplier: 1,
    wrongPredictionMultiplier: 0.5,
    fairnessOrderIds: basePlayers.map((player) => player.id),
  })
}

describe('排名与奖励', () => {
  it('按唯一出价从高到低连续排名', () => {
    const result = settle(players([20, 20, 20]), [turn('p1', 9), turn('p2', 7), turn('p3', 2)]).result
    expect(result.rankings.map(({ playerId, place }) => [playerId, place])).toEqual([
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
    ])
    expect(result.winnerId).toBe('p1')
  })

  it('剔除顶部并列，让下一位唯一出价者成为第一名', () => {
    const result = settle(players([20, 20, 20, 20]), [turn('p1', 10), turn('p2', 10), turn('p3', 9), turn('p4', 8)]).result
    expect(result.tiedPlayerIds).toEqual(['p1', 'p2'])
    expect(result.rankings.map(({ playerId, place }) => [playerId, place])).toEqual([
      ['p3', 1],
      ['p4', 2],
    ])
    expect(result.minWinningBidUnits).toBe(coinsToUnits(8))
  })

  it('剔除中间并列且不留下空名次', () => {
    const result = settle(players([20, 20, 20, 20]), [turn('p1', 10), turn('p2', 8), turn('p3', 8), turn('p4', 4)]).result
    expect(result.rankings.map(({ playerId, place }) => [playerId, place])).toEqual([
      ['p1', 1],
      ['p4', 2],
    ])
  })

  it('全员并列时流拍且不存在最低获奖线', () => {
    const result = settle(players([20, 20, 20]), [turn('p1', 0, 'p2'), turn('p2', 0, 'p1'), turn('p3', 0)]).result
    expect(result.winnerId).toBeNull()
    expect(result.rankings).toEqual([])
    expect(result.minWinningBidUnits).toBeNull()
    expect(result.predictionOutcomes.map((outcome) => outcome.status)).toEqual(['wrong', 'wrong', 'skipped'])
  })
})

describe('预测结算', () => {
  it('先发放第一名奖励，再扣其猜错罚款和被猜中赔付', () => {
    const base = players([0, 10, 10])
    const { players: settled, result } = settle(base, [turn('p1', 10, 'p2'), turn('p2', 5, 'p1'), turn('p3', 1, 'p1')])
    expect(result.winnerId).toBe('p1')
    expect(settled.find((player) => player.id === 'p1')?.balanceUnits).toBe(0)
    expect(result.winnerPaymentUnits).toBe(coinsToUnits(7.5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.predictionUnits).toBe(coinsToUnits(-10))
  })

  it('余额不足时以半金币为单位公平分完，差额不超过半金币', () => {
    const base = players([1, 0, 0, 0])
    const { players: settled, result } = settle(base, [
      turn('p1', 8),
      turn('p2', 5, 'p1'),
      turn('p3', 4, 'p1'),
      turn('p4', 3, 'p1'),
    ])
    const payments = result.predictionOutcomes.filter((outcome) => outcome.status === 'correct').map((outcome) => outcome.deltaUnits)
    expect(Math.max(...payments) - Math.min(...payments)).toBeLessThanOrEqual(1)
    expect(payments.reduce((sum, payment) => sum + payment, 0)).toBe(result.winnerPaymentUnits)
    expect(settled.find((player) => player.id === 'p1')?.balanceUnits).toBe(0)
  })

  it('错误预测最多扣到零', () => {
    const { players: settled } = settle(players([0, 0, 0, 1]), [
      turn('p1', 8),
      turn('p2', 6),
      turn('p3', 4),
      turn('p4', 2, 'p2'),
    ])
    expect(settled.find((player) => player.id === 'p4')?.balanceUnits).toBe(0)
  })
})

describe('配置与终局', () => {
  it('按人数提供默认奖励档位', () => {
    expect(defaultRewards(3)).toEqual([2, 1])
    expect(defaultRewards(5)).toEqual([2, 1, 0.5])
    expect(defaultRewards(10)).toEqual([2, 1.5, 1, 0.5])
  })

  it('最终同金币共享名次，后续名次按竞赛排名跳号', () => {
    const standings = rankFinalPlayers(players([12, 20, 20, 5]))
    expect(standings.map((standing) => standing.place)).toEqual([1, 1, 3, 4])
  })
})

describe('道具卡结算', () => {
  it('红卡与黑卡相乘后回到原价值，并使用修改后的价值结算预测', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 9, null, { cardId: 'red' }),
      turn('p2', 7, 'p1', { cardId: 'black' }),
      turn('p3', 2, 'p1'),
    ]).result
    expect(result.effectiveValueUnits).toBe(coinsToUnits(5))
    expect(result.cardEffects.map((effect) => effect.cardId)).toEqual(expect.arrayContaining(['red', 'black']))
    expect(result.predictionOutcomes.filter((outcome) => outcome.status === 'correct').map((outcome) => outcome.deltaUnits)).toEqual([coinsToUnits(5), coinsToUnits(5)])
  })

  it('黑卡的 1.5V 奖励与 0.5V 罚款均向下取到半金币', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 9, null, { cardId: 'black' }),
      turn('p2', 7, 'p3'),
      turn('p3', 2),
    ], [2, 1.5]).result
    expect(result.effectiveValueUnits).toBe(coinsToUnits(2.5))
    expect(result.rankings[1]?.rewardUnits).toBe(coinsToUnits(3.5))
    expect(result.predictionOutcomes.find((outcome) => outcome.playerId === 'p2')?.deltaUnits).toBe(coinsToUnits(-1))
  })

  it('偷天换日只交换排名金额，不改变公开总下注或实际扣款', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 10),
      turn('p2', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
      turn('p3', 8),
    ]).result
    expect(result.totalBidUnits).toBe(coinsToUnits(22))
    expect(result.winnerId).toBe('p2')
    expect(result.rankings.find((entry) => entry.playerId === 'p2')).toMatchObject({ bidUnits: coinsToUnits(10), actualBidUnits: coinsToUnits(4) })
  })

  it('偷看底牌只留下匿名结算说明，不影响排名或金币', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 10),
      turn('p2', 4, null, { cardId: 'peek', targetPlayerId: 'p1' }),
      turn('p3', 8),
    ]).result
    expect(result.winnerId).toBe('p1')
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'peek' })]))
    expect(result.deltas.every((delta) => delta.cardUnits === 0)).toBe(true)
  })

  it('反客为主在交换后将自己的排名金额翻倍', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 5),
      turn('p2', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
      turn('p3', 8, null, { cardId: 'doubleBid' }),
    ]).result
    expect(result.winnerId).toBe('p3')
    expect(result.rankings[0]).toMatchObject({ playerId: 'p3', bidUnits: coinsToUnits(16), actualBidUnits: coinsToUnits(8) })
  })

  it('劫富济贫在奖励前按半金币公平分配，并在公开收益中保持匿名', () => {
    const result = settle(players([20, 4, 4]), [
      turn('p1', 1, null, { cardId: 'redistribute' }),
      turn('p2', 1),
      turn('p3', 1),
    ]).result
    expect(result.cardEffects[0]?.cardId).toBe('redistribute')
    expect(result.redistributionTransferUnits).toBe(coinsToUnits(5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(coinsToUnits(-5))
    expect(result.deltas.find((delta) => delta.playerId === 'p2')?.cardUnits).toBe(coinsToUnits(2.5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.publicDeltaUnits).not.toBe(result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits)
  })

  it('结算后记录唯一或并列余额领跑者', () => {
    const result = settle(players([10, 10, 10]), [turn('p1', 9), turn('p2', 7), turn('p3', 2)]).result
    expect(result.balanceLeaderIds).toEqual(['p1'])
  })
})

describe('道具发放', () => {
  it('禁用卡不会进入本局不放回牌堆', () => {
    const deck = createCardDeck(['red', 'black', 'peek'])
    expect(deck).not.toEqual(expect.arrayContaining(['red', 'black', 'peek']))
    expect(new Set(deck).size).toBe(deck.length)
  })

  it('唯一最低者必中时获得不放回卡牌', () => {
    const base = players([3, 8, 10])
    const granted = prepareCardGrants({ players: base, cardDeck: ['red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(granted.pendingCardGrants).toEqual([{ playerId: 'p1', cardId: 'red', announced: false }])
    expect(granted.players[0].cardInventory).toEqual(['red'])
    expect(granted.cardDeck).toEqual(['black'])
  })

  it('正余额并列最低者不发卡，零余额并列者各自独立判定', () => {
    const noGrant = prepareCardGrants({ players: players([3, 3, 8]), cardDeck: ['red'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(noGrant.pendingCardGrants).toEqual([])
    const zeroGrant = prepareCardGrants({ players: players([0, 0, 8]), cardDeck: ['red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(zeroGrant.pendingCardGrants).toHaveLength(2)
    expect(new Set(zeroGrant.pendingCardGrants.map((grant) => grant.cardId)).size).toBe(2)
  })

  it('第一位操作玩家抽到偷看底牌时改抽另一张卡，偷看卡留在池中', () => {
    const granted = prepareCardGrants({ players: players([0, 8, 10]), cardDeck: ['peek', 'red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(granted.pendingCardGrants[0]?.cardId).toBe('red')
    expect(granted.cardDeck).toEqual(['peek', 'black'])
  })
})

describe('固定资产与默认配置', () => {
  it('所有拍品都恰好归入四类资产', () => {
    expect(ITEM_POOL).toHaveLength(29)
    expect(new Set(ITEM_POOL.map((entry) => entry.category))).toEqual(new Set(['leisure', 'transport', 'luxury', 'property']))
  })

  it('按类别与实际数量计算轻量固定资产档位', () => {
    expect(fixedAssetCoins('leisure', 1)).toBe(0)
    expect(fixedAssetCoins('leisure', 2)).toBe(3)
    expect(fixedAssetCoins('leisure', 3)).toBe(10)
    expect(fixedAssetCoins('leisure', 4)).toBe(20)
    expect(fixedAssetCoins('leisure', 5)).toBe(30)
    expect(fixedAssetCoins('property', 5)).toBe(72)
  })

  it('固定资产只在终局并入总资产并改变终局名次', () => {
    const base = players([22, 25, 18])
    base[0].items = ITEM_POOL.filter((entry) => entry.category === 'leisure').slice(0, 3).map((item, roundIndex) => ({ item, roundIndex }))
    const standings = rankFinalPlayers(base)
    expect(base[0].balanceUnits).toBe(coinsToUnits(22))
    expect(standings[0]).toMatchObject({ player: { id: 'p1' }, cashUnits: coinsToUnits(22), fixedAssetUnits: coinsToUnits(10), totalAssetUnits: coinsToUnits(32), place: 1 })
    expect(calculateFixedAssets(base[0].items).find((entry) => entry.category === 'leisure')).toMatchObject({ itemCount: 3, units: coinsToUnits(10) })
  })

  it('新默认设置与三个系统配置使用确认后的规则', () => {
    expect(createDefaultSettings()).toMatchObject({ wrongPredictionMultiplier: 1.5, cardGrantProbability: 80, revealBalanceLeader: false })
    expect(SYSTEM_PRESETS.map((preset) => [preset.settings.playerCount, preset.settings.rounds, preset.settings.initialCoins])).toEqual([[3, 4, 30], [6, 6, 30], [10, 8, 40]])
  })
})
