import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ASSET_CATEGORY_CONFIGS, calculateFixedAssets, categoryConfig } from './game/assets'
import { CARD_DEFINITIONS, cardTargetScope, getCardDefinition } from './game/cards'
import { createGameHighlights, createRoundBulletin } from './game/highlights'
import { IDENTITY_DEFINITIONS, LOBBYIST_TASKS, createPlayerIdentity, dealIdentityChoices, enabledIdentityIds, getIdentityDefinition, identitySkillMode, identityValidationErrors, randomLobbyistTask, routeCardAwards, taskLabel, taskRequiresComparison } from './game/identities'
import { defaultRewards, formatCoins, rankFinalPlayers, settleRound, unitsToCoins, validateSettings } from './game/engine'
import { cloneSettings, createGamePreset, SYSTEM_PRESETS } from './game/presets'
import { createDefaultSettings, createRematchSession, createSession, createTutorialSession, drawPrizeRerollOffers, playerIndexForRoundPosition, prepareCardGrants, recycleUsedCards, replaceNextPrize, roundStartPlayerIndex, validateNames } from './game/session'
import { clearSession, loadPresets, loadSession, savePresets, saveSession } from './game/storage'
import { ITEM_POOL, shuffle } from './game/items'
import { canMakeIdentityGuess, createStarsDivination, createWealthDivination, drawProphetRewardCard, prophetModeLabel } from './game/prophet'
import { BOT_PROFILES, appendBotRecord, buildBotObservation, decideBotIdentity, decideBotMerchantBid, decideBotTurn, emptyBotMemory, isBot, modeLabel, updateBotGrudges } from './game/bots'
import type { AssetCategory, BotDifficulty, BotProfileId, CardId, CardUse, GamePreset, GameSession, GameSettings, IdentityAction, IdentityEvent, IdentityId, LobbyistTaskType, Player, ProphetDivination, RoundResult, RoundTurn, SeatConfig } from './game/types'

type Screen = 'home' | 'setup' | 'rules' | 'game'
type ScheduledIdentityAction = Exclude<IdentityAction, { type: 'prophetDivination' }>

const MEDALS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function identityFeedbackNotice(event: IdentityEvent, index: number) {
  return { id: `identity-feedback-${event.roundIndex ?? 'setup'}-${event.playerId}-${index}`, playerId: event.playerId, title: event.title, detail: event.detail }
}

function playerName(players: Player[], id: string | null): string {
  return players.find((player) => player.id === id)?.name ?? '无人'
}

function turnCardUses(turn: RoundTurn): CardUse[] {
  return turn.cardUses ?? (turn.cardUse ? [turn.cardUse] : [])
}

function CoinValue({ units, signed = false }: { units: number; signed?: boolean }) {
  const prefix = signed && units > 0 ? '+' : ''
  return <span className="coin-value"><span aria-hidden="true">●</span>{prefix}{formatCoins(units)}</span>
}

function OperationTimer({ deadlineAt, onExpire }: { deadlineAt: number | null; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadlineAt) return
    let expired = false
    const tick = () => {
      const nextNow = Date.now()
      setNow(nextNow)
      if (!expired && nextNow >= deadlineAt) {
        expired = true
        onExpire()
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [deadlineAt, onExpire])
  if (!deadlineAt) return null
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000))
  return <div className={cx('operation-timer', seconds <= 5 && 'is-warning')} role="status" aria-live="polite"><span aria-hidden="true">◷</span><div><small>本次操作剩余</small><strong>{seconds}s</strong></div><em>{seconds <= 5 ? '即将自动确认' : '超时将按当前选择提交'}</em></div>
}

function AppShell({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <main className={cx('app-shell', quiet && 'app-shell--quiet')}>{children}</main>
}

function Brand() {
  return (
    <div className="brand" aria-label="谁在加码">
      <span className="brand__mark">↑</span>
      <span>谁在加码</span>
    </div>
  )
}

function TutorialCoach({ roundIndex }: { roundIndex: number }) {
  const content = roundIndex === 0
    ? { step: '第 1 / 3 轮 · 只学下注', title: '把自己的出价藏好', body: '拍品卡是本轮目标；上方奖区告诉你各名次能拿多少；滑杆和快捷键决定秘密下注，确认后才会扣钱并锁定。', note: '撞价示例：8、8、6 中，两个 8 都出局，6 反而成为第一名。' }
    : roundIndex === 1
      ? { step: '第 2 / 3 轮 · 解锁预测', title: '猜谁会成为第一名', body: '在“谁会拿第一”里点其他玩家的名字；不能猜自己，也可以选“本轮不预测”。猜中会获得收益，猜错按本局规则扣款。', note: '预测是额外选择，不会替代你的下注。' }
      : { step: '第 3 / 3 轮 · 道具与主动身份', title: '把选择组合起来', body: '道具要先点卡，再在二次确认中锁定；主动身份则在“身份技能”区点按钮安排。本轮给你一张“反客为主”，可让自己的排名下注翻倍。', note: '不是每个身份都有主动技能；按钮不可用时会直接说明原因。' }
  return <aside className="tutorial-coach" aria-live="polite"><span>✦</span><div><small>{content.step}</small><strong>{content.title}</strong><p>{content.body}</p><em>{content.note}</em></div></aside>
}

function Home({ saved, onQuickStart, onTutorial, onSetup, onContinue, onRules, onDelete }: {
  saved: GameSession | null
  onQuickStart: () => void
  onTutorial: () => void
  onSetup: () => void
  onContinue: () => void
  onRules: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <AppShell>
      <section className="home-layout">
        <div className="home-copy">
          <Brand />
          <p className="eyebrow">一台设备 · 3–10 人</p>
          <h1>把筹码藏好。<br /><em>看谁笑到最后。</em></h1>
          <p className="lead">秘密下注，猜中赢家，避开并列。每一次把设备递出去，都是一次不动声色的加码。</p>
          <div className="home-actions">
            {saved && <button className="button button--primary button--large" onClick={onContinue}>继续第 {saved.roundIndex + 1} 轮 <span>→</span></button>}
            <button className={cx('button button--large', saved ? 'button--paper' : 'button--primary')} onClick={onSetup}>创建新对局</button>
            <button className="button button--ghost" onClick={onQuickStart}>三人快速开始</button>
            <button className="text-button home-tutorial" onClick={onTutorial}>✦ 先玩 3 轮新手引导</button>
          </div>
          <button className="text-button" onClick={onRules}>用 30 秒看懂规则</button>
        </div>
        <div className="hero-table" aria-hidden="true">
          <div className="hero-table__ring">
            <span className="hero-chip hero-chip--one">7</span>
            <span className="hero-chip hero-chip--two">?</span>
            <span className="hero-chip hero-chip--three">12</span>
            <div className="hero-card">
              <span>🏝️</span>
              <small>本轮拍品</small>
              <strong>私人小岛</strong>
            </div>
          </div>
          <p>别让他们猜到你还剩多少。</p>
        </div>
      </section>
      {saved && (
        <footer className="home-footer">
          <span>上局自动保存于 {new Date(saved.updatedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          {confirmDelete ? (
            <span className="inline-confirm">确定删除？ <button onClick={onDelete}>删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></span>
          ) : <button className="text-button text-button--danger" onClick={() => setConfirmDelete(true)}>删除旧局</button>}
        </footer>
      )}
    </AppShell>
  )
}

function Rules({ onBack }: { onBack: () => void }) {
  return (
    <AppShell>
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="返回">←</button><Brand /><span /></header>
      <section className="rules-page">
        <p className="eyebrow">30 秒规则</p>
        <h1>出价要狠，<em>撞价要命。</em></h1>
        <div className="rules-grid">
          <article><span className="rule-number">01</span><h2>秘密下注</h2><p>轮流拿设备，下注会立刻消耗金币。余额只有本人长按才能看见。</p></article>
          <article><span className="rule-number">02</span><h2>避开并列</h2><p>所有相同出价都出局。剩下的唯一出价从高到低重新排名。</p></article>
          <article><span className="rule-number">03</span><h2>顺手猜人</h2><p>可猜谁会第一。猜错扣半个物品价值；猜中则由第一名向你付款。</p></article>
          <article><span className="rule-number">04</span><h2>资产翻盘</h2><p>拍品会组成四类固定资产。用过的道具会回到卡池，留着不用则一直由你保管。</p></article>
          <article><span className="rule-number">05</span><h2>Bot 也会上桌</h2><p>Bot 只按它能合法看到的信息行动，会记住本局的恩怨；高手可能得到一次模糊投资情报。</p></article>
        </div>
        <div className="rule-example">
          <div><small>四人下注</small><strong>10 · 10 · 9 · 8</strong></div>
          <span>→</span>
          <div><small>10 撞车出局</small><strong>9 成为第一</strong></div>
        </div>
        <p className="rules-footnote">固定资产只在终局结算；劫富济贫只公开总转移金额，不公开任何人的余额。</p>
        <button className="button button--primary" onClick={onBack}>明白了</button>
      </section>
    </AppShell>
  )
}

function Setup({ onBack, onStart, presets, onSavePresets }: { onBack: () => void; onStart: (session: GameSession) => void; presets: GamePreset[]; onSavePresets: (presets: GamePreset[]) => void }) {
  const [settings, setSettings] = useState<GameSettings>(() => createDefaultSettings())
  const [seats, setSeats] = useState<SeatConfig[]>(() => ['玩家 1', '玩家 2', '玩家 3'].map((name) => ({ name, controller: { kind: 'human' } })))
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [presetName, setPresetName] = useState('')
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  const applyConfiguration = (nextSeats: SeatConfig[], nextSettings: GameSettings, preset?: GamePreset) => {
    setSeats(nextSeats.map((seat) => ({ ...seat, controller: { ...seat.controller } })))
    setSettings(cloneSettings({ ...nextSettings, playerCount: nextSeats.length }))
    setPresetName(preset?.name ?? '')
    setActivePresetId(preset?.id ?? null)
    setErrors([])
  }

  const setPlayerCount = (count: number) => {
    setSeats((current) => Array.from({ length: count }, (_, index) => current[index] ?? { name: `玩家 ${index + 1}`, controller: { kind: 'human' } }))
    setSettings((current) => ({ ...current, playerCount: count, rewardMultipliers: defaultRewards(count) }))
  }
  const setRewardCount = (count: number) => {
    setSettings((current) => {
      const rewards = Array.from({ length: count }, (_, index) => current.rewardMultipliers[index] ?? 0.5)
      return { ...current, rewardMultipliers: rewards }
    })
  }
  const submit = () => {
    const nextErrors = [...validateNames(seats.map((seat) => seat.name)), ...validateSettings(settings), ...identityValidationErrors(settings.identitySettings, settings.playerCount)]
    if (settings.identitySettings.enabled && !settings.identitySettings.disabledIdentityIds.includes('merchant') && settings.disabledCardIds.length === CARD_DEFINITIONS.length) nextErrors.push('启用道具商人时，至少需要启用一张道具卡')
    setErrors(nextErrors)
    if (nextErrors.length === 0) onStart(createSession(seats, settings))
  }
  const saveCurrentPreset = () => {
    const nextErrors = [...validateNames(seats.map((seat) => seat.name)), ...validateSettings(settings), ...identityValidationErrors(settings.identitySettings, settings.playerCount)]
    if (settings.identitySettings.enabled && !settings.identitySettings.disabledIdentityIds.includes('merchant') && settings.disabledCardIds.length === CARD_DEFINITIONS.length) nextErrors.push('启用道具商人时，至少需要启用一张道具卡')
    if (!presetName.trim()) nextErrors.push('请为这套配置填写名称')
    setErrors(nextErrors)
    if (nextErrors.length > 0) return
    const existing = presets.find((preset) => preset.id === activePresetId)
    const preset = createGamePreset(presetName, seats, settings, existing)
    onSavePresets(existing ? presets.map((entry) => entry.id === preset.id ? preset : entry) : [...presets, preset])
    setActivePresetId(preset.id)
    setPresetName(preset.name)
  }
  const deletePreset = (presetId: string) => {
    onSavePresets(presets.filter((preset) => preset.id !== presetId))
    if (activePresetId === presetId) { setActivePresetId(null); setPresetName('') }
  }

  return (
    <AppShell>
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="返回">←</button><Brand /><span /></header>
      <section className="setup-page">
        <div className="section-heading"><div><p className="eyebrow">新对局</p><h1>谁会上桌？</h1></div><p>只需填名字，其他保持默认就能玩。</p></div>
        <div className="setup-grid">
          <div className="panel">
            <label className="field-label" htmlFor="player-count">玩家人数 <strong>{settings.playerCount}</strong></label>
            <input id="player-count" className="range" type="range" min="3" max="10" value={settings.playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))} />
            <div className="name-grid">
              {seats.map((seat, index) => (
                <div className="seat-field" key={index} style={{ '--player-color': `var(--player-${index + 1})` } as React.CSSProperties}>
                  <span>{index + 1}</span>
                  <input value={seat.name} maxLength={12} aria-label={`玩家 ${index + 1} 名字`} onChange={(event) => setSeats((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, name: event.target.value } : value))} />
                  <select aria-label={`玩家 ${index + 1} 类型`} value={seat.controller.kind} onChange={(event) => setSeats((current) => current.map((value, itemIndex) => itemIndex !== index ? value : event.target.value === 'bot' ? { ...value, controller: { kind: 'bot', profileId: 'adaptive', difficulty: 'standard' } } : { ...value, controller: { kind: 'human' } }))}>
                    <option value="human">真人</option><option value="bot">Bot</option>
                  </select>
                  {seat.controller.kind === 'bot' && <div className="bot-seat-controls"><select aria-label={`${seat.name || `玩家 ${index + 1}`} Bot 性格`} value={seat.controller.profileId} onChange={(event) => setSeats((current) => current.map((value, itemIndex) => itemIndex !== index || value.controller.kind !== 'bot' ? value : { ...value, controller: { ...value.controller, profileId: event.target.value as BotProfileId } }))}>{BOT_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.summary}</option>)}</select><select aria-label={`${seat.name || `玩家 ${index + 1}`} Bot 难度`} value={seat.controller.difficulty} onChange={(event) => setSeats((current) => current.map((value, itemIndex) => itemIndex !== index || value.controller.kind !== 'bot' ? value : { ...value, controller: { ...value.controller, difficulty: event.target.value as BotDifficulty } }))}><option value="easy">简单</option><option value="standard">标准</option><option value="expert">高手</option></select></div>}
                </div>
              ))}
            </div>
            {seats.some((seat) => seat.controller.kind === 'bot') && <p className="bot-setup-note">Bot 的性格、难度和策略在开局后保持隐藏；高手每轮可能得到一次模糊投资情报。</p>}
          </div>
          <div className="panel settings-panel">
            <div className="setting-row"><label htmlFor="rounds">轮数</label><div><input id="rounds" type="number" min="1" max="12" value={settings.rounds} onChange={(event) => setSettings({ ...settings, rounds: Number(event.target.value) })} /><span>轮</span></div></div>
            <div className="setting-row"><label htmlFor="coins">初始金币</label><div><input id="coins" type="number" min="10" max="200" value={settings.initialCoins} onChange={(event) => setSettings({ ...settings, initialCoins: Number(event.target.value) })} /><span>枚</span></div></div>
            <button className="advanced-toggle" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>高级设置 <span>{advanced ? '−' : '+'}</span></button>
            {advanced && (
              <div className="advanced-settings">
                <div className="setting-row"><label htmlFor="reward-count">获奖人数</label><select id="reward-count" value={settings.rewardMultipliers.length} onChange={(event) => setRewardCount(Number(event.target.value))}>{Array.from({ length: settings.playerCount }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 人</option>)}</select></div>
                <div className="reward-editors">
                  {settings.rewardMultipliers.map((reward, index) => <label key={index}>第 {index + 1} 名<select value={reward} onChange={(event) => setSettings({ ...settings, rewardMultipliers: settings.rewardMultipliers.map((value, rewardIndex) => rewardIndex === index ? Number(event.target.value) : value) })}>{Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((value) => <option key={value} value={value}>{value}V</option>)}</select></label>)}
                </div>
                <div className="setting-row"><label htmlFor="correct">猜中收益</label><select id="correct" value={settings.correctPredictionMultiplier} onChange={(event) => setSettings({ ...settings, correctPredictionMultiplier: Number(event.target.value) })}><option value="0.5">0.5V</option><option value="1">1V</option><option value="1.5">1.5V</option><option value="2">2V</option></select></div>
                <div className="setting-row"><label htmlFor="wrong">猜错罚款</label><select id="wrong" value={settings.wrongPredictionMultiplier} onChange={(event) => setSettings({ ...settings, wrongPredictionMultiplier: Number(event.target.value) })}><option value="0.5">0.5V</option><option value="1">1V</option><option value="1.5">1.5V</option></select></div>
                <label className="switch-row"><span><strong>公开个人下注</strong><small>只在每轮结算后显示</small></span><input type="checkbox" checked={settings.revealBids} onChange={(event) => setSettings({ ...settings, revealBids: event.target.checked })} /></label>
                <label className="switch-row"><span><strong>公布余额领跑者</strong><small>每轮只公布第一名姓名，不显示余额</small></span><input type="checkbox" checked={settings.revealBalanceLeader} onChange={(event) => setSettings({ ...settings, revealBalanceLeader: event.target.checked })} /></label>
                <div className="setting-row"><label htmlFor="card-probability">道具发放概率</label><div><input id="card-probability" type="number" min="0" max="100" value={settings.cardGrantProbability} onChange={(event) => setSettings({ ...settings, cardGrantProbability: Number(event.target.value) })} /><span>%</span></div></div>
                <label className="switch-row"><span><strong>启用操作倒计时</strong><small>默认关闭；开启后，真人竞拍与竞购超时会按当前选择自动确认</small></span><input type="checkbox" checked={settings.turnTimerEnabled} onChange={(event) => setSettings({ ...settings, turnTimerEnabled: event.target.checked })} /></label>
                {settings.turnTimerEnabled && <div className="setting-row"><label htmlFor="turn-time-limit">单次操作时限</label><div><input id="turn-time-limit" type="number" min="5" max="120" step="5" value={settings.turnTimeLimitSeconds} onChange={(event) => setSettings({ ...settings, turnTimeLimitSeconds: Number(event.target.value) })} /><span>秒</span></div></div>}
                <label className="switch-row"><span><strong>首轮系统道具竞购</strong><small>第 1 轮拍品抽取前，系统公开一张道具，所有人轮流秘密报价</small></span><input type="checkbox" checked={settings.firstRoundSystemAuction} onChange={(event) => setSettings({ ...settings, firstRoundSystemAuction: event.target.checked })} /></label>
                <div className="card-setting-group"><strong>禁用道具卡</strong><small>未勾选的卡会加入本局循环卡池；使用后回池，未使用会留在手中</small><div>{CARD_DEFINITIONS.map((card) => <label key={card.id}><input type="checkbox" checked={!settings.disabledCardIds.includes(card.id)} onChange={(event) => setSettings({ ...settings, disabledCardIds: event.target.checked ? settings.disabledCardIds.filter((id) => id !== card.id) : [...settings.disabledCardIds, card.id] })} /><span>{card.symbol} {card.name}</span></label>)}</div></div>
                <div className="identity-setting-group">
                  <label className="switch-row"><span><strong>启用身份系统</strong><small>开局前私密二选一身份；身份在终局才公开</small></span><input type="checkbox" checked={settings.identitySettings.enabled} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, enabled: event.target.checked } })} /></label>
                  {settings.identitySettings.enabled && <><strong>启用身份</strong><div className="identity-toggle-grid">{IDENTITY_DEFINITIONS.map((identity) => <label key={identity.id}><input type="checkbox" checked={!settings.identitySettings.disabledIdentityIds.includes(identity.id)} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, disabledIdentityIds: event.target.checked ? settings.identitySettings.disabledIdentityIds.filter((id) => id !== identity.id) : [...settings.identitySettings.disabledIdentityIds, identity.id] } })} /><span>{identity.symbol} {identity.name}</span></label>)}</div><div className="identity-settings-fields">
                    <label>赌徒命中加成<input type="number" min="0" max="1" step="0.05" value={settings.identitySettings.gamblerCorrectBonusMultiplier} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, gamblerCorrectBonusMultiplier: Number(event.target.value) } })} /></label>
                    <label>赌徒猜错罚款<input type="number" min="0" max="1" step="0.05" value={settings.identitySettings.gamblerWrongPenaltyMultiplier} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, gamblerWrongPenaltyMultiplier: Number(event.target.value) } })} /></label>
                    <label>赌徒跳过罚款<input type="number" min="0" max="1" step="0.05" value={settings.identitySettings.gamblerSkipPenaltyMultiplier} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, gamblerSkipPenaltyMultiplier: Number(event.target.value) } })} /></label>
                    <label>预言家天机推演费用<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.prophetDivinationCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, prophetDivinationCoins: Number(event.target.value) } })} /></label>
                    <label>绑匪发动费用<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.kidnapActivationCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, kidnapActivationCoins: Number(event.target.value) } })} /></label>
                    <label>小偷成功率 %<input type="number" min="0" max="100" value={settings.identitySettings.thiefSuccessProbability} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, thiefSuccessProbability: Number(event.target.value) } })} /></label>
                    <label>小偷上限<input type="number" min="0" max="10" value={settings.identitySettings.thiefMaxSteals} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, thiefMaxSteals: Number(event.target.value) } })} /></label>
                    <label>商人初始选卡<input type="number" min="1" max="6" value={settings.identitySettings.merchantInitialOfferCount} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, merchantInitialOfferCount: Number(event.target.value) } })} /></label>
                    <label>商人拍卖次数<input type="number" min="1" max="5" value={settings.identitySettings.merchantAuctionLimit} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, merchantAuctionLimit: Number(event.target.value) } })} /></label>
                    <label>说客发布费用<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.lobbyistFeeCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFeeCoins: Number(event.target.value) } })} /></label>
                    <label>说客违约付款<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.lobbyistFailurePaymentCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFailurePaymentCoins: Number(event.target.value) } })} /></label>
                  </div><label className="switch-row"><span><strong>说客首轮免费</strong></span><input type="checkbox" checked={settings.identitySettings.lobbyistFirstRoundFree} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFirstRoundFree: event.target.checked } })} /></label></>}
                </div>
                {settings.identitySettings.enabled && <div className="identity-settings-fields"><p>赌徒的猜中、猜错与跳过效果可分别设置；新局默认均为拍品价值的 50%。</p><label>逆转者发动费用<input type="number" min="0" max="30" step="0.5" value={settings.identitySettings.reverserActivationCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, reverserActivationCoins: Number(event.target.value) } })} /></label><label>说客指定任务加价<input type="number" min="0" max="30" step="0.5" value={settings.identitySettings.lobbyistSpecifiedTaskFeeCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistSpecifiedTaskFeeCoins: Number(event.target.value) } })} /></label></div>}
                <div className="setting-row"><label htmlFor="motion">动画速度</label><select id="motion" value={settings.animationSpeed} onChange={(event) => setSettings({ ...settings, animationSpeed: event.target.value as GameSettings['animationSpeed'] })}><option value="full">完整</option><option value="fast">快速</option><option value="reduced">极简</option></select></div>
              </div>
            )}
          </div>
        </div>
        <section className="preset-save panel"><div><p className="eyebrow">常用配置</p><h2>保存这套设置</h2><small>保存玩家姓名、轮数与所有高级规则，不会影响当前进行中的对局。</small></div><div><input aria-label="配置名称" placeholder="例如：周末六人局" maxLength={20} value={presetName} onChange={(event) => { setPresetName(event.target.value); setActivePresetId(null) }} /><button className="button button--paper" onClick={saveCurrentPreset}>{activePresetId ? '覆盖保存' : '另存配置'}</button></div></section>
        <section className="preset-panel panel">
          <div className="panel-title"><div><p className="eyebrow">一键开局</p><h2>系统配置</h2></div><span>载入后仍可继续微调</span></div>
          <div className="preset-grid">{SYSTEM_PRESETS.map((preset) => <button key={preset.id} className="preset-choice" onClick={() => applyConfiguration(preset.seats, preset.settings)}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}</div>
          {presets.length > 0 && <><div className="panel-title saved-preset-title"><div><p className="eyebrow">本机保存</p><h2>我的配置</h2></div><span>含座位、Bot 与高级设置</span></div><div className="preset-grid">{presets.map((preset) => <div key={preset.id} className={cx('preset-choice', activePresetId === preset.id && 'is-active')}><button onClick={() => applyConfiguration(preset.seats ?? preset.names.map((name) => ({ name, controller: { kind: 'human' } })), preset.settings, preset)}><strong>{preset.name}</strong><small>{preset.names.join('、')} · {preset.settings.rounds} 轮</small></button><button className="preset-delete" aria-label={`删除${preset.name}`} onClick={() => deletePreset(preset.id)}>×</button></div>)}</div></>}
        </section>
        {errors.length > 0 && <div className="error-box" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div>}
        <div className="sticky-action"><div><strong>{settings.playerCount} 人 · {settings.rounds} 轮</strong><span>每人 {settings.initialCoins} 金币</span></div><button className="button button--primary button--large" onClick={submit}>开始这局 <span>→</span></button></div>
      </section>
    </AppShell>
  )
}

