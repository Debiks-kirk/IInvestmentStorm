import { createCardDeck } from './cards'
import { normalizeItem } from './items'
import { getProphetIdentityProgress } from './prophet'
import { cloneSettings } from './presets'
import { dealIdentityChoices, enabledIdentityIds, normalizeIdentitySettings } from './identities'
import { emptyBotMemory } from './bots'
import type { CardId, GameHistoryEntry, GamePreset, GameSession, GameSettings, Player, ProphetDivination, RoundResult, SeatConfig } from './types'

const STORAGE_KEY = 'who-is-raising:session:v1'
const PRESETS_STORAGE_KEY = 'who-is-raising:presets:v1'
const HISTORY_STORAGE_KEY = 'who-is-raising:history:v1'
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
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.itemDeck) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26].includes(parsed.version ?? 0)) return null
    const migrated = migrateSession(parsed)
    const safeSession = migrated.phase === 'privateTurn' ? { ...migrated, phase: 'handoff' as const }
      : migrated.phase === 'identityDraft' ? { ...migrated, phase: 'identityHandoff' as const }
        : migrated.phase === 'auctionBid' ? { ...migrated, phase: 'auctionHandoff' as const }
          : migrated.phase === 'finalReceipt' || migrated.phase === 'finalReceiptHandoff' ? { ...migrated, phase: 'finalResult' as const, finalReceiptIndex: null, pendingIdentityNotices: migrated.pendingIdentityNotices.filter((notice) => notice.title !== '本轮拍品结果') }
          : migrated
    if (parsed.version !== 26 || migrated.phase !== safeSession.phase || parsed.settings?.systemAuctionCardsPerRound === undefined || parsed.settings?.turnTimeLimitSeconds === undefined || parsed.settings?.turnTimerEnabled === undefined || parsed.settings?.identitySettings?.identityChoiceCount === undefined || !Array.isArray(parsed.prophecyDeck) || !parsed.roundStartBalanceUnits || !Array.isArray(parsed.prophetDivinations) || !('pendingFateCoinUse' in parsed) || !Array.isArray(parsed.roundAuctions) || !parsed.prophetIdentityProgress || !('pendingKidnapNegotiation' in parsed) || !parsed.players.every((player) => player.controller?.kind !== 'bot' || (typeof player.botMemory?.behavior?.bankrollBias === 'number' && typeof player.botMemory?.behavior?.assetFocusBias === 'number' && typeof player.botMemory?.behavior?.assetMarketBias === 'number')) || (parsed.merchantAuction && !parsed.merchantAuction.source)) saveSession(safeSession)
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
    systemAuctionCardsPerRound: oldSettings.systemAuctionCardsPerRound ?? (session.tutorial?.kind === 'firstGame' ? 0 : 1),
    turnTimeLimitSeconds: Math.min(120, Math.max(5, oldSettings.turnTimeLimitSeconds ?? 20)),
    turnTimerEnabled: oldSettings.turnTimerEnabled ?? false,
    animationSpeed: oldSettings.animationSpeed ?? 'full',
    identitySettings: session.version === 4 || session.version === 5 || session.version === 6 || session.version === 7 || session.version === 8 || session.version === 9 || session.version === 10 || session.version === 11 || session.version === 12 || session.version === 13 || session.version === 14 || session.version === 15 || session.version === 16 || session.version === 17 || session.version === 18 || session.version === 19 || session.version === 20 || session.version === 21 || session.version === 22 || session.version === 23 || session.version === 24 || session.version === 25 || session.version === 26 ? normalizeIdentitySettings(oldSettings.identitySettings, true) : normalizeIdentitySettings(undefined, false),
  }
  const players: Player[] = (session.players ?? []).map((player) => {
    const legacy = player as Player
    const identity = legacy.identity
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
      ...(legacy.controller?.kind === 'bot' ? { botMemory: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}`), ...(legacy.botMemory ?? {}), behavior: { ...emptyBotMemory(`${session.id ?? 'legacy'}:${legacy.id}`).behavior, ...(legacy.botMemory?.behavior ?? {}) }, grudgeByPlayerId: { ...(legacy.botMemory?.grudgeByPlayerId ?? {}) }, decisionLog: [...(legacy.botMemory?.decisionLog ?? [])], recentBidUnits: [...(legacy.botMemory?.recentBidUnits ?? [])] } } : {}),
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
    assetAuctionResults: result.assetAuctionResults ?? [],
    passivityFeePlayerCount: result.passivityFeePlayerCount ?? 0,
    passivityFeePenalties: result.passivityFeePenalties ?? [],
  }))
  const originalCardDeck = [...(session.cardDeck ?? createCardDeck(settings.disabledCardIds))]
  const addNewCard = (deck: CardId[], cardId: CardId) => !settings.disabledCardIds.includes(cardId) && !players.some((player) => player.cardInventory.includes(cardId)) && !deck.includes(cardId) ? [...deck, cardId] : deck
  const cardDeck: CardId[] = (['reverseRank', 'fateCoin', 'bananaPeel', 'reflectShield', 'prizeReroll', 'legendaryLoot'] as CardId[])
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
  const migrated: GameSession = {
    ...(session as GameSession),
    version: 26,
    settings,
    players,
    itemDeck: (session.itemDeck ?? []).map((item) => normalizeItem(item)),
    prophecyDeck: (session.prophecyDeck ?? session.itemDeck ?? []).map((item) => normalizeItem(item)),
    roundStartBalanceUnits: { ...(session.roundStartBalanceUnits ?? Object.fromEntries(players.map((player) => [player.id, player.balanceUnits + (session.turns ?? []).filter((turn) => turn.playerId === player.id).reduce((sum, turn) => sum + turn.bidUnits, 0)]))) },
    pendingPrizeReroll: session.pendingPrizeReroll ? {
      ...session.pendingPrizeReroll,
      originalItem: normalizeItem(session.pendingPrizeReroll.originalItem),
      offeredItems: session.pendingPrizeReroll.offeredItems.map((item) => normalizeItem(item)),
    } : null,
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
  }
  return migrated
}

function isPreset(value: unknown): value is GamePreset {
  if (!value || typeof value !== 'object') return false
  const preset = value as Partial<GamePreset>
  return typeof preset.id === 'string' && typeof preset.name === 'string' && Array.isArray(preset.names) && Boolean(preset.settings)
}

function normalizePreset(preset: GamePreset): GamePreset {
  const seats: SeatConfig[] = (preset.seats?.length ? preset.seats : preset.names.map((name) => ({ name, controller: { kind: 'human' as const } }))).map((seat) => ({ name: seat.name, controller: seat.controller?.kind === 'bot' ? { kind: 'bot' as const, profileId: seat.controller.profileId, difficulty: seat.controller.difficulty } : { kind: 'human' as const } }))
  return { ...preset, names: seats.map((seat) => seat.name), seats, settings: cloneSettings(preset.settings) }
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
