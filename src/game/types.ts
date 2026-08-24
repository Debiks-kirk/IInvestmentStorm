export type GamePhase =
  | 'identityHandoff'
  | 'identityDraft'
  | 'auctionIntro'
  | 'auctionHandoff'
  | 'auctionBid'
  | 'roundIntro'
  | 'handoff'
  | 'privateTurn'
  | 'revealReady'
  | 'roundResult'
  | 'finalReceiptHandoff'
  | 'finalReceipt'
  | 'finalResult'

export type AnimationSpeed = 'full' | 'fast' | 'reduced'

export type BotDifficulty = 'easy' | 'standard' | 'expert'
export type BotProfileId = 'steady' | 'aggressive' | 'collectorBot' | 'observer' | 'revenge' | 'cards' | 'identityBot' | 'comeback' | 'blocker' | 'adaptive'
export type StrategyMode = 'value' | 'conserve' | 'collect' | 'pressure' | 'revenge' | 'cards' | 'identity' | 'comeback' | 'finalSprint'

export type PlayerController =
  | { kind: 'human' }
  | { kind: 'bot'; profileId: BotProfileId; difficulty: BotDifficulty }

export interface BotMemory {
  grudgeByPlayerId: Record<string, number>
  lastMode: StrategyMode | null
  decisionLog: BotDecisionRecord[]
  /** Per-game latent traits keep same-profile bots coherent without making them identical. */
  behavior: BotBehavior
  recentBidUnits: number[]
}

export interface BotBehavior {
  reserveBias: number
  /** Per-game appetite for keeping a playable cash buffer. */
  bankrollBias: number
  /** How strongly this bot commits to item-category combinations. */
  assetFocusBias: number
  edgeBias: number
  riskBias: number
  antiLeaderBias: number
  predictionBias: number
  cardBias: number
  quoteFingerprint: number
}

export interface BotDecisionRecord {
  stage: 'identity' | 'turn' | 'merchantAuction'
  roundIndex: number
  mode: StrategyMode
  reason: string
  intel?: string
  /** Half-coin bid saved only for the bot's private long-term style memory. */
  bidUnits?: number
}

export interface SeatConfig {
  name: string
  controller: PlayerController
}

export type CardId = 'red' | 'peek' | 'swap' | 'redistribute' | 'doubleBid' | 'black' | 'reverseRank' | 'fateCoin' | 'bananaPeel' | 'reflectShield' | 'prizeReroll' | 'legendaryLoot'

export type IdentityId = 'prophet' | 'gambler' | 'assassin' | 'collector' | 'thief' | 'merchant' | 'reverser' | 'lobbyist' | 'nightwalker' | 'investor'
export type LobbyistTaskType = 'outbid' | 'underbid' | 'avoidPrize' | 'winFirst' | 'winSecond' | 'bidZero'

export type AssetCategory = 'leisure' | 'transport' | 'luxury' | 'property'

export interface CardUse {
  cardId: CardId
  targetPlayerId?: string
  coinResult?: 'heads' | 'tails'
  /** 命运硬币在私密操作时已立即结算的实际变动，回合结算仅用于展示。 */
  fateDeltaUnits?: number
  prizeReroll?: {
    originalItemId: string
    offeredItemIds: string[]
    chosenItemId: string
  }
}

export interface CardGrant {
  playerId: string
  cardId: CardId
  announced: boolean
}

export interface CardEffect {
  cardId?: CardId
  symbol?: string
  description: string
  /** Used only by end-of-game storytelling; never changes settlement. */
  impactUnits?: number
  actorPlayerId?: string
}

export interface GameSettings {
  playerCount: number
  rounds: number
  initialCoins: number
  rewardMultipliers: number[]
  correctPredictionMultiplier: number
  wrongPredictionMultiplier: number
  revealBids: boolean
  revealBalanceLeader: boolean
  cardGrantProbability: number
  disabledCardIds: CardId[]
  /** 首轮在拍品抽取前由系统发起一张公开道具的秘密竞购。 */
  /** System card-auction lots added to every non-final round; zero disables them. */
  systemAuctionCardsPerRound: number
  /** 在后半中点的拍品抽取前追加一次系统道具竞购。 */
  /** 真人竞拍与竞购的单次私密操作时限（秒）。 */
  turnTimeLimitSeconds: number
  /** 默认关闭；开启后才对真人竞拍与竞购启用操作时限。 */
  turnTimerEnabled: boolean
  identitySettings: IdentitySettings
  animationSpeed: AnimationSpeed
}