function GameHeader({ session, onExit }: { session: GameSession; onExit: () => void }) {
  return (
    <header className="game-header">
      <Brand />
      <div className="round-progress"><span style={{ width: `${((session.roundIndex + (session.phase === 'roundResult' ? 1 : 0)) / session.settings.rounds) * 100}%` }} /><small>第 {session.roundIndex + 1} / {session.settings.rounds} 轮</small></div>
      <button className="icon-button" onClick={onExit} aria-label="暂离并回到首页">⌂</button>
    </header>
  )
}

function PrizeCard({ item, compact = false }: { item: GameSession['itemDeck'][number]; compact?: boolean }) {
  return (
    <div className={cx('prize-card', compact && 'prize-card--compact')} style={{ '--item-tone': item.tone } as React.CSSProperties}>
      <div className="prize-card__image"><span>{item.emoji}</span></div>
      <div><small>{categoryConfig(item.category).name} · 价值 {item.value}</small><strong>{item.name}</strong></div>
    </div>
  )
}

function RoundIntro({ session, onContinue, auto = false }: { session: GameSession; onContinue: () => void; auto?: boolean }) {
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const timer = useRef<number | null>(null)
  const item = session.itemDeck[session.roundIndex]
  const starter = session.players[roundStartPlayerIndex(session.roundIndex, session.players.length)]
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const spin = () => {
    setSpinning(true)
    const duration = session.settings.animationSpeed === 'reduced' ? 150 : session.settings.animationSpeed === 'fast' ? 700 : 1500
    timer.current = window.setTimeout(() => { setSpinning(false); setRevealed(true) }, duration)
  }
  useEffect(() => {
    if (!auto || spinning || revealed) return
    const start = window.setTimeout(spin, 80)
    return () => window.clearTimeout(start)
  }, [auto, spinning, revealed])
  useEffect(() => {
    if (!auto || !revealed) return
    const next = window.setTimeout(onContinue, session.settings.animationSpeed === 'reduced' ? 80 : 500)
    return () => window.clearTimeout(next)
  }, [auto, revealed])
  return (
    <section className="round-intro screen-center">
      <div className="screen-title"><p className="eyebrow">第 {session.roundIndex + 1} 轮</p><h1>{revealed ? '就是它了。' : '这一轮，争什么？'}</h1></div>
      {!revealed ? (
        <div className={cx('draw-machine', spinning && 'is-drawing')} aria-label="本轮物品抽奖机">
          <div className="draw-machine__marquee"><span>本轮拍品</span><i>●</i><span>正在封存</span><i>●</i><span>本轮拍品</span></div>
          <div className="draw-machine__body">
            <div className="draw-machine__globe" aria-hidden="true">
              {['●', '◆', '●', '✦', '●', '◆', '●', '✦', '●'].map((symbol, index) => <span className={`draw-machine__ball ball-${index + 1}`} key={index}>{symbol}</span>)}
            </div>
            <div className="draw-machine__neck" aria-hidden="true" />
            <div className="draw-machine__chute">
              <span>{spinning ? '?' : '✦'}</span>
            </div>
            <div className="draw-machine__plaque"><small>价值</small><strong>{spinning ? '???' : '待揭晓'}</strong></div>
          </div>
          <p>{spinning ? '摇奖进行中，请稍候……' : '启动后，本轮物品将从牌堆中抽出。'}</p>
        </div>
      ) : <PrizeCard item={item} />}
      <div className="center-actions">
        {!spinning && !revealed && <button className="button button--primary button--large" onClick={spin}>启动抽奖机</button>}
        {spinning && <p className="muted pulse">正在抽取本轮拍品……</p>}
        {revealed && <><p className="muted">本轮从 {starter?.name ?? '首位玩家'} 开始，随后按座位顺序传递。</p><button className="button button--primary button--large" onClick={onContinue}>开始传递 <span>→</span></button></>}
      </div>
    </section>
  )
}

function Handoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const player = session.players[session.currentTurnIndex]
  return (
    <section className="handoff screen-center">
      <div className="privacy-seal"><span>私</span></div>
      <p className="eyebrow">请把设备交给</p>
      <h1 style={{ color: player.color }}>{player.name}</h1>
      <p className="lead">其他人请移开视线。准备好后，由本人点击进入。</p>
      <button className="handoff-enter" onClick={onReady}>进入私密操作 <span>→</span></button>
      <small className="privacy-note">点击后请立即开始自己的私密操作</small>
    </section>
  )
}

function BotThinking({ player, allBots }: { player: Player; allBots: boolean }) {
  return <section className="bot-thinking screen-center"><div className="privacy-seal"><span>✦</span></div><p className="eyebrow">Bot 正在行动</p><h1 style={{ color: player.color }}>{player.name}</h1><p className="lead">正在分析拍品、局势与可用技能。</p><div className="bot-thinking__dots" aria-label="Bot 正在思考"><i /><i /><i /></div>{allBots && <small className="privacy-note">观战模式会自动推进至终局</small>}</section>
}

function SpectatorControls({ paused, speed, onToggle, onSpeed, onTakeOver }: { paused: boolean; speed: number; onToggle: () => void; onSpeed: (speed: number) => void; onTakeOver: () => void }) {
  return <div className="spectator-controls" aria-label="Bot 观战控制"><span>Bot 观战</span><button className="text-button" onClick={onToggle}>{paused ? '继续自动' : '暂停'}</button><select aria-label="观战速度" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>{paused && <button className="text-button spectator-controls__takeover" onClick={onTakeOver}>接管当前 Bot</button>}</div>
}

function IdentityHandoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const player = session.players[session.identityDraft?.playerIndex ?? 0]
  return <section className="handoff screen-center"><div className="privacy-seal"><span>身</span></div><p className="eyebrow">请把设备交给</p><h1 style={{ color: player.color }}>{player.name}</h1><p className="lead">只有你会看到两张身份卡。选好并完成准备后，再传给下一位。</p><button className="handoff-enter" onClick={onReady}>选择身份 <span>→</span></button><small className="privacy-note">其他人请移开视线</small></section>
}

function IdentityDraft({ session, onChoose, onConfirm }: { session: GameSession; onChoose: (identityId: IdentityId) => void; onConfirm: (config: { targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId }) => void }) {
  const draft = session.identityDraft as NonNullable<GameSession['identityDraft']>
  const player = session.players[draft.playerIndex]
  const selected = draft.selectedIdentityId ? getIdentityDefinition(draft.selectedIdentityId) : null
  const [targetPlayerId, setTargetPlayerId] = useState<string>('')
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const [collectorCategory, setCollectorCategory] = useState<AssetCategory>('leisure')
  const [merchantCardId, setMerchantCardId] = useState<CardId | null>(null)
  const otherPlayers = session.players.filter((candidate) => candidate.id !== player.id)
  const needsTarget = selected?.needsTarget
  const canConfirm = Boolean(selected && (!needsTarget || targetPlayerId) && (!selected.needsMerchantCard || merchantCardId))
  return <section className="identity-draft private-turn"><div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>选一个身份</h1></div><span className="draft-count">{draft.playerIndex + 1} / {session.players.length}</span></div>{!selected ? <div className="identity-choice-grid">{draft.choiceIds.map((identityId, index) => { const identity = getIdentityDefinition(identityId); const active = identitySkillMode(identityId) === 'active'; return <button key={`${identityId}-${index}`} className="identity-choice-card" onClick={() => onChoose(identityId)}><span>{identity.symbol}</span><small>身份卡 · {active ? '主动技能' : '被动技能'}</small><h2>{identity.name}</h2><p>{identity.summary}</p><p className="identity-mode">{active ? '主动：选定后，在自己的回合到「身份技能」区点击按钮发动。' : '被动：无需点击，系统会在符合条件时自动生效。'}</p><b>选择这张卡 →</b></button> })}</div> : <section className="identity-setup panel"><div className="identity-card-summary"><span>{selected.symbol}</span><div><p className="eyebrow">已选身份 · {identitySkillMode(selected.id) === 'active' ? '主动技能' : '被动技能'}</p><h2>{selected.name}</h2><p>{selected.summary}</p><small className="identity-mode">{identitySkillMode(selected.id) === 'active' ? '之后请在自己的回合，到「身份技能」区点击对应按钮发动。' : '无需操作，系统会在符合条件时自动生效。'}</small></div></div>{needsTarget && <div className="identity-config"><strong>选择目标玩家</strong><button className="target-picker-trigger" onClick={() => setTargetPickerOpen(true)}>{targetPlayerId ? <>目标：<b>{playerName(session.players, targetPlayerId)}</b> · 点击更改</> : '打开玩家卡片选择目标'}</button></div>}{selected.needsCategory && <div className="identity-config"><strong>选择要加成的资产类别</strong><div className="identity-target-list">{ASSET_CATEGORY_CONFIGS.map((category) => <button key={category.category} className={cx(collectorCategory === category.category && 'is-selected')} onClick={() => setCollectorCategory(category.category)}><span>{category.symbol}</span>{category.name}</button>)}</div></div>}{selected.needsMerchantCard && <div className="identity-config"><strong>选择一张初始道具卡</strong><div className="merchant-offer-list">{(draft.merchantCardOfferIds ?? []).map((cardId) => { const card = getCardDefinition(cardId); return <button key={cardId} className={cx(merchantCardId === cardId && 'is-selected')} onClick={() => setMerchantCardId(cardId)}><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></button> })}</div></div>}<button className="button button--primary button--large" disabled={!canConfirm} onClick={() => onConfirm({ ...(targetPlayerId ? { targetPlayerId } : {}), ...(selected.needsCategory ? { collectorCategory } : {}), ...(merchantCardId ? { merchantCardId } : {}) })}>确认身份与准备 <span>→</span></button></section>}{targetPickerOpen && <PlayerTargetPicker title="选择目标玩家" detail="选中后，只有你会知道这项身份配置。" players={otherPlayers} selectedPlayerId={targetPlayerId} onSelect={(id) => { setTargetPlayerId(id); setTargetPickerOpen(false) }} onClose={() => setTargetPickerOpen(false)} />}</section>
}

function BalanceReveal({ units }: { units: number }) {
  const [visible, setVisible] = useState(false)
  return (
    <button className={cx('balance-reveal', visible && 'is-visible')} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setVisible(true) }} onPointerUp={() => setVisible(false)} onPointerCancel={() => setVisible(false)} onContextMenu={(event) => event.preventDefault()}>
      <span>{visible ? <><small>当前余额</small><CoinValue units={units} /></> : <><small>余额已隐藏</small><strong>长按查看</strong></>}</span>
      <i aria-hidden="true">{visible ? '◉' : '—'}</i>
    </button>
  )
}

