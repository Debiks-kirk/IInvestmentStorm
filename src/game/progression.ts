import type { MatchCareerRecord, MemberMatchSummary } from './career'
import type { GameMode } from './types'

/** Reference gain at +50% assets (not a gain cap); also the unchanged loss cap. */
export function ratingLimit(playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount < 2) return 0
  return Math.round(playerCount <= 6 ? 6 + (playerCount - 3) * 7 / 3 : 13 + (playerCount - 6) * 7 / 4)
}

/** Assets use the same unit (coins or half-coins). Missing legacy assets use band midpoints. */
export function ratingDelta(playerCount: number, place: number, totalAssets?: number, averageAssets?: number, tiedCount = 1): number {
  if (!Number.isInteger(playerCount) || playerCount < 2 || !Number.isInteger(place) || place < 1 || place > playerCount) return 0
  if (!Number.isInteger(tiedCount) || tiedCount < 1 || place + tiedCount - 1 > playerCount) return 0
  if (tiedCount === playerCount) return 0
  const cutoff = Math.ceil(playerCount / 2)
  const limit = ratingLimit(playerCount)
  const knownAssets = Number.isFinite(totalAssets) && totalAssets! >= 0 && Number.isFinite(averageAssets) && averageAssets! > 0
  const deviation = knownAssets ? (totalAssets! - averageAssets!) / averageAssets! : 0
  const gainStrength = knownAssets ? Math.sqrt(Math.max(0, deviation) / 0.5) : 0.5
  const lossStrength = knownAssets ? Math.min(1, Math.max(0, -deviation / 0.5)) : 0.5
  let sum = 0
  for (let rank = place; rank < place + tiedCount; rank++) {
    sum += rank <= cutoff
      ? limit * (cutoff - rank + gainStrength) / cutoff
      : -limit * (rank - cutoff - 1 + lossStrength) / (playerCount - cutoff)
  }
  // Symmetric rounding, including negative halves; never expose JavaScript's -0.
  const value = sum / tiedCount
  return Math.sign(value) * Math.round(Math.abs(value)) || 0
}

/** Derive from unique completed records: refresh/import never adds points twice; deletion rolls back. */
export function careerRatings(records: readonly MatchCareerRecord[]) {
  const ratings = new Map<string, { rating: number; matches: number; changes: Record<string, number> }>()
  const seenSessions = new Set<string>()
  for (const record of records) {
    if (seenSessions.has(record.sessionId)) continue
    seenSessions.add(record.sessionId)
    // Each game seat counts once, irrespective of how many relay operators it had.
    const seats = record.finalSeats ?? [...new Map(record.summaries.map(s => [s.seatPlayerId, { playerId: s.seatPlayerId, place: s.finalPlace, totalAssetUnits: s.totalAssetUnits }])).values()]
    const complete = seats.length === record.playerCount && new Set(seats.map(s => s.playerId)).size === record.playerCount && seats.every(s => Number.isFinite(s.totalAssetUnits) && s.totalAssetUnits >= 0)
    const average = complete ? seats.reduce((sum, seat) => sum + seat.totalAssetUnits, 0) / record.playerCount : undefined
    const seenMembers = new Set<string>()
    for (const summary of record.summaries) {
      if (seenMembers.has(summary.memberId) || summary.roundsActed <= 0 || summary.playerCount < 2 || summary.finalPlace < 1 || summary.finalPlace > summary.playerCount) continue
      seenMembers.add(summary.memberId)
      const tiedCount = seats.filter(s => s.place === summary.finalPlace).length || 1
      const delta = ratingDelta(record.playerCount, summary.finalPlace, complete ? summary.totalAssetUnits : undefined, average, tiedCount)
      const current = ratings.get(summary.memberId) ?? { rating: 1200, matches: 0, changes: {} }
      current.rating += delta; current.matches += 1; current.changes[record.sessionId] = delta
      ratings.set(summary.memberId, current)
    }
  }
  return ratings
}

