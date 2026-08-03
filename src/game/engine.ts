import type {
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
  if (settings.rewardMultipliers.length < 1 || settings.rewardMultipliers.length > settings.playerCount) {
    errors.push('获奖人数必须介于 1 和玩家人数之间')
  }
  if (settings.rewardMultipliers.some((value) => value < 0.5 || value > 5 || value * 2 % 1 !== 0)) {
    errors.push('奖励倍率应为 0.5–5，且按 0.5 递增')
  }
  if (settings.rewardMultipliers.some((value, index, values) => index > 0 && value > values[index - 1])) {
    errors.push('后一个名次的奖励不能高于前一个名次')
  }
  return errors
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

export function settleRound(input: SettlementInput): { players: Player[]; result: RoundResult } {
  const {
    playersAfterBids,
    turns,
    item,
    roundIndex,
    rewardMultipliers,
    correctPredictionMultiplier,
    wrongPredictionMultiplier,
    fairnessOrderIds,
  } = input
  const players = playersAfterBids.map((player) => ({ ...player, items: [...player.items] }))
  const playerById = new Map(players.map((player) => [player.id, player]))
  const bidCounts = new Map<number, number>()
  for (const turn of turns) bidCounts.set(turn.bidUnits, (bidCounts.get(turn.bidUnits) ?? 0) + 1)

  const sortedUniqueTurns = turns
    .filter((turn) => bidCounts.get(turn.bidUnits) === 1)
    .sort((left, right) => right.bidUnits - left.bidUnits)
  const tiedPlayerIds = turns
    .filter((turn) => (bidCounts.get(turn.bidUnits) ?? 0) > 1)
    .map((turn) => turn.playerId)
  const rankings: RankingEntry[] = sortedUniqueTurns.slice(0, rewardMultipliers.length).map((turn, index) => ({
    playerId: turn.playerId,
    place: index + 1,
    bidUnits: turn.bidUnits,
    rewardUnits: Math.round(item.value * COIN_UNIT * rewardMultipliers[index]),
  }))
  const winnerId = sortedUniqueTurns[0]?.playerId ?? null

  const deltaByPlayer = new Map<string, PlayerRoundDelta>(
    players.map((player) => [player.id, { playerId: player.id, rewardUnits: 0, predictionUnits: 0, publicDeltaUnits: 0 }]),
  )

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
      const due = Math.round(item.value * COIN_UNIT * wrongPredictionMultiplier)
      const paid = Math.min(player.balanceUnits, due)
      player.balanceUnits -= paid
      delta.predictionUnits -= paid
      predictionOutcomes.push({
        playerId: turn.playerId,
        predictedPlayerId: turn.predictedPlayerId,
        status: 'wrong',
        deltaUnits: -paid,
      })
    }
  }

  let winnerPaymentUnits = 0
  if (winnerId && correctTurns.length > 0) {
    const winner = playerById.get(winnerId)
    const winnerDelta = deltaByPlayer.get(winnerId)
    if (winner && winnerDelta) {
      const maximumPerPlayer = Math.round(item.value * COIN_UNIT * correctPredictionMultiplier)
      winnerPaymentUnits = Math.min(winner.balanceUnits, maximumPerPlayer * correctTurns.length)
      const basePayment = Math.floor(winnerPaymentUnits / correctTurns.length)
      const remainder = winnerPaymentUnits % correctTurns.length
      const rotatedFairness = rotate(fairnessOrderIds, roundIndex)
      const fairRank = new Map(rotatedFairness.map((id, index) => [id, index]))
      const orderedCorrect = [...correctTurns].sort(
        (left, right) => (fairRank.get(left.playerId) ?? 999) - (fairRank.get(right.playerId) ?? 999),
      )
      const paymentByPlayer = new Map<string, number>()
      orderedCorrect.forEach((turn, index) => paymentByPlayer.set(turn.playerId, basePayment + (index < remainder ? 1 : 0)))

      winner.balanceUnits -= winnerPaymentUnits
      winnerDelta.predictionUnits -= winnerPaymentUnits
      for (const turn of correctTurns) {
        const payment = paymentByPlayer.get(turn.playerId) ?? 0
        const player = playerById.get(turn.playerId)
        const delta = deltaByPlayer.get(turn.playerId)
        if (player && delta) {
          player.balanceUnits += payment
          delta.predictionUnits += payment
        }
        predictionOutcomes.push({
          playerId: turn.playerId,
          predictedPlayerId: turn.predictedPlayerId,
          status: 'correct',
          deltaUnits: payment,
        })
      }
    }
  }

  const outcomeOrder = new Map(turns.map((turn, index) => [turn.playerId, index]))
  predictionOutcomes.sort((left, right) => (outcomeOrder.get(left.playerId) ?? 0) - (outcomeOrder.get(right.playerId) ?? 0))
  const deltas = players.map((player) => {
    const delta = deltaByPlayer.get(player.id) as PlayerRoundDelta
    return { ...delta, publicDeltaUnits: delta.rewardUnits + delta.predictionUnits }
  })
  const result: RoundResult = {
    roundIndex,
    item,
    turns: turns.map((turn) => ({ ...turn })),
    rankings,
    tiedPlayerIds,
    winnerId,
    totalBidUnits: turns.reduce((total, turn) => total + turn.bidUnits, 0),
    minWinningBidUnits: rankings.length > 0 ? Math.min(...rankings.map((ranking) => ranking.bidUnits)) : null,
    predictionOutcomes,
    winnerPaymentUnits,
    deltas,
    balancesAfter: Object.fromEntries(players.map((player) => [player.id, player.balanceUnits])),
  }
  return { players, result }
}

export function rankFinalPlayers(players: Player[]): FinalStanding[] {
  const sorted = [...players].sort((left, right) => right.balanceUnits - left.balanceUnits)
  return sorted.map((player, index) => ({
    player,
    place: index > 0 && player.balanceUnits === sorted[index - 1].balanceUnits ? sorted.slice(0, index).findIndex((item) => item.balanceUnits === player.balanceUnits) + 1 : index + 1,
  }))
}

