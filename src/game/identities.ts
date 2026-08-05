import type { AssetCategory, CardId, IdentityEvent, IdentityId, IdentityNotice, IdentitySettings, LobbyistContract, LobbyistTaskType, Player, PlayerIdentity } from './types'

export interface IdentityDefinition {
  id: IdentityId
  name: string
  symbol: string
  summary: string
  repeatable: boolean
  needsTarget?: boolean
  needsCategory?: boolean
  needsMerchantCard?: boolean
}

export const IDENTITY_DEFINITIONS: IdentityDefinition[] = [
  { id: 'prophet', name: '预言家', symbol: '◌', summary: '主动发动天机推演：观财、观星或观身份。', repeatable: true },
  { id: 'gambler', name: '赌徒', symbol: '♠', summary: '猜中多赚；猜错或跳过会扣钱。', repeatable: true },
  { id: 'assassin', name: '绑匪', symbol: '⛓', summary: '花钱盯上一人；他拍下物品时可将物品抢走。', repeatable: true },
  { id: 'collector', name: '收藏家', symbol: '▣', summary: '选一类资产；拿下同类拍品额外得 5 金币。', repeatable: true, needsCategory: true },
  { id: 'thief', name: '小偷', symbol: '◒', summary: '主动花钱尝试偷走本轮别人未使用的道具。', repeatable: true },
  { id: 'merchant', name: '道具商人', symbol: '◇', summary: '初始拿卡，并可发起两次竞购。', repeatable: true, needsMerchantCard: true },
  { id: 'reverser', name: '逆转者', symbol: '↻', summary: '花钱把本轮获奖区名次倒过来。', repeatable: true },
  { id: 'lobbyist', name: '说客', symbol: '✉', summary: '给别人发随机任务；加钱可指定。', repeatable: false },
  { id: 'nightwalker', name: '夜行者', symbol: '☾', summary: '主动设两档暗标；揭晓后自动采用本轮更划算的一档。', repeatable: true },
]

export function getIdentityDefinition(id: IdentityId): IdentityDefinition {
  return IDENTITY_DEFINITIONS.find((identity) => identity.id === id) as IdentityDefinition
}

export function identitySkillMode(id: IdentityId): 'active' | 'passive' {
  return id === 'prophet' || id === 'assassin' || id === 'merchant' || id === 'reverser' || id === 'lobbyist' || id === 'thief' || id === 'nightwalker' ? 'active' : 'passive'
}

export function defaultIdentitySettings(enabled = true): IdentitySettings {
  return {
    enabled,
    disabledIdentityIds: [],
    gamblerCorrectBonusMultiplier: 0.5,
    gamblerWrongPenaltyMultiplier: 0.5,
    gamblerSkipPenaltyMultiplier: 0.5,
    prophetDivinationCoins: 3,
    reverserActivationCoins: 5,
    kidnapActivationCoins: 5,
    thiefActivationCoins: 5,
    thiefSuccessProbability: 50,
    merchantInitialOfferCount: 3,
    merchantAuctionLimit: 2,
    lobbyistFirstRoundFree: true,
    lobbyistFeeCoins: 5,
    lobbyistSpecifiedTaskFeeCoins: 5,
    lobbyistFailurePaymentCoins: 5,
  }
}

export function normalizeIdentitySettings(value: Partial<IdentitySettings> | undefined, enabled = false): IdentitySettings {
  const defaults = defaultIdentitySettings(enabled)
  const legacyPenalty = value?.gamblerSkipPenaltyMultiplier ?? defaults.gamblerSkipPenaltyMultiplier
  return { ...defaults, ...value, gamblerWrongPenaltyMultiplier: value?.gamblerWrongPenaltyMultiplier ?? legacyPenalty, gamblerSkipPenaltyMultiplier: legacyPenalty, prophetDivinationCoins: value?.prophetDivinationCoins ?? defaults.prophetDivinationCoins, merchantAuctionLimit: value?.merchantAuctionLimit ?? defaults.merchantAuctionLimit, reverserActivationCoins: value?.reverserActivationCoins ?? defaults.reverserActivationCoins, lobbyistSpecifiedTaskFeeCoins: value?.lobbyistSpecifiedTaskFeeCoins ?? defaults.lobbyistSpecifiedTaskFeeCoins, disabledIdentityIds: [...(value?.disabledIdentityIds ?? defaults.disabledIdentityIds)] }
}

export function enabledIdentityIds(settings: IdentitySettings): IdentityId[] {
  const disabled = new Set(settings.disabledIdentityIds)
  return IDENTITY_DEFINITIONS.filter((identity) => !disabled.has(identity.id)).map((identity) => identity.id)
}

export function repeatableIdentityIds(settings: IdentitySettings): IdentityId[] {
  const enabled = new Set(enabledIdentityIds(settings))
  return IDENTITY_DEFINITIONS.filter((identity) => identity.repeatable && enabled.has(identity.id)).map((identity) => identity.id)
}

export function dealIdentityChoices(selectedIds: IdentityId[], settings: IdentitySettings, roll = Math.random): IdentityId[] {
  const enabled = enabledIdentityIds(settings)
  const counts = new Map<IdentityId, number>()
  selectedIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  const normal = enabled.filter((id) => id === 'lobbyist' ? (counts.get(id) ?? 0) === 0 : (counts.get(id) ?? 0) < 2)
  const pick = (pool: IdentityId[], current: IdentityId[]) => {
    const candidates = pool.filter((id) => !current.includes(id))
    if (candidates.length === 0) return null
    return candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))]
  }
  const choices: IdentityId[] = []
  while (choices.length < 2) {
    const normalPick = pick(normal, choices)
    if (normalPick) { choices.push(normalPick); continue }
    const fallback = enabled.filter((id) => id !== 'lobbyist').filter((id) => !choices.includes(id))
      .sort((left, right) => (counts.get(left) ?? 0) - (counts.get(right) ?? 0))
    const next = pick(fallback, choices)
    if (!next) break
    choices.push(next)
  }
  return choices
}

