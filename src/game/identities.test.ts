import { describe, expect, it } from 'vitest'
import { dealIdentityChoices, defaultIdentitySettings, randomLobbyistTask, routeCardAwards } from './identities'
import { coinsToUnits, rankFinalPlayers, settleRound } from './engine'
import type { Item, Player, RoundTurn } from './types'

const item: Item = { id: 'identity-test', name: '测试物品', value: 5, emoji: '🎁', tone: '#000', category: 'leisure' }
const player = (id: string, balance = 20): Player => ({ id, name: id, color: '#000', balanceUnits: coinsToUnits(balance), items: [], cardInventory: [] })
const turn = (playerId: string, bid: number, predictedPlayerId: string | null = null): RoundTurn => ({ playerId, bidUnits: coinsToUnits(bid), predictedPlayerId })

describe('身份选角与私密卡牌', () => {
  it('从未被选走身份中给出二选一，并在不足时补可重复身份', () => {
    const settings = defaultIdentitySettings(true)
    expect(dealIdentityChoices(['prophet', 'reverser'], settings)).toHaveLength(2)
    const fallback = dealIdentityChoices([], settings)
    expect(fallback).toHaveLength(2)
    expect(fallback).not.toContain('reverser')
  })

  it('同一张新卡只会被一名成功小偷偷走', () => {
    const settings = defaultIdentitySettings(true)
    settings.thiefSuccessProbability = 100
    const players = [player('target'), player('thief-a'), player('thief-b')]
    players[1].identity = { id: 'thief', targetPlayerId: 'target', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    players[2].identity = { id: 'thief', targetPlayerId: 'target', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const routed = routeCardAwards({ players, awards: [{ playerId: 'target', cardId: 'red' }], settings, fairnessOrderIds: players.map((entry) => entry.id), roundIndex: 1, roll: () => 0 })
    expect(routed.players.filter((entry) => entry.cardInventory.includes('red'))).toHaveLength(1)
    expect(routed.notices.find((notice) => notice.playerId === 'target')?.title).toContain('偷走')
  })

  it('小偷达到上限或判定失败时，目标会正常拿到卡', () => {
    const settings = defaultIdentitySettings(true)
    settings.thiefSuccessProbability = 100
    settings.thiefMaxSteals = 1
    const players = [player('target'), player('thief')]
    players[1].identity = { id: 'thief', targetPlayerId: 'target', thiefSuccesses: 1, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const capped = routeCardAwards({ players, awards: [{ playerId: 'target', cardId: 'red' }], settings, fairnessOrderIds: players.map((entry) => entry.id), roundIndex: 1, roll: () => 0 })
    expect(capped.players.find((entry) => entry.id === 'target')?.cardInventory).toContain('red')
    players[1].identity.thiefSuccesses = 0
    settings.thiefSuccessProbability = 0
    const missed = routeCardAwards({ players, awards: [{ playerId: 'target', cardId: 'black' }], settings, fairnessOrderIds: players.map((entry) => entry.id), roundIndex: 1, roll: () => 0 })
    expect(missed.players.find((entry) => entry.id === 'target')?.cardInventory).toContain('black')
  })
})

describe('身份结算', () => {
  it('赌徒猜中获得系统额外收益，跳过会付身份罚款', () => {
    const settings = defaultIdentitySettings(true)
    const players = [player('gambler'), player('winner'), player('skip')]
    players[0].identity = { id: 'gambler', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    players[2].identity = { id: 'gambler', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('gambler', 4, 'winner'), turn('winner', 8), turn('skip', 2)], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: settings })
    expect(settled.result.identityEvents.filter((event) => event.identityId === 'gambler')).toHaveLength(2)
  })

  it('收藏家的类别额外一件只进入终局资产', () => {
    const collector = player('collector', 20)
    collector.identity = { id: 'collector', collectorCategory: 'leisure', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    collector.items = [{ item, roundIndex: 0 }]
    const standing = rankFinalPlayers([collector])[0]
    expect(standing.fixedAssetUnits).toBe(coinsToUnits(3))
    expect(collector.balanceUnits).toBe(coinsToUnits(20))
  })

  it('逆行者未发动时，排名与拍品归属保持正常', () => {
    const players = [player('first'), player('reverse'), player('third')]
    players[1].identity = { id: 'reverser', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('first', 8), turn('reverse', 6), turn('third', 2)], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true) })
    expect(settled.result.winnerId).toBe('first')
    expect(settled.result.rankings.find((entry) => entry.playerId === 'reverse')?.rewardUnits).toBe(coinsToUnits(5))
    expect(settled.players.find((entry) => entry.id === 'first')?.items).toHaveLength(1)
  })

  it('逆行者发动后只倒转获奖区，并在最后两轮支付双倍费用', () => {
    const players = [player('first'), player('reverse'), player('third')]
    players[1].identity = { id: 'reverser', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('first', 8), { ...turn('reverse', 6), identityAction: { type: 'reverserInvert' } }, turn('third', 2)], item, roundIndex: 2, totalRounds: 4, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true) })
    expect(settled.result.winnerId).toBe('reverse')
    expect(settled.result.rankings.map((entry) => entry.playerId)).toEqual(['reverse', 'first'])
    expect(settled.players.find((entry) => entry.id === 'reverse')?.items).toHaveLength(1)
    expect(settled.result.identityEvents.find((event) => event.identityId === 'reverser')?.deltaUnits).toBe(-coinsToUnits(12))
  })

  it('逆行者与逆转排名卡同回合发动两次逆转，获奖区回到正常排名', () => {
    const players = [player('first'), player('reverse'), player('third')]
    players[1].identity = { id: 'reverser', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('first', 8), { ...turn('reverse', 6), identityAction: { type: 'reverserInvert' } }, { ...turn('third', 2), cardUse: { cardId: 'reverseRank' } }], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true) })
    expect(settled.result.rankingReversalCount).toBe(2)
    expect(settled.result.winnerId).toBe('first')
    expect(settled.result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'reverseRank', description: '获奖区排名被逆转了 2 次，故排名不变。' })]))
  })

  it('赌徒实际按身份结算，但公共预测账本伪装为普通玩家', () => {
    const settings = defaultIdentitySettings(true)
    const players = [player('hit'), player('winner'), player('wrong'), player('skip')]
    for (const entry of [players[0], players[2], players[3]]) entry.identity = { id: 'gambler', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('hit', 4, 'winner'), turn('winner', 8), turn('wrong', 3, 'hit'), turn('skip', 2)], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: settings })
    const gamblerEvents = settled.result.identityEvents.filter((event) => event.identityId === 'gambler')
    expect(gamblerEvents.map((event) => event.deltaUnits).sort((a, b) => a - b)).toEqual([-coinsToUnits(2.5), -coinsToUnits(2.5), coinsToUnits(2.5)])
    expect(settled.result.deltas.find((delta) => delta.playerId === 'wrong')?.predictionUnits).toBe(-coinsToUnits(7.5))
    expect(settled.result.predictionOutcomes.find((outcome) => outcome.playerId === 'wrong')?.deltaUnits).toBe(-coinsToUnits(7.5))
    expect(settled.result.predictionOutcomes.find((outcome) => outcome.playerId === 'skip')?.deltaUnits).toBe(0)
    expect(gamblerEvents.map((event) => event.detail).join(' ')).toContain('结算页')
  })

  it('说客默认任务随机且立即固定；指定任务由动作明确携带', () => {
    expect(randomLobbyistTask(['issuer', 'target', 'other'], 'target', () => 0)).toEqual({ taskType: 'outbid', comparisonPlayerId: 'issuer' })
    expect(randomLobbyistTask(['issuer', 'target', 'other'], 'target', () => 0.7)).toEqual({ taskType: 'avoidPrize' })
  })

  it('绑匪盯上的玩家拿下拍品时，报销费用并把拍品转给绑匪', () => {
    const players = [player('assassin'), player('target'), player('third')]
    players[0].identity = { id: 'assassin', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [{ ...turn('assassin', 4), identityAction: { type: 'kidnap', targetPlayerId: 'target' } }, turn('target', 8), turn('third', 2)], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true) })
    expect(settled.result.winnerId).toBe('target')
    expect(settled.result.itemWinnerId).toBe('assassin')
    expect(settled.players.find((entry) => entry.id === 'assassin')?.items).toEqual([{ item, roundIndex: 0 }])
    expect(settled.players.find((entry) => entry.id === 'target')?.items).toEqual([])
    expect(settled.result.identityEvents).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: 'assassin', title: '绑匪抢劫成功', deltaUnits: 0 })]))
    expect(settled.result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: '⛓', description: '有人抢劫了本回合的藏品。' })]))
  })

  it('绑匪目标未获拍品时保留失败扣费的私密反馈，公共结算不显示抢劫', () => {
    const players = [player('assassin'), player('target'), player('third')]
    players[0].identity = { id: 'assassin', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const settled = settleRound({ playersAfterBids: players, turns: [{ ...turn('assassin', 9), identityAction: { type: 'kidnap', targetPlayerId: 'target' } }, turn('target', 5), turn('third', 2)], item, roundIndex: 0, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true) })
    expect(settled.result.winnerId).toBe('assassin')
    expect(settled.result.itemWinnerId).toBe('assassin')
    expect(settled.result.identityEvents).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: 'assassin', title: '绑匪抢劫失败', deltaUnits: -coinsToUnits(5) })]))
    expect(settled.result.cardEffects.some((effect) => effect.symbol === '⛓')).toBe(false)
  })

  it('说客失败任务在结算末尾把违约款转给说客', () => {
    const players = [player('lobbyist'), player('target'), player('first')]
    players[0].identity = { id: 'lobbyist', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: 0 }
    const contract = { id: 'c1', issuerId: 'lobbyist', targetPlayerId: 'target', taskType: 'winFirst' as const, specified: false, issuedRoundIndex: 0, executeRoundIndex: 1, status: 'pending' as const, paymentUnits: 0 }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('lobbyist', 3), turn('target', 2), turn('first', 8)], item, roundIndex: 1, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true), identityContracts: [contract] })
    expect(settled.identityContracts[0].status).toBe('failed')
    expect(settled.identityContracts[0].paymentUnits).toBe(coinsToUnits(3))
    expect(settled.players.find((entry) => entry.id === 'lobbyist')?.identity?.lobbyistNextFree).toBe(true)
    expect(settled.identityEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'target', title: '说客任务未完成', deltaUnits: -coinsToUnits(3) }),
      expect.objectContaining({ playerId: 'lobbyist', title: '收到违约款', deltaUnits: coinsToUnits(3) }),
    ]))
  })

  it('说客任务完成时，任务对象和说客都会收到无奖惩的结果反馈', () => {
    const players = [player('lobbyist'), player('target'), player('third')]
    players[0].identity = { id: 'lobbyist', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: 0 }
    const contract = { id: 'c-success', issuerId: 'lobbyist', targetPlayerId: 'target', taskType: 'winFirst' as const, specified: false, issuedRoundIndex: 0, executeRoundIndex: 1, status: 'pending' as const, paymentUnits: 0 }
    const settled = settleRound({ playersAfterBids: players, turns: [turn('lobbyist', 3), turn('target', 8), turn('third', 2)], item, roundIndex: 1, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, fairnessOrderIds: players.map((entry) => entry.id), identitySettings: defaultIdentitySettings(true), identityContracts: [contract] })
    expect(settled.identityContracts[0]).toMatchObject({ status: 'success', paymentUnits: 0 })
    expect(settled.identityEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'target', title: '说客任务完成', deltaUnits: 0 }),
      expect.objectContaining({ playerId: 'lobbyist', title: '说客任务完成', deltaUnits: 0 }),
    ]))
  })
})