function IdentityReveal({ player, session }: { player: Player; session: GameSession }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const identity = player.identity
  const definition = identity ? getIdentityDefinition(identity.id) : null
  return <>
    <button className="identity-reveal" aria-label="查看身份详情" onClick={() => setDetailOpen(true)}>
      <span><small>身份已隐藏</small><strong>点击查看身份</strong></span><i aria-hidden="true">?</i>
    </button>
    {detailOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="identity-detail-title"><div className="identity-detail-sheet"><span className="identity-detail-mark">{definition?.symbol ?? '?'}</span><p className="eyebrow">仅自己可见</p><h2 id="identity-detail-title">身份档案</h2><div className="identity-detail-placeholder"><small>当前身份 · {identity ? (identitySkillMode(identity.id) === 'active' ? '主动技能' : '被动技能') : '未启用'}</small><strong>{definition?.name ?? '本局未启用身份'}</strong><p>{definition?.summary ?? '在高级设置中开启身份系统后，下局会进行私密选角。'}{identity ? identitySkillMode(identity.id) === 'active' ? ' 主动技能请在自己的回合，到「身份技能」区点击按钮发动。' : ' 被动技能无需点击，系统会自动结算。' : ''}{identity?.id === 'thief' && identity.targetPlayerId ? ` 目标：${playerName(session.players, identity.targetPlayerId)}。` : ''}</p></div><button className="button button--primary" onClick={() => setDetailOpen(false)}>收起身份详情</button></div></div>}
  </>
}

function PlayerTargetPicker({
  title,
  detail,
  players,
  selectedPlayerId,
  onSelect,
  onClose,
}: {
  title: string
  detail: string
  players: Player[]
  selectedPlayerId?: string | null
  onSelect: (playerId: string) => void
  onClose: () => void
}) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="target-picker-title"><section className="target-picker-sheet"><p className="eyebrow">选择对象</p><h2 id="target-picker-title">{title}</h2><p>{detail}</p><div className="target-picker-grid">{players.map((candidate) => <button key={candidate.id} className={cx(candidate.id === selectedPlayerId && 'is-selected')} onClick={() => onSelect(candidate.id)}><span style={{ background: candidate.color }}>{candidate.name.slice(0, 1)}</span><div><strong>{candidate.name}</strong><small>{candidate.id === selectedPlayerId ? '当前选择' : '点击选择此玩家'}</small></div><i>→</i></button>)}</div><button className="button button--paper" onClick={onClose}>取消</button></section></div>
}