export interface IdentitySettings {
  enabled: boolean
  disabledIdentityIds: IdentityId[]
  /** Number of distinct identity cards each player may choose from at setup. */
  identityChoiceCount: number
  gamblerCorrectBonusMultiplier: number
  gamblerWrongPenaltyMultiplier: number
  gamblerSkipPenaltyMultiplier: number
  prophetDivinationCoins: number
  reverserActivationCoins: number
  kidnapActivationCoins: number
  thiefActivationCoins: number
  thiefSuccessProbability: number
  /** Retained only so legacy saves can be read; active thieves no longer use a success cap. */
  thiefMaxSteals?: number
  merchantInitialOfferCount: number
  merchantAuctionLimit: number
  /** Per-game limits for active identity skills; passive identities are unaffected. */
  prophetDivinationLimit: number
  kidnapActivationLimit: number
  thiefActivationLimit: number
  reverserActivationLimit: number
  lobbyistActivationLimit: number
  nightwalkerUseLimit: number
  lobbyistFirstRoundFree: boolean
  lobbyistFeeCoins: number
  lobbyistSpecifiedTaskFeeCoins: number
  lobbyistFailurePaymentCoins: number
}

export interface AuctionLot {
  id: string
  source: 'system' | 'merchant'
  merchantId: string | null
  cardId: CardId
  roundIndex: number
}

export interface AuctionBid {
  lotId: string
  bidUnits: number
}

export interface AssetAuctionLot {
  id: string
  sellerId: string
  item: Item
  itemRoundIndex: number
  minimumBidUnits: number
  roundIndex: number
}

export interface AssetAuctionResult {
  lotId: string
  item: Item
  sellerId: string
  winnerId: string | null
}

export type ProphetDivinationMode = 'wealth' | 'stars' | 'identity'

export interface ProphetDivination {
  id: string
  playerId: string
  roundIndex: number
  mode: ProphetDivinationMode
  costUnits: number
  wealth?: { highestRangeUnits: [number, number]; lowestRangeUnits: [number, number] }
  starItemIds?: string[]
  identityGuess?: { targetPlayerId: string; identityId: IdentityId; correct: boolean; rewardCardId?: CardId }
  identityGuesses?: Array<{ targetPlayerId: string; identityId: IdentityId; correct: boolean; rewardCardId?: CardId }>
}

/** Durable per-target progress. This is deliberately separate from the replay log so old guesses cannot reappear after a UI rerender or migration. */
export interface ProphetIdentityProgress {
  excludedIdentityIds: IdentityId[]
  solvedIdentityId?: IdentityId
}

export interface PlayerIdentity {
  id: IdentityId
  targetPlayerId?: string
  collectorCategory?: AssetCategory
  thiefSuccesses: number
  /** Legacy save compatibility. New sessions use merchantAuctionCount. */
  merchantAuctionUsed?: boolean
  merchantAuctionCount?: number
  merchantLastAuctionRound?: number | null
  lobbyistNextFree: boolean
  lobbyistLastIssuedRound: number | null
  /** Nightwalker can set two secret bids twice per game. */
  nightwalkerUses?: number
  activeSkillUses?: number
  /** Earned by winning with an inversion; usable only on the stated next round. */
  reverserFreeRoundIndex?: number | null
  /** Earned by a successful kidnap; usable only on the stated next round. */
  kidnapFreeRoundIndex?: number | null
  /** A successful kidnap awards one private card at the start of the next round. */
  pendingKidnapReward?: boolean
}

export interface IdentityDraftState {
  playerIndex: number
  choiceIds: IdentityId[]
  selectedIdentityId?: IdentityId
  merchantCardOfferIds?: CardId[]
}

export interface IdentityNotice {
  id: string
  playerId: string
  title: string
  detail: string
}

export interface IdentityEvent {
  playerId: string
  identityId: IdentityId
  roundIndex: number | null
  title: string
  detail: string
  deltaUnits: number
}

