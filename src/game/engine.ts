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
  for (const turn of turns) {
    if (turn.identityAction?.type !== 'nightwalkerDoubleBid' || playerById.get(turn.playerId)?.identity?.id !== 'nightwalker') continue
    const shadowBidUnits = turn.identityAction.shadowBidUnits
    const baseBidUnits = turn.bidUnits
    const base = rankNightwalkerBid(turn.playerId, baseBidUnits, settledBidUnits)
    const shadow = rankNightwalkerBid(turn.playerId, shadowBidUnits, settledBidUnits)
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

  const rankingBids = new Map(turns.map((turn) => [turn.playerId, turn.bidUnits]))
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
    const paid = Math.min(kidnapper?.balanceUnits ?? 0, coinsToUnits(identitySettings.kidnapActivationCoins))
    if (kidnapper && kidnapDelta) {
      kidnapper.balanceUnits -= paid
      kidnapDelta.identityUnits -= paid
      if (!legendaryLoot && itemWinnerId === kidnapTurn.identityAction.targetPlayerId) {
        kidnapper.balanceUnits += paid
        kidnapDelta.identityUnits += paid
        itemWinnerId = kidnapper.id
        cardEffects.push(identityEffect('⛓', '有人抢劫了本回合的藏品。'))
        identityEvents.push({ playerId: kidnapper.id, identityId: 'assassin', roundIndex, title: '绑匪抢劫成功', detail: `抢走了 ${item.emoji}${item.name}，并报销上回合花费的 ${formatCoins(paid)} 金币。`, deltaUnits: 0 })
      } else {
        identityEvents.push({ playerId: kidnapper.id, identityId: 'assassin', roundIndex, title: '绑匪抢劫失败', detail: `上回合花费了 ${formatCoins(paid)} 金币，但目标没有拿下本轮拍品。`, deltaUnits: -paid })
      }
    }
  }

  for (const ranking of rankings) {
    const player = playerById.get(ranking.playerId)
    const delta = deltaByPlayer.get(ranking.playerId)
    if (!player || !delta) continue
    player.balanceUnits += ranking.rewardUnits
    delta.rewardUnits += ranking.publicRewardUnits
  }
  if (itemWinnerId) playerById.get(itemWinnerId)?.items.push({ item, roundIndex })

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
        delta.identityUnits -= paid
        delta.predictionUnits -= publicPaid
        identityEvents.push({ playerId: player.id, identityId: 'gambler', roundIndex, title: '赌徒预测结算', detail: `结算页按普通玩家显示“猜错 −${formatCoins(publicPaid)}”；实际作为赌徒只支付 ${formatCoins(paid)} 金币。`, deltaUnits: -paid })
        predictionOutcomes.push({ playerId: turn.playerId, predictedPlayerId: turn.predictedPlayerId, status: 'wrong', deltaUnits: -publicPaid })
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
      thief.balanceUnits -= paid
      delta.identityUnits -= paid
      const candidates = players.flatMap((owner) => owner.id === thief.id ? [] : owner.cardInventory.map((cardId, cardIndex) => ({ owner, cardId, cardIndex })))
      const choice = candidates.length > 0 && roll() < identitySettings.thiefSuccessProbability / 100
        ? candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))]
        : undefined
      if (choice) {
        choice.owner.cardInventory.splice(choice.cardIndex, 1)
        thief.cardInventory.push(choice.cardId)
        thief.identity = thief.identity ? { ...thief.identity, thiefSuccesses: (thief.identity.thiefSuccesses ?? 0) + 1 } : thief.identity
        identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡成功', detail: `花费 ${formatCoins(paid)} 金币，获得了一张未使用道具卡。`, deltaUnits: -paid })
        identityEvents.push({ playerId: choice.owner.id, identityId: 'thief', roundIndex, title: '道具被偷走', detail: '你的一张未使用道具卡被人偷走了。', deltaUnits: 0 })
      } else {
        const balances = players.map((player) => player.balanceUnits)
        const richestBalance = Math.max(...balances)
        const poorestBalance = Math.min(...balances)
        const turnOrder = new Map(turns.map((turn, index) => [turn.playerId, index]))
        const richest = richestBalance === poorestBalance ? undefined : players
          .filter((player) => player.id !== thief.id && player.balanceUnits === richestBalance)
          .sort((left, right) => (turnOrder.get(right.id) ?? -1) - (turnOrder.get(left.id) ?? -1))[0]
        if (!richest) {
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡失败', detail: `花费 ${formatCoins(paid)} 金币，但无人持有可偷道具，且全员余额相同。`, deltaUnits: -paid })
        } else if (richest.items.length > 0 && roll() < .05) {
          const itemIndex = Math.min(richest.items.length - 1, Math.floor(roll() * richest.items.length))
          const [stolenItem] = richest.items.splice(itemIndex, 1)
          if (stolenItem) thief.items.push(stolenItem)
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡落空，偷走藏品', detail: `花费 ${formatCoins(paid)} 金币后没有偷到道具，转而偷走了一件拍品。`, deltaUnits: -paid })
          identityEvents.push({ playerId: richest.id, identityId: 'thief', roundIndex, title: '拍品被偷走', detail: '你的一件拍品被人偷走了。', deltaUnits: 0 })
        } else {
          const transfer = floorToHalfUnits(richest.balanceUnits * .1)
          richest.balanceUnits -= transfer
          thief.balanceUnits += transfer
          if (delta) delta.identityUnits += transfer
          const richestDelta = deltaByPlayer.get(richest.id)
          if (richestDelta) richestDelta.identityUnits -= transfer
          identityEvents.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '偷卡落空，转移金币', detail: `花费 ${formatCoins(paid)} 金币后没有偷到道具，获得了 ${formatCoins(transfer)} 金币。`, deltaUnits: -paid + transfer })
          identityEvents.push({ playerId: richest.id, identityId: 'thief', roundIndex, title: '金币被偷走', detail: `你被转移了 ${formatCoins(transfer)} 金币。`, deltaUnits: -transfer })
        }
      }
    }
  }

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
    itemWinnerId,
    totalBidUnits: turns.reduce((total, turn) => total + turn.bidUnits, 0),
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
