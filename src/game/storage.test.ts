import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGamePreset } from './presets'
import { createDefaultSettings, createSession } from './session'
import { loadPresets, loadSession, savePresets } from './storage'

const values = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
}

beforeEach(() => {
  values.clear()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
})

afterEach(() => {
  values.clear()
})

describe('配置预设存储', () => {
  it('保存、加载与覆盖配置时保留姓名和全部高级设置', () => {
    const settings = createDefaultSettings(3)
    settings.disabledCardIds = ['black']
    const original = createGamePreset('周末三人局', ['甲', '乙', '丙'], settings)
    savePresets([original])
    const loaded = loadPresets()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ name: '周末三人局', names: ['甲', '乙', '丙'], settings: { disabledCardIds: ['black'], wrongPredictionMultiplier: 1.5, cardGrantProbability: 80 } })
    loaded[0].settings.disabledCardIds.push('red')
    expect(loadPresets()[0].settings.disabledCardIds).toEqual(['black'])
  })

  it('损坏的预设存储会被安全忽略', () => {
    values.set('who-is-raising:presets:v1', '{not-json')
    expect(loadPresets()).toEqual([])
  })
})

describe('对局存档迁移', () => {
  it('v2 存档补齐拍品分类而不改写已有规则数值', () => {
    const settings = createDefaultSettings(3)
    settings.wrongPredictionMultiplier = 0.5
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], settings)))
    legacy.version = 2
    delete legacy.itemDeck[0].category
    legacy.players[0].items = [{ item: { ...legacy.itemDeck[0] }, roundIndex: 0 }]
    delete legacy.players[0].items[0].item.category
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    const migrated = loadSession()
    expect(migrated?.version).toBe(5)
    expect(migrated?.settings.identitySettings.enabled).toBe(false)
    expect(migrated?.settings.wrongPredictionMultiplier).toBe(0.5)
    expect(migrated?.itemDeck[0].category).toBeTruthy()
    expect(migrated?.players[0].items[0].item.category).toBeTruthy()
  })
})
