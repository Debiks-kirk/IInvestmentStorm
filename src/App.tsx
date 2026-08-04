import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ASSET_CATEGORY_CONFIGS, calculateFixedAssets, categoryConfig } from './game/assets'
import { CARD_DEFINITIONS, getCardDefinition } from './game/cards'
import { IDENTITY_DEFINITIONS, createPlayerIdentity, dealIdentityChoices, getIdentityDefinition, identitySkillMode, identityValidationErrors, randomLobbyistTask, routeCardAwards, taskLabel } from './game/identities'
import { defaultRewards, formatCoins, rankFinalPlayers, settleRound, unitsToCoins, validateSettings } from './game/engine'
import { cloneSettings, createGamePreset, SYSTEM_PRESETS } from './game/presets'
import { createDefaultSettings, createSession, prepareCardGrants, recycleUsedCards, validateNames } from './game/session'
import { clearSession, loadPresets, loadSession, savePresets, saveSession } from './game/storage'
import { shuffle } from './game/items'
import type { AssetCategory, CardId, CardUse, GamePreset, GameSession, GameSettings, IdentityAction, IdentityEvent, IdentityId, LobbyistTaskType, Player, RoundResult, RoundTurn } from './game/types'

type Screen = 'home' | 'setup' | 'rules' | 'game'

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

