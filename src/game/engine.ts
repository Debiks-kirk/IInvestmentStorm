import { calculateFixedAssets } from './assets'
import type {
  CardEffect,
  CardId,
  FinalStanding,
  GameSettings,
  Item,
  Player,
  PlayerRoundDelta,
  PredictionOutcome,
  RankingEntry,
  RoundResult,
  RoundTurn,
} from './types'

export const COIN_UNIT = 2

export function coinsToUnits(coins: number): number {
  return Math.round(coins * COIN_UNIT)
}

export function unitsToCoins(units: number): number {
  return units / COIN_UNIT
}

export function formatCoins(units: number): string {
  const coins = unitsToCoins(Math.abs(units))
  const value = Number.isInteger(coins) ? String(coins) : coins.toFixed(1)
  return `${units < 0 ? '−' : ''}${value}`
}

export function defaultRewards(playerCount: number): number[] {
  if (playerCount === 3) return [2, 1]
  if (playerCount <= 5) return [2, 1, 0.5]
  return [2, 1.5, 1, 0.5]
}

export function validateSettings(settings: GameSettings): string[] {
  const errors: string[] = []
  if (settings.playerCount < 3 || settings.playerCount > 10) errors.push('玩家人数应为 3–10 人')
  if (settings.rounds < 1 || settings.rounds > 12) errors.push('轮数应为 1–12 轮')
  if (settings.initialCoins < 10 || settings.initialCoins > 200) errors.push('初始金币应为 10–200')
  if (settings.rewardMultipliers.length < 1 || settings.rewardMultipliers.length > settings.playerCount) errors.push('获奖人数必须介于 1 和玩家人数之间')
  if (settings.rewardMultipliers.some((value) => value < 0.5 || value > 5 || value * 2 % 1 !== 0)) errors.push('奖励倍率应为 0.5–5，且按 0.5 递增')
  if (settings.rewardMultipliers.some((value, index, values) => index > 0 && value > values[index - 1])) errors.push('后一个名次的奖励不能高于前一个名次')
  if (settings.cardGrantProbability < 0 || settings.cardGrantProbability > 100) errors.push('道具发放概率应为 0–100%')
  return errors
}

export function floorToHalfUnits(units: number): number {
  return Math.floor(units)
}

interface SettlementInput {
  playersAfterBids: Player[]
  turns: RoundTurn[]
  item: Item
  roundIndex: number
  rewardMultipliers: number[]
  correctPredictionMultiplier: number
  wrongPredictionMultiplier: number
  fairnessOrderIds: string[]
}

function rotate<T>(values: T[], amount: number): T[] {
  if (values.length === 0) return values
  const start = amount % values.length
  return [...values.slice(start), ...values.slice(0, start)]
}

function distributeUnits({
  totalUnits,
  playerIds,
  fairnessOrderIds,
  roundIndex,
}: {
  totalUnits: number
  playerIds: string[]
  fairnessOrderIds: string[]
  roundIndex: number
}): Map<string, number> {
  const payments = new Map<string, number>()
  if (playerIds.length === 0 || totalUnits <= 0) return payments
  const base = Math.floor(totalUnits / playerIds.length)
  const remainder = totalUnits % playerIds.length
  const fairRank = new Map(rotate(fairnessOrderIds, roundIndex).map((id, index) => [id, index]))
  const ordered = [...playerIds].sort((left, right) => (fairRank.get(left) ?? 999) - (fairRank.get(right) ?? 999))
  ordered.forEach((playerId, index) => payments.set(playerId, base + (index < remainder ? 1 : 0)))
  return payments
}

function cardEffect(cardId: CardId, description: string): CardEffect {
  return { cardId, description }
}

function valueFactor(turns: RoundTurn[]): number {
  return turns.reduce((factor, turn) => {
    if (turn.cardUse?.cardId === 'red') return factor * 2
    if (turn.cardUse?.cardId === 'black') return factor * 0.5
    return factor
  }, 1)
}

