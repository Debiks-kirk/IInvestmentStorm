import { describe, expect, it } from 'vitest'
import { calculateFixedAssets, fixedAssetCoins } from './assets'
import { coinsToUnits, defaultRewards, rankFinalPlayers, settleRound } from './engine'
import { CARD_DEFINITIONS, cardTargetScope, createCardDeck } from './cards'
import { ITEM_POOL } from './items'
import { SYSTEM_PRESETS } from './presets'
import { createDefaultSettings, drawPrizeRerollOffers, prepareCardGrants, recycleUsedCards, replaceNextPrize } from './session'
import type { CardUse, Item, Player, RoundTurn } from './types'

const item: Item = { id: 'test', name: '测试物品', value: 5, emoji: '🎁', tone: '#000', category: 'leisure' }

function players(balances: number[]): Player[] {
  return balances.map((balance, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`,
    color: '#000',
    balanceUnits: coinsToUnits(balance),
    items: [],
    cardInventory: [],
  }))
}

function turn(playerId: string, bid: number, predictedPlayerId: string | null = null, cardUse?: CardUse): RoundTurn {
  return { playerId, bidUnits: coinsToUnits(bid), predictedPlayerId, ...(cardUse ? { cardUse } : {}) }
}

function settle(basePlayers: Player[], turns: RoundTurn[], rewardMultipliers = [2, 1, 0.5]) {
  return settleRound({
    playersAfterBids: basePlayers,
    turns,
    item,
    roundIndex: 0,
    rewardMultipliers,
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

describe('道具卡结算', () => {
  it('逐张卡的目标范围明确：香蕉皮和换日均可指定任意其他玩家', () => {
    expect(CARD_DEFINITIONS.map((card) => [card.id, cardTargetScope(card.id)])).toEqual([
      ['red', 'none'], ['peek', 'previous'], ['swap', 'other'], ['redistribute', 'none'], ['doubleBid', 'none'],
      ['black', 'none'], ['reverseRank', 'none'], ['fateCoin', 'none'], ['bananaPeel', 'other'], ['reflectShield', 'none'], ['prizeReroll', 'none'], ['legendaryLoot', 'none'],
    ])
  })

  it('红卡与黑卡相乘后回到原价值，并使用修改后的价值结算预测', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 9, null, { cardId: 'red' }),
      turn('p2', 7, 'p1', { cardId: 'black' }),
      turn('p3', 2, 'p1'),
    ]).result
    expect(result.effectiveValueUnits).toBe(coinsToUnits(5))
    expect(result.cardEffects.map((effect) => effect.cardId)).toEqual(expect.arrayContaining(['red', 'black']))
    expect(result.predictionOutcomes.filter((outcome) => outcome.status === 'correct').map((outcome) => outcome.deltaUnits)).toEqual([coinsToUnits(5), coinsToUnits(5)])
  })

  it('黑卡的 1.5V 奖励与 0.5V 罚款均向下取到半金币', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 9, null, { cardId: 'black' }),
      turn('p2', 7, 'p3'),
      turn('p3', 2),
    ], [2, 1.5]).result
    expect(result.effectiveValueUnits).toBe(coinsToUnits(2.5))
    expect(result.rankings[1]?.rewardUnits).toBe(coinsToUnits(3.5))
    expect(result.predictionOutcomes.find((outcome) => outcome.playerId === 'p2')?.deltaUnits).toBe(coinsToUnits(-1))
  })

  it('偷天换日只交换排名金额，不改变公开总下注或实际扣款', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 10),
      turn('p2', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
      turn('p3', 8),
    ]).result
    expect(result.totalBidUnits).toBe(coinsToUnits(22))
    expect(result.winnerId).toBe('p2')
    expect(result.rankings.find((entry) => entry.playerId === 'p2')).toMatchObject({ bidUnits: coinsToUnits(10), actualBidUnits: coinsToUnits(4) })
  })

  it('偷天换日可指定尚未操作的玩家，并在统一结算时交换排名金额', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 4, null, { cardId: 'swap', targetPlayerId: 'p3' }),
      turn('p2', 8),
      turn('p3', 10),
    ]).result
    expect(result.winnerId).toBe('p1')
    expect(result.rankings.find((entry) => entry.playerId === 'p1')).toMatchObject({ bidUnits: coinsToUnits(10), actualBidUnits: coinsToUnits(4) })
    expect(result.rankings.find((entry) => entry.playerId === 'p3')).toMatchObject({ bidUnits: coinsToUnits(4), actualBidUnits: coinsToUnits(10) })
  })

  it('香蕉皮让目标下注作废，并只退回一半下注费用', () => {
    const settled = settle(players([10, 10, 10]), [
      turn('p1', 8),
      turn('p2', 7, null, { cardId: 'bananaPeel', targetPlayerId: 'p1' }),
      turn('p3', 2),
    ])
    expect(settled.result.winnerId).toBe('p2')
    expect(settled.result.rankings.find((entry) => entry.playerId === 'p1')).toBeUndefined()
    expect(settled.players.find((player) => player.id === 'p1')?.balanceUnits).toBe(coinsToUnits(14))
    expect(settled.result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(coinsToUnits(4))
    expect(settled.result.cardEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: 'bananaPeel', description: '玩家1 下注时被香蕉皮滑倒了：下注失败，丢失了一半的下注费用。' }),
    ]))
  })

  it('第一位可用香蕉皮指定尚未操作的玩家，结算时仍会使其下注作废', () => {
    const settled = settle(players([10, 10, 10]), [
      turn('p1', 5, null, { cardId: 'bananaPeel', targetPlayerId: 'p3' }),
      turn('p2', 6),
      turn('p3', 9),
    ])
    expect(settled.result.winnerId).toBe('p2')
    expect(settled.result.rankings.find((entry) => entry.playerId === 'p3')).toBeUndefined()
    expect(settled.players.find((player) => player.id === 'p3')?.balanceUnits).toBe(coinsToUnits(14.5))
  })

  it('反弹护盾持有时会自动将香蕉皮反弹给使用者本人，并消耗后回收', () => {
    const basePlayers = players([10, 10, 10])
    basePlayers[0].cardInventory = ['reflectShield']
    const settled = settle(basePlayers, [
      turn('p1', 8),
      turn('p2', 7, null, { cardId: 'bananaPeel', targetPlayerId: 'p1' }),
      turn('p3', 2),
    ])
    expect(settled.result.winnerId).toBe('p1')
    expect(settled.result.rankings.find((entry) => entry.playerId === 'p2')).toBeUndefined()
    expect(settled.players.find((player) => player.id === 'p2')?.balanceUnits).toBe(coinsToUnits(13.5))
    expect(settled.result.cardEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: 'reflectShield' }),
      expect.objectContaining({ cardId: 'bananaPeel', description: '玩家2 下注时被香蕉皮滑倒了：下注失败，丢失了一半的下注费用。' }),
    ]))
    expect(settled.players.find((player) => player.id === 'p1')?.cardInventory).not.toContain('reflectShield')
    expect(settled.result.autoConsumedCardIds).toEqual(['reflectShield'])
  })

  it('反弹护盾会阻止偷天换日改动被护盾保护者的排名金额', () => {
    const basePlayers = players([20, 20, 20])
    basePlayers[0].cardInventory = ['reflectShield']
    const result = settle(basePlayers, [
      turn('p1', 10),
      turn('p2', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
      turn('p3', 8),
    ]).result
    expect(result.winnerId).toBe('p1')
    expect(result.rankings.find((entry) => entry.playerId === 'p2')).toMatchObject({ bidUnits: coinsToUnits(4) })
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'reflectShield' })]))
    expect(result.cardEffects.some((effect) => effect.cardId === 'swap')).toBe(false)
  })

  it('一张反弹护盾只反弹首次指定效果，随后同轮攻击正常生效', () => {
    const basePlayers = players([20, 20, 20])
    basePlayers[0].cardInventory = ['reflectShield']
    const result = settle(basePlayers, [
      turn('p1', 9),
      turn('p2', 6, null, { cardId: 'bananaPeel', targetPlayerId: 'p1' }),
      turn('p3', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
    ]).result
    expect(result.autoConsumedCardIds).toEqual(['reflectShield'])
    expect(result.cardEffects.filter((effect) => effect.cardId === 'reflectShield')).toHaveLength(1)
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'swap' })]))
  })

  it('偷看底牌只留下匿名结算说明，不影响排名或金币', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 10),
      turn('p2', 4, null, { cardId: 'peek', targetPlayerId: 'p1' }),
      turn('p3', 8),
    ]).result
    expect(result.winnerId).toBe('p1')
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'peek' })]))
    expect(result.deltas.every((delta) => delta.cardUnits === 0)).toBe(true)
  })

  it('传奇夺宝令直接取得最终藏品，但不改变排名奖励或预测结算', () => {
    const settled = settle(players([20, 20, 20]), [
      turn('p1', 9),
      turn('p2', 7, 'p1'),
      turn('p3', 2, null, { cardId: 'legendaryLoot' }),
    ])
    expect(settled.result.winnerId).toBe('p1')
    expect(settled.result.itemWinnerId).toBe('p3')
    expect(settled.result.rankings[0]?.playerId).toBe('p1')
    expect(settled.result.predictionOutcomes.find((outcome) => outcome.playerId === 'p2')?.status).toBe('correct')
    expect(settled.players.find((player) => player.id === 'p1')?.items).toEqual([])
    expect(settled.players.find((player) => player.id === 'p3')?.items).toEqual([{ item, roundIndex: 0 }])
    expect(settled.result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'legendaryLoot' })]))
  })

  it('反客为主在交换后将自己的排名金额翻倍', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 5),
      turn('p2', 4, null, { cardId: 'swap', targetPlayerId: 'p1' }),
      turn('p3', 8, null, { cardId: 'doubleBid' }),
    ]).result
    expect(result.winnerId).toBe('p3')
    expect(result.rankings[0]).toMatchObject({ playerId: 'p3', bidUnits: coinsToUnits(16), actualBidUnits: coinsToUnits(8) })
  })

  it('逆转排名卡倒转获奖区，并把次数写入可公开的结算结果', () => {
    const result = settle(players([20, 20, 20]), [
      turn('p1', 10),
      turn('p2', 8, null, { cardId: 'reverseRank' }),
      turn('p3', 2),
    ]).result
    expect(result.rankingReversalCount).toBe(1)
    expect(result.winnerId).toBe('p3')
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'reverseRank', description: '获奖区排名已被逆转。' })]))
  })

  it('命运硬币按已保存的正反结果结算，不会重新随机', () => {
    const heads = settle(players([20, 20, 20]), [
      { ...turn('p1', 9), cardUses: [{ cardId: 'fateCoin', coinResult: 'heads' }] },
      turn('p2', 7),
      turn('p3', 2),
    ]).result
    const tails = settle(players([20, 20, 20]), [
      { ...turn('p1', 9), cardUses: [{ cardId: 'fateCoin', coinResult: 'tails' }] },
      turn('p2', 7),
      turn('p3', 2),
    ]).result
    expect(heads.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(coinsToUnits(6))
    expect(tails.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(-coinsToUnits(4))
    expect(heads.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'fateCoin', description: '命运硬币：正面朝上，获得 6 金币。' })]))
  })

  it('改拍令只公开下一轮拍品被改写，不影响当前轮结算', () => {
    const result = settle(players([20, 20, 20]), [
      { ...turn('p1', 9), cardUses: [{ cardId: 'prizeReroll', prizeReroll: { originalItemId: 'old', offeredItemIds: ['a', 'b', 'c', 'd', 'e', 'f'], chosenItemId: 'a' } }] },
      turn('p2', 7),
      turn('p3', 2),
    ]).result
    expect(result.cardEffects).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'prizeReroll', description: '有人改写了下一轮拍品。' })]))
    expect(result.effectiveValueUnits).toBe(coinsToUnits(5))
  })

  it('结算内核最多读取每位玩家的两张道具', () => {
    const result = settle(players([20, 20, 20]), [
      { ...turn('p1', 9), cardUses: [{ cardId: 'red' }, { cardId: 'black' }, { cardId: 'fateCoin', coinResult: 'heads' }] },
      turn('p2', 7),
      turn('p3', 2),
    ]).result
    expect(result.effectiveValueUnits).toBe(coinsToUnits(5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(0)
  })

  it('劫富济贫在奖励前按半金币公平分配，并在公开收益中保持匿名', () => {
    const result = settle(players([20, 4, 4]), [
      turn('p1', 1, null, { cardId: 'redistribute' }),
      turn('p2', 1),
      turn('p3', 1),
    ]).result
    expect(result.cardEffects[0]?.cardId).toBe('redistribute')
    expect(result.redistributionTransferUnits).toBe(coinsToUnits(5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits).toBe(coinsToUnits(-5))
    expect(result.deltas.find((delta) => delta.playerId === 'p2')?.cardUnits).toBe(coinsToUnits(2.5))
    expect(result.deltas.find((delta) => delta.playerId === 'p1')?.publicDeltaUnits).not.toBe(result.deltas.find((delta) => delta.playerId === 'p1')?.cardUnits)
  })

  it('结算后记录唯一或并列余额领跑者', () => {
    const result = settle(players([10, 10, 10]), [turn('p1', 9), turn('p2', 7), turn('p3', 2)]).result
    expect(result.balanceLeaderIds).toEqual(['p1'])
  })
})

describe('道具发放', () => {
  it('改拍令从未安排拍品中一次抽取六张，并只替换实际下一轮拍品', () => {
    const scheduled = ITEM_POOL.slice(0, 6)
    const offers = drawPrizeRerollOffers(scheduled)
    expect(offers).toHaveLength(6)
    expect(new Set(offers.map((entry) => entry.id)).size).toBe(6)
    expect(offers.some((entry) => scheduled.some((planned) => planned.id === entry.id))).toBe(false)
    const replaced = replaceNextPrize(scheduled, 1, offers[0])
    expect(replaced[2]).toEqual(offers[0])
    expect(replaced[0]).toEqual(scheduled[0])
    expect(replaced[1]).toEqual(scheduled[1])
  })

  it('改拍令会进入循环卡池，也可被禁用', () => {
    expect(createCardDeck([])).toContain('prizeReroll')
    expect(createCardDeck(['prizeReroll'])).not.toContain('prizeReroll')
  })

  it('禁用卡不会进入本局循环卡池', () => {
    const deck = createCardDeck(['red', 'black', 'peek'])
    expect(deck).not.toEqual(expect.arrayContaining(['red', 'black', 'peek']))
    expect(deck).toHaveLength(CARD_DEFINITIONS.filter((card) => !['red', 'black', 'peek'].includes(card.id)).reduce((total, card) => total + (card.rarity === 'legendary' ? 1 : 2), 0))
  })

  it('逆转排名卡默认加入卡池，也可被单独禁用', () => {
    expect(createCardDeck([])).toContain('reverseRank')
    expect(createCardDeck(['reverseRank'])).not.toContain('reverseRank')
    expect(createCardDeck([])).toContain('fateCoin')
    expect(createCardDeck(['fateCoin'])).not.toContain('fateCoin')
    expect(createCardDeck([])).toEqual(expect.arrayContaining(['bananaPeel', 'reflectShield']))
    expect(createCardDeck(['bananaPeel', 'reflectShield'])).not.toEqual(expect.arrayContaining(['bananaPeel', 'reflectShield']))
    expect(createCardDeck([]).filter((cardId) => cardId === 'legendaryLoot')).toHaveLength(1)
    expect(createCardDeck(['legendaryLoot'])).not.toContain('legendaryLoot')
  })

  it('两张已使用道具都会在下轮前回到卡池', () => {
    const recycled = recycleUsedCards(['black'], [{ ...turn('p1', 5), cardUses: [{ cardId: 'red' }, { cardId: 'fateCoin', coinResult: 'heads' }] }])
    expect(recycled).toEqual(expect.arrayContaining(['black', 'red', 'fateCoin']))
  })

  it('自动触发并消耗的反弹护盾也会在下轮前回到卡池', () => {
    const recycled = recycleUsedCards(['black'], [turn('p1', 5)], ['reflectShield'])
    expect(recycled).toEqual(expect.arrayContaining(['black', 'reflectShield']))
  })

  it('唯一最低者必中时从卡池获得卡牌', () => {
    const base = players([3, 8, 10])
    const granted = prepareCardGrants({ players: base, cardDeck: ['red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(granted.pendingCardGrants).toEqual([{ playerId: 'p1', cardId: 'red', announced: false }])
    expect(granted.players[0].cardInventory).toEqual(['red'])
    expect(granted.cardDeck).toEqual(['black'])
  })

  it('正余额并列最低者不发卡，零余额并列者各自独立判定', () => {
    const noGrant = prepareCardGrants({ players: players([3, 3, 8]), cardDeck: ['red'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(noGrant.pendingCardGrants).toEqual([])
    const zeroGrant = prepareCardGrants({ players: players([0, 0, 8]), cardDeck: ['red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(zeroGrant.pendingCardGrants).toHaveLength(2)
    expect(new Set(zeroGrant.pendingCardGrants.map((grant) => grant.cardId)).size).toBe(2)
  })

  it('第一位操作玩家抽到偷看底牌时改抽另一张卡，偷看卡留在池中', () => {
    // Round 2 starts from seat 2, so that seat is the one that cannot receive Peek.
    const granted = prepareCardGrants({ players: players([8, 0, 10]), cardDeck: ['peek', 'red', 'black'], roundIndex: 1, probability: 100, roll: () => 0 })
    expect(granted.pendingCardGrants[0]?.cardId).toBe('red')
    expect(granted.cardDeck).toEqual(['peek', 'black'])
  })

  it('已使用卡会在回合结束后回洗进卡池，未使用卡不会被归还或重复', () => {
    const recycled = recycleUsedCards(['black'], [
      turn('p1', 5, null, { cardId: 'red' }),
      turn('p2', 3, null, { cardId: 'red' }),
    ])
    expect(recycled).toHaveLength(3)
    expect(recycled.filter((card) => card === 'red')).toHaveLength(2)
    expect(recycleUsedCards(['black'], [turn('p1', 5)])).toEqual(['black'])
  })
})

describe('固定资产与默认配置', () => {
  it('所有拍品都恰好归入四类资产', () => {
    expect(ITEM_POOL).toHaveLength(29)
    expect(new Set(ITEM_POOL.map((entry) => entry.category))).toEqual(new Set(['leisure', 'transport', 'luxury', 'property']))
  })

  it('按类别与实际数量计算轻量固定资产档位', () => {
    expect(fixedAssetCoins('leisure', 1)).toBe(0)
    expect(fixedAssetCoins('leisure', 2)).toBe(3)
    expect(fixedAssetCoins('leisure', 3)).toBe(10)
    expect(fixedAssetCoins('leisure', 4)).toBe(20)
    expect(fixedAssetCoins('leisure', 5)).toBe(30)
    expect(fixedAssetCoins('property', 5)).toBe(72)
  })

  it('固定资产只在终局并入总资产并改变终局名次', () => {
    const base = players([22, 25, 18])
    base[0].items = ITEM_POOL.filter((entry) => entry.category === 'leisure').slice(0, 3).map((item, roundIndex) => ({ item, roundIndex }))
    const standings = rankFinalPlayers(base)
    expect(base[0].balanceUnits).toBe(coinsToUnits(22))
    expect(standings[0]).toMatchObject({ player: { id: 'p1' }, cashUnits: coinsToUnits(22), fixedAssetUnits: coinsToUnits(10), totalAssetUnits: coinsToUnits(32), place: 1 })
    expect(calculateFixedAssets(base[0].items).find((entry) => entry.category === 'leisure')).toMatchObject({ itemCount: 3, units: coinsToUnits(10) })
  })

  it('新默认设置与六个系统配置使用确认后的规则', () => {
    expect(createDefaultSettings()).toMatchObject({ rounds: 5, initialCoins: 30, wrongPredictionMultiplier: 1.5, cardGrantProbability: 100, revealBalanceLeader: false, midRoundSystemAuction: true })
    expect(SYSTEM_PRESETS.map((preset) => [preset.settings.playerCount, preset.settings.rounds, preset.settings.initialCoins])).toEqual([[3, 5, 30], [3, 5, 30], [6, 8, 30], [6, 8, 30], [10, 10, 30], [10, 10, 30]])
    expect(SYSTEM_PRESETS.filter((preset) => preset.id.startsWith('bot-')).map((preset) => [preset.seats.filter((seat) => seat.controller.kind === 'human').length, preset.seats.filter((seat) => seat.controller.kind === 'bot').map((seat) => seat.name)])).toEqual([[1, ['机器人1', '机器人2']], [1, ['机器人1', '机器人2', '机器人3', '机器人4', '机器人5']], [1, ['机器人1', '机器人2', '机器人3', '机器人4', '机器人5', '机器人6', '机器人7', '机器人8', '机器人9']]])
  })
})
