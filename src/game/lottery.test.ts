import { describe, expect, it, vi } from 'vitest'
import { activeOperator, createDefaultSettings, createRematchSession, createSession } from './session'
import { settleRound, rankFinalPlayers } from './engine'
import { availableLotteryNumbers, botWantsLottery, buyLotteryTicket, createLottery, lotterySummary, nextLotteryRound, settleLottery } from './lottery'
import { loadSession } from './storage'
import { createPlayerIdentity } from './identities'
import type { GameSession } from './types'

function game(count = 3) {
  const session = createSession(Array.from({ length: count }, (_, i) => `玩家${i}`), createDefaultSettings(count))
  session.phase = 'privateTurn'; session.identityDraft = null
  return session
}
function purchase(session: GameSession, index: number, number: number | null, random = () => 0) {
  session.currentTurnIndex = index
  const bought = buyLotteryTicket(session, session.players[index].id, number, 0, random)
  expect(bought).not.toBeNull()
  Object.assign(session, bought)
}
function draw(session: GameSession, random = () => 0) {
  const turns = session.players.map(player => ({ playerId: player.id, bidUnits: 0, predictedPlayerId: null }))
  const settled = settleRound({ playersAfterBids: session.players, turns, item: session.itemDeck[session.roundIndex], roundIndex: session.roundIndex, rewardMultipliers: [], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1, fairnessOrderIds: session.players.map(p => p.id) })
  return settleLottery(session.lottery, settled.players, settled.result, session.settings.rounds, random)
}

describe('彩票购票与独占号码', () => {
  it.each([0, 1, 60])('保险师余额 %i：两张全额补贴、不占预算，刷新后仍限购', balance => {
    const s = game(); const player = s.players[0]
    player.identity = createPlayerIdentity('insurer'); player.balanceUnits = balance
    for (const number of [1,2]) {
      const bought = buyLotteryTicket(s, player.id, number, balance)
      expect(bought).not.toBeNull(); Object.assign(s, bought)
    }
    expect(s.players[0].balanceUnits).toBe(balance)
    expect(s.lottery!.poolUnits).toBe(11)
    expect(s.lottery!.tickets.map(t => [t.paidUnits,t.subsidyUnits])).toEqual([[0,4],[0,4]])
    expect(buyLotteryTicket(JSON.parse(JSON.stringify(s)), player.id, 3)).toBeNull()
    expect(botWantsLottery('test',0,player,3,3,false)).toBe(true)
  })
  it.each([3, 6, 10])('%i 人的新局基础池精确为人数一半金币', count => {
    expect(game(count).lottery?.poolUnits).toBe(count)
  })
  it.each([20, 4, 3, 1, 0])('实际余额 %i 半金币单位，独立实付/补贴/入池', balance => {
    const s = game(); s.players[0].balanceUnits = balance
    purchase(s, 0, 2)
    expect(s.players[0].balanceUnits).toBe(Math.max(0, balance - 3))
    expect(s.lottery?.tickets[0]).toMatchObject({ paidUnits: Math.min(3, balance), subsidyUnits: 4 - Math.min(3, balance), number: 2 })
    expect(s.lottery?.poolUnits).toBe(7)
    expect(s.lottery?.openingPoolUnits).toBe(3)
    purchase(s, 0, 3)
    expect(buyLotteryTicket(s, s.players[0].id, 4)).toBeNull()
  })
  it('草稿不降低真实票价，不允许超支，不静默修改预算', () => {
    const s = game(); s.players[0].balanceUnits = 10
    const before = JSON.stringify(s)
    expect(buyLotteryTicket(s, s.players[0].id, 1, 8)).toBeNull()
    expect(JSON.stringify(s)).toBe(before)
    expect(buyLotteryTicket(s, s.players[0].id, 1, 7)?.players[0].balanceUnits).toBe(7)
  })
  it('不是当前玩家、非操作阶段、非法号码和重复占号不能买', () => {
    const s = game()
    expect(buyLotteryTicket(s, s.players[1].id, 1)).toBeNull()
    for (const number of [-1, 0, 1.5, 7, NaN]) expect(buyLotteryTicket(s, s.players[0].id, number)).toBeNull()
    s.phase = 'handoff'; expect(buyLotteryTicket(s, s.players[0].id, 1)).toBeNull(); s.phase = 'privateTurn'
    purchase(s, 0, 1); s.currentTurnIndex = 1
    expect(buyLotteryTicket(s, s.players[1].id, 1)).toBeNull()
  })
  it('随机选号只抽空号，重试不再调用随机数', () => {
    const s = game(); purchase(s, 0, 1)
    const random = vi.fn(() => .999)
    purchase(s, 1, null, random)
    expect(s.lottery?.tickets[1].number).toBe(6)
    purchase(s, 1, 2)
    expect(buyLotteryTicket(s, s.players[1].id, null, 0, random)).toBeNull()
    expect(random).toHaveBeenCalledTimes(1)
  })
  it('号满后不扣款，旧票仍有资格；接力不按操作者重复发票', () => {
    const s = game()
    for (let round = 0; round < 2; round++) { s.roundIndex = round; for (let p = 0; p < 3; p++) purchase(s, p, round * 3 + p + 1) }
    expect(availableLotteryNumbers(s.lottery!, 3)).toEqual([])
    s.roundIndex = 2; s.currentTurnIndex = 0
    expect(buyLotteryTicket(s, s.players[0].id, null)).toBeNull()
    expect(s.lottery?.tickets).toHaveLength(6)
  })
})

