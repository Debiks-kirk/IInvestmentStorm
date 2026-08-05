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
}

export interface BotDecisionRecord {
  stage: 'identity' | 'turn' | 'merchantAuction'
  roundIndex: number
  mode: StrategyMode
  reason: string
  intel?: string
}

export interface SeatConfig {
  name: string
  controller: PlayerController
}

export type CardId = 'red' | 'peek' | 'swap' | 'redistribute' | 'doubleBid' | 'black' | 'reverseRank' | 'fateCoin' | 'bananaPeel' | 'reflectShield' | 'prizeReroll'

export type IdentityId = 'prophet' | 'gambler' | 'assassin' | 'collector' | 'thief' | 'merchant' | 'reverser' | 'lobbyist'
export type LobbyistTaskType = 'outbid' | 'underbid' | 'avoidPrize' | 'winFirst' | 'winSecond' | 'bidZero'

export type AssetCategory = 'leisure' | 'transport' | 'luxury' | 'property'

export interface CardUse {
  cardId: CardId
  targetPlayerId?: string
  coinResult?: 'heads' | 'tails'
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
  firstRoundSystemAuction: boolean
  /** 在后半中点的拍品抽取前追加一次系统道具竞购。 */
  midRoundSystemAuction: boolean
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
  lobbyistFirstRoundFree: boolean
  lobbyistFeeCoins: number
  lobbyistSpecifiedTaskFeeCoins: number
  lobbyistFailurePaymentCoins: number
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
  predictionUnits: number
  cardUnits: number
  identityUnits: number
  publicDeltaUnits: number
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
  /** Cash plus fixed assets after this round, used for comparable end-game trajectories. */
  totalAssetUnitsAfter: Record<string, number>
}

export interface GameSession {
  version: 13
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
