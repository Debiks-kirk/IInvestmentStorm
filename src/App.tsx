import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { defaultRewards, formatCoins, rankFinalPlayers, settleRound, unitsToCoins, validateSettings } from './game/engine'
import { ITEM_POOL } from './game/items'
import { createDefaultSettings, createSession, validateNames } from './game/session'
import { clearSession, loadSession, saveSession } from './game/storage'
import type { GameSession, GameSettings, Player, RoundResult, RoundTurn } from './game/types'

type Screen = 'home' | 'setup' | 'rules' | 'game'

const MEDALS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function playerName(players: Player[], id: string | null): string {
  return players.find((player) => player.id === id)?.name ?? '无人'
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
          <article><span className="rule-number">04</span><h2>留到最后</h2><p>排名奖励先到账，预测随后结算。最终金币最多的人获胜，物品只作收藏。</p></article>
        </div>
        <div className="rule-example">
          <div><small>四人下注</small><strong>10 · 10 · 9 · 8</strong></div>
          <span>→</span>
          <div><small>10 撞车出局</small><strong>9 成为第一</strong></div>
        </div>
        <button className="button button--primary" onClick={onBack}>明白了</button>
      </section>
    </AppShell>
  )
}

function Setup({ onBack, onStart }: { onBack: () => void; onStart: (session: GameSession) => void }) {
  const [settings, setSettings] = useState<GameSettings>(() => createDefaultSettings())
  const [names, setNames] = useState(['玩家 1', '玩家 2', '玩家 3'])
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

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
    const nextErrors = [...validateNames(names), ...validateSettings(settings)]
    setErrors(nextErrors)
    if (nextErrors.length === 0) onStart(createSession(names, settings))
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
                <div className="setting-row"><label htmlFor="motion">动画速度</label><select id="motion" value={settings.animationSpeed} onChange={(event) => setSettings({ ...settings, animationSpeed: event.target.value as GameSettings['animationSpeed'] })}><option value="full">完整</option><option value="fast">快速</option><option value="reduced">极简</option></select></div>
              </div>
            )}
          </div>
        </div>
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
      <div><small>目标物品 · 价值 {item.value}</small><strong>{item.name}</strong></div>
    </div>
  )
}

function RoundIntro({ session, onContinue }: { session: GameSession; onContinue: () => void }) {
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const timer = useRef<number | null>(null)
  const item = session.itemDeck[session.roundIndex]
  const wheelItems = useMemo(() => [item, ...ITEM_POOL.filter((candidate) => candidate.id !== item.id).slice(session.roundIndex, session.roundIndex + 7)], [item, session.roundIndex])
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
        <div className={cx('prize-wheel', spinning && 'is-spinning')}>
          <div className="prize-wheel__pointer">◆</div>
          <div className="prize-wheel__disc">
            {wheelItems.map((wheelItem, index) => <span key={`${wheelItem.id}-${index}`} style={{ transform: `rotate(${index * 45}deg) translateY(-42%) rotate(${-index * 45}deg)` }}>{wheelItem.emoji}</span>)}
            <div>?</div>
          </div>
        </div>
      ) : <PrizeCard item={item} />}
      <div className="center-actions">
        {!spinning && !revealed && <button className="button button--primary button--large" onClick={spin}>转动选物</button>}
        {spinning && <p className="muted pulse">命运正在挑选……</p>}
        {revealed && <><p className="muted">看清楚了吗？接下来请依次秘密操作。</p><button className="button button--primary button--large" onClick={onContinue}>开始传递 <span>→</span></button></>}
      </div>
    </section>
  )
}

function HoldButton({ onComplete, children }: { onComplete: () => void; children: ReactNode }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setHolding(false) }
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setHolding(true)
    timer.current = window.setTimeout(() => { setHolding(false); onComplete() }, 750)
  }
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return <button className={cx('hold-button', holding && 'is-holding')} onPointerDown={start} onPointerUp={clear} onPointerCancel={clear} onContextMenu={(event) => event.preventDefault()}><span>{children}</span><i /></button>
}

