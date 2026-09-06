import { describe, expect, it } from 'vitest'
import { botCollectibleChance, buildBotObservation, decideBotTurn, decideBotMerchantBid, decideBotMerchantOffer, defaultBotStrategy, emptyBotMemory, normalizeBotStrategy } from './bots'
import { createDefaultSettings, createSession } from './session'
import { createPlayerIdentity } from './identities'
import { bindParticipantMember, createBotMember } from './members'
import type { BotStrategyConfig, CardId, Player } from './types'

const fields = ['risk', 'bankroll', 'collection', 'market', 'cards', 'identity', 'interference', 'prediction', 'comeback'] as const

function fixture(strategy: BotStrategyConfig, seed: string) {
  const session = createSession([
    { name: '测试', controller: { kind: 'bot', profileId: 'custom', difficulty: 'expert', customProfile: { ...strategy, id: 'test', name: '测试', createdAt: '', updatedAt: '' } } },
    { name: '乙', controller: { kind: 'human' } }, { name: '丙', controller: { kind: 'human' } },
  ], createDefaultSettings(3))
  session.id = seed
  session.players.forEach((player, index) => { player.id = `player-${index}` })
  session.settings.rounds = 8
  session.roundIndex = 2
  const player = session.players[0]
  player.botMemory = emptyBotMemory(seed, strategy)
  player.cardInventory = ['red', 'black', 'bananaPeel', 'fateCoin']
  player.identity = createPlayerIdentity('thief')
  const item = { ...session.itemDeck[0], id: 'fixed-item', category: 'property' as const, value: 10 }
  session.itemDeck[2] = item
  player.items = [{ item: { ...item, id: 'owned' }, roundIndex: 0 }]
  const observation = buildBotObservation(session, player.id)
  observation.item = item
  observation.self.balanceUnits = 24
  observation.thiefActivationUnits = 4
  observation.correctPredictionMultiplier = 3
  observation.wrongPredictionMultiplier = .25
  observation.previousSubmitterIds = [session.players[1].id, session.players[2].id]
  return { session, player, observation }
}

