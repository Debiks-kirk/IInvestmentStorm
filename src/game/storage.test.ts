import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGamePreset, exportGamePreset, importGamePreset } from './presets'
import { createDefaultSettings, createSession } from './session'
import { archiveGameHistory, loadCustomBotProfiles, loadGameHistory, loadPresets, loadSession, saveCustomBotProfiles, saveGameHistory, savePresets } from './storage'
import { defaultBotStrategy } from './bots'
import { CARD_DEFINITIONS } from './cards'

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
  it('新局默认值包含更高小偷成功率与更低的指定任务加价', () => {
    expect(createDefaultSettings(3)).toMatchObject({ turnTimeLimitSeconds: 20, turnTimerEnabled: false })
    expect(createDefaultSettings(3)).toMatchObject({ wrongPredictionMultiplier: 1.5, identitySettings: { lobbyistFailurePaymentCoins: 5, lobbyistSpecifiedTaskFeeCoins: 3, thiefActivationCoins: 0, thiefSuccessProbability: 100, gamblerCorrectBonusMultiplier: .33, gamblerWrongPenaltyMultiplier: .5, gamblerSkipPenaltyMultiplier: .5, prophetDivinationCoins: 0, merchantAuctionLimit: 1, nightwalkerUseLimit: 2 } })
    expect(createDefaultSettings(6)).toMatchObject({ wrongPredictionMultiplier: 1, identitySettings: { gamblerCorrectBonusMultiplier: .67, gamblerWrongPenaltyMultiplier: .33, gamblerSkipPenaltyMultiplier: .33, kidnapActivationCoins: 0, kidnapLowRansomCoins: 6, kidnapHighRansomCoins: 12, merchantAuctionLimit: 3, nightwalkerUseLimit: 2 } })
    expect(createDefaultSettings(10)).toMatchObject({ wrongPredictionMultiplier: .5, identitySettings: { gamblerCorrectBonusMultiplier: 1, gamblerWrongPenaltyMultiplier: .2, gamblerSkipPenaltyMultiplier: .2, kidnapActivationCoins: 0, kidnapLowRansomCoins: 6, kidnapHighRansomCoins: 12, merchantAuctionLimit: 3, nightwalkerUseLimit: 3 } })
  })

  it('保存、加载与覆盖配置时保留姓名和全部高级设置', () => {
    const settings = createDefaultSettings(3)
    settings.disabledCardIds = ['black']
    const original = createGamePreset('周末三人局', ['甲', '乙', '丙'], settings)
    savePresets([original])
    const loaded = loadPresets()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ name: '周末三人局', names: ['甲', '乙', '丙'], settings: { disabledCardIds: ['black'], wrongPredictionMultiplier: 1.5, cardGrantProbability: 100 } })
    loaded[0].settings.disabledCardIds.push('red')
    expect(loadPresets()[0].settings.disabledCardIds).toEqual(['black'])
  })

  it('损坏的预设存储会被安全忽略', () => {
    values.set('who-is-raising:presets:v1', '{not-json')
    expect(loadPresets()).toEqual([])
  })

  it('配置可导出为可移植文本并在另一台设备导入为新配置', () => {
    const settings = createDefaultSettings(3)
    settings.identitySettings.identityChoiceCount = 3
    const source = createGamePreset('社区三人局', [{ name: '甲', controller: { kind: 'human' } }, { name: '乙', controller: { kind: 'bot', profileId: 'adaptive', difficulty: 'expert' } }, { name: '丙', controller: { kind: 'human' } }], settings)
    const raw = exportGamePreset(source)
    expect(JSON.parse(raw)).toMatchObject({ format: 'who-is-raising-preset', version: 2, preset: { name: '社区三人局' } })
    expect(importGamePreset(raw)).toMatchObject({ name: '社区三人局', seats: [{ name: '甲' }, { name: '乙', controller: { kind: 'bot', profileId: 'adaptive', difficulty: 'expert' } }, { name: '丙' }], settings: { playerCount: 3, identitySettings: { identityChoiceCount: 3 } } })
  })

  it('无效的共享文本不会导入', () => {
    expect(importGamePreset('{"format":"other"}')).toBeNull()
    expect(importGamePreset('not-json')).toBeNull()
  })
})

describe('对局历史存储', () => {
  it('终局快照会按对局 ID 归档、覆盖更新并保持原完成时间', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    session.phase = 'finalResult'
    session.results = []
    const first = archiveGameHistory([], session, '2026-08-06T01:00:00.000Z')
    const changed = { ...session, players: session.players.map((player, index) => index === 0 ? { ...player, balanceUnits: player.balanceUnits + 4 } : player) }
    const second = archiveGameHistory(first, changed, '2026-08-06T02:00:00.000Z')
    saveGameHistory(second)
    expect(loadGameHistory()).toHaveLength(1)
    expect(loadGameHistory()[0]).toMatchObject({ id: session.id, completedAt: '2026-08-06T01:00:00.000Z' })
    expect(loadGameHistory()[0].session.players[0].balanceUnits).toBe(session.players[0].balanceUnits + 4)
  })

  it('损坏的历史库会被安全忽略，进行中对局不会写入历史', () => {
    values.set('who-is-raising:history:v1', '{bad json')
    expect(loadGameHistory()).toEqual([])
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    expect(archiveGameHistory([], session)).toEqual([])
  })
})