export function identityValidationErrors(settings: IdentitySettings, _playerCount: number): string[] {
  if (!settings.enabled) return []
  const enabled = enabledIdentityIds(settings)
  const errors: string[] = []
  if (enabled.length < 2) errors.push('身份系统至少需要启用 2 个身份')
  if (enabled.filter((id) => id !== 'lobbyist').length < 2) errors.push('身份系统至少需要启用 2 个非说客身份，才能持续提供不同候选')
  if (settings.thiefSuccessProbability < 0 || settings.thiefSuccessProbability > 100) errors.push('小偷成功率应为 0–100%')
  if (settings.prophetDivinationCoins < 0 || settings.prophetDivinationCoins > 20 || settings.prophetDivinationCoins * 2 % 1 !== 0) errors.push('预言家推演费用应为 0–20，且按 0.5 递增')
  if (settings.thiefActivationCoins < 0 || settings.thiefActivationCoins > 20 || settings.thiefActivationCoins * 2 % 1 !== 0) errors.push('小偷发动费用应为 0–20，且按 0.5 递增')
  if (settings.kidnapActivationCoins < 0 || settings.kidnapActivationCoins > 20 || settings.kidnapActivationCoins * 2 % 1 !== 0) errors.push('绑匪发动费用应为 0–20，且按 0.5 递增')
  if (settings.merchantInitialOfferCount < 1 || settings.merchantInitialOfferCount > 6) errors.push('商人初始选卡数量应为 1–6')
  if (settings.merchantAuctionLimit < 1 || settings.merchantAuctionLimit > 5) errors.push('商人拍卖次数应为 1–5 次')
  return errors
}

export function createPlayerIdentity(id: IdentityId, config: { targetPlayerId?: string; collectorCategory?: AssetCategory } = {}): PlayerIdentity {
  return { id, ...config, thiefSuccesses: 0, merchantAuctionCount: 0, merchantLastAuctionRound: null, lobbyistNextFree: false, lobbyistLastIssuedRound: null, nightwalkerUses: 0 }
}

export interface LobbyistTaskDefinition {
  type: LobbyistTaskType
  label: string
  detail: string
  needsComparison?: boolean
}

export const LOBBYIST_TASKS: LobbyistTaskDefinition[] = [
  { type: 'winFirst', label: '拿到第一名', detail: '本轮结算时成为唯一第一名。' },
  { type: 'winSecond', label: '获得第二名', detail: '本轮结算时位列第二名。' },
  { type: 'avoidPrize', label: '不进入获奖区', detail: '本轮不要获得任何排名奖励。' },
  { type: 'bidZero', label: '保持观望', detail: '本轮实际下注必须为 0。' },
  { type: 'outbid', label: '下注高于某人', detail: '本轮实际下注必须严格高于指定玩家。', needsComparison: true },
  { type: 'underbid', label: '下注低于某人', detail: '本轮实际下注必须严格低于指定玩家。', needsComparison: true },
]

export function taskLabel(type: LobbyistTaskType): string {
  return LOBBYIST_TASKS.find((task) => task.type === type)?.label ?? type
}

export function taskRequiresComparison(type: LobbyistTaskType): boolean {
  return Boolean(LOBBYIST_TASKS.find((task) => task.type === type)?.needsComparison)
}

export function randomLobbyistTask(playerIds: string[], targetPlayerId: string, roll = Math.random): { taskType: LobbyistTaskType; comparisonPlayerId?: string } {
  const taskTypes = LOBBYIST_TASKS.map((task) => task.type)
  const taskType = taskTypes[Math.min(taskTypes.length - 1, Math.floor(roll() * taskTypes.length))]
  if (!taskRequiresComparison(taskType)) return { taskType }
  const comparisonIds = playerIds.filter((id) => id !== targetPlayerId)
  if (comparisonIds.length === 0) return { taskType: 'avoidPrize' }
  return { taskType, comparisonPlayerId: comparisonIds[Math.min(comparisonIds.length - 1, Math.floor(roll() * comparisonIds.length))] }
}

export function routeCardAwards({
  players,
  awards,
}: {
  players: Player[]
  awards: Array<{ playerId: string; cardId: CardId }>
  settings?: IdentitySettings
  fairnessOrderIds?: string[]
  roundIndex?: number
  roll?: () => number
}): { players: Player[]; notices: IdentityNotice[]; events: IdentityEvent[]; delivered: Array<{ playerId: string; cardId: CardId }> } {
  const nextPlayers = players.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
  const notices: IdentityNotice[] = []
  const events: IdentityEvent[] = []
  const delivered: Array<{ playerId: string; cardId: CardId }> = []
  for (const award of awards) {
    const recipient = nextPlayers.find((player) => player.id === award.playerId)
    if (recipient) {
      recipient.cardInventory.push(award.cardId)
      delivered.push(award)
    }
  }
  return { players: nextPlayers, notices, events, delivered }
}

export function cloneContracts(contracts: LobbyistContract[]): LobbyistContract[] {
  return contracts.map((contract) => ({ ...contract }))
}
