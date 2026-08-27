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
  { id: 'assassin', name: '绑匪', symbol: '⛓', summary: '主动发起绑票谈判；有人拍下藏品时，可公开索要赎金。', repeatable: false },
  { id: 'collector', name: '收藏家', symbol: '▣', summary: '选一类资产；拿下同类拍品额外得 5 金币。', repeatable: true, needsCategory: true },
  { id: 'thief', name: '小偷', symbol: '◒', summary: '主动偷走别人的未使用道具；没偷到时会盯上最富者。', repeatable: false },
  { id: 'merchant', name: '道具商人', symbol: '◇', summary: '前期获赠道具并安排竞购，最后两轮可开店。', repeatable: true },
  { id: 'reverser', name: '逆转者', symbol: '↻', summary: '花钱把本轮获奖区名次倒过来。', repeatable: true },
  { id: 'lobbyist', name: '说客', symbol: '✉', summary: '给别人发随机任务；加钱可指定。', repeatable: true },
  { id: 'nightwalker', name: '夜行者', symbol: '☾', summary: '主动设两档暗标；揭晓后自动采用本轮更划算的一档。', repeatable: true },
  { id: 'investor', name: '投资者', symbol: '◈', summary: '秘密跟投一名玩家；其获奖后按比例分红，并享受投资倍率。', repeatable: true },
]

export function getIdentityDefinition(id: IdentityId): IdentityDefinition {
  return IDENTITY_DEFINITIONS.find((identity) => identity.id === id) as IdentityDefinition
}

export function identitySkillMode(id: IdentityId): 'active' | 'passive' {
  return id === 'prophet' || id === 'assassin' || id === 'merchant' || id === 'reverser' || id === 'lobbyist' || id === 'thief' || id === 'nightwalker' || id === 'investor' ? 'active' : 'passive'
}

export function defaultIdentitySettings(enabled = true): IdentitySettings {
  return {
    enabled,
    disabledIdentityIds: [],
    identityChoiceCount: 2,
    gamblerCorrectBonusMultiplier: 0.5,
    gamblerWrongPenaltyMultiplier: 0.5,
    gamblerSkipPenaltyMultiplier: 0.5,
    prophetDivinationCoins: 0,
    reverserActivationCoins: 3,
    kidnapActivationCoins: 0,
    kidnapTargetLimit: 0,
    kidnapLowRansomCoins: 6,
    kidnapHighRansomCoins: 12,
    kidnapHighRansomExtraCoins: 2,
    kidnapExtraTargetCoins: 1,
    thiefActivationCoins: 0,
    thiefSuccessProbability: 100,
    thiefMaxSteals: 2,
    merchantInitialOfferCount: 3,
    merchantAuctionLimit: 2,
    prophetDivinationLimit: 12,
    kidnapActivationLimit: 12,
    thiefActivationLimit: 12,
    reverserActivationLimit: 12,
    lobbyistActivationLimit: 12,
    nightwalkerUseLimit: 2,
    lobbyistFirstRoundFree: true,
    lobbyistFeeCoins: 2,
    lobbyistSpecifiedTaskFeeCoins: 3,
    lobbyistFailurePaymentCoins: 5,
    investorDividendMultiplier: 1.25,
  }
}

export function normalizeIdentitySettings(value: Partial<IdentitySettings> | undefined, enabled = false): IdentitySettings {
  const defaults = defaultIdentitySettings(enabled)
  const legacyPenalty = value?.gamblerSkipPenaltyMultiplier ?? defaults.gamblerSkipPenaltyMultiplier
  const rawInvestorDividendMultiplier = value?.investorDividendMultiplier ?? defaults.investorDividendMultiplier
  const investorDividendMultiplier = Number.isFinite(rawInvestorDividendMultiplier)
    ? Math.round(Math.max(1, Math.min(3, rawInvestorDividendMultiplier)) * 20) / 20
    : defaults.investorDividendMultiplier
  return { ...defaults, ...value, identityChoiceCount: value?.identityChoiceCount ?? defaults.identityChoiceCount, gamblerWrongPenaltyMultiplier: value?.gamblerWrongPenaltyMultiplier ?? legacyPenalty, gamblerSkipPenaltyMultiplier: legacyPenalty, prophetDivinationCoins: value?.prophetDivinationCoins ?? defaults.prophetDivinationCoins, merchantAuctionLimit: value?.merchantAuctionLimit ?? defaults.merchantAuctionLimit, prophetDivinationLimit: value?.prophetDivinationLimit ?? defaults.prophetDivinationLimit, kidnapActivationLimit: value?.kidnapActivationLimit ?? defaults.kidnapActivationLimit, kidnapTargetLimit: value?.kidnapTargetLimit ?? defaults.kidnapTargetLimit, kidnapLowRansomCoins: value?.kidnapLowRansomCoins ?? defaults.kidnapLowRansomCoins, kidnapHighRansomCoins: value?.kidnapHighRansomCoins ?? defaults.kidnapHighRansomCoins, kidnapHighRansomExtraCoins: value?.kidnapHighRansomExtraCoins ?? defaults.kidnapHighRansomExtraCoins, kidnapExtraTargetCoins: value?.kidnapExtraTargetCoins ?? defaults.kidnapExtraTargetCoins, thiefActivationLimit: value?.thiefActivationLimit ?? defaults.thiefActivationLimit, reverserActivationLimit: value?.reverserActivationLimit ?? defaults.reverserActivationLimit, lobbyistActivationLimit: value?.lobbyistActivationLimit ?? defaults.lobbyistActivationLimit, nightwalkerUseLimit: value?.nightwalkerUseLimit ?? defaults.nightwalkerUseLimit, reverserActivationCoins: value?.reverserActivationCoins ?? defaults.reverserActivationCoins, lobbyistSpecifiedTaskFeeCoins: value?.lobbyistSpecifiedTaskFeeCoins ?? defaults.lobbyistSpecifiedTaskFeeCoins, investorDividendMultiplier, disabledIdentityIds: [...(value?.disabledIdentityIds ?? defaults.disabledIdentityIds)] }
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
  const normal = enabled.filter((id) => ['thief', 'assassin'].includes(id) ? (counts.get(id) ?? 0) === 0 : (counts.get(id) ?? 0) < 2)
  const pick = (pool: IdentityId[], current: IdentityId[]) => {
    const candidates = pool.filter((id) => !current.includes(id))
    if (candidates.length === 0) return null
    return candidates[Math.min(candidates.length - 1, Math.floor(roll() * candidates.length))]
  }
  const choices: IdentityId[] = []
  while (choices.length < settings.identityChoiceCount) {
    const normalPick = pick(normal, choices)
    if (normalPick) { choices.push(normalPick); continue }
    const fallback = enabled.filter((id) => !['thief', 'assassin'].includes(id)).filter((id) => !choices.includes(id))
      .sort((left, right) => (counts.get(left) ?? 0) - (counts.get(right) ?? 0))
    const next = pick(fallback, choices)
    if (!next) break
    choices.push(next)
  }
  return choices
}

