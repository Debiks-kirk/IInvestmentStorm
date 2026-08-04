import { describe, expect, it } from 'vitest'
import { createGameHighlights, createRoundBulletin } from './highlights'
import { createDefaultSettings, createSession } from './session'
import { settleRound } from './engine'

describe('终局名场面与局势播报', () => {
  it('从既有结算生成五张紧凑名场面卡，不改变会话数据', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    const settled = settleRound({ playersAfterBids: session.players, turns: [{ playerId: session.players[0].id, bidUnits: 14, predictedPlayerId: null }, { playerId: session.players[1].id, bidUnits: 8, predictedPlayerId: session.players[0].id }, { playerId: session.players[2].id, bidUnits: 2, predictedPlayerId: null }], item: session.itemDeck[0], roundIndex: 0, rewardMultipliers: session.settings.rewardMultipliers, correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: session.fairnessOrderIds })
    const highlights = createGameHighlights({ players: settled.players, results: [settled.result] })
    expect(highlights).toHaveLength(5)
    expect(highlights.map((highlight) => highlight.id)).toEqual(['boldestBid', 'sharpestPrediction', 'cardMoment', 'comeback', 'collector'])
    expect(highlights[0].detail).toContain('甲')
  })

  it('局势播报不泄露下注或余额数值', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    const settled = settleRound({ playersAfterBids: session.players, turns: [{ playerId: session.players[0].id, bidUnits: 10, predictedPlayerId: null }, { playerId: session.players[1].id, bidUnits: 9, predictedPlayerId: null }, { playerId: session.players[2].id, bidUnits: 2, predictedPlayerId: null }], item: session.itemDeck[0], roundIndex: 0, rewardMultipliers: session.settings.rewardMultipliers, correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: session.fairnessOrderIds })
    const bulletin = createRoundBulletin(settled.result, undefined, false)
    expect(bulletin).toBe('有人以极小优势压线获奖。')
    expect(bulletin).not.toMatch(/5|4|3|2|1|0/)
  })
})
