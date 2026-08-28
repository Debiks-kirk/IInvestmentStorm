import { ASSET_CATEGORY_CONFIGS, calculateFixedAssets, categoryConfig } from './assets'
import { getCardDefinition } from './cards'
import { formatCoins, rankFinalPlayers } from './engine'
import { taskLabel } from './identities'
import type { GameSession, IdentityAction, Player, RoundTurn, SpectatorEvent } from './types'

export type SpectatorEventInput = Omit<SpectatorEvent, 'id' | 'sequence'>

export function appendSpectatorEvent(session: GameSession, input: SpectatorEventInput, queue = true): Pick<GameSession, 'spectatorEvents' | 'pendingSpectatorEvents'> {
  if (!session.spectatorMode) return { spectatorEvents: session.spectatorEvents, pendingSpectatorEvents: session.pendingSpectatorEvents }
  const sequence = session.spectatorEvents.reduce((highest, event) => Math.max(highest, event.sequence), -1) + 1
  const event: SpectatorEvent = { ...input, sequence, id: `spectator-${session.id}-${sequence}` }
  return {
    spectatorEvents: [...session.spectatorEvents, event],
    pendingSpectatorEvents: queue ? [...session.pendingSpectatorEvents, event] : session.pendingSpectatorEvents,
  }
}

export function appendSpectatorEvents(session: GameSession, inputs: SpectatorEventInput[]): Pick<GameSession, 'spectatorEvents' | 'pendingSpectatorEvents'> {
  return inputs.reduce<Pick<GameSession, 'spectatorEvents' | 'pendingSpectatorEvents'>>((state, input) => appendSpectatorEvent({ ...session, ...state }, input), { spectatorEvents: session.spectatorEvents, pendingSpectatorEvents: session.pendingSpectatorEvents })
}

function actionDetail(action: IdentityAction | undefined, players: Player[]): string | null {
  if (!action) return null
  const targetName = 'targetPlayerId' in action ? players.find((player) => player.id === action.targetPlayerId)?.name : undefined
  switch (action.type) {
    case 'prophetDivination': return '发动天机推演'
    case 'merchantAuction': return '安排下一轮道具竞购'
    case 'reverserInvert': return '发动排名逆转'
    case 'thiefSteal': return '发动偷窃'
    case 'kidnap': return `发起绑票 · 赎金 ${formatCoins(action.ransomUnits ?? 0)}`
    case 'nightwalkerDoubleBid': return `双影下注 B 档 ${formatCoins(action.shadowBidUnits)}`
    case 'invest': return `投资 ${targetName ?? '目标'} ${formatCoins(action.investmentUnits)}`
    case 'lobbyistContract': return `向 ${targetName ?? '目标'} 发布${action.taskType ? taskLabel(action.taskType) : '随机任务'}`
  }
}

export function createTurnSpectatorEvent(session: GameSession, turn: RoundTurn): SpectatorEventInput {
  const player = session.players.find((entry) => entry.id === turn.playerId)
  const details = [
    `下注 ${formatCoins(turn.bidUnits)} 金币`,
    turn.predictedPlayerId ? `预测 ${session.players.find((entry) => entry.id === turn.predictedPlayerId)?.name ?? '未知玩家'} 第一` : '未预测',
  ]
  const skill = actionDetail(turn.identityAction, session.players)
  if (skill) details.push(skill)
  for (const use of turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])) {
    const target = use.targetPlayerId ? session.players.find((entry) => entry.id === use.targetPlayerId)?.name : null
    details.push(`使用 ${getCardDefinition(use.cardId).name}${target ? ` → ${target}` : ''}`)
  }
  const cardQuotes = (turn.auctionBids ?? []).filter((bid) => session.roundAuctions.some((lot) => lot.id === bid.lotId) && bid.bidUnits > 0)
  const itemQuotes = (turn.auctionBids ?? []).filter((bid) => session.roundAssetAuctions.some((lot) => lot.id === bid.lotId) && bid.bidUnits > 0)
  if (cardQuotes.length) details.push(`道具竞购 ${cardQuotes.length} 项 · 合计报价 ${formatCoins(cardQuotes.reduce((sum, bid) => sum + bid.bidUnits, 0))}`)
  if (itemQuotes.length) details.push(`拍品竞购 ${itemQuotes.length} 项 · 合计报价 ${formatCoins(itemQuotes.reduce((sum, bid) => sum + bid.bidUnits, 0))}`)
  if (turn.assetAuctionOffers?.length) details.push(`挂牌 ${turn.assetAuctionOffers.length} 件拍品`)
  return { roundIndex: session.roundIndex, type: 'turn', playerId: turn.playerId, turn, summary: `${player?.name ?? 'Bot'} 已确认本轮操作`, details }
}