function LobbyistTaskPicker({ extraCost, onSelect, onClose }: { extraCost: number; onSelect: (taskType: LobbyistTaskType | null) => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lobby-task-picker-title"><section className="target-picker-sheet lobby-task-picker"><p className="eyebrow">说客 · 发动技能</p><h2 id="lobby-task-picker-title">选择发布方式</h2><p>随后会自动进入人物卡选择。两种方式的基础发布费用照常计算，只有“指定发布”会额外收费。</p><section className="lobby-task-section"><div><strong>随机发布</strong><span className="status-token status-token--free">不额外支付</span></div><small>系统随机决定任务内容，适合低成本施压。</small><button className="lobby-task-card lobby-task-card--random" onClick={() => onSelect(null)}><span>?</span><div><strong>随机抽取一张任务</strong><small>内容由系统现在锁定，下一轮私密送达。</small></div><i>→</i></button></section><section className="lobby-task-section"><div><strong>指定发布</strong><span className="status-token status-token--cost">额外支付 {extraCost} 金币</span></div><small>自己挑选要对对方提出的任务。</small><div className="lobby-task-grid">{LOBBYIST_TASKS.map((task) => <button key={task.type} className="lobby-task-card" onClick={() => onSelect(task.type)}><span>{task.needsComparison ? '↔' : task.type === 'winFirst' ? 'Ⅰ' : task.type === 'winSecond' ? 'Ⅱ' : task.type === 'bidZero' ? '0' : '—'}</span><div><strong>{task.label}</strong><small>{task.detail}</small></div><i>→</i></button>)}</div></section><button className="button button--paper" onClick={onClose}>取消</button></section></div>
}

function ProphetResult({ divination, session }: { divination: ProphetDivination; session: GameSession }) {
  if (divination.mode === 'wealth' && divination.wealth) return <div className="prophet-result"><strong>观财已启示</strong><span>本轮开始时，最高余额：约 {formatCoins(divination.wealth.highestRangeUnits[0])}–{formatCoins(divination.wealth.highestRangeUnits[1])} 金币</span><span>本轮开始时，最低余额：约 {formatCoins(divination.wealth.lowestRangeUnits[0])}–{formatCoins(divination.wealth.lowestRangeUnits[1])} 金币</span><small>不对应任何姓名；范围已锁定，刷新不会改变。</small></div>
  if (divination.mode === 'stars') {
    const items = (divination.starItemIds ?? []).map((id) => session.prophecyDeck.find((item) => item.id === id) ?? ITEM_POOL.find((item) => item.id === id)).filter(Boolean)
    return <div className="prophet-result"><strong>观星已启示</strong><span>未来拍品：{items.map((item) => `${item!.emoji}${item!.name}`).join('、') || '没有未来拍品'}</span><small>看到的是预设牌堆；改拍令不会改变这份预言。</small></div>
  }
  const guess = divination.identityGuess
  return <div className="prophet-result"><strong>观身份已启示</strong><span>{guess?.correct ? `你猜对了 ${playerName(session.players, guess.targetPlayerId)} 的身份：${getIdentityDefinition(guess.identityId).name}。${guess.rewardCardId ? `获得 ${getCardDefinition(guess.rewardCardId).name}。` : '卡池没有可用道具。'}` : `你猜错了 ${playerName(session.players, guess?.targetPlayerId ?? null)} 的身份；费用不退，但没有额外罚款。`}</span><small>同一玩家与身份组合不能再次猜测。</small></div>
}

function PrivateTurn({ session, onSubmit, onAcknowledgeGrant, onAcknowledgeNotice, onStartPrizeReroll, onChoosePrizeReroll, onUseProphetDivination, onArmDeadline }: { session: GameSession; onSubmit: (turn: RoundTurn, timedOut?: boolean) => void; onAcknowledgeGrant: (playerId: string) => void; onAcknowledgeNotice: (noticeId: string) => void; onStartPrizeReroll: (playerId: string) => void; onChoosePrizeReroll: (itemId: string) => void; onUseProphetDivination: (playerId: string, mode: ProphetDivination['mode'], targetPlayerId?: string, identityId?: IdentityId) => boolean; onArmDeadline: () => void }) {
  const player = session.players[session.currentTurnIndex]
  const item = session.itemDeck[session.roundIndex]
  const tutorial = session.tutorial?.kind === 'firstGame'
  const predictionUnlocked = !tutorial || session.roundIndex >= 1
  const advancedToolsUnlocked = !tutorial || session.roundIndex >= 2
  const [bidUnits, setBidUnits] = useState(0)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [confirmedCardUses, setConfirmedCardUses] = useState<CardUse[]>([])
  const [cardConfirming, setCardConfirming] = useState<CardUse | null>(null)
  const [coinFlipResult, setCoinFlipResult] = useState<'heads' | 'tails' | null>(null)
  const [coinFlipStarted, setCoinFlipStarted] = useState(false)
  const [peekResult, setPeekResult] = useState<RoundTurn | null>(null)
  const [identityAction, setIdentityAction] = useState<IdentityAction | undefined>()
  const [targetPicker, setTargetPicker] = useState<'card' | 'kidnap' | 'lobbyTask' | 'lobbyTarget' | 'lobbyComparison' | null>(null)
  const [lobbyTargetId, setLobbyTargetId] = useState('')
  const [lobbySpecified, setLobbySpecified] = useState(false)
  const [lobbyTask, setLobbyTask] = useState<LobbyistTaskType>('avoidPrize')
  const [lobbyCompareId, setLobbyCompareId] = useState('')
  const [identityConfirming, setIdentityConfirming] = useState<ScheduledIdentityAction | null>(null)
  const [prophetDialog, setProphetDialog] = useState<'menu' | 'target' | 'identity' | null>(null)
  const [prophetTargetId, setProphetTargetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const setBid = (value: number) => {
    const reservedIdentityUnits = identityAction?.type === 'reverserInvert'
      ? Math.round(session.settings.identitySettings.reverserActivationCoins * (session.roundIndex >= session.settings.rounds - 2 ? 4 : 2))
      : identityAction?.type === 'kidnap' ? Math.round(session.settings.identitySettings.kidnapActivationCoins * 2) : 0
    setBidUnits(Math.max(0, Math.min(player.balanceUnits - reservedIdentityUnits, Math.round(value))))
  }
  const predicted = session.players.find((candidate) => candidate.id === prediction)
  const previousTurns = session.turns.filter((turn) => turn.playerId !== player.id)
  const targetPlayers = previousTurns.map((turn) => session.players.find((candidate) => candidate.id === turn.playerId)).filter(Boolean) as Player[]
  const targetPlayersForCard = (cardId: CardId): Player[] => cardTargetScope(cardId) === 'other'
    ? session.players.filter((candidate) => candidate.id !== player.id)
    : cardTargetScope(cardId) === 'previous' ? targetPlayers : []
  const grant = session.pendingCardGrants.find((entry) => entry.playerId === player.id && !entry.announced)
  const lockedPrizeReroll = session.pendingPrizeReroll?.playerId === player.id && session.pendingPrizeReroll.roundIndex === session.roundIndex ? session.pendingPrizeReroll : null
  const cardSlotsRemaining = 2 - confirmedCardUses.length - (lockedPrizeReroll ? 1 : 0)
  const canSubmitCards = !cardConfirming && targetPicker !== 'card' && (!lockedPrizeReroll || Boolean(lockedPrizeReroll.chosenItemId))
  const openCardConfirmation = (use: CardUse) => {
    setCardConfirming(use)
    setCoinFlipResult(use.cardId === 'fateCoin' ? null : 'heads')
    setCoinFlipStarted(false)
  }
  const lockCardUse = (use: CardUse) => {
    setConfirmedCardUses((uses) => [...uses, use])
    setCardConfirming(null)
    setCoinFlipResult(null)
    setCoinFlipStarted(false)
  }
  const confirmCardUse = () => {
    if (!cardConfirming) return
    if (cardTargetScope(cardConfirming.cardId) !== 'none' && !cardConfirming.targetPlayerId) {
      setTargetPicker('card')
      return
    }
    if (cardConfirming.cardId === 'fateCoin' && !coinFlipStarted) {
      setCoinFlipStarted(true)
      return
    }
    if (cardConfirming.cardId === 'fateCoin' && !coinFlipResult) return
    if (cardConfirming.cardId === 'prizeReroll') {
      onStartPrizeReroll(player.id)
      setCardConfirming(null)
      return
    }
    const use: CardUse = cardConfirming.cardId === 'fateCoin' ? { ...cardConfirming, coinResult: coinFlipResult as 'heads' | 'tails' } : cardConfirming
    lockCardUse(use)
  }
  useEffect(() => {
    if (cardConfirming?.cardId !== 'fateCoin' || !coinFlipStarted || coinFlipResult !== null) return
    const timer = window.setTimeout(() => setCoinFlipResult(Math.random() < 0.5 ? 'heads' : 'tails'), 900)
    return () => window.clearTimeout(timer)
  }, [cardConfirming, coinFlipResult, coinFlipStarted])
  const identity = advancedToolsUnlocked ? player.identity : undefined
  const visibleCardInventory = advancedToolsUnlocked ? player.cardInventory : []
  const currentProphetDivination = session.prophetDivinations.find((entry) => entry.playerId === player.id && entry.roundIndex === session.roundIndex)
  const prophetCostUnits = Math.round(session.settings.identitySettings.prophetDivinationCoins * 2)
  const prophetShortfallUnits = Math.max(0, bidUnits + prophetCostUnits - player.balanceUnits)
  const prophetFutureItems = session.prophecyDeck.slice(session.roundIndex + 1, session.roundIndex + 3)
  const prophetTargetAlreadySolved = (targetPlayerId: string) => session.prophetDivinations.some((entry) => entry.playerId === player.id && entry.mode === 'identity' && entry.identityGuess?.targetPlayerId === targetPlayerId && entry.identityGuess.correct)
  const lobbyFee = ((session.roundIndex === 0 && session.settings.identitySettings.lobbyistFirstRoundFree) || identity?.lobbyistNextFree) ? 0 : session.settings.identitySettings.lobbyistFeeCoins
  const reverserCost = session.settings.identitySettings.reverserActivationCoins * (session.roundIndex >= session.settings.rounds - 2 ? 2 : 1)
  const reverserCostUnits = Math.round(reverserCost * 2)
  const reverserShortfallUnits = Math.max(0, bidUnits + reverserCostUnits - player.balanceUnits)
  const reverserAffordable = reverserShortfallUnits === 0
  const kidnapCostUnits = Math.round(session.settings.identitySettings.kidnapActivationCoins * 2)
  const kidnapShortfallUnits = Math.max(0, bidUnits + kidnapCostUnits - player.balanceUnits)
  const kidnapAffordable = kidnapShortfallUnits === 0
  const merchantAuctionCount = identity?.merchantAuctionCount ?? (identity?.merchantAuctionUsed ? 1 : 0)
  const merchantUnavailableReason = identity?.id !== 'merchant' ? null : merchantAuctionCount >= session.settings.identitySettings.merchantAuctionLimit ? `本局竞购已用完（${merchantAuctionCount}/${session.settings.identitySettings.merchantAuctionLimit}）` : identity.merchantLastAuctionRound === session.roundIndex ? '同一回合只能发起一次竞购' : session.roundIndex >= session.settings.rounds - 1 ? '最后一轮无法发起下轮竞购' : session.cardDeck.length === 0 ? '卡池为空，无法发起竞购' : null
  const lobbyBaseCostUnits = Math.round((lobbyFee + (lobbySpecified ? session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins : 0)) * 2)
  const lobbyShortfallUnits = Math.max(0, bidUnits + lobbyBaseCostUnits - player.balanceUnits)
  const lobbyOpeningShortfallUnits = Math.max(0, bidUnits + Math.round(lobbyFee * 2) - player.balanceUnits)
  const lobbyUnavailableReason = identity?.id !== 'lobbyist' ? null : session.roundIndex >= session.settings.rounds - 1 ? '最后一轮无法发布任务' : identity.lobbyistLastIssuedRound === session.roundIndex ? '本轮任务已发布' : null
  const lobbyActionValid = identityAction?.type !== 'lobbyistContract' || Boolean(lobbyTargetId) && (!identityAction.specified || (!taskRequiresComparison(lobbyTask) || Boolean(lobbyCompareId) && lobbyCompareId !== lobbyTargetId))
  const fixedAssets = calculateFixedAssets(player.items, identity?.id === 'collector' ? identity.collectorCategory : undefined).filter((asset) => asset.itemCount > 0)
  const activeLobbyTasks = session.identityContracts.filter((contract) => contract.targetPlayerId === player.id && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex)
  const playerNotices = session.pendingIdentityNotices.filter((notice) => notice.playerId === player.id).sort((left, right) => {
    const priority = (notice: typeof left) => notice.title.includes('任务') ? 0 : notice.title.includes('道具') ? 1 : 2
    return priority(left) - priority(right)
  })
  const activeNotice = playerNotices[0]
  const visibleGrant = !activeNotice ? grant : undefined
  const operationReady = !activeNotice && !visibleGrant
  useEffect(() => {
    if (session.settings.turnTimerEnabled && operationReady && !session.operationDeadlineAt) onArmDeadline()
  }, [operationReady, session.operationDeadlineAt, session.settings.turnTimerEnabled, onArmDeadline])
  const submitCurrentChoice = (timedOut = false) => {
    if (timedOut) {
      setConfirming(false)
      setIdentityConfirming(null)
      setTargetPicker(null)
      setCardConfirming(null)
      setCoinFlipStarted(false)
    }
    const resolvedIdentityAction = identityAction ?? (currentProphetDivination ? { type: 'prophetDivination' as const, divinationId: currentProphetDivination.id } : undefined)
    onSubmit({ playerId: player.id, bidUnits, predictedPlayerId: prediction, ...(confirmedCardUses.length > 0 ? { cardUses: confirmedCardUses } : {}), ...(resolvedIdentityAction ? { identityAction: resolvedIdentityAction } : {}) }, timedOut)
  }
  return (
    <section className="private-turn">
      <div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>你的回合</h1></div><div className="private-overview"><BalanceReveal units={player.balanceUnits} /><IdentityReveal player={identity ? player : { ...player, identity: undefined }} session={session} /></div></div>
      {session.settings.turnTimerEnabled && operationReady && <OperationTimer deadlineAt={session.operationDeadlineAt} onExpire={() => submitCurrentChoice(true)} />}
      {tutorial && <TutorialCoach roundIndex={session.roundIndex} />}
      {activeLobbyTasks.length > 0 && <section className="task-inbox" aria-label="本轮收到的任务">
        <div className="task-inbox__head"><span aria-hidden="true">✉</span><strong>收到的任务</strong><small>完成则无需付款</small></div>
        <div>{activeLobbyTasks.map((contract) => <article key={contract.id}><span>{taskLabel(contract.taskType)}{contract.comparisonPlayerId ? ` ${playerName(session.players, contract.comparisonPlayerId)}` : ''}</span><small>未完成支付 {formatCoins(Math.round(session.settings.identitySettings.lobbyistFailurePaymentCoins * 2))} 金币</small></article>)}</div>
      </section>}
      <div className="turn-grid">
        <div className="bid-panel panel">
          <PrizeCard item={item} compact />
          <div className="reward-strip">{session.settings.rewardMultipliers.map((multiplier, index) => <span key={index}><small>{MEDALS[index]} 名</small><CoinValue units={Math.round(item.value * 2 * multiplier)} /></span>)}</div>
          <div className="bid-control">
            <div className="bid-readout"><small>我的秘密下注</small><strong><CoinValue units={bidUnits} /></strong></div>
            <input className="range range--bid" aria-label="秘密下注" type="range" min="0" max={Math.max(0, player.balanceUnits - (identityAction?.type === 'reverserInvert' ? reverserCostUnits : identityAction?.type === 'kidnap' ? kidnapCostUnits : 0))} step="1" value={bidUnits} onChange={(event) => setBid(Number(event.target.value))} />
            <div className="bid-shortcuts"><button onClick={() => setBid(bidUnits - 1)}>−0.5</button><button onClick={() => setBid(bidUnits + 1)}>+0.5</button><button onClick={() => setBid(bidUnits + 2)}>+1</button><button onClick={() => setBid(bidUnits + 10)}>+5</button><button onClick={() => setBid(player.balanceUnits)}>全部</button></div>
          </div>
        </div>
        <div className={cx('prediction-panel panel', !predictionUnlocked && 'is-locked')}>
          <div className="panel-title"><div><p className="eyebrow">可选</p><h2>谁会拿第一？</h2></div><span>猜中 +{item.value * session.settings.correctPredictionMultiplier}{identity?.id === 'gambler' ? ` + ${item.value * session.settings.identitySettings.gamblerCorrectBonusMultiplier}` : ''}<br />{identity?.id === 'gambler' ? `猜错 −${item.value * session.settings.identitySettings.gamblerWrongPenaltyMultiplier} · 跳过 −${item.value * session.settings.identitySettings.gamblerSkipPenaltyMultiplier}` : `猜错 −${item.value * session.settings.wrongPredictionMultiplier}`}</span></div>
          {!predictionUnlocked && <p className="tutorial-locked-copy">下一轮解锁：先把秘密下注练熟。</p>}
          <button className={cx('prediction-skip', prediction === null && 'is-selected')} disabled={!predictionUnlocked} onClick={() => setPrediction(null)}><span>稳一手</span><small>这轮不预测</small><i>{prediction === null ? '✓' : ''}</i></button>
          <div className="prediction-list">
            {session.players.filter((candidate) => candidate.id !== player.id).map((candidate) => <button key={candidate.id} disabled={!predictionUnlocked} className={cx(prediction === candidate.id && 'is-selected')} onClick={() => setPrediction(candidate.id)} style={{ '--player-color': candidate.color } as React.CSSProperties}><span>{candidate.name.slice(0, 1)}</span><strong>{candidate.name}</strong><i>{prediction === candidate.id ? '✓' : ''}</i></button>)}
          </div>
        </div>
      </div>
      <section className="private-assets panel">
        <div className="panel-title"><div><p className="eyebrow">仅自己可见</p><h2>我的固定资产</h2></div><span>只在终局计入总资产</span></div>
        {fixedAssets.length === 0 ? <p className="empty-assets">还没有拍下任何物品。收集同类拍品达到 2 件后即可触发固定资产加成。</p> : <div className="private-asset-list">{fixedAssets.map((asset) => {
          const config = categoryConfig(asset.category)
          const items = player.items.filter(({ item: wonItem }) => wonItem.category === asset.category)
          return <article key={asset.category} className="private-asset-row"><span>{config.symbol}</span><div><strong>{config.name} · {asset.itemCount} 件</strong><small>{items.map(({ item: wonItem }) => `${wonItem.emoji}${wonItem.name}`).join(' · ')}</small></div><div className="private-asset-value">{asset.units > 0 ? <><CoinValue units={asset.units} signed /><small>当前终局加成</small></> : <><strong>再收 {2 - asset.itemCount} 件</strong><small>即可触发加成</small></>}</div></article>
        })}</div>}
      </section>
      <section className="identity-skills panel">
        <div className="panel-title"><div><p className="eyebrow">仅自己可见</p><h2>身份技能</h2></div><span>{identity ? getIdentityDefinition(identity.id).name : '未启用身份'}</span></div>
        {!identity ? <div className="identity-skill-placeholder"><span>◎</span><div><strong>本局未启用身份系统</strong><small>下局可在高级设置中开启。</small></div></div> : <div className="identity-live">
          <div className="identity-live-head"><span>{getIdentityDefinition(identity.id).symbol}</span><div><strong>{getIdentityDefinition(identity.id).name}</strong><small>{getIdentityDefinition(identity.id).summary}</small></div></div>
          <p className="identity-task">{identitySkillMode(identity.id) === 'active' ? '主动技能：请在这个区域完成选择，再点击对应按钮安排本轮发动。' : '被动技能：没有可点击的主动技能；系统会在符合条件时自动结算。'}</p>
          {identity.id === 'prophet' && <div className="prophet-skill"><p><strong>天机推演</strong>是主动技能：每回合至多一次，花费 <b className="status-token status-token--cost">{session.settings.identitySettings.prophetDivinationCoins} 金币</b>，从观财、观星、观身份中选一种。选择后立即生效并保存。</p>{currentProphetDivination ? <ProphetResult divination={currentProphetDivination} session={session} /> : <button className="button button--prophet" disabled={prophetShortfallUnits > 0} onClick={() => setProphetDialog('menu')}>{prophetShortfallUnits > 0 ? `余额不足，还差 ${formatCoins(prophetShortfallUnits)} 金币` : '发动天机推演'}</button>}</div>}
          {identity.id === 'assassin' && <><p>花费 {session.settings.identitySettings.kidnapActivationCoins} 金币选择一名玩家。若他拿下本轮拍品，费用会报销，拍品会被你抢走；失败则这笔钱不会返还。</p><button className={cx('button', identityAction?.type === 'kidnap' && 'button--primary')} disabled={!identityAction && !kidnapAffordable} onClick={() => identityAction?.type === 'kidnap' ? setIdentityAction(undefined) : setTargetPicker('kidnap')}>{identityAction?.type === 'kidnap' ? `已盯上 ${playerName(session.players, identityAction.targetPlayerId)} · 点击撤销` : kidnapAffordable ? `花费 ${session.settings.identitySettings.kidnapActivationCoins} 金币选择目标` : `余额不足，还差 ${formatCoins(kidnapShortfallUnits)} 金币`}</button></>}
          {identity.id === 'collector' && <p>已为 <strong>{categoryConfig(identity.collectorCategory ?? 'leisure').name}</strong> 永久额外计入 1 件固定资产。</p>}
          {identity.id === 'thief' && <p>目标：<strong>{playerName(session.players, identity.targetPlayerId ?? null)}</strong> · 成功 {identity.thiefSuccesses}/{session.settings.identitySettings.thiefMaxSteals} 次。</p>}
          {identity.id === 'reverser' && <><p>花费 {reverserCost} 金币，倒转本轮获奖区内的所有名次；最后两轮费用翻倍。若同时使用“逆转排名”道具卡，两次逆转会抵消。</p><button className={cx('button', identityAction?.type === 'reverserInvert' && 'button--primary')} disabled={!identityAction && !reverserAffordable} onClick={() => identityAction?.type === 'reverserInvert' ? setIdentityAction(undefined) : setIdentityConfirming({ type: 'reverserInvert' })}>{identityAction?.type === 'reverserInvert' ? '已安排逆转排名 · 点击撤销' : reverserAffordable ? `花费 ${reverserCost} 金币发动` : `余额不足，还差 ${formatCoins(reverserShortfallUnits)} 金币`}</button></>}
          {identity.id === 'merchant' && <><p>{merchantUnavailableReason ?? <>还可发起 <b className="status-token status-token--count">{session.settings.identitySettings.merchantAuctionLimit - merchantAuctionCount} 次</b>：下一轮抽奖前公开一张卡，其他玩家秘密竞购。</>}</p><button className={cx('button', identityAction?.type === 'merchantAuction' && 'button--primary')} disabled={Boolean(merchantUnavailableReason)} onClick={() => identityAction?.type === 'merchantAuction' ? setIdentityAction(undefined) : setIdentityConfirming({ type: 'merchantAuction' })}>{identityAction?.type === 'merchantAuction' ? '已安排下轮竞购 · 点击撤销' : merchantUnavailableReason ?? '发起下轮竞购'}</button></>}
          {identity.id === 'lobbyist' && <>{lobbyUnavailableReason ? <><p>{lobbyUnavailableReason}。</p><button className="button" disabled>{lobbyUnavailableReason}</button></> : <div className="lobbyist-form"><strong>发布下一轮任务 {lobbyFee === 0 ? <b className="status-token status-token--free">本轮免费</b> : <>· 基础费用 {lobbyFee} 金币</>}</strong><p>发动后先选任务卡，再自动进入人物卡选择。指定任务额外支付 {session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins} 金币。</p><button className={cx('button', identityAction?.type === 'lobbyistContract' && 'button--primary')} disabled={identityAction?.type !== 'lobbyistContract' && lobbyOpeningShortfallUnits > 0} onClick={() => identityAction?.type === 'lobbyistContract' ? setIdentityAction(undefined) : setTargetPicker('lobbyTask')}>{identityAction?.type === 'lobbyistContract' ? lobbyShortfallUnits > 0 ? `任务已选，但余额还差 ${formatCoins(lobbyShortfallUnits)} 金币` : `已安排：${identityAction.specified && identityAction.taskType ? taskLabel(identityAction.taskType) : '随机任务'} → ${playerName(session.players, identityAction.targetPlayerId)} · 点击撤销` : lobbyOpeningShortfallUnits > 0 ? `余额不足，还差 ${formatCoins(lobbyOpeningShortfallUnits)} 金币` : '发动技能'}</button></div>}</>}</div>}
      </section>
      <section className="card-inventory panel">
        <div className="panel-title"><div><p className="eyebrow">仅自己可见</p><h2>我的道具</h2></div><span>本轮还可使用 <b className="status-token status-token--count">{cardSlotsRemaining} 张</b></span></div>
        {visibleCardInventory.length === 0 ? <p className="empty-cards">{tutorial && !advancedToolsUnlocked ? '第 3 轮会解锁一张简单道具卡；先专注这一轮的新选择。' : '暂时没有道具卡。落后时，下一轮可能得到秘密支援。'}</p> : <div className="card-list">{visibleCardInventory.map((cardId) => {
          const card = getCardDefinition(cardId)
          const unavailable = cardTargetScope(cardId) !== 'none' && targetPlayersForCard(cardId).length === 0
          const confirmed = confirmedCardUses.find((use) => use.cardId === cardId)
          const prizeRerollUnavailable = cardId === 'prizeReroll' && session.roundIndex >= session.settings.rounds - 1
          const prizeRerollBusy = cardId === 'prizeReroll' && Boolean(lockedPrizeReroll)
          const passiveShield = cardId === 'reflectShield'
          const nonCancelable = cardId === 'fateCoin' || cardId === 'peek'
          return <button key={cardId} className={cx('card-choice', (confirmed || prizeRerollBusy) && 'is-selected')} disabled={passiveShield || (nonCancelable && Boolean(confirmed)) || (!confirmed && (unavailable || prizeRerollUnavailable || prizeRerollBusy || cardSlotsRemaining === 0))} onClick={() => { if (confirmed) { setConfirmedCardUses((uses) => uses.filter((use) => use.cardId !== cardId)); return } openCardConfirmation({ cardId }) }}><span>{card.symbol}</span><div><strong>{card.name}</strong><small>{passiveShield ? '自动防御：受到香蕉皮或偷天换日影响时自动反弹并消耗，不占本轮道具次数。' : confirmed ? cardId === 'fateCoin' ? '硬币结果已锁定，本轮不能重掷。' : cardId === 'peek' ? '已查看投资额，本轮使用已锁定。' : '本轮已安排，点击取消。' : prizeRerollUnavailable ? '最后一轮没有下一轮拍品，无法使用。' : prizeRerollBusy ? '候选拍品已锁定，请完成选择。' : unavailable ? '本轮尚无可选目标，可留到后续回合使用。' : cardSlotsRemaining === 0 ? '本轮已安排两张道具。' : card.description}</small></div><i>{(confirmed || prizeRerollBusy) ? '✓' : ''}</i></button>
        })}</div>}
      </section>
      {lockedPrizeReroll && <section className="panel prize-reroll-picker" aria-label="改拍令选择">
        <div className="panel-title"><div><p className="eyebrow">仅自己可见 · 已锁定</p><h2>改拍令：选择下一轮拍品</h2></div><span>{lockedPrizeReroll.chosenItemId ? '选择已确定' : '必须选择 1 件'}</span></div>
        <p>{lockedPrizeReroll.chosenItemId ? '你已锁定下一轮拍品，不能更改。' : '这 6 张拍品已在确认后抽出并写入存档；选择后不能撤销或重抽。'}</p>
        <div className="prize-reroll-options">{lockedPrizeReroll.offeredItems.map((candidate) => <button key={candidate.id} className={cx('prize-reroll-option', lockedPrizeReroll.chosenItemId === candidate.id && 'is-selected')} disabled={Boolean(lockedPrizeReroll.chosenItemId)} onClick={() => onChoosePrizeReroll(candidate.id)}><span>{candidate.emoji}</span><strong>{candidate.name}</strong><small>价值 {candidate.value}</small></button>)}</div>
      </section>}
      <div className="private-submit"><p><span>下注 <strong>{unitsToCoins(bidUnits)}</strong></span><span>预测 <strong>{predicted?.name ?? '跳过'}</strong></span><span>道具 <strong>{[...confirmedCardUses.map((use) => getCardDefinition(use.cardId).name), ...(lockedPrizeReroll ? ['改拍令'] : [])].join('、') || '不使用'}</strong></span></p><button className="button button--primary button--large" disabled={!canSubmitCards || !lobbyActionValid || (identityAction?.type === 'lobbyistContract' && lobbyShortfallUnits > 0)} onClick={() => setConfirming(true)}>确认我的选择</button></div>
      {confirming && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-sheet">
            <p className="eyebrow">最后确认</p><h2 id="confirm-title">提交后不能修改</h2>
            <div className="confirm-summary"><span>秘密下注 <strong><CoinValue units={bidUnits} /></strong></span><span>预测第一 <strong>{predicted?.name ?? '不预测'}</strong></span><span>使用道具 <strong>{[...confirmedCardUses.map((use) => `${getCardDefinition(use.cardId).name}${use.targetPlayerId ? ` · ${playerName(session.players, use.targetPlayerId)}` : ''}`), ...(lockedPrizeReroll ? ['改拍令'] : [])].join('、') || '不使用'}</strong></span></div>
            <p>提交后请立刻把设备传给下一位，不要停留在此页。</p>
            <div><button className="button button--paper" onClick={() => setConfirming(false)}>再想想</button><button className="button button--primary" onClick={() => submitCurrentChoice()}>确定提交</button></div>
          </div>
        </div>
      )}
      {prophetDialog === 'menu' && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="target-picker-sheet prophet-picker"><p className="eyebrow">预言家 · 天机推演</p><h2>花费 {session.settings.identitySettings.prophetDivinationCoins} 金币，选择一种推演</h2><p>选择后立即扣费并锁定本轮结果；观身份猜错不退费，但没有额外罚款。</p><div className="prophet-option-grid"><button onClick={() => { if (onUseProphetDivination(player.id, 'wealth')) setProphetDialog(null) }}><span>◒</span><strong>观财</strong><small>读取本轮开始时的最高、最低余额区间，不显示姓名。</small></button><button disabled={prophetFutureItems.length === 0} onClick={() => { if (onUseProphetDivination(player.id, 'stars')) setProphetDialog(null) }}><span>✦</span><strong>观星</strong><small>{prophetFutureItems.length > 0 ? '查看未来至多两轮的预设拍品。' : '最后一轮没有未来拍品。'}</small></button><button onClick={() => setProphetDialog('target')}><span>◉</span><strong>观身份</strong><small>猜一名玩家的身份；猜对获得一张道具。</small></button></div><button className="button button--paper" onClick={() => setProphetDialog(null)}>取消使用</button></section></div>}
      {prophetDialog === 'target' && <PlayerTargetPicker title="选择要观测身份的玩家" detail="本回合只能猜一次；猜对过的玩家不能再猜。之后会显示所有启用身份供你猜测。" players={session.players.filter((candidate) => candidate.id !== player.id && !prophetTargetAlreadySolved(candidate.id))} selectedPlayerId={prophetTargetId} onSelect={(id) => { setProphetTargetId(id); setProphetDialog('identity') }} onClose={() => setProphetDialog(null)} />}
      {prophetDialog === 'identity' && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="target-picker-sheet prophet-picker"><p className="eyebrow">预言家 · 观身份</p><h2>猜测 {playerName(session.players, prophetTargetId)} 的身份</h2><p>候选包含全部未禁用身份，即使某身份已被别人选走。猜错只损失本次 {session.settings.identitySettings.prophetDivinationCoins} 金币。</p><div className="identity-choice-grid prophet-identity-grid">{IDENTITY_DEFINITIONS.filter((definition) => !session.settings.identitySettings.disabledIdentityIds.includes(definition.id)).map((definition) => { const allowed = canMakeIdentityGuess(session.prophetDivinations, player.id, prophetTargetId, definition.id); return <button key={definition.id} disabled={!allowed} className="identity-choice-card" onClick={() => { if (onUseProphetDivination(player.id, 'identity', prophetTargetId, definition.id)) setProphetDialog(null) }}><span>{definition.symbol}</span><h2>{definition.name}</h2><p>{allowed ? '确认猜测此身份' : '这个玩家与身份组合已经猜过'}</p></button> })}</div><button className="button button--paper" onClick={() => setProphetDialog('target')}>返回选人</button></section></div>}
      {cardConfirming && targetPicker !== 'card' && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="card-confirm-title"><div className="confirm-sheet card-use-confirm"><p className="eyebrow">{cardConfirming.cardId === 'fateCoin' ? coinFlipStarted ? '命运硬币' : '准备使用道具' : '准备使用道具'}</p><h2 id="card-confirm-title">{getCardDefinition(cardConfirming.cardId).name}</h2>{cardConfirming.cardId === 'fateCoin' ? <div className="fate-coin-wrap"><div className={cx('fate-coin', coinFlipResult && 'is-settled')}><span>{coinFlipResult === 'heads' ? '正' : coinFlipResult === 'tails' ? '反' : '?'}</span></div><p>{!coinFlipStarted ? '确认后才会掷出硬币；结果出现后不能取消或重掷。' : coinFlipResult === null ? '硬币正在翻转…' : coinFlipResult === 'heads' ? '正面朝上：本轮获得 6 金币。结果已锁定。' : '反面朝上：本轮损失 4 金币。结果已锁定。'}</p></div> : cardConfirming.cardId === 'prizeReroll' ? <p>确认后将立刻抽出 6 张新拍品，供你私密选择下一轮拍品。抽取结果会立即锁定，不能取消或重抽。</p> : cardTargetScope(cardConfirming.cardId) !== 'none' ? <p>确认后会立刻弹出玩家卡片，请选择这张卡的生效对象；选择前随时可以取消。</p> : <p>确认后，这张卡会安排在本轮结算时使用。</p>}<div>{!(cardConfirming.cardId === 'fateCoin' && coinFlipStarted) && <button className="button button--paper" onClick={() => { setCardConfirming(null); setCoinFlipResult(null); setCoinFlipStarted(false) }}>取消</button>}<button className="button button--primary" disabled={cardConfirming.cardId === 'fateCoin' && coinFlipStarted && coinFlipResult === null} onClick={confirmCardUse}>{cardConfirming.cardId === 'fateCoin' ? !coinFlipStarted ? '确认并掷硬币' : coinFlipResult === null ? '正在掷硬币…' : '确认结果' : cardConfirming.cardId === 'prizeReroll' ? '确认并抽取 6 张' : cardTargetScope(cardConfirming.cardId) !== 'none' ? '确认并选择玩家' : '确认使用'}</button></div></div></div>}
      {identityConfirming && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="identity-confirm-title"><div className="confirm-sheet identity-action-confirm"><p className="eyebrow">确认身份技能</p><h2 id="identity-confirm-title">{identityConfirming.type === 'kidnap' ? '锁定绑匪目标' : identityConfirming.type === 'reverserInvert' ? '发动逆转排名' : identityConfirming.type === 'merchantAuction' ? '发起下轮竞购' : '发布说客任务'}</h2><p>{identityConfirming.type === 'kidnap' ? `花费 ${session.settings.identitySettings.kidnapActivationCoins} 金币盯上 ${playerName(session.players, identityConfirming.targetPlayerId)}。若对方拿下拍品，你会获得拍品并报销费用。` : identityConfirming.type === 'reverserInvert' ? `花费 ${reverserCost} 金币，在本轮结算时倒转获奖区名次。` : identityConfirming.type === 'merchantAuction' ? `下一轮抽奖前公开一张道具，让其他玩家依次秘密竞购；本轮提交前仍可撤销。` : `向 ${playerName(session.players, identityConfirming.targetPlayerId)} 发布${identityConfirming.specified && identityConfirming.taskType ? `指定任务「${taskLabel(identityConfirming.taskType)}」` : '随机任务'}，下一轮才会私密送达。`}</p><div><button className="button button--paper" onClick={() => setIdentityConfirming(null)}>取消</button><button className="button button--primary" onClick={() => { setIdentityAction(identityConfirming); setIdentityConfirming(null) }}>确认安排</button></div></div></div>}
      {visibleGrant && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="card-grant-sheet"><span>{getCardDefinition(visibleGrant.cardId).symbol}</span><p className="eyebrow">秘密支援</p><h2 id="grant-title">你获得了{getCardDefinition(visibleGrant.cardId).name}</h2><p>{getCardDefinition(visibleGrant.cardId).description}</p><small>这张卡已加入你的库存。请勿告诉其他人。</small><button className="button button--primary" onClick={() => onAcknowledgeGrant(player.id)}>收下道具卡</button></div></div>}
      {activeNotice && <div key={activeNotice.id} className="modal-backdrop" role="dialog" aria-modal="true"><div className="card-grant-sheet"><span>{activeNotice.title.includes('任务') ? '✉' : activeNotice.title.includes('成功') ? '✓' : activeNotice.title.includes('失败') || activeNotice.title.includes('偷走') ? '!' : '✦'}</span><p className="eyebrow">{activeNotice.title.includes('任务') ? '任务邮箱' : '身份提示'}</p><h2>{activeNotice.title}</h2><p>{activeNotice.detail}</p><button className="button button--primary" onClick={() => onAcknowledgeNotice(activeNotice.id)}>知道了</button></div></div>}
      {targetPicker === 'card' && cardConfirming && <PlayerTargetPicker title={cardConfirming.cardId === 'peek' ? '选择要偷看的玩家' : cardConfirming.cardId === 'bananaPeel' ? '选择香蕉皮目标' : '选择换日对象'} detail={cardConfirming.cardId === 'peek' ? '仅可选择已经提交投资的玩家；查看后本轮使用会锁定。' : cardConfirming.cardId === 'bananaPeel' ? '对方本轮下注会作废，只损失一半费用。' : '所有人提交后，双方的排名用投资额会互换。'} players={targetPlayersForCard(cardConfirming.cardId)} onSelect={(id) => { const use = { ...cardConfirming, targetPlayerId: id }; lockCardUse(use); setTargetPicker(null); if (use.cardId === 'peek') setPeekResult(previousTurns.find((turn) => turn.playerId === id) ?? null) }} onClose={() => { setTargetPicker(null); setCardConfirming(null) }} />}
      {peekResult && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="peek-result-title"><div className="card-grant-sheet"><span>◉</span><p className="eyebrow">仅自己可见</p><h2 id="peek-result-title">你看到了底牌</h2><p><strong>{playerName(session.players, peekResult.playerId)}</strong> 已投资 <CoinValue units={peekResult.bidUnits} />。</p><small>这张偷看底牌已锁定为本轮使用。</small><button className="button button--primary" onClick={() => setPeekResult(null)}>知道了</button></div></div>}
      {targetPicker === 'kidnap' && <PlayerTargetPicker title="选择要绑的人" detail={`花费 ${session.settings.identitySettings.kidnapActivationCoins} 金币。若目标拿下本轮拍品，你会报销费用并抢走拍品。`} players={session.players.filter((candidate) => candidate.id !== player.id)} selectedPlayerId={identityAction?.type === 'kidnap' ? identityAction.targetPlayerId : null} onSelect={(id) => { setIdentityConfirming({ type: 'kidnap', targetPlayerId: id }); setTargetPicker(null) }} onClose={() => setTargetPicker(null)} />}
      {targetPicker === 'lobbyTask' && <LobbyistTaskPicker extraCost={session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins} onSelect={(taskType) => { setLobbySpecified(Boolean(taskType)); if (taskType) setLobbyTask(taskType); setLobbyTargetId(''); setLobbyCompareId(''); setIdentityAction(undefined); setTargetPicker('lobbyTarget') }} onClose={() => setTargetPicker(null)} />}
      {targetPicker === 'lobbyTarget' && <PlayerTargetPicker title="选择任务对象" detail={lobbySpecified ? `任务「${taskLabel(lobbyTask)}」会在下一轮私密送达。` : '随机任务会在下一轮私密送达。'} players={session.players.filter((candidate) => candidate.id !== player.id)} selectedPlayerId={lobbyTargetId} onSelect={(id) => { setLobbyTargetId(id); setLobbyCompareId(''); if (lobbySpecified && taskRequiresComparison(lobbyTask)) { setTargetPicker('lobbyComparison'); return } setIdentityConfirming({ type: 'lobbyistContract', targetPlayerId: id, specified: lobbySpecified, ...(lobbySpecified ? { taskType: lobbyTask } : {}) }); setTargetPicker(null) }} onClose={() => setTargetPicker(null)} />}
      {targetPicker === 'lobbyComparison' && <PlayerTargetPicker title="选择比较对象" detail="用本轮实际下注比较；你自己也可以成为比较对象。" players={session.players.filter((candidate) => candidate.id !== lobbyTargetId)} selectedPlayerId={lobbyCompareId} onSelect={(id) => { setLobbyCompareId(id); setIdentityConfirming({ type: 'lobbyistContract', targetPlayerId: lobbyTargetId, specified: true, taskType: lobbyTask, comparisonPlayerId: id }); setTargetPicker(null) }} onClose={() => setTargetPicker(null)} />}
    </section>
  )
}

function RevealReady({ session, onReveal }: { session: GameSession; onReveal: () => void }) {
  return (
    <section className="reveal-ready screen-center">
      <div className="ready-stack">{session.players.slice(0, 5).map((player, index) => <span key={player.id} style={{ '--stack-index': index, '--player-color': player.color } as React.CSSProperties}>{player.name.slice(0, 1)}</span>)}</div>
      <p className="eyebrow">{session.players.length} 份选择已封存</p><h1>所有人，<em>看过来。</em></h1>
      <p className="lead">接下来会公开获奖者和预测结果，但不会泄露任何人的余额。</p>
      <button className="button button--primary button--large" onClick={onReveal}>揭晓本轮结果</button>
    </section>
  )
}

function AuctionIntro({ session, onContinue }: { session: GameSession; onContinue: () => void }) {
  const auction = session.merchantAuction as NonNullable<GameSession['merchantAuction']>
  const card = getCardDefinition(auction.cardId)
  const systemAuction = auction.source === 'system'
  return <section className="round-intro screen-center"><p className="eyebrow">{systemAuction ? '系统发起首轮竞购' : '道具商人发起竞购'}</p><h1>一张公开道具，<br /><em>秘密报价。</em></h1><div className="auction-card"><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></div><p className="lead">{systemAuction ? '所有人依次秘密报价。最高唯一正报价者获得道具，报价支付给系统。' : '所有人都会轮到报价；发起者也会经过流程，但只能报 0。最高唯一正报价者获得道具，报价款归发起者。'}</p><button className="button button--primary button--large" onClick={onContinue}>开始秘密竞购</button></section>
}

function AuctionHandoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const auction = session.merchantAuction as NonNullable<GameSession['merchantAuction']>
  const bidders = session.players
  const player = bidders[playerIndexForRoundPosition(auction.roundIndex, auction.bidderIndex, bidders.length)]
  return <section className="handoff screen-center"><div className="privacy-seal"><span>竞</span></div><p className="eyebrow">请把设备交给</p><h1 style={{ color: player.color }}>{player.name}</h1><p className="lead">为公开道具秘密报价，其他人请移开视线。</p><button className="handoff-enter" onClick={onReady}>报价 <span>→</span></button></section>
}