export function kidnapTargetCap(settings: IdentitySettings, playerCount: number): number {
  const automatic = Math.ceil(playerCount / 4)
  return Math.max(1, Math.min(Math.max(1, playerCount - 1), settings.kidnapTargetLimit > 0 ? settings.kidnapTargetLimit : automatic))
}

export function identityValidationErrors(settings: IdentitySettings, playerCount: number): string[] {
  if (!settings.enabled) return []
  const enabled = enabledIdentityIds(settings)
  const errors: string[] = []
  if (!Number.isInteger(settings.identityChoiceCount) || settings.identityChoiceCount < 2 || settings.identityChoiceCount > 5) errors.push('开局身份候选数应为 2–5 张')
  if (enabled.length < settings.identityChoiceCount) errors.push(`身份系统至少需要启用 ${settings.identityChoiceCount} 个身份`)
  if (settings.thiefSuccessProbability < 0 || settings.thiefSuccessProbability > 100) errors.push('小偷成功率应为 0–100%')
  if (settings.prophetDivinationCoins < 0 || settings.prophetDivinationCoins > 20 || settings.prophetDivinationCoins * 2 % 1 !== 0) errors.push('预言家推演费用应为 0–20，且按 0.5 递增')
  if (settings.thiefActivationCoins < 0 || settings.thiefActivationCoins > 20 || settings.thiefActivationCoins * 2 % 1 !== 0) errors.push('小偷发动费用应为 0–20，且按 0.5 递增')
  const kidnapCoins = [settings.kidnapLowRansomCoins, settings.kidnapHighRansomCoins, settings.kidnapHighRansomExtraCoins, settings.kidnapExtraTargetCoins]
  if (kidnapCoins.some((coins) => coins < 0 || coins > 50 || coins * 2 % 1 !== 0)) errors.push('绑匪赎金与附加费用应为 0–50，且按 0.5 递增')
  if (settings.kidnapHighRansomCoins < settings.kidnapLowRansomCoins) errors.push('高档赎金不能低于低档赎金')
  if (!Number.isInteger(settings.kidnapTargetLimit) || settings.kidnapTargetLimit < 0 || settings.kidnapTargetLimit > Math.max(1, playerCount - 1)) errors.push('绑票目标上限应为 0 到玩家数减 1（0 为自动）')
  if (enabledIdentityIds(settings).includes('prophet') && enabled.length < 6) errors.push('启用预言家时至少需要启用 6 个身份')
  if (settings.merchantAuctionLimit < 1 || settings.merchantAuctionLimit > 5) errors.push('商人拍卖次数应为 1–5 次')
  const investorMultiplierSteps = settings.investorDividendMultiplier * 20
  if (!Number.isFinite(settings.investorDividendMultiplier) || settings.investorDividendMultiplier < 1 || settings.investorDividendMultiplier > 3 || Math.abs(investorMultiplierSteps - Math.round(investorMultiplierSteps)) > 1e-8) errors.push('投资者分红倍率应为 1–3，且按 0.05 递增')
  const limits = [settings.prophetDivinationLimit, settings.reverserActivationLimit, settings.lobbyistActivationLimit, settings.nightwalkerUseLimit]
  if (limits.some((limit) => !Number.isInteger(limit) || limit < 1 || limit > 12)) errors.push('主动身份技能次数应为 1–12 次')
  if (!Number.isInteger(settings.thiefMaxSteals) || (settings.thiefMaxSteals ?? 0) < 0 || (settings.thiefMaxSteals ?? 0) > 12) errors.push('小偷偷卡上限应为 0–12 张')
  return errors
}

export function createPlayerIdentity(id: IdentityId, config: { targetPlayerId?: string; collectorCategory?: AssetCategory } = {}): PlayerIdentity {
  return { id, ...config, thiefSuccesses: 0, merchantAuctionCount: 0, merchantLastAuctionRound: null, lobbyistNextFree: false, lobbyistLastIssuedRound: null, nightwalkerUses: 0, activeSkillUses: 0 }
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