type Summary = MemberMatchSummary
type Definition = { id: string; name: string; detail: string; category: string; target: number; value: (s: readonly Summary[]) => number }
const sum = (s: readonly Summary[], field: keyof Summary) => s.reduce((n, row) => n + (typeof row[field] === 'number' ? row[field] as number : 0), 0)
const max = (s: readonly Summary[], field: keyof Summary) => Math.max(0, ...s.map(row => typeof row[field] === 'number' ? row[field] as number : 0))
export const ACHIEVEMENT_LIBRARY: Definition[] = [
  { id:'firstChampion',name:'初尝胜果',detail:'取得一次冠军',category:'征程',target:1,value:s=>s.filter(r=>r.champion).length },
  { id:'regular',name:'拍场常客',detail:'完成 10 局',category:'征程',target:10,value:s=>s.length },
  { id:'veteran',name:'拍场老将',detail:'完成 50 局',category:'征程',target:50,value:s=>s.length },
  { id:'century',name:'百战不倦',detail:'完成 100 局',category:'征程',target:100,value:s=>s.length },
  { id:'fiveCrowns',name:'五冠加身',detail:'累计取得 5 次冠军',category:'征程',target:5,value:s=>s.filter(r=>r.champion).length },
  { id:'tenCrowns',name:'十冠王',detail:'累计取得 10 次冠军',category:'征程',target:10,value:s=>s.filter(r=>r.champion).length },
  { id:'crowdedChampion',name:'以一当九',detail:'取得 10 人局冠军',category:'征程',target:1,value:s=>s.filter(r=>r.playerCount===10&&r.champion).length },
  { id:'comeback',name:'绝地翻盘',detail:'曾处资产后半区并最终夺冠',category:'征程',target:1,value:s=>s.filter(r=>r.champion&&r.cameFromBackHalf).length },
  { id:'collector',name:'收藏行家',detail:'标准局终局同类真实藏品达到 5 件',category:'收藏',target:5,value:s=>Math.max(0,...s.filter(r=>r.role==='seat').map(r=>Math.max(0,...Object.values(r.categoryCounts)))) },
  { id:'allCategories',name:'四方收藏',detail:'标准局终局持有全部四类真实藏品',category:'收藏',target:4,value:s=>Math.max(0,...s.filter(r=>r.role==='seat').map(r=>Object.values(r.categoryCounts).filter(n=>n>0).length)) },
  { id:'assets100',name:'家底丰厚',detail:'标准局固定资产加成达到 100 金币',category:'收藏',target:100,value:s=>max(s.filter(r=>r.role==='seat'),'fixedAssetUnits')/2 },
  { id:'prizeHunter',name:'拍品猎手',detail:'本人负责回合累计获得 20 件本轮拍品',category:'收藏',target:20,value:s=>sum(s,'itemsWon') },
  { id:'prophet',name:'神机妙算',detail:'一局预测第一命中 3 次',category:'预测',target:3,value:s=>max(s,'predictionHits') },
  { id:'prediction20',name:'眼光独到',detail:'累计预测第一命中 20 次',category:'预测',target:20,value:s=>sum(s,'predictionHits') },
  { id:'predictionProfit',name:'慧眼生金',detail:'一局预测净赚 30 金币',category:'预测',target:30,value:s=>max(s,'predictionNetUnits')/2 },
  { id:'perfectPrediction',name:'算无遗策',detail:'一局预测至少 3 次且全部命中',category:'预测',target:1,value:s=>s.filter(r=>r.predictionAttempts>=3&&r.predictionHits===r.predictionAttempts).length },
  { id:'market',name:'市场红人',detail:'一局成功售出 3 件拍品',category:'市场',target:3,value:s=>max(s,'assetSales') },
  { id:'firstSale',name:'开张大吉',detail:'成功售出一件拍品',category:'市场',target:1,value:s=>sum(s,'assetSales') },
  { id:'buyer',name:'淘宝能手',detail:'累计竞购成功 10 件拍品',category:'市场',target:10,value:s=>sum(s,'assetAuctionDeals') },
  { id:'cardBuyer',name:'补给专家',detail:'累计竞购成功 10 张道具',category:'市场',target:10,value:s=>sum(s,'cardAuctionDeals') },
  { id:'merchantIncome',name:'生意兴隆',detail:'一局道具销售收入达到 20 金币',category:'市场',target:20,value:s=>max(s,'cardAuctionIncomeUnits')/2 },
  { id:'investment100',name:'资本入场',detail:'累计对外投资 100 金币',category:'经营',target:100,value:s=>sum(s,'investmentUnits')/2 },
  { id:'profit100',name:'满载而归',detail:'一局净收益达到 100 金币',category:'经营',target:100,value:s=>max(s,'netUnits')/2 },
  { id:'cards50',name:'百变手牌',detail:'累计使用 50 张道具',category:'道具',target:50,value:s=>sum(s,'cardUses') },
  { id:'cardsRound',name:'连环妙手',detail:'一局使用 10 张道具',category:'道具',target:10,value:s=>max(s,'cardUses') },
  { id:'upgrades',name:'袖中造化',detail:'累计成功升级道具 5 次',category:'道具',target:5,value:s=>sum(s,'upgradeUses') },
  { id:'jackpot',name:'幸运降临',detail:'中一次彩票',category:'彩票',target:1,value:s=>sum(s,'lotteryWins') },
  { id:'jackpot3',name:'好运连连',detail:'累计中奖 3 次',category:'彩票',target:3,value:s=>sum(s,'lotteryWins') },
  { id:'lottery50',name:'天降横财',detail:'一局彩票奖金达到 50 金币',category:'彩票',target:50,value:s=>max(s,'lotteryPrizeUnits')/2 },
  { id:'relay10',name:'默契接棒',detail:'接力模式累计操作 10 轮',category:'接力',target:10,value:s=>sum(s.filter(r=>r.mode==='relay'),'roundsActed') },
  { id:'relayChampion',name:'合力登顶',detail:'实际参与一次接力冠军局',category:'接力',target:1,value:s=>s.filter(r=>r.mode==='relay'&&r.champion&&r.roundsActed>0).length },
]

export function achievementProgress(summaries: readonly Summary[]) {
  const unique = [...new Map(summaries.filter(s=>s.roundsActed>0).map(s=>[`${s.sessionId}:${s.memberId}`,s])).values()]
  return ACHIEVEMENT_LIBRARY.map(definition => {
    const progress = Math.min(definition.target, Math.max(0, definition.value(unique)))
    const unlocked = progress >= definition.target
    const modes: GameMode[] = unlocked ? (['standard','relay'] as const).filter(mode=>definition.value(unique.filter(s=>s.mode===mode)) >= definition.target) : []
    return { id:definition.id,name:definition.name,detail:definition.detail,category:definition.category,target:definition.target,progress,unlocked,modes:unlocked&&modes.length===0?[...new Set(unique.map(s=>s.mode))]:modes }
  })
}
