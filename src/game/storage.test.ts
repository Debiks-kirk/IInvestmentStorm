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
  it('新局默认说客违约付款为 5 金币', () => {
    expect(createDefaultSettings(3)).toMatchObject({ turnTimeLimitSeconds: 20, turnTimerEnabled: false })
    expect(createDefaultSettings(3).identitySettings).toMatchObject({ lobbyistFailurePaymentCoins: 5, gamblerCorrectBonusMultiplier: .5, gamblerWrongPenaltyMultiplier: .5, gamblerSkipPenaltyMultiplier: .5, merchantAuctionLimit: 2 })
  })

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
  it('新局默认预留首轮系统竞购卡，关闭后不进入竞购流程', () => {
    const enabled = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    expect(enabled.merchantAuction).toMatchObject({ source: 'system', merchantId: null, roundIndex: 0, bidderIndex: 0 })
    expect(enabled.cardDeck).not.toContain(enabled.merchantAuction?.cardId)
    const settings = createDefaultSettings(3)
    settings.firstRoundSystemAuction = false
    const disabled = createSession(['甲', '乙', '丙'], settings)
    expect(disabled.merchantAuction).toBeNull()
    expect(disabled.phase).toBe('identityHandoff')
  })

  it('旧进行中存档不会被补插首轮系统竞购', () => {
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], createDefaultSettings(3))))
    delete legacy.settings.firstRoundSystemAuction
    legacy.merchantAuction = null
    legacy.phase = 'roundIntro'
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()?.settings.firstRoundSystemAuction).toBe(false)
    expect(loadSession()?.merchantAuction).toBeNull()
  })

  it('旧存档补齐默认操作时限，并保留已经开始的绝对截止时间', () => {
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], createDefaultSettings(3))))
    legacy.version = 10
    delete legacy.settings.turnTimeLimitSeconds
    delete legacy.settings.turnTimerEnabled
    legacy.operationDeadlineAt = 123456789
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()).toMatchObject({ version: 11, operationDeadlineAt: null, settings: { turnTimeLimitSeconds: 20, turnTimerEnabled: false } })
  })

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
    expect(migrated?.version).toBe(11)
    expect(migrated?.settings.identitySettings.enabled).toBe(false)
    expect(migrated?.settings.wrongPredictionMultiplier).toBe(0.5)
    expect(migrated?.settings.identitySettings.gamblerWrongPenaltyMultiplier).toBe(migrated?.settings.identitySettings.gamblerSkipPenaltyMultiplier)
    expect(migrated?.itemDeck[0].category).toBeTruthy()
    expect(migrated?.players[0].items[0].item.category).toBeTruthy()
    expect(migrated?.cardDeck).toContain('reverseRank')
    expect(migrated?.cardDeck).toEqual(expect.arrayContaining(['fateCoin', 'bananaPeel', 'reflectShield']))
    expect(migrated?.settings.turnTimeLimitSeconds).toBe(20)
    expect(migrated?.settings.turnTimerEnabled).toBe(false)
  })

  it('v7 存档加载时保留已开启的身份系统', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    values.set('who-is-raising:session:v1', JSON.stringify(session))
    expect(loadSession()?.settings.identitySettings.enabled).toBe(true)
  })

  it('旧商人一次性状态迁移为已发动一次', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    session.players[0].identity = { id: 'merchant', thiefSuccesses: 0, merchantAuctionUsed: true, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    const legacy = JSON.parse(JSON.stringify(session))
    delete legacy.players[0].identity.merchantAuctionCount
    delete legacy.players[0].identity.merchantLastAuctionRound
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()?.players[0].identity).toMatchObject({ merchantAuctionCount: 1, merchantLastAuctionRound: null })
  })

  it('旧存档补齐预言牌堆并将改拍令加入可用循环卡池', () => {
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], createDefaultSettings(3))))
    delete legacy.prophecyDeck
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    const migrated = loadSession()
    expect(migrated?.prophecyDeck).toEqual(migrated?.itemDeck)
    expect(migrated?.cardDeck).toContain('prizeReroll')
  })

  it('旧单卡回合会迁移为可容纳多卡的记录', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    const legacy = JSON.parse(JSON.stringify(session))
    legacy.version = 6
    legacy.turns = [{ playerId: legacy.players[0].id, bidUnits: 0, predictedPlayerId: null, cardUse: { cardId: 'red' } }]
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()?.turns[0].cardUses).toEqual([{ cardId: 'red' }])
  })
})
