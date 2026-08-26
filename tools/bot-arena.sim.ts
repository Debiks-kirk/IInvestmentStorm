import { describe, expect, it } from 'vitest'
import { buildBotObservation, decideBotKidnapResponse, decideBotTurn, updateBotGrudges } from '../src/game/bots'
import { drawCard } from '../src/game/cards'
import { rankFinalPlayers, settleRound } from '../src/game/engine'
import { createPlayerIdentity } from '../src/game/identities'
import { ITEM_POOL } from '../src/game/items'
import { createDefaultSettings, createSession, prepareCardGrants, roundPlayerIndices } from '../src/game/session'
import type { BotProfileId, CardId, IdentityAction, IdentityId, Player, RoundTurn, SeatConfig } from '../src/game/types'

const PROFILES: BotProfileId[] = ['steady', 'aggressive', 'collectorBot', 'observer', 'revenge', 'cards', 'identityBot', 'comeback', 'blocker', 'adaptive']
const IDENTITIES: IdentityId[] = ['prophet', 'gambler', 'assassin', 'collector', 'thief', 'merchant', 'reverser', 'lobbyist', 'nightwalker', 'investor']
const PLAYER_COUNT = 6

type Aggregate = {
  n: number
  wins: number
  podiums: number
  bankruptcies: number
  totalAssets: number
  totalAssetsSquared: number
}

type ArenaResult = {
  profileRows: Map<string, Aggregate>
  identityRows: Map<string, Aggregate>
  profileMatches: number
  identityMatchesPerIdentity: number
}

