import { describe, expect, it } from 'vitest'
import { ACHIEVEMENT_LIBRARY, achievementProgress, careerRatings, ratingDelta, ratingLimit } from './progression'
import { createMatchCareerRecord, createBotHistoryHints, createCareerDashboard } from './career'
import { coinsToUnits, settleRound } from './engine'
import { createBotMember, createHumanMember, uniqueMemberName } from './members'
import { createDefaultSettings, createSession } from './session'
import type { GameSession, RoundTurn } from './types'

function finishedSession(): { session: GameSession; members: ReturnType<typeof members> } {
  const roster = members()
  const settings = createDefaultSettings(3)
  const session = createSession([
    { name: roster.human.name, memberId: roster.human.id, controller: { kind: 'human' as const } },
    { name: roster.bot.name, memberId: roster.bot.id, controller: { kind: 'bot' as const, profileId: 'adaptive' as const, difficulty: 'standard' as const } },
    { name: roster.other.name, memberId: roster.other.id, controller: { kind: 'human' as const } },
  ], settings, { careerEnabled: true })
  const turns: RoundTurn[] = session.players.map((player, index) => ({
    playerId: player.id,
    operatorMemberId: player.memberId,
    decisionOrigin: player.controller?.kind === 'bot' ? 'bot' : 'human',
    bidUnits: coinsToUnits(7 - index),
    predictedPlayerId: null,
  }))
  const settled = settleRound({ playersAfterBids: session.players, turns, item: session.itemDeck[0], roundIndex: 0, rewardMultipliers: settings.rewardMultipliers, correctPredictionMultiplier: settings.correctPredictionMultiplier, wrongPredictionMultiplier: settings.wrongPredictionMultiplier, fairnessOrderIds: session.players.map((player) => player.id) })
  return { session: { ...session, phase: 'finalResult', players: settled.players, results: [settled.result], careerEnabled: true }, members: roster }
}

function members() {
  return { human: createHumanMember('甲'), bot: createBotMember('变色龙', 'adaptive'), other: createHumanMember('乙') }
}

