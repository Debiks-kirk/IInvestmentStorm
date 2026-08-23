import { CARD_DEFINITIONS } from './cards'
import type { CardId, GameSession, IdentityId, ProphetDivination, ProphetDivinationMode } from './types'

function intervalContaining(valueUnits: number, roll: () => number): [number, number] {
  const widthUnits = 4 // Two coins wide, expressed in half-coin units.
  const leftOffset = Math.min(widthUnits, Math.max(0, Math.floor(roll() * (widthUnits + 1))))
  return [Math.max(0, valueUnits - leftOffset), Math.max(0, valueUnits - leftOffset) + widthUnits]
}

export function createWealthDivination({ id, playerId, roundIndex, costUnits, balanceSnapshot, roll = Math.random }: {
  id: string
  playerId: string
  roundIndex: number
  costUnits: number
  balanceSnapshot: Record<string, number>
  roll?: () => number
}): ProphetDivination {
  const balances = Object.values(balanceSnapshot)
  const highest = balances.length ? Math.max(...balances) : 0
  const lowest = balances.length ? Math.min(...balances) : 0
  return {
    id,
    playerId,
    roundIndex,
    mode: 'wealth',
    costUnits,
    wealth: { highestRangeUnits: intervalContaining(highest, roll), lowestRangeUnits: intervalContaining(lowest, roll) },
  }
}

export function createStarsDivination({ id, playerId, roundIndex, costUnits, prophecyDeck }: {
  id: string
  playerId: string
  roundIndex: number
  costUnits: number
  prophecyDeck: GameSession['prophecyDeck']
}): ProphetDivination | null {
  const items = prophecyDeck.slice(roundIndex + 1, roundIndex + 3)
  if (items.length === 0) return null
  return { id, playerId, roundIndex, mode: 'stars', costUnits, starItemIds: items.map((item) => item.id) }
}

export function canMakeIdentityGuess(divinations: ProphetDivination[], playerId: string, targetPlayerId: string, identityId: IdentityId): boolean {
  const guesses = divinations
    .filter((entry) => entry.playerId === playerId && entry.mode === 'identity')
    .flatMap((entry) => entry.identityGuesses ?? (entry.identityGuess ? [entry.identityGuess] : []))
  if (guesses.some((guess) => guess.targetPlayerId === targetPlayerId && guess.correct)) return false
  return !guesses.some((guess) => guess.targetPlayerId === targetPlayerId && guess.identityId === identityId)
}

export function drawProphetRewardCard({ cardDeck, disabledCardIds, heldCardIds, reservedCardId, roll = Math.random }: {
  cardDeck: CardId[]
  disabledCardIds: CardId[]
  heldCardIds: CardId[]
  reservedCardId?: CardId | null
  roll?: () => number
}): { cardId: CardId | null; cardDeck: CardId[]; replenished: boolean } {
  const candidates = cardDeck.filter((cardId) => cardId !== reservedCardId && !heldCardIds.includes(cardId))
  if (candidates.length > 0) {
    const cardId = candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))]
    return { cardId, cardDeck: cardDeck.filter((entry, index) => entry !== cardId || index !== cardDeck.indexOf(cardId)), replenished: false }
  }
  const fallback = CARD_DEFINITIONS.map((card) => card.id).filter((cardId) => !disabledCardIds.includes(cardId))
  if (fallback.length === 0) return { cardId: null, cardDeck: [...cardDeck], replenished: false }
  const cardId = fallback[Math.min(fallback.length - 1, Math.floor(roll() * fallback.length))]
  return { cardId, cardDeck: [...cardDeck], replenished: true }
}

export function prophetModeLabel(mode: ProphetDivinationMode): string {
  return mode === 'wealth' ? '观财' : mode === 'stars' ? '观星' : '观身份'
}