function envNumber(key: string, fallback: number): number {
  const environment = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
  const value = Number(environment?.[key])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function seededRandom(seed: string): () => number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return () => {
    hash += 0x6D2B79F5
    let value = hash
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffledItems(seed: string) {
  const random = seededRandom(`${seed}:deck`)
  const deck = [...ITEM_POOL]
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[deck[index], deck[target]] = [deck[target], deck[index]]
  }
  return deck
}

function emptyAggregate(): Aggregate {
  return { n: 0, wins: 0, podiums: 0, bankruptcies: 0, totalAssets: 0, totalAssetsSquared: 0 }
}

function record(rows: Map<string, Aggregate>, key: string, player: Player, standings: ReturnType<typeof rankFinalPlayers>): void {
  const row = rows.get(key) ?? emptyAggregate()
  const standing = standings.find((entry) => entry.player.id === player.id)
  if (!standing) return
  const leaders = standings.filter((entry) => entry.place === 1).length
  row.n += 1
  row.wins += standing.place === 1 ? 1 / leaders : 0
  row.podiums += standing.place <= 3 ? 1 : 0
  row.bankruptcies += player.balanceUnits === 0 ? 1 : 0
  row.totalAssets += standing.totalAssetUnits / 2
  row.totalAssetsSquared += (standing.totalAssetUnits / 2) ** 2
  rows.set(key, row)
}

function seatsForProfiles(profileIds: BotProfileId[]): SeatConfig[] {
  return profileIds.map((profileId, index) => ({
    name: `机器人${index + 1}`,
    controller: { kind: 'bot' as const, profileId, difficulty: 'expert' as const },
  }))
}

function permittedAction(action: IdentityAction | undefined): IdentityAction | undefined {
  if (!action) return undefined
  // Merchant auctions and lobbyist contracts need their UI-only scheduling flows;
  // this arena intentionally excludes those markets rather than approximating them.
  return action.type === 'reverserInvert' || action.type === 'thiefSteal' || action.type === 'nightwalkerDoubleBid' || action.type === 'invest' || action.type === 'kidnap'
    ? action
    : undefined
}

function permittedCardUses(turn: ReturnType<typeof decideBotTurn>): NonNullable<RoundTurn['cardUses']> {
  return turn.cardUses.filter((use) => !['peek', 'reflectShield', 'prizeReroll'].includes(use.cardId))
}

function removeUsedCards(inventory: CardId[], uses: NonNullable<RoundTurn['cardUses']>): CardId[] {
  const next = [...inventory]
  for (const use of uses) {
    const index = next.indexOf(use.cardId)
    if (index >= 0) next.splice(index, 1)
  }
  return next
}

/**
 * Deterministic core-auction arena. It uses the real decision engine and real
 * settlement engine, including normal card grants and card use. It intentionally
 * excludes card/asset auctions and UI-only prophet, merchant and lobbyist flows.
 * This keeps paired studies fair.
 */
function playMatch(seed: string, profileIds: BotProfileId[], forcedIdentity?: { seatIndex: number; id: IdentityId }): Player[] {
  const settings = createDefaultSettings(PLAYER_COUNT)
  settings.rounds = 8
  settings.cardGrantProbability = 100
  settings.systemAuctionCardsPerRound = 0
  settings.identitySettings.enabled = Boolean(forcedIdentity)
  const raw = createSession(seatsForProfiles(profileIds), settings)
  const deck = shuffledItems(seed)
  let players = raw.players.map((player, index) => {
    if (!forcedIdentity || index !== forcedIdentity.seatIndex) return { ...player, cardInventory: [] }
    const collectorCategory = ['leisure', 'transport', 'luxury', 'property'][Number(seed.split(':').at(-1) ?? 0) % 4] as 'leisure' | 'transport' | 'luxury' | 'property'
    return { ...player, cardInventory: [], identity: createPlayerIdentity(forcedIdentity.id, { collectorCategory }) }
  })
  let results = [] as typeof raw.results
  let identityContracts = [] as typeof raw.identityContracts
  let cardDeck = [...raw.cardDeck]
  const fairnessOrderIds = raw.fairnessOrderIds
  const random = seededRandom(`${seed}:settlement`)

  for (let roundIndex = 0; roundIndex < settings.rounds; roundIndex += 1) {
    const grants = prepareCardGrants({ players, cardDeck, roundIndex, probability: settings.cardGrantProbability, roll: random })
    players = grants.players
    cardDeck = grants.cardDeck
    for (const merchant of players.filter((player) => player.identity?.id === 'merchant')) {
      const draw = drawCard(cardDeck, settings.disabledCardIds, random)
      cardDeck = draw.cardDeck
      if (draw.cardId) players = players.map((player) => player.id === merchant.id ? { ...player, cardInventory: [...player.cardInventory, draw.cardId as CardId] } : player)
    }
    const startBalances = Object.fromEntries(players.map((player) => [player.id, player.balanceUnits]))
    const turns: RoundTurn[] = []
    const order = roundPlayerIndices(roundIndex, players.length)
    let submittedPlayers = players
    for (const playerIndex of order) {
      const player = submittedPlayers[playerIndex]
      const session = {
        ...raw,
        id: `arena:${seed}`,
        settings,
        players: submittedPlayers,
        itemDeck: deck,
        prophecyDeck: deck,
        roundIndex,
        turns,
        results,
        identityContracts,
        roundStartBalanceUnits: startBalances,
      }
      const memory = player.botMemory
      if (!memory || player.controller?.kind !== 'bot') continue
      const decision = decideBotTurn(buildBotObservation(session, player.id), player.controller.profileId, player.controller.difficulty, memory)
      const action = permittedAction(decision.identityAction)
      const cardUses = permittedCardUses(decision)
      const investmentUnits = action?.type === 'invest' ? action.investmentUnits : 0
      const bidUnits = Math.max(0, Math.min(player.balanceUnits - investmentUnits, decision.bidUnits))
      const turn: RoundTurn = { playerId: player.id, bidUnits, predictedPlayerId: decision.predictedPlayerId, ...(action ? { identityAction: action } : {}), ...(cardUses.length ? { cardUses } : {}) }
      turns.push(turn)
      submittedPlayers = submittedPlayers.map((entry) => entry.id === player.id
        ? {
            ...entry,
            balanceUnits: Math.max(0, entry.balanceUnits - bidUnits - investmentUnits),
            cardInventory: removeUsedCards(entry.cardInventory, cardUses),
            botMemory: { ...memory, lastMode: decision.mode, recentBidUnits: [...memory.recentBidUnits, bidUnits].slice(-8), decisionLog: [...memory.decisionLog, { stage: 'turn', roundIndex, mode: decision.mode, reason: decision.reason, bidUnits }].slice(-80) },
          }
        : entry)
    }
    const settled = settleRound({
      playersAfterBids: submittedPlayers,
      turns,
      item: deck[roundIndex],
      roundIndex,
      rewardMultipliers: settings.rewardMultipliers,
      correctPredictionMultiplier: settings.correctPredictionMultiplier,
      wrongPredictionMultiplier: settings.wrongPredictionMultiplier,
      fairnessOrderIds,
      roundStartBalanceUnits: startBalances,
      totalRounds: settings.rounds,
      identitySettings: settings.identitySettings,
      identityContracts,
      roll: random,
    })
    let resolvedPlayers = settled.players
    let resolvedResult = settled.result
    // A pending kidnap is normally resolved in its public UI. Here the captured
    // Bot uses the same ransom decision helper that the app uses for Bot choices.
    if (settled.result.kidnapAttempt?.status === 'pending' && settled.result.kidnapAttempt.capturedPlayerId) {
      const attempt = settled.result.kidnapAttempt
      const captured = resolvedPlayers.find((player) => player.id === attempt.capturedPlayerId)
      const kidnapper = resolvedPlayers.find((player) => player.id === attempt.kidnapperId)
      if (captured && kidnapper) {
        const payRansom = decideBotKidnapResponse({ player: captured, item: settled.result.item, ransomUnits: attempt.ransomUnits, roundIndex, totalRounds: settings.rounds, sessionSeed: `arena:${seed}` })
        const updatedAttempt = { ...attempt, status: payRansom ? 'paid' as const : 'surrendered' as const }
        resolvedPlayers = resolvedPlayers.map((player) => {
          if (payRansom && player.id === captured.id) return { ...player, balanceUnits: Math.max(0, player.balanceUnits - attempt.ransomUnits) }
          if (payRansom && player.id === kidnapper.id) return { ...player, balanceUnits: player.balanceUnits + attempt.ransomUnits }
          if (!payRansom && player.id === captured.id) return { ...player, items: player.items.filter((won) => !(won.item.id === settled.result.item.id && won.roundIndex === roundIndex)) }
          if (!payRansom && player.id === kidnapper.id) return { ...player, items: [...player.items, { item: settled.result.item, roundIndex }] }
          return player
        })
        resolvedResult = {
          ...settled.result,
          kidnapAttempt: updatedAttempt,
          ...(payRansom ? {} : { itemWinnerId: kidnapper.id }),
          balancesAfter: Object.fromEntries(resolvedPlayers.map((player) => [player.id, player.balanceUnits])),
          totalAssetUnitsAfter: Object.fromEntries(rankFinalPlayers(resolvedPlayers).map((standing) => [standing.player.id, standing.totalAssetUnits])),
        }
      }
    }
    players = updateBotGrudges(resolvedPlayers, resolvedResult)
    identityContracts = settled.identityContracts
    results = [...results, resolvedResult]
    cardDeck = [...cardDeck, ...turns.flatMap((turn) => turn.cardUses?.map((use) => use.cardId) ?? []), ...resolvedResult.autoConsumedCardIds]
  }
  return players
}

function runArena(profileMatches: number, identityMatchesPerIdentity: number, seedOffset = 0): ArenaResult {
  const profileRows = new Map<string, Aggregate>()
  const identityRows = new Map<string, Aggregate>()
  for (let match = 0; match < profileMatches; match += 1) {
    const sequence = match + seedOffset
    const profileIds = Array.from({ length: PLAYER_COUNT }, (_, seat) => PROFILES[(sequence + seat) % PROFILES.length])
    const players = playMatch(`profile:${sequence}`, profileIds)
    const standings = rankFinalPlayers(players)
    players.forEach((player, seat) => record(profileRows, profileIds[seat], player, standings))
  }
  for (const identity of IDENTITIES) {
    for (let match = 0; match < identityMatchesPerIdentity; match += 1) {
      const sequence = match + seedOffset
      const seatIndex = sequence % PLAYER_COUNT
      const players = playMatch(`identity:${identity}:${sequence}`, Array.from({ length: PLAYER_COUNT }, () => 'adaptive' as const), { seatIndex, id: identity })
      record(identityRows, identity, players[seatIndex], rankFinalPlayers(players))
    }
  }
  return { profileRows, identityRows, profileMatches, identityMatchesPerIdentity }
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function rowText(name: string, row: Aggregate): string {
  const winRate = row.wins / row.n
  const winError = 1.96 * Math.sqrt(Math.max(0, winRate * (1 - winRate)) / row.n)
  const mean = row.totalAssets / row.n
  const variance = Math.max(0, (row.totalAssetsSquared - row.n * mean * mean) / Math.max(1, row.n - 1))
  const meanError = 1.96 * Math.sqrt(variance / row.n)
  return `| ${name} | ${row.n} | ${percentage(winRate)} ± ${percentage(winError)} | ${percentage(row.podiums / row.n)} | ${mean.toFixed(1)} ± ${meanError.toFixed(1)} | ${percentage(row.bankruptcies / row.n)} |`
}

function markdownReport(result: ArenaResult): string {
  const profiles = [...result.profileRows.entries()].sort((left, right) => right[1].wins / right[1].n - left[1].wins / left[1].n)
  const identities = [...result.identityRows.entries()].sort((left, right) => right[1].wins / right[1].n - left[1].wins / left[1].n)
  return [
    '# Bot 竞技场模拟报告',
    '',
    `- 人格对照：${result.profileMatches.toLocaleString()} 局 6 人局；每种人格约 ${Math.floor(result.profileMatches * PLAYER_COUNT / PROFILES.length)} 次样本。`,
    `- 身份对照：每个身份 ${result.identityMatchesPerIdentity.toLocaleString()} 局；同一局仅测试席位持有该身份，其余 5 名均为高手“变色龙”，测试席位与拍品牌序轮换。`,
    '- 胜率为并列第一时平分的胜场；区间为近似 95% 置信区间。总资产含现金与固定资产。',
    '- 本轮是可重复的“核心竞价竞技场”：使用真实 Bot 决策、轮转顺序、拍品牌堆、常规发卡/用卡、预测、固定资产、投资、夜行者、逆转者、小偷与绑匪结算；为保证身份对照，禁用道具/拍品竞购、商人拍卖、说客任务与预言家 UI 推演。因此它适合比较核心竞争强度，不代表完整 UI 流程下的最终平衡。',
    '',
    '## 人格对照',
    '',
    '| 人格 | 样本 | 胜率（95% CI） | 前三率 | 平均总资产（95% CI） | 终局现金归零 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...profiles.map(([name, row]) => rowText(name, row)),
    '',
    '## 身份对照',
    '',
    '| 身份 | 样本 | 胜率（95% CI） | 前三率 | 平均总资产（95% CI） | 终局现金归零 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...identities.map(([name, row]) => rowText(name, row)),
  ].join('\n')
}

function serializable(result: ArenaResult): object {
  return {
    profileMatches: result.profileMatches,
    identityMatchesPerIdentity: result.identityMatchesPerIdentity,
    profiles: Object.fromEntries(result.profileRows),
    identities: Object.fromEntries(result.identityRows),
  }
}

const arenaEnabled = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.BOT_ARENA_RUN === '1'
const arenaDescribe = arenaEnabled ? describe : describe.skip

arenaDescribe('Bot 竞技场（仅按需运行）', () => {
  it('输出可控制变量的胜率报告', () => {
    const profileMatches = envNumber('BOT_ARENA_PROFILE_MATCHES', 40)
    const identityMatchesPerIdentity = envNumber('BOT_ARENA_IDENTITY_MATCHES', 20)
    const seedOffset = envNumber('BOT_ARENA_SEED_OFFSET', 0)
    const result = runArena(profileMatches, identityMatchesPerIdentity, seedOffset)
    const jsonOnly = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.BOT_ARENA_FORMAT === 'json'
    console.log(jsonOnly ? `ARENA_JSON:${JSON.stringify(serializable(result))}` : `\n${markdownReport(result)}\n`)
    expect([...result.profileRows.values()].reduce((total, row) => total + row.n, 0)).toBe(profileMatches * PLAYER_COUNT)
    expect([...result.identityRows.values()].reduce((total, row) => total + row.n, 0)).toBe(identityMatchesPerIdentity * IDENTITIES.length)
  })
})
