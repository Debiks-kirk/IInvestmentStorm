import { describe, expect, it } from 'vitest'
import { emptyBotMemory } from './bots'
import { cardInventoryCounts, removeOneCard } from './cards'
import { coinsToUnits } from './engine'
import { createDefaultSettings, createRematchSession, createSession, createTutorialSession, roundPlayerIndices } from './session'

describe('轮转操作顺序', () => {
  it('保持座位不变，并且每轮将起点向后顺移一位', () => {
    expect(roundPlayerIndices(0, 3)).toEqual([0, 1, 2])
    expect(roundPlayerIndices(1, 3)).toEqual([1, 2, 0])
    expect(roundPlayerIndices(2, 3)).toEqual([2, 0, 1])
    expect(roundPlayerIndices(3, 3)).toEqual([0, 1, 2])
  })

  it('可用于任意人数的同一圆桌传递顺序', () => {
    expect(roundPlayerIndices(4, 6)).toEqual([4, 5, 0, 1, 2, 3])
  })
})

describe('实体道具库存', () => {
  it('同名道具可叠加，消耗时只移除一张', () => {
    const inventory = ['red', 'red', 'black'] as const
    expect(cardInventoryCounts([...inventory])).toEqual([{ cardId: 'red', count: 2 }, { cardId: 'black', count: 1 }])
    expect(removeOneCard([...inventory], 'red')).toEqual(['red', 'black'])
  })
})

describe('系统道具竞购数量', () => {
  it('会按每回合配置抽取对应数量，并允许设为零关闭', () => {
    const settings = createDefaultSettings(3)
    settings.rounds = 3
    settings.systemAuctionCardsPerRound = 3
    const crowded = createSession(['甲', '乙', '丙'], settings)
    expect(crowded.roundAuctions).toHaveLength(3)
    expect(crowded.cardDeck).toHaveLength(45 - 3)

    settings.systemAuctionCardsPerRound = 0
    const disabled = createSession(['甲', '乙', '丙'], settings)
    expect(disabled.roundAuctions).toEqual([])
    expect(disabled.cardDeck).toHaveLength(45)
  })
})

describe('再来一局', () => {
  const seats = [
    { name: '阿岚', controller: { kind: 'human' as const } },
    { name: '火花', controller: { kind: 'bot' as const, profileId: 'aggressive' as const, difficulty: 'expert' as const } },
    { name: '馆长', controller: { kind: 'bot' as const, profileId: 'collectorBot' as const, difficulty: 'standard' as const } },
  ]

  function playedSession() {
    const session = createSession(seats, createDefaultSettings(3))
    const [human, spark, curator] = session.players
    spark.balanceUnits = coinsToUnits(7)
    spark.cardInventory = ['red']
    spark.items = [{ item: session.itemDeck[0], roundIndex: 0 }]
    spark.identity = { id: 'reverser', thiefSuccesses: 0, merchantAuctionUsed: true, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    spark.botMemory = {
      ...emptyBotMemory(),
      grudgeByPlayerId: { [human.id]: 4, [curator.id]: -2 },
      lastMode: 'revenge',
      decisionLog: [{ stage: 'turn', roundIndex: 0, mode: 'revenge', reason: '测试记录' }],
    }
    return session
  }

  it('原班再来一局保留座位与规则，但重置局内资产和 Bot 记忆', () => {
    const previous = playedSession()
    const next = createRematchSession(previous)
    expect(next.id).not.toBe(previous.id)
    expect(next.players.map((player) => [player.name, player.controller])).toEqual(previous.players.map((player) => [player.name, player.controller]))
    expect(next.players.map((player) => player.id)).not.toEqual(previous.players.map((player) => player.id))
    expect(next.players.every((player) => player.balanceUnits === coinsToUnits(previous.settings.initialCoins) && player.items.length === 0 && player.cardInventory.length === 0 && !player.identity)).toBe(true)
    expect(next.results).toEqual([])
    expect(next.players[1].botMemory?.grudgeByPlayerId).toEqual({})
    expect(next.players[1].botMemory?.decisionLog).toEqual([])
    expect(next.players[1].botMemory?.behavior).not.toEqual(previous.players[1].botMemory?.behavior)
  })

  it('复仇局只将 Bot 对座位的恩怨映射到新玩家 ID', () => {
    const previous = playedSession()
    const next = createRematchSession(previous, true)
    const previousSpark = previous.players[1]
    const nextSpark = next.players[1]
    expect(nextSpark.botMemory?.grudgeByPlayerId).toEqual({
      [next.players[0].id]: previousSpark.botMemory?.grudgeByPlayerId[previous.players[0].id],
      [next.players[2].id]: previousSpark.botMemory?.grudgeByPlayerId[previous.players[2].id],
    })
    expect(nextSpark.botMemory?.behavior).not.toEqual(previousSpark.botMemory?.behavior)
    expect(nextSpark.botMemory?.decisionLog).toEqual([])
    expect(nextSpark.balanceUnits).toBe(coinsToUnits(previous.settings.initialCoins))
  })
})

describe('新手引导局', () => {
  it('创建固定三轮教学，并为教学座位预备最后一轮才解锁的简单道具和主动身份示例', () => {
    const session = createTutorialSession()
    expect(session.tutorial).toEqual({ kind: 'firstGame' })
    expect(session.phase).toBe('roundIntro')
    expect(session.settings).toMatchObject({ playerCount: 3, rounds: 3, cardGrantProbability: 0, systemAuctionCardsPerRound: 0 })
    expect(session.itemDeck.map((item) => item.id)).toEqual(['basketball', 'camera', 'apartment'])
    expect(session.players[0]).toMatchObject({ name: '新手', cardInventory: ['doubleBid'], identity: { id: 'reverser' } })
  })
})
