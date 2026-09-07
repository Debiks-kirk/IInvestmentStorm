import './lottery.css'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GameSession, LotteryDraw, Player } from '../game/types'
import { availableLotteryNumbers, LOTTERY_PRICE_UNITS, lotterySummary } from '../game/lottery'
import { formatCoins } from '../game/engine'

export function LotteryOpening({ session }: { session: GameSession }) {
  const state = session.lottery
  if (!state) return null
  return <div className="lottery-opening"><strong>轮初彩票奖池 {formatCoins(state.openingPoolUnits)} 金币</strong><span>基础 {formatCoins(state.baseUnits)} · 滚存 {formatCoins(state.openingPoolUnits - state.baseUnits)} · 每票 2 金币 · 号码 1–{session.players.length * 2}</span>{session.roundIndex === session.settings.rounds - 1 && <b>末轮 · 有票必开出中奖号</b>}</div>
}

export function LotteryPanel({ session, reservedUnits, onBuy }: { session: GameSession; reservedUnits: number; onBuy: (number: number | null, reservedUnits: number) => boolean }) {
  const [open, setOpen] = useState(false)
  const modal = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    const inert = root?.inert ?? false
    const overflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    modal.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const buttons = Array.from(modal.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!buttons.length) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus() }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (root) root.inert = inert; document.body.style.overflow = overflow; previousFocus?.focus() }
  }, [open])
  const lottery = session.lottery!
  const player = session.players[session.currentTurnIndex]
  const tickets = lottery.tickets.filter(ticket => ticket.playerId === player.id)
  const bought = tickets.some(ticket => ticket.roundIndex === session.roundIndex)
  const available = availableLotteryNumbers(lottery, session.players.length)
  const paid = Math.min(player.balanceUnits, LOTTERY_PRICE_UNITS)
  const shortage = Math.max(0, reservedUnits + paid - player.balanceUnits)
  const reason = bought ? '本轮已购票' : !available.length ? '号码已售罄，旧票继续有效' : shortage > 0 ? `购票后预算不足，请先减少 ${formatCoins(shortage)} 金币的下注、竞购或技能预留。` : ''
  return <><button type="button" className="lottery-entry" data-testid="lottery-entry" aria-haspopup="dialog" onClick={() => { setOpen(true); setError('') }}><span className="lottery-ticket-icon" aria-hidden="true">✦</span><strong>彩票</strong><span className="lottery-entry__status">{tickets.length ? `持有 ${tickets.map(ticket => String(ticket.number).padStart(2, '0')).join(' / ')}` : `奖池 ${formatCoins(lottery.openingPoolUnits)} 金币`}</span><b>{bought ? '查看' : '选号'} →</b></button>{open && createPortal(<div ref={modal} className="modal-backdrop lottery-purchase" role="dialog" aria-modal="true" aria-labelledby="lottery-purchase-title" data-testid="lottery-panel"><section className="lottery-purchase__sheet"><header><div><p className="eyebrow">第 {session.roundIndex + 1} 轮</p><h2 id="lottery-purchase-title">幸运彩票</h2></div><button type="button" className="icon-button" aria-label="关闭彩票" onClick={() => setOpen(false)}>×</button></header><div className="lottery-panel__body">
    <LotteryOpening session={session} />
    <p className="lottery-rule">命中独得奖池；未中时，号码与奖池一起保留。</p>
    <div className="lottery-number-grid" style={{ gridTemplateColumns: `repeat(${session.players.length === 3 ? 3 : 4}, minmax(0, 1fr))` }} role="group" aria-label="选择彩票号码">{Array.from({ length: session.players.length * 2 }, (_, i) => i + 1).map(number => {
      const own = tickets.some(ticket => ticket.number === number)
      const taken = !available.includes(number)
      return <button key={number} type="button" aria-label={`${number} 号${own ? ' 已持有' : taken ? ' 已被选' : ''}`} aria-pressed={selected === number} disabled={taken || bought} className={selected === number ? 'is-selected' : own ? 'is-owned' : ''} onClick={() => { setSelected(number); setError('') }}><strong>{String(number).padStart(2, '0')}</strong>{taken && <small>{own ? '已持有' : '已被选'}</small>}</button>
    })}</div>
    {!bought && available.length > 0 && <><button className={`button button--paper ${selected === null ? 'is-selected' : ''}`} aria-pressed={selected === null} onClick={() => setSelected(null)}>随机选号</button><p>你支付 {formatCoins(paid)} 金币，奖池固定 +2 金币{paid < 4 ? `；系统补足 ${formatCoins(4 - paid)} 金币` : ''}。确认后不可退改。</p></>}
    {reason && <p role="status" className="lottery-feedback">{reason}</p>}{error && <p role="alert" className="lottery-feedback">{error}</p>}
    {!bought && available.length > 0 && <button className="button button--primary" disabled={Boolean(reason)} onClick={() => { if (!onBuy(selected, reservedUnits)) setError('购票未完成，请检查号码、余额或操作时间。') }}>确认购票{selected !== null ? ` · ${String(selected).padStart(2, '0')} 号` : ' · 随机选号'}</button>}
    {tickets.length > 0 && <ul className="lottery-stubs">{tickets.map(ticket => <li key={ticket.number}><b>{String(ticket.number).padStart(2, '0')}</b><span>第 {ticket.roundIndex + 1} 轮购入<small>已支付 {formatCoins(ticket.paidUnits)} · 系统补贴 {formatCoins(ticket.subsidyUnits)}</small></span></li>)}</ul>}
  </div><footer><button className="button button--paper" onClick={() => setOpen(false)}>{bought ? '完成' : '返回下注'}</button></footer></section></div>, document.body)}</>
}

