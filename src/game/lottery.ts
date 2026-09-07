import type { GameSession, LotteryState, LotteryDraw, Player, RoundResult } from './types'
import { rankFinalPlayers, formatCoins } from './engine'

export const LOTTERY_PRICE_UNITS = 4
export const LOTTERY_PAYMENT_UNITS = 3
export const LOTTERY_PURCHASE_LIMIT = 2

export function createLottery(playerCount: number, roundIndex = 0): LotteryState {
  return { poolUnits: playerCount, openingPoolUnits: playerCount, baseUnits: playerCount, poolStartRound: roundIndex, tickets: [], lastDrawRound: roundIndex - 1 }
}

export function availableLotteryNumbers(lottery: LotteryState, playerCount: number): number[] {
  const taken = new Set(lottery.tickets.map(ticket => ticket.number))
  return Array.from({ length: playerCount * 2 }, (_, index) => index + 1).filter(number => !taken.has(number))
}

/** One atomic purchase; caller persists the returned patch before any subsequent action. */
export function buyLotteryTicket(session: GameSession, playerId: string, number: number | null, reservedUnits = 0, random = Math.random, operatorMemberId?: string): { players: Player[]; lottery: LotteryState } | null {
  const state = session.lottery
  const player = session.players[session.currentTurnIndex]
  if (!state || session.phase !== 'privateTurn' || player?.id !== playerId || session.turns.some(turn => turn.playerId === playerId) || state.lastDrawRound >= session.roundIndex) return null
  if (state.tickets.filter(ticket => ticket.playerId === playerId && ticket.roundIndex === session.roundIndex && ticket.source !== 'gift').length >= LOTTERY_PURCHASE_LIMIT) return null
  const available = availableLotteryNumbers(state, session.players.length)
  if (!available.length || (number !== null && !available.includes(number))) return null
  const paidUnits = Math.min(LOTTERY_PAYMENT_UNITS, player.balanceUnits)
  if (!Number.isInteger(reservedUnits) || reservedUnits < 0 || reservedUnits > player.balanceUnits - paidUnits) return null
  const selected = number ?? available[Math.min(available.length - 1, Math.floor(Math.max(0, random()) * available.length))]
  return {
    players: session.players.map(entry => entry.id === playerId ? { ...entry, balanceUnits: entry.balanceUnits - paidUnits } : entry),
    lottery: { ...state, poolUnits: state.poolUnits + LOTTERY_PRICE_UNITS, tickets: [...state.tickets, { playerId, operatorMemberId, roundIndex: session.roundIndex, number: selected, paidUnits, subsidyUnits: LOTTERY_PRICE_UNITS - paidUnits }] },
  }
}

/** Called only after every other settlement (including ransom). Idempotent on saved results. */
export function settleLottery(state: LotteryState | undefined, players: Player[], result: RoundResult, totalRounds: number, random = Math.random): { lottery: LotteryState | undefined; players: Player[]; result: RoundResult } {
  if (!state || result.lottery || state.lastDrawRound >= result.roundIndex || result.kidnapAttempt?.status === 'pending') return { lottery: state, players, result }
  const finalRound = result.roundIndex >= totalRounds - 1
  const candidates = finalRound ? state.tickets.map(ticket => ticket.number) : Array.from({ length: players.length * 2 }, (_, index) => index + 1)
  const number = candidates.length ? candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length))] : null
  const winnerId = state.tickets.find(ticket => ticket.number === number)?.playerId ?? null
  const prizeUnits = winnerId ? state.poolUnits : 0
  const newTicketCount = state.tickets.filter(ticket => ticket.roundIndex === result.roundIndex).length
  const draw: LotteryDraw = { roundIndex: result.roundIndex, poolUnits: state.poolUnits, baseUnits: state.baseUnits, carriedUnits: Math.max(0, state.openingPoolUnits - state.baseUnits), newTicketCount, tickets: state.tickets.map(ticket => ({ ...ticket })), number, winnerId, prizeUnits, finalRound }
  const updatedPlayers = players.map(player => player.id === winnerId ? { ...player, balanceUnits: player.balanceUnits + prizeUnits } : player)
  return {
    lottery: { ...state, lastDrawRound: result.roundIndex, ...(winnerId ? { poolUnits: 0, tickets: [] } : {}) },
    players: updatedPlayers,
    result: { ...result, lottery: draw, balanceLeaderIds: updatedPlayers.filter(player => player.balanceUnits === Math.max(...updatedPlayers.map(entry => entry.balanceUnits))).map(player => player.id), balancesAfter: Object.fromEntries(updatedPlayers.map(player => [player.id, player.balanceUnits])), totalAssetUnitsAfter: Object.fromEntries(rankFinalPlayers(updatedPlayers).map(standing => [standing.player.id, standing.totalAssetUnits])) },
  }
}

export function nextLotteryRound(state: LotteryState | undefined, playerCount: number, roundIndex: number): LotteryState | undefined {
  if (!state) return undefined
  if (state.poolUnits === 0 && state.tickets.length === 0) return createLottery(playerCount, roundIndex)
  return { ...state, openingPoolUnits: state.poolUnits }
}

export function lotterySummary(draw: LotteryDraw, players: Player[]): string {
  const pool = `彩票：奖池 ${formatCoins(draw.poolUnits)} 金币`
  if (!draw.tickets.length) return `${pool}，无人参与，${draw.finalRound ? '剩余奖池未领取' : '奖池继续滚存'}。`
  const number = String(draw.number).padStart(2, '0')
  const carried = draw.newTicketCount === 0 ? `，沿用 ${draw.tickets.length} 个有效号码` : ''
  return draw.winnerId ? `${pool}${carried}，开出 ${number} 号，${players.find(player => player.id === draw.winnerId)?.name ?? '中奖者'} 获得 ${formatCoins(draw.prizeUnits)} 金币。` : `${pool}${carried}，开出 ${number} 号，无人中奖，奖池与 ${draw.tickets.length} 个有效号码滚存至下一轮。`
}

/** Public opening pool + own cash/style only; no opponent ticket ownership or balances. */
export function botWantsLottery(seed: string, roundIndex: number, player: Player, openingPoolUnits: number, playerCount: number, finalRound: boolean): boolean {
  if (player.balanceUnits === 0) return true
  const hash = [...`${seed}:lottery:${player.id}:${roundIndex}`].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const risk = player.botMemory?.strategy.risk ?? 50
  const chance = Math.min(.9, .12 + risk / 250 + (player.balanceUnits < 8 ? .2 : 0) + (finalRound ? .2 : 0) + Math.min(.2, openingPoolUnits / (playerCount * 40)))
  return (hash % 10000) / 10000 < chance
}