describe('对局存档迁移', () => {
  it('已挂出的拍品会迁移为系统托管，不再同时留在卖家收藏中', () => {
    const session = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    const held = { item: session.itemDeck[0], roundIndex: 0 }
    session.players[0].items = [held]
    session.pendingAssetAuctions = [{ id: 'asset-1', sellerId: session.players[0].id, item: held.item, itemRoundIndex: held.roundIndex, minimumBidUnits: 2, roundIndex: 1 }]
    values.set('who-is-raising:session:v1', JSON.stringify(session))
    const loaded = loadSession()
    expect(loaded?.pendingAssetAuctions).toHaveLength(1)
    expect(loaded?.players[0].items).toEqual([])
  })

  it('自定义 Bot 模板会独立保存，并随分享配置携带座位快照', () => {
    const now = '2026-08-26T00:00:00.000Z'
    const custom = { id: 'studio-bot', name: '藏品猎手', createdAt: now, updatedAt: now, ...defaultBotStrategy('collectorBot'), collection: 93 }
    saveCustomBotProfiles([custom])
    expect(loadCustomBotProfiles()).toMatchObject([{ id: 'studio-bot', name: '藏品猎手', collection: 93 }])
    const source = createGamePreset('带 Bot 配置', [{ name: 'Bot', controller: { kind: 'bot', profileId: 'custom', difficulty: 'expert', customProfile: custom } }, { name: '乙', controller: { kind: 'human' } }, { name: '丙', controller: { kind: 'human' } }], createDefaultSettings(3))
    const imported = importGamePreset(exportGamePreset(source))
    expect(imported?.customProfiles).toMatchObject([{ id: 'studio-bot', collection: 93 }])
    expect(imported?.seats[0].controller).toMatchObject({ kind: 'bot', profileId: 'custom', customProfile: { name: '藏品猎手', identityTactics: custom.identityTactics } })
  })

  it('新局默认预留首轮系统竞购卡，关闭后不进入竞购流程', () => {
    const enabled = createSession(['甲', '乙', '丙'], createDefaultSettings(3))
    expect(enabled.roundAuctions).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'system', merchantId: null, roundIndex: 0 })]))
    expect(enabled.pendingIdentityNotices.filter((notice) => notice.title === '本轮道具竞购')).toHaveLength(3)
    const copiesByRarity = { common: 4, rare: 3, uncommon: 2, legendary: 1 }
    expect(enabled.cardDeck).toHaveLength(CARD_DEFINITIONS.reduce((total, card) => total + copiesByRarity[card.rarity], 0) - 1)
    const settings = createDefaultSettings(3)
    settings.systemAuctionCardsPerRound = 0
    const disabled = createSession(['甲', '乙', '丙'], settings)
    expect(disabled.roundAuctions).toHaveLength(0)
    expect(disabled.phase).toBe('identityHandoff')
  })

  it('旧进行中存档不会被补插首轮系统竞购', () => {
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], createDefaultSettings(3))))
    delete legacy.settings.systemAuctionCardsPerRound
    legacy.merchantAuction = null
    legacy.phase = 'roundIntro'
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()?.settings.systemAuctionCardsPerRound).toBe(1)
    expect(loadSession()?.merchantAuction).toBeNull()
  })

  it('旧存档补齐默认操作时限，并保留已经开始的绝对截止时间', () => {
    const legacy = JSON.parse(JSON.stringify(createSession(['甲', '乙', '丙'], createDefaultSettings(3))))
    legacy.version = 10
    delete legacy.settings.turnTimeLimitSeconds
    delete legacy.settings.turnTimerEnabled
    legacy.operationDeadlineAt = 123456789
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    expect(loadSession()).toMatchObject({ version: 27, operationDeadlineAt: null, settings: { turnTimeLimitSeconds: 20, turnTimerEnabled: false, systemAuctionCardsPerRound: 1 } })
  })

  it('v14 Bot 存档会稳定补齐本局行为倾向，而不会重写已提交记录', () => {
    const seats = [
      { name: 'Bot', controller: { kind: 'bot' as const, profileId: 'adaptive' as const, difficulty: 'standard' as const } },
      { name: '乙', controller: { kind: 'human' as const } },
      { name: '丙', controller: { kind: 'human' as const } },
    ]
    const legacy = JSON.parse(JSON.stringify(createSession(seats, createDefaultSettings(3))))
    legacy.version = 14
    legacy.players[0].botMemory.decisionLog = [{ stage: 'turn', roundIndex: 0, mode: 'value', reason: '旧记录', bidUnits: 7 }]
    delete legacy.players[0].botMemory.behavior
    delete legacy.players[0].botMemory.recentBidUnits
    values.set('who-is-raising:session:v1', JSON.stringify(legacy))
    const first = loadSession()
    const second = loadSession()
    expect(first?.version).toBe(27)
    expect(first?.players[0].botMemory?.behavior).toEqual(second?.players[0].botMemory?.behavior)
    expect(typeof first?.players[0].botMemory?.behavior.bankrollBias).toBe('number')
    expect(typeof first?.players[0].botMemory?.behavior.assetFocusBias).toBe('number')
    expect(first?.players[0].botMemory?.decisionLog).toEqual(legacy.players[0].botMemory.decisionLog)
    expect(first?.players[0].botMemory?.recentBidUnits).toEqual([])
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
    expect(migrated?.version).toBe(27)
    expect(migrated?.settings.identitySettings.enabled).toBe(false)
    expect(migrated?.settings.wrongPredictionMultiplier).toBe(0.5)
    expect(migrated?.settings.identitySettings.gamblerWrongPenaltyMultiplier).toBe(migrated?.settings.identitySettings.gamblerSkipPenaltyMultiplier)
    expect(migrated?.itemDeck[0].category).toBeTruthy()
    expect(migrated?.players[0].items[0].item.category).toBeTruthy()
    expect(migrated?.cardDeck).toContain('reverseRank')
    expect(migrated?.cardDeck).toEqual(expect.arrayContaining(['fateCoin', 'bananaPeel', 'reflectShield']))
    expect(migrated?.cardDeck).toContain('legendaryLoot')
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
