import { shuffle } from './items'
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
  { id: 'prophet', name: '预言家', symbol: '◌', summary: '每轮偷看下一轮拍品。', repeatable: true },
  { id: 'gambler', name: '赌徒', symbol: '♠', summary: '猜中多赚；猜错或跳过会扣钱。', repeatable: true },
  { id: 'assassin', name: '刺客', symbol: '✦', summary: '下注压过目标就领奖励。', repeatable: true, needsTarget: true },
  { id: 'collector', name: '收藏家', symbol: '▣', summary: '选一类资产，永久多算 1 件。', repeatable: true, needsCategory: true },
  { id: 'thief', name: '小偷', symbol: '◒', summary: '有机会偷走目标新获得的道具。', repeatable: true, needsTarget: true },
  { id: 'merchant', name: '道具商人', symbol: '◇', summary: '初始拿卡，并可发起一次竞购。', repeatable: true, needsMerchantCard: true },
  { id: 'reverser', name: '逆转者', symbol: '↻', summary: '花钱把本轮获奖区名次倒过来。', repeatable: false },
  { id: 'lobbyist', name: '说客', symbol: '✉', summary: '给别人发随机任务；加钱可指定。', repeatable: true },
]

export function getIdentityDefinition(id: IdentityId): IdentityDefinition {
  return IDENTITY_DEFINITIONS.find((identity) => identity.id === id) as IdentityDefinition
}

export function identitySkillMode(id: IdentityId): 'active' | 'passive' {
  return id === 'merchant' || id === 'reverser' || id === 'lobbyist' ? 'active' : 'passive'
}

export function defaultIdentitySettings(enabled = true): IdentitySettings {
  return {
    enabled,
    disabledIdentityIds: [],
    gamblerCorrectBonusMultiplier: 0.5,
    gamblerSkipPenaltyMultiplier: 0.5,
    reverserActivationCoins: 6,
    assassinSuccessCoins: 4,
    assassinFailureCoins: 2,
    thiefSuccessProbability: 50,
    thiefMaxSteals: 2,
    merchantInitialOfferCount: 3,
    lobbyistFirstRoundFree: true,
    lobbyistFeeCoins: 5,
    lobbyistSpecifiedTaskFeeCoins: 5,
    lobbyistFailurePaymentCoins: 3,
  }
}

export function normalizeIdentitySettings(value: Partial<IdentitySettings> | undefined, enabled = false): IdentitySettings {
  const defaults = defaultIdentitySettings(enabled)
  return { ...defaults, ...value, gamblerSkipPenaltyMultiplier: value?.gamblerSkipPenaltyMultiplier ?? defaults.gamblerSkipPenaltyMultiplier, reverserActivationCoins: value?.reverserActivationCoins ?? defaults.reverserActivationCoins, lobbyistSpecifiedTaskFeeCoins: value?.lobbyistSpecifiedTaskFeeCoins ?? defaults.lobbyistSpecifiedTaskFeeCoins, disabledIdentityIds: [...(value?.disabledIdentityIds ?? defaults.disabledIdentityIds)] }
}

export function enabledIdentityIds(settings: IdentitySettings): IdentityId[] {
  const disabled = new Set(settings.disabledIdentityIds)
  return IDENTITY_DEFINITIONS.filter((identity) => !disabled.has(identity.id)).map((identity) => identity.id)
}

export function repeatableIdentityIds(settings: IdentitySettings): IdentityId[] {
  const enabled = new Set(enabledIdentityIds(settings))
  return IDENTITY_DEFINITIONS.filter((identity) => identity.repeatable && enabled.has(identity.id)).map((identity) => identity.id)
}

export function dealIdentityChoices(availableIds: IdentityId[], settings: IdentitySettings): IdentityId[] {
  const choices = shuffle(availableIds).slice(0, 2)
  if (choices.length >= 2) return choices
  const repeats = shuffle(repeatableIdentityIds(settings).filter((id) => !choices.includes(id)))
  return [...choices, ...repeats.slice(0, 2 - choices.length)]
}