export function createRoundResultSpectatorEvent(session: GameSession): SpectatorEventInput | null {
  const result = session.results.at(-1)
  if (!result) return null
  const winner = result.itemWinnerId ? session.players.find((player) => player.id === result.itemWinnerId) : null
  return {
    roundIndex: result.roundIndex,
    type: 'roundResult',
    summary: `第 ${result.roundIndex + 1} 轮结算完成`,
    details: [
      `${result.item.emoji} ${result.item.name} · 总下注 ${formatCoins(result.totalBidUnits)}`,
      winner ? `${winner.name} 获得拍品` : '拍品无人获得',
      result.tiedPlayerIds.length ? `${result.tiedPlayerIds.length} 人因并列退出对应名次` : '本轮没有并列出局',
    ],
  }
}

export interface SpectatorPlayerStats {
  player: Player
  place: number
  cashUnits: number
  fixedAssetUnits: number
  totalAssetUnits: number
  itemCount: number
  cardCount: number
  mainCategory: string
  totalBidUnits: number
  averageBidUnits: number
  awardCount: number
  predictionCount: number
  predictionHits: number
  predictionNetUnits: number
  cardUses: number
  skillUses: number
  assetAuctionSpentUnits: number
  assetAuctionIncomeUnits: number
  assetAuctionDeals: number
  cardAuctionSpentUnits: number
  cardAuctionIncomeUnits: number
  cardAuctionDeals: number
  categories: Array<{ name: string; count: number; units: number; nextAt: number | null }>
}

export type SpectatorChartKey = 'assets' | 'cash' | 'bids' | 'net'

