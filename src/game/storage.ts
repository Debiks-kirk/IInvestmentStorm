import { createCardDeck } from './cards'
import { normalizeItem } from './items'
import { getProphetIdentityProgress } from './prophet'
import { cloneSettings } from './presets'
import { dealIdentityChoices, enabledIdentityIds, normalizeIdentitySettings } from './identities'
import { emptyBotMemory, normalizeBotStrategy, strategyForController } from './bots'
import type { AssetAuctionResult, CardAuctionResult, CardId, CustomBotProfile, GameHistoryEntry, GamePreset, GameSession, GameSettings, Player, ProphetDivination, RelayOperator, RelaySeatConfig, RoundResult, SeatConfig, SpectatorEvent } from './types'

const STORAGE_KEY = 'who-is-raising:session:v1'
const PRESETS_STORAGE_KEY = 'who-is-raising:presets:v1'
const HISTORY_STORAGE_KEY = 'who-is-raising:history:v1'
const CUSTOM_BOTS_STORAGE_KEY = 'who-is-raising:custom-bots:v1'
const HISTORY_LIMIT = 12

export function saveSession(session: GameSession): void {
  try {
    const next = { ...session, updatedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The game remains playable when storage is blocked or full.
  }
}

export function loadSession(): GameSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Omit<GameSession, 'version'>> & { version?: number }
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.itemDeck) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35].includes(parsed.version ?? 0)) return null
    const migrated = migrateSession(parsed)
    const safeSession = !migrated.spectatorMode && migrated.phase === 'privateTurn' ? { ...migrated, phase: 'handoff' as const }
      : !migrated.spectatorMode && migrated.phase === 'identityDraft' ? { ...migrated, phase: 'identityHandoff' as const }
        : !migrated.spectatorMode && migrated.phase === 'auctionBid' ? { ...migrated, phase: 'auctionHandoff' as const }
          : migrated.phase === 'finalReceipt' || migrated.phase === 'finalReceiptHandoff' ? { ...migrated, phase: 'finalResult' as const, finalReceiptIndex: null, pendingIdentityNotices: migrated.pendingIdentityNotices.filter((notice) => notice.title !== '本轮拍品结果') }
          : migrated
    if (parsed.version !== 35 || migrated.phase !== safeSession.phase || parsed.mode === undefined || parsed.relayMethod === undefined || parsed.settings?.systemAuctionCardsPerRound === undefined || parsed.settings?.turnTimeLimitSeconds === undefined || parsed.settings?.turnTimerEnabled === undefined || parsed.settings?.identitySettings?.identityChoiceCount === undefined || parsed.settings?.identitySettings?.investorDividendMultiplier === undefined || !Array.isArray(parsed.prophecyDeck) || !parsed.roundStartBalanceUnits || !Array.isArray(parsed.prophetDivinations) || !('pendingFateCoinUse' in parsed) || !Array.isArray(parsed.roundAuctions) || !parsed.prophetIdentityProgress || !('pendingKidnapNegotiation' in parsed) || !Array.isArray(parsed.pendingPrizeChanges) || !Array.isArray(parsed.merchantShops) || !Array.isArray(parsed.spectatorEvents) || !Array.isArray(parsed.pendingSpectatorEvents) || !Array.isArray(parsed.spectatorTakeoverPlayerIds) || !parsed.players.every((player) => player.controller?.kind !== 'bot' || (typeof player.botMemory?.behavior?.bankrollBias === 'number' && typeof player.botMemory?.behavior?.assetFocusBias === 'number' && Array.isArray(player.botMemory?.strategy?.identityPriority))) || (parsed.merchantAuction && !parsed.merchantAuction.source)) saveSession(safeSession)
    return safeSession
  } catch {
    return null
  }
}

