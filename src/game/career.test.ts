import { describe, expect, it } from 'vitest'
import { ACHIEVEMENT_LIBRARY, achievementProgress, careerRatings, ratingDelta } from './progression'
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
  it.each([3,4,5,6,7,8,9,10])('%i 人等级分：前向上取整三分之一加分，其他扣分，越靠前收益越高', count => {
    const deltas = Array.from({length:count},(_,i)=>ratingDelta(count,i+1))
    expect(deltas.slice(0,Math.ceil(count/3)).every(d=>d>0)).toBe(true)
    expect(deltas.slice(Math.ceil(count/3)).every(d=>d<0)).toBe(true)
    expect(deltas).toEqual([...deltas].sort((a,b)=>b-a))
  })
  it('等级分初始基准、无参赛空值、去重、撤销与并列相同', () => {
    const {session,members:roster} = finishedSession()
    const record = createMatchCareerRecord(session)!
    const summary = record.summaries.find(s=>s.memberId===roster.human.id)!
    summary.finalPlace=1
    expect(careerRatings([]).get(roster.human.id)).toBeUndefined()
    expect(careerRatings([record,record]).get(roster.human.id)?.rating).toBe(1260)
    const second = {...record,sessionId:'second',summaries:record.summaries.map(s=>({...s,sessionId:'second',finalPlace:3}))}
    expect(careerRatings([second,record]).get(roster.human.id)?.rating).toBe(1200)
    expect(careerRatings([record]).get(roster.human.id)?.rating).toBe(1260)
    expect(careerRatings([{...record,summaries:record.summaries.map(s=>({...s,roundsActed:0}))}]).size).toBe(0)
    const tied = {...record,summaries:record.summaries.map(s=>({...s,finalPlace:1}))}
    expect(new Set([...careerRatings([tied]).values()].map(r=>r.rating))).toEqual(new Set([1260]))
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