export function LotteryReveal({ draw, players, reduced, onClose }: { draw: LotteryDraw; players: Player[]; reduced: boolean; onClose: () => void }) {
  const [revealed, setRevealed] = useState(() => reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ball, setBall] = useState(1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    const overflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (root) root.inert = wasInert; document.body.style.overflow = overflow; focus?.focus() }
  }, [])
  useEffect(() => {
    if (revealed) return
    const spin = window.setInterval(() => setBall(value => value % (players.length * 2) + 1), 75)
    const stop = window.setTimeout(() => setRevealed(true), 1300)
    return () => { window.clearInterval(spin); window.clearTimeout(stop) }
  }, [revealed, players.length])
  const winner = players.find(player => player.id === draw.winnerId)
  return createPortal(<div ref={ref} className="modal-backdrop lottery-reveal" role="dialog" aria-modal="true" aria-labelledby="lottery-reveal-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!revealed) setRevealed(true); else onClose() }
    if (event.key === 'Tab') { event.preventDefault(); ref.current?.querySelector<HTMLButtonElement>('button')?.focus() }
  }}><section className="lottery-reveal__sheet"><p className="eyebrow">第 {draw.roundIndex + 1} 轮{draw.finalRound ? ' · 末轮保底' : ''}</p><h2 id="lottery-reveal-title">幸运开奖</h2><p className="lottery-reveal__pool">奖池 <strong>{formatCoins(draw.poolUnits)}</strong> 金币</p><div className="lottery-reveal__breakdown"><span>基础 {formatCoins(draw.baseUnits)}</span><span>滚存 {formatCoins(draw.carriedUnits)}</span><span>新票 {draw.newTicketCount} × 2</span></div><div className={`lottery-ball ${revealed ? 'is-revealed' : 'is-spinning'}`} aria-hidden="true">{revealed ? draw.number === null ? '—' : String(draw.number).padStart(2, '0') : String(ball).padStart(2, '0')}</div><div className="lottery-reveal__result" aria-live="polite">{revealed ? <><h3>{winner ? `${winner.name} 获得 ${formatCoins(draw.prizeUnits)} 金币` : draw.finalRound ? '无人参与，奖池未领取' : '无人中奖，奖池继续滚存'}</h3><p>{lotterySummary(draw, players)}</p></> : <h3>正在开奖…</h3>}</div><button className="button button--primary" onClick={() => revealed ? onClose() : setRevealed(true)}>{revealed ? '收起开奖结果' : '跳过开奖动画'}</button></section></div>, document.body)
}