function migrateSession(session: Partial<Omit<GameSession, 'version'>> & { version?: number }): GameSession {
  const oldSettings = session.settings as Partial<GameSettings>
  const settings: GameSettings = {
    playerCount: oldSettings.playerCount ?? session.players?.length ?? 3,
    rounds: oldSettings.rounds ?? 6,
    initialCoins: oldSettings.initialCoins ?? 30,
    rewardMultipliers: oldSettings.rewardMultipliers ?? [2, 1],
    correctPredictionMultiplier: oldSettings.correctPredictionMultiplier ?? 1,
    wrongPredictionMultiplier: oldSettings.wrongPredictionMultiplier ?? 1.5,
    revealBids: oldSettings.revealBids ?? false,
    revealBalanceLeader: oldSettings.revealBalanceLeader ?? false,
    cardGrantProbability: oldSettings.cardGrantProbability ?? 80,
    disabledCardIds: (oldSettings.disabledCardIds ?? []) as CardId[],
    // 已进行的旧存档不补插首轮竞购；新开局会由默认设置明确写入 true。
    systemAuctionCardsPerRound: oldSettings.systemAuctionCardsPerRound ?? (session.tutorial?.kind === 'firstGame' ? 0 : (oldSettings.playerCount === 10 ? 3 : 2)),
    turnTimeLimitSeconds: Math.min(120, Math.max(5, oldSettings.turnTimeLimitSeconds ?? 20)),
    turnTimerEnabled: oldSettings.turnTimerEnabled ?? false,
    animationSpeed: oldSettings.animationSpeed ?? 'full',
    identitySettings: (session.version ?? 0) >= 4 ? normalizeIdentitySettings(oldSettings.identitySettings, true) : normalizeIdentitySettings(undefined, false),
  }
  const mode = session.mode === 'relay' ? 'relay' as const : 'standard' as const
  const relayMethod = session.relayMethod === 'segments' ? 'segments' as const : 'rotation' as const
  const players: Player[] = (session.players ?? []).map((player) => {
    const legacy = player as Player
    const identity = legacy.identity
    const relayOperators: RelayOperator[] | undefined = mode === 'relay' && Array.isArray(legacy.relayOperators) && legacy.relayOperators.length > 0
      ? legacy.relayOperators.map((operator, index) => {
          const controller = operator.controller?.kind === 'bot' ? operator.controller : { kind: 'human' as const }
          return {
            id: typeof operator.id === 'string' ? operator.id : `${legacy.id}-operator-${index}`,
            name: typeof operator.name === 'string' && operator.name.trim() ? operator.name.trim() : `${legacy.name} 操作者 ${index + 1}`,
            controller,
            ...(controller.kind === 'bot' ? { botMemory: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}:${operator.id ?? index}`, strategyForController(controller)), ...(operator.botMemory ?? {}), behavior: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}:${operator.id ?? index}`).behavior, ...(operator.botMemory?.behavior ?? {}) }, strategy: normalizeBotStrategy(operator.botMemory?.strategy ?? (controller.profileId === 'custom' ? controller.customProfile : undefined), controller.profileId), grudgeByPlayerId: { ...(operator.botMemory?.grudgeByPlayerId ?? {}) }, decisionLog: [...(operator.botMemory?.decisionLog ?? [])], recentBidUnits: [...(operator.botMemory?.recentBidUnits ?? [])] } } : {}),
          }
        })
      : undefined
    return {
      ...legacy,
      items: (legacy.items ?? []).map((won) => ({ ...won, item: normalizeItem(won.item) })),
      cardInventory: [...(legacy.cardInventory ?? [])],
      passivityFeeCount: legacy.passivityFeeCount ?? 0,
      identity: identity ? {
        id: identity.id,
        targetPlayerId: identity.targetPlayerId,
        collectorCategory: identity.collectorCategory,
        thiefSuccesses: identity.thiefSuccesses ?? 0,
        merchantAuctionCount: identity.merchantAuctionCount ?? (identity.merchantAuctionUsed ? 1 : 0),
        merchantLastAuctionRound: identity.merchantLastAuctionRound ?? null,
        lobbyistNextFree: identity.lobbyistNextFree ?? false,
        lobbyistLastIssuedRound: identity.lobbyistLastIssuedRound ?? null,
        nightwalkerUses: identity.nightwalkerUses ?? 0,
        activeSkillUses: identity.activeSkillUses ?? 0,
        reverserFreeRoundIndex: identity.reverserFreeRoundIndex ?? null,
        kidnapFreeRoundIndex: identity.kidnapFreeRoundIndex ?? null,
      } : undefined,
      controller: legacy.controller?.kind === 'bot' ? legacy.controller : { kind: 'human' },
      ...(relayOperators ? { relayOperators } : {}),
      ...(legacy.controller?.kind === 'bot' ? { botMemory: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}`, strategyForController(legacy.controller)), ...(legacy.botMemory ?? {}), behavior: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}`).behavior, ...(legacy.botMemory?.behavior ?? {}) }, strategy: normalizeBotStrategy(legacy.botMemory?.strategy ?? (legacy.controller.profileId === 'custom' ? legacy.controller.customProfile : undefined), legacy.controller.profileId), grudgeByPlayerId: { ...(legacy.botMemory?.grudgeByPlayerId ?? {}) }, decisionLog: [...(legacy.botMemory?.decisionLog ?? [])], recentBidUnits: [...(legacy.botMemory?.recentBidUnits ?? [])] } } : {}),
    }
  })
  const results = ((session.results ?? []) as RoundResult[]).map((result) => ({
    ...result,
    turns: result.turns.map((turn) => ({ ...turn, cardUses: [...(turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : []))] })),
    item: normalizeItem(result.item),
    redistributionTransferUnits: result.redistributionTransferUnits ?? null,
    autoConsumedCardIds: result.autoConsumedCardIds ?? [],
    identityEvents: result.identityEvents ?? [],
    deltas: result.deltas.map((delta) => ({ ...delta, publicPredictionUnits: delta.publicPredictionUnits ?? delta.predictionUnits })),
    totalAssetUnitsAfter: result.totalAssetUnitsAfter ?? result.balancesAfter ?? {},
    rankingReversalCount: result.rankingReversalCount ?? 0,
    itemWinnerId: result.itemWinnerId ?? result.winnerId ?? null,
    nightwalkerOutcomes: result.nightwalkerOutcomes ?? [],
    investments: result.investments ?? [],
    cardAuctionResults: Array.isArray(result.cardAuctionResults) ? result.cardAuctionResults.map((entry) => ({ ...entry, winningBidUnits: entry.winningBidUnits ?? null } as CardAuctionResult)) : [],
    assetAuctionResults: Array.isArray(result.assetAuctionResults) ? result.assetAuctionResults.map((entry) => ({ ...entry, winningBidUnits: entry.winningBidUnits ?? null } as AssetAuctionResult)) : [],
    passivityFeePlayerCount: result.passivityFeePlayerCount ?? 0,
    passivityFeePenalties: result.passivityFeePenalties ?? [],
  }))
  const originalCardDeck = [...(session.cardDeck ?? createCardDeck(settings.disabledCardIds))]
  const addNewCard = (deck: CardId[], cardId: CardId) => !settings.disabledCardIds.includes(cardId) && !players.some((player) => player.cardInventory.includes(cardId)) && !deck.includes(cardId) ? [...deck, cardId] : deck
  const cardDeck: CardId[] = (['reverseRank', 'fateCoin', 'bananaPeel', 'reflectShield', 'prizeReroll', 'legendaryLoot', 'prizeSwap'] as CardId[])
    .reduce((deck, cardId) => addNewCard(deck, cardId), originalCardDeck)
  const normalizeAssetLots = (lots: GameSession['pendingAssetAuctions'] | undefined) => [...(lots ?? [])].map((lot) => ({ ...lot, item: normalizeItem(lot.item) }))
  const pendingAssetAuctions = normalizeAssetLots(session.pendingAssetAuctions)
  const roundAssetAuctions = normalizeAssetLots(session.roundAssetAuctions)
  // v22 treats a listed asset auction as system custody. Older saves still leave
  // the item in its seller's collection, so remove that stale duplicate once.
  for (const lot of [...pendingAssetAuctions, ...roundAssetAuctions]) {
    const seller = players.find((player) => player.id === lot.sellerId)
    const itemIndex = seller?.items.findIndex((won) => won.item.id === lot.item.id && won.roundIndex === lot.itemRoundIndex) ?? -1
    if (seller && itemIndex >= 0) seller.items.splice(itemIndex, 1)
  }
  const normalizePendingPrizeChange = (pending: NonNullable<GameSession['pendingPrizeReroll']>) => ({
    ...pending,
    cardId: pending.cardId ?? 'prizeReroll',
    targetRoundIndex: pending.targetRoundIndex ?? pending.roundIndex + 1,
    confirmedItemId: pending.confirmedItemId ?? pending.chosenItemId,
    originalItem: normalizeItem(pending.originalItem),
    offeredItems: pending.offeredItems.map((item) => normalizeItem(item)),
  })
  const pendingPrizeChanges = Array.isArray(session.pendingPrizeChanges)
    ? session.pendingPrizeChanges.map(normalizePendingPrizeChange)
    : session.pendingPrizeReroll ? [normalizePendingPrizeChange(session.pendingPrizeReroll)] : []
  const spectatorMode = session.spectatorMode ?? (players.length > 0 && players.every((player) => (player.relayOperators?.length ? player.relayOperators : [{ controller: player.controller }]).every((operator) => operator.controller?.kind === 'bot')))
  const existingSpectatorEvents = Array.isArray(session.spectatorEvents) ? session.spectatorEvents as SpectatorEvent[] : []
  const reconstructedEvents: SpectatorEvent[] = existingSpectatorEvents.length > 0 ? existingSpectatorEvents : results.map((result, index) => ({
    id: `spectator-migrated-result-${result.roundIndex}`,
    sequence: index,
    roundIndex: result.roundIndex,
    type: 'roundResult',
    summary: `第 ${result.roundIndex + 1} 轮结算完成`,
    details: [`总下注 ${result.totalBidUnits / 2} 金币`, result.itemWinnerId ? '拍品已有归属' : '拍品流拍'],
  }))
  const migrated: GameSession = {
    ...(session as GameSession),
    version: 35,
    mode,
    relayMethod,
    settings,
    players,
    itemDeck: (session.itemDeck ?? []).map((item) => normalizeItem(item)),
    prophecyDeck: (session.prophecyDeck ?? session.itemDeck ?? []).map((item) => normalizeItem(item)),
    roundStartBalanceUnits: { ...(session.roundStartBalanceUnits ?? Object.fromEntries(players.map((player) => [player.id, player.balanceUnits + (session.turns ?? []).filter((turn) => turn.playerId === player.id).reduce((sum, turn) => sum + turn.bidUnits, 0)]))) },
    pendingPrizeReroll: null,
    pendingPrizeChanges,
    pendingFateCoinUse: session.pendingFateCoinUse && session.pendingFateCoinUse.use?.cardId === 'fateCoin'
      ? { ...session.pendingFateCoinUse, use: { ...session.pendingFateCoinUse.use } }
      : null,
    results,
    turns: (session.turns ?? []).map((turn) => ({ ...turn, cardUses: [...(turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : []))] })),
    cardDeck,
    pendingCardGrants: [...(session.pendingCardGrants ?? [])],
    identityAvailableIds: enabledIdentityIds(settings.identitySettings),
    identityDraft: session.identityDraft ?? (settings.identitySettings.enabled && (session.roundIndex ?? 0) === 0 && !players.some((player) => player.identity) ? { playerIndex: 0, choiceIds: dealIdentityChoices([], settings.identitySettings) } : null),
    pendingIdentityCardAwards: [...(session.pendingIdentityCardAwards ?? [])],
    pendingIdentityNotices: [...(session.pendingIdentityNotices ?? [])],
    identityContracts: [...(session.identityContracts ?? [])].map((contract) => ({ ...contract, specified: contract.specified ?? true })),
    identityEvents: [...(session.identityEvents ?? [])],
    prophetDivinations: [...(session.prophetDivinations ?? [])].map((entry) => ({ ...entry, identityGuesses: entry.identityGuesses ? [...entry.identityGuesses] : undefined })) as ProphetDivination[],
    merchantAuction: session.merchantAuction ? {
      ...session.merchantAuction,
      source: session.merchantAuction.source ?? 'merchant',
      merchantId: session.merchantAuction.merchantId ?? null,
    } : null,
    auctionQueue: [...(session.auctionQueue ?? [])].map((auction) => ({ ...auction, source: auction.source ?? 'merchant', merchantId: auction.merchantId ?? null })),
    roundAuctions: [...(session.roundAuctions ?? [])],
    pendingAssetAuctions,
    roundAssetAuctions,
    pendingMerchantOffers: [...(session.pendingMerchantOffers ?? [])],
    merchantShops: [...(session.merchantShops ?? [])].map((shop) => ({ ...shop, cards: [...(shop.cards ?? [])].filter((entry): entry is { cardId: CardId; priceUnits: number } => typeof entry?.cardId === 'string' && Number.isInteger(entry?.priceUnits) && entry.priceUnits > 0) })),
    prophetIdentityCandidates: { ...(session.prophetIdentityCandidates ?? {}) },
    prophetIdentityProgress: Object.fromEntries(players.filter((player) => player.identity?.id === 'prophet').map((prophet) => [prophet.id, Object.fromEntries(players.filter((target) => target.id !== prophet.id).map((target) => [target.id, getProphetIdentityProgress((session.prophetDivinations ?? []) as ProphetDivination[], prophet.id, target.id, session.prophetIdentityProgress?.[prophet.id]?.[target.id])]))])),
    pendingProphetCardOffers: [...(session.pendingProphetCardOffers ?? [])],
    pendingKidnapCardOffers: [...(session.pendingKidnapCardOffers ?? [])],
    pendingKidnapNegotiation: session.pendingKidnapNegotiation ? {
      ...session.pendingKidnapNegotiation,
      item: normalizeItem(session.pendingKidnapNegotiation.item),
      players: session.pendingKidnapNegotiation.players.map((player) => ({ ...player, items: player.items.map((won) => ({ ...won, item: normalizeItem(won.item) })), cardInventory: [...player.cardInventory] })),
      result: {
        ...session.pendingKidnapNegotiation.result,
        item: normalizeItem(session.pendingKidnapNegotiation.result.item),
        kidnapAttempt: session.pendingKidnapNegotiation.result.kidnapAttempt,
      },
      identityContracts: [...session.pendingKidnapNegotiation.identityContracts],
      identityEvents: [...session.pendingKidnapNegotiation.identityEvents],
      cardDeck: [...session.pendingKidnapNegotiation.cardDeck],
      pendingIdentityNotices: [...session.pendingKidnapNegotiation.pendingIdentityNotices],
    } : null,
    finalReceiptIndex: session.finalReceiptIndex ?? null,
    operationDeadlineAt: settings.turnTimerEnabled && typeof session.operationDeadlineAt === 'number' ? session.operationDeadlineAt : null,
    cardRulesStartRound: session.cardRulesStartRound ?? Math.max((session.roundIndex ?? 0) + 1, 1),
    spectatorMode,
    spectatorEvents: reconstructedEvents,
    pendingSpectatorEvents: Array.isArray(session.pendingSpectatorEvents) ? session.pendingSpectatorEvents as SpectatorEvent[] : [],
    spectatorTakeoverPlayerIds: Array.isArray(session.spectatorTakeoverPlayerIds) ? session.spectatorTakeoverPlayerIds.filter((id): id is string => typeof id === 'string' && players.some((player) => player.id === id)) : [],
    spectatorTakeoverRoundIndex: typeof session.spectatorTakeoverRoundIndex === 'number' ? session.spectatorTakeoverRoundIndex : null,
  }
  return migrated
}

