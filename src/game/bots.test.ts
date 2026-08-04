import { describe, expect, it } from 'vitest'
import { buildBotObservation, decideBotTurn, emptyBotMemory, estimateBalances } from './bots'
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
    expect(first.cardUses.length).toBeLessThanOrEqual(2)
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

  it('命运硬币会在 Bot 提交前固定正反面', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[0].cardInventory = ['fateCoin']
    session.players[0].balanceUnits = 10
    const decision = decideBotTurn(buildBotObservation(session, session.players[0].id), 'comeback', 'standard', emptyBotMemory())
    const coin = decision.cardUses.find((use) => use.cardId === 'fateCoin')
    expect(coin?.coinResult === 'heads' || coin?.coinResult === 'tails').toBe(true)
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
})
