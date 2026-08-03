export type GamePhase =
  | 'roundIntro'
  | 'handoff'
  | 'privateTurn'
  | 'revealReady'
  | 'roundResult'
  | 'finalResult'

export type AnimationSpeed = 'full' | 'fast' | 'reduced'

export type CardId = 'red' | 'peek' | 'swap' | 'redistribute' | 'doubleBid' | 'black'

export interface CardUse {
  cardId: CardId
  targetPlayerId?: string
}

export interface CardGrant {
  playerId: string
  cardId: CardId
  announced: boolean
}

export interface CardEffect {
  cardId: CardId
  description: string
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
  animationSpeed: AnimationSpeed
}

export interface Item {
  id: string
  name: string
  value: number
  emoji: string
  tone: string
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
}

export interface RoundTurn {
  playerId: string
  bidUnits: number
  predictedPlayerId: string | null
  cardUse?: CardUse
}

export interface RankingEntry {
  playerId: string
  place: number
  bidUnits: number
  actualBidUnits: number
  rewardUnits: number
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
  totalBidUnits: number
  minWinningBidUnits: number | null
  predictionOutcomes: PredictionOutcome[]
  winnerPaymentUnits: number
  cardEffects: CardEffect[]
  balanceLeaderIds: string[]
  deltas: PlayerRoundDelta[]
  balancesAfter: Record<string, number>
}

export interface GameSession {
  version: 2
  id: string
  phase: GamePhase
  settings: GameSettings
  players: Player[]
  itemDeck: Item[]
  cardDeck: CardId[]
  pendingCardGrants: CardGrant[]
  cardRulesStartRound: number
  fairnessOrderIds: string[]
  roundIndex: number
  currentTurnIndex: number
  turns: RoundTurn[]
  results: RoundResult[]
  createdAt: string
  updatedAt: string
}

export interface FinalStanding {
  player: Player
  place: number
}
