import type { AssetCategory, FixedAssetBreakdown, WonItem } from './types'

export interface AssetCategoryConfig {
  category: AssetCategory
  name: string
  symbol: string
  tiers: [number, number, number]
  additionalUnit: number
}

export const ASSET_CATEGORY_CONFIGS: AssetCategoryConfig[] = [
  { category: 'leisure', name: '生活娱乐', symbol: '✦', tiers: [3, 10, 20], additionalUnit: 10 },
  { category: 'transport', name: '交通旅行', symbol: '➜', tiers: [5, 14, 28], additionalUnit: 14 },
  { category: 'luxury', name: '奢侈科技', symbol: '◆', tiers: [7, 20, 40], additionalUnit: 20 },
  { category: 'property', name: '地产产业', symbol: '▰', tiers: [8, 24, 48], additionalUnit: 24 },
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
  return config.tiers[2] + Math.max(0, itemCount - 4) * config.additionalUnit
}

export function calculateFixedAssets(items: WonItem[]): FixedAssetBreakdown[] {
  const counts = new Map<AssetCategory, number>()
  for (const { item } of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  return ASSET_CATEGORY_CONFIGS.map((config) => {
    const itemCount = counts.get(config.category) ?? 0
    return { category: config.category, itemCount, units: fixedAssetCoins(config.category, itemCount) * COIN_UNITS }
  })
}

export function fixedAssetTotalUnits(items: WonItem[]): number {
  return calculateFixedAssets(items).reduce((total, entry) => total + entry.units, 0)
}