describe('自定义 Bot 参数审计', () => {
  it('未并列不等于获得藏品；加成按得标概率计算，并正确处理逆转', () => {
    expect(botCollectibleChance(2, .1, .9, 0, 4)).toBe(.1)
    expect(botCollectibleChance(5, 0, .9, 0, 4)).toBe(0)
    expect(botCollectibleChance(4, 0, .9, 1, 4)).toBe(.9)
    expect(botCollectibleChance(1, .8, .9, 1, 4)).toBe(0)
    expect(botCollectibleChance(1, .8, .9, 2, 4)).toBe(.8)
  })
  it('绑定档案只关联成员身份，不用档案默认难度或策略覆盖本局快照', () => {
    const { player } = fixture({ ...defaultBotStrategy(), risk: 100 }, 'member-binding')
    const member = createBotMember('档案名字', 'steady', 'easy')
    const bound = bindParticipantMember(player, member)
    expect(bound.memberId).toBe(member.id)
    expect(bound.name).toBe(member.name)
    expect(bound.controller).toEqual(player.controller)
    expect(bound.botMemory).toEqual(player.botMemory)
    const operator = { id: 'operator', name: '操作者', controller: player.controller!, botMemory: player.botMemory }
    expect(bindParticipantMember(operator, member).controller).toEqual(operator.controller)
  })

  it('逆转者免费资格计入本轮规划费用', () => {
    const { session, player } = fixture(defaultBotStrategy(), 'free-reverser')
    player.identity = { ...createPlayerIdentity('reverser'), reverserFreeRoundIndex: session.roundIndex }
    expect(buildBotObservation(session, player.id).reverserActivationUnits).toBe(0)
    player.identity.reverserFreeRoundIndex = session.roundIndex - 1
    expect(buildBotObservation(session, player.id).reverserActivationUnits).toBeGreaterThan(0)
  })
  it.each(fields)('%s 经过规范化保留端点并限制非法范围', (field) => {
    expect(normalizeBotStrategy({ [field]: 0 })[field]).toBe(0)
    expect(normalizeBotStrategy({ [field]: 100 })[field]).toBe(100)
    expect(normalizeBotStrategy({ [field]: -1 })[field]).toBe(0)
    expect(normalizeBotStrategy({ [field]: 101 })[field]).toBe(100)
  })

  it.each(fields)('%s 在固定种子的同局面对照中影响实际决策，而非仅修改理由', (field) => {
    let differences = 0
    for (let index = 0; index < (field === 'prediction' ? 80 : 36); index += 1) {
      const outcomes = [0, 100].map((value) => {
        const strategy = { ...defaultBotStrategy(), [field]: value }
        const { player, observation } = fixture(strategy, `${field === 'prediction' ? 'prediction' : 'parameter'}-${index}`)
        // Sweep public financial situations, keeping each low/high pair identical.
        if (field !== 'prediction') observation.self.balanceUnits = 8 + index * 2
        observation.correctPredictionMultiplier = field === 'prediction' ? .1 + index * .1 : .5 + index * .2
        const decision = decideBotTurn(observation, 'custom', 'expert', player.botMemory!)
        expect(decision.bidUnits).toBeGreaterThanOrEqual(0)
        expect(decision.bidUnits).toBeLessThanOrEqual(observation.self.balanceUnits)
        expect(new Set(decision.cardUses.map((use) => use.cardId)).size).toBe(decision.cardUses.length)
        return JSON.stringify({ bid: decision.bidUnits, prediction: decision.predictedPlayerId, cards: decision.cardUses, skill: decision.identityAction, market: decideBotMerchantBid(player, 'red').bidUnits })
      })
      if (outcomes[0] !== outcomes[1]) differences += 1
    }
    expect(differences, `${field} 未影响任何实际决策`).toBeGreaterThan(0)
  })

  it('提高预测积极度不会在相同计划中减少预测次数', () => {
    let lowCount = 0
    let highCount = 0
    for (let index = 0; index < 80; index += 1) {
      const results = [0, 100].map((prediction) => {
        const strategy = { ...defaultBotStrategy(), prediction }
        const { player, observation } = fixture(strategy, `prediction-${index}`)
        observation.correctPredictionMultiplier = .1 + index * .1
        return decideBotTurn(observation, 'custom', 'expert', player.botMemory!).predictedPlayerId !== null
      })
      expect(!results[0] || results[1]).toBe(true)
      lowCount += Number(results[0]); highCount += Number(results[1])
    }
    expect(highCount).toBeGreaterThan(lowCount)
  })

  it('已读取偷看情报的所有最终动作必须消耗对应道具且只用一次', () => {
    for (let index = 0; index < 20; index += 1) {
      const { player, observation } = fixture(defaultBotStrategy(), `peek-lock-${index}`)
      observation.self.cardInventory.push('peek')
      observation.legalPeek = { playerId: 'player-1', bidUnits: 18 }
      const decision = decideBotTurn(observation, 'custom', 'expert', player.botMemory!)
      expect(decision.cardUses.filter((use) => use.cardId === 'peek')).toEqual([{ cardId: 'peek', targetPlayerId: 'player-1' }])
    }
  })

  it('没有记忆快照时仍读取自定义模板，已有快照不受模板修改影响', () => {
    const { player } = fixture({ ...defaultBotStrategy(), bankroll: 100, cards: 0, market: 0 }, 'fallback')
    const withoutMemory: Player = { ...player, botMemory: undefined }
    const withDefaultBehavior = { ...withoutMemory, botMemory: emptyBotMemory(player.id, player.botMemory!.strategy) }
    expect(decideBotMerchantBid(withoutMemory, 'red').bidUnits).toBe(decideBotMerchantBid(withDefaultBehavior, 'red').bidUnits)
    const before = decideBotMerchantBid(player, 'red')
    if (player.controller?.kind === 'bot' && player.controller.customProfile) player.controller.customProfile.cards = 100
    expect(decideBotMerchantBid(player, 'red')).toEqual(before)
  })

  it('商人选卡不修改锁定候选数组', () => {
    const { player } = fixture(defaultBotStrategy(), 'merchant')
    const offers: CardId[] = ['red', 'fateCoin', 'black']
    const before = [...offers]
    expect(offers).toContain(decideBotMerchantOffer(player, offers, 2, 'merchant'))
    expect(offers).toEqual(before)
  })
})
