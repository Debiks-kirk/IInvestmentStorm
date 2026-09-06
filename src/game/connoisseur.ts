import { drawCard, getCardDefinition } from './cards'
import type { AssetCategory, CardId, IdentityEvent, Player, WonItem } from './types'

export const CONNOISSEUR_REWARDS = [5, 10, 20, 50] as const

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
  if (identity?.id !== 'connoisseur' || identity.connoisseurItemKeys?.includes(key)) return { cardDeck: deck }
  const bonusUnits = connoisseurCategoryReward(player, won.item.category)
  const categories = identity.connoisseurCategories ?? []
  identity.connoisseurCategories = categories.includes(won.item.category) ? [...categories] : [...categories, won.item.category]
  identity.connoisseurItemKeys = [...(identity.connoisseurItemKeys ?? []), key]
  player.balanceUnits += bonusUnits
  const draw = drawCard(deck, disabled, roll)
  if (draw.cardId) player.cardInventory.push(draw.cardId)
  return {
    cardDeck: draw.cardDeck,
    event: { playerId: player.id, identityId: 'connoisseur', roundIndex, title: '鉴赏家收藏奖励', deltaUnits: bonusUnits,
      detail: `${won.item.name}：${bonusUnits ? `首次集得第 ${identity.connoisseurCategories.length} 类，获得 ${bonusUnits / 2} 金币；` : ''}${draw.cardId ? `获得${getCardDefinition(draw.cardId).name}。` : '无可发放道具。'}` },
  }
}
