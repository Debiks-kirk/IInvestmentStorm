export type GamePhase =
  | 'roundIntro'
  | 'handoff'
  | 'privateTurn'
  | 'revealReady'
  | 'roundResult'
  | 'finalResult'

export type AnimationSpeed = 'full' | 'fast' | 'reduced'

export interface GameSettings {
  playerCount: number
  rounds: number
  initialCoins: number
  rewardMultipliers: number[]
  correctPredictionMultiplier: number
  wrongPredictionMultiplier: number
  revealBids: boolean
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
}

export interface RoundTurn {
  playerId: string
  bidUnits: number
  predictedPlayerId: string | null
}

export interface RankingEntry {
  playerId: string
  place: number
  bidUnits: number
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
  publicDeltaUnits: number
}

export interface RoundResult {
  roundIndex: number
  item: Item
  turns: RoundTurn[]
  rankings: RankingEntry[]
  tiedPlayerIds: string[]
  winnerId: string | null
  totalBidUnits: number
  minWinningBidUnits: number | null
  predictionOutcomes: PredictionOutcome[]
  winnerPaymentUnits: number
  deltas: PlayerRoundDelta[]
  balancesAfter: Record<string, number>
}

export interface GameSession {
  version: 1
  id: string
  phase: GamePhase
  settings: GameSettings
  players: Player[]
  itemDeck: Item[]
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