export function identityValidationErrors(settings: IdentitySettings, playerCount: number): string[] {
  if (!settings.enabled) return []
  const enabled = enabledIdentityIds(settings)
  const repeatable = repeatableIdentityIds(settings)
  const errors: string[] = []
  if (enabled.length < 2) errors.push('身份系统至少需要启用 2 个身份')
  if (playerCount > enabled.length && repeatable.length < 2) errors.push('身份卡不足时至少需要启用 2 个可重复身份')
  if (settings.thiefSuccessProbability < 0 || settings.thiefSuccessProbability > 100) errors.push('小偷成功率应为 0–100%')
  if (settings.thiefMaxSteals < 0 || settings.thiefMaxSteals > 10) errors.push('小偷上限应为 0–10 次')
  if (settings.merchantInitialOfferCount < 1 || settings.merchantInitialOfferCount > 6) errors.push('商人初始选卡数量应为 1–6')
  return errors
}

export function createPlayerIdentity(id: IdentityId, config: { targetPlayerId?: string; collectorCategory?: AssetCategory } = {}): PlayerIdentity {
  return { id, ...config, thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
}

export function taskLabel(type: LobbyistTaskType): string {
  return { outbid: '下注高于指定玩家', underbid: '下注低于指定玩家', avoidPrize: '不进入获奖区', winFirst: '拿到第一名' }[type]
}

export function randomLobbyistTask(playerIds: string[], targetPlayerId: string, roll = Math.random): { taskType: LobbyistTaskType; comparisonPlayerId?: string } {
  const taskTypes: LobbyistTaskType[] = ['outbid', 'underbid', 'avoidPrize', 'winFirst']
  const taskType = taskTypes[Math.min(taskTypes.length - 1, Math.floor(roll() * taskTypes.length))]
  if (taskType !== 'outbid' && taskType !== 'underbid') return { taskType }
  const comparisonIds = playerIds.filter((id) => id !== targetPlayerId)
  if (comparisonIds.length === 0) return { taskType: 'avoidPrize' }
  return { taskType, comparisonPlayerId: comparisonIds[Math.min(comparisonIds.length - 1, Math.floor(roll() * comparisonIds.length))] }
}

export function routeCardAwards({
  players,
  awards,
  settings,
  fairnessOrderIds,
  roundIndex,
  roll = Math.random,
}: {
  players: Player[]
  awards: Array<{ playerId: string; cardId: CardId }>
  settings: IdentitySettings
  fairnessOrderIds: string[]
  roundIndex: number
  roll?: () => number
}): { players: Player[]; notices: IdentityNotice[]; events: IdentityEvent[]; delivered: Array<{ playerId: string; cardId: CardId }> } {
  const nextPlayers = players.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
  const notices: IdentityNotice[] = []
  const events: IdentityEvent[] = []
  const delivered: Array<{ playerId: string; cardId: CardId }> = []
  const fair = new Map(fairnessOrderIds.map((id, index) => [id, index]))
  for (const award of awards) {
    const candidates = nextPlayers.filter((player) => player.identity?.id === 'thief' && player.identity.targetPlayerId === award.playerId && (player.identity.thiefSuccesses < settings.thiefMaxSteals) && roll() < settings.thiefSuccessProbability / 100)
      .sort((left, right) => ((fair.get(left.id) ?? 999) + roundIndex) - ((fair.get(right.id) ?? 999) + roundIndex))
    const thief = candidates[0]
    if (thief?.identity) {
      thief.identity.thiefSuccesses += 1
      thief.cardInventory.push(award.cardId)
      notices.push({ id: `stolen-${roundIndex}-${award.playerId}-${award.cardId}`, playerId: award.playerId, title: '你的道具被偷走了', detail: '有人截走了你本应获得的一张道具卡。' })
      notices.push({ id: `gain-${roundIndex}-${thief.id}-${award.cardId}`, playerId: thief.id, title: '偷到一张道具卡', detail: '这张卡已秘密加入你的道具库存。' })
      events.push({ playerId: thief.id, identityId: 'thief', roundIndex, title: '成功偷取道具', detail: `从目标处获得 ${award.cardId}。`, deltaUnits: 0 })
    } else {
      const recipient = nextPlayers.find((player) => player.id === award.playerId)
      if (recipient) {
        recipient.cardInventory.push(award.cardId)
        delivered.push(award)
      }
    }
  }
  return { players: nextPlayers, notices, events, delivered }
}

export function cloneContracts(contracts: LobbyistContract[]): LobbyistContract[] {
  return contracts.map((contract) => ({ ...contract }))
}