export function settleRound(input: SettlementInput): { players: Player[]; result: RoundResult } {
  const { playersAfterBids, turns, item, roundIndex, rewardMultipliers, correctPredictionMultiplier, wrongPredictionMultiplier, fairnessOrderIds } = input
  const players = playersAfterBids.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory] }))
  const playerById = new Map(players.map((player) => [player.id, player]))
  const deltaByPlayer = new Map<string, PlayerRoundDelta>(players.map((player) => [player.id, {
    playerId: player.id,
    rewardUnits: 0,
    predictionUnits: 0,
    cardUnits: 0,
    publicDeltaUnits: 0,
  }]))
  const cardEffects: CardEffect[] = []

  let redistributionTransferUnits: number | null = null
  const redistributionUse = turns.find((turn) => turn.cardUse?.cardId === 'redistribute')
  if (redistributionUse) {
    const highestBalance = Math.max(...players.map((player) => player.balanceUnits))
    const lowestBalance = Math.min(...players.map((player) => player.balanceUnits))
    const richest = players.filter((player) => player.balanceUnits === highestBalance)
    const poorest = players.filter((player) => player.balanceUnits === lowestBalance)
    const poolUnits = richest.reduce((total, player) => total + floorToHalfUnits(player.balanceUnits / 4), 0)
    redistributionTransferUnits = poolUnits
    for (const player of richest) {
      const payment = floorToHalfUnits(player.balanceUnits / 4)
      player.balanceUnits -= payment
      ;(deltaByPlayer.get(player.id) as PlayerRoundDelta).cardUnits -= payment
    }
    const allocations = distributeUnits({ totalUnits: poolUnits, playerIds: poorest.map((player) => player.id), fairnessOrderIds, roundIndex })
    for (const [playerId, payment] of allocations) {
      const player = playerById.get(playerId)
      if (!player) continue
      player.balanceUnits += payment
      ;(deltaByPlayer.get(playerId) as PlayerRoundDelta).cardUnits += payment
    }
    cardEffects.push(cardEffect('redistribute', poolUnits > 0 ? `劫富济贫已生效：本轮共转移 ${formatCoins(poolUnits)} 金币。` : '劫富济贫已使用，但本轮没有可转移的金币。'))
  }

  const rankingBids = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits]))
  for (const turn of turns) {
    if (turn.cardUse?.cardId !== 'swap' || !turn.cardUse.targetPlayerId) continue
    const targetBid = rankingBids.get(turn.cardUse.targetPlayerId)
    const ownBid = rankingBids.get(turn.playerId)
    if (targetBid === undefined || ownBid === undefined) continue
    rankingBids.set(turn.playerId, targetBid)
    rankingBids.set(turn.cardUse.targetPlayerId, ownBid)
    cardEffects.push(cardEffect('swap', '两笔投资的排名金额已互换。'))
  }
  for (const turn of turns) {
    if (turn.cardUse?.cardId !== 'doubleBid') continue
    rankingBids.set(turn.playerId, (rankingBids.get(turn.playerId) ?? turn.bidUnits) * 2)
    cardEffects.push(cardEffect('doubleBid', '有一笔投资以双倍金额参与排名。'))
  }

  const factor = valueFactor(turns)
  const effectiveValueUnits = floorToHalfUnits(item.value * COIN_UNIT * factor)
  const redUsed = turns.some((turn) => turn.cardUse?.cardId === 'red')
  const blackUsed = turns.some((turn) => turn.cardUse?.cardId === 'black')
  if (redUsed) cardEffects.push(cardEffect('red', `红卡已生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  if (blackUsed) cardEffects.push(cardEffect('black', `黑卡已生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  for (const turn of turns) {
    if (turn.cardUse?.cardId === 'peek') cardEffects.push(cardEffect('peek', '有人偷看了一笔已提交的投资。'))
  }

  const rankingTurns = turns.map((turn) => ({ ...turn, rankingBidUnits: rankingBids.get(turn.playerId) ?? turn.bidUnits }))
  const bidCounts = new Map<number, number>()
  for (const turn of rankingTurns) bidCounts.set(turn.rankingBidUnits, (bidCounts.get(turn.rankingBidUnits) ?? 0) + 1)
  const sortedUniqueTurns = rankingTurns.filter((turn) => bidCounts.get(turn.rankingBidUnits) === 1).sort((left, right) => right.rankingBidUnits - left.rankingBidUnits)
  const tiedPlayerIds = rankingTurns.filter((turn) => (bidCounts.get(turn.rankingBidUnits) ?? 0) > 1).map((turn) => turn.playerId)
  const rankings: RankingEntry[] = sortedUniqueTurns.slice(0, rewardMultipliers.length).map((turn, index) => ({
    playerId: turn.playerId,
    place: index + 1,
    bidUnits: turn.rankingBidUnits,
    actualBidUnits: turn.bidUnits,
    rewardUnits: floorToHalfUnits(effectiveValueUnits * rewardMultipliers[index]),
  }))
  const winnerId = sortedUniqueTurns[0]?.playerId ?? null

  for (const ranking of rankings) {
    const player = playerById.get(ranking.playerId)
    const delta = deltaByPlayer.get(ranking.playerId)
    if (!player || !delta) continue
    player.balanceUnits += ranking.rewardUnits
    delta.rewardUnits += ranking.rewardUnits
    if (ranking.place === 1) player.items.push({ item, roundIndex })
  }

  const predictionOutcomes: PredictionOutcome[] = []
  const correctTurns: RoundTurn[] = []
  for (const turn of turns) {
    const player = playerById.get(turn.playerId)
    const delta = deltaByPlayer.get(turn.playerId)
    if (!player || !delta) continue
    if (turn.predictedPlayerId === null) {
      predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: null, status: 'skipped', deltaUnits: 0 })
    } else if (winnerId !== null && turn.predictedPlayerId === winnerId) {
      correctTurns.push(turn)
    } else {
      const due = floorToHalfUnits(effectiveValueUnits * wrongPredictionMultiplier)
      const paid = Math.min(player.balanceUnits, due)
      player.balanceUnits -= paid
      delta.predictionUnits -= paid
      predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'wrong', deltaUnits: -paid })
    }
  }

  let winnerPaymentUnits = 0
  if (winnerId && correctTurns.length > 0) {
    const winner = playerById.get(winnerId)
    const winnerDelta = deltaByPlayer.get(winnerId)
    if (winner && winnerDelta) {
      const maximumPerPlayer = floorToHalfUnits(effectiveValueUnits * correctPredictionMultiplier)
      winnerPaymentUnits = Math.min(winner.balanceUnits, maximumPerPlayer * correctTurns.length)
      const payments = distributeUnits({ totalUnits: winnerPaymentUnits, playerIds: correctTurns.map((turn) => turn.playerId), fairnessOrderIds, roundIndex })
      winner.balanceUnits -= winnerPaymentUnits
      winnerDelta.predictionUnits -= winnerPaymentUnits
      for (const turn of correctTurns) {
        const payment = payments.get(turn.playerId) ?? 0
        const player = playerById.get(turn.playerId)
        const delta = deltaByPlayer.get(turn.playerId)
        if (player && delta) {
          player.balanceUnits += payment
          delta.predictionUnits += payment
        }
        predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'correct', deltaUnits: payment })
      }
    }
  }

  const outcomeOrder = new Map(turns.map((turn, index) => [turn.playerId, index]))
  predictionOutcomes.sort((left, right) => (outcomeOrder.get(left.playerId) ?? 0) - (outcomeOrder.get(right.playerId) ?? 0))
  const highestBalance = Math.max(...players.map((player) => player.balanceUnits))
  const balanceLeaderIds = players.filter((player) => player.balanceUnits === highestBalance).map((player) => player.id)
  const deltas = players.map((player) => {
    const delta = deltaByPlayer.get(player.id) as PlayerRoundDelta
    return { ...delta, publicDeltaUnits: delta.rewardUnits + delta.predictionUnits }
  })
  const result: RoundResult = {
    roundIndex,
    item,
    effectiveValueUnits,
    turns: turns.map((turn) => ({ ...turn, cardUse: turn.cardUse ? { ...turn.cardUse } : undefined })),
    rankings,
    tiedPlayerIds,
    winnerId,
    totalBidUnits: turns.reduce((total, turn) => total + turn.bidUnits, 0),
    minWinningBidUnits: rankings.length > 0 ? Math.min(...rankings.map((ranking) => ranking.bidUnits)) : null,
    predictionOutcomes,
    winnerPaymentUnits,
    cardEffects,
    redistributionTransferUnits,
    balanceLeaderIds,
    deltas,
    balancesAfter: Object.fromEntries(players.map((player) => [player.id, player.balanceUnits])),
  }
  return { players, result }
}

export function rankFinalPlayers(players: Player[]): FinalStanding[] {
  const enriched = players.map((player) => {
    const fixedAssets = calculateFixedAssets(player.items)
    const fixedAssetUnits = fixedAssets.reduce((total, entry) => total + entry.units, 0)
    return { player, cashUnits: player.balanceUnits, fixedAssetUnits, totalAssetUnits: player.balanceUnits + fixedAssetUnits, fixedAssets }
  }).sort((left, right) => right.totalAssetUnits - left.totalAssetUnits)
  return enriched.map((standing, index) => ({
    ...standing,
    place: index > 0 && standing.totalAssetUnits === enriched[index - 1].totalAssetUnits ? enriched.slice(0, index).findIndex((item) => item.totalAssetUnits === standing.totalAssetUnits) + 1 : index + 1,
  }))
}
