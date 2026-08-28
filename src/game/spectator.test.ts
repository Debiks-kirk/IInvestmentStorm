import { describe, expect, it } from 'vitest'
import { createDefaultSettings, createSession } from './session'
import { appendSpectatorEvent, createSpectatorChart, createSpectatorPlayerStats, createTurnSpectatorEvent } from './spectator'
import type { SeatConfig } from './types'

const botSeats = (count: number): SeatConfig[] => Array.from({ length: count }, (_, index) => ({
  name: `机器人${index + 1}`,
  controller: { kind: 'bot', profileId: index % 2 ? 'steady' : 'adaptive', difficulty: 'standard' },
}))

describe('全 Bot 观战数据', () => {
  it('只为全 Bot 新局启用观战，混合局继续遵守私密流程', () => {
    expect(createSession(botSeats(3), createDefaultSettings(3)).spectatorMode).toBe(true)
    expect(createSession([botSeats(3)[0], { name: '真人', controller: { kind: 'human' } }, botSeats(3)[2]], createDefaultSettings(3)).spectatorMode).toBe(false)
  })

  it('事件序号稳定、待播队列与完整历史同步增长', () => {
    const session = createSession(botSeats(3), createDefaultSettings(3))
    const first = appendSpectatorEvent(session, { roundIndex: 0, type: 'identityChoice', playerId: session.players[0].id, summary: '选择身份', details: ['候选两张'] })
    const secondSession = { ...session, ...first }
    const second = appendSpectatorEvent(secondSession, { roundIndex: 0, type: 'turn', playerId: session.players[0].id, summary: '确认操作', details: ['下注 5'] })
    expect(second.spectatorEvents.map((event) => event.sequence)).toEqual([0, 1])
    expect(second.pendingSpectatorEvents.map((event) => event.id)).toEqual(second.spectatorEvents.map((event) => event.id))
  })

  it('操作事件只包含最终选择，不包含 Bot 的内部理由', () => {
    const session = createSession(botSeats(3), createDefaultSettings(3))
    const event = createTurnSpectatorEvent(session, { playerId: session.players[0].id, bidUnits: 15, predictedPlayerId: session.players[1].id, auctionBids: session.roundAuctions.map((lot) => ({ lotId: lot.id, bidUnits: 2 })), cardUses: [] })
    expect(event.details).toContain('下注 7.5 金币')
    expect(event.details.join(' ')).toContain(session.players[1].name)
    expect(JSON.stringify(event)).not.toContain('reason')
    expect(JSON.stringify(event)).not.toContain('score')
  })

  it('核心统计与四种曲线在空局和已完成局均有安全结果', () => {
    const session = createSession(botSeats(6), createDefaultSettings(6))
    const stats = createSpectatorPlayerStats(session)
    expect(stats).toHaveLength(6)
    expect(stats.every((entry) => entry.cashUnits === 60 && entry.totalBidUnits === 0)).toBe(true)
    for (const key of ['assets', 'cash', 'bids', 'net'] as const) {
      const chart = createSpectatorChart(session, key)
      expect(chart).toHaveLength(1)
      expect(Object.keys(chart[0].values)).toHaveLength(6)
    }
  })
})