export function createSpectatorPlayerStats(session: GameSession): SpectatorPlayerStats[] {
  const standings = rankFinalPlayers(session.players)
  return standings.map((standing) => {
    const turns = [...session.results.flatMap((result) => result.turns), ...(session.results.some((result) => result.roundIndex === session.roundIndex) ? [] : session.turns)].filter((turn) => turn.playerId === standing.player.id)
    const predictions = session.results.flatMap((result) => result.predictionOutcomes).filter((entry) => entry.playerId === standing.player.id)
    const assetResults = session.results.flatMap((result) => result.assetAuctionResults)
    const fixedAssets = calculateFixedAssets(standing.player.items, standing.player.identity?.id === 'collector' ? standing.player.identity.collectorCategory : undefined)
    const realCounts = new Map(ASSET_CATEGORY_CONFIGS.map((entry) => [entry.category, standing.player.items.filter(({ item }) => item.category === entry.category).length]))
    const topCategory = [...realCounts.entries()].sort((left, right) => right[1] - left[1])[0]
    const spent = assetResults.filter((entry) => entry.winnerId === standing.player.id).reduce((sum, entry) => {
      const turn = session.results.find((result) => result.assetAuctionResults.includes(entry))?.turns.find((candidate) => candidate.playerId === standing.player.id)
      return sum + (turn?.auctionBids?.find((bid) => bid.lotId === entry.lotId)?.bidUnits ?? 0)
    }, 0)
    const income = assetResults.filter((entry) => entry.sellerId === standing.player.id && entry.winnerId).reduce((sum, entry) => {
      const result = session.results.find((candidate) => candidate.assetAuctionResults.includes(entry))
      const winnerTurn = result?.turns.find((candidate) => candidate.playerId === entry.winnerId)
      return sum + (winnerTurn?.auctionBids?.find((bid) => bid.lotId === entry.lotId)?.bidUnits ?? 0)
    }, 0)
    const totalBidUnits = turns.reduce((sum, turn) => sum + turn.bidUnits, 0)
    const cardDeals = session.spectatorEvents.filter((event) => event.type === 'auctionResult' && (event.bidUnits ?? 0) > 0)
    return {
      player: standing.player,
      place: standing.place,
      cashUnits: standing.cashUnits,
      fixedAssetUnits: standing.fixedAssetUnits,
      totalAssetUnits: standing.totalAssetUnits,
      itemCount: standing.player.items.length,
      cardCount: standing.player.cardInventory.length,
      mainCategory: topCategory && topCategory[1] > 0 ? categoryConfig(topCategory[0]).name : '暂无主类',
      totalBidUnits,
      averageBidUnits: turns.length ? Math.round(totalBidUnits / turns.length) : 0,
      awardCount: session.results.reduce((count, result) => count + (result.rankings.some((rank) => rank.playerId === standing.player.id) ? 1 : 0), 0),
      predictionCount: predictions.filter((entry) => entry.status !== 'skipped').length,
      predictionHits: predictions.filter((entry) => entry.status === 'correct').length,
      predictionNetUnits: predictions.reduce((sum, entry) => sum + entry.deltaUnits, 0),
      cardUses: turns.reduce((count, turn) => count + (turn.cardUses?.length ?? (turn.cardUse ? 1 : 0)), 0),
      skillUses: turns.filter((turn) => Boolean(turn.identityAction)).length,
      assetAuctionSpentUnits: spent,
      assetAuctionIncomeUnits: income,
      assetAuctionDeals: assetResults.filter((entry) => entry.winnerId && (entry.winnerId === standing.player.id || entry.sellerId === standing.player.id)).length,
      cardAuctionSpentUnits: cardDeals.filter((event) => event.playerId === standing.player.id).reduce((sum, event) => sum + (event.bidUnits ?? 0), 0),
      cardAuctionIncomeUnits: cardDeals.filter((event) => event.counterpartyPlayerId === standing.player.id).reduce((sum, event) => sum + (event.bidUnits ?? 0), 0),
      cardAuctionDeals: cardDeals.filter((event) => event.playerId === standing.player.id || event.counterpartyPlayerId === standing.player.id).length,
      categories: fixedAssets.map((entry) => ({ name: categoryConfig(entry.category).name, count: realCounts.get(entry.category) ?? 0, units: entry.units, nextAt: entry.itemCount < 5 ? Math.max(2, entry.itemCount + 1) : entry.itemCount + 1 })),
    }
  })
}

export function createSpectatorChart(session: GameSession, key: SpectatorChartKey): Array<{ round: number; values: Record<string, number> }> {
  const initialUnits = session.settings.initialCoins * 2
  const cumulativeBids = Object.fromEntries(session.players.map((player) => [player.id, 0])) as Record<string, number>
  const rows = [{ round: 0, values: Object.fromEntries(session.players.map((player) => [player.id, key === 'bids' || key === 'net' ? 0 : initialUnits])) }]
  for (const result of session.results) {
    result.turns.forEach((turn) => { cumulativeBids[turn.playerId] = (cumulativeBids[turn.playerId] ?? 0) + turn.bidUnits })
    const values = Object.fromEntries(session.players.map((player) => {
      if (key === 'assets') return [player.id, result.totalAssetUnitsAfter[player.id] ?? result.balancesAfter[player.id] ?? 0]
      if (key === 'cash') return [player.id, result.balancesAfter[player.id] ?? 0]
      if (key === 'bids') return [player.id, cumulativeBids[player.id] ?? 0]
      return [player.id, (result.totalAssetUnitsAfter[player.id] ?? result.balancesAfter[player.id] ?? 0) - initialUnits]
    }))
    rows.push({ round: result.roundIndex + 1, values })
  }
  return rows
}