export interface LobbyistContract {
  id: string
  issuerId: string
  targetPlayerId: string
  taskType: LobbyistTaskType
  comparisonPlayerId?: string
  issuedRoundIndex: number
  executeRoundIndex: number
  specified: boolean
  status: 'pending' | 'success' | 'failed'
  paymentUnits: number
}

export interface MerchantAuction {
  source: 'merchant' | 'system'
  /** 系统竞购没有收款玩家，赢家的报价直接离开本局现金。 */
  merchantId: string | null
  cardId: CardId
  roundIndex: number
  bidderIndex: number
  bids: Array<{ playerId: string; bidUnits: number }>
}

export type IdentityAction =
  | { type: 'prophetDivination'; divinationId: string }
  | { type: 'merchantAuction' }
  | { type: 'reverserInvert' }
  | { type: 'thiefSteal' }
  | { type: 'kidnap'; targetPlayerId: string }
  | { type: 'nightwalkerDoubleBid'; shadowBidUnits: number; prioritizeItem?: boolean }
  | { type: 'invest'; targetPlayerId: string; investmentUnits: number }
  | { type: 'lobbyistContract'; targetPlayerId: string; specified?: boolean; taskType?: LobbyistTaskType; comparisonPlayerId?: string }

export interface Item {
  id: string
  name: string
  value: number
  emoji: string
  tone: string
  category: AssetCategory
}

export interface WonItem {
  item: Item
  roundIndex: number
}

export interface Player {
  id: string
  name: string
  color: string
  balanceUnits: number
  items: WonItem[]
  cardInventory: CardId[]
  identity?: PlayerIdentity
  controller?: PlayerController
  botMemory?: BotMemory
}

export interface RoundTurn {
  playerId: string
  bidUnits: number
  predictedPlayerId: string | null
  cardUses?: CardUse[]
  cardUse?: CardUse
  identityAction?: IdentityAction
  auctionBids?: AuctionBid[]
  assetAuctionOffer?: { itemId: string; itemRoundIndex: number; minimumBidUnits: number }
}

export interface RankingEntry {
  playerId: string
  place: number
  bidUnits: number
  actualBidUnits: number
  rewardUnits: number
  publicRewardUnits: number
}

export type PredictionStatus = 'skipped' | 'correct' | 'wrong'

export interface PredictionOutcome {
  playerId: string
  predictedPlayerId: string | null
  status: PredictionStatus
  deltaUnits: number
}

export interface PlayerRoundDelta {
  playerId: string
  rewardUnits: number
  /** Actual balance change caused by prediction settlement. */
  predictionUnits: number
  /** Masked prediction change exposed in all non-final public summaries. */
  publicPredictionUnits: number
  cardUnits: number
  identityUnits: number
  publicDeltaUnits: number
}

/** Kept out of the public round display; revealed in the end-game round review. */
export interface NightwalkerOutcome {
  playerId: string
  baseBidUnits: number
  shadowBidUnits: number
  chosenBidUnits: number
  basePlace: number | null
  shadowPlace: number | null
  baseRewardUnits: number
  shadowRewardUnits: number
  baseNetUnits: number
  shadowNetUnits: number
  baseWinsItem: boolean
  shadowWinsItem: boolean
  prioritizeItem: boolean
  reason: 'shadowHigherNet' | 'baseHigherOrEqualNet' | 'shadowWinsItem' | 'baseWinsItem'
}

/** Private until the end-game replay; public results only announce that an investment happened. */
export interface InvestmentRecord {
  investorId: string
  targetPlayerId: string
  investmentUnits: number
  targetOwnBidUnits: number
  finalBidUnits: number
  rewardShareUnits: number
  receivedItem: boolean
}

export interface RoundResult {
  roundIndex: number
  item: Item
  effectiveValueUnits: number
  turns: RoundTurn[]
  rankings: RankingEntry[]
  tiedPlayerIds: string[]
  winnerId: string | null
  itemWinnerId: string | null
  totalBidUnits: number
  minWinningBidUnits: number | null
  predictionOutcomes: PredictionOutcome[]
  winnerPaymentUnits: number
  cardEffects: CardEffect[]
  /** Passive cards consumed automatically during settlement and returned before the next round. */
  autoConsumedCardIds: CardId[]
  rankingReversalCount: number
  redistributionTransferUnits: number | null
  balanceLeaderIds: string[]
  deltas: PlayerRoundDelta[]
  balancesAfter: Record<string, number>
  identityEvents: IdentityEvent[]
  nightwalkerOutcomes: NightwalkerOutcome[]
  investments: InvestmentRecord[]
  assetAuctionResults: AssetAuctionResult[]
  /** Cash plus fixed assets after this round, used for comparable end-game trajectories. */
  totalAssetUnitsAfter: Record<string, number>
}

