import { getCardDefinition, removeOneCard } from './cards'
import { availableLotteryNumbers } from './lottery'
import type { CardId, CardUse, GameSession } from './types'

export function instantUses(session: GameSession, playerId: string): CardUse[] {
  return (session.instantCardUses ?? []).filter(entry => entry.playerId === playerId && entry.roundIndex === session.roundIndex).map(entry => entry.use)
}

export function upgradeChoices(session: GameSession, playerId: string, planned: CardUse[] = []): CardId[] {
  const player = session.players.find(entry => entry.id === playerId)
  if (!player?.cardInventory.includes('sleeveUpgrade')) return []
  let inventory = removeOneCard(player.cardInventory, 'sleeveUpgrade')
  for (const use of planned) inventory = removeOneCard(inventory, use.cardId)
  const tiers = ['common', 'rare', 'uncommon', 'legendary']
  return [...new Set(inventory)].filter(id => {
    const next = tiers[tiers.indexOf(getCardDefinition(id).rarity) + 1]
    return next && session.cardDeck.some(card => getCardDefinition(card).rarity === next)
  })
}

/** Confirmed random actions are returned as one atomic patch; never refill a depleted tier. */
export function useInstantCard(session: GameSession, playerId: string, cardId: 'luckyTickets' | 'sleeveUpgrade', target?: CardId, planned: CardUse[] = [], random = Math.random): Partial<GameSession> | null {
  const player = session.players[session.currentTurnIndex]
  if (session.phase !== 'privateTurn' || player?.id !== playerId || session.turns.some(turn => turn.playerId === playerId) || !player.cardInventory.includes(cardId) || (cardId === 'luckyTickets' && instantUses(session, playerId).some(use => use.cardId === cardId))) return null
  let inventory = removeOneCard(player.cardInventory, cardId)
  let cardDeck = session.cardDeck
  let lottery = session.lottery
  const use: CardUse = { cardId }
  const pick = (length: number) => Math.min(length - 1, Math.floor(Math.max(0, random()) * length))
  if (cardId === 'luckyTickets') {
    if (!lottery || lottery.lastDrawRound >= session.roundIndex) return null
    const available = availableLotteryNumbers(lottery, session.players.length)
    if (!available.length) return null
    const numbers: number[] = []
    while (available.length && numbers.length < 5) numbers.push(available.splice(pick(available.length), 1)[0])
    use.lotteryNumbers = numbers
    lottery = { ...lottery, poolUnits: lottery.poolUnits + numbers.length * 4, tickets: [...lottery.tickets, ...numbers.map(number => ({ playerId, roundIndex: session.roundIndex, number, paidUnits: 0, subsidyUnits: 4, source: 'gift' as const }))] }
  } else {
    if (!target || !upgradeChoices(session, playerId, planned).includes(target)) return null
    const tiers = ['common', 'rare', 'uncommon', 'legendary']
    const next = tiers[tiers.indexOf(getCardDefinition(target).rarity) + 1]
    const pool = cardDeck.filter(id => getCardDefinition(id).rarity === next)
    const received = pool[pick(pool.length)]
    cardDeck = removeOneCard(cardDeck, received)
    inventory = [...removeOneCard(inventory, target), received]
    use.upgradedFrom = target
    use.upgradedTo = received
  }
  return { players: session.players.map(entry => entry.id === playerId ? { ...entry, cardInventory: inventory } : entry), cardDeck, lottery, instantCardUses: [...(session.instantCardUses ?? []), { playerId, roundIndex: session.roundIndex, use }] }
}

/** Keep original tie groups intact: removing an exempt holder must not rescue their rival. */
export function resolveCharmTies(entries: { playerId: string; bidUnits: number }[], holders: Set<string>) {
  const groups = new Map<number, string[]>()
  for (const entry of entries) groups.set(entry.bidUnits, [...(groups.get(entry.bidUnits) ?? []), entry.playerId])
  const eliminated = new Set<string>()
  const consumed = new Set<string>()
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    const protectedIds = ids.filter(id => holders.has(id))
    protectedIds.forEach(id => consumed.add(id))
    ids.filter(id => protectedIds.length !== 1 || id !== protectedIds[0]).forEach(id => eliminated.add(id))
  }
  return { eliminated, consumed }
}
