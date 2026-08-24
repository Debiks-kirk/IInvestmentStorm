import { describe, expect, it } from 'vitest'
import { canMakeIdentityGuess, createStarsDivination, createWealthDivination, drawProphetRewardCard, getProphetIdentityProgress, hasReachedProphetIdentityMilestone } from './prophet'
import type { ProphetDivination } from './types'

describe('预言家天机推演', () => {
  it('观财只使用开局快照，并令每个区间包含真实余额', () => {
    const intel = createWealthDivination({ id: 'd', playerId: 'p', roundIndex: 1, costUnits: 10, balanceSnapshot: { a: 30, b: 7, c: 18 }, roll: () => .5 })
    expect(intel.wealth?.highestRangeUnits[0]).toBeLessThanOrEqual(30)
    expect(intel.wealth?.highestRangeUnits[1]).toBeGreaterThanOrEqual(30)
    expect(intel.wealth?.lowestRangeUnits[0]).toBeLessThanOrEqual(7)
    expect(intel.wealth?.lowestRangeUnits[1]).toBeGreaterThanOrEqual(7)
  })

  it('观星至多展示未来两轮，最后一轮不可用', () => {
    const deck = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never
    expect(createStarsDivination({ id: 'd', playerId: 'p', roundIndex: 0, costUnits: 10, prophecyDeck: deck })?.starItemIds).toEqual(['b', 'c'])
    expect(createStarsDivination({ id: 'd', playerId: 'p', roundIndex: 2, costUnits: 10, prophecyDeck: deck })).toBeNull()
  })

  it('观身份限制重复组合与已猜对玩家', () => {
    const history = [{ id: 'a', playerId: 'p', roundIndex: 0, mode: 'identity', costUnits: 10, identityGuess: { targetPlayerId: 't', identityId: 'gambler', correct: false } }, { id: 'b', playerId: 'p', roundIndex: 1, mode: 'identity', costUnits: 10, identityGuess: { targetPlayerId: 'win', identityId: 'collector', correct: true } }] as const
    expect(canMakeIdentityGuess([...history], 'p', 't', 'gambler')).toBe(false)
    expect(canMakeIdentityGuess([...history], 'p', 't', 'collector')).toBe(true)
    expect(canMakeIdentityGuess([...history], 'p', 'win', 'prophet')).toBe(false)
  })

  it('三人局识破两名其他玩家时立即达到六选二里程碑', () => {
    const history: ProphetDivination[] = [{
      id: 'three-player-milestone', playerId: 'prophet', roundIndex: 1, mode: 'identity', costUnits: 0,
      identityGuesses: [
        { targetPlayerId: 'a', identityId: 'gambler', correct: true },
        { targetPlayerId: 'b', identityId: 'merchant', correct: true },
      ],
    }]
    expect(hasReachedProphetIdentityMilestone(history, 'prophet', 3)).toBe(true)
    expect(hasReachedProphetIdentityMilestone(history, 'prophet', 4)).toBe(false)
  })

  it('同一回合的两次观身份都会计入排除与已识破限制', () => {
    const history: ProphetDivination[] = [{
      id: 'two-guesses', playerId: 'p', roundIndex: 2, mode: 'identity', costUnits: 0,
      identityGuesses: [
        { targetPlayerId: 'a', identityId: 'gambler', correct: false },
        { targetPlayerId: 'b', identityId: 'collector', correct: true },
      ],
    }]
    expect(canMakeIdentityGuess([...history], 'p', 'a', 'gambler')).toBe(false)
    expect(canMakeIdentityGuess([...history], 'p', 'a', 'merchant')).toBe(true)
    expect(canMakeIdentityGuess([...history], 'p', 'b', 'prophet')).toBe(false)
  })

  it('会从历史记录重建持久排除与识破状态', () => {
    const history: ProphetDivination[] = [{
      id: 'past', playerId: 'p', roundIndex: 0, mode: 'identity', costUnits: 0,
      identityGuesses: [
        { targetPlayerId: 'target', identityId: 'gambler', correct: false },
        { targetPlayerId: 'target', identityId: 'merchant', correct: false },
      ],
    }, {
      id: 'solved', playerId: 'p', roundIndex: 1, mode: 'identity', costUnits: 0,
      identityGuess: { targetPlayerId: 'solved-target', identityId: 'collector', correct: true },
    }]
    expect(getProphetIdentityProgress(history, 'p', 'target')).toEqual({ excludedIdentityIds: ['gambler', 'merchant'] })
    expect(getProphetIdentityProgress(history, 'p', 'solved-target')).toEqual({ excludedIdentityIds: [], solvedIdentityId: 'collector' })
  })

  it('观身份奖励从未预留的实体卡池抽卡，允许抽到已有同名卡，空池时补一张', () => {
    const drawn = drawProphetRewardCard({ cardDeck: ['red', 'black', 'peek'], disabledCardIds: [], heldCardIds: ['red'], reservedCardId: 'black', roll: () => 0 })
    expect(drawn.cardId).toBe('red')
    expect(drawn.cardDeck).toEqual(['black', 'peek'])
    const replenished = drawProphetRewardCard({ cardDeck: [], disabledCardIds: ['red'], heldCardIds: [], roll: () => 0 })
    expect(replenished.replenished).toBe(true)
    expect(replenished.cardId).not.toBe('red')
  })
})
