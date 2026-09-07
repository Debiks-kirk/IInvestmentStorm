import { drawCard, getCardDefinition, removeOneCard } from './cards'
import type { AssetCategory, CardId, IdentityEvent, Player, WonItem } from './types'

export const CONNOISSEUR_REWARDS = [5, 10, 15, 20] as const

/** The original acquisition round travels with a physical item through every sale. */
export function connoisseurItemKey(won: WonItem): string {
  return `${won.roundIndex}:${won.item.id}`
}

export function connoisseurCategoryReward(player: Pick<Player, 'identity'>, category: AssetCategory): number {
  const identity = player.identity
  if (identity?.id !== 'connoisseur') return 0
  const categories = identity.connoisseurCategories ?? []
  return categories.includes(category) ? 0 : (CONNOISSEUR_REWARDS[categories.length] ?? 0) * 2
}

/** Mutates only the settlement's cloned player, and returns a new physical deck. */
export function rewardConnoisseurItem(player: Player, won: WonItem, roundIndex: number, deck: CardId[], disabled: CardId[] = [], roll = Math.random): { cardDeck: CardId[]; event?: IdentityEvent } {
  const identity = player.identity
  const key = connoisseurItemKey(won)
  if (identity?.id !== 'connoisseur' || identity.connoisseurItemKeys?.includes(key) || identity.connoisseurCategories?.includes(won.item.category)) return { cardDeck: deck }
  const bonusUnits = connoisseurCategoryReward(player, won.item.category)
  const categories = identity.connoisseurCategories ?? []
  identity.connoisseurCategories = categories.includes(won.item.category) ? [...categories] : [...categories, won.item.category]
  identity.connoisseurItemKeys = [...(identity.connoisseurItemKeys ?? []), key]
  player.balanceUnits += bonusUnits
  const draw = drawCard(deck, disabled, roll)
  let cardDeck = draw.cardDeck
  const offeredCardIds: CardId[] = draw.cardId ? [draw.cardId] : []
  while (offeredCardIds.length < identity.connoisseurCategories.length) {
    const available = cardDeck.filter(id => !disabled.includes(id) && !offeredCardIds.includes(id))
    if (!available.length) break
    const cardId = available[Math.min(available.length - 1, Math.max(0, Math.floor(roll() * available.length)))]
    offeredCardIds.push(cardId)
    cardDeck = removeOneCard(cardDeck, cardId)
  }
  if (offeredCardIds.length === 1) player.cardInventory.push(offeredCardIds[0])
  if (offeredCardIds.length > 1) identity.connoisseurOffers = [...(identity.connoisseurOffers ?? []), { category: won.item.category, roundIndex, offeredCardIds }]
  return {
    cardDeck,
    event: { playerId: player.id, identityId: 'connoisseur', roundIndex, title: '鉴赏家收藏奖励', deltaUnits: bonusUnits,
      detail: `${won.item.name}：首次集得第 ${identity.connoisseurCategories.length} 类，获得 ${bonusUnits / 2} 金币；${offeredCardIds.length > 1 ? `获得道具 ${offeredCardIds.length} 选 1。` : draw.cardId ? `获得${getCardDefinition(draw.cardId).name}。` : '无可发放道具。'}` },
  }
}

/** Consume the oldest locked offer exactly once; return unselected physical cards. */
export function chooseConnoisseurCard(player: Player, cardId: CardId, deck: CardId[]): { player: Player; cardDeck: CardId[] } | null {
  const offer = player.identity?.connoisseurOffers?.[0]
  if (player.identity?.id !== 'connoisseur' || !offer?.offeredCardIds.includes(cardId)) return null
  return {
    player: { ...player, cardInventory: [...player.cardInventory, cardId], identity: { ...player.identity, connoisseurOffers: player.identity.connoisseurOffers!.slice(1) } },
    cardDeck: [...deck, ...removeOneCard(offer.offeredCardIds, cardId)],
  }
}
