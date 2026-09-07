import { calculateFixedAssets } from './assets'
import { achievementProgress } from './progression'
import { getCardDefinition } from './cards'
import { formatCoins, rankFinalPlayers } from './engine'
import type { AssetCategory, BotHistoryHint, CardId, GameMode, GameSession, IdentityId, MemberProfile, Player, RoundResult, RoundTurn } from './types'

export type CareerEventKind = 'attack' | 'trade' | 'cardAuction' | 'investment' | 'kidnap' | 'award'

/** Compact, factual event log. It is never reconstructed from display copy. */
export interface CareerEvent {
  kind: CareerEventKind
  roundIndex: number
  actorMemberId?: string
  targetMemberId?: string
  cardId?: CardId
  itemName?: string
  category?: AssetCategory
  coinsUnits?: number
  success?: boolean
  random?: boolean
}

export interface MemberMatchSummary {
  lotteryWins?: number
  lotteryPrizeUnits?: number
  upgradeUses?: number
  memberId: string
  sessionId: string
  seatPlayerId: string
  nameAtMatch: string
  mode: GameMode
  playerCount: number
  role: 'seat' | 'operator'
  roundsActed: number
  finalPlace: number
  champion: boolean
  cameFromBackHalf: boolean
  totalAssetUnits: number
  netUnits: number
  defeatRatio: number
  totalBidUnits: number
  investmentUnits: number
  rankingRewardUnits: number
  predictionNetUnits: number
  predictionHits: number
  predictionAttempts: number
  cardUses: number
  identityUses: number
  cardAuctionSpentUnits: number
  cardAuctionIncomeUnits: number
  cardAuctionDeals: number
  assetAuctionSpentUnits: number
  assetAuctionIncomeUnits: number
  assetAuctionDeals: number
  assetSales: number
  passivityPenaltyCount: number
  passivityPaidUnits: number
  zeroBalanceRounds: number
  identityId?: IdentityId
  favouriteCategory?: AssetCategory
  categoryCounts: Partial<Record<AssetCategory, number>>
  fixedAssetUnits: number
  itemsWon: number
}

export interface MatchCareerRecord {
  version: 1
  sessionId: string
  completedAt: string
  mode: GameMode
  playerCount: number
  /** All seats, including unregistered players; relay operators must not multiply the average. */
  finalSeats?: { playerId: string; place: number; totalAssetUnits: number }[]
  summaries: MemberMatchSummary[]
  events: CareerEvent[]
  /** A complete frozen replay is stored separately and may be removed without touching this record. */
  hasReplay: boolean
}

export interface CareerAchievement {
  id: string
  name: string
  detail: string
  modes: GameMode[]
}

export interface CareerRelationship {
  memberId: string
  sharedMatches: number
  wins: number
  losses: number
  attackAttempts: number
  attackSuccesses: number
  receivedAttacks: number
  tradeCount: number
  tradeCoinsUnits: number
  rivalry: number
}

export interface CareerDashboard {
  member: MemberProfile
  summaries: MemberMatchSummary[]
  standard: MemberMatchSummary[]
  relay: MemberMatchSummary[]
  achievements: CareerAchievement[]
  relationships: CareerRelationship[]
}

/**
 * Deliberately small roster-card aggregate.  The hall uses this instead of
 * constructing every member's relationship graph, so a large local archive
 * never turns the landing page into a full history scan per card.
 */
export function careerRosterStats(memberId: string, records: readonly MatchCareerRecord[]): { matches: number; champions: number } {
  let matches = 0
  let champions = 0
  for (const record of records) {
    for (const summary of record.summaries) {
      if (summary.memberId !== memberId) continue
      matches += 1
      if (summary.champion) champions += 1
    }
  }
  return { matches, champions }
}

function totalAssets(player: Player): number {
  return player.balanceUnits + calculateFixedAssets(player.items, player.identity?.id === 'collector' ? player.identity.collectorCategory : undefined).reduce((sum, entry) => sum + entry.units, 0)
}

function playerForId(session: GameSession, playerId: string): Player | undefined {
  return session.players.find((player) => player.id === playerId)
}

function memberForTurn(session: GameSession, turn: RoundTurn): string | undefined {
  return turn.operatorMemberId ?? playerForId(session, turn.playerId)?.memberId
}

