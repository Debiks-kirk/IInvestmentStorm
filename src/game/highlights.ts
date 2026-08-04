import { categoryConfig } from './assets'
import { rankFinalPlayers } from './engine'
import type { GameSession, Player, RoundResult } from './types'

export interface GameHighlight {
  id: 'boldestBid' | 'sharpestPrediction' | 'cardMoment' | 'comeback' | 'collector'
  symbol: string
  title: string
  detail: string
}

function nameOf(players: Player[], playerId: string | null | undefined): string {
  return players.find((player) => player.id === playerId)?.name ?? '一位玩家'
}

function cashPlace(players: Player[], balances: Record<string, number>, playerId: string): number {
  const own = balances[playerId] ?? 0
  return 1 + players.filter((player) => (balances[player.id] ?? 0) > own).length
}

/** Creates compact end-of-game stories from already settled data; it never changes scoring. */
export function createGameHighlights(session: Pick<GameSession, 'players' | 'results'>): GameHighlight[] {
  const { players, results } = session
  const turns = results.flatMap((result) => result.turns.map((turn) => ({ result, turn })))
  const boldest = [...turns].sort((left, right) => right.turn.bidUnits - left.turn.bidUnits)[0]
  const correctByPlayer = new Map(players.map((player) => [player.id, 0]))
  results.forEach((result) => result.predictionOutcomes.filter((outcome) => outcome.status === 'correct').forEach((outcome) => correctByPlayer.set(outcome.playerId, (correctByPlayer.get(outcome.playerId) ?? 0) + 1)))
  const sharpest = [...correctByPlayer.entries()].sort((left, right) => right[1] - left[1])[0]
  const shieldRound = results.find((result) => result.autoConsumedCardIds.includes('reflectShield'))
  const bananaTurn = turns.find(({ turn }) => turn.cardUses?.some((use) => use.cardId === 'bananaPeel'))
  const swapTurn = turns.find(({ turn }) => turn.cardUses?.some((use) => use.cardId === 'swap'))
  const kidnappedRound = results.find((result) => result.itemWinnerId && result.winnerId && result.itemWinnerId !== result.winnerId)
  const standings = rankFinalPlayers(players)
  const comeback = players.map((player) => {
    const worstPlace = Math.max(1, ...results.map((result) => cashPlace(players, result.balancesAfter, player.id)))
    const finalPlace = standings.find((standing) => standing.player.id === player.id)?.place ?? players.length
    return { player, rise: worstPlace - finalPlace, worstPlace, finalPlace }
  }).sort((left, right) => right.rise - left.rise)[0]
  const collector = [...standings].sort((left, right) => right.fixedAssetUnits - left.fixedAssetUnits)[0]
  const topCollection = collector?.fixedAssets.filter((asset) => asset.units > 0).sort((left, right) => right.units - left.units)[0]

  return [
    {
      id: 'boldestBid', symbol: '⚡', title: '最大胆下注',
      detail: boldest && boldest.turn.bidUnits > 0 ? `${nameOf(players, boldest.turn.playerId)} 在第 ${boldest.result.roundIndex + 1} 轮一口气投入 ${boldest.turn.bidUnits / 2} 金币。` : '本局大家都很克制，没有出现高额下注。',
    },
    {
      id: 'sharpestPrediction', symbol: '◎', title: '最精准预言',
      detail: sharpest && sharpest[1] > 0 ? `${nameOf(players, sharpest[0])} 猜中 ${sharpest[1]} 次赢家。` : '本局没有人猜中赢家，所有预言都落空了。',
    },
    {
      id: 'cardMoment', symbol: shieldRound ? '🛡' : '🃏', title: shieldRound ? '最成功反弹' : '最狠背刺',
      detail: shieldRound ? `第 ${shieldRound.roundIndex + 1} 轮，反弹护盾改写了一次指定效果。` : bananaTurn ? `${nameOf(players, bananaTurn.turn.playerId)} 在第 ${bananaTurn.result.roundIndex + 1} 轮打出了香蕉皮。` : swapTurn ? `${nameOf(players, swapTurn.turn.playerId)} 在第 ${swapTurn.result.roundIndex + 1} 轮偷天换日，交换了排名金额。` : kidnappedRound ? `第 ${kidnappedRound.roundIndex + 1} 轮的 ${kidnappedRound.item.name} 被人抢走。` : '本局没有出现决定胜负的指定型道具。',
    },
    {
      id: 'comeback', symbol: '↗', title: '最大逆转',
      detail: comeback && comeback.rise > 0 ? `${comeback.player.name} 曾跌至第 ${comeback.worstPlace}，最终冲到第 ${comeback.finalPlace}。` : '本局排名一路胶着，没有出现明显逆转。',
    },
    {
      id: 'collector', symbol: '✦', title: '最会收藏',
      detail: collector && collector.fixedAssetUnits > 0 ? `${collector.player.name} 的固定资产额外价值 ${collector.fixedAssetUnits / 2} 金币${topCollection ? `，主力是${categoryConfig(topCollection.category).name}` : ''}。` : '本局尚未凑出固定资产收藏加成。',
    },
  ]
}

/** One public, no-number story line for the settlement page. */
export function createRoundBulletin(result: RoundResult, previous: RoundResult | undefined, revealBalanceLeader: boolean): string {
  const correctCount = result.predictionOutcomes.filter((outcome) => outcome.status === 'correct').length
  const first = result.rankings[0]
  const second = result.rankings[1]
  const leaderChanged = revealBalanceLeader && previous && previous.balanceLeaderIds.join('|') !== result.balanceLeaderIds.join('|')
  if (!result.winnerId) return '本轮没有唯一第一名，拍品流拍。'
  if (result.tiedPlayerIds.length > 0 && result.rankings.length < 2) return '多人并列出局，奖区出现了空位。'
  if (first && second && first.bidUnits - second.bidUnits <= 1) return '有人以极小优势压线获奖。'
  if (correctCount === 0) return '本轮无人猜中赢家。'
  if (leaderChanged) return '财富领跑者发生更替。'
  return '密封标全部落定，本轮奖励已经发放。'
}