describe('成员档案与长期战绩', () => {
  it('半数加分区：六人第三与十人第五可加分，奇数向上取整', () => {
    expect(ratingDelta(6,3,120,100)).toBe(2)
    expect(ratingDelta(6,4,80,100)).toBe(-2)
    expect(ratingDelta(10,5,120,100)).toBe(2)
    expect(ratingDelta(5,3,120,100)).toBe(1)
    expect(ratingDelta(6,3,100,100)).toBe(0)
    expect(ratingDelta(6,3,100,100,2)).toBe(0)
  })
  it('人数分数上限与非法输入', () => {
    expect([2,3,4,5,6,7,8,9,10].map(ratingLimit)).toEqual([4,6,8,11,13,15,17,18,20])
    expect(ratingLimit(20)).toBe(38)
    expect(ratingLimit(NaN)).toBe(0)
    expect(ratingDelta(6, 0)).toBe(0)
    expect(ratingDelta(6, 6, 0, 100, 2)).toBe(0)
    expect(ratingDelta(6, 1, 0, 0, 6)).toBe(0)
    expect(ratingDelta(6, 1, 125, 100, 2)).toBe(9)
  })
  it.each(Array.from({length:19},(_,i)=>i+2))('%i 人的合法资产局面覆盖负上限到正上限全部整数', count => {
    const found = new Set<number>()
    // Construct sorted, nonnegative asset vectors with the selected rank fixed.
    // Interpolate from almost-equal assets to all affordable extremes.
    for (let rank=1;rank<=count;rank++) {
      for (let step=1;step<=1000;step++) {
        const fraction=step/1000
        const cutoff=Math.ceil(count/2)
        const own=rank<=cutoff ? 100*(1+0.5*fraction) : 100*(1-0.5*fraction)
        // Feasibility: ranks above own need >= own; ranks below need <= own.
        if (rank*own>count*100 || (rank===1 && own<100) || (rank===count && own>100)) continue
        const score=ratingDelta(count,rank,own,100)
        expect(Number.isInteger(score)).toBe(true)
        found.add(score)
      }
    }
    const cap=ratingLimit(count)
    expect([...found].sort((a,b)=>a-b)).toEqual(Array.from({length:2*cap+1},(_,i)=>i-cap))
  })
  it('旧战绩按席位去重平均；不完整记录不臆测资产', () => {
    const {session}=finishedSession()
    const record=createMatchCareerRecord(session)!
    const original=careerRatings([record])
    const relay={...record,finalSeats:undefined,summaries:[...record.summaries,{...record.summaries[0],memberId:'relay-extra'}]}
    expect(careerRatings([relay]).get(record.summaries[0].memberId)?.rating).toBe(original.get(record.summaries[0].memberId)?.rating)
    const partial={...record,finalSeats:undefined,summaries:[record.summaries[0]]}
    expect(careerRatings([partial]).get(partial.summaries[0].memberId)?.rating).toBe(1200+ratingDelta(record.playerCount,partial.summaries[0].finalPlace))
    expect(careerRatings([{...record,summaries:[record.summaries[0]]}]).get(record.summaries[0].memberId)?.rating).toBe(original.get(record.summaries[0].memberId)?.rating)
  })
  it.each([2,3,4,5,6,7,8,9,10])('%i 人等级分：前向上取整二分之一为加分区，其他为扣分区', count => {
    const deltas = Array.from({length:count},(_,i)=>ratingDelta(count,i+1))
    expect(deltas.slice(0,Math.ceil(count/2)).every(d=>d>0)).toBe(true)
    expect(deltas.slice(Math.ceil(count/2)).every(d=>d<0)).toBe(true)
    expect(deltas).toEqual([...deltas].sort((a,b)=>b-a))
  })
  it('等级分初始基准、无参赛空值、去重、撤销与并列相同', () => {
    const {session,members:roster} = finishedSession()
    const record = createMatchCareerRecord(session)!
    const summary = record.summaries.find(s=>s.memberId===roster.human.id)!
    summary.finalPlace=1
    summary.totalAssetUnits=200
    record.finalSeats = [
      {playerId:summary.seatPlayerId,place:1,totalAssetUnits:200},
      ...record.summaries.filter(s=>s!==summary).map((s,i)=>({playerId:s.seatPlayerId,place:i+2,totalAssetUnits:0})),
    ]
    expect(careerRatings([]).get(roster.human.id)).toBeUndefined()
    expect(careerRatings([record,record]).get(roster.human.id)?.rating).toBe(1206)
    const second = {...record,sessionId:'second',finalSeats:record.finalSeats.map(s=>({...s,place:s.playerId===summary.seatPlayerId?3:1,totalAssetUnits:s.playerId===summary.seatPlayerId?0:200})),summaries:record.summaries.map(s=>({...s,sessionId:'second',finalPlace:3,totalAssetUnits:0}))}
    expect(careerRatings([second,record]).get(roster.human.id)?.rating).toBe(1200)
    expect(careerRatings([record]).get(roster.human.id)?.rating).toBe(1206)
    expect(careerRatings([{...record,summaries:record.summaries.map(s=>({...s,roundsActed:0}))}]).size).toBe(0)
    const tied = {...record,finalSeats:record.finalSeats.map(s=>({...s,place:1,totalAssetUnits:100})),summaries:record.summaries.map(s=>({...s,finalPlace:1,totalAssetUnits:100}))}
    expect(new Set([...careerRatings([tied]).values()].map(r=>r.rating))).toEqual(new Set([1200]))
  })
  it('成就库条件、进度、旧数据缺失与重复记录', () => {
    const {session} = finishedSession(); const s = createMatchCareerRecord(session)!.summaries[0]
    expect(ACHIEVEMENT_LIBRARY.length).toBeGreaterThanOrEqual(30)
    expect(new Set(ACHIEVEMENT_LIBRARY.map(a=>a.id)).size).toBe(ACHIEVEMENT_LIBRARY.length)
    expect(achievementProgress([]).every(a=>!a.unlocked&&a.progress===0)).toBe(true)
    const progress = achievementProgress([{...s,lotteryWins:1,upgradeUses:5,predictionHits:3,predictionAttempts:3},s])
    // Same session is counted once, never manufactures progress on duplicate import.
    expect(progress.find(a=>a.id==='regular')?.progress).toBe(1)
    const earned = achievementProgress([{...s,lotteryWins:1,upgradeUses:5,predictionHits:3,predictionAttempts:3}])
    expect(earned.filter(a=>['jackpot','upgrades','perfectPrediction'].includes(a.id)).every(a=>a.unlocked)).toBe(true)
    expect(achievementProgress([s]).find(a=>a.id==='jackpot')?.unlocked).toBe(false)
  })
  it('以永久成员 ID 归档新局，改名不影响已保存的战绩归属', () => {
    const { session, members: roster } = finishedSession()
    const record = createMatchCareerRecord(session, '2026-01-01T00:00:00.000Z')
    expect(record?.summaries.map((summary) => summary.memberId)).toEqual([roster.human.id, roster.bot.id, roster.other.id])
    const renamed = { ...roster.human, name: '新甲' }
    expect(createCareerDashboard(renamed, [record!]).summaries).toHaveLength(1)
    expect(createCareerDashboard(renamed, [record!]).summaries[0].nameAtMatch).toBe('甲')
  })

  it('只为完成的 v36 生涯局生成记录', () => {
    const { session } = finishedSession()
    expect(createMatchCareerRecord({ ...session, careerEnabled: false })).toBeNull()
    expect(createMatchCareerRecord({ ...session, phase: 'roundResult' })).toBeNull()
  })

  it('Bot 仅在三局共同经历后获得受限历史提示，重置后不再使用旧局', () => {
    const { session, members: roster } = finishedSession()
    const records = [0, 1, 2].map((index) => ({ ...createMatchCareerRecord({ ...session, id: `career-${index}` }, `2026-01-0${index + 1}T00:00:00.000Z`)!, sessionId: `career-${index}` }))
    const hints = createBotHistoryHints(records, [roster.human, roster.bot, roster.other])
    expect(hints[roster.bot.id]?.opponents[roster.human.id]?.sharedMatches).toBe(3)
    const resetBot = { ...roster.bot, bot: { ...roster.bot.bot!, memoryResetAt: '2026-02-01T00:00:00.000Z' } }
    expect(createBotHistoryHints(records, [roster.human, resetBot, roster.other])[resetBot.id]?.opponents).toEqual({})
  })

  it('使用 Unicode 规范化的名称唯一性检查', () => {
    const member = createHumanMember('é')
    expect(uniqueMemberName('e\u0301', [member])).toBeNull()
    expect(uniqueMemberName('乙', [member])).toBe('乙')
  })
})