function Home({ saved, onQuickStart, onSetup, onContinue, onRules, onDelete }: {
  saved: GameSession | null
  onQuickStart: () => void
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
  const [names, setNames] = useState(['玩家 1', '玩家 2', '玩家 3'])
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [presetName, setPresetName] = useState('')
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  const applyConfiguration = (nextNames: string[], nextSettings: GameSettings, preset?: GamePreset) => {
    setNames([...nextNames])
    setSettings(cloneSettings({ ...nextSettings, playerCount: nextNames.length }))
    setPresetName(preset?.name ?? '')
    setActivePresetId(preset?.id ?? null)
    setErrors([])
  }

  const setPlayerCount = (count: number) => {
    setNames((current) => Array.from({ length: count }, (_, index) => current[index] ?? `玩家 ${index + 1}`))
    setSettings((current) => ({ ...current, playerCount: count, rewardMultipliers: defaultRewards(count) }))
  }
  const setRewardCount = (count: number) => {
    setSettings((current) => {
      const rewards = Array.from({ length: count }, (_, index) => current.rewardMultipliers[index] ?? 0.5)
      return { ...current, rewardMultipliers: rewards }
    })
  }
  const submit = () => {
    const nextErrors = [...validateNames(names), ...validateSettings(settings), ...identityValidationErrors(settings.identitySettings, settings.playerCount)]
    if (settings.identitySettings.enabled && !settings.identitySettings.disabledIdentityIds.includes('merchant') && settings.disabledCardIds.length === CARD_DEFINITIONS.length) nextErrors.push('启用道具商人时，至少需要启用一张道具卡')
    setErrors(nextErrors)
    if (nextErrors.length === 0) onStart(createSession(names, settings))
  }
  const saveCurrentPreset = () => {
    const nextErrors = [...validateNames(names), ...validateSettings(settings), ...identityValidationErrors(settings.identitySettings, settings.playerCount)]
    if (settings.identitySettings.enabled && !settings.identitySettings.disabledIdentityIds.includes('merchant') && settings.disabledCardIds.length === CARD_DEFINITIONS.length) nextErrors.push('启用道具商人时，至少需要启用一张道具卡')
    if (!presetName.trim()) nextErrors.push('请为这套配置填写名称')
    setErrors(nextErrors)
    if (nextErrors.length > 0) return
    const existing = presets.find((preset) => preset.id === activePresetId)
    const preset = createGamePreset(presetName, names, settings, existing)
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
              {names.map((name, index) => (
                <label className="name-field" key={index} style={{ '--player-color': `var(--player-${index + 1})` } as React.CSSProperties}>
                  <span>{index + 1}</span>
                  <input value={name} maxLength={12} aria-label={`玩家 ${index + 1} 名字`} onChange={(event) => setNames((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} />
                </label>
              ))}
            </div>
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
                <div className="card-setting-group"><strong>禁用道具卡</strong><small>未勾选的卡会加入本局循环卡池；使用后回池，未使用会留在手中</small><div>{CARD_DEFINITIONS.map((card) => <label key={card.id}><input type="checkbox" checked={!settings.disabledCardIds.includes(card.id)} onChange={(event) => setSettings({ ...settings, disabledCardIds: event.target.checked ? settings.disabledCardIds.filter((id) => id !== card.id) : [...settings.disabledCardIds, card.id] })} /><span>{card.symbol} {card.name}</span></label>)}</div></div>
                <div className="identity-setting-group"><label className="switch-row"><span><strong>启用身份系统</strong><small>开局前私密二选一身份；身份在终局才公开</small></span><input type="checkbox" checked={settings.identitySettings.enabled} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, enabled: event.target.checked } })} /></label>{settings.identitySettings.enabled && <><strong>启用身份</strong><div className="identity-toggle-grid">{IDENTITY_DEFINITIONS.map((identity) => <label key={identity.id}><input type="checkbox" checked={!settings.identitySettings.disabledIdentityIds.includes(identity.id)} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, disabledIdentityIds: event.target.checked ? settings.identitySettings.disabledIdentityIds.filter((id) => id !== identity.id) : [...settings.identitySettings.disabledIdentityIds, identity.id] } })} /><span>{identity.symbol} {identity.name}</span></label>)}</div><div className="identity-settings-fields"><label>赌徒命中加成<input type="number" min="0" max="1" step="0.05" value={settings.identitySettings.gamblerCorrectBonusMultiplier} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, gamblerCorrectBonusMultiplier: Number(event.target.value) } })} /></label><label>赌徒跳过罚款<input type="number" min="0" max="1" step="0.05" value={settings.identitySettings.gamblerSkipPenaltyMultiplier} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, gamblerSkipPenaltyMultiplier: Number(event.target.value) } })} /></label><label>刺客成功奖励<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.assassinSuccessCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, assassinSuccessCoins: Number(event.target.value) } })} /></label><label>刺客失败罚款<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.assassinFailureCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, assassinFailureCoins: Number(event.target.value) } })} /></label><label>小偷成功率 %<input type="number" min="0" max="100" value={settings.identitySettings.thiefSuccessProbability} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, thiefSuccessProbability: Number(event.target.value) } })} /></label><label>小偷上限<input type="number" min="0" max="10" value={settings.identitySettings.thiefMaxSteals} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, thiefMaxSteals: Number(event.target.value) } })} /></label><label>商人初始选卡<input type="number" min="1" max="6" value={settings.identitySettings.merchantInitialOfferCount} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, merchantInitialOfferCount: Number(event.target.value) } })} /></label><label>说客发布费用<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.lobbyistFeeCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFeeCoins: Number(event.target.value) } })} /></label><label>说客违约付款<input type="number" min="0" max="20" step="0.5" value={settings.identitySettings.lobbyistFailurePaymentCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFailurePaymentCoins: Number(event.target.value) } })} /></label></div><label className="switch-row"><span><strong>说客首轮免费</strong></span><input type="checkbox" checked={settings.identitySettings.lobbyistFirstRoundFree} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistFirstRoundFree: event.target.checked } })} /></label></>}</div>
                {settings.identitySettings.enabled && <div className="identity-settings-fields"><p>赌徒的“跳过罚款”同样用于猜错；新局默认均为拍品价值的 50%。</p><label>逆行者发动费用<input type="number" min="0" max="30" step="0.5" value={settings.identitySettings.reverserActivationCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, reverserActivationCoins: Number(event.target.value) } })} /></label><label>说客指定任务加价<input type="number" min="0" max="30" step="0.5" value={settings.identitySettings.lobbyistSpecifiedTaskFeeCoins} onChange={(event) => setSettings({ ...settings, identitySettings: { ...settings.identitySettings, lobbyistSpecifiedTaskFeeCoins: Number(event.target.value) } })} /></label></div>}
                <div className="setting-row"><label htmlFor="motion">动画速度</label><select id="motion" value={settings.animationSpeed} onChange={(event) => setSettings({ ...settings, animationSpeed: event.target.value as GameSettings['animationSpeed'] })}><option value="full">完整</option><option value="fast">快速</option><option value="reduced">极简</option></select></div>
              </div>
            )}
          </div>
        </div>
        <section className="preset-save panel"><div><p className="eyebrow">常用配置</p><h2>保存这套设置</h2><small>保存玩家姓名、轮数与所有高级规则，不会影响当前进行中的对局。</small></div><div><input aria-label="配置名称" placeholder="例如：周末六人局" maxLength={20} value={presetName} onChange={(event) => { setPresetName(event.target.value); setActivePresetId(null) }} /><button className="button button--paper" onClick={saveCurrentPreset}>{activePresetId ? '覆盖保存' : '另存配置'}</button></div></section>
        <section className="preset-panel panel">
          <div className="panel-title"><div><p className="eyebrow">一键开局</p><h2>系统配置</h2></div><span>载入后仍可继续微调</span></div>
          <div className="preset-grid">{SYSTEM_PRESETS.map((preset) => <button key={preset.id} className="preset-choice" onClick={() => applyConfiguration(preset.names, preset.settings)}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}</div>
          {presets.length > 0 && <><div className="panel-title saved-preset-title"><div><p className="eyebrow">本机保存</p><h2>我的配置</h2></div><span>含玩家姓名与高级设置</span></div><div className="preset-grid">{presets.map((preset) => <div key={preset.id} className={cx('preset-choice', activePresetId === preset.id && 'is-active')}><button onClick={() => applyConfiguration(preset.names, preset.settings, preset)}><strong>{preset.name}</strong><small>{preset.names.join('、')} · {preset.settings.rounds} 轮</small></button><button className="preset-delete" aria-label={`删除${preset.name}`} onClick={() => deletePreset(preset.id)}>×</button></div>)}</div></>}
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

function RoundIntro({ session, onContinue }: { session: GameSession; onContinue: () => void }) {
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const timer = useRef<number | null>(null)
  const item = session.itemDeck[session.roundIndex]
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const spin = () => {
    setSpinning(true)
    const duration = session.settings.animationSpeed === 'reduced' ? 150 : session.settings.animationSpeed === 'fast' ? 700 : 1500
    timer.current = window.setTimeout(() => { setSpinning(false); setRevealed(true) }, duration)
  }
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
        {revealed && <><p className="muted">看清楚了吗？接下来请依次秘密操作。</p><button className="button button--primary button--large" onClick={onContinue}>开始传递 <span>→</span></button></>}
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

function IdentityHandoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const player = session.players[session.identityDraft?.playerIndex ?? 0]
  return <section className="handoff screen-center"><div className="privacy-seal"><span>身</span></div><p className="eyebrow">请把设备交给</p><h1 style={{ color: player.color }}>{player.name}</h1><p className="lead">只有你会看到两张身份卡。选好并完成准备后，再传给下一位。</p><button className="handoff-enter" onClick={onReady}>选择身份 <span>→</span></button><small className="privacy-note">其他人请移开视线</small></section>
}

function IdentityDraft({ session, onChoose, onConfirm }: { session: GameSession; onChoose: (identityId: IdentityId) => void; onConfirm: (config: { targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId }) => void }) {
  const draft = session.identityDraft as NonNullable<GameSession['identityDraft']>
  const player = session.players[draft.playerIndex]
  const selected = draft.selectedIdentityId ? getIdentityDefinition(draft.selectedIdentityId) : null
  const [targetPlayerId, setTargetPlayerId] = useState<string>('')
  const [collectorCategory, setCollectorCategory] = useState<AssetCategory>('leisure')
  const [merchantCardId, setMerchantCardId] = useState<CardId | null>(null)
  const otherPlayers = session.players.filter((candidate) => candidate.id !== player.id)
  const needsTarget = selected?.needsTarget
  const canConfirm = Boolean(selected && (!needsTarget || targetPlayerId) && (!selected.needsMerchantCard || merchantCardId))
  return <section className="identity-draft private-turn"><div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>选一个身份</h1></div><span className="draft-count">{draft.playerIndex + 1} / {session.players.length}</span></div>{!selected ? <div className="identity-choice-grid">{draft.choiceIds.map((identityId, index) => { const identity = getIdentityDefinition(identityId); const active = identitySkillMode(identityId) === 'active'; return <button key={`${identityId}-${index}`} className="identity-choice-card" onClick={() => onChoose(identityId)}><span>{identity.symbol}</span><small>身份卡 · {active ? '主动技能' : '被动技能'}</small><h2>{identity.name}</h2><p>{identity.summary}</p><p className="identity-mode">{active ? '主动：选定后，在自己的回合到「身份技能」区点击按钮发动。' : '被动：无需点击，系统会在符合条件时自动生效。'}</p><b>选择这张卡 →</b></button> })}</div> : <section className="identity-setup panel"><div className="identity-card-summary"><span>{selected.symbol}</span><div><p className="eyebrow">已选身份 · {identitySkillMode(selected.id) === 'active' ? '主动技能' : '被动技能'}</p><h2>{selected.name}</h2><p>{selected.summary}</p><small className="identity-mode">{identitySkillMode(selected.id) === 'active' ? '之后请在自己的回合，到「身份技能」区点击对应按钮发动。' : '无需操作，系统会在符合条件时自动生效。'}</small></div></div>{needsTarget && <div className="identity-config"><strong>选择目标玩家</strong><div className="identity-target-list">{otherPlayers.map((candidate) => <button key={candidate.id} className={cx(targetPlayerId === candidate.id && 'is-selected')} onClick={() => setTargetPlayerId(candidate.id)}><span style={{ background: candidate.color }}>{candidate.name.slice(0, 1)}</span>{candidate.name}</button>)}</div></div>}{selected.needsCategory && <div className="identity-config"><strong>选择要加成的资产类别</strong><div className="identity-target-list">{ASSET_CATEGORY_CONFIGS.map((category) => <button key={category.category} className={cx(collectorCategory === category.category && 'is-selected')} onClick={() => setCollectorCategory(category.category)}><span>{category.symbol}</span>{category.name}</button>)}</div></div>}{selected.needsMerchantCard && <div className="identity-config"><strong>选择一张初始道具卡</strong><div className="merchant-offer-list">{(draft.merchantCardOfferIds ?? []).map((cardId) => { const card = getCardDefinition(cardId); return <button key={cardId} className={cx(merchantCardId === cardId && 'is-selected')} onClick={() => setMerchantCardId(cardId)}><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></button> })}</div></div>}<button className="button button--primary button--large" disabled={!canConfirm} onClick={() => onConfirm({ ...(targetPlayerId ? { targetPlayerId } : {}), ...(selected.needsCategory ? { collectorCategory } : {}), ...(merchantCardId ? { merchantCardId } : {}) })}>确认身份与准备 <span>→</span></button></section>}</section>
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
    {detailOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="identity-detail-title"><div className="identity-detail-sheet"><span className="identity-detail-mark">{definition?.symbol ?? '?'}</span><p className="eyebrow">仅自己可见</p><h2 id="identity-detail-title">身份档案</h2><div className="identity-detail-placeholder"><small>当前身份 · {identity ? (identitySkillMode(identity.id) === 'active' ? '主动技能' : '被动技能') : '未启用'}</small><strong>{definition?.name ?? '本局未启用身份'}</strong><p>{definition?.summary ?? '在高级设置中开启身份系统后，下局会进行私密选角。'}{identity ? identitySkillMode(identity.id) === 'active' ? ' 主动技能请在自己的回合，到「身份技能」区点击按钮发动。' : ' 被动技能无需点击，系统会自动结算。' : ''}{identity?.targetPlayerId ? ` 目标：${playerName(session.players, identity.targetPlayerId)}。` : ''}</p></div><button className="button button--primary" onClick={() => setDetailOpen(false)}>收起身份详情</button></div></div>}
  </>
}

function PrivateTurn({ session, onSubmit, onAcknowledgeGrant, onAcknowledgeNotice }: { session: GameSession; onSubmit: (turn: RoundTurn) => void; onAcknowledgeGrant: (playerId: string) => void; onAcknowledgeNotice: (noticeId: string) => void }) {
  const player = session.players[session.currentTurnIndex]
  const item = session.itemDeck[session.roundIndex]
  const [bidUnits, setBidUnits] = useState(0)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<CardId | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [confirmedCardUses, setConfirmedCardUses] = useState<CardUse[]>([])
  const [cardConfirming, setCardConfirming] = useState<CardUse | null>(null)
  const [coinFlipResult, setCoinFlipResult] = useState<'heads' | 'tails' | null>(null)
  const [identityAction, setIdentityAction] = useState<IdentityAction | undefined>()
  const [lobbyTargetId, setLobbyTargetId] = useState('')
  const [lobbySpecified, setLobbySpecified] = useState(false)
  const [lobbyTask, setLobbyTask] = useState<LobbyistTaskType>('avoidPrize')
  const [lobbyCompareId, setLobbyCompareId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const setBid = (value: number) => {
    const reservedReverserUnits = identityAction?.type === 'reverserInvert' ? Math.round(session.settings.identitySettings.reverserActivationCoins * (session.roundIndex >= session.settings.rounds - 2 ? 4 : 2)) : 0
    setBidUnits(Math.max(0, Math.min(player.balanceUnits - reservedReverserUnits, Math.round(value))))
  }
  const predicted = session.players.find((candidate) => candidate.id === prediction)
  const previousTurns = session.turns.filter((turn) => turn.playerId !== player.id)
  const targetPlayers = previousTurns.map((turn) => session.players.find((candidate) => candidate.id === turn.playerId)).filter(Boolean) as Player[]
  const selectedCard = selectedCardId ? getCardDefinition(selectedCardId) : null
  const cardTargetPlayers = selectedCardId === 'swap' ? session.players.filter((candidate) => candidate.id !== player.id) : targetPlayers
  const grant = session.pendingCardGrants.find((entry) => entry.playerId === player.id && !entry.announced)
  const peekedTurn = selectedCardId === 'peek' && selectedTargetId ? previousTurns.find((turn) => turn.playerId === selectedTargetId) : undefined
  const cardSlotsRemaining = 2 - confirmedCardUses.length
  const canSubmitCards = !selectedCardId && !cardConfirming
  const openCardConfirmation = (use: CardUse) => {
    setCardConfirming(use)
    setCoinFlipResult(use.cardId === 'fateCoin' ? null : 'heads')
  }
  const confirmCardUse = () => {
    if (!cardConfirming || (cardConfirming.cardId === 'fateCoin' && !coinFlipResult)) return
    const use: CardUse = cardConfirming.cardId === 'fateCoin' ? { ...cardConfirming, coinResult: coinFlipResult as 'heads' | 'tails' } : cardConfirming
    setConfirmedCardUses((uses) => [...uses, use])
    setCardConfirming(null)
    setCoinFlipResult(null)
    setSelectedCardId(null)
    setSelectedTargetId(null)
  }
  useEffect(() => {
    if (cardConfirming?.cardId !== 'fateCoin' || coinFlipResult !== null) return
    const timer = window.setTimeout(() => setCoinFlipResult(Math.random() < 0.5 ? 'heads' : 'tails'), 900)
    return () => window.clearTimeout(timer)
  }, [cardConfirming, coinFlipResult])
  const identity = player.identity
  const nextItem = session.itemDeck[session.roundIndex + 1]
  const lobbyFee = ((session.roundIndex === 0 && session.settings.identitySettings.lobbyistFirstRoundFree) || identity?.lobbyistNextFree) ? 0 : session.settings.identitySettings.lobbyistFeeCoins
  const reverserCost = session.settings.identitySettings.reverserActivationCoins * (session.roundIndex >= session.settings.rounds - 2 ? 2 : 1)
  const reverserCostUnits = Math.round(reverserCost * 2)
  const reverserShortfallUnits = Math.max(0, bidUnits + reverserCostUnits - player.balanceUnits)
  const reverserAffordable = reverserShortfallUnits === 0
  const merchantUnavailableReason = identity?.id !== 'merchant' ? null : identity.merchantAuctionUsed ? '本局竞购技能已用完' : session.roundIndex >= session.settings.rounds - 1 ? '最后一轮无法发起下轮竞购' : session.cardDeck.length === 0 ? '卡池为空，无法发起竞购' : null
  const lobbyBaseCostUnits = Math.round((lobbyFee + (lobbySpecified ? session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins : 0)) * 2)
  const lobbyShortfallUnits = Math.max(0, bidUnits + lobbyBaseCostUnits - player.balanceUnits)
  const lobbyUnavailableReason = identity?.id !== 'lobbyist' ? null : session.roundIndex >= session.settings.rounds - 1 ? '最后一轮无法发布任务' : identity.lobbyistLastIssuedRound === session.roundIndex ? '本轮任务已发布' : null
  const lobbyActionValid = identityAction?.type !== 'lobbyistContract' || Boolean(lobbyTargetId) && (!identityAction.specified || (!(lobbyTask === 'outbid' || lobbyTask === 'underbid') || Boolean(lobbyCompareId) && lobbyCompareId !== lobbyTargetId))
  const fixedAssets = calculateFixedAssets(player.items, identity?.id === 'collector' ? identity.collectorCategory : undefined).filter((asset) => asset.itemCount > 0)
  return (
    <section className="private-turn">
      <div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>你的回合</h1></div><div className="private-overview"><BalanceReveal units={player.balanceUnits} /><IdentityReveal player={player} session={session} /></div></div>
      <div className="turn-grid">
        <div className="bid-panel panel">
          <PrizeCard item={item} compact />
          <div className="reward-strip">{session.settings.rewardMultipliers.map((multiplier, index) => <span key={index}><small>{MEDALS[index]} 名</small><CoinValue units={Math.round(item.value * 2 * multiplier)} /></span>)}</div>
          <div className="bid-control">
            <div className="bid-readout"><small>我的秘密下注</small><strong><CoinValue units={bidUnits} /></strong></div>
            <input className="range range--bid" aria-label="秘密下注" type="range" min="0" max={Math.max(0, player.balanceUnits - (identityAction?.type === 'reverserInvert' ? reverserCostUnits : 0))} step="1" value={bidUnits} onChange={(event) => setBid(Number(event.target.value))} />
            <div className="bid-shortcuts"><button onClick={() => setBid(bidUnits - 1)}>−0.5</button><button onClick={() => setBid(bidUnits + 1)}>+0.5</button><button onClick={() => setBid(bidUnits + 2)}>+1</button><button onClick={() => setBid(bidUnits + 10)}>+5</button><button onClick={() => setBid(player.balanceUnits)}>全部</button></div>
          </div>
        </div>
        <div className="prediction-panel panel">
          <div className="panel-title"><div><p className="eyebrow">可选</p><h2>谁会拿第一？</h2></div><span>猜中 +{item.value * session.settings.correctPredictionMultiplier}{identity?.id === 'gambler' ? ` + ${item.value * session.settings.identitySettings.gamblerCorrectBonusMultiplier}` : ''}<br />{identity?.id === 'gambler' ? `猜错或跳过 −${item.value * session.settings.identitySettings.gamblerSkipPenaltyMultiplier}` : `猜错 −${item.value * session.settings.wrongPredictionMultiplier}`}</span></div>
          <button className={cx('prediction-skip', prediction === null && 'is-selected')} onClick={() => setPrediction(null)}><span>稳一手</span><small>这轮不预测</small><i>{prediction === null ? '✓' : ''}</i></button>
          <div className="prediction-list">
            {session.players.filter((candidate) => candidate.id !== player.id).map((candidate) => <button key={candidate.id} className={cx(prediction === candidate.id && 'is-selected')} onClick={() => setPrediction(candidate.id)} style={{ '--player-color': candidate.color } as React.CSSProperties}><span>{candidate.name.slice(0, 1)}</span><strong>{candidate.name}</strong><i>{prediction === candidate.id ? '✓' : ''}</i></button>)}
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
          {identity.id === 'prophet' && <p>{nextItem ? <>下一轮拍品：<strong>{nextItem.emoji} {nextItem.name}</strong> · 价值 {nextItem.value}</> : '最后一轮，没有下一轮拍品。'}</p>}
          {identity.id === 'assassin' && <p>目标：<strong>{playerName(session.players, identity.targetPlayerId ?? null)}</strong>。本轮实际下注高于他可 +{session.settings.identitySettings.assassinSuccessCoins}，否则 −{session.settings.identitySettings.assassinFailureCoins}。</p>}
          {identity.id === 'collector' && <p>已为 <strong>{categoryConfig(identity.collectorCategory ?? 'leisure').name}</strong> 永久额外计入 1 件固定资产。</p>}
          {identity.id === 'thief' && <p>目标：<strong>{playerName(session.players, identity.targetPlayerId ?? null)}</strong> · 成功 {identity.thiefSuccesses}/{session.settings.identitySettings.thiefMaxSteals} 次。</p>}
          {identity.id === 'reverser' && <><p>花费 {reverserCost} 金币，倒转本轮获奖区内的所有名次；最后两轮费用翻倍。若同时使用“逆转排名”道具卡，两次逆转会抵消。</p><button className={cx('button', identityAction?.type === 'reverserInvert' && 'button--primary')} disabled={!identityAction && !reverserAffordable} onClick={() => setIdentityAction(identityAction?.type === 'reverserInvert' ? undefined : { type: 'reverserInvert' })}>{identityAction?.type === 'reverserInvert' ? '已安排逆转排名 · 点击撤销' : reverserAffordable ? `花费 ${reverserCost} 金币发动` : `余额不足，还差 ${formatCoins(reverserShortfallUnits)} 金币`}</button></>}
          {identity.id === 'merchant' && <><p>{merchantUnavailableReason ?? '可发起一次：下一轮抽奖前公开一张卡，其他玩家秘密竞购。'}</p><button className={cx('button', identityAction?.type === 'merchantAuction' && 'button--primary')} disabled={Boolean(merchantUnavailableReason)} onClick={() => setIdentityAction(identityAction?.type === 'merchantAuction' ? undefined : { type: 'merchantAuction' })}>{identityAction?.type === 'merchantAuction' ? '已安排下轮竞购 · 点击撤销' : merchantUnavailableReason ?? '发起下轮竞购'}</button></>}
          {identity.id === 'lobbyist' && <>{session.identityContracts.filter((contract) => contract.targetPlayerId === player.id && contract.status === 'pending' && contract.executeRoundIndex === session.roundIndex).map((contract) => <p key={contract.id} className="identity-task">本轮任务：<strong>{taskLabel(contract.taskType)}</strong>{contract.comparisonPlayerId ? ` ${playerName(session.players, contract.comparisonPlayerId)}` : ''}</p>)}{lobbyUnavailableReason ? <><p>{lobbyUnavailableReason}。</p><button className="button" disabled>{lobbyUnavailableReason}</button></> : <div className="lobbyist-form"><strong>发布下一轮任务 · 默认随机{lobbyFee === 0 ? '（本次免费）' : ` · 基础费用 ${lobbyFee} 金币`}</strong><select value={lobbyTargetId} onChange={(event) => { setLobbyTargetId(event.target.value); setIdentityAction(undefined) }}><option value="">选择任务对象</option>{session.players.filter((candidate) => candidate.id !== player.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><label className="switch-row"><span><strong>指定任务</strong><small>额外支付 {session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins} 金币</small></span><input type="checkbox" checked={lobbySpecified} onChange={(event) => { setLobbySpecified(event.target.checked); setIdentityAction(undefined) }} /></label>{lobbySpecified && <><select value={lobbyTask} onChange={(event) => { setLobbyTask(event.target.value as LobbyistTaskType); setIdentityAction(undefined) }}><option value="avoidPrize">不进入获奖区</option><option value="winFirst">拿到第一名</option><option value="outbid">下注高于某人</option><option value="underbid">下注低于某人</option></select>{(lobbyTask === 'outbid' || lobbyTask === 'underbid') && <select value={lobbyCompareId} onChange={(event) => { setLobbyCompareId(event.target.value); setIdentityAction(undefined) }}><option value="">比较谁</option>{session.players.filter((candidate) => candidate.id !== player.id && candidate.id !== lobbyTargetId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}</>}<button className={cx('button', identityAction?.type === 'lobbyistContract' && 'button--primary')} disabled={identityAction?.type !== 'lobbyistContract' && (!lobbyTargetId || !lobbyActionValid || lobbyShortfallUnits > 0)} onClick={() => setIdentityAction(identityAction?.type === 'lobbyistContract' ? undefined : { type: 'lobbyistContract', targetPlayerId: lobbyTargetId, specified: lobbySpecified, ...(lobbySpecified ? { taskType: lobbyTask, ...((lobbyTask === 'outbid' || lobbyTask === 'underbid') ? { comparisonPlayerId: lobbyCompareId } : {}) } : {}) })}>{identityAction?.type === 'lobbyistContract' ? '已安排发布任务 · 点击撤销' : !lobbyTargetId ? '请先选择任务对象' : !lobbyActionValid ? '请补全任务条件' : lobbyShortfallUnits > 0 ? `余额不足，还差 ${formatCoins(lobbyShortfallUnits)} 金币` : lobbySpecified ? `指定并发布（+${session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins}）` : '随机发布任务'}</button></div>}</>}</div>}
      </section>
      <section className="card-inventory panel">
        <div className="panel-title"><div><p className="eyebrow">仅自己可见</p><h2>我的道具</h2></div><span>本轮还可使用 {cardSlotsRemaining} 张</span></div>
        {player.cardInventory.length === 0 ? <p className="empty-cards">暂时没有道具卡。落后时，下一轮可能得到秘密支援。</p> : <div className="card-list">{player.cardInventory.map((cardId) => {
          const card = getCardDefinition(cardId)
          const unavailable = card.needsTarget && (cardId === 'swap' ? cardTargetPlayers.length === 0 : targetPlayers.length === 0)
          const confirmed = confirmedCardUses.find((use) => use.cardId === cardId)
          return <button key={cardId} className={cx('card-choice', (selectedCardId === cardId || confirmed) && 'is-selected')} disabled={!confirmed && (unavailable || cardSlotsRemaining === 0)} onClick={() => { if (confirmed) { setConfirmedCardUses((uses) => uses.filter((use) => use.cardId !== cardId)); return } if (card.needsTarget) { setSelectedCardId(cardId); setSelectedTargetId(null); return } openCardConfirmation({ cardId }) }}><span>{card.symbol}</span><div><strong>{card.name}</strong><small>{confirmed ? '本轮已安排，点击取消。' : unavailable ? '本轮尚无可选目标，可留到后续回合使用。' : cardSlotsRemaining === 0 ? '本轮已安排两张道具。' : card.description}</small></div><i>{(selectedCardId === cardId || confirmed) ? '✓' : ''}</i></button>
        })}</div>}
        {selectedCard?.needsTarget && <div className="card-targets"><strong>{selectedCardId === 'peek' ? '选择要查看的玩家' : '选择任意一名其他玩家，结算时交换排名金额'}</strong><div>{cardTargetPlayers.map((candidate) => <button key={candidate.id} className={cx(selectedTargetId === candidate.id && 'is-selected')} onClick={() => { setSelectedTargetId(candidate.id); openCardConfirmation({ cardId: selectedCardId as CardId, targetPlayerId: candidate.id }) }}><span style={{ background: candidate.color }}>{candidate.name.slice(0, 1)}</span>{candidate.name}{selectedTargetId === candidate.id && <i>✓</i>}</button>)}</div>{peekedTurn && <p className="peek-result">你看到：<strong>{playerName(session.players, peekedTurn.playerId)}</strong> 已投资 <CoinValue units={peekedTurn.bidUnits} />。这条信息不会被其他人看到。</p>}</div>}
      </section>
      <div className="private-submit"><p><span>下注 <strong>{unitsToCoins(bidUnits)}</strong></span><span>预测 <strong>{predicted?.name ?? '跳过'}</strong></span><span>道具 <strong>{confirmedCardUses.length > 0 ? confirmedCardUses.map((use) => getCardDefinition(use.cardId).name).join('、') : '不使用'}</strong></span></p><button className="button button--primary button--large" disabled={!canSubmitCards || !lobbyActionValid} onClick={() => setConfirming(true)}>确认我的选择</button></div>
      {confirming && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-sheet">
            <p className="eyebrow">最后确认</p><h2 id="confirm-title">提交后不能修改</h2>
            <div className="confirm-summary"><span>秘密下注 <strong><CoinValue units={bidUnits} /></strong></span><span>预测第一 <strong>{predicted?.name ?? '不预测'}</strong></span><span>使用道具 <strong>{confirmedCardUses.length > 0 ? confirmedCardUses.map((use) => `${getCardDefinition(use.cardId).name}${use.targetPlayerId ? ` · ${playerName(session.players, use.targetPlayerId)}` : ''}`).join('、') : '不使用'}</strong></span></div>
            <p>提交后请立刻把设备传给下一位，不要停留在此页。</p>
            <div><button className="button button--paper" onClick={() => setConfirming(false)}>再想想</button><button className="button button--primary" onClick={() => onSubmit({ playerId: player.id, bidUnits, predictedPlayerId: prediction, ...(confirmedCardUses.length > 0 ? { cardUses: confirmedCardUses } : {}), ...(identityAction ? { identityAction } : {}) })}>确定提交</button></div>
          </div>
        </div>
      )}
      {cardConfirming && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="card-confirm-title"><div className="confirm-sheet card-use-confirm"><p className="eyebrow">确认使用道具</p><h2 id="card-confirm-title">{getCardDefinition(cardConfirming.cardId).name}</h2>{cardConfirming.cardId === 'fateCoin' ? <div className="fate-coin-wrap"><div className={cx('fate-coin', coinFlipResult && 'is-settled')}><span>{coinFlipResult === 'heads' ? '正' : coinFlipResult === 'tails' ? '反' : '?'}</span></div><p>{coinFlipResult === null ? '硬币正在翻转…' : coinFlipResult === 'heads' ? '正面朝上：本轮获得 6 金币。' : '反面朝上：本轮损失 4 金币。'}</p></div> : <p>确认后，这张卡会安排在本轮结算时使用。{cardConfirming.targetPlayerId ? ` 目标：${playerName(session.players, cardConfirming.targetPlayerId)}。` : ''}</p>}<div><button className="button button--paper" onClick={() => { setCardConfirming(null); setCoinFlipResult(null) }}>取消</button><button className="button button--primary" disabled={cardConfirming.cardId === 'fateCoin' && coinFlipResult === null} onClick={confirmCardUse}>确认使用</button></div></div></div>}
      {grant && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="card-grant-sheet"><span>{getCardDefinition(grant.cardId).symbol}</span><p className="eyebrow">秘密支援</p><h2 id="grant-title">你获得了{getCardDefinition(grant.cardId).name}</h2><p>{getCardDefinition(grant.cardId).description}</p><small>这张卡已加入你的库存。请勿告诉其他人。</small><button className="button button--primary" onClick={() => onAcknowledgeGrant(player.id)}>收下道具卡</button></div></div>}
      {session.pendingIdentityNotices.filter((notice) => notice.playerId === player.id).map((notice) => <div key={notice.id} className="modal-backdrop" role="dialog" aria-modal="true"><div className="card-grant-sheet"><span>!</span><p className="eyebrow">身份提示</p><h2>{notice.title}</h2><p>{notice.detail}</p><button className="button button--primary" onClick={() => onAcknowledgeNotice(notice.id)}>知道了</button></div></div>)}
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
  return <section className="round-intro screen-center"><p className="eyebrow">道具商人发起竞购</p><h1>一张公开道具，<br /><em>秘密报价。</em></h1><div className="auction-card"><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></div><p className="lead">商人不参与。最高唯一报价者获得道具，报价款归商人。</p><button className="button button--primary button--large" onClick={onContinue}>开始秘密竞购</button></section>
}

function AuctionHandoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const auction = session.merchantAuction as NonNullable<GameSession['merchantAuction']>
  const bidders = session.players.filter((player) => player.id !== auction.merchantId)
  const player = bidders[auction.bidderIndex]
  return <section className="handoff screen-center"><div className="privacy-seal"><span>竞</span></div><p className="eyebrow">请把设备交给</p><h1 style={{ color: player.color }}>{player.name}</h1><p className="lead">为公开道具秘密报价，其他人请移开视线。</p><button className="handoff-enter" onClick={onReady}>报价 <span>→</span></button></section>
}

function AuctionBid({ session, onSubmit }: { session: GameSession; onSubmit: (bidUnits: number) => void }) {
  const auction = session.merchantAuction as NonNullable<GameSession['merchantAuction']>
  const bidders = session.players.filter((player) => player.id !== auction.merchantId)
  const player = bidders[auction.bidderIndex]
  const card = getCardDefinition(auction.cardId)
  const [bidUnits, setBidUnits] = useState(0)
  return <section className="private-turn"><div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>秘密竞购</h1></div><BalanceReveal units={player.balanceUnits} /></div><section className="auction-bid panel"><div className="auction-card"><span>{card.symbol}</span><strong>{card.name}</strong><small>{card.description}</small></div><p>报价只在你和系统之间可见。最高唯一正报价者获得道具。</p><label className="field-label">我的报价 <strong><CoinValue units={bidUnits} /></strong></label><input className="range range--bid" aria-label="竞购报价" type="range" min="0" max={player.balanceUnits} step="1" value={bidUnits} onChange={(event) => setBidUnits(Number(event.target.value))} /><div className="bid-shortcuts"><button onClick={() => setBidUnits(Math.max(0, bidUnits - 1))}>−0.5</button><button onClick={() => setBidUnits(Math.min(player.balanceUnits, bidUnits + 1))}>+0.5</button><button onClick={() => setBidUnits(Math.min(player.balanceUnits, bidUnits + 2))}>+1</button><button onClick={() => setBidUnits(player.balanceUnits)}>全部</button></div><button className="button button--primary button--large" onClick={() => onSubmit(bidUnits)}>{bidUnits > 0 ? '确认秘密报价' : '跳过竞购'}</button></section></section>
}

function DeltaLabel({ units }: { units: number }) {
  if (units === 0) return <span className="delta delta--zero">±0</span>
  return <span className={cx('delta', units > 0 ? 'delta--up' : 'delta--down')}><CoinValue units={units} signed /></span>
}

function RoundResults({ session, result, onNext }: { session: GameSession; result: RoundResult; onNext: () => void }) {
  const [skipMotion, setSkipMotion] = useState(session.settings.animationSpeed === 'reduced')
  const item = result.item
  const winner = session.players.find((player) => player.id === result.winnerId)
  const valueChanged = result.effectiveValueUnits !== item.value * 2
  return (
    <section className={cx('results-page', skipMotion && 'skip-motion')}>
      <div className="results-hero">
        <div><p className="eyebrow">第 {result.roundIndex + 1} 轮 · 结果</p><h1>{winner ? <><em>{winner.name}</em> 拿下 {item.name}</> : <>本轮物品<em>流拍</em></>}</h1><p>{winner ? '唯一排名金额胜出，获得本轮第一名奖励。' : '没有产生唯一排名金额，物品无人获得。'}</p></div>
        <div className="result-prize"><span>{item.emoji}</span><small>{valueChanged ? <>真实价值 <CoinValue units={result.effectiveValueUnits} /></> : <>价值 {item.value}</>}</small></div>
      </div>
      <div className="result-metrics"><div><small>本轮总下注</small><CoinValue units={result.totalBidUnits} /></div><div><small>最低获奖排名额</small>{result.minWinningBidUnits === null ? <strong>—</strong> : <CoinValue units={result.minWinningBidUnits} />}</div><div><small>并列出局</small><strong>{result.tiedPlayerIds.length} 人</strong></div></div>
      {result.cardEffects.length > 0 && <article className="panel card-effects"><div className="panel-title"><div><p className="eyebrow">结算影响</p><h2>本轮道具与排名变化</h2></div><span>已计入本轮结果</span></div><div>{result.cardEffects.map((effect, index) => <p key={`${effect.cardId}-${index}`}><span>{getCardDefinition(effect.cardId).symbol}</span>{effect.description}</p>)}</div></article>}
      <div className="result-columns">
        <article className="panel result-ranking"><div className="panel-title"><div><p className="eyebrow">下注排名</p><h2>本轮获奖</h2></div>{result.tiedPlayerIds.length > 0 && <span>{result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')} 并列出局</span>}</div>
          {result.rankings.length === 0 ? <div className="empty-result">没有唯一排名金额，奖励全部落空。</div> : <ol>{result.rankings.map((entry, index) => <li key={entry.playerId} style={{ '--delay': `${index * 110}ms`, '--player-color': session.players.find((player) => player.id === entry.playerId)?.color } as React.CSSProperties}><span>{MEDALS[index]}</span><strong>{playerName(session.players, entry.playerId)}</strong>{session.settings.revealBids && <small>下注 {formatCoins(entry.actualBidUnits)}{entry.actualBidUnits !== entry.bidUnits ? ` · 排名额 ${formatCoins(entry.bidUnits)}` : ''}</small>}<CoinValue units={entry.publicRewardUnits} signed /></li>)}</ol>}
        </article>
        <article className="panel prediction-result"><div className="panel-title"><div><p className="eyebrow">眼光如何</p><h2>预测结算</h2></div>{result.winnerPaymentUnits > 0 && <span>第一名共支付 {formatCoins(result.winnerPaymentUnits)}</span>}</div>
          <div className="prediction-outcomes">{result.predictionOutcomes.map((outcome, index) => <div key={outcome.playerId} style={{ '--delay': `${index * 90 + 180}ms` } as React.CSSProperties}><strong>{playerName(session.players, outcome.playerId)}</strong><span>{outcome.status === 'skipped' ? '没有预测' : outcome.status === 'correct' ? `猜中 ${playerName(session.players, outcome.predictedPlayerId)}` : `猜错（选了 ${playerName(session.players, outcome.predictedPlayerId)}）`}</span><DeltaLabel units={outcome.deltaUnits} /></div>)}</div>
        </article>
      </div>
      <article className="panel public-ledger"><div className="panel-title"><div><p className="eyebrow">公开账本</p><h2>本轮收益变化</h2></div><span>不含秘密下注 · 不显示余额</span></div>
        <div className="ledger-table">{session.players.map((player) => { const delta = result.deltas.find((entry) => entry.playerId === player.id)!; const turn = result.turns.find((entry) => entry.playerId === player.id); return <div key={player.id}><span className="player-dot" style={{ background: player.color }} /><strong>{player.name}</strong>{session.settings.revealBids && <small>下注 {turn ? formatCoins(turn.bidUnits) : '—'}</small>}<small>获奖 {delta.rewardUnits ? `+${formatCoins(delta.rewardUnits)}` : '±0'}</small><small>预测 {delta.predictionUnits > 0 ? '+' : ''}{formatCoins(delta.predictionUnits)}</small><DeltaLabel units={delta.publicDeltaUnits} /></div> })}</div>
      </article>
      {session.settings.revealBalanceLeader && <article className="balance-leader"><span>♛</span><div><small>当前余额领跑者</small><strong>{result.balanceLeaderIds.length > 1 ? '并列第一 · ' : ''}{result.balanceLeaderIds.map((id) => playerName(session.players, id)).join('、')}</strong></div><p>仅公布姓名，不公布余额</p></article>}
      <div className="result-actions"><button className="text-button" onClick={() => setSkipMotion(true)}>跳过动画</button><button className="button button--primary button--large" onClick={onNext}>{session.roundIndex + 1 >= session.settings.rounds ? '查看最终排行榜' : '进入下一轮'} <span>→</span></button></div>
    </section>
  )
}

function identityActionReview(action: IdentityAction, players: Player[]): string {
  if (action.type === 'reverserInvert') return '逆行者发动了获奖区排名逆转'
  if (action.type === 'merchantAuction') return '道具商人发起了下一轮道具竞购'
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
          return <details key={result.roundIndex} open={result.roundIndex === session.results.length - 1}>
            <summary><span>第 {result.roundIndex + 1} 轮</span><strong>{result.item.emoji} {result.item.name}</strong><small>真实价值 {formatCoins(result.effectiveValueUnits)} · 总下注 {formatCoins(result.totalBidUnits)}</small></summary>
            <div className="round-review-grid">
              <article className="review-block"><h3>全部下注</h3>{result.turns.map((turn) => { const ranking = result.rankings.find((entry) => entry.playerId === turn.playerId); return <div className="review-row" key={turn.playerId}><strong>{playerName(session.players, turn.playerId)}</strong><span>实际下注 <CoinValue units={turn.bidUnits} /></span>{ranking && ranking.bidUnits !== turn.bidUnits && <small>排名下注 {formatCoins(ranking.bidUnits)}</small>}</div> })}</article>
              <article className="review-block"><h3>道具使用</h3>{cardTurns.length === 0 ? <p>本轮没有使用道具。</p> : cardTurns.map(({ playerId, use }, index) => { const target = use.targetPlayerId ? ` → ${playerName(session.players, use.targetPlayerId)}` : ''; const coin = use.cardId === 'fateCoin' ? `（${use.coinResult === 'heads' ? '正面' : '反面'}）` : ''; return <div className="review-row" key={`${playerId}-${use.cardId}-${index}`}><strong>{playerName(session.players, playerId)}</strong><span>{getCardDefinition(use.cardId).symbol} {getCardDefinition(use.cardId).name}{coin}{target}</span></div> })}{result.cardEffects.length > 0 && <div className="review-effects">{result.cardEffects.map((effect, index) => <small key={`${effect.cardId}-${index}`}>{effect.description}</small>)}</div>}</article>
              <article className="review-block"><h3>身份技能</h3>{skillTurns.length === 0 && identityEvents.length === 0 ? <p>本轮没有身份技能记录。</p> : <>{skillTurns.map((turn) => <div className="review-row" key={`${turn.playerId}-${turn.identityAction!.type}`}><strong>{playerName(session.players, turn.playerId)}</strong><span>{identityActionReview(turn.identityAction!, session.players)}</span></div>)}{identityEvents.map((event, index) => <div className="review-row review-row--event" key={`${event.playerId}-${event.title}-${index}`}><strong>{playerName(session.players, event.playerId)} · {event.title}</strong><span>{event.detail}</span>{event.deltaUnits !== 0 && <DeltaLabel units={event.deltaUnits} />}</div>)}</>}</article>
              <article className="review-block"><h3>奖励如何发放</h3>{result.rankings.length === 0 ? <p>没有唯一排名，排名奖励与拍品均未发放。</p> : <>{result.rankings.map((entry) => <div className="review-row" key={entry.playerId}><strong>第 {entry.place} 名 · {playerName(session.players, entry.playerId)}</strong><span>获奖 <CoinValue units={entry.rewardUnits} signed /></span>{entry.playerId === result.winnerId && <small>获得拍品：{result.item.emoji} {result.item.name}</small>}</div>)}{result.tiedPlayerIds.length > 0 && <p>并列出局：{result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')}</p>}</>}</article>
              <article className="review-block review-block--wide"><h3>预测与本轮结算</h3><div className="review-settlement">{result.predictionOutcomes.map((outcome) => <div className="review-row" key={outcome.playerId}><strong>{playerName(session.players, outcome.playerId)}</strong><span>{outcome.status === 'skipped' ? '未预测' : outcome.status === 'correct' ? `猜中 ${playerName(session.players, outcome.predictedPlayerId)}` : `猜错（选择 ${playerName(session.players, outcome.predictedPlayerId)}）`}</span><DeltaLabel units={outcome.deltaUnits} /></div>)}</div>{result.winnerPaymentUnits > 0 && <p>第一名向猜中者共支付 {formatCoins(result.winnerPaymentUnits)}。</p>}<div className="review-delta-list">{result.deltas.map((delta) => <small key={delta.playerId}>{playerName(session.players, delta.playerId)}：获奖 {delta.rewardUnits > 0 ? '+' : ''}{formatCoins(delta.rewardUnits)} · 预测 {delta.predictionUnits > 0 ? '+' : ''}{formatCoins(delta.predictionUnits)} · 身份 {delta.identityUnits > 0 ? '+' : ''}{formatCoins(delta.identityUnits)}</small>)}</div></article>
            </div>
          </details>
        })}
      </div>
    </section>
  )
}

function FinalResult({ session, onNewGame }: { session: GameSession; onNewGame: () => void }) {
  const standings = rankFinalPlayers(session.players)
  const topAssets = standings[0]?.totalAssetUnits ?? 0
  return (
    <section className="final-page">
      <div className="final-heading"><p className="eyebrow">全局结束</p><h1>最后的赢家，<br /><em>{standings.filter((standing) => standing.totalAssetUnits === topAssets).map((standing) => standing.player.name).join('、')}</em></h1><p>{session.settings.rounds} 轮竞价已经落定。最终以金币与固定资产总和排名。</p></div>
      <div className="podium-list">{standings.map((standing, index) => <article key={standing.player.id} className={cx(index === 0 && 'is-first')} style={{ '--delay': `${index * 100}ms`, '--player-color': standing.player.color } as React.CSSProperties}><span className="standing-place">{standing.place}</span><div className="standing-avatar">{standing.player.name.slice(0, 1)}</div><div className="standing-copy"><strong>{standing.player.name}</strong><small>{standing.player.items.length > 0 ? standing.player.items.map(({ item }) => `${item.emoji}${item.name}`).join(' · ') : '没有收藏品'}</small>{standing.fixedAssets.some((asset) => asset.units > 0) && <div className="asset-breakdown">{standing.fixedAssets.filter((asset) => asset.units > 0).map((asset) => <span key={asset.category}>{ASSET_CATEGORY_CONFIGS.find((entry) => entry.category === asset.category)?.symbol} {categoryConfig(asset.category).name} {asset.itemCount} 件 +{formatCoins(asset.units)}</span>)}</div>}</div><div className="standing-balance"><CoinValue units={standing.totalAssetUnits} /><small>总资产</small><span>现金 {formatCoins(standing.cashUnits)} · 固定资产 +{formatCoins(standing.fixedAssetUnits)}</span></div></article>)}</div>
      <RoundReview session={session} />
      <div className="final-note">固定资产不会进入每轮余额；同总资产玩家共享同一名次。</div>
      <button className="button button--primary button--large" onClick={onNewGame}>再开一局</button>
    </section>
  )
}

function Game({ session, setSession, onExit, onNewGame }: { session: GameSession; setSession: (session: GameSession) => void; onExit: () => void; onNewGame: () => void }) {
  const patch = (changes: Partial<GameSession>) => setSession({ ...session, ...changes, updatedAt: new Date().toISOString() })
  const chooseIdentity = (identityId: IdentityId) => {
    const draft = session.identityDraft
    if (!draft || !draft.choiceIds.includes(identityId)) return
    const identity = getIdentityDefinition(identityId)
    const merchantCardOfferIds = identity.needsMerchantCard ? session.cardDeck.slice(0, session.settings.identitySettings.merchantInitialOfferCount) : undefined
    patch({ identityDraft: { ...draft, selectedIdentityId: identityId, ...(merchantCardOfferIds ? { merchantCardOfferIds } : {}) } })
  }
  const confirmIdentity = (config: { targetPlayerId?: string; collectorCategory?: AssetCategory; merchantCardId?: CardId }) => {
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
    const players = session.players.map((player, index) => index === draft.playerIndex ? { ...player, identity: createPlayerIdentity(identityId, config) } : player)
    const available = session.identityAvailableIds.filter((id) => id !== identityId)
    const nextIndex = draft.playerIndex + 1
    if (nextIndex >= players.length) {
      const routed = routeCardAwards({ players, awards: pendingAwards, settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex: 0 })
      patch({ players: routed.players, cardDeck, pendingIdentityCardAwards: [], pendingIdentityNotices: [...session.pendingIdentityNotices, ...routed.notices], identityEvents: [...session.identityEvents, ...routed.events], identityAvailableIds: available, identityDraft: null, phase: 'roundIntro' })
      return
    }
    patch({ players, cardDeck, pendingIdentityCardAwards: pendingAwards, identityAvailableIds: available, identityDraft: { playerIndex: nextIndex, choiceIds: dealIdentityChoices(available, session.settings.identitySettings) }, phase: 'identityHandoff' })
  }
  const submitTurn = (turn: RoundTurn) => {
    const currentPlayer = session.players.find((player) => player.id === turn.playerId)
    if (!currentPlayer || turn.bidUnits < 0 || turn.bidUnits > currentPlayer.balanceUnits) return
    if (turn.identityAction?.type === 'reverserInvert') {
      const isLastTwoRounds = session.roundIndex >= session.settings.rounds - 2
      const costUnits = Math.round(session.settings.identitySettings.reverserActivationCoins * (isLastTwoRounds ? 4 : 2))
      if (currentPlayer.identity?.id !== 'reverser' || turn.bidUnits + costUnits > currentPlayer.balanceUnits) return
    }
    const cardUses = turnCardUses(turn)
    if (cardUses.length > 2 || new Set(cardUses.map((use) => use.cardId)).size !== cardUses.length) return
    for (const use of cardUses) {
      if (!currentPlayer.cardInventory.includes(use.cardId)) return
      const needsTarget = getCardDefinition(use.cardId).needsTarget
      const targetIsPrevious = session.turns.some((submitted) => submitted.playerId === use.targetPlayerId)
      const targetIsOtherPlayer = Boolean(use.targetPlayerId && use.targetPlayerId !== turn.playerId && session.players.some((player) => player.id === use.targetPlayerId))
      if (needsTarget && use.cardId === 'peek' && !targetIsPrevious) return
      if (needsTarget && use.cardId === 'swap' && !targetIsOtherPlayer) return
      if (use.cardId === 'fateCoin' && use.coinResult !== 'heads' && use.coinResult !== 'tails') return
    }
    let players = session.players.map((player) => player.id === turn.playerId ? {
      ...player,
      balanceUnits: player.balanceUnits - turn.bidUnits,
      cardInventory: cardUses.length > 0 ? player.cardInventory.filter((cardId) => !cardUses.some((use) => use.cardId === cardId)) : player.cardInventory,
    } : player)
    let identityContracts = [...session.identityContracts]
    let resolvedTurn = turn
    let merchantAuction = session.merchantAuction
    if (turn.identityAction?.type === 'merchantAuction') {
      if (currentPlayer.identity?.id !== 'merchant' || currentPlayer.identity.merchantAuctionUsed || session.roundIndex >= session.settings.rounds - 1 || session.cardDeck.length === 0) return
      const merchant = players.find((player) => player.id === turn.playerId)
      if (!merchant?.identity) return
      merchant.identity = { ...merchant.identity, merchantAuctionUsed: true }
      merchantAuction = { merchantId: turn.playerId, cardId: session.cardDeck[0], roundIndex: session.roundIndex + 1, bidderIndex: 0, bids: [] }
    }
    if (turn.identityAction?.type === 'lobbyistContract') {
      if (currentPlayer.identity?.id !== 'lobbyist' || session.roundIndex >= session.settings.rounds - 1 || currentPlayer.identity.lobbyistLastIssuedRound === session.roundIndex) return
      const action = turn.identityAction
      if (action.targetPlayerId === turn.playerId || !session.players.some((player) => player.id === action.targetPlayerId)) return
      const resolvedTask = action.specified && action.taskType ? { taskType: action.taskType, comparisonPlayerId: action.comparisonPlayerId } : randomLobbyistTask(session.players.map((player) => player.id), action.targetPlayerId)
      if ((resolvedTask.taskType === 'outbid' || resolvedTask.taskType === 'underbid') && (!resolvedTask.comparisonPlayerId || resolvedTask.comparisonPlayerId === action.targetPlayerId || !session.players.some((player) => player.id === resolvedTask.comparisonPlayerId))) return
      const identity = currentPlayer.identity
      const isFree = (session.roundIndex === 0 && session.settings.identitySettings.lobbyistFirstRoundFree) || identity.lobbyistNextFree
      const feeUnits = (isFree ? 0 : Math.round(session.settings.identitySettings.lobbyistFeeCoins * 2)) + (action.specified ? Math.round(session.settings.identitySettings.lobbyistSpecifiedTaskFeeCoins * 2) : 0)
      const actor = players.find((player) => player.id === turn.playerId)
      if (!actor || actor.balanceUnits < feeUnits) return
      actor.balanceUnits -= feeUnits
      actor.identity = { ...identity, lobbyistNextFree: false, lobbyistLastIssuedRound: session.roundIndex }
      identityContracts.push({ id: `contract-${session.roundIndex}-${turn.playerId}-${Date.now()}`, issuerId: turn.playerId, targetPlayerId: action.targetPlayerId, taskType: resolvedTask.taskType, comparisonPlayerId: resolvedTask.comparisonPlayerId, specified: Boolean(action.specified), issuedRoundIndex: session.roundIndex, executeRoundIndex: session.roundIndex + 1, status: 'pending', paymentUnits: 0 })
      resolvedTurn = { ...turn, identityAction: { type: 'lobbyistContract', targetPlayerId: action.targetPlayerId, specified: Boolean(action.specified), taskType: resolvedTask.taskType, ...(resolvedTask.comparisonPlayerId ? { comparisonPlayerId: resolvedTask.comparisonPlayerId } : {}) } }
    }
    const turns = [...session.turns, resolvedTurn]
    const isLast = session.currentTurnIndex >= session.players.length - 1
    patch({ players, turns, identityContracts, merchantAuction, phase: isLast ? 'revealReady' : 'handoff', currentTurnIndex: isLast ? session.currentTurnIndex : session.currentTurnIndex + 1 })
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
    patch({ players: settled.players, identityContracts: settled.identityContracts, pendingIdentityNotices: [...session.pendingIdentityNotices, ...feedbackNotices], identityEvents: [...session.identityEvents, ...settled.identityEvents], results: [...session.results, settled.result], phase: 'roundResult' })
  }
  const beginNormalRound = (roundIndex: number, basePlayers: Player[], baseDeck: CardId[], notices = session.pendingIdentityNotices, events = session.identityEvents) => {
    const grants = roundIndex >= session.cardRulesStartRound ? prepareCardGrants({ players: basePlayers, cardDeck: baseDeck, roundIndex, probability: session.settings.cardGrantProbability }) : { players: basePlayers, cardDeck: baseDeck, pendingCardGrants: [] }
    const awards = grants.pendingCardGrants.map((grant) => ({ playerId: grant.playerId, cardId: grant.cardId }))
    const strippedPlayers = grants.players.map((player) => ({ ...player, cardInventory: player.cardInventory.filter((cardId) => !awards.some((award) => award.playerId === player.id && award.cardId === cardId)) }))
    const routed = routeCardAwards({ players: strippedPlayers, awards, settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex })
    const deliveredKeys = new Set(routed.delivered.map((award) => `${award.playerId}-${award.cardId}`))
    patch({ phase: 'roundIntro', roundIndex, currentTurnIndex: 0, turns: [], players: routed.players, cardDeck: grants.cardDeck, pendingCardGrants: grants.pendingCardGrants.filter((grant) => deliveredKeys.has(`${grant.playerId}-${grant.cardId}`)), pendingIdentityNotices: [...notices, ...routed.notices], identityEvents: [...events, ...routed.events], merchantAuction: null })
  }
  const nextRound = () => {
    if (session.roundIndex + 1 >= session.settings.rounds) patch({ phase: 'finalResult' })
    else {
      const nextRoundIndex = session.roundIndex + 1
      const recycledCardDeck = recycleUsedCards(session.cardDeck, session.turns)
      const auction = session.merchantAuction
      const taskNotices = session.identityContracts
        .filter((contract) => contract.status === 'pending' && contract.executeRoundIndex === nextRoundIndex)
        .map((contract) => ({ id: `lobby-task-${nextRoundIndex}-${contract.id}`, playerId: contract.targetPlayerId, title: '收到说客任务', detail: `本轮任务：${taskLabel(contract.taskType)}${contract.comparisonPlayerId ? ` ${playerName(session.players, contract.comparisonPlayerId)}` : ''}。若未完成，将向说客支付 ${formatCoins(Math.round(session.settings.identitySettings.lobbyistFailurePaymentCoins * 2))} 金币。` }))
      if (auction?.roundIndex === nextRoundIndex) {
        const deck = [...recycledCardDeck]
        const cardIndex = deck.indexOf(auction.cardId)
        if (cardIndex >= 0) deck.splice(cardIndex, 1)
        patch({ phase: 'auctionIntro', roundIndex: nextRoundIndex, currentTurnIndex: 0, turns: [], cardDeck: deck, pendingIdentityNotices: [...session.pendingIdentityNotices, ...taskNotices], merchantAuction: { ...auction, bidderIndex: 0, bids: [] } })
      } else beginNormalRound(nextRoundIndex, session.players, recycledCardDeck, [...session.pendingIdentityNotices, ...taskNotices])
    }
  }
  const submitAuctionBid = (bidUnits: number) => {
    const auction = session.merchantAuction
    if (!auction) return
    const bidders = session.players.filter((player) => player.id !== auction.merchantId)
    const bidder = bidders[auction.bidderIndex]
    if (!bidder || bidUnits < 0 || bidUnits > bidder.balanceUnits) return
    const bids = [...auction.bids, { playerId: bidder.id, bidUnits }]
    if (auction.bidderIndex < bidders.length - 1) {
      patch({ merchantAuction: { ...auction, bidderIndex: auction.bidderIndex + 1, bids }, phase: 'auctionHandoff' })
      return
    }
    const positive = bids.filter((bid) => bid.bidUnits > 0)
    const counts = new Map<number, number>()
    positive.forEach((bid) => counts.set(bid.bidUnits, (counts.get(bid.bidUnits) ?? 0) + 1))
    const winnerBid = positive.filter((bid) => counts.get(bid.bidUnits) === 1).sort((left, right) => right.bidUnits - left.bidUnits)[0]
    let players: Player[] = session.players.map((player) => ({ ...player, items: [...player.items], cardInventory: [...player.cardInventory], identity: player.identity ? { ...player.identity } : undefined }))
    let deck = [...session.cardDeck]
    let notices = [...session.pendingIdentityNotices]
    let events = [...session.identityEvents]
    if (winnerBid) {
      const winner = players.find((player) => player.id === winnerBid.playerId)
      const merchant = players.find((player) => player.id === auction.merchantId)
      if (winner && merchant) { winner.balanceUnits -= winnerBid.bidUnits; merchant.balanceUnits += winnerBid.bidUnits }
      events.push({ playerId: auction.merchantId, identityId: 'merchant', roundIndex: auction.roundIndex, title: '道具竞购成交', detail: `收到 ${formatCoins(winnerBid.bidUnits)} 金币。`, deltaUnits: winnerBid.bidUnits })
      events.push({ playerId: winnerBid.playerId, identityId: 'merchant', roundIndex: auction.roundIndex, title: '竞购获得道具', detail: `支付 ${formatCoins(winnerBid.bidUnits)} 金币。`, deltaUnits: -winnerBid.bidUnits })
      const routed = routeCardAwards({ players, awards: [{ playerId: winnerBid.playerId, cardId: auction.cardId }], settings: session.settings.identitySettings, fairnessOrderIds: session.fairnessOrderIds, roundIndex: auction.roundIndex })
      players = routed.players; notices = [...notices, ...routed.notices]; events = [...events, ...routed.events]
      notices = [...notices, ...events.slice(session.identityEvents.length).map(identityFeedbackNotice)]
    } else {
      deck = shuffle([...deck, auction.cardId])
      notices.push({ id: `merchant-auction-empty-${auction.roundIndex}-${auction.merchantId}`, playerId: auction.merchantId, title: '道具竞购无人得标', detail: '没有唯一的正向报价，道具已回到循环卡池。' })
    }
    beginNormalRound(auction.roundIndex, players, deck, notices, events)
  }
  const acknowledgeGrant = (playerId: string) => patch({ pendingCardGrants: session.pendingCardGrants.map((grant) => grant.playerId === playerId ? { ...grant, announced: true } : grant) })
  const acknowledgeNotice = (noticeId: string) => patch({ pendingIdentityNotices: session.pendingIdentityNotices.filter((notice) => notice.id !== noticeId) })
  const result = session.results[session.results.length - 1]
  return (
    <AppShell quiet={session.phase === 'handoff' || session.phase === 'identityHandoff' || session.phase === 'auctionHandoff'}>
      {session.phase !== 'finalResult' && <GameHeader session={session} onExit={onExit} />}
      {session.phase === 'identityHandoff' && <IdentityHandoff session={session} onReady={() => patch({ phase: 'identityDraft' })} />}
      {session.phase === 'identityDraft' && <IdentityDraft key={session.identityDraft?.playerIndex} session={session} onChoose={chooseIdentity} onConfirm={confirmIdentity} />}
      {session.phase === 'auctionIntro' && <AuctionIntro session={session} onContinue={() => patch({ phase: 'auctionHandoff' })} />}
      {session.phase === 'auctionHandoff' && <AuctionHandoff session={session} onReady={() => patch({ phase: 'auctionBid' })} />}
      {session.phase === 'auctionBid' && <AuctionBid key={session.merchantAuction?.bidderIndex} session={session} onSubmit={submitAuctionBid} />}
      {session.phase === 'roundIntro' && <RoundIntro key={session.roundIndex} session={session} onContinue={() => patch({ phase: 'handoff' })} />}
      {session.phase === 'handoff' && <Handoff session={session} onReady={() => patch({ phase: 'privateTurn' })} />}
      {session.phase === 'privateTurn' && <PrivateTurn key={`${session.roundIndex}-${session.currentTurnIndex}`} session={session} onSubmit={submitTurn} onAcknowledgeGrant={acknowledgeGrant} onAcknowledgeNotice={acknowledgeNotice} />}
      {session.phase === 'revealReady' && <RevealReady session={session} onReveal={reveal} />}
      {session.phase === 'roundResult' && result && <RoundResults key={session.roundIndex} session={session} result={result} onNext={nextRound} />}
      {session.phase === 'finalResult' && <FinalResult session={session} onNewGame={onNewGame} />}
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
  const quickStart = () => { const preset = SYSTEM_PRESETS[0]; begin(createSession(preset.names, cloneSettings(preset.settings))) }
  const persistPresets = (next: GamePreset[]) => { setPresets(next); savePresets(next) }
  const removeSaved = () => { clearSession(); setSaved(null); setSession(null) }
  const newGame = () => { clearSession(); setSaved(null); setSession(null); setScreen('setup') }

  if (screen === 'rules') return <Rules onBack={() => setScreen('home')} />
  if (screen === 'setup') return <Setup onBack={() => setScreen('home')} onStart={begin} presets={presets} onSavePresets={persistPresets} />
  if (screen === 'game' && session) return <Game session={session} setSession={setSession} onExit={() => setScreen('home')} onNewGame={newGame} />
  return <Home saved={saved} onQuickStart={quickStart} onSetup={() => setScreen('setup')} onContinue={() => { if (saved) { setSession(saved); setScreen('game') } }} onRules={() => setScreen('rules')} onDelete={removeSaved} />
}
