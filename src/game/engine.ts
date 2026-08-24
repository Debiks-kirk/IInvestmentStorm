import { calculateFixedAssets } from './assets'
import { removeOneCard } from './cards'
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
  NightwalkerOutcome,
  InvestmentRecord,
  PassivityFeePenalty,
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
  if (!Number.isInteger(settings.systemAuctionCardsPerRound) || settings.systemAuctionCardsPerRound < 0 || settings.systemAuctionCardsPerRound > 6) errors.push('每回合系统竞购卡应为 0–6 张')
  if (!Number.isInteger(settings.turnTimeLimitSeconds) || settings.turnTimeLimitSeconds < 5 || settings.turnTimeLimitSeconds > 120) errors.push('单次操作时限应为 5–120 秒')
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
  /** Frozen before anyone acts, so the low-balance exemption is seat-order safe. */
  roundStartBalanceUnits?: Record<string, number>
  roll?: () => number
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

function distributeProportionalUnits(totalUnits: number, contributions: Array<{ playerId: string; units: number }>, fairnessOrderIds: string[], roundIndex: number): Map<string, number> {
  const result = new Map<string, number>()
  const total = contributions.reduce((sum, entry) => sum + entry.units, 0)
  if (totalUnits <= 0 || total <= 0) return result
  const fairRank = new Map(rotate(fairnessOrderIds, roundIndex).map((id, index) => [id, index]))
  const rows = contributions.map((entry) => {
    const numerator = totalUnits * entry.units
    const base = Math.floor(numerator / total)
    return { ...entry, base, remainder: numerator % total }
  })
  rows.forEach((row) => result.set(row.playerId, row.base))
  const remaining = totalUnits - rows.reduce((sum, row) => sum + row.base, 0)
  rows.sort((left, right) => right.remainder - left.remainder || (fairRank.get(left.playerId) ?? 999) - (fairRank.get(right.playerId) ?? 999)).slice(0, remaining).forEach((row) => result.set(row.playerId, (result.get(row.playerId) ?? 0) + 1))
  return result
}

function cardCopiesLabel(cardName: string, count: number): string {
  if (count <= 1) return cardName
  const chineseCount = ['零', '一', '两', '三', '四', '五'][count]
  return `${chineseCount ?? count}张${cardName}`
}

function identityEffect(symbol: string, description: string): CardEffect {
  return { symbol, description }
}