function memberForAffectedPlayer(result: RoundResult, session: GameSession, playerId: string): string | undefined {
  const turn = result.turns.find((candidate) => candidate.playerId === playerId)
  return turn ? memberForTurn(session, turn) : playerForId(session, playerId)?.memberId
}

function summariesForSession(session: GameSession): Array<{ memberId: string; player: Player; turns: Array<{ result: RoundResult; turn: RoundTurn }>; role: 'seat' | 'operator' }> {
  const result: Array<{ memberId: string; player: Player; turns: Array<{ result: RoundResult; turn: RoundTurn }>; role: 'seat' | 'operator' }> = []
  if (session.mode === 'standard') {
    for (const player of session.players) {
      if (!player.memberId) continue
      result.push({ memberId: player.memberId, player, role: 'seat', turns: session.results.flatMap((round) => round.turns.filter((turn) => turn.playerId === player.id).map((turn) => ({ result: round, turn }))) })
    }
    return result
  }
  const grouped = new Map<string, { memberId: string; player: Player; turns: Array<{ result: RoundResult; turn: RoundTurn }>; role: 'operator' }>()
  for (const round of session.results) for (const turn of round.turns) {
    const memberId = memberForTurn(session, turn)
    const player = playerForId(session, turn.playerId)
    if (!memberId || !player) continue
    const existing = grouped.get(memberId) ?? { memberId, player, turns: [], role: 'operator' as const }
    existing.turns.push({ result: round, turn })
    grouped.set(memberId, existing)
  }
  return [...grouped.values()]
}

function countCategory(player: Player): Partial<Record<AssetCategory, number>> {
  const counts: Partial<Record<AssetCategory, number>> = {}
  for (const { item } of player.items) counts[item.category] = (counts[item.category] ?? 0) + 1
  return counts
}

function mainCategory(counts: Partial<Record<AssetCategory, number>>): AssetCategory | undefined {
  return (Object.entries(counts).sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))[0]?.[0] as AssetCategory | undefined)
}

