import { shuffle } from './items'
import type { CardId } from './types'

export interface CardDefinition {
  id: CardId
  name: string
  symbol: string
  description: string
  needsTarget: boolean
}

export const CARD_DEFINITIONS: CardDefinition[] = [
  { id: 'red', name: '红卡', symbol: '◆', description: '本轮拍品真实价值翻倍，奖励预览不变。', needsTarget: false },
  { id: 'peek', name: '偷看底牌', symbol: '◉', description: '查看一名已投资玩家的实际投资额。', needsTarget: true },
  { id: 'swap', name: '偷天换日', symbol: '↔', description: '与任意一名其他玩家交换本轮排名用投资额。', needsTarget: true },
  { id: 'redistribute', name: '劫富济贫', symbol: '⚖', description: '结算前由最富者向最穷者转移金币。', needsTarget: false },
  { id: 'doubleBid', name: '反客为主', symbol: '↑', description: '本轮投资以双倍金额参与排名。', needsTarget: false },
  { id: 'black', name: '黑卡', symbol: '◐', description: '本轮拍品真实价值减半，奖励预览不变。', needsTarget: false },
  { id: 'reverseRank', name: '逆转排名', symbol: '↻', description: '倒转本轮获奖区内的排名；若与其他逆转叠加，偶数次会抵消。', needsTarget: false },
]

export function getCardDefinition(cardId: CardId): CardDefinition {
  return CARD_DEFINITIONS.find((card) => card.id === cardId) as CardDefinition
}

export function createCardDeck(disabledCardIds: CardId[]): CardId[] {
  const disabled = new Set(disabledCardIds)
  return shuffle(CARD_DEFINITIONS.filter((card) => !disabled.has(card.id)).map((card) => card.id))
}