function isPreset(value: unknown): value is GamePreset {
  if (!value || typeof value !== 'object') return false
  const preset = value as Partial<GamePreset>
  return typeof preset.id === 'string' && typeof preset.name === 'string' && Array.isArray(preset.names) && Boolean(preset.settings)
}

/** Accept old slider-based templates while saving only the current ordered format. */
function cloneCustomBotProfile(profile: CustomBotProfile): CustomBotProfile {
  const legacy = profile as CustomBotProfile & { identityTactics?: Record<string, number> }
  const { identityTactics: _legacyTactics, ...metadata } = legacy
  const strategy = normalizeBotStrategy(legacy)
  return { ...metadata, ...strategy, identityPriority: [...strategy.identityPriority] }
}

function normalizePreset(preset: GamePreset): GamePreset {
  const seats: SeatConfig[] = (preset.seats?.length ? preset.seats : preset.names.map((name) => ({ name, controller: { kind: 'human' as const } }))).map((seat) => ({ name: seat.name, controller: seat.controller?.kind === 'bot' ? { kind: 'bot' as const, profileId: seat.controller.profileId, difficulty: seat.controller.difficulty, ...(seat.controller.profileId === 'custom' && seat.controller.customProfile ? { customProfile: cloneCustomBotProfile(seat.controller.customProfile) } : {}) } : { kind: 'human' as const } }))
  const relaySeats: RelaySeatConfig[] | undefined = preset.mode === 'relay' && Array.isArray(preset.relaySeats) && preset.relaySeats.length === seats.length
    ? preset.relaySeats.map((seat, seatIndex) => ({
        name: typeof seat.name === 'string' ? seat.name.slice(0, 12) : seats[seatIndex].name,
        operators: Array.isArray(seat.operators) && seat.operators.length ? seat.operators.map((operator, operatorIndex) => ({
          id: typeof operator.id === 'string' ? operator.id : `preset-${preset.id}-${seatIndex}-${operatorIndex}`,
          name: typeof operator.name === 'string' && operator.name.trim() ? operator.name.slice(0, 12) : `操作者 ${operatorIndex + 1}`,
          controller: operator.controller?.kind === 'bot' ? { ...operator.controller, ...(operator.controller.profileId === 'custom' && operator.controller.customProfile ? { customProfile: cloneCustomBotProfile(operator.controller.customProfile) } : {}) } : { kind: 'human' as const },
        })) : [{ id: `preset-${preset.id}-${seatIndex}-0`, name: seats[seatIndex].name, controller: seats[seatIndex].controller }],
      }))
    : undefined
  return { ...preset, names: seats.map((seat) => seat.name), seats, settings: cloneSettings(preset.settings), mode: relaySeats ? 'relay' : 'standard', relayMethod: preset.relayMethod === 'segments' ? 'segments' : 'rotation', ...(relaySeats ? { relaySeats } : {}) }
}