export interface GameSession {
  version: 23
  id: string
  phase: GamePhase
  settings: GameSettings
  players: Player[]
  itemDeck: Item[]
  /** The original deck is immutable: prophets always see this version. */
  prophecyDeck: Item[]
  /** Round-start balances are frozen before any player submits, preventing seat-order leakage. */
  roundStartBalanceUnits: Record<string, number>
  /** A confirmed prize-reroll draw survives a handoff/refresh until its owner submits. */
  pendingPrizeReroll: {
    playerId: string
    roundIndex: number
    originalItem: Item
    offeredItems: Item[]
    chosenItemId?: string
  } | null
  /** 命运硬币翻面后立即扣/加余额；在本次提交前保留，防止刷新后重掷。 */
  pendingFateCoinUse: { playerId: string; roundIndex: number; use: CardUse } | null
  cardDeck: CardId[]
  pendingCardGrants: CardGrant[]
  identityAvailableIds: IdentityId[]
  identityDraft: IdentityDraftState | null
  pendingIdentityCardAwards: Array<{ playerId: string; cardId: CardId }>
  pendingIdentityNotices: IdentityNotice[]
  identityContracts: LobbyistContract[]
  identityEvents: IdentityEvent[]
  prophetDivinations: ProphetDivination[]
  merchantAuction: MerchantAuction | null
  /** Auctions waiting after the current one; the first entry always runs next. */
  auctionQueue: MerchantAuction[]
  /** v20: all current-round lots are bid on beside the normal sealed bid. */
  roundAuctions: AuctionLot[]
  pendingAssetAuctions: AssetAuctionLot[]
  roundAssetAuctions: AssetAuctionLot[]
  /** Merchant's already drawn three-card offer; survives refresh and cannot be rerolled. */
  pendingMerchantOffers: Array<{ playerId: string; roundIndex: number; offeredCardIds: CardId[]; chosenCardId?: CardId }>
  /** Prophet-private stable candidate identities, keyed by prophet then target. */
  prophetIdentityCandidates: Record<string, Record<string, IdentityId[]>>
  /** Prophet-private solved/excluded state, keyed by prophet then target. */
  prophetIdentityProgress: Record<string, Record<string, ProphetIdentityProgress>>
  /** One-time six-card / choose-two reward, locked before the owner can choose. */
  pendingProphetCardOffers: Array<{ playerId: string; offeredCardIds: CardId[]; chosenCardIds: CardId[] }>
  /** Kidnap success reward. Candidates are removed from the deck before this is shown. */
  pendingKidnapCardOffers: Array<{ playerId: string; offeredCardIds: CardId[] }>
  /** Final round receipts are shown seat by seat before the public leaderboard. */
  finalReceiptIndex: number | null
  /** 已进入私密竞拍/竞购后的绝对截止时间；刷新降级为传递页时保留。 */
  operationDeadlineAt: number | null
  cardRulesStartRound: number
  fairnessOrderIds: string[]
  roundIndex: number
  currentTurnIndex: number
  turns: RoundTurn[]
  results: RoundResult[]
  /** A short, deterministic onboarding path. Omitted for every normal game. */
  tutorial?: { kind: 'firstGame' }
  createdAt: string
  updatedAt: string
}

export interface FinalStanding {
  player: Player
  place: number
  cashUnits: number
  fixedAssetUnits: number
  totalAssetUnits: number
  fixedAssets: FixedAssetBreakdown[]
}

export interface FixedAssetBreakdown {
  category: AssetCategory
  itemCount: number
  units: number
}

export interface GamePreset {
  id: string
  name: string
  names: string[]
  settings: GameSettings
  createdAt: string
  updatedAt: string
  seats?: SeatConfig[]
}

/** A read-only snapshot captured when a game reaches its final leaderboard. */
export interface GameHistoryEntry {
  /** Uses the original session ID so repeated saves replace rather than duplicate a game. */
  id: string
  completedAt: string
  session: GameSession
}
