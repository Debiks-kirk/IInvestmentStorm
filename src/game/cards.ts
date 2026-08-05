import { shuffle } from './items'
import type { CardId } from './types'

export interface CardDefinition {
  id: CardId
  name: string
  symbol: string
  description: string
  needsTarget: boolean
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
  { id: 'red', name: '红卡', symbol: '◆', description: '本轮拍品真实价值翻倍，奖励预览不变。', needsTarget: false },
  { id: 'peek', name: '偷看底牌', symbol: '◉', description: '查看一名已投资玩家的实际投资额。', needsTarget: true },
  { id: 'swap', name: '偷天换日', symbol: '↔', description: '与任意一名其他玩家交换本轮排名用投资额。', needsTarget: true },
  { id: 'redistribute', name: '劫富济贫', symbol: '⚖', description: '结算前由最富者向最穷者转移金币。', needsTarget: false },
  { id: 'doubleBid', name: '反客为主', symbol: '↑', description: '本轮投资以双倍金额参与排名。', needsTarget: false },
  { id: 'black', name: '黑卡', symbol: '◐', description: '本轮拍品真实价值减半，奖励预览不变。', needsTarget: false },
  { id: 'reverseRank', name: '逆转排名', symbol: '↻', description: '倒转本轮获奖区内的排名；若与其他逆转叠加，偶数次会抵消。', needsTarget: false },
  { id: 'fateCoin', name: '命运硬币', symbol: '◒', description: '掷硬币：正面获得 6 金币，反面损失 4 金币。', needsTarget: false },
  { id: 'bananaPeel', name: '香蕉皮', symbol: '🍌', description: '指定一名其他玩家：其本轮下注作废，只损失一半下注费用。', needsTarget: true },
  { id: 'reflectShield', name: '反弹护盾', symbol: '🛡', description: '自动待命：有人用香蕉皮或偷天换日指定你时，自动反弹该次效果并消耗，不占本轮道具次数。', needsTarget: false },
  { id: 'prizeReroll', name: '改拍令', symbol: '🎴', description: '确认后抽取 6 件新拍品，私密选择其中一件替换下一轮拍品。抽取后不能取消或重抽。', needsTarget: false },
]

export function getCardDefinition(cardId: CardId): CardDefinition {
  return CARD_DEFINITIONS.find((card) => card.id === cardId) as CardDefinition
}

export function createCardDeck(disabledCardIds: CardId[]): CardId[] {
  const disabled = new Set(disabledCardIds)
  return shuffle(CARD_DEFINITIONS.filter((card) => !disabled.has(card.id)).flatMap((card) => [card.id, card.id]))
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