export function loadPresets(): GamePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: number; presets?: unknown }
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.presets)) return []
    return parsed.presets.filter(isPreset).map(normalizePreset)
  } catch {
    return []
  }
}

export function savePresets(presets: GamePreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify({ version: 2, presets }))
  } catch {
    // Presets remain usable for the current setup form when storage is unavailable.
  }
}

function isCustomBotProfile(value: unknown): value is CustomBotProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<CustomBotProfile>
  return typeof profile.id === 'string' && typeof profile.name === 'string' && (Array.isArray(profile.identityPriority) || Boolean((profile as { identityTactics?: unknown }).identityTactics))
}

/** Reusable custom Bot templates are kept separately from game presets. */
export function loadCustomBotProfiles(): CustomBotProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_BOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: number; profiles?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) return []
    return parsed.profiles.filter(isCustomBotProfile).map((profile) => ({ ...cloneCustomBotProfile(profile), name: profile.name.slice(0, 20) })).slice(0, 24)
  } catch {
    return []
  }
}

export function saveCustomBotProfiles(profiles: CustomBotProfile[]): void {
  try {
    localStorage.setItem(CUSTOM_BOTS_STORAGE_KEY, JSON.stringify({ version: 1, profiles: profiles.slice(0, 24) }))
  } catch {
    // A blocked storage area must not prevent the current setup from working.
  }
}