function summaryForMember(session: GameSession, entry: ReturnType<typeof summariesForSession>[number]): MemberMatchSummary {
  const standings = rankFinalPlayers(session.players)
  const standing = standings.find((candidate) => candidate.player.id === entry.player.id)
  const initialUnits = session.settings.initialCoins * 2
  const finalAssets = standing?.totalAssetUnits ?? totalAssets(entry.player)
  const categoryCounts = countCategory(entry.player)
  const assetBreakdown = calculateFixedAssets(entry.player.items, entry.player.identity?.id === 'collector' ? entry.player.identity.collectorCategory : undefined)
  const turns = entry.turns
  const actedResults = session.results.filter(round => entry.turns.some(turn => turn.result.roundIndex === round.roundIndex))
  const investments = actedResults.flatMap((round) => round.investments.filter((investment) => investment.investorId === entry.player.id))
  const cardAuctionWins = actedResults.flatMap((round) => round.cardAuctionResults.map((lot) => ({ round, lot }))).filter(({ lot }) => lot.winnerId === entry.player.id)
  const assetAuctionWins = actedResults.flatMap((round) => round.assetAuctionResults.map((lot) => ({ round, lot }))).filter(({ lot }) => lot.winnerId === entry.player.id)
  const assetSales = actedResults.flatMap((round) => round.assetAuctionResults.map((lot) => ({ round, lot }))).filter(({ lot }) => lot.sellerId === entry.player.id && Boolean(lot.winnerId))
  const bidFor = (round: RoundResult, playerId: string, lotId: string) => round.turns.find((turn) => turn.playerId === playerId)?.auctionBids?.find((bid) => bid.lotId === lotId)?.bidUnits ?? 0
  const predictionRows = turns.map(({ result }) => result.predictionOutcomes.find((outcome) => outcome.playerId === entry.player.id)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const rankRows = turns.map(({ result }) => result.rankings.find((rank) => rank.playerId === entry.player.id)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const zeroBalanceRounds = actedResults.filter((round) => (round.balancesAfter[entry.player.id] ?? 1) <= 0).length
  const passivity = actedResults.flatMap((round) => round.passivityFeePenalties).filter((penalty) => penalty.playerId === entry.player.id)
  const finalPlace = standing?.place ?? session.players.length
  const lower = standings.filter((candidate) => candidate.totalAssetUnits < finalAssets).length
  const tied = Math.max(0, standings.filter((candidate) => candidate.totalAssetUnits === finalAssets).length - 1)
  const defeatRatio = session.players.length <= 1 ? 0 : (lower + tied * .5) / (session.players.length - 1)
  const changes = turns.map(({ result }) => result.totalAssetUnitsAfter[entry.player.id] ?? finalAssets)
  const cameFromBackHalf = turns.some(({ result: round }) => {
    const own = round.totalAssetUnitsAfter[entry.player.id]
    return own !== undefined && 1 + Object.values(round.totalAssetUnitsAfter).filter(value => value > own).length > Math.ceil(session.players.length / 2)
  })
  const operatorNet = entry.role === 'operator'
    ? changes.reduce((sum, after, index) => {
      const round = turns[index]?.result
      const prior = session.results.filter((item) => item.roundIndex < (round?.roundIndex ?? 0)).at(-1)?.totalAssetUnitsAfter[entry.player.id] ?? initialUnits
      return sum + after - prior
    }, 0)
    : finalAssets - initialUnits
  return {
    memberId: entry.memberId,
    lotteryWins: turns.filter(({ result }) => result.lottery?.winnerId === entry.player.id).length,
    lotteryPrizeUnits: turns.reduce((sum, { result }) => sum + (result.lottery?.winnerId === entry.player.id ? result.lottery.prizeUnits : 0), 0),
    upgradeUses: turns.reduce((sum, { turn }) => sum + (turn.cardUses ?? []).filter(use => use.cardId === 'sleeveUpgrade' && use.upgradedTo).length, 0),
    sessionId: session.id,
    seatPlayerId: entry.player.id,
    nameAtMatch: entry.player.name,
    mode: session.mode,
    playerCount: session.players.length,
    role: entry.role,
    roundsActed: turns.length,
    finalPlace,
    champion: finalPlace === 1,
    cameFromBackHalf,
    totalAssetUnits: finalAssets,
    netUnits: operatorNet,
    defeatRatio,
    totalBidUnits: turns.reduce((sum, { turn }) => sum + turn.bidUnits, 0),
    investmentUnits: investments.reduce((sum, investment) => sum + investment.investmentUnits, 0),
    rankingRewardUnits: rankRows.reduce((sum, rank) => sum + rank.rewardUnits, 0),
    predictionNetUnits: predictionRows.reduce((sum, outcome) => sum + outcome.deltaUnits, 0),
    predictionHits: predictionRows.filter((outcome) => outcome.status === 'correct').length,
    predictionAttempts: predictionRows.filter((outcome) => outcome.status !== 'skipped').length,
    cardUses: turns.reduce((sum, { turn }) => sum + (turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])).length, 0),
    identityUses: turns.filter(({ turn }) => Boolean(turn.identityAction)).length,
    cardAuctionSpentUnits: cardAuctionWins.reduce((sum, { round, lot }) => sum + bidFor(round, entry.player.id, lot.lotId), 0),
    cardAuctionIncomeUnits: actedResults.flatMap((round) => round.cardAuctionResults.map((lot) => ({ round, lot }))).filter(({ lot }) => lot.merchantId === entry.player.id && lot.winnerId).reduce((sum, { round, lot }) => sum + bidFor(round, lot.winnerId!, lot.lotId), 0),
    cardAuctionDeals: cardAuctionWins.length,
    assetAuctionSpentUnits: assetAuctionWins.reduce((sum, { round, lot }) => sum + bidFor(round, entry.player.id, lot.lotId), 0),
    assetAuctionIncomeUnits: assetSales.reduce((sum, { round, lot }) => sum + bidFor(round, lot.winnerId!, lot.lotId), 0),
    assetAuctionDeals: assetAuctionWins.length,
    assetSales: assetSales.length,
    passivityPenaltyCount: passivity.length,
    passivityPaidUnits: passivity.reduce((sum, penalty) => sum + penalty.paidFeeUnits, 0),
    zeroBalanceRounds,
    identityId: entry.player.identity?.id,
    favouriteCategory: mainCategory(categoryCounts),
    categoryCounts,
    fixedAssetUnits: assetBreakdown.reduce((sum, asset) => sum + asset.units, 0),
    itemsWon: actedResults.filter((round) => round.itemWinnerId === entry.player.id).length,
  }
}