describe('彩票开奖、滚存与资金守恒', () => {
  it('接力按同一席位限购，票根记录实际操作者，下一棒继承旧票', () => {
    const settings = createDefaultSettings(3)
    const s = createSession(Array.from({ length: 3 }, (_, i) => ({ name: `席位${i}`, operators: [0, 1].map(j => ({ id: `op${i}-${j}`, memberId: `member${i}-${j}`, name: `操作者${i}-${j}`, controller: { kind: 'human' as const } })) })), settings, { mode: 'relay' })
    s.phase = 'privateTurn'
    Object.assign(s, buyLotteryTicket(s, s.players[0].id, 1, 0, () => 0, activeOperator(s, s.players[0]).memberId))
    expect(s.lottery?.tickets[0].operatorMemberId).toBe('member0-0')
    expect(buyLotteryTicket(s, s.players[0].id, 2, 0, () => 0, 'member0-1')).not.toBeNull()
    s.roundIndex = 1
    Object.assign(s, buyLotteryTicket(s, s.players[0].id, 2, 0, () => 0, activeOperator(s, s.players[0]).memberId))
    expect(s.lottery?.tickets.map(t => t.operatorMemberId)).toEqual(['member0-0', 'member0-1'])
  })
  it('绑票未决不得开奖，避免使用尚未发放的彩票奖金付赎金', () => {
    const s = game(); purchase(s, 0, 1)
    const base = draw(s).result
    delete base.lottery
    base.kidnapAttempt = { kidnapperId: s.players[1].id, targetPlayerIds: [s.players[0].id], capturedPlayerId: s.players[0].id, ransomUnits: 12, setupCostUnits: 0, status: 'pending' }
    const random = vi.fn(() => 0)
    expect(settleLottery(s.lottery, s.players, base, 5, random).result.lottery).toBeUndefined()
    expect(random).not.toHaveBeenCalled()
    base.kidnapAttempt.status = 'surrendered'
    expect(settleLottery(s.lottery, s.players, base, 5, random).result.lottery?.prizeUnits).toBe(7)
  })
  it('无人中奖，旧号与完整奖池滚存；无新票也照常领奖', () => {
    const s = game(); purchase(s, 0, 1)
    const first = draw(s, () => .99)
    expect(first.result.lottery).toMatchObject({ number: 6, winnerId: null, poolUnits: 7 })
    s.lottery = nextLotteryRound(first.lottery, 3, 1); s.roundIndex = 1
    const next = draw(s)
    expect(next.result.lottery).toMatchObject({ winnerId: s.players[0].id, newTicketCount: 0, prizeUnits: 7 })
    expect(lotterySummary(next.result.lottery!, s.players)).toContain('沿用 1 个有效号码')
    expect(next.lottery?.tickets).toEqual([])
    expect(nextLotteryRound(next.lottery, 3, 2)).toMatchObject({ poolUnits: 3, poolStartRound: 2, tickets: [] })
  })
  it('跨轮持有多个号码，普通轮每个号码概率相同', () => {
    const s = game(); purchase(s, 0, 1); s.roundIndex = 1; purchase(s, 0, 3)
    const outcomes = Array.from({ length: 6 }, (_, i) => draw(s, () => (i + .5) / 6).result.lottery!)
    expect(outcomes.map(d => d.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(outcomes.filter(d => d.winnerId)).toHaveLength(2)
  })
  it('末轮从所有有效号码直接等概率抽取，包含免费票及往轮票', () => {
    const s = game(); s.players[0].balanceUnits = 0; purchase(s, 0, 2)
    s.roundIndex = s.settings.rounds - 1; purchase(s, 1, 5)
    for (const [roll, number] of [[0, 2], [.4999, 2], [.5, 5], [.999, 5]]) {
      const d = draw(s, () => roll)
      expect(d.result.lottery).toMatchObject({ number, prizeUnits: 11, finalRound: true })
      expect(d.lottery?.poolUnits).toBe(0)
    }
  })
  it('末轮单票必中；无人参与不指定赢家，残余池退出游戏', () => {
    const s = game(); s.roundIndex = s.settings.rounds - 1
    const empty = draw(s)
    expect(empty.result.lottery).toMatchObject({ winnerId: null, number: null, poolUnits: 3, prizeUnits: 0 })
    expect(lotterySummary(empty.result.lottery!, s.players)).toContain('未领取')
    purchase(s, 2, 4)
    expect(draw(s, () => .99).result.lottery).toMatchObject({ number: 4, prizeUnits: 7 })
  })
  it('开奖幂等，不再随机或发奖；奖金进入余额与固定资产曲线且不改变其他结算', () => {
    const s = game(); purchase(s, 0, 1)
    const first = draw(s)
    const random = vi.fn(() => .9)
    const repeated = settleLottery(first.lottery, first.players, first.result, s.settings.rounds, random)
    expect(repeated).toEqual(first); expect(random).not.toHaveBeenCalled()
    expect(first.result.balancesAfter[s.players[0].id]).toBe(first.players[0].balanceUnits)
    expect(first.result.totalAssetUnitsAfter).toEqual(Object.fromEntries(rankFinalPlayers(first.players).map(p => [p.player.id, p.totalAssetUnits])))
    expect(first.result.totalBidUnits).toBe(0)
    expect(first.result.deltas.every(d => d.predictionUnits === 0)).toBe(true)
  })
  it('跨 100 局守恒：基础注入＋固定票款＝派奖＋剩余，补贴＋实付＝票贡献', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = game(); let base = 3, paid = 0, subsidy = 0, contribution = 0, awards = 0
      let randomSeed = seed + 1
      const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 2 ** 32 }
      for (let round = 0; round < s.settings.rounds; round++) {
        s.roundIndex = round
        for (let index = 0; index < 3; index++) if (availableLotteryNumbers(s.lottery!, 3).length && random() < .8) {
          s.players[index].balanceUnits = Math.floor(random() * 6)
          purchase(s, index, null, random)
          const t = s.lottery!.tickets.at(-1)!
          paid += t.paidUnits; subsidy += t.subsidyUnits; contribution += 4
        }
        const settled = draw(s, random); s.lottery = settled.lottery; s.players = settled.players
        awards += settled.result.lottery!.prizeUnits
        expect(base + contribution).toBe(awards + s.lottery!.poolUnits)
        expect(paid + subsidy).toBe(contribution)
        if (round < s.settings.rounds - 1) {
          if (settled.result.lottery?.winnerId) base += 3
          s.lottery = nextLotteryRound(s.lottery, 3, round + 1)
        }
      }
    }
  })
  it('Bot 使用同一公开数据确定参与倾向，零余额能参与，多种种子有买有不买', () => {
    const s = game(); const p = s.players[0]
    const choices = Array.from({ length: 100 }, (_, i) => botWantsLottery(`seed${i}`, 0, p, 3, 3, false))
    expect(new Set(choices).size).toBe(2)
    expect(botWantsLottery('seed', 0, p, 3, 3, false)).toBe(botWantsLottery('seed', 0, p, 3, 3, false))
    expect(botWantsLottery('seed', 0, { ...p, balanceUnits: 0 }, 3, 3, false)).toBe(true)
  })
  it('新局重置彩票；旧 v36 存档不插入彩票；新存档购票/开奖结果完整恢复', () => {
    const s = game(); purchase(s, 0, 1)
    let raw = JSON.stringify(s)
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: (_: string, value: string) => { raw = value } })
    expect(loadSession()?.lottery).toEqual(s.lottery)
    const d = draw(s); s.results = [d.result]; s.lottery = d.lottery; s.players = d.players; s.phase = 'roundResult'
    raw = JSON.stringify(s)
    expect(loadSession()?.results[0].lottery).toEqual(d.result.lottery)
    expect(createRematchSession(s).lottery).toEqual(createLottery(3))
    raw = JSON.stringify({ ...s, version: 36, lottery: undefined, careerEnabled: true })
    const old = loadSession(); expect(old?.version).toBe(37); expect(old?.lottery).toBeUndefined(); expect(old?.careerEnabled).toBe(true)
    vi.unstubAllGlobals()
  })
})
