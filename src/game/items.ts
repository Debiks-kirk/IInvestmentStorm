import type { AssetCategory, Item } from './types'

export const ITEM_POOL: Item[] = [
  { id: 'trash', name: '垃圾', value: 3, emoji: '🗑️', tone: '#8b8f91', category: 'leisure' },
  { id: 'noodles', name: '泡面', value: 4, emoji: '🍜', tone: '#d36b4c', category: 'leisure' },
  { id: 'cola', name: '可乐', value: 4, emoji: '🥤', tone: '#ad4d49', category: 'leisure' },
  { id: 'weed', name: '水草', value: 4, emoji: '🌿', tone: '#5e8b70', category: 'property' },
  { id: 'basketball', name: '篮球', value: 5, emoji: '🏀', tone: '#d47a44', category: 'leisure' },
  { id: 'headphones', name: '耳机', value: 5, emoji: '🎧', tone: '#646e89', category: 'luxury' },
  { id: 'milk-tea', name: '奶茶', value: 5, emoji: '🧋', tone: '#ae8066', category: 'leisure' },
  { id: 'toy-car', name: '玩具车', value: 5, emoji: '🚗', tone: '#5d83a6', category: 'transport' },
  { id: 'doll', name: '芭比娃娃', value: 5, emoji: '🎀', tone: '#bd6f83', category: 'leisure' },
  { id: 'phone', name: '手机', value: 6, emoji: '📱', tone: '#596878', category: 'luxury' },
  { id: 'ticket', name: '机票', value: 6, emoji: '🎫', tone: '#4e8497', category: 'transport' },
  { id: 'camera', name: '相机', value: 6, emoji: '📷', tone: '#6c6460', category: 'luxury' },
  { id: 'console', name: '游戏机', value: 6, emoji: '🎮', tone: '#716a9a', category: 'luxury' },
  { id: 'laptop', name: '笔记本电脑', value: 7, emoji: '💻', tone: '#5f7884', category: 'luxury' },
  { id: 'diamond', name: '钻石', value: 7, emoji: '💎', tone: '#5f91a2', category: 'luxury' },
  { id: 'gold', name: '黄金', value: 7, emoji: '🪙', tone: '#b38a39', category: 'luxury' },
  { id: 'bag', name: '名牌包', value: 7, emoji: '👜', tone: '#9b6d58', category: 'luxury' },
  { id: 'tractor', name: '拖拉机', value: 8, emoji: '🚜', tone: '#6e8952', category: 'transport' },
  { id: 'sheep', name: '绵羊', value: 8, emoji: '🐑', tone: '#908775', category: 'property' },
  { id: 'shop', name: '奶茶店', value: 8, emoji: '🏪', tone: '#a67263', category: 'property' },
  { id: 'apartment', name: '公寓房', value: 9, emoji: '🏢', tone: '#627c8c', category: 'property' },
  { id: 'sports-car', name: '跑车', value: 9, emoji: '🏎️', tone: '#a8504b', category: 'transport' },
  { id: 'yacht', name: '游艇', value: 9, emoji: '🛥️', tone: '#4b8297', category: 'transport' },
  { id: 'mansion', name: '豪宅', value: 10, emoji: '🏛️', tone: '#86745e', category: 'property' },
  { id: 'jet', name: '私人飞机', value: 10, emoji: '🛩️', tone: '#587f92', category: 'transport' },
  { id: 'giant-diamond', name: '超大钻石', value: 10, emoji: '💠', tone: '#4b91a3', category: 'luxury' },
  { id: 'space-trip', name: '太空旅行', value: 12, emoji: '🚀', tone: '#655f88', category: 'transport' },
  { id: 'submarine', name: '私人潜艇', value: 12, emoji: '⚓', tone: '#3f7588', category: 'transport' },
  { id: 'island', name: '私人小岛', value: 15, emoji: '🏝️', tone: '#458875', category: 'property' },
]

const categoryById = new Map(ITEM_POOL.map((item) => [item.id, item.category]))

export function categoryForItemId(id: string): AssetCategory {
  return categoryById.get(id) ?? 'leisure'
}

export function normalizeItem(item: Omit<Item, 'category'> & Partial<Pick<Item, 'category'>>): Item {
  return { ...item, category: item.category ?? categoryForItemId(item.id) }
}

function randomIndex(maxExclusive: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

export function shuffle<T>(values: readonly T[]): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

export function createItemDeck(rounds: number): Item[] {
  return shuffle(ITEM_POOL).slice(0, rounds)
}