function careerEvents(session: GameSession): CareerEvent[] {
  const events: CareerEvent[] = []
  for (const result of session.results) {
    for (const turn of result.turns) {
      const actorMemberId = memberForTurn(session, turn)
      for (const use of turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])) {
        if (!use.targetPlayerId || !actorMemberId) continue
        const targetMemberId = memberForAffectedPlayer(result, session, use.targetPlayerId)
        if (!targetMemberId || targetMemberId === actorMemberId) continue
        events.push({ kind: 'attack', roundIndex: result.roundIndex, actorMemberId, targetMemberId, cardId: use.cardId, success: !result.autoConsumedCardIds.includes('reflectShield'), random: false })
      }
      if (turn.identityAction?.type === 'kidnap' && actorMemberId) for (const targetPlayerId of turn.identityAction.targetPlayerIds ?? (turn.identityAction.targetPlayerId ? [turn.identityAction.targetPlayerId] : [])) {
        const targetMemberId = memberForAffectedPlayer(result, session, targetPlayerId)
        if (targetMemberId && targetMemberId !== actorMemberId) events.push({ kind: 'kidnap', roundIndex: result.roundIndex, actorMemberId, targetMemberId, coinsUnits: turn.identityAction.ransomUnits, success: result.kidnapAttempt?.capturedPlayerId === targetPlayerId })
      }
    }
    for (const lot of result.assetAuctionResults) {
      if (!lot.winnerId) continue
      const sellerMemberId = memberForAffectedPlayer(result, session, lot.sellerId)
      const buyerMemberId = memberForAffectedPlayer(result, session, lot.winnerId)
      if (sellerMemberId && buyerMemberId && sellerMemberId !== buyerMemberId) events.push({ kind: 'trade', roundIndex: result.roundIndex, actorMemberId: sellerMemberId, targetMemberId: buyerMemberId, itemName: lot.item.name, category: lot.item.category, coinsUnits: lot.winningBidUnits ?? 0, success: true })
    }
    for (const investment of result.investments) {
      const actorMemberId = memberForAffectedPlayer(result, session, investment.investorId)
      const targetMemberId = memberForAffectedPlayer(result, session, investment.targetPlayerId)
      if (actorMemberId && targetMemberId && actorMemberId !== targetMemberId) events.push({ kind: 'investment', roundIndex: result.roundIndex, actorMemberId, targetMemberId, coinsUnits: investment.investmentUnits, success: investment.rewardShareUnits > 0 })
    }
  }
  return events
}

export function createMatchCareerRecord(session: GameSession, completedAt = new Date().toISOString()): MatchCareerRecord | null {
  if (!session.careerEnabled || session.phase !== 'finalResult') return null
  const summaries = summariesForSession(session).map((entry) => summaryForMember(session, entry))
  if (!summaries.length) return null
  const finalSeats = rankFinalPlayers(session.players).map(s => ({ playerId: s.player.id, place: s.place, totalAssetUnits: s.totalAssetUnits }))
  return { version: 1, sessionId: session.id, completedAt, mode: session.mode, playerCount: session.players.length, finalSeats, summaries, events: careerEvents(session), hasReplay: true }
}

export function careerAchievements(summaries: readonly MemberMatchSummary[]): CareerAchievement[] {
  return achievementProgress(summaries).filter(entry => entry.unlocked)
}

