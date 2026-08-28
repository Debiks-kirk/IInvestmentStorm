import { describe, expect, it } from 'vitest'
import { defaultBotStrategy, emptyBotMemory } from './bots'
import { cardInventoryCounts, createCardDeck, removeOneCard } from './cards'
import { coinsToUnits } from './engine'
import { ITEM_POOL } from './items'
import { activeOperator, createDefaultSettings, createRematchSession, createSession, createTutorialSession, relayOperatorForRound, resolveRoundPrize, roundPlayerIndices, visibleRoundItem } from './session'
import type { PendingPrizeChange, RoundTurn } from './types'

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

describe('接力操作者调度', () => {
  const human = { kind: 'human' as const }
  const bot = { kind: 'bot' as const, profileId: 'adaptive' as const, difficulty: 'standard' as const }
  const relaySeats = [
    { name: '甲队', operators: [{ id: 'a-1', name: '甲一', controller: human }, { id: 'a-2', name: '甲二', controller: bot }] },
    { name: '乙队', operators: [{ id: 'b-1', name: '乙一', controller: human }] },
    { name: '丙队', operators: [{ id: 'c-1', name: '丙一', controller: bot }, { id: 'c-2', name: '丙二', controller: bot }, { id: 'c-3', name: '丙三', controller: human }] },
  ]

  it('按回合轮换、单操作者固定，且资产仍只属于竞争玩家', () => {
    const settings = createDefaultSettings(3); settings.rounds = 5
    const session = createSession(relaySeats, settings, { mode: 'relay', relayMethod: 'rotation' })
    const [a, b, c] = session.players
    expect(session.mode).toBe('relay')
    expect(relayOperatorForRound(a, 0, 5, 'rotation').name).toBe('甲一')
    expect(relayOperatorForRound(a, 1, 5, 'rotation').name).toBe('甲二')
    expect(relayOperatorForRound(a, 4, 5, 'rotation').name).toBe('甲一')
    expect(relayOperatorForRound(b, 3, 5, 'rotation').name).toBe('乙一')
    expect(relayOperatorForRound(c, 2, 5, 'rotation').name).toBe('丙三')
    expect(a.items).toEqual([])
    expect(a.relayOperators).toHaveLength(2)
    expect(a.relayOperators?.[1].botMemory).toBeTruthy()
  })

  it('分段接力均分回合，余数优先给前面的操作者', () => {
    const settings = createDefaultSettings(3); settings.rounds = 8
    const session = createSession(relaySeats, settings, { mode: 'relay', relayMethod: 'segments' })
    const a = session.players[0]
    expect([0, 1, 2, 3].map((round) => relayOperatorForRound(a, round, 8, 'segments').id)).toEqual(['a-1', 'a-1', 'a-1', 'a-1'])
    expect([4, 5, 6, 7].map((round) => relayOperatorForRound(a, round, 8, 'segments').id)).toEqual(['a-2', 'a-2', 'a-2', 'a-2'])
    const c = session.players[2]
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((round) => relayOperatorForRound(c, round, 8, 'segments').id)).toEqual(['c-1', 'c-1', 'c-1', 'c-2', 'c-2', 'c-2', 'c-3', 'c-3'])
    expect(activeOperator({ ...session, roundIndex: 6 }, c).id).toBe('c-3')
  })

  it('复仇局保留接力安排，并只把 Bot 操作者的恩怨映射到新竞争玩家', () => {
    const settings = createDefaultSettings(3); settings.rounds = 4
    const session = createSession(relaySeats, settings, { mode: 'relay', relayMethod: 'rotation' })
    const botOperator = session.players[0].relayOperators?.[1]!
    botOperator.botMemory = { ...emptyBotMemory(), grudgeByPlayerId: { [session.players[1].id]: 6 } }
    const rematch = createRematchSession(session, true)
    const rematchOperator = rematch.players[0].relayOperators?.[1]
    expect(rematch.mode).toBe('relay')
    expect(rematch.relayMethod).toBe('rotation')
    expect(rematchOperator?.name).toBe('甲二')
    expect(rematchOperator?.botMemory?.grudgeByPlayerId).toEqual({ [rematch.players[1].id]: 6 })
    expect(rematchOperator?.botMemory?.decisionLog).toEqual([])
  })
})

