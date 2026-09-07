import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AvatarDrawing, AvatarStroke, MemberAvatar } from '../game/types'
import { DRAWING_BACKGROUND, DRAWING_SIZE, MAX_AVATAR_STROKES, MAX_STROKE_POINTS, normalizeAvatarDrawing } from '../game/avatars'
import { AVATAR_LIBRARY, AvatarIcon } from './AvatarIcon'
import './AvatarPicker.css'

const COLORS = ['#303533', '#a35b50', '#d5a447', '#557f74', '#687c9b']

function paint(canvas: HTMLCanvasElement, drawing: AvatarDrawing, current?: AvatarStroke) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(2, 0, 0, 2, 0, 0)
  ctx.fillStyle = drawing.background
  ctx.fillRect(0, 0, DRAWING_SIZE, DRAWING_SIZE)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of [...drawing.strokes, ...(current ? [current] : [])]) {
    ctx.strokeStyle = ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.beginPath()
    if (stroke.points.length === 1) {
      ctx.arc(stroke.points[0][0], stroke.points[0][1], stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      stroke.points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
      ctx.stroke()
    }
  }
}

export function AvatarDrawingEditor({ initial, onCancel, onSave }: { initial?: AvatarDrawing; onCancel: () => void; onSave: (drawing: AvatarDrawing) => void }) {
  const panel = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState<AvatarDrawing>(() => normalizeAvatarDrawing(initial) ?? { version: 1, background: DRAWING_BACKGROUND, strokes: [] })
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(6)
  const [message, setMessage] = useState('')
  const [active, setActive] = useState(false)
  const current = useRef<{ pointerId: number; stroke: AvatarStroke } | null>(null)
  const frame = useRef<number | null>(null)
  const undoClear = useRef<AvatarStroke[] | null>(null)
  useEffect(() => { if (canvas.current) paint(canvas.current, drawing) }, [drawing])
  useEffect(() => { panel.current?.focus({ preventScroll: true }); if (panel.current?.parentElement) panel.current.parentElement.scrollTop = 0 }, [])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const redraw = () => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (canvas.current) paint(canvas.current, drawing, current.current?.stroke)
    })
  }
  const point = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = (v: number, size: number) => Math.round(Math.max(0, Math.min(DRAWING_SIZE, v / size * DRAWING_SIZE)) * 10) / 10
    return [scale(event.clientX - rect.left, rect.width), scale(event.clientY - rect.top, rect.height)]
  }
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (current.current?.pointerId !== event.pointerId) return
    const stroke = current.current.stroke
    current.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    undoClear.current = null
    setDrawing(prev => ({ ...prev, strokes: [...prev.strokes, stroke] }))
    setActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <section ref={panel} tabIndex={-1} className="avatar-drawing-editor" aria-label="手绘头像画板">
    <header><div><h3>手绘头像</h3><label className="avatar-background-color">背景色<input type="color" aria-label="画板背景色" value={drawing.background} disabled={active} onChange={event => setDrawing(previous => ({ ...previous, background: event.target.value }))} /></label></div><span className="avatar-drawing-preview" aria-label="头像预览" style={{ backgroundColor: drawing.background }}>{drawing.strokes.length > 0 && <AvatarIcon avatar={{ shape: 0, accent: drawing.background, drawing }} />}</span></header>
    <div className="avatar-drawing-sheet"><canvas ref={canvas} width={512} height={512} aria-label="绘制头像" onPointerDown={event => {
      if (current.current || event.button !== 0) return
      if (drawing.strokes.length >= MAX_AVATAR_STROKES) { setMessage('画板已满，可撤销后继续。'); return }
      event.preventDefault()
      current.current = { pointerId: event.pointerId, stroke: { color, width, points: [point(event)] } }
      event.currentTarget.setPointerCapture(event.pointerId)
      setActive(true); setMessage(''); redraw()
    }} onPointerMove={event => {
      if (current.current?.pointerId !== event.pointerId) return
      const stroke = current.current.stroke
      const next = point(event), last = stroke.points[stroke.points.length - 1]
      if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 0.6) return
      if (stroke.points.length >= MAX_STROKE_POINTS) { setMessage('这一笔已画满，抬手后可继续。'); finish(event); return }
      stroke.points.push(next); redraw()
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} /></div>
    <div className="avatar-drawing-colors" role="group" aria-label="画笔颜色">{COLORS.map((value, index) => <button key={value} type="button" aria-label={`画笔颜色：${['墨黑', '砖红', '金黄', '青绿', '蓝色', '粉紫', '米白'][index]}`} aria-pressed={color === value} style={{ '--swatch': value } as React.CSSProperties} onClick={() => setColor(value)} />)}<label className="avatar-custom-color" title="自选颜色"><input type="color" aria-label="自选画笔颜色" value={color} onChange={e => setColor(e.target.value)} />＋</label></div>
    <div className="avatar-drawing-tools"><label>粗细<input aria-label="画笔粗细" type="range" min={2} max={20} step={1} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><button type="button" disabled={active || (!drawing.strokes.length && !undoClear.current)} onClick={() => {
      const cleared = undoClear.current
      setDrawing(prev => ({ ...prev, strokes: cleared ?? prev.strokes.slice(0, -1) })); undoClear.current = null; setMessage('')
    }}>撤销</button><button type="button" disabled={active || !drawing.strokes.length} onClick={() => {
      undoClear.current = drawing.strokes; setDrawing(prev => ({ ...prev, strokes: [] })); setMessage('')
    }}>清空</button></div>
    {message && <p className="avatar-drawing-message" role="status">{message}</p>}
    <div className="avatar-drawing-actions"><button className="button button--paper" type="button" onClick={onCancel}>取消</button><button className="button button--primary" type="button" disabled={active || !drawing.strokes.length} onClick={() => { const result = normalizeAvatarDrawing(drawing); if (result) onSave(result) }}>保存头像</button></div>
  </section>
}

export function AvatarPicker({ avatar, onChange, onDraw }: { avatar: MemberAvatar; onChange: (avatar: MemberAvatar) => void; onDraw: () => void }) {
  return <div className="member-avatar-options"><div className="member-avatar-options__heading"><strong>选择头像</strong><button type="button" className="button button--paper" onClick={onDraw}><span aria-hidden="true">✎</span> {avatar.drawing ? '编辑手绘头像' : '手绘头像'}</button></div>
    {avatar.drawing && <div className="member-drawn-avatar"><span><AvatarIcon avatar={avatar} /></span><strong>正在使用手绘头像</strong></div>}
    <fieldset className="member-avatar-picker"><legend className="sr-only">预设头像</legend>{AVATAR_LIBRARY.map(([label], shape) => <button key={label} type="button" title={label} aria-label={`头像：${label}`} aria-pressed={!avatar.drawing && avatar.shape === shape} onClick={() => onChange({ shape, accent: avatar.accent })}><AvatarIcon avatar={{ shape, accent: avatar.accent }} /></button>)}</fieldset>
  </div>
}