export function careerRelationships(memberId: string, records: readonly MatchCareerRecord[]): CareerRelationship[] {
  const state = new Map<string, CareerRelationship>()
  const ordered = [...records].sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))
  for (const record of ordered) {
    const self = record.summaries.find((summary) => summary.memberId === memberId)
    if (!self) continue
    const opponents = record.summaries.filter((summary) => summary.memberId !== memberId)
    for (const opponent of opponents) {
      const current = state.get(opponent.memberId) ?? { memberId: opponent.memberId, sharedMatches: 0, wins: 0, losses: 0, attackAttempts: 0, attackSuccesses: 0, receivedAttacks: 0, tradeCount: 0, tradeCoinsUnits: 0, rivalry: 0 }
      current.rivalry *= Math.pow(2, -1 / 10)
      current.sharedMatches += 1
      if (self.finalPlace < opponent.finalPlace) current.wins += 1
      if (self.finalPlace > opponent.finalPlace) current.losses += 1
      for (const event of record.events) {
        if (event.actorMemberId === memberId && event.targetMemberId === opponent.memberId && (event.kind === 'attack' || event.kind === 'kidnap')) {
          current.attackAttempts += 1
          current.attackSuccesses += event.success ? 1 : 0
          current.rivalry += 1 + (event.success ? 2 : 0) + Math.min(2, (event.coinsUnits ?? 0) / 20)
        }
        if (event.actorMemberId === opponent.memberId && event.targetMemberId === memberId && (event.kind === 'attack' || event.kind === 'kidnap')) current.receivedAttacks += 1
        if (event.kind === 'trade' && ((event.actorMemberId === memberId && event.targetMemberId === opponent.memberId) || (event.actorMemberId === opponent.memberId && event.targetMemberId === memberId))) {
          current.tradeCount += 1
          current.tradeCoinsUnits += event.coinsUnits ?? 0
        }
      }
      state.set(opponent.memberId, current)
    }
  }
  return [...state.values()].map((entry) => ({ ...entry, rivalry: Math.min(100, Math.round(entry.rivalry * 5)) })).sort((left, right) => right.rivalry - left.rivalry || right.sharedMatches - left.sharedMatches)
}

export function createCareerDashboard(member: MemberProfile, records: readonly MatchCareerRecord[]): CareerDashboard {
  const completedAtBySession = new Map(records.map((record) => [record.sessionId, Date.parse(record.completedAt)]))
  const summaries = records.flatMap((record) => record.summaries.filter((summary) => summary.memberId === member.id)).sort((left, right) => (completedAtBySession.get(right.sessionId) ?? 0) - (completedAtBySession.get(left.sessionId) ?? 0))
  return { member, summaries, standard: summaries.filter((summary) => summary.mode === 'standard'), relay: summaries.filter((summary) => summary.mode === 'relay'), achievements: careerAchievements(summaries), relationships: careerRelationships(member.id, records) }
}

/** Exposes only long-term public tendencies from matches the Bot personally played. */
export function createBotHistoryHints(records: readonly MatchCareerRecord[], members: readonly MemberProfile[]): Record<string, BotHistoryHint> {
  const known = new Map(members.map((member) => [member.id, member]))
  const hints: Record<string, BotHistoryHint> = {}
  for (const bot of members.filter((member) => member.kind === 'bot' && member.bot?.memoryEnabled && !member.archived)) {
    const memoryRecords = bot.bot?.memoryResetAt
      ? records.filter((record) => Date.parse(record.completedAt) >= Date.parse(bot.bot?.memoryResetAt ?? ''))
      : records
    const opponents: BotHistoryHint['opponents'] = {}
    for (const relationship of careerRelationships(bot.id, memoryRecords)) {
      if (relationship.sharedMatches < 3 || !known.has(relationship.memberId)) continue
      const shared = memoryRecords.filter((record) => record.summaries.some((summary) => summary.memberId === bot.id) && record.summaries.some((summary) => summary.memberId === relationship.memberId))
      const targetSummaries = shared.flatMap((record) => record.summaries.filter((summary) => summary.memberId === relationship.memberId))
      const averageBidRatio = targetSummaries.reduce((sum, summary) => sum + summary.totalBidUnits / Math.max(1, summary.roundsActed * 60), 0) / Math.max(1, targetSummaries.length)
      const categories = targetSummaries.map((summary) => summary.favouriteCategory).filter((category): category is AssetCategory => Boolean(category))
      const favouriteCategory = categories.sort((left, right) => categories.filter((category) => category === right).length - categories.filter((category) => category === left).length)[0]
      opponents[relationship.memberId] = { sharedMatches: relationship.sharedMatches, rivalry: relationship.rivalry, averageBidRatio, ...(favouriteCategory ? { favouriteCategory } : {}) }
    }
    hints[bot.id] = { memberId: bot.id, opponents }
  }
  return hints
}

export function careerStatLabel(units: number): string { return formatCoins(units) }
export function cardName(cardId: CardId): string { return getCardDefinition(cardId).name }