function Handoff({ session, onReady }: { session: GameSession; onReady: () => void }) {
  const player = session.players[session.currentTurnIndex]
  return (
    <section className="handoff screen-center">
      <div className="privacy-seal"><span>私</span></div>
      <p className="eyebrow">请把设备交给</p>
      <h1 style={{ color: player.color }}>{player.name}</h1>
      <p className="lead">其他人请移开视线。准备好后，由本人长按进入。</p>
      <HoldButton onComplete={onReady}>长按进入私密操作</HoldButton>
      <small className="privacy-note">松手或滑开可以取消</small>
    </section>
  )
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

function PrivateTurn({ session, onSubmit }: { session: GameSession; onSubmit: (turn: RoundTurn) => void }) {
  const player = session.players[session.currentTurnIndex]
  const item = session.itemDeck[session.roundIndex]
  const [bidUnits, setBidUnits] = useState(0)
  const [prediction, setPrediction] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const setBid = (value: number) => setBidUnits(Math.max(0, Math.min(player.balanceUnits, Math.round(value))))
  const predicted = session.players.find((candidate) => candidate.id === prediction)
  return (
    <section className="private-turn">
      <div className="private-heading"><div><p className="eyebrow">仅 {player.name} 可见</p><h1>你的回合</h1></div><BalanceReveal units={player.balanceUnits} /></div>
      <div className="turn-grid">
        <div className="bid-panel panel">
          <PrizeCard item={item} compact />
          <div className="reward-strip">{session.settings.rewardMultipliers.map((multiplier, index) => <span key={index}><small>{MEDALS[index]} 名</small><CoinValue units={Math.round(item.value * 2 * multiplier)} /></span>)}</div>
          <div className="bid-control">
            <div className="bid-readout"><small>我的秘密下注</small><strong><CoinValue units={bidUnits} /></strong></div>
            <input className="range range--bid" aria-label="秘密下注" type="range" min="0" max={player.balanceUnits} step="1" value={bidUnits} onChange={(event) => setBid(Number(event.target.value))} />
            <div className="bid-shortcuts"><button onClick={() => setBid(bidUnits - 1)}>−0.5</button><button onClick={() => setBid(bidUnits + 1)}>+0.5</button><button onClick={() => setBid(bidUnits + 2)}>+1</button><button onClick={() => setBid(bidUnits + 10)}>+5</button><button onClick={() => setBid(player.balanceUnits)}>全部</button></div>
          </div>
        </div>
        <div className="prediction-panel panel">
          <div className="panel-title"><div><p className="eyebrow">可选</p><h2>谁会拿第一？</h2></div><span>猜中 +{item.value * session.settings.correctPredictionMultiplier}<br />猜错 −{item.value * session.settings.wrongPredictionMultiplier}</span></div>
          <button className={cx('prediction-skip', prediction === null && 'is-selected')} onClick={() => setPrediction(null)}><span>稳一手</span><small>这轮不预测</small><i>{prediction === null ? '✓' : ''}</i></button>
          <div className="prediction-list">
            {session.players.filter((candidate) => candidate.id !== player.id).map((candidate) => <button key={candidate.id} className={cx(prediction === candidate.id && 'is-selected')} onClick={() => setPrediction(candidate.id)} style={{ '--player-color': candidate.color } as React.CSSProperties}><span>{candidate.name.slice(0, 1)}</span><strong>{candidate.name}</strong><i>{prediction === candidate.id ? '✓' : ''}</i></button>)}
          </div>
        </div>
      </div>
      <div className="private-submit"><p><span>下注 <strong>{unitsToCoins(bidUnits)}</strong></span><span>预测 <strong>{predicted?.name ?? '跳过'}</strong></span></p><button className="button button--primary button--large" onClick={() => setConfirming(true)}>确认我的选择</button></div>
      {confirming && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-sheet">
            <p className="eyebrow">最后确认</p><h2 id="confirm-title">提交后不能修改</h2>
            <div className="confirm-summary"><span>秘密下注 <strong><CoinValue units={bidUnits} /></strong></span><span>预测第一 <strong>{predicted?.name ?? '不预测'}</strong></span></div>
            <p>提交后请立刻把设备传给下一位，不要停留在此页。</p>
            <div><button className="button button--paper" onClick={() => setConfirming(false)}>再想想</button><button className="button button--primary" onClick={() => onSubmit({ playerId: player.id, bidUnits, predictedPlayerId: prediction })}>确定提交</button></div>
          </div>
        </div>
      )}
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

function DeltaLabel({ units }: { units: number }) {
  if (units === 0) return <span className="delta delta--zero">±0</span>
  return <span className={cx('delta', units > 0 ? 'delta--up' : 'delta--down')}><CoinValue units={units} signed /></span>
}

function RoundResults({ session, result, onNext }: { session: GameSession; result: RoundResult; onNext: () => void }) {
  const [skipMotion, setSkipMotion] = useState(session.settings.animationSpeed === 'reduced')
  const item = result.item
  const winner = session.players.find((player) => player.id === result.winnerId)
  return (
    <section className={cx('results-page', skipMotion && 'skip-motion')}>
      <div className="results-hero">
        <div><p className="eyebrow">第 {result.roundIndex + 1} 轮 · 结果</p><h1>{winner ? <><em>{winner.name}</em> 拿下 {item.name}</> : <>本轮物品<em>流拍</em></>}</h1><p>{winner ? `唯一出价胜出，获得 ${session.settings.rewardMultipliers[0]}V 奖励。` : '没有产生唯一出价者，物品无人获得。'}</p></div>
        <div className="result-prize"><span>{item.emoji}</span><small>价值 {item.value}</small></div>
      </div>
      <div className="result-metrics"><div><small>本轮总下注</small><CoinValue units={result.totalBidUnits} /></div><div><small>最低获奖线</small>{result.minWinningBidUnits === null ? <strong>—</strong> : <CoinValue units={result.minWinningBidUnits} />}</div><div><small>并列出局</small><strong>{result.tiedPlayerIds.length} 人</strong></div></div>
      <div className="result-columns">
        <article className="panel result-ranking"><div className="panel-title"><div><p className="eyebrow">下注排名</p><h2>本轮获奖</h2></div>{result.tiedPlayerIds.length > 0 && <span>{result.tiedPlayerIds.map((id) => playerName(session.players, id)).join('、')} 并列出局</span>}</div>
          {result.rankings.length === 0 ? <div className="empty-result">没有唯一出价，奖励全部落空。</div> : <ol>{result.rankings.map((entry, index) => <li key={entry.playerId} style={{ '--delay': `${index * 110}ms`, '--player-color': session.players.find((player) => player.id === entry.playerId)?.color } as React.CSSProperties}><span>{MEDALS[index]}</span><strong>{playerName(session.players, entry.playerId)}</strong>{session.settings.revealBids && <small>下注 {formatCoins(entry.bidUnits)}</small>}<CoinValue units={entry.rewardUnits} signed /></li>)}</ol>}
        </article>
        <article className="panel prediction-result"><div className="panel-title"><div><p className="eyebrow">眼光如何</p><h2>预测结算</h2></div>{result.winnerPaymentUnits > 0 && <span>第一名共支付 {formatCoins(result.winnerPaymentUnits)}</span>}</div>
          <div className="prediction-outcomes">{result.predictionOutcomes.map((outcome, index) => <div key={outcome.playerId} style={{ '--delay': `${index * 90 + 180}ms` } as React.CSSProperties}><strong>{playerName(session.players, outcome.playerId)}</strong><span>{outcome.status === 'skipped' ? '没有预测' : outcome.status === 'correct' ? `猜中 ${playerName(session.players, outcome.predictedPlayerId)}` : `猜错（选了 ${playerName(session.players, outcome.predictedPlayerId)}）`}</span><DeltaLabel units={outcome.deltaUnits} /></div>)}</div>
        </article>
      </div>
      <article className="panel public-ledger"><div className="panel-title"><div><p className="eyebrow">公开账本</p><h2>本轮收益变化</h2></div><span>不含秘密下注 · 不显示余额</span></div>
        <div className="ledger-table">{session.players.map((player) => { const delta = result.deltas.find((entry) => entry.playerId === player.id)!; const turn = result.turns.find((entry) => entry.playerId === player.id); return <div key={player.id}><span className="player-dot" style={{ background: player.color }} /><strong>{player.name}</strong>{session.settings.revealBids && <small>下注 {turn ? formatCoins(turn.bidUnits) : '—'}</small>}<small>排名 {delta.rewardUnits ? `+${formatCoins(delta.rewardUnits)}` : '±0'}</small><small>预测 {delta.predictionUnits > 0 ? '+' : ''}{formatCoins(delta.predictionUnits)}</small><DeltaLabel units={delta.publicDeltaUnits} /></div> })}</div>
      </article>
      <div className="result-actions"><button className="text-button" onClick={() => setSkipMotion(true)}>跳过动画</button><button className="button button--primary button--large" onClick={onNext}>{session.roundIndex + 1 >= session.settings.rounds ? '查看最终排行榜' : '进入下一轮'} <span>→</span></button></div>
    </section>
  )
}

function FinalResult({ session, onNewGame }: { session: GameSession; onNewGame: () => void }) {
  const standings = rankFinalPlayers(session.players)
  const topBalance = standings[0]?.player.balanceUnits ?? 0
  return (
    <section className="final-page">
      <div className="final-heading"><p className="eyebrow">全局结束</p><h1>最后的赢家，<br /><em>{standings.filter((standing) => standing.player.balanceUnits === topBalance).map((standing) => standing.player.name).join('、')}</em></h1><p>{session.settings.rounds} 轮竞价已经落定。现在，余额终于可以公开了。</p></div>
      <div className="podium-list">{standings.map((standing, index) => <article key={standing.player.id} className={cx(index === 0 && 'is-first')} style={{ '--delay': `${index * 100}ms`, '--player-color': standing.player.color } as React.CSSProperties}><span className="standing-place">{standing.place}</span><div className="standing-avatar">{standing.player.name.slice(0, 1)}</div><div className="standing-copy"><strong>{standing.player.name}</strong><small>{standing.player.items.length > 0 ? standing.player.items.map(({ item }) => `${item.emoji}${item.name}`).join(' · ') : '没有收藏品'}</small></div><div className="standing-balance"><CoinValue units={standing.player.balanceUnits} /><small>最终金币</small></div></article>)}</div>
      <div className="final-note">物品只记录荣耀，不参与最终排名。并列玩家共享同一名次。</div>
      <button className="button button--primary button--large" onClick={onNewGame}>再开一局</button>
    </section>
  )
}

function Game({ session, setSession, onExit, onNewGame }: { session: GameSession; setSession: (session: GameSession) => void; onExit: () => void; onNewGame: () => void }) {
  const patch = (changes: Partial<GameSession>) => setSession({ ...session, ...changes, updatedAt: new Date().toISOString() })
  const submitTurn = (turn: RoundTurn) => {
    const players = session.players.map((player) => player.id === turn.playerId ? { ...player, balanceUnits: player.balanceUnits - turn.bidUnits } : player)
    const turns = [...session.turns, turn]
    const isLast = session.currentTurnIndex >= session.players.length - 1
    patch({ players, turns, phase: isLast ? 'revealReady' : 'handoff', currentTurnIndex: isLast ? session.currentTurnIndex : session.currentTurnIndex + 1 })
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
    })
    patch({ players: settled.players, results: [...session.results, settled.result], phase: 'roundResult' })
  }
  const nextRound = () => {
    if (session.roundIndex + 1 >= session.settings.rounds) patch({ phase: 'finalResult' })
    else patch({ phase: 'roundIntro', roundIndex: session.roundIndex + 1, currentTurnIndex: 0, turns: [] })
  }
  const result = session.results[session.results.length - 1]
  return (
    <AppShell quiet={session.phase === 'handoff'}>
      {session.phase !== 'finalResult' && <GameHeader session={session} onExit={onExit} />}
      {session.phase === 'roundIntro' && <RoundIntro key={session.roundIndex} session={session} onContinue={() => patch({ phase: 'handoff' })} />}
      {session.phase === 'handoff' && <Handoff session={session} onReady={() => patch({ phase: 'privateTurn' })} />}
      {session.phase === 'privateTurn' && <PrivateTurn key={`${session.roundIndex}-${session.currentTurnIndex}`} session={session} onSubmit={submitTurn} />}
      {session.phase === 'revealReady' && <RevealReady session={session} onReveal={reveal} />}
      {session.phase === 'roundResult' && result && <RoundResults key={session.roundIndex} session={session} result={result} onNext={nextRound} />}
      {session.phase === 'finalResult' && <FinalResult session={session} onNewGame={onNewGame} />}
    </AppShell>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [saved, setSaved] = useState<GameSession | null>(() => loadSession())
  const [session, setSession] = useState<GameSession | null>(null)

  useEffect(() => {
    if (!session) return
    saveSession(session)
    setSaved(session)
  }, [session])

  const begin = (next: GameSession) => { setSession(next); setSaved(next); setScreen('game') }
  const quickStart = () => { const settings = createDefaultSettings(3); begin(createSession(['玩家 1', '玩家 2', '玩家 3'], settings)) }
  const removeSaved = () => { clearSession(); setSaved(null); setSession(null) }
  const newGame = () => { clearSession(); setSaved(null); setSession(null); setScreen('setup') }

  if (screen === 'rules') return <Rules onBack={() => setScreen('home')} />
  if (screen === 'setup') return <Setup onBack={() => setScreen('home')} onStart={begin} />
  if (screen === 'game' && session) return <Game session={session} setSession={setSession} onExit={() => setScreen('home')} onNewGame={newGame} />
  return <Home saved={saved} onQuickStart={quickStart} onSetup={() => setScreen('setup')} onContinue={() => { if (saved) { setSession(saved); setScreen('game') } }} onRules={() => setScreen('rules')} onDelete={removeSaved} />
}

