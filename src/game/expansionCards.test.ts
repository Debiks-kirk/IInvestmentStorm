import { describe, expect, it } from 'vitest'
import { createSession, createDefaultSettings, recycleUsedCards } from './session'
import { useInstantCard, instantUses, upgradeChoices, resolveCharmTies } from './expansionCards'
import { buyLotteryTicket } from './lottery'
import { settleRound } from './engine'

const game = () => {
  const s = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
  s.phase = 'privateTurn'; s.identityDraft = null
  s.players[0].cardInventory = ['luckyTickets', 'luckyTickets', 'sleeveUpgrade', 'red']
  return s
}
describe('天降彩券', () => {
  it('末轮最多三个号码，仍每号注入两金币', () => {
    const s = game(); s.roundIndex = s.settings.rounds - 1
    Object.assign(s, useInstantCard(s, s.players[0].id, 'luckyTickets'))
    expect(s.lottery!.tickets).toHaveLength(3)
    expect(s.lottery!.poolUnits).toBe(15)
  })
  it('赠号注入每号2金币，不占购买次数，刷新不能重抽', () => {
    let s = game(); const id = s.players[0].id; const cash = s.players[0].balanceUnits
    Object.assign(s, useInstantCard(s, id, 'luckyTickets', undefined, [], () => 0))
    expect(s.lottery!.tickets.map(t => t.number)).toEqual([1, 2, 3, 4, 5])
    expect(s.lottery!.poolUnits).toBe(23)
    expect(s.players[0].balanceUnits).toBe(cash)
    s = JSON.parse(JSON.stringify(s))
    expect(useInstantCard(s, id, 'luckyTickets')).toBeNull()
    expect(buyLotteryTicket(s, id, 6)).not.toBeNull()
  })
  it('只剩一个号只发一个，池增加2；无号不消耗', () => {
    const s = game(); const id = s.players[0].id
    s.lottery!.tickets = [1,2,3,4,5].map(number => ({ playerId: s.players[1].id, number, roundIndex: 0, paidUnits: 4, subsidyUnits: 0 }))
    Object.assign(s, useInstantCard(s, id, 'luckyTickets'))
    expect(instantUses(s, id)[0].lotteryNumbers).toEqual([6]); expect(s.lottery!.poolUnits).toBe(7)
    s.currentTurnIndex = 1; s.players[1].cardInventory = ['luckyTickets']
    expect(useInstantCard(s, s.players[1].id, 'luckyTickets')).toBeNull()
    expect(s.players[1].cardInventory).toEqual(['luckyTickets'])
  })
})
describe('袖里乾坤', () => {
  it('三张可将同一张卡连续从普通升至传奇', () => {
    const s = game(); const id = s.players[0].id
    s.players[0].cardInventory = ['sleeveUpgrade','sleeveUpgrade','sleeveUpgrade','red']
    s.cardDeck = ['swap','bananaPeel','legendaryLoot']
    for (const target of ['red','swap','bananaPeel'] as const) Object.assign(s, useInstantCard(s,id,'sleeveUpgrade',target))
    expect(s.players[0].cardInventory).toEqual(['legendaryLoot'])
    expect(s.cardDeck).toEqual([])
    expect(instantUses(s,id)).toHaveLength(3)
    expect(recycleUsedCards([], [{ playerId:id,bidUnits:0,predictedPlayerId:null,cardUses:instantUses(s,id) }])).toHaveLength(6)
  })
  it('排除已安排卡，按实体卡池升级并回收两张消耗卡', () => {
    const s = game(); const id = s.players[0].id; s.cardDeck = ['swap', 'swap', 'reverseRank']
    expect(upgradeChoices(s, id, [{ cardId: 'red' }])).not.toContain('red')
    Object.assign(s, useInstantCard(s, id, 'sleeveUpgrade', 'red', [], () => .9))
    expect(s.players[0].cardInventory).toEqual(['luckyTickets', 'luckyTickets', 'reverseRank'])
    expect(s.cardDeck).toEqual(['swap', 'swap'])
    expect(recycleUsedCards(s.cardDeck, [{ playerId: id, bidUnits: 0, predictedPlayerId: null, cardUses: instantUses(s, id) }]).sort()).toEqual(['red', 'sleeveUpgrade', 'swap', 'swap'])
    expect(useInstantCard(s, id, 'sleeveUpgrade', 'reverseRank')).toBeNull()
  })
  it('空池、传奇目标和仅一张自身都不消耗', () => {
    const s = game(); const id = s.players[0].id; s.cardDeck = []
    expect(useInstantCard(s,id,'sleeveUpgrade','red')).toBeNull()
    s.cardDeck = ['red']; s.players[0].cardInventory = ['sleeveUpgrade', 'legendaryLoot']
    expect(upgradeChoices(s,id)).toEqual([])
  })
})
describe('护身符', () => {
  const entries = [{ playerId:'a',bidUnits:24 },{ playerId:'b',bidUnits:24 },{ playerId:'c',bidUnits:18 }]
  it('一人持有不救出另一个并列者；多人持有全部消耗', () => {
    expect([...resolveCharmTies(entries,new Set(['a'])).eliminated]).toEqual(['b'])
    expect([...resolveCharmTies(entries,new Set(['a','b'])).consumed]).toEqual(['a','b'])
    expect([...resolveCharmTies(entries,new Set(['a','b'])).eliminated]).toEqual(['a','b'])
    expect(resolveCharmTies(entries,new Set(['c'])).consumed.size).toBe(0)
  })
  it('实际结算保留第一，仅消耗一张；香蕉皮不触发护符', () => {
    const s = game(); s.players[0].cardInventory = ['tieCharm','tieCharm']
    const input = { playersAfterBids:s.players, turns:s.players.map((p,i)=>({ playerId:p.id,bidUnits:i===2?18:24,predictedPlayerId:null })),item:s.itemDeck[0],roundIndex:0,rewardMultipliers:[2,1],correctPredictionMultiplier:1,wrongPredictionMultiplier:1,fairnessOrderIds:s.players.map(p=>p.id) }
    const result = settleRound(input)
    expect(result.result.rankings[0].playerId).toBe(s.players[0].id)
    expect(result.result.tiedPlayerIds).toEqual([s.players[1].id])
    expect(result.players[0].cardInventory).toEqual(['tieCharm'])
    const banana = settleRound({ ...input, turns:input.turns.map((t,i)=>i===2?{ ...t,cardUses:[{ cardId:'bananaPeel' as const,targetPlayerId:s.players[0].id }] }:t) })
    expect(banana.players[0].cardInventory).toEqual(['tieCharm','tieCharm'])
  })
})