function AuctionBid({ session, onSubmit }: { session: GameSession; onSubmit: (bidUnits: number) => void }) {
  const auction = session.merchantAuction as NonNullable<GameSession['merchantAuction']>
  const bidders = session.players
  const player = bidders[playerIndexForRoundPosition(auction.roundIndex, auction.bidderIndex, bidders.length)]
  const card = getCardDefinition(auction.cardId)
  const merchantLocked = auction.source === 'merchant' && auction.merchantId === player.id
  const [bidUnits, setBidUnits] = useState(0)
  return <section className="private-turn"><div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>秘密竞购</h1></div><BalanceReveal units={player.balanceUnits} /></div>{session.settings.turnTimerEnabled && <OperationTimer deadlineAt={session.operationDeadlineAt} onExpire={() => onSubmit(merchantLocked ? 0 : bidUnits)} />}<section className="auction-bid panel"><div className="auction-card"><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></div><p>{merchantLocked ? '这次竞购由你发起。为不暴露身份，你也会走完报价流程；本次只能报 0。' : '报价只在你和系统之间可见。最高唯一正报价者获得道具。'}</p><label className="field-label">我的报价 <strong><CoinValue units={merchantLocked ? 0 : bidUnits} /></strong></label><input className="range range--bid" aria-label="竞购报价" type="range" min="0" max={merchantLocked ? 0 : player.balanceUnits} step="1" value={merchantLocked ? 0 : bidUnits} disabled={merchantLocked} onChange={(event) => setBidUnits(Number(event.target.value))} /><div className="bid-shortcuts"><button disabled={merchantLocked} onClick={() => setBidUnits(Math.max(0, bidUnits - 1))}>−0.5</button><button disabled={merchantLocked} onClick={() => setBidUnits(Math.min(player.balanceUnits, bidUnits + 1))}>+0.5</button><button disabled={merchantLocked} onClick={() => setBidUnits(Math.min(player.balanceUnits, bidUnits + 2))}>+1</button><button disabled={merchantLocked} onClick={() => setBidUnits(player.balanceUnits)}>全部</button></div><button className="button button--primary button--large" onClick={() => onSubmit(merchantLocked ? 0 : bidUnits)}>{merchantLocked ? '确认不报价' : bidUnits > 0 ? '确认秘密报价' : '跳过竞购'}</button></section></section>
}

function DeltaLabel({ units }: { units: number }) {
  if (units === 0) return <span className="delta delta--zero">±0</span>
  return <span className={cx('delta', units > 0 ? 'delta--up' : 'delta--down')}><CoinValue units={units} signed /></span>
}

