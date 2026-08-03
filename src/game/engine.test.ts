import { describe, expect, it } from 'vitest'
import { coinsToUnits, defaultRewards, rankFinalPlayers, settleRound } from './engine'
import type { Item, Player, RoundTurn } from './types'

const item: Item = { id: 'test', name: '测试物品', value: 5, emoji: '🎁', tone: '#000' }

function players(balances: number[]): Player[] {
  return balances.map((balance, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`,
    color: '#000',
    balanceUnits: coinsToUnits(balance),
    items: [],
  }))
}

function turn(playerId: string, bid: number, predictedPlayerId: string | null = null): RoundTurn {
  return { playerId, bidUnits: coinsToUnits(bid), predictedPlayerId }
}

function settle(basePlayers: Player[], turns: RoundTurn[]) {
  return settleRound({
    playersAfterBids: basePlayers,
    turns,
    item,
    roundIndex: 0,
    rewardMultipliers: [2, 1, 0.5],
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
