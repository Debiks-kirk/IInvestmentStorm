import { shuffle } from './items'
import type { CardId } from './types'

export type CardRarity = 'common' | 'rare' | 'uncommon' | 'legendary'

export interface CardDefinition {
  id: CardId
  name: string
  symbol: string
  description: string
  needsTarget: boolean
  rarity: CardRarity
}

export const CARD_RARITY_LABELS: Record<CardRarity, string> = {
  common: '普通',
  rare: '稀有',
  uncommon: '罕见',
  legendary: '传奇',
}

/**
 * 目标合法性的唯一来源。`previous` 仅用于偷看已经提交的底牌；其余指定型卡可指向
 * 本轮任何其他玩家，因此第一位操作者也能正常使用。
 */
export type CardTargetScope = 'none' | 'previous' | 'other'

export function cardTargetScope(cardId: CardId): CardTargetScope {
  if (cardId === 'peek') return 'previous'
  if (cardId === 'swap' || cardId === 'bananaPeel') return 'other'
  return 'none'
}

export const CARD_DEFINITIONS: CardDefinition[] = [
  { id: 'red', name: '红卡', symbol: '◆', description: '本轮拍品真实价值翻倍，奖励预览不变。', needsTarget: false, rarity: 'common' },
  { id: 'peek', name: '偷看底牌', symbol: '◉', description: '查看一名已投资玩家的实际投资额。', needsTarget: true, rarity: 'common' },
  { id: 'swap', name: '偷天换日', symbol: '↔', description: '与任意一名其他玩家交换本轮排名用投资额。', needsTarget: true, rarity: 'rare' },
  { id: 'redistribute', name: '劫富济贫', symbol: '⚖', description: '结算前由最富者向最穷者转移金币。', needsTarget: false, rarity: 'common' },
  { id: 'doubleBid', name: '反客为主', symbol: '↑', description: '本轮投资以双倍金额参与排名。', needsTarget: false, rarity: 'rare' },
  { id: 'black', name: '黑卡', symbol: '◐', description: '本轮拍品真实价值减半，奖励预览不变。', needsTarget: false, rarity: 'common' },
  { id: 'reverseRank', name: '逆转排名', symbol: '↻', description: '倒转本轮获奖区内的排名；若与其他逆转叠加，偶数次会抵消。', needsTarget: false, rarity: 'rare' },
  { id: 'fateCoin', name: '命运硬币', symbol: '◒', description: '掷硬币：正面获得 10 金币，反面没有效果。', needsTarget: false, rarity: 'common' },
  { id: 'bananaPeel', name: '香蕉皮', symbol: '🍌', description: '指定一名其他玩家：其本轮下注作废，只损失一半下注费用。', needsTarget: true, rarity: 'uncommon' },
  { id: 'reflectShield', name: '反弹护盾', symbol: '🛡', description: '自动待命：有人用香蕉皮或偷天换日指定你时，自动反弹该次效果并消耗，不占本轮道具次数。', needsTarget: false, rarity: 'rare' },
  { id: 'prizeReroll', name: '改拍令', symbol: '🎴', description: '确认后抽取 6 件新拍品，私密选择其中一件替换下一轮拍品。抽取后不能取消或重抽。', needsTarget: false, rarity: 'uncommon' },
  { id: 'legendaryLoot', name: '夺宝令', symbol: '♛', description: '直接夺走本轮最终藏品，优先于绑匪；不影响排名奖励和预测。', needsTarget: false, rarity: 'legendary' },
]

export function getCardDefinition(cardId: CardId): CardDefinition {
  return CARD_DEFINITIONS.find((card) => card.id === cardId) as CardDefinition
}

/** Removes exactly one physical copy, preserving other copies in the inventory. */
export function removeOneCard(cardIds: CardId[], cardId: CardId): CardId[] {
  const index = cardIds.indexOf(cardId)
  return index < 0 ? [...cardIds] : [...cardIds.slice(0, index), ...cardIds.slice(index + 1)]
}

export function cardInventoryCounts(cardIds: CardId[]): Array<{ cardId: CardId; count: number }> {
  const counts = new Map<CardId, number>()
  for (const cardId of cardIds) counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
  return [...counts].map(([cardId, count]) => ({ cardId, count }))
}

export function createCardDeck(disabledCardIds: CardId[]): CardId[] {
  const disabled = new Set(disabledCardIds)
  const copiesByRarity: Record<CardRarity, number> = {
    common: 4,
    rare: 3,
    uncommon: 2,
    legendary: 1,
  }
  return shuffle(CARD_DEFINITIONS
    .filter((card) => !disabled.has(card.id))
    .flatMap((card) => Array.from({ length: copiesByRarity[card.rarity] }, () => card.id)))
}

export function enabledCardIds(disabledCardIds: CardId[]): CardId[] {
  const disabled = new Set(disabledCardIds)
  return CARD_DEFINITIONS.filter((card) => !disabled.has(card.id)).map((card) => card.id)
}

/** Draw one physical card, refilling exactly one enabled card only when empty. */
export function drawCard(cardDeck: CardId[], disabledCardIds: CardId[], roll = Math.random): { cardId: CardId | null; cardDeck: CardId[]; replenished: boolean } {
  const deck = [...cardDeck]
  let replenished = false
  if (deck.length === 0) {
    const enabled = enabledCardIds(disabledCardIds)
    if (enabled.length === 0) return { cardId: null, cardDeck: deck, replenished }
    deck.push(enabled[Math.min(enabled.length - 1, Math.floor(roll() * enabled.length))])
    replenished = true
  }
  const index = Math.min(deck.length - 1, Math.floor(roll() * deck.length))
  return { cardId: deck.splice(index, 1)[0] ?? null, cardDeck: deck, replenished }
}