function cardUses(turn: RoundTurn): CardUse[] {
  return turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])
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
  const { playersAfterBids, turns: submittedTurns, item, roundIndex, rewardMultipliers, correctPredictionMultiplier, wrongPredictionMultiplier, fairnessOrderIds } = input
  let turns = submittedTurns
  const identitySettings = input.identitySettings ?? defaultIdentitySettings(false)
  const identityContracts = (input.identityContracts ?? []).map((contract) => ({ ...contract }))
  const players = playersAfterBids.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
  const investments = submittedTurns.flatMap((turn) => turn.identityAction?.type === 'invest' && turn.identityAction.investmentUnits > 0
    ? [{ investorId: turn.playerId, targetPlayerId: turn.identityAction.targetPlayerId, investmentUnits: turn.identityAction.investmentUnits }]
    : [])
  const investmentUnitsByTarget = new Map<string, number>()
  for (const investment of investments) investmentUnitsByTarget.set(investment.targetPlayerId, (investmentUnitsByTarget.get(investment.targetPlayerId) ?? 0) + investment.investmentUnits)
  const investmentRecords: InvestmentRecord[] = investments.map((investment) => ({ ...investment, targetOwnBidUnits: 0, finalBidUnits: 0, rewardShareUnits: 0, receivedItem: false }))
  const playerById = new Map(players.map((player) => [player.id, player]))
  const deltaByPlayer = new Map<string, PlayerRoundDelta>(players.map((player) => [player.id, {
    playerId: player.id,
    rewardUnits: 0,
    predictionUnits: 0,
    publicPredictionUnits: 0,
    cardUnits: 0,
    identityUnits: 0,
    publicDeltaUnits: 0,
  }]))
  const cardEffects: CardEffect[] = []
  const identityEvents: IdentityEvent[] = []
  const roll = input.roll ?? Math.random
  const usedCards = turns.flatMap((turn) => cardUses(turn).map((use) => ({ playerId: turn.playerId, use })))
  // 偷看底牌会在私密操作页立刻给出信息，无法被回合结算时才生效的护盾追溯。
  // 反弹护盾是被动消耗品：持有者第一次受到指定型结算道具影响时自动反弹并消耗。
  const availableShieldPlayerIds = new Set(players.filter((player) => player.cardInventory.includes('reflectShield')).map((player) => player.id))
  const autoConsumedCardIds: CardId[] = []
  const targetedCardUses = usedCards
    .filter(({ use }) => (use.cardId === 'swap' || use.cardId === 'bananaPeel') && Boolean(use.targetPlayerId))
    .map(({ playerId, use }) => {
      const targetPlayerId = use.targetPlayerId as string
      const reflected = targetPlayerId !== playerId && availableShieldPlayerIds.has(targetPlayerId)
      if (reflected) {
        availableShieldPlayerIds.delete(targetPlayerId)
        const protectedPlayer = playerById.get(targetPlayerId)
        if (protectedPlayer) protectedPlayer.cardInventory = removeOneCard(protectedPlayer.cardInventory, 'reflectShield')
        autoConsumedCardIds.push('reflectShield')
      }
      return { playerId, use, targetPlayerId: reflected ? playerId : targetPlayerId, reflected }
    })
  for (const targetedUse of targetedCardUses.filter(({ reflected }) => reflected)) {
    const cardName = targetedUse.use.cardId === 'bananaPeel' ? '香蕉皮' : '偷天换日'
    cardEffects.push(cardEffect('reflectShield', `反弹护盾生效：${cardName}的指定效果已反弹给使用者。`))
  }

  // Nightwalkers commit only the lower visible bid. Once every secret choice exists,
  // each one is evaluated in seat order against the already resolved prior shadows.
  // This makes multiple Nightwalkers deterministic while preserving secrecy.
  const nightwalkerOutcomes: NightwalkerOutcome[] = []
  const effectiveValueForNightwalker = floorToHalfUnits(item.value * COIN_UNIT * valueFactor(usedCards.map(({ use }) => use)))
  const reversalCountForNightwalker = usedCards.filter(({ use }) => use.cardId === 'reverseRank').length
    + (turns.some((turn) => turn.identityAction?.type === 'reverserInvert' && playerById.get(turn.playerId)?.identity?.id === 'reverser') ? 1 : 0)
  const rankNightwalkerBid = (playerId: string, bidUnits: number, baseBids: Map<string, number>) => {
    const rankingBids = new Map(baseBids)
    rankingBids.set(playerId, bidUnits)
    const voided = new Set<string>()
    for (const { playerId: actorId, use, targetPlayerId, reflected } of targetedCardUses) {
      if (use.cardId !== 'swap' || reflected || targetPlayerId === actorId) continue
      const targetBid = rankingBids.get(targetPlayerId)
      const ownBid = rankingBids.get(actorId)
      if (targetBid === undefined || ownBid === undefined) continue
      rankingBids.set(actorId, targetBid)
      rankingBids.set(targetPlayerId, ownBid)
    }
    for (const { use, targetPlayerId } of targetedCardUses) {
      if (use.cardId !== 'bananaPeel') continue
      rankingBids.set(targetPlayerId, 0)
      voided.add(targetPlayerId)
    }
    for (const { playerId: actorId, use } of usedCards) {
      if (use.cardId === 'doubleBid') rankingBids.set(actorId, (rankingBids.get(actorId) ?? 0) * 2)
    }
    const ranked = turns.filter((turn) => !voided.has(turn.playerId)).map((turn) => ({ playerId: turn.playerId, bidUnits: rankingBids.get(turn.playerId) ?? 0 }))
    const counts = new Map<number, number>()
    ranked.forEach((turn) => counts.set(turn.bidUnits, (counts.get(turn.bidUnits) ?? 0) + 1))
    const winners = ranked.filter((turn) => counts.get(turn.bidUnits) === 1).sort((left, right) => right.bidUnits - left.bidUnits).slice(0, rewardMultipliers.length)
    const finalWinners = reversalCountForNightwalker % 2 === 1 ? [...winners].reverse() : winners
    const placeIndex = finalWinners.findIndex((turn) => turn.playerId === playerId)
    const rewardUnits = placeIndex < 0 ? 0 : floorToHalfUnits(effectiveValueForNightwalker * (rewardMultipliers[placeIndex] ?? 0))
    return {
      place: placeIndex < 0 ? null : placeIndex + 1,
      rewardUnits,
      netUnits: rewardUnits - bidUnits,
      winsItem: placeIndex === 0,
    }
  }
  const settledBidUnits = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits]))
  const initialRankingBids = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits + (investmentUnitsByTarget.get(turn.playerId) ?? 0)]))
  for (const turn of turns) {
    if (turn.identityAction?.type !== 'nightwalkerDoubleBid' || playerById.get(turn.playerId)?.identity?.id !== 'nightwalker') continue
    const shadowBidUnits = turn.identityAction.shadowBidUnits
    const baseBidUnits = turn.bidUnits
    const base = rankNightwalkerBid(turn.playerId, baseBidUnits + (investmentUnitsByTarget.get(turn.playerId) ?? 0), initialRankingBids)
    const shadow = rankNightwalkerBid(turn.playerId, shadowBidUnits + (investmentUnitsByTarget.get(turn.playerId) ?? 0), initialRankingBids)
    // The item choice is deliberately made before kidnap resolution: Nightwalker
    // can see the final bids, but cannot foresee whether a kidnapper will steal it.
    const prioritizeItem = turn.identityAction.prioritizeItem !== false
    const itemDecision = prioritizeItem && base.winsItem !== shadow.winsItem
    const useShadow = itemDecision ? shadow.winsItem : shadow.netUnits > base.netUnits
    const reason: NightwalkerOutcome['reason'] = itemDecision
      ? (shadow.winsItem ? 'shadowWinsItem' : 'baseWinsItem')
      : (useShadow ? 'shadowHigherNet' : 'baseHigherOrEqualNet')
    const chosenBidUnits = useShadow ? shadowBidUnits : baseBidUnits
    const chosen = useShadow ? shadow : base
    const other = useShadow ? base : shadow
    const bidDifferenceUnits = Math.abs(shadowBidUnits - baseBidUnits)
    const bidComparison = useShadow
      ? `比明面 A 多投入 ${formatCoins(bidDifferenceUnits)} 金币`
      : `比影价 B 少投入 ${formatCoins(bidDifferenceUnits)} 金币`
    const netDifferenceUnits = chosen.netUnits - other.netUnits
    const netComparison = netDifferenceUnits > 0
      ? `排名净收益高 ${formatCoins(netDifferenceUnits)} 金币`
      : netDifferenceUnits < 0
        ? `排名净收益低 ${formatCoins(-netDifferenceUnits)} 金币`
        : '排名净收益相同'
    settledBidUnits.set(turn.playerId, chosenBidUnits)
    const player = playerById.get(turn.playerId)
    if (player && chosenBidUnits > baseBidUnits) player.balanceUnits = Math.max(0, player.balanceUnits - (chosenBidUnits - baseBidUnits))
    nightwalkerOutcomes.push({
      playerId: turn.playerId,
      baseBidUnits,
      shadowBidUnits,
      chosenBidUnits,
      basePlace: base.place,
      shadowPlace: shadow.place,
      baseRewardUnits: base.rewardUnits,
      shadowRewardUnits: shadow.rewardUnits,
      baseNetUnits: base.netUnits,
      shadowNetUnits: shadow.netUnits,
      baseWinsItem: base.winsItem,
      shadowWinsItem: shadow.winsItem,
      prioritizeItem,
      reason,
    })
    identityEvents.push({
      playerId: turn.playerId,
      identityId: 'nightwalker',
      roundIndex,
      title: '双影下注结算',
      detail: reason === 'shadowWinsItem'
        ? `明面 ${formatCoins(baseBidUnits)}、夜行影价 ${formatCoins(shadowBidUnits)}；已开启优先拿藏品，只有影价能获得拍品，系统采用了影价。采用后${bidComparison}，${netComparison}。`
        : reason === 'baseWinsItem'
          ? `明面 ${formatCoins(baseBidUnits)}、夜行影价 ${formatCoins(shadowBidUnits)}；已开启优先拿藏品，只有明面能获得拍品，系统保留明面下注。采用后${bidComparison}，${netComparison}。`
          : useShadow
            ? `明面 ${formatCoins(baseBidUnits)}、夜行影价 ${formatCoins(shadowBidUnits)}；影价的排名净收益更高，系统采用了影价。采用后${bidComparison}，${netComparison}。`
            : `明面 ${formatCoins(baseBidUnits)}、夜行影价 ${formatCoins(shadowBidUnits)}；明面净收益相同或更高，系统保留明面下注。采用后${bidComparison}，${netComparison}。`,
      deltaUnits: 0,
    })
  }
  if (nightwalkerOutcomes.length > 0) cardEffects.push(identityEffect('☾', '有人发动了双影下注，系统已在两档暗标中采用更划算的一档。'))
  turns = turns.map((turn) => settledBidUnits.get(turn.playerId) === turn.bidUnits ? turn : { ...turn, bidUnits: settledBidUnits.get(turn.playerId) ?? turn.bidUnits })

  let redistributionTransferUnits: number | null = null
  const redistributionUse = usedCards.find(({ use }) => use.cardId === 'redistribute')
  if (redistributionUse) {
    const highestBalance = Math.max(...players.map((player) => player.balanceUnits))
    const lowestBalance = Math.min(...players.map((player) => player.balanceUnits))
    const turnOrder = new Map(turns.map((turn, index) => [turn.playerId, index]))
    const richest = players.filter((player) => player.balanceUnits === highestBalance).sort((left, right) => (turnOrder.get(right.id) ?? 0) - (turnOrder.get(left.id) ?? 0)).slice(0, 1)
    const poorest = players.filter((player) => player.balanceUnits === lowestBalance)
    const poolUnits = highestBalance === lowestBalance ? 0 : richest.reduce((total, player) => total + floorToHalfUnits(player.balanceUnits * .33), 0)
    redistributionTransferUnits = poolUnits
    for (const player of richest) {
      const payment = highestBalance === lowestBalance ? 0 : floorToHalfUnits(player.balanceUnits * .33)
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
    if (poolUnits > 0) {
      for (const rich of richest) identityEvents.push({ playerId: rich.id, identityId: 'thief', roundIndex, title: '劫富济贫转出', detail: `本轮转出了 ${formatCoins(floorToHalfUnits(highestBalance * .33))} 金币。`, deltaUnits: -floorToHalfUnits(highestBalance * .33) })
      for (const [playerId, amount] of allocations) identityEvents.push({ playerId, identityId: 'thief', roundIndex, title: '劫富济贫收款', detail: `本轮获得了 ${formatCoins(amount)} 金币。`, deltaUnits: amount })
    }
  }

  for (const { playerId, use } of usedCards) {
    if (use.cardId !== 'fateCoin') continue
    const delta = deltaByPlayer.get(playerId)
    if (!delta) continue
    const immediateDelta = use.fateDeltaUnits
    if (use.coinResult === 'heads') {
      // 命运硬币已在私密操作阶段即时结算；这里仅写入公开结算说明。
      if (immediateDelta === undefined) {
        const player = playerById.get(playerId)
        const gained = coinsToUnits(10)
        if (player) player.balanceUnits += gained
        delta.cardUnits += gained
      }
      cardEffects.push(cardEffect('fateCoin', `命运硬币：正面朝上，获得 ${formatCoins(immediateDelta ?? coinsToUnits(10))} 金币。`))
    } else {
      cardEffects.push(cardEffect('fateCoin', '命运硬币：反面朝上，本次没有变化。'))
    }
  }

  const rankingBids = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits + (investmentUnitsByTarget.get(turn.playerId) ?? 0)]))
  const voidedBidPlayerIds = new Set<string>()
  for (const { playerId, use, targetPlayerId, reflected } of targetedCardUses) {
    if (use.cardId !== 'swap' || reflected || targetPlayerId === playerId) continue
    const targetBid = rankingBids.get(targetPlayerId)
    const ownBid = rankingBids.get(playerId)
    if (targetBid === undefined || ownBid === undefined) continue
    rankingBids.set(playerId, targetBid)
    rankingBids.set(targetPlayerId, ownBid)
    cardEffects.push(cardEffect('swap', '两笔投资的排名金额已互换。'))
  }
  // 香蕉皮在换日之后生效，确保被指定的玩家最终完全退出本轮排名。
  for (const { use, targetPlayerId } of targetedCardUses) {
    if (use.cardId !== 'bananaPeel') continue
    const target = playerById.get(targetPlayerId)
    const targetTurn = turns.find((turn) => turn.playerId === targetPlayerId)
    const targetDelta = deltaByPlayer.get(targetPlayerId)
    if (!target || !targetTurn || !targetDelta) continue
    const refundUnits = floorToHalfUnits(targetTurn.bidUnits / 2)
    target.balanceUnits += refundUnits
    targetDelta.cardUnits += refundUnits
    rankingBids.set(targetPlayerId, 0)
    voidedBidPlayerIds.add(targetPlayerId)
    cardEffects.push(cardEffect('bananaPeel', `${target.name} 下注时被香蕉皮滑倒了：下注失败，丢失了一半的下注费用。`))
  }
  for (const { playerId, use } of usedCards) {
    if (use.cardId !== 'doubleBid') continue
    const actualBid = turns.find((turn) => turn.playerId === playerId)?.bidUnits ?? 0
    rankingBids.set(playerId, (rankingBids.get(playerId) ?? actualBid) * 2)
    cardEffects.push(cardEffect('doubleBid', '有一笔投资以双倍金额参与排名。'))
  }

  const factor = valueFactor(usedCards.map(({ use }) => use))
  const effectiveValueUnits = floorToHalfUnits(item.value * COIN_UNIT * factor)
  const redCount = usedCards.filter(({ use }) => use.cardId === 'red').length
  const blackCount = usedCards.filter(({ use }) => use.cardId === 'black').length
  if (redCount > 0) cardEffects.push(cardEffect('red', `${cardCopiesLabel('红卡', redCount)}生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  if (blackCount > 0) cardEffects.push(cardEffect('black', `${cardCopiesLabel('黑卡', blackCount)}生效：拍品真实价值为 ${formatCoins(effectiveValueUnits)}。`))
  for (const { use } of usedCards) {
    if (use.cardId === 'peek') cardEffects.push(cardEffect('peek', '有人偷看了一笔已提交的投资。'))
    if (use.cardId === 'prizeReroll') cardEffects.push(cardEffect('prizeReroll', '有人改写了下一轮拍品。'))
  }

  const rankingTurns = turns
    .filter((turn) => !voidedBidPlayerIds.has(turn.playerId))
    .map((turn) => ({ ...turn, rankingBidUnits: rankingBids.get(turn.playerId) ?? turn.bidUnits }))
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
    const freeActivation = reverser?.identity?.reverserFreeRoundIndex === roundIndex
    const due = freeActivation ? 0 : coinsToUnits(identitySettings.reverserActivationCoins * multiplier)
    const paid = Math.min(reverser?.balanceUnits ?? 0, due)
    if (reverser && reverserDelta) {
      reverser.balanceUnits -= paid
      reverserDelta.identityUnits -= paid
      reverser.identity = { ...reverser.identity!, reverserFreeRoundIndex: null }
      identityEvents.push({ playerId: reverser.id, identityId: 'reverser', roundIndex, title: '发动逆转排名', detail: freeActivation ? '使用上一轮赢得的免费发动，获奖区名次已倒转。' : `支付 ${formatCoins(paid)} 金币，获奖区名次已倒转。`, deltaUnits: -paid })
    }
  }
  if (rankingReversalCount > 0) cardEffects.push(cardEffect('reverseRank', rankingReversalDescription(rankingReversalCount)))
  const winningTurns = sortedUniqueTurns.slice(0, rewardMultipliers.length)
  const rankedTurns = rankingReversalCount % 2 === 1 ? [...winningTurns].reverse() : winningTurns
  const rankings: RankingEntry[] = rankedTurns.map((turn, index) => ({ playerId: turn.playerId, place: index + 1, bidUnits: turn.rankingBidUnits, actualBidUnits: turn.bidUnits, rewardUnits: floorToHalfUnits(effectiveValueUnits * rewardMultipliers[index]), publicRewardUnits: floorToHalfUnits(effectiveValueUnits * rewardMultipliers[index]) }))
  const winnerId = rankedTurns[0]?.playerId ?? null
  if (reverserTurn && winnerId === reverserTurn.playerId) {
    const reverser = playerById.get(reverserTurn.playerId)
    if (reverser?.identity) {
      reverser.identity = { ...reverser.identity, reverserFreeRoundIndex: roundIndex + 1 }
      identityEvents.push({ playerId: reverser.id, identityId: 'reverser', roundIndex, title: '逆转者连胜奖励', detail: '本轮发动逆转后拿下第一名：已赢得下回合的免费逆转资格与道具奖励。', deltaUnits: 0 })
    }
  }
  let itemWinnerId = winnerId
  // 传奇夺宝令只动最终藏品：排名奖励、预测和赢家付款仍使用正常第一名。
  // 它在绑匪之前落定，因此绑匪不能覆盖这次夺宝。
  const legendaryLoot = usedCards.find(({ use }) => use.cardId === 'legendaryLoot')
  if (legendaryLoot) {
    itemWinnerId = legendaryLoot.playerId
    cardEffects.push(cardEffect('legendaryLoot', `一张传奇夺宝令夺走了本回合的最终藏品：${item.emoji}${item.name}。`))
  }

  const kidnapTurn = turns.find((turn) => turn.identityAction?.type === 'kidnap' && playerById.get(turn.playerId)?.identity?.id === 'assassin')
  if (kidnapTurn?.identityAction?.type === 'kidnap') {
    const kidnapper = playerById.get(kidnapTurn.playerId)
    const kidnapDelta = deltaByPlayer.get(kidnapTurn.playerId)
    const freeActivation = kidnapper?.identity?.kidnapFreeRoundIndex === roundIndex
    const paid = freeActivation ? 0 : Math.min(kidnapper?.balanceUnits ?? 0, coinsToUnits(identitySettings.kidnapActivationCoins))
    if (kidnapper && kidnapDelta) {
      kidnapper.balanceUnits -= paid
      kidnapDelta.identityUnits -= paid
      kidnapper.identity = { ...kidnapper.identity!, kidnapFreeRoundIndex: null }
      if (!legendaryLoot && itemWinnerId === kidnapTurn.identityAction.targetPlayerId) {
        itemWinnerId = kidnapper.id
        kidnapper.identity = { ...kidnapper.identity!, pendingKidnapReward: true, kidnapFreeRoundIndex: roundIndex + 1 }
        cardEffects.push(identityEffect('⛓', '有人抢劫了本回合的藏品。'))
        identityEvents.push({ playerId: kidnapper.id, identityId: 'assassin', roundIndex, title: '绑匪抢劫成功', detail: `抢走了 ${item.emoji}${item.name}。已赢得下回合的免费发动资格与道具奖励。`, deltaUnits: paid === 0 ? 0 : -paid })
      } else {
        identityEvents.push({ playerId: kidnapper.id, identityId: 'assassin', roundIndex, title: '绑匪抢劫失败', detail: freeActivation ? '使用了上一回合赢得的免费发动，但目标没有拿下本轮拍品。' : `上回合花费了 ${formatCoins(paid)} 金币，但目标没有拿下本轮拍品。`, deltaUnits: paid === 0 ? 0 : -paid })
      }
    }
  }

  for (const ranking of rankings) {
    const player = playerById.get(ranking.playerId)
    const delta = deltaByPlayer.get(ranking.playerId)
    if (!player || !delta) continue
    const targetInvestments = investments.filter((investment) => investment.targetPlayerId === ranking.playerId)
    const totalContribution = ranking.actualBidUnits + targetInvestments.reduce((total, investment) => total + investment.investmentUnits, 0)
    const contributions = [{ playerId: ranking.playerId, units: ranking.actualBidUnits }, ...targetInvestments.map((investment) => ({ playerId: investment.investorId, units: investment.investmentUnits }))]
    const shares = totalContribution > 0
      ? distributeProportionalUnits(ranking.rewardUnits, contributions, fairnessOrderIds, roundIndex)
      : new Map<string, number>([[ranking.playerId, ranking.rewardUnits]])
    const targetShare = shares.get(ranking.playerId) ?? 0
    player.balanceUnits += targetShare
    delta.rewardUnits += ranking.publicRewardUnits
    for (const investment of targetInvestments) {
      const investor = playerById.get(investment.investorId)
      const share = shares.get(investment.investorId) ?? 0
      if (investor) investor.balanceUnits += share
      const record = investmentRecords.find((entry) => entry.investorId === investment.investorId && entry.targetPlayerId === investment.targetPlayerId && entry.investmentUnits === investment.investmentUnits && entry.rewardShareUnits === 0)
      if (record) { record.targetOwnBidUnits = ranking.actualBidUnits; record.finalBidUnits = ranking.bidUnits; record.rewardShareUnits = share }
      identityEvents.push({ playerId: investment.investorId, identityId: 'investor', roundIndex, title: '价值投资结算', detail: `目标获得第 ${ranking.place} 名奖励；你按出资比例分得 ${formatCoins(share)} 金币。`, deltaUnits: share })
    }
    if (targetInvestments.length > 0) identityEvents.push({ playerId: player.id, identityId: 'investor', roundIndex, title: '获得投资回执', detail: `本轮获得 ${formatCoins(ranking.rewardUnits)} 金币排名奖励，其中你实际保留 ${formatCoins(targetShare)} 金币。`, deltaUnits: 0 })
  }
  for (const investment of investments) {
    if (rankings.some((ranking) => ranking.playerId === investment.targetPlayerId)) continue
    identityEvents.push({ playerId: investment.investorId, identityId: 'investor', roundIndex, title: '价值投资结算', detail: '目标未进入获奖区，本次投资未获得排名奖励。', deltaUnits: 0 })
    identityEvents.push({ playerId: investment.targetPlayerId, identityId: 'investor', roundIndex, title: '获得投资回执', detail: '本轮有秘密投资计入你的排名下注，但未进入获奖区。', deltaUnits: 0 })
  }
  if (itemWinnerId === winnerId) {
    const winnerTurn = turns.find((turn) => turn.playerId === winnerId)
    const winnerInvestments = investments.filter((investment) => investment.targetPlayerId === winnerId)
    const ownBid = winnerTurn?.bidUnits ?? 0
    const highestInvestment = Math.max(0, ...winnerInvestments.map((investment) => investment.investmentUnits))
    const topInvestors = winnerInvestments.filter((investment) => investment.investmentUnits === highestInvestment)
    if (highestInvestment > ownBid && topInvestors.length === 1) {
      itemWinnerId = topInvestors[0].investorId
      const record = investmentRecords.find((entry) => entry.investorId === itemWinnerId && entry.targetPlayerId === winnerId && entry.investmentUnits === highestInvestment)
      if (record) record.receivedItem = true
    }
  }
  if (itemWinnerId) playerById.get(itemWinnerId)?.items.push({ item, roundIndex })
  if (winnerId && investments.some((investment) => investment.targetPlayerId === winnerId)) {
    identityEvents.push({ playerId: winnerId, identityId: 'investor', roundIndex, title: '获得投资回执', detail: itemWinnerId === winnerId ? `你获得了本轮拍品 ${item.emoji}${item.name}。` : `你拿下第一名，但拍品 ${item.emoji}${item.name} 因投资贡献归属他人。`, deltaUnits: 0 })
    if (itemWinnerId && itemWinnerId !== winnerId) identityEvents.push({ playerId: itemWinnerId, identityId: 'investor', roundIndex, title: '价值投资拍品', detail: `你的单笔投资贡献最高，获得了 ${item.emoji}${item.name}。`, deltaUnits: 0 })
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
        identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '赌徒预测结算', detail: `结算页显示“没有预测 ±0”；实际作为赌徒支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
      }
      predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: null, status: 'skipped', deltaUnits: 0 })
    } else if (winnerId !== null && turn.predictedPlayerId === winnerId) {
      correctTurns.push(turn)
    } else {
      const gambler = player.identity?.id === 'gambler'
      const availableBeforePrediction = player.balanceUnits
      const due = floorToHalfUnits(effectiveValueUnits * (gambler ? identitySettings.gamblerWrongPenaltyMultiplier : wrongPredictionMultiplier))
      const paid = Math.min(availableBeforePrediction, due)
      player.balanceUnits -= paid
      if (gambler) {
        const publicDue = floorToHalfUnits(effectiveValueUnits * wrongPredictionMultiplier)
        const publicPaid = Math.min(availableBeforePrediction, publicDue)
        delta.predictionUnits -= paid
        delta.publicPredictionUnits -= publicPaid
        identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '赌徒预测结算', detail: `结算页按普通玩家显示“猜错 −${formatCoins(publicPaid)}”；实际作为赌徒只支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
        predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'wrong', deltaUnits: -publicPaid })
      } else {
        delta.predictionUnits -= paid
        delta.publicPredictionUnits -= paid
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
      winnerDelta.publicPredictionUnits -= winnerPaymentUnits
      for (const turn of correctTurns) {
        const payment = payments.get(turn.playerId) ?? 0
        const player = playerById.get(turn.playerId)
        const delta = deltaByPlayer.get(turn.playerId)
        if (player && delta) {
          player.balanceUnits += payment
          delta.predictionUnits += payment
          delta.publicPredictionUnits += payment
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
    const publicPayment = predictionOutcomes.find((outcome) => outcome.playerId === player.id && outcome.status === 'correct')?.deltaUnits ?? 0
    identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '赌徒预测结算', detail: `结算页按普通玩家显示“猜中 +${formatCoins(publicPayment)}”；实际共获得 ${formatCoins(publicPayment + bonus)} 金币，其中赌徒额外奖励 ${formatCoins(bonus)} 金币。`, deltaUnits: bonus })
  }

  const executable = identityContracts.filter((contract) => contract.status === 'pending' && contract.executeRoundIndex === roundIndex)
  const turnById = new Map(turns.map((turn) => [turn.playerId, turn]))
  const rankingIds = new Set(rankings.map((ranking) => ranking.playerId))
  const failedContracts: LobbyistContract[] = []
  for (const contract of executable) {
    const own = turnById.get(contract.targetPlayerId)
    const comparison = contract.comparisonPlayerId ? turnById.get(contract.comparisonPlayerId) : undefined
    const targetRanking = rankings.find((ranking) => ranking.playerId === contract.targetPlayerId)
    const success = contract.taskType === 'outbid' ? Boolean(own && comparison && own.bidUnits > comparison.bidUnits)
      : contract.taskType === 'underbid' ? Boolean(own && comparison && own.bidUnits < comparison.bidUnits)
        : contract.taskType === 'avoidPrize' ? !rankingIds.has(contract.targetPlayerId)
          : contract.taskType === 'winSecond' ? targetRanking?.place === 2
            : contract.taskType === 'bidZero' ? own?.bidUnits === 0
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

  // 在所有常规结算后发放，避免这笔私密奖励改变预测付款等既有结算顺序。
  const itemWinner = itemWinnerId ? playerById.get(itemWinnerId) : undefined
  if (itemWinner?.identity?.id === 'collector' && itemWinner.identity.collectorCategory === item.category) {
    const bonus = coinsToUnits(5)
    itemWinner.balanceUnits += bonus
    const delta = deltaByPlayer.get(itemWinner.id)
    if (delta) delta.identityUnits += bonus
    identityEvents.push({
      playerId: itemWinner.id,
      identityId: 'collector',
      roundIndex,
      title: '收藏家奖励',
      detail: `拿下 ${item.emoji}${item.name}，符合你的收藏类别，额外获得 ${formatCoins(bonus)} 金币。`,
      deltaUnits: bonus,
    })
  }

  // Thief resolves only after every player has committed. Cards already arranged
  // for use were removed from inventory at submission, so they can never be stolen.
  const thiefTurn = turns.find((turn) => turn.identityAction?.type === 'thiefSteal' && playerById.get(turn.playerId)?.identity?.id === 'thief')
  if (thiefTurn) {
    const thief = playerById.get(thiefTurn.playerId)
    const delta = thief ? deltaByPlayer.get(thief.id) : undefined
    const due = coinsToUnits(identitySettings.thiefActivationCoins)
    const paid = Math.min(thief?.balanceUnits ?? 0, due)
    if (thief && delta) {
      // Use the table state before paying the activation cost. Otherwise the
      // thief's own fee can manufacture a fake "everyone is tied" result.
      const balancesBeforeTheft = players.map((player) => player.balanceUnits)
      thief.balanceUnits -= paid
      delta.identityUnits -= paid
      const candidates = players.flatMap((owner) => owner.id === thief.id ? [] : owner.cardInventory.map((cardId, cardIndex) => ({ owner, cardId, cardIndex })))
      const cardStealLimit = identitySettings.thiefMaxSteals ?? 2
      const canStealCard = (thief.identity?.thiefSuccesses ?? 0) < cardStealLimit
      const choice = canStealCard && candidates.length > 0 && roll() < identitySettings.thiefSuccessProbability / 100
        ? candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))]
        : undefined
      if (choice) {
        choice.owner.cardInventory.splice(choice.cardIndex, 1)
        thief.cardInventory.push(choice.cardId)
        thief.identity = thief.identity ? { ...thief.identity, thiefSuccesses: (thief.identity.thiefSuccesses ?? 0) + 1 } : thief.identity
        identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡成功', detail: `花费 ${formatCoins(paid)} 金币，获得了一张未使用道具卡。`, deltaUnits: -paid })
        identityEvents.push({ playerId: choice.owner.id, identityId: 'thief', roundIndex, title: '道具被偷走', detail: '你的一张未使用道具卡被人偷走了。', deltaUnits: 0 })
      } else {
        const fallbackReason = !canStealCard
          ? `已偷满 ${cardStealLimit} 张道具卡，改为寻找金币或拍品。`
          : '没有可偷到的道具卡，改为寻找金币或拍品。'
        const balanceBeforeTheftByPlayerId = new Map(players.map((player, index) => [player.id, balancesBeforeTheft[index]]))
        const allBalancesEqual = new Set(balancesBeforeTheft).size <= 1
        const otherPlayers = players.filter((player) => player.id !== thief.id)
        const richestBalance = Math.max(...balancesBeforeTheft)
        const richest = otherPlayers.filter((player) => balanceBeforeTheftByPlayerId.get(player.id) === richestBalance)
        if (allBalancesEqual || richest.length === 0) {
          const reason = allBalancesEqual ? '但全员余额相同。' : '但你当前就是唯一最富者，没有可偷取的对象。'
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡失败', detail: `花费 ${formatCoins(paid)} 金币。${fallbackReason}${reason}`, deltaUnits: -paid })
        } else if (richest.some((player) => player.items.length > 0) && roll() < .05) {
          const itemOwners = richest.filter((player) => player.items.length > 0)
          const itemOwner = itemOwners[Math.min(itemOwners.length - 1, Math.floor(roll() * itemOwners.length))]
          const itemIndex = Math.min(itemOwner.items.length - 1, Math.floor(roll() * itemOwner.items.length))
          const [stolenItem] = itemOwner.items.splice(itemIndex, 1)
          if (stolenItem) thief.items.push(stolenItem)
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡落空，偷走藏品', detail: `花费 ${formatCoins(paid)} 金币。${fallbackReason}转而偷走了一件拍品。`, deltaUnits: -paid })
          identityEvents.push({ playerId: itemOwner.id, identityId: 'thief', roundIndex, title: '拍品被偷走', detail: '你的一件拍品被人偷走了。', deltaUnits: 0 })
        } else {
          // Tied leaders share one 10% loss; do not charge 10% to every one of
          // them. Half-coin remainders rotate through the established fair order.
          const transfer = floorToHalfUnits(richestBalance * .1)
          const shares = distributeUnits({ totalUnits: transfer, playerIds: richest.map((player) => player.id), fairnessOrderIds, roundIndex })
          for (const richPlayer of richest) {
            const share = shares.get(richPlayer.id) ?? 0
            richPlayer.balanceUnits -= share
            const richestDelta = deltaByPlayer.get(richPlayer.id)
            if (richestDelta) richestDelta.identityUnits -= share
            identityEvents.push({ playerId: richPlayer.id, identityId: 'thief', roundIndex, title: '金币被偷走', detail: richest.length > 1 ? `你作为并列最富者，公摊转移了 ${formatCoins(share)} 金币。` : `你被转移了 ${formatCoins(share)} 金币。`, deltaUnits: -share })
          }
          thief.balanceUnits += transfer
          delta.identityUnits += transfer
          const crowdLabel = richest.length > 1 ? `由 ${richest.length} 位并列最富者公摊` : '从最富者转移'
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡落空，转移金币', detail: `花费 ${formatCoins(paid)} 金币。${fallbackReason}${crowdLabel}了 ${formatCoins(transfer)} 金币。`, deltaUnits: -paid + transfer })
        }
      }
    }
  }

  const passivityFeePenalties: PassivityFeePenalty[] = []
  // The exemption uses a frozen round-start snapshot, never a live balance.
  // Keep direct engine callers without a snapshot backward-compatible.
  if (input.roundStartBalanceUnits) {
    const minimumStartBalance = Math.min(...players.map((player) => input.roundStartBalanceUnits?.[player.id] ?? player.balanceUnits))
    const rewardedPlayerIds = new Set(rankings.map((ranking) => ranking.playerId))
    const commitmentByPlayerId = new Map(turns.map((turn) => [
      turn.playerId,
      turn.bidUnits + (turn.identityAction?.type === 'invest' ? turn.identityAction.investmentUnits : 0),
    ]))
    const minimumCommitment = Math.min(...players.map((player) => commitmentByPlayerId.get(player.id) ?? 0))
    for (const player of players) {
      const commitment = commitmentByPlayerId.get(player.id) ?? 0
      const startedAtMinimum = (input.roundStartBalanceUnits[player.id] ?? player.balanceUnits) === minimumStartBalance
      if (commitment !== minimumCommitment || rewardedPlayerIds.has(player.id) || startedAtMinimum) continue

      const occurrence = (player.passivityFeeCount ?? 0) + 1
      const feeUnits = coinsToUnits(occurrence === 1 ? 1 : occurrence === 2 ? 3 : 5)
      const paidFeeUnits = Math.min(player.balanceUnits, feeUnits)
      player.balanceUnits -= paidFeeUnits
      player.passivityFeeCount = occurrence
      const delta = deltaByPlayer.get(player.id)
      if (delta) delta.identityUnits -= paidFeeUnits

      let removedCardIds: CardId[] = []
      if (occurrence === 3 && player.cardInventory.length > 0) {
        const fairnessIndex = Math.max(0, fairnessOrderIds.indexOf(player.id))
        const cardIndex = (roundIndex + fairnessIndex) % player.cardInventory.length
        removedCardIds = player.cardInventory.splice(cardIndex, 1)
      } else if (occurrence >= 4 && player.cardInventory.length > 0) {
        removedCardIds = [...player.cardInventory]
        player.cardInventory = []
      }
      passivityFeePenalties.push({ playerId: player.id, occurrence, investmentUnits: commitment, feeUnits, paidFeeUnits, removedCardIds })
    }
    if (passivityFeePenalties.length > 0) cardEffects.push(identityEffect('◌', `本轮有 ${passivityFeePenalties.length} 人受到了观望惩罚。`))
  }
  const highestBalance = Math.max(...players.map((player) => player.balanceUnits))
  if (investments.length > 0) cardEffects.push(identityEffect('◈', '有人获得了秘密投资，排名奖励已按实际出资比例分配。'))
  const balanceLeaderIds = players.filter((player) => player.balanceUnits === highestBalance).map((player) => player.id)
  const deltas = players.map((player) => {
    const delta = deltaByPlayer.get(player.id) as PlayerRoundDelta
    return { ...delta, publicDeltaUnits: delta.rewardUnits + delta.publicPredictionUnits }
  })
  const result: RoundResult = {
    roundIndex,
    item,
    effectiveValueUnits,
    turns: turns.map((turn) => ({ ...turn, cardUses: cardUses(turn).map((use) => ({ ...use })), cardUse: turn.cardUse ? { ...turn.cardUse } : undefined })),
    rankings,
    tiedPlayerIds,
    winnerId,
    itemWinnerId,
    totalBidUnits: turns.reduce((total, turn) => total + turn.bidUnits, 0) + investments.reduce((total, investment) => total + investment.investmentUnits, 0),
    minWinningBidUnits: rankings.length > 0 ? Math.min(...rankings.map((ranking) => ranking.bidUnits)) : null,
    predictionOutcomes,
    winnerPaymentUnits,
    cardEffects,
    autoConsumedCardIds,
    rankingReversalCount,
    redistributionTransferUnits,
    balanceLeaderIds,
    deltas,
    balancesAfter: Object.fromEntries(players.map((player) => [player.id, player.balanceUnits])),
    identityEvents,
    nightwalkerOutcomes,
    investments: investmentRecords,
    assetAuctionResults: [],
    passivityFeePlayerCount: passivityFeePenalties.length,
    passivityFeePenalties,
    totalAssetUnitsAfter: Object.fromEntries(rankFinalPlayers(players).map((standing) => [standing.player.id, standing.totalAssetUnits])),
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
