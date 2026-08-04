import { calculateFixedAssets } from './assets'
import { defaultIdentitySettings, taskLabel } from './identities'
import type {
  CardEffect,
  CardId,
  CardUse,
  FinalStanding,
  GameSettings,
  IdentityEvent,
  IdentitySettings,
  Item,
  Player,
  PlayerRoundDelta,
  PredictionOutcome,
  RankingEntry,
  RoundResult,
  RoundTurn,
  LobbyistContract,
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
  totalRounds?: number
  identitySettings?: IdentitySettings
  identityContracts?: LobbyistContract[]
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

function cardUses(turn: RoundTurn): CardUse[] {
  return (turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])).slice(0, 2)
}

function rankingReversalDescription(count: number): string {
  if (count === 1) return '获奖区排名已被逆转。'
  if (count % 2 === 0) return `获奖区排名被逆转了 ${count} 次，故排名不变。`
  return `获奖区排名被逆转了 ${count} 次，最终仍为逆转排名。`
}

function valueFactor(uses: CardUse[]): number {
  return uses.reduce((factor, use) => {
    if (use.cardId === 'red') return factor * 2
    if (use.cardId === 'black') return factor * 0.5
    return factor
  }, 1)
}

export function settleRound(input: SettlementInput): { players: Player[]; result: RoundResult; identityContracts: LobbyistContract[]; identityEvents: IdentityEvent[] } {
  const { playersAfterBids, turns, item, roundIndex, rewardMultipliers, correctPredictionMultiplier, wrongPredictionMultiplier, fairnessOrderIds } = input
  const identitySettings = input.identitySettings ?? defaultIdentitySettings(false)
  const identityContracts = (input.identityContracts ?? []).map((contract) => ({ ...contract }))
  const players = playersAfterBids.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
  const playerById = new Map(players.map((player) => [player.id, player]))
  const deltaByPlayer = new Map<string, PlayerRoundDelta>(players.map((player) => [player.id, {
    playerId: player.id,
    rewardUnits: 0,
    predictionUnits: 0,
    cardUnits: 0,
    identityUnits: 0,
    publicDeltaUnits: 0,
  }]))
  const cardEffects: CardEffect[] = []
  const identityEvents: IdentityEvent[] = []
  const usedCards = turns.flatMap((turn) => cardUses(turn).map((use) => ({ playerId: turn.playerId, use })))

  let redistributionTransferUnits: number | null = null
  const redistributionUse = usedCards.find(({ use }) => use.cardId === 'redistribute')
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

  for (const { playerId, use } of usedCards) {
    if (use.cardId !== 'fateCoin') continue
    const player = playerById.get(playerId)
    const delta = deltaByPlayer.get(playerId)
    if (!player || !delta) continue
    if (use.coinResult === 'heads') {
      const gained = coinsToUnits(6)
      player.balanceUnits += gained
      delta.cardUnits += gained
      cardEffects.push(cardEffect('fateCoin', '命运硬币：正面朝上，获得 6 金币。'))
    } else {
      const lost = Math.min(player.balanceUnits, coinsToUnits(4))
      player.balanceUnits -= lost
      delta.cardUnits -= lost
      cardEffects.push(cardEffect('fateCoin', `命运硬币：反面朝上，损失 ${formatCoins(lost)} 金币。`))
    }
  }

  const rankingBids = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits]))
  for (const { playerId, use } of usedCards) {
    if (use.cardId !== 'swap' || !use.targetPlayerId) continue
    const targetBid = rankingBids.get(use.targetPlayerId)
    const ownBid = rankingBids.get(playerId)
    if (targetBid === undefined || ownBid === undefined) continue
    rankingBids.set(playerId, targetBid)
    rankingBids.set(use.targetPlayerId, ownBid)
    cardEffects.push(cardEffect('swap', '两笔投资的排名金额已互换。'))
  }
  for (const { playerId, use } of usedCards) {
    if (use.cardId !== 'doubleBid') continue
    const actualBid = turns.find((turn) => turn.playerId === playerId)?.bidUnits ?? 0
    rankingBids.set(playerId, (rankingBids.get(playerId) ?? actualBid) * 2)
    cardEffects.push(cardEffect('doubleBid', '有一笔投资以双倍金额参与排名。'))
  }

  const factor = valueFactor(usedCards.map(({ use }) => use))
  const effectiveValueUnits = floorToHalfUnits(item.value * COIN_UNIT * factor)
  const redUsed = usedCards.some(({ use }) => use.cardId === 'red')
  const blackUsed = usedCards.some(({ use }) => use.cardId === 'black')
  if (redUsed) cardEffects.push(cardEffect('red', `红卡已生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  if (blackUsed) cardEffects.push(cardEffect('black', `黑卡已生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  for (const { use } of usedCards) {
    if (use.cardId === 'peek') cardEffects.push(cardEffect('peek', '有人偷看了一笔已提交的投资。'))
  }

  const rankingTurns = turns.map((turn) => ({ ...turn, rankingBidUnits: rankingBids.get(turn.playerId) ?? turn.bidUnits }))
  const bidCounts = new Map<number, number>()
  for (const turn of rankingTurns) bidCounts.set(turn.rankingBidUnits, (bidCounts.get(turn.rankingBidUnits) ?? 0) + 1)
  const sortedUniqueTurns = rankingTurns.filter((turn) => bidCounts.get(turn.rankingBidUnits) === 1).sort((left, right) => right.rankingBidUnits - left.rankingBidUnits)
  const tiedPlayerIds = rankingTurns.filter((turn) => (bidCounts.get(turn.rankingBidUnits) ?? 0) > 1).map((turn) => turn.playerId)
  const reverserTurn = turns.find((turn) => turn.identityAction?.type === 'reverserInvert' && playerById.get(turn.playerId)?.identity?.id === 'reverser')
  const rankingReversalCount = usedCards.filter(({ use }) => use.cardId === 'reverseRank').length + (reverserTurn ? 1 : 0)
  if (reverserTurn) {
    const reverser = playerById.get(reverserTurn.playerId)
    const reverserDelta = deltaByPlayer.get(reverserTurn.playerId)
    const multiplier = roundIndex >= (input.totalRounds ?? Number.MAX_SAFE_INTEGER) - 2 ? 2 : 1
    const due = coinsToUnits(identitySettings.reverserActivationCoins * multiplier)
    const paid = Math.min(reverser?.balanceUnits ?? 0, due)
    if (reverser && reverserDelta) {
      reverser.balanceUnits -= paid
      reverserDelta.identityUnits -= paid
      identityEvents.push({ playerId: reverser.id, identityId: 'reverser', roundIndex, title: '发动逆转排名', detail: `支付 ${formatCoins(paid)} 金币，获奖区名次已倒转。`, deltaUnits: -paid })
    }
  }
  if (rankingReversalCount > 0) cardEffects.push(cardEffect('reverseRank', rankingReversalDescription(rankingReversalCount)))
  const winningTurns = sortedUniqueTurns.slice(0, rewardMultipliers.length)
  const rankedTurns = rankingReversalCount % 2 === 1 ? [...winningTurns].reverse() : winningTurns
  const rankings: RankingEntry[] = rankedTurns.map((turn, index) => ({ playerId: turn.playerId, place: index + 1, bidUnits: turn.rankingBidUnits, actualBidUnits: turn.bidUnits, rewardUnits: floorToHalfUnits(effectiveValueUnits * rewardMultipliers[index]), publicRewardUnits: floorToHalfUnits(effectiveValueUnits * rewardMultipliers[index]) }))
  const winnerId = rankedTurns[0]?.playerId ?? null
  const itemWinnerId = winnerId

  for (const ranking of rankings) {
    const player = playerById.get(ranking.playerId)
    const delta = deltaByPlayer.get(ranking.playerId)
    if (!player || !delta) continue
    player.balanceUnits += ranking.rewardUnits
    delta.rewardUnits += ranking.publicRewardUnits
    if (ranking.playerId === itemWinnerId) player.items.push({ item, roundIndex })
  }

  const predictionOutcomes: PredictionOutcome[] = []
  const correctTurns: RoundTurn[] = []
  for (const turn of turns) {
    const player = playerById.get(turn.playerId)
    const delta = deltaByPlayer.get(turn.playerId)
    if (!player || !delta) continue
    if (turn.predictedPlayerId === null) {
      if (player.identity?.id === 'gambler') {
        const due = floorToHalfUnits(effectiveValueUnits * identitySettings.gamblerSkipPenaltyMultiplier)
        const paid = Math.min(player.balanceUnits, due)
        player.balanceUnits -= paid
        delta.identityUnits -= paid
        identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '跳过预测', detail: `支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
      }
      predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: null, status: 'skipped', deltaUnits: 0 })
    } else if (winnerId !== null && turn.predictedPlayerId === winnerId) {
      correctTurns.push(turn)
    } else {
      const gambler = player.identity?.id === 'gambler'
      const due = floorToHalfUnits(effectiveValueUnits * (gambler ? identitySettings.gamblerSkipPenaltyMultiplier : wrongPredictionMultiplier))
      const paid = Math.min(player.balanceUnits, due)
      player.balanceUnits -= paid
      if (gambler) {
        delta.identityUnits -= paid
        identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '猜错预测', detail: `支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
        predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'wrong', deltaUnits: 0 })
      } else {
        delta.predictionUnits -= paid
        predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'wrong', deltaUnits: -paid })
      }
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

  for (const turn of correctTurns) {
    const player = playerById.get(turn.playerId)
    const delta = deltaByPlayer.get(turn.playerId)
    if (!player || !delta || player.identity?.id !== 'gambler') continue
    const bonus = floorToHalfUnits(effectiveValueUnits * identitySettings.gamblerCorrectBonusMultiplier)
    player.balanceUnits += bonus
    delta.identityUnits += bonus
    identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '预测加注奖励', detail: `猜中额外获得 ${formatCoins(bonus)} 金币。`, deltaUnits: bonus })
  }

  for (const turn of turns) {
    const player = playerById.get(turn.playerId)
    const delta = deltaByPlayer.get(turn.playerId)
    if (!player || !delta || player.identity?.id !== 'assassin' || !player.identity.targetPlayerId) continue
    const targetTurn = turns.find((candidate) => candidate.playerId === player.identity?.targetPlayerId)
    const success = Boolean(targetTurn && turn.bidUnits > targetTurn.bidUnits)
    const amount = coinsToUnits(success ? identitySettings.assassinSuccessCoins : identitySettings.assassinFailureCoins)
    const paid = success ? amount : Math.min(player.balanceUnits, amount)
    player.balanceUnits += success ? paid : -paid
    delta.identityUnits += success ? paid : -paid
    identityEvents.push({ playerId: player.id, identityId: 'assassin', roundIndex, title: success ? '刺客得手' : '刺客失手', detail: success ? `投资超过目标，获得 ${formatCoins(paid)} 金币。` : `投资未超过目标，失去 ${formatCoins(paid)} 金币。`, deltaUnits: success ? paid : -paid })
  }

  const executable = identityContracts.filter((contract) => contract.status === 'pending' && contract.executeRoundIndex === roundIndex)
  const turnById = new Map(turns.map((turn) => [turn.playerId, turn]))
  const rankingIds = new Set(rankings.map((ranking) => ranking.playerId))
  const failedContracts: LobbyistContract[] = []
  for (const contract of executable) {
    const own = turnById.get(contract.targetPlayerId)
    const comparison = contract.comparisonPlayerId ? turnById.get(contract.comparisonPlayerId) : undefined
    const success = contract.taskType === 'outbid' ? Boolean(own && comparison && own.bidUnits > comparison.bidUnits)
      : contract.taskType === 'underbid' ? Boolean(own && comparison && own.bidUnits < comparison.bidUnits)
        : contract.taskType === 'avoidPrize' ? !rankingIds.has(contract.targetPlayerId)
          : winnerId === contract.targetPlayerId
    contract.status = success ? 'success' : 'failed'
    if (success) {
      identityEvents.push({ playerId: contract.targetPlayerId, identityId: 'lobbyist', roundIndex, title: '说客任务完成', detail: `完成「${taskLabel(contract.taskType)}」，本轮无需支付违约款。`, deltaUnits: 0 })
      identityEvents.push({ playerId: contract.issuerId, identityId: 'lobbyist', roundIndex, title: '说客任务完成', detail: `任务对象完成「${taskLabel(contract.taskType)}」，本轮未产生违约款。`, deltaUnits: 0 })
      continue
    }
    failedContracts.push(contract)
  }

  const failedByTarget = new Map<string, LobbyistContract[]>()
  for (const contract of failedContracts) {
    const existing = failedByTarget.get(contract.targetPlayerId) ?? []
    existing.push(contract)
    failedByTarget.set(contract.targetPlayerId, existing)
  }
  const fairRank = new Map(rotate(fairnessOrderIds, roundIndex).map((id, index) => [id, index]))
  const due = coinsToUnits(identitySettings.lobbyistFailurePaymentCoins)
  for (const [targetId, contracts] of failedByTarget) {
    const target = playerById.get(targetId)
    const totalAvailable = Math.min(target?.balanceUnits ?? 0, due * contracts.length)
    const ordered = [...contracts].sort((left, right) => (fairRank.get(left.issuerId) ?? Number.MAX_SAFE_INTEGER) - (fairRank.get(right.issuerId) ?? Number.MAX_SAFE_INTEGER))
    const basePayment = Math.floor(totalAvailable / ordered.length)
    const remainder = totalAvailable % ordered.length
    if (target) {
      target.balanceUnits -= totalAvailable
      ;(deltaByPlayer.get(target.id) as PlayerRoundDelta).identityUnits -= totalAvailable
    }
    ordered.forEach((contract, index) => {
      const paid = basePayment + (index < remainder ? 1 : 0)
      const issuer = playerById.get(contract.issuerId)
      if (issuer) {
        issuer.balanceUnits += paid
        ;(deltaByPlayer.get(issuer.id) as PlayerRoundDelta).identityUnits += paid
        if (issuer.identity?.id === 'lobbyist') issuer.identity.lobbyistNextFree = true
      }
      contract.paymentUnits = paid
      identityEvents.push({ playerId: contract.targetPlayerId, identityId: 'lobbyist', roundIndex, title: '说客任务未完成', detail: `未完成「${taskLabel(contract.taskType)}」，支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
      identityEvents.push({ playerId: contract.issuerId, identityId: 'lobbyist', roundIndex, title: '收到违约款', detail: `任务对象未完成「${taskLabel(contract.taskType)}」，获得 ${formatCoins(paid)} 金币。`, deltaUnits: paid })
    })
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
    turns: turns.map((turn) => ({ ...turn, cardUses: cardUses(turn).map((use) => ({ ...use })), cardUse: turn.cardUse ? { ...turn.cardUse } : undefined })),
    rankings,
    tiedPlayerIds,
    winnerId,
    totalBidUnits: turns.reduce((total, turn) => total + turn.bidUnits, 0),
    minWinningBidUnits: rankings.length > 0 ? Math.min(...rankings.map((ranking) => ranking.bidUnits)) : null,
    predictionOutcomes,
    winnerPaymentUnits,
    cardEffects,
    rankingReversalCount,
    redistributionTransferUnits,
    balanceLeaderIds,
    deltas,
    balancesAfter: Object.fromEntries(players.map((player) => [player.id, player.balanceUnits])),
    identityEvents,
  }
  return { players, result, identityContracts, identityEvents }
}

export function rankFinalPlayers(players: Player[]): FinalStanding[] {
  const enriched = players.map((player) => {
    const fixedAssets = calculateFixedAssets(player.items, player.identity?.id === 'collector' && player.identity.collectorCategory ? player.identity.collectorCategory : undefined)
    const fixedAssetUnits = fixedAssets.reduce((total, entry) => total + entry.units, 0)
    return { player, cashUnits: player.balanceUnits, fixedAssetUnits, totalAssetUnits: player.balanceUnits + fixedAssetUnits, fixedAssets }
  }).sort((left, right) => right.totalAssetUnits - left.totalAssetUnits)
  return enriched.map((standing, index) => ({
    ...standing,
    place: index > 0 && standing.totalAssetUnits === enriched[index - 1].totalAssetUnits ? enriched.slice(0, index).findIndex((item) => item.totalAssetUnits === standing.totalAssetUnits) + 1 : index + 1,
  }))
}