function RoundResults({ session, result, onNext }: { session: GameSession; result: RoundResult; onNext: () => void }) {
  const [skipMotion, setSkipMotion] = useState(session.settings.animationSpeed === 'reduced')
  const [bananaNoticeOpen, setBananaNoticeOpen] = useState(true)
  const [revealStage, setRevealStage] = useState<'ties' | 'rankings' | 'settlement'>(session.settings.animationSpeed === 'reduced' ? 'settlement' : 'ties')
  const item = result.item
  const winner = session.players.find((player) => player.id === result.winnerId)
  const itemWasKidnapped = result.itemWinnerId !== result.winnerId
  const valueChanged = result.effectiveValueUnits !== item.value * 2
  const bananaEffect = result.cardEffects.find((effect) => effect.cardId === 'bananaPeel')
  const stageIndex = revealStage === 'ties' ? 0 : revealStage === 'rankings' ? 1 : 2
  const showRankings = stageIndex >= 1
  const showSettlement = stageIndex >= 2
  const stageCopy = revealStage === 'ties'
    ? result.tiedPlayerIds.length > 0 ? '正在剔除并列下注' : '正在核验唯一下注'
    : revealStage === 'rankings' ? '唯一排名金额揭晓' : '奖励与预测已经结算'
  const roundBulletin = createRoundBulletin(result, session.results.at(-2), session.settings.revealBalanceLeader)

  useEffect(() => {
    if (skipMotion || session.settings.animationSpeed === 'reduced') {
      if (revealStage !== 'settlement') setRevealStage('settlement')
      return
    }
    if (revealStage === 'settlement') return
    const duration = session.settings.animationSpeed === 'fast'
      ? revealStage === 'ties' ? 380 : 520
      : revealStage === 'ties' ? 900 : 1250
    const timer = window.setTimeout(() => setRevealStage((stage) => stage === 'ties' ? 'rankings' : 'settlement'), duration)
    return () => window.clearTimeout(timer)
  }, [revealStage, session.settings.animationSpeed, skipMotion])

  return (
    <section className={cx('results-page', `reveal-stage-${revealStage}`, skipMotion && 'skip-motion')} data-reveal-stage={revealStage}>
      {bananaEffect && bananaNoticeOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="banana-notice-title"><div className="card-grant-sheet"><span>🍌</span><p className="eyebrow">本轮意外</p><h2 id="banana-notice-title">香蕉皮！</h2><p>{bananaEffect.description}</p><small>这笔下注已按作废结果参与本轮结算。</small><button className="button button--primary" onClick={() => setBananaNoticeOpen(false)}>知道了</button></div></div>}
      <div className="results-hero">
        <div><p className="eyebrow">第 {result.roundIndex + 1} 轮 · 结果</p><h1>{showRankings ? itemWasKidnapped ? <>本轮藏品<em>被人劫走</em></> : winner ? <><em>{winner.name}</em> 拿下 {item.name}</> : <>本轮物品<em>流拍</em></> : <>密封标，<em>正在开封</em></>}</h1><p>{showRankings ? itemWasKidnapped ? '排名奖励已正常结算，藏品归属发生了变化。' : winner ? '唯一排名金额胜出，获得本轮第一名奖励。' : '没有产生唯一排名金额，物品无人获得。' : '先核验并列下注，再揭晓获奖名次与金币流动。'}</p></div>
        <div className="result-prize"><span>{item.emoji}</span><small>{valueChanged ? <>真实价值 <CoinValue units={result.effectiveValueUnits} /></> : <>价值 {item.value}</>}</small></div>
      </div>
      <div className="result-reveal-stepper" aria-label={`揭晓进度：${stageCopy}`}>
        {['并列核验', '获奖名次', '金币结算'].map((label, index) => <span key={label} className={cx(index < stageIndex && 'is-complete', index === stageIndex && 'is-current')}><i>{index < stageIndex ? '✓' : index + 1}</i>{label}</span>)}
      </div>
      <div className="result-metrics"><div><small>本轮总下注</small><CoinValue units={result.totalBidUnits} /></div><div><small>最低获奖排名额</small>{result.minWinningBidUnits === null ? <strong>—</strong> : <CoinValue units={result.minWinningBidUnits} />}</div><div><small>并列出局</small><strong>{result.tiedPlayerIds.length} 人</strong></div></div>
      <article className="result-tie-reveal" aria-live="polite"><span>{result.tiedPlayerIds.length > 0 ? '≠' : '✓'}</span><div><small>{stageCopy}</small><strong>{result.tiedPlayerIds.length > 0 ? `${result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')} 并列出局` : '没有并列下注，所有密封标保留排名资格'}</strong></div></article>
      {showSettlement && <aside className="round-bulletin" aria-live="polite"><span>🎙</span><div><small>局势播报</small><strong>{roundBulletin}</strong></div></aside>}
      {showSettlement && result.cardEffects.length > 0 && <article className="panel card-effects"><div className="panel-title"><div><p className="eyebrow">结算影响</p><h2>本轮道具与排名变化</h2></div><span>已计入本轮结果</span></div><div>{result.cardEffects.map((effect, index) => <p key={`${effect.cardId ?? effect.symbol}-${index}`} data-effect={effect.cardId ?? 'general'} style={{ '--effect-delay': `${index * 110}ms` } as React.CSSProperties}><span>{effect.symbol ?? getCardDefinition(effect.cardId as CardId).symbol}</span>{effect.description}</p>)}</div></article>}
      <div className="result-columns">
        {showRankings && <article className="panel result-ranking"><div className="panel-title"><div><p className="eyebrow">下注排名</p><h2>本轮获奖</h2></div>{result.tiedPlayerIds.length > 0 && <span>{result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')} 并列出局</span>}</div>
          {result.rankings.length === 0 ? <div className="empty-result">没有唯一排名金额，奖励全部落空。</div> : <ol>{result.rankings.map((entry, index) => <li key={entry.playerId} style={{ '--delay': `${index * 110}ms`, '--player-color': session.players.find((player) => player.id === entry.playerId)?.color } as React.CSSProperties}><span>{MEDALS[index]}</span><strong>{playerName(session.players, entry.playerId)}</strong>{session.settings.revealBids && <small>下注 {formatCoins(entry.actualBidUnits)}{entry.actualBidUnits !== entry.bidUnits ? ` · 排名额 ${formatCoins(entry.bidUnits)}` : ''}</small>}<CoinValue units={entry.publicRewardUnits} signed /></li>)}</ol>}
        </article>}
        {showSettlement && <article className="panel prediction-result"><div className="panel-title"><div><p className="eyebrow">眼光如何</p><h2>预测结算</h2></div>{result.winnerPaymentUnits > 0 && <span>第一名共支付 {formatCoins(result.winnerPaymentUnits)}</span>}</div>
          <div className="prediction-outcomes">{result.predictionOutcomes.map((outcome, index) => <div key={outcome.playerId} style={{ '--delay': `${index * 90 + 180}ms` } as React.CSSProperties}><strong>{playerName(session.players, outcome.playerId)}</strong><span>{outcome.status === 'skipped' ? '没有预测' : outcome.status === 'correct' ? `猜中 ${playerName(session.players, outcome.predictedPlayerId)}` : `猜错（选了 ${playerName(session.players, outcome.predictedPlayerId)}）`}</span><DeltaLabel units={outcome.deltaUnits} /></div>)}</div>
        </article>}
      </div>
      {showSettlement && <article className="panel public-ledger"><div className="panel-title"><div><p className="eyebrow">公开账本</p><h2>本轮收益变化</h2></div><span>不含秘密下注 · 不显示余额</span></div>
        <div className="ledger-table">{session.players.map((player) => { const delta = result.deltas.find((entry) => entry.playerId === player.id)!; const turn = result.turns.find((entry) => entry.playerId === player.id); return <div key={player.id}><span className="player-dot" style={{ background: player.color }} /><strong>{player.name}</strong>{session.settings.revealBids && <small>下注 {turn ? formatCoins(turn.bidUnits) : '—'}</small>}<small>获奖 {delta.rewardUnits ? `+${formatCoins(delta.rewardUnits)}` : '±0'}</small><small>预测 {delta.predictionUnits > 0 ? '+' : ''}{formatCoins(delta.predictionUnits)}</small><DeltaLabel units={delta.publicDeltaUnits} /></div> })}</div>
      </article>}
      {showSettlement && session.settings.revealBalanceLeader && <article className="balance-leader"><span>♛</span><div><small>当前余额领跑者</small><strong>{result.balanceLeaderIds.length > 1 ? '并列第一 · ' : ''}{result.balanceLeaderIds.map((id) => playerName(session.players, id)).join('、')}</strong></div><p>仅公布姓名，不公布余额</p></article>}
      <div className="result-actions"><button className="text-button" onClick={() => setSkipMotion(true)}>跳过动画</button><button className="button button--primary button--large" onClick={onNext}>{session.roundIndex + 1 >= session.settings.rounds ? '查看最终排行榜' : '进入下一轮'} <span>→</span></button></div>
    </section>
  )
}

function identityActionReview(action: IdentityAction, players: Player[], divinations: ProphetDivination[] = []): string {
  if (action.type === 'prophetDivination') {
    const divination = divinations.find((entry) => entry.id === action.divinationId)
    if (!divination) return '预言家发动了天机推演'
    if (divination.mode === 'identity' && divination.identityGuess) return `预言家观身份：猜测 ${playerName(players, divination.identityGuess.targetPlayerId)} 是 ${getIdentityDefinition(divination.identityGuess.identityId).name}（${divination.identityGuess.correct ? '猜中' : '猜错'}）`
    return `预言家发动天机推演：${prophetModeLabel(divination.mode)}（花费 ${formatCoins(divination.costUnits)} 金币）`
  }
  if (action.type === 'reverserInvert') return '逆转者发动了获奖区排名逆转'
  if (action.type === 'merchantAuction') return '道具商人发起了下一轮道具竞购'
  if (action.type === 'kidnap') return `绑匪盯上了 ${playerName(players, action.targetPlayerId)}`
  const target = playerName(players, action.targetPlayerId)
  const comparison = action.comparisonPlayerId ? `（比较对象：${playerName(players, action.comparisonPlayerId)}）` : ''
  return `说客向 ${target} 发布${action.specified ? '指定' : '随机'}任务：${action.taskType ? taskLabel(action.taskType) : '任务待定'}${comparison}`
}

function RoundReview({ session }: { session: GameSession }) {
  return (
    <section className="round-review panel">
      <div className="panel-title"><div><p className="eyebrow">终局公开</p><h2>逐轮复盘</h2></div><span>下注、道具与身份技能现已全部公开</span></div>
      <p className="round-review-note">按回合查看每个人的实际下注、道具与技能操作，以及排名奖励和预测结算。</p>
      <div className="round-review-list">
        {session.results.map((result) => {
          const cardTurns = result.turns.flatMap((turn) => turnCardUses(turn).map((use) => ({ playerId: turn.playerId, use })))
          const skillTurns = result.turns.filter((turn) => turn.identityAction)
          const identityEvents = session.identityEvents.filter((event) => event.roundIndex === result.roundIndex)
          const botRecords = session.players.flatMap((player) => (player.botMemory?.decisionLog ?? []).filter((record) => record.roundIndex === result.roundIndex).map((record) => ({ player, record })))
          return <details key={result.roundIndex} open={result.roundIndex === session.results.length - 1}>
            <summary><span>第 {result.roundIndex + 1} 轮</span><strong>{result.item.emoji} {result.item.name}</strong><small>真实价值 {formatCoins(result.effectiveValueUnits)} · 总下注 {formatCoins(result.totalBidUnits)}</small></summary>
            <div className="round-review-grid">
              <article className="review-block"><h3>全部下注</h3>{result.turns.map((turn) => { const ranking = result.rankings.find((entry) => entry.playerId === turn.playerId); return <div className="review-row" key={turn.playerId}><strong>{playerName(session.players, turn.playerId)}</strong><span>实际下注 <CoinValue units={turn.bidUnits} /></span>{ranking && ranking.bidUnits !== turn.bidUnits && <small>排名下注 {formatCoins(ranking.bidUnits)}</small>}</div> })}</article>
              <article className="review-block"><h3>道具使用</h3>{cardTurns.length === 0 ? <p>本轮没有使用道具。</p> : cardTurns.map(({ playerId, use }, index) => { const target = use.targetPlayerId ? ` → ${playerName(session.players, use.targetPlayerId)}` : ''; const coin = use.cardId === 'fateCoin' ? `（${use.coinResult === 'heads' ? '正面' : '反面'}）` : ''; const chosen = use.cardId === 'prizeReroll' && use.prizeReroll ? ITEM_POOL.find((item) => item.id === use.prizeReroll?.chosenItemId) : null; const reroll = chosen ? `（改为 ${chosen.emoji}${chosen.name}）` : ''; return <div className="review-row" key={`${playerId}-${use.cardId}-${index}`}><strong>{playerName(session.players, playerId)}</strong><span>{getCardDefinition(use.cardId).symbol} {getCardDefinition(use.cardId).name}{coin}{reroll}{target}</span></div> })}{result.cardEffects.length > 0 && <div className="review-effects">{result.cardEffects.map((effect, index) => <small key={`${effect.cardId ?? effect.symbol}-${index}`}>{effect.description}</small>)}</div>}</article>
              <article className="review-block"><h3>身份技能</h3>{skillTurns.length === 0 && identityEvents.length === 0 ? <p>本轮没有身份技能记录。</p> : <>{skillTurns.map((turn) => <div className="review-row" key={`${turn.playerId}-${turn.identityAction!.type}`}><strong>{playerName(session.players, turn.playerId)}</strong><span>{identityActionReview(turn.identityAction!, session.players, session.prophetDivinations)}</span></div>)}{identityEvents.map((event, index) => <div className="review-row review-row--event" key={`${event.playerId}-${event.title}-${index}`}><strong>{playerName(session.players, event.playerId)} · {event.title}</strong><span>{event.detail}</span>{event.deltaUnits !== 0 && <DeltaLabel units={event.deltaUnits} />}</div>)}</>}</article>
              <article className="review-block"><h3>奖励如何发放</h3>{result.rankings.length === 0 ? <p>没有唯一排名，排名奖励与拍品均未发放。</p> : <>{result.rankings.map((entry) => <div className="review-row" key={entry.playerId}><strong>第 {entry.place} 名 · {playerName(session.players, entry.playerId)}</strong><span>获奖 <CoinValue units={entry.rewardUnits} signed /></span>{entry.playerId === result.itemWinnerId && <small>获得拍品：{result.item.emoji} {result.item.name}</small>}</div>)}{result.itemWinnerId && !result.rankings.some((entry) => entry.playerId === result.itemWinnerId) && <p>拍品归属：{playerName(session.players, result.itemWinnerId)} 获得 {result.item.emoji} {result.item.name}</p>}{result.tiedPlayerIds.length > 0 && <p>并列出局：{result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')}</p>}</>}</article>
              <article className="review-block review-block--wide"><h3>预测与本轮结算</h3><div className="review-settlement">{result.predictionOutcomes.map((outcome) => <div className="review-row" key={outcome.playerId}><strong>{playerName(session.players, outcome.playerId)}</strong><span>{outcome.status === 'skipped' ? '未预测' : outcome.status === 'correct' ? `猜中 ${playerName(session.players, outcome.predictedPlayerId)}` : `猜错（选择 ${playerName(session.players, outcome.predictedPlayerId)}）`}</span><DeltaLabel units={outcome.deltaUnits} /></div>)}</div>{result.winnerPaymentUnits > 0 && <p>第一名向猜中者共支付 {formatCoins(result.winnerPaymentUnits)}。</p>}<div className="review-delta-list">{result.deltas.map((delta) => <small key={delta.playerId}>{playerName(session.players, delta.playerId)}：获奖 {delta.rewardUnits > 0 ? '+' : ''}{formatCoins(delta.rewardUnits)} · 预测 {delta.predictionUnits > 0 ? '+' : ''}{formatCoins(delta.predictionUnits)} · 身份 {delta.identityUnits > 0 ? '+' : ''}{formatCoins(delta.identityUnits)}</small>)}</div></article>
              {botRecords.length > 0 && <article className="review-block review-block--wide"><h3>Bot 决策回顾</h3>{botRecords.map(({ player, record }, index) => <div className="review-row review-row--event" key={`${player.id}-${record.stage}-${index}`}><strong>{player.name} · {modeLabel(record.mode)}</strong><span>{record.reason}</span>{record.intel && <small>{record.intel}</small>}</div>)}</article>}
            </div>
          </details>
        })}
      </div>
    </section>
  )
}

function FinalResult({ session, onNewGame, onRematch, onRevenge }: { session: GameSession; onNewGame: () => void; onRematch: () => void; onRevenge: () => void }) {
  const standings = rankFinalPlayers(session.players)
  const topAssets = standings[0]?.totalAssetUnits ?? 0
  const reducedMotion = session.settings.animationSpeed === 'reduced'
  const [revealedCount, setRevealedCount] = useState(reducedMotion ? standings.length : 0)
  const reversedStandings = [...standings].reverse()
  const fullyRevealed = revealedCount >= standings.length
  const nextStanding = reversedStandings[revealedCount]
  const medalists = [standings[2], standings[1], standings[0]].filter(Boolean)
  const highlights = createGameHighlights(session)

  useEffect(() => {
    if (reducedMotion || fullyRevealed) return
    const duration = session.settings.animationSpeed === 'fast' ? 420 : 820
    const timer = window.setTimeout(() => setRevealedCount((count) => Math.min(standings.length, count + 1)), duration)
    return () => window.clearTimeout(timer)
  }, [fullyRevealed, reducedMotion, revealedCount, session.settings.animationSpeed, standings.length])

  const standingCard = (standing: ReturnType<typeof rankFinalPlayers>[number], index: number) => <article key={standing.player.id} className={cx(standing.place === 1 && 'is-first')} style={{ '--delay': `${index * 90}ms`, '--player-color': standing.player.color } as React.CSSProperties}><span className="standing-place">{standing.place}</span><div className="standing-avatar">{standing.player.name.slice(0, 1)}</div><div className="standing-copy"><strong>{standing.player.name}</strong><small>{standing.player.items.length > 0 ? standing.player.items.map(({ item }) => `${item.emoji}${item.name}`).join(' · ') : '没有收藏品'}</small>{standing.fixedAssets.some((asset) => asset.units > 0) && <div className="asset-breakdown">{standing.fixedAssets.filter((asset) => asset.units > 0).map((asset) => <span key={asset.category}>{ASSET_CATEGORY_CONFIGS.find((entry) => entry.category === asset.category)?.symbol} {categoryConfig(asset.category).name} {asset.itemCount} 件 +{formatCoins(asset.units)}</span>)}</div>}</div><div className="standing-balance"><CoinValue units={standing.totalAssetUnits} /><small>总资产</small><span>现金 {formatCoins(standing.cashUnits)} · 固定资产 +{formatCoins(standing.fixedAssetUnits)}</span></div></article>

  return (
    <section className="final-page">
      <div className="final-heading"><p className="eyebrow"><span>全局结束</span> · {fullyRevealed ? '最终排名' : `正在揭晓第 ${nextStanding?.place ?? 1} 名`}</p><h1>{fullyRevealed ? <>最后的赢家，<br /><em>{standings.filter((standing) => standing.totalAssetUnits === topAssets).map((standing) => standing.player.name).join('、')}</em></> : <>从最后一名，<br /><em>逐位揭晓</em></>}</h1><p>{fullyRevealed ? `${session.settings.rounds} 轮竞价已经落定。最终以金币与固定资产总和排名。` : '所有人的总资产已经封存，下一位即将出现。'}</p></div>
      <div className="final-reveal-progress" aria-live="polite"><span>{revealedCount} / {standings.length} 已揭晓</span>{!fullyRevealed && <button className="text-button" onClick={() => setRevealedCount(standings.length)}>跳过揭晓</button>}</div>
      <div className="podium-list">{reversedStandings.slice(0, revealedCount).map(standingCard)}</div>
      {fullyRevealed && <section className="champion-podium" aria-label="冠亚季军领奖台"><p className="eyebrow">荣耀时刻</p><h2>前三名登上领奖台</h2><div>{medalists.map((standing, index) => <article key={standing.player.id} className={cx(`champion-podium__place--${3 - index}`, standing.place === 1 && 'is-champion')} style={{ '--delay': `${index * 420}ms`, '--player-color': standing.player.color } as React.CSSProperties}><span>{index === 0 ? '季军' : index === 1 ? '亚军' : '冠军'}</span><div>{standing.player.name.slice(0, 1)}</div><strong>{standing.player.name}</strong><small>第 {standing.place} 名 · {formatCoins(standing.totalAssetUnits)}</small></article>)}</div></section>}
      {fullyRevealed && <details className="game-highlights panel"><summary><span>✦</span><div><small>终局收官</small><strong>本局名场面 · 5 张</strong></div><i>展开</i></summary><div className="game-highlights__grid">{highlights.map((highlight) => <article key={highlight.id}><span>{highlight.symbol}</span><div><strong>{highlight.title}</strong><p>{highlight.detail}</p></div></article>)}</div></details>}
      {fullyRevealed && session.settings.identitySettings.enabled && <section className="identity-final panel"><div className="panel-title"><div><p className="eyebrow">终局揭示</p><h2>身份公开</h2></div><span>所有身份与开局配置</span></div><div>{session.players.map((player) => { const identity = player.identity ? getIdentityDefinition(player.identity.id) : null; const config = player.identity?.id === 'thief' && player.identity.targetPlayerId ? `目标：${playerName(session.players, player.identity.targetPlayerId)}` : player.identity?.collectorCategory ? `收藏类别：${categoryConfig(player.identity.collectorCategory).name}` : ''; return <article key={player.id}><span>{identity?.symbol ?? '—'}</span><div><strong>{player.name} · {identity?.name ?? '未选择身份'}</strong><small>{identity?.summary ?? '本局未启用身份。'}{config ? ` ${config}` : ''}</small></div></article> })}</div></section>}
      {fullyRevealed && session.players.some((player) => isBot(player)) && <section className="bot-reveal panel"><div className="panel-title"><div><p className="eyebrow">终局揭示</p><h2>Bot 档案</h2></div><span>性格、难度和本局恩怨</span></div>{session.players.filter((player) => player.controller?.kind === 'bot').map((player) => { const controller = player.controller as Extract<Player['controller'], { kind: 'bot' }>; const profile = BOT_PROFILES.find((entry) => entry.id === controller.profileId); const grudges = Object.entries(player.botMemory?.grudgeByPlayerId ?? {}).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]); return <article key={player.id}><strong>{player.name} · {profile?.name}</strong><small>{profile?.summary} · {controller.difficulty === 'easy' ? '简单' : controller.difficulty === 'expert' ? '高手' : '标准'}难度</small><p>{grudges.length ? `本局最在意：${grudges.slice(0, 2).map(([id]) => playerName(session.players, id)).join('、')}` : '本局没有形成明显恩怨。'}</p></article> })}</section>}
      {fullyRevealed && <><RoundReview session={session} /><div className="final-note">固定资产不会进入每轮余额；同总资产玩家共享同一名次。</div><div className="final-actions"><button className="button button--paper button--large" onClick={onRematch}>原班再来一局</button><button className="button button--primary button--large" onClick={onRevenge}>复仇局 <span>⚡</span></button><button className="text-button" onClick={onNewGame}>重新设置</button></div><small className="rematch-note">复仇局沿用座位与规则，只继承 Bot 对公开事件形成的恩怨。</small></>}
    </section>
  )
}

function Game({ session, setSession, onExit, onNewGame, onRematch, onRevenge }: { session: GameSession; setSession: (session: GameSession) => void; onExit: () => void; onNewGame: () => void; onRematch: () => void; onRevenge: () => void }) {
  const [botPaused, setBotPaused] = useState(false)
  const [botSpeed, setBotSpeed] = useState(1)
  const [autoPausedRound, setAutoPausedRound] = useState<number | null>(null)
  const patch = (changes: Partial<GameSession>) => setSession({ ...session, ...changes, updatedAt: new Date().toISOString() })
  const chooseIdentity = (identityId: IdentityId) => {
    const draft = session.identityDraft
    if (!draft || !draft.choiceIds.includes(identityId)) return
    const identity = getIdentityDefinition(identityId)
    const merchantCardOfferIds = identity.needsMerchantCard ? session.cardDeck.slice(0, session.settings.identitySettings.merchantInitialOfferCount) : undefined
    patch({ identityDraft: { ...draft, selectedIdentityId: identityId, ...(merchantCardOfferIds ? { merchantCardOfferIds } : {}) } })
  }
  const confirmIdentity = (config: { targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId }, botRecord?: { mode: import('./game/types').StrategyMode; reason: string }) => {
    const draft = session.identityDraft
    const identityId = draft?.selectedIdentityId
    if (!draft || !identityId) return
    const definition = getIdentityDefinition(identityId)
    if (definition.needsTarget && (!config.targetPlayerId || config.targetPlayerId === session.players[draft.playerIndex]?.id)) return
    if (definition.needsMerchantCard && (!config.merchantCardId || !draft.merchantCardOfferIds?.includes(config.merchantCardId))) return
    const cardDeck = [...session.cardDeck]
    const pendingAwards = [...session.pendingIdentityCardAwards]
    if (config.merchantCardId) {
      const cardIndex = cardDeck.indexOf(config.merchantCardId)
      if (cardIndex < 0) return
      cardDeck.splice(cardIndex, 1)
      pendingAwards.push({ playerId: session.players[draft.playerIndex].id, cardId: config.merchantCardId })
    }
    const players = session.players.map((player, index) => index === draft.playerIndex ? (botRecord ? appendBotRecord({ ...player, identity: createPlayerIdentity(identityId, config) }, { stage: 'identity', roundIndex: 0, mode: botRecord.mode, reason: botRecord.reason }) : { ...player, identity: createPlayerIdentity(identityId, config) }) : player)
    const selectedIds = players.flatMap((candidate) => candidate.identity ? [candidate.identity.id] : [])
    const nextIndex = draft.playerIndex + 1
    if (nextIndex >= players.length) {
      const routed = routeCardAwards({ players, awards: pendingAwards, settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex: 0 })
      patch({ players: routed.players, roundStartBalanceUnits: Object.fromEntries(routed.players.map((player) => [player.id, player.balanceUnits])), cardDeck, pendingIdentityCardAwards: [], pendingIdentityNotices: [...session.pendingIdentityNotices, ...routed.notices], identityEvents: [...session.identityEvents, ...routed.events], identityAvailableIds: enabledIdentityIds(session.settings.identitySettings), identityDraft: null, phase: session.merchantAuction?.source === 'system' ? 'auctionIntro' : 'roundIntro' })
      return
    }
    patch({ players, cardDeck, pendingIdentityCardAwards: pendingAwards, identityAvailableIds: enabledIdentityIds(session.settings.identitySettings), identityDraft: { playerIndex: nextIndex, choiceIds: dealIdentityChoices(selectedIds, session.settings.identitySettings) }, phase: 'identityHandoff' })
  }
  const startPrizeReroll = (playerId: string) => {
    const currentPlayer = session.players[session.currentTurnIndex]
    if (session.phase !== 'privateTurn' || currentPlayer?.id !== playerId || session.pendingPrizeReroll || session.roundIndex >= session.settings.rounds - 1 || !currentPlayer.cardInventory.includes('prizeReroll')) return
    const originalItem = session.itemDeck[session.roundIndex + 1]
    const offeredItems = drawPrizeRerollOffers(session.itemDeck)
    if (!originalItem || offeredItems.length !== 6) return
    patch({
      players: session.players.map((player) => player.id === playerId ? { ...player, cardInventory: player.cardInventory.filter((cardId) => cardId !== 'prizeReroll') } : player),
      pendingPrizeReroll: { playerId, roundIndex: session.roundIndex, originalItem: { ...originalItem }, offeredItems },
    })
  }
  const choosePrizeReroll = (itemId: string) => {
    const pending = session.pendingPrizeReroll
    const currentPlayer = session.players[session.currentTurnIndex]
    if (session.phase !== 'privateTurn' || !pending || pending.chosenItemId || pending.playerId !== currentPlayer?.id || pending.roundIndex !== session.roundIndex) return
    const chosenItem = pending.offeredItems.find((item) => item.id === itemId)
    if (!chosenItem) return
    patch({ itemDeck: replaceNextPrize(session.itemDeck, session.roundIndex, chosenItem), pendingPrizeReroll: { ...pending, chosenItemId: chosenItem.id } })
  }
  const useProphetDivination = (playerId: string, mode: ProphetDivination['mode'], targetPlayerId?: string, identityId?: IdentityId): boolean => {
    const player = session.players[session.currentTurnIndex]
    const costUnits = Math.round(session.settings.identitySettings.prophetDivinationCoins * 2)
    if (session.phase !== 'privateTurn' || player?.id !== playerId || player.identity?.id !== 'prophet' || player.balanceUnits < costUnits || session.prophetDivinations.some((entry) => entry.playerId === playerId && entry.roundIndex === session.roundIndex)) return false
    const id = `prophet-${session.roundIndex}-${playerId}-${Date.now()}`
    let divination: ProphetDivination | null = null
    let cardDeck = [...session.cardDeck]
    let players = session.players.map((entry) => ({ ...entry, cardInventory: [...entry.cardInventory] }))
    if (mode === 'wealth') divination = createWealthDivination({ id, playerId, roundIndex: session.roundIndex, costUnits, balanceSnapshot: session.roundStartBalanceUnits })
    if (mode === 'stars') divination = createStarsDivination({ id, playerId, roundIndex: session.roundIndex, costUnits, prophecyDeck: session.prophecyDeck })
    if (mode === 'identity') {
      const target = session.players.find((entry) => entry.id === targetPlayerId)
      const validIdentity = identityId && !session.settings.identitySettings.disabledIdentityIds.includes(identityId)
      if (!target || target.id === playerId || !validIdentity || !canMakeIdentityGuess(session.prophetDivinations, playerId, target.id, identityId)) return false
      const correct = target.identity?.id === identityId
      let rewardCardId: CardId | undefined
      if (correct) {
        const drawn = drawProphetRewardCard({ cardDeck, disabledCardIds: session.settings.disabledCardIds, heldCardIds: players.flatMap((entry) => entry.cardInventory), reservedCardId: session.merchantAuction?.cardId })
        cardDeck = drawn.cardDeck
        rewardCardId = drawn.cardId ?? undefined
        const recipient = players.find((entry) => entry.id === playerId)
        if (recipient && rewardCardId) recipient.cardInventory.push(rewardCardId)
      }
      divination = { id, playerId, roundIndex: session.roundIndex, mode: 'identity', costUnits, identityGuess: { targetPlayerId: target.id, identityId, correct, ...(rewardCardId ? { rewardCardId } : {}) } }
    }
    if (!divination) return false
    players = players.map((entry) => entry.id === playerId ? { ...entry, balanceUnits: entry.balanceUnits - costUnits } : entry)
    patch({ players, cardDeck, prophetDivinations: [...session.prophetDivinations, divination] })
    return true
  }
  const submitTurn = (turn: RoundTurn, botRecord?: { mode: import('./game/types').StrategyMode; reason: string; intel?: string }, timedOut = false) => {
    const currentPlayer = session.players.find((player) => player.id === turn.playerId)
    if (!currentPlayer || turn.bidUnits < 0 || turn.bidUnits > currentPlayer.balanceUnits) return false
    if (turn.identityAction?.type === 'prophetDivination') {
      const action = turn.identityAction
      const divination = session.prophetDivinations.find((entry) => entry.id === action.divinationId && entry.playerId === turn.playerId && entry.roundIndex === session.roundIndex)
      if (currentPlayer.identity?.id !== 'prophet' || !divination) return false
    }
    if (turn.identityAction?.type === 'reverserInvert') {
      const isLastTwoRounds = session.roundIndex >= session.settings.rounds - 2
      const costUnits = Math.round(session.settings.identitySettings.reverserActivationCoins * (isLastTwoRounds ? 4 : 2))
      if (currentPlayer.identity?.id !== 'reverser' || turn.bidUnits + costUnits > currentPlayer.balanceUnits) return false
    }
    if (turn.identityAction?.type === 'kidnap') {
      const action = turn.identityAction
      const costUnits = Math.round(session.settings.identitySettings.kidnapActivationCoins * 2)
      const targetValid = action.targetPlayerId !== turn.playerId && session.players.some((player) => player.id === action.targetPlayerId)
      if (currentPlayer.identity?.id !== 'assassin' || !targetValid || turn.bidUnits + costUnits > currentPlayer.balanceUnits) return false
    }
    const pendingPrizeReroll = session.pendingPrizeReroll?.playerId === turn.playerId && session.pendingPrizeReroll.roundIndex === session.roundIndex ? session.pendingPrizeReroll : null
    const lockedPrizeReroll = pendingPrizeReroll && !pendingPrizeReroll.chosenItemId && timedOut
      ? { ...pendingPrizeReroll, chosenItemId: pendingPrizeReroll.offeredItems[0]?.id }
      : pendingPrizeReroll
    if (lockedPrizeReroll && !lockedPrizeReroll.chosenItemId) return false
    const cardUses = [...turnCardUses(turn), ...(lockedPrizeReroll ? [{
      cardId: 'prizeReroll' as CardId,
      prizeReroll: {
        originalItemId: lockedPrizeReroll.originalItem.id,
        offeredItemIds: lockedPrizeReroll.offeredItems.map((item) => item.id),
        chosenItemId: lockedPrizeReroll.chosenItemId as string,
      },
    }] : [])]
    if (cardUses.length > 2 || new Set(cardUses.map((use) => use.cardId)).size !== cardUses.length) return false
    for (const use of cardUses) {
      if (use.cardId === 'reflectShield') return false
      const isLockedPrizeReroll = use.cardId === 'prizeReroll' && Boolean(lockedPrizeReroll)
      if (!isLockedPrizeReroll && !currentPlayer.cardInventory.includes(use.cardId)) return false
      const targetScope = cardTargetScope(use.cardId)
      const targetIsPrevious = session.turns.some((submitted) => submitted.playerId === use.targetPlayerId)
      const targetIsOtherPlayer = Boolean(use.targetPlayerId && use.targetPlayerId !== turn.playerId && session.players.some((player) => player.id === use.targetPlayerId))
      if (targetScope === 'previous' && !targetIsPrevious) return false
      if (targetScope === 'other' && !targetIsOtherPlayer) return false
      if (use.cardId === 'fateCoin' && use.coinResult !== 'heads' && use.coinResult !== 'tails') return false
    }
    let players = session.players.map((player) => {
      if (player.id !== turn.playerId) return player
      const updated = {
        ...player,
        balanceUnits: player.balanceUnits - turn.bidUnits,
        cardInventory: cardUses.length > 0 ? player.cardInventory.filter((cardId) => !cardUses.some((use) => use.cardId === cardId)) : player.cardInventory,
      }
      return botRecord ? appendBotRecord(updated, { stage: 'turn', roundIndex: session.roundIndex, mode: botRecord.mode, reason: botRecord.reason, intel: botRecord.intel }) : updated
    })
    let identityContracts = [...session.identityContracts]
    let resolvedTurn: RoundTurn = { ...turn, ...(cardUses.length > 0 ? { cardUses } : {}) }
    let merchantAuction = session.merchantAuction
    if (turn.identityAction?.type === 'merchantAuction') {
      const merchantCount = currentPlayer.identity?.merchantAuctionCount ?? (currentPlayer.identity?.merchantAuctionUsed ? 1 : 0)
      if (currentPlayer.identity?.id !== 'merchant' || merchantCount >= session.settings.identitySettings.merchantAuctionLimit || currentPlayer.identity.merchantLastAuctionRound === session.roundIndex || session.roundIndex >= session.settings.rounds - 1 || session.cardDeck.length === 0) return false
      const merchant = players.find((player) => player.id === turn.playerId)
      if (!merchant?.identity) return false
      merchant.identity = { ...merchant.identity, merchantAuctionCount: merchantCount + 1, merchantLastAuctionRound: session.roundIndex }
      merchantAuction = { source: 'merchant', merchantId: turn.playerId, cardId: session.cardDeck[0], roundIndex: session.roundIndex + 1, bidderIndex: 0, bids: [] }
    }
    if (turn.identityAction?.type === 'lobbyistContract') {
      if (currentPlayer.identity?.id !== 'lobbyist' || session.roundIndex >= session.settings.rounds - 1 || currentPlayer.identity.lobbyistLastIssuedRound === session.roundIndex) return false
      const action = turn.identityAction
      if (action.targetPlayerId === turn.playerId || !session.players.some((player) => player.id === action.targetPlayerId)) return false
      const resolvedTask = action.specified && action.taskType ? { taskType: action.taskType, comparisonPlayerId: action.comparisonPlayerId } : randomLobbyistTask(session.players.map((player) => player.id), action.targetPlayerId)
      if (taskRequiresComparison(resolvedTask.taskType) && (!resolvedTask.comparisonPlayerId || resolvedTask.comparisonPlayerId === action.targetPlayerId || !session.players.some((player) => player.id === resolvedTask.comparisonPlayerId))) return false
      const identity = currentPlayer.identity
      const isFree = (session.roundIndex === 0 && session.settings.identitySettings.lobbyistFirstRoundFree) || identity.lobbyistNextFree
      const feeUnits = (isFree ? 0 : Math.round(session.settings.identitySettings.lobbyistFeeCoins * 2)) + (action.specified ? Math.round(session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins * 2) : 0)
      const actor = players.find((player) => player.id === turn.playerId)
      if (!actor || actor.balanceUnits < feeUnits) return false
      actor.balanceUnits -= feeUnits
      actor.identity = { ...identity, lobbyistNextFree: false, lobbyistLastIssuedRound: session.roundIndex }
      identityContracts.push({ id: `contract-${session.roundIndex}-${turn.playerId}-${Date.now()}`, issuerId: turn.playerId, targetPlayerId: action.targetPlayerId, taskType: resolvedTask.taskType, comparisonPlayerId: resolvedTask.comparisonPlayerId, specified: Boolean(action.specified), issuedRoundIndex: session.roundIndex, executeRoundIndex: session.roundIndex + 1, status: 'pending', paymentUnits: 0 })
      resolvedTurn = { ...resolvedTurn, identityAction: { type: 'lobbyistContract', targetPlayerId: action.targetPlayerId, specified: Boolean(action.specified), taskType: resolvedTask.taskType, ...(resolvedTask.comparisonPlayerId ? { comparisonPlayerId: resolvedTask.comparisonPlayerId } : {}) } }
    }
    const turns = [...session.turns, resolvedTurn]
    const isLast = turns.length >= session.players.length
    const nextTurnIndex = session.players.length > 0 ? (session.currentTurnIndex + 1) % session.players.length : 0
    patch({ players, turns, identityContracts, merchantAuction, pendingPrizeReroll: lockedPrizeReroll ? null : session.pendingPrizeReroll, ...(lockedPrizeReroll?.chosenItemId && !pendingPrizeReroll?.chosenItemId ? { itemDeck: replaceNextPrize(session.itemDeck, session.roundIndex, lockedPrizeReroll.offeredItems.find((item) => item.id === lockedPrizeReroll.chosenItemId) ?? lockedPrizeReroll.offeredItems[0]) } : {}), operationDeadlineAt: null, phase: isLast ? 'revealReady' : 'handoff', currentTurnIndex: isLast ? session.currentTurnIndex : nextTurnIndex })
    return true
  }
  const reveal = () => {
    if (session.phase !== 'revealReady') return
    const settled = settleRound({
      playersAfterBids: session.players,
      turns: session.turns,
      item: session.itemDeck[session.roundIndex],
      roundIndex: session.roundIndex,
      rewardMultipliers: session.settings.rewardMultipliers,
      correctPredictionMultiplier: session.settings.correctPredictionMultiplier,
      wrongPredictionMultiplier: session.settings.wrongPredictionMultiplier,
      fairnessOrderIds: session.fairnessOrderIds,
      totalRounds: session.settings.rounds,
      identitySettings: session.settings.identitySettings,
      identityContracts: session.identityContracts,
    })
    const feedbackNotices = settled.identityEvents.map(identityFeedbackNotice)
    patch({ players: updateBotGrudges(settled.players, settled.result), identityContracts: settled.identityContracts, pendingIdentityNotices: [...session.pendingIdentityNotices, ...feedbackNotices], identityEvents: [...session.identityEvents, ...settled.identityEvents], results: [...session.results, settled.result], phase: 'roundResult' })
  }
  const beginNormalRound = (roundIndex: number, basePlayers: Player[], baseDeck: CardId[], notices = session.pendingIdentityNotices, events = session.identityEvents) => {
    const grants = roundIndex >= session.cardRulesStartRound ? prepareCardGrants({ players: basePlayers, cardDeck: baseDeck, roundIndex, probability: session.settings.cardGrantProbability }) : { players: basePlayers, cardDeck: baseDeck, pendingCardGrants: [] }
    const awards = grants.pendingCardGrants.map((grant) => ({ playerId: grant.playerId, cardId: grant.cardId }))
    const strippedPlayers = grants.players.map((player) => ({ ...player, cardInventory: player.cardInventory.filter((cardId) => !awards.some((award) => award.playerId === player.id && award.cardId === cardId)) }))
    const routed = routeCardAwards({ players: strippedPlayers, awards, settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex })
    const deliveredKeys = new Set(routed.delivered.map((award) => `${award.playerId}-${award.cardId}`))
    patch({ phase: 'roundIntro', roundIndex, currentTurnIndex: roundStartPlayerIndex(roundIndex, routed.players.length), turns: [], players: routed.players, roundStartBalanceUnits: Object.fromEntries(routed.players.map((player) => [player.id, player.balanceUnits])), cardDeck: grants.cardDeck, pendingCardGrants: grants.pendingCardGrants.filter((grant) => deliveredKeys.has(`${grant.playerId}-${grant.cardId}`)), pendingIdentityNotices: [...notices, ...routed.notices], identityEvents: [...events, ...routed.events], merchantAuction: null, operationDeadlineAt: null })
  }
  const nextRound = () => {
    if (session.roundIndex + 1 >= session.settings.rounds) patch({ phase: 'finalResult' })
    else {
      const nextRoundIndex = session.roundIndex + 1
      const recycledCardDeck = recycleUsedCards(session.cardDeck, session.turns, session.results.at(-1)?.autoConsumedCardIds ?? [])
      const auction = session.merchantAuction
      const taskNotices = session.identityContracts
        .filter((contract) => contract.status === 'pending' && contract.executeRoundIndex === nextRoundIndex)
        .map((contract) => ({ id: `lobby-task-${nextRoundIndex}-${contract.id}`, playerId: contract.targetPlayerId, title: '收到说客任务', detail: `本轮任务：${taskLabel(contract.taskType)}${contract.comparisonPlayerId ? ` ${playerName(session.players, contract.comparisonPlayerId)}` : ''}。若未完成，将向说客支付 ${formatCoins(Math.round(session.settings.identitySettings.lobbyistFailurePaymentCoins * 2))} 金币。` }))
      if (auction?.roundIndex === nextRoundIndex) {
        const deck = [...recycledCardDeck]
        const cardIndex = deck.indexOf(auction.cardId)
        if (cardIndex >= 0) deck.splice(cardIndex, 1)
        patch({ phase: 'auctionIntro', roundIndex: nextRoundIndex, currentTurnIndex: roundStartPlayerIndex(nextRoundIndex, session.players.length), turns: [], cardDeck: deck, pendingIdentityNotices: [...session.pendingIdentityNotices, ...taskNotices], merchantAuction: { ...auction, bidderIndex: 0, bids: [] } })
      } else beginNormalRound(nextRoundIndex, session.players, recycledCardDeck, [...session.pendingIdentityNotices, ...taskNotices])
    }
  }
  const submitAuctionBid = (bidUnits: number, botRecord?: { mode: import('./game/types').StrategyMode; reason: string }) => {
    const auction = session.merchantAuction
    if (!auction) return
    const bidders = session.players
    const bidder = bidders[playerIndexForRoundPosition(auction.roundIndex, auction.bidderIndex, bidders.length)]
    const merchantLocked = auction.source === 'merchant' && auction.merchantId === bidder?.id
    const resolvedBidUnits = merchantLocked ? 0 : bidUnits
    if (!bidder || resolvedBidUnits < 0 || resolvedBidUnits > bidder.balanceUnits) return
    const recordedPlayers = botRecord ? session.players.map((player) => player.id === bidder.id ? appendBotRecord(player, { stage: 'merchantAuction', roundIndex: auction.roundIndex, mode: botRecord.mode, reason: botRecord.reason }) : player) : session.players
    const bids = [...auction.bids, { playerId: bidder.id, bidUnits: resolvedBidUnits }]
    if (auction.bidderIndex < bidders.length - 1) {
      patch({ players: recordedPlayers, merchantAuction: { ...auction, bidderIndex: auction.bidderIndex + 1, bids }, operationDeadlineAt: null, phase: 'auctionHandoff' })
      return
    }
    const positive = bids.filter((bid) => bid.bidUnits > 0)
    const counts = new Map<number, number>()
    positive.forEach((bid) => counts.set(bid.bidUnits, (counts.get(bid.bidUnits) ?? 0) + 1))
    const winnerBid = positive.filter((bid) => counts.get(bid.bidUnits) === 1).sort((left, right) => right.bidUnits - left.bidUnits)[0]
    let players: Player[] = recordedPlayers.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
    let deck = [...session.cardDeck]
    let notices = [...session.pendingIdentityNotices]
    let events = [...session.identityEvents]
    if (winnerBid) {
      const winner = players.find((player) => player.id === winnerBid.playerId)
      const merchant = auction.merchantId ? players.find((player) => player.id === auction.merchantId) : null
      if (winner) winner.balanceUnits -= winnerBid.bidUnits
      if (merchant) {
        merchant.balanceUnits += winnerBid.bidUnits
        const used = merchant.identity?.merchantAuctionCount ?? 0
        const limit = session.settings.identitySettings.merchantAuctionLimit
        events.push({ playerId: merchant.id, identityId: 'merchant', roundIndex: auction.roundIndex, title: '道具竞购成交', detail: `收到 ${formatCoins(winnerBid.bidUnits)} 金币；本局竞购 ${used}/${limit} 次。`, deltaUnits: winnerBid.bidUnits })
        events.push({ playerId: winnerBid.playerId, identityId: 'merchant', roundIndex: auction.roundIndex, title: '竞购获得道具', detail: `支付 ${formatCoins(winnerBid.bidUnits)} 金币。`, deltaUnits: -winnerBid.bidUnits })
      }
      const routed = routeCardAwards({ players, awards: [{ playerId: winnerBid.playerId, cardId: auction.cardId }], settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex: auction.roundIndex })
      players = routed.players; notices = [...notices, ...routed.notices]; events = [...events, ...routed.events]
      notices = [...notices, ...events.slice(session.identityEvents.length).map(identityFeedbackNotice)]
    } else {
      deck = shuffle([...deck, auction.cardId])
      if (auction.merchantId) {
        const merchant = players.find((player) => player.id === auction.merchantId)
        notices.push({ id: `merchant-auction-empty-${auction.roundIndex}-${auction.merchantId}`, playerId: auction.merchantId, title: '道具竞购无人得标', detail: `没有唯一的正向报价，道具已回到循环卡池。本局竞购 ${merchant?.identity?.merchantAuctionCount ?? 0}/${session.settings.identitySettings.merchantAuctionLimit} 次。` })
      }
    }
    beginNormalRound(auction.roundIndex, players, deck, notices, events)
  }
  const allBots = session.players.length > 0 && session.players.every((player) => isBot(player))
  const currentPlayer = session.players[session.currentTurnIndex]
  const auctionBidder = session.merchantAuction ? session.players[playerIndexForRoundPosition(session.merchantAuction.roundIndex, session.merchantAuction.bidderIndex, session.players.length)] : undefined
  const armTurnDeadline = () => {
    if (session.phase !== 'privateTurn' || !session.settings.turnTimerEnabled || !currentPlayer || isBot(currentPlayer) || session.operationDeadlineAt) return
    patch({ operationDeadlineAt: Date.now() + session.settings.turnTimeLimitSeconds * 1000 })
  }
  const takeOverBot = () => {
    const target = session.phase === 'identityHandoff' || session.phase === 'identityDraft'
      ? session.players[session.identityDraft?.playerIndex ?? 0]
      : session.phase === 'auctionHandoff' || session.phase === 'auctionBid'
        ? auctionBidder
        : session.phase === 'roundResult' || session.phase === 'roundIntro'
          ? session.players[0]
          : currentPlayer
    if (!target || !isBot(target)) return
    patch({ players: session.players.map((player) => player.id === target.id ? { ...player, controller: { kind: 'human' } } : player) })
    setBotPaused(false)
  }
  useEffect(() => {
    if (allBots && botPaused) return
    if (allBots && session.phase === 'roundResult' && autoPausedRound !== session.roundIndex) {
      setBotPaused(true)
      setAutoPausedRound(session.roundIndex)
      return
    }
    const timer = window.setTimeout(() => {
      if (session.phase === 'identityHandoff') {
        const draftPlayer = session.players[session.identityDraft?.playerIndex ?? 0]
        if (isBot(draftPlayer)) patch({ phase: 'identityDraft' })
      } else if (session.phase === 'identityDraft') {
        const draft = session.identityDraft
        const draftPlayer = session.players[draft?.playerIndex ?? 0]
        if (!draft || !isBot(draftPlayer)) return
        if (!draft.selectedIdentityId) {
          const decision = decideBotIdentity({ choices: draft.choiceIds, player: draftPlayer, players: session.players })
          chooseIdentity(decision.identityId)
        } else {
          const decision = decideBotIdentity({ choices: [draft.selectedIdentityId], player: draftPlayer, players: session.players, cardOfferIds: draft.merchantCardOfferIds })
          confirmIdentity(decision, { mode: decision.mode, reason: decision.reason })
        }
      } else if (session.phase === 'handoff' && isBot(currentPlayer)) {
        patch({ phase: 'privateTurn' })
      } else if (session.phase === 'privateTurn' && isBot(currentPlayer)) {
        const controller = currentPlayer.controller as Extract<Player['controller'], { kind: 'bot' }>
        const observation = buildBotObservation(session, currentPlayer.id)
        const decision = decideBotTurn(observation, controller.profileId, controller.difficulty, currentPlayer.botMemory ?? emptyBotMemory())
        const accepted = submitTurn({ playerId: currentPlayer.id, bidUnits: decision.bidUnits, predictedPlayerId: decision.predictedPlayerId, cardUses: decision.cardUses, identityAction: decision.identityAction }, decision)
        // 防线：动作或道具失效时保留原本的竞拍判断，只撤销不合法的附加动作；不能因为一张失效卡把整回合降成 0 投资。
        if (!accepted) {
          const retainedBidUnits = Number.isInteger(decision.bidUnits) ? Math.max(0, Math.min(currentPlayer.balanceUnits, decision.bidUnits)) : 0
          submitTurn({ playerId: currentPlayer.id, bidUnits: retainedBidUnits, predictedPlayerId: decision.predictedPlayerId, cardUses: [] }, { ...decision, reason: `${decision.reason} 附加计划未通过校验，保留竞拍和预测，撤销本回合道具/身份动作。` })
        }
      } else if (session.phase === 'auctionHandoff' && isBot(auctionBidder)) {
        patch({ phase: 'auctionBid' })
      } else if (session.phase === 'auctionBid' && isBot(auctionBidder) && session.merchantAuction) {
        const mustPass = session.merchantAuction.source === 'merchant' && session.merchantAuction.merchantId === auctionBidder?.id
        const decision = mustPass
          ? { bidUnits: 0, mode: 'cards' as const, reason: '本次竞购由自己发起，按规则经过报价流程但只能报 0。' }
          : decideBotMerchantBid(auctionBidder as Player, session.merchantAuction.cardId)
        submitAuctionBid(decision.bidUnits, decision)
      } else if (allBots && session.phase === 'revealReady') {
        reveal()
      } else if (allBots && session.phase === 'roundResult') {
        nextRound()
      } else if (allBots && session.phase === 'auctionIntro') {
        patch({ phase: 'auctionHandoff' })
      }
    }, allBots ? Math.max(45, (session.settings.animationSpeed === 'reduced' ? 80 : 350) / botSpeed) : 550)
    return () => window.clearTimeout(timer)
  }, [session, botPaused, botSpeed, autoPausedRound])
  const acknowledgeGrant = (playerId: string) => patch({ pendingCardGrants: session.pendingCardGrants.map((grant) => grant.playerId === playerId ? { ...grant, announced: true } : grant) })
  const acknowledgeNotice = (noticeId: string) => patch({ pendingIdentityNotices: session.pendingIdentityNotices.filter((notice) => notice.id !== noticeId) })
  const result = session.results[session.results.length - 1]
  return (
    <AppShell quiet={session.phase === 'handoff' || session.phase === 'identityHandoff' || session.phase === 'auctionHandoff'}>
      {session.phase !== 'finalResult' && <GameHeader session={session} onExit={onExit} />}
      {allBots && session.phase !== 'finalResult' && <SpectatorControls paused={botPaused} speed={botSpeed} onToggle={() => setBotPaused((value) => !value)} onSpeed={setBotSpeed} onTakeOver={takeOverBot} />}
      {session.phase === 'identityHandoff' && <IdentityHandoff session={session} onReady={() => patch({ phase: 'identityDraft' })} />}
      {session.phase === 'identityDraft' && (isBot(session.players[session.identityDraft?.playerIndex ?? 0]) ? <BotThinking player={session.players[session.identityDraft?.playerIndex ?? 0]} allBots={allBots} /> : <IdentityDraft key={session.identityDraft?.playerIndex} session={session} onChoose={chooseIdentity} onConfirm={confirmIdentity} />)}
      {session.phase === 'auctionIntro' && <AuctionIntro session={session} onContinue={() => patch({ phase: 'auctionHandoff' })} />}
      {session.phase === 'auctionHandoff' && <AuctionHandoff session={session} onReady={() => patch({ phase: 'auctionBid', operationDeadlineAt: session.settings.turnTimerEnabled && !isBot(auctionBidder) ? session.operationDeadlineAt ?? Date.now() + session.settings.turnTimeLimitSeconds * 1000 : null })} />}
      {session.phase === 'auctionBid' && <AuctionBid key={session.merchantAuction?.bidderIndex} session={session} onSubmit={submitAuctionBid} />}
      {session.phase === 'roundIntro' && <RoundIntro key={session.roundIndex} session={session} auto={allBots} onContinue={() => patch({ phase: 'handoff' })} />}
      {session.phase === 'handoff' && <Handoff session={session} onReady={() => patch({ phase: 'privateTurn' })} />}
      {session.phase === 'privateTurn' && (isBot(currentPlayer) ? <BotThinking player={currentPlayer} allBots={allBots} /> : <PrivateTurn key={`${session.roundIndex}-${session.currentTurnIndex}`} session={session} onSubmit={(turn, timedOut) => submitTurn(turn, undefined, timedOut)} onAcknowledgeGrant={acknowledgeGrant} onAcknowledgeNotice={acknowledgeNotice} onStartPrizeReroll={startPrizeReroll} onChoosePrizeReroll={choosePrizeReroll} onUseProphetDivination={useProphetDivination} onArmDeadline={armTurnDeadline} />)}
      {session.phase === 'revealReady' && <RevealReady session={session} onReveal={reveal} />}
      {session.phase === 'roundResult' && result && <RoundResults key={session.roundIndex} session={session} result={result} onNext={nextRound} />}
      {session.phase === 'finalResult' && <FinalResult session={session} onNewGame={onNewGame} onRematch={onRematch} onRevenge={onRevenge} />}
    </AppShell>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [saved, setSaved] = useState<GameSession | null>(() => loadSession())
  const [presets, setPresets] = useState<GamePreset[]>(() => loadPresets())
  const [session, setSession] = useState<GameSession | null>(null)

  useEffect(() => {
    if (!session) return
    saveSession(session)
    setSaved(session)
  }, [session])

  const begin = (next: GameSession) => { setSession(next); setSaved(next); setScreen('game') }
  const quickStart = () => { const preset = SYSTEM_PRESETS[0]; begin(createSession(preset.seats, cloneSettings(preset.settings))) }
  const tutorialStart = () => begin(createTutorialSession())
  const persistPresets = (next: GamePreset[]) => { setPresets(next); savePresets(next) }
  const removeSaved = () => { clearSession(); setSaved(null); setSession(null) }
  const newGame = () => { clearSession(); setSaved(null); setSession(null); setScreen('setup') }
  const rematch = (keepBotGrudges: boolean) => { if (session) begin(createRematchSession(session, keepBotGrudges)) }

  if (screen === 'rules') return <Rules onBack={() => setScreen('home')} />
  if (screen === 'setup') return <Setup onBack={() => setScreen('home')} onStart={begin} presets={presets} onSavePresets={persistPresets} />
  if (screen === 'game' && session) return <Game session={session} setSession={setSession} onExit={() => setScreen('home')} onNewGame={newGame} onRematch={() => rematch(false)} onRevenge={() => rematch(true)} />
  return <Home saved={saved} onQuickStart={quickStart} onTutorial={tutorialStart} onSetup={() => setScreen('setup')} onContinue={() => { if (saved) { setSession(saved); setScreen('game') } }} onRules={() => setScreen('rules')} onDelete={removeSaved} />
}
