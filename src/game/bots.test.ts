import { describe, expect, it } from 'vitest'
import { buildBotObservation, decideBotTurn, emptyBotMemory } from './bots'
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
    expect(JSON.stringify(observation)).not.toContain('77')
    expect(JSON.stringify(observation)).not.toContain('33')
    expect(JSON.stringify(observation)).not.toContain('red')
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

  it('命运硬币会在 Bot 提交前固定正反面', () => {
    const session = createSession(seats(), createDefaultSettings(3))
    session.players[0].cardInventory = ['fateCoin']
    session.players[0].balanceUnits = 10
    const decision = decideBotTurn(buildBotObservation(session, session.players[0].id), 'comeback', 'standard', emptyBotMemory())
    const coin = decision.cardUses.find((use) => use.cardId === 'fateCoin')
    expect(coin?.coinResult === 'heads' || coin?.coinResult === 'tails').toBe(true)
  })

  it('预设会保存 Bot 座位与难度', () => {
    const preset = createGamePreset('Bot 局', seats('expert'), createDefaultSettings(3))
    expect(preset.seats?.[0].controller).toEqual({ kind: 'bot', profileId: 'adaptive', difficulty: 'expert' })
  })
})