function isHistoryEntry(value: unknown): value is GameHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<GameHistoryEntry>
  return typeof entry.id === 'string'
    && typeof entry.completedAt === 'string'
    && Boolean(entry.session)
    && entry.session?.phase === 'finalResult'
    && Array.isArray(entry.session.players)
    && Array.isArray(entry.session.results)
}

/** Reads archived final games without touching the active-game save. */
export function loadGameHistory(): GameHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: number; entries?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isHistoryEntry).slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function saveGameHistory(entries: GameHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: 1, entries: entries.slice(0, HISTORY_LIMIT) }))
  } catch {
    // A full or blocked storage area must not interrupt the completed game.
  }
}

/** Inserts or updates one completed session while retaining the original completion time. */
export function archiveGameHistory(entries: GameHistoryEntry[], session: GameSession, completedAt = new Date().toISOString()): GameHistoryEntry[] {
  if (session.phase !== 'finalResult') return entries
  const previous = entries.find((entry) => entry.id === session.id)
  const snapshot = JSON.parse(JSON.stringify(session)) as GameSession
  return [{ id: session.id, completedAt: previous?.completedAt ?? completedAt, session: snapshot }, ...entries.filter((entry) => entry.id !== session.id)].slice(0, HISTORY_LIMIT)
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
