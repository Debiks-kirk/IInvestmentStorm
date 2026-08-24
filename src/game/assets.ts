import type { AssetCategory, FixedAssetBreakdown, WonItem } from './types'

export interface AssetCategoryConfig {
  category: AssetCategory
  name: string
  symbol: string
  tiers: [number, number, number]
  additionalUnit: number
}

export const ASSET_CATEGORY_CONFIGS: AssetCategoryConfig[] = [
  { category: 'leisure', name: '生活娱乐', symbol: '✦', tiers: [8, 20, 20], additionalUnit: 10 },
  { category: 'transport', name: '交通旅行', symbol: '➜', tiers: [9, 23, 23], additionalUnit: 10 },
  { category: 'luxury', name: '奢侈科技', symbol: '◆', tiers: [10, 26, 26], additionalUnit: 10 },
  { category: 'property', name: '地产产业', symbol: '▰', tiers: [12, 30, 30], additionalUnit: 10 },
]

const COIN_UNITS = 2

export function categoryConfig(category: AssetCategory): AssetCategoryConfig {
  return ASSET_CATEGORY_CONFIGS.find((entry) => entry.category === category) as AssetCategoryConfig
}

export function fixedAssetCoins(category: AssetCategory, itemCount: number): number {
  const config = categoryConfig(category)
  if (itemCount < 2) return 0
  if (itemCount === 2) return config.tiers[0]
  if (itemCount === 3) return config.tiers[1]
  return config.tiers[2] + Math.max(0, itemCount - 3) * config.additionalUnit
}

/** A real item contributes a small, value-based fixed asset bonus by itself. */
export function itemFixedAssetCoins(value: number): number {
  return Math.max(1, Math.ceil(value / 5))
}

export function calculateFixedAssets(items: WonItem[], bonusCategory?: AssetCategory): FixedAssetBreakdown[] {
  const realCounts = new Map<AssetCategory, number>()
  const itemBonusCoins = new Map<AssetCategory, number>()
  for (const { item } of items) {
    realCounts.set(item.category, (realCounts.get(item.category) ?? 0) + 1)
    itemBonusCoins.set(item.category, (itemBonusCoins.get(item.category) ?? 0) + itemFixedAssetCoins(item.value))
  }
  return ASSET_CATEGORY_CONFIGS.map((config) => {
    const realCount = realCounts.get(config.category) ?? 0
    // The collector's virtual item can unlock set tiers, but is not a real item
    // and therefore does not receive a value-based single-item bonus.
    const itemCount = realCount + (bonusCategory === config.category ? 1 : 0)
    const coins = (itemBonusCoins.get(config.category) ?? 0) + fixedAssetCoins(config.category, itemCount)
    return { category: config.category, itemCount, units: coins * COIN_UNITS }
  })
}

export function fixedAssetTotalUnits(items: WonItem[], bonusCategory?: AssetCategory): number {
  return calculateFixedAssets(items, bonusCategory).reduce((total, entry) => total + entry.units, 0)
}