describe('实体道具库存', () => {
  it('同名道具可叠加，消耗时只移除一张', () => {
    const inventory = ['red', 'red', 'black'] as const
    expect(cardInventoryCounts([...inventory])).toEqual([{ cardId: 'red', count: 2 }, { cardId: 'black', count: 1 }])
    expect(removeOneCard([...inventory], 'red')).toEqual(['red', 'black'])
  })
})

describe('道具商人末局商店', () => {
  it('新对局会初始化可持久化的私密商店列表', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    expect(session.version).toBe(34)
    expect(session.merchantShops).toEqual([])
  })
})

describe('系统道具竞购数量', () => {
  it('会按每回合配置抽取对应数量，并允许设为零关闭', () => {
    const settings = createDefaultSettings(3)
    settings.rounds = 3
    settings.systemAuctionCardsPerRound = 3
    const crowded = createSession(['甲', '乙', '丙'], settings)
    const totalCardCopies = createCardDeck([]).length
    expect(crowded.roundAuctions).toHaveLength(3)
    expect(crowded.cardDeck).toHaveLength(totalCardCopies - 3)

    settings.systemAuctionCardsPerRound = 0
    const disabled = createSession(['甲', '乙', '丙'], settings)
    expect(disabled.roundAuctions).toEqual([])
    expect(disabled.cardDeck).toHaveLength(totalCardCopies)
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

  it('自定义 Bot 在开局时会写入策略快照，之后不受模板对象修改影响', () => {
    const defaults = defaultBotStrategy('adaptive')
    const strategy = { ...defaults, collection: 91, identityPriority: ['investor' as const, ...defaults.identityPriority.filter((id) => id !== 'investor')] }
    const template = { id: 'template', name: '收藏投资', createdAt: '', updatedAt: '', ...strategy }
    const gameSeats = [{ name: 'Bot', controller: { kind: 'bot' as const, profileId: 'custom' as const, difficulty: 'expert' as const, customProfile: template } }, { name: '乙', controller: { kind: 'human' as const } }, { name: '丙', controller: { kind: 'human' as const } }]
    const session = createSession(gameSeats, createDefaultSettings(3))
    template.collection = 2
    template.identityPriority.reverse()
    expect(session.players[0].botMemory?.strategy).toMatchObject({ collection: 91 })
    expect(session.players[0].botMemory?.strategy.identityPriority[0]).toBe('investor')
    expect(createRematchSession(session).players[0].botMemory?.strategy).toMatchObject({ collection: 91 })
    expect(createRematchSession(session).players[0].botMemory?.strategy.identityPriority[0]).toBe('investor')
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

describe('调包令的隐藏与结算', () => {
  it('其他玩家整轮只看到原拍品，结算才采用与原拍品不同的已选拍品', () => {
    const itemDeck = ITEM_POOL.slice(0, 3)
    const original = itemDeck[0]
    const chosen = ITEM_POOL.find((item) => !itemDeck.some((scheduled) => scheduled.id === item.id))!
    const change: PendingPrizeChange = { playerId: 'bot', roundIndex: 0, cardId: 'prizeSwap', targetRoundIndex: 0, originalItem: original, offeredItems: [chosen], chosenItemId: chosen.id, confirmedItemId: chosen.id }
    const turns: RoundTurn[] = [{ playerId: 'bot', bidUnits: 0, predictedPlayerId: null, cardUses: [{ cardId: 'prizeSwap', prizeReroll: { originalItemId: original.id, offeredItemIds: [chosen.id], chosenItemId: chosen.id, targetRoundIndex: 0 } }], auctionBids: [] }]

    expect(visibleRoundItem(itemDeck, [change], 0, 'human')).toEqual(original)
    const resolved = resolveRoundPrize(itemDeck, turns, 0)
    expect(resolved.item).toEqual(chosen)
    expect(resolved.item?.id).not.toBe(original.id)
    expect(resolved.itemDeck[0]).toEqual(chosen)
  })
})
