import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Drop = { seat: number; index: number }
type Drag = { source: number; id: string; name: string; x: number; y: number; drop: Drop | null }

export function useRelayDrag(onDrop: (source: number, id: string, destination: number, index: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const active = useRef<Drag | null>(null)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; pointerId: number; x: number; y: number } | null>(null)
  const commit = useRef(onDrop)
  commit.current = onDrop
  useEffect(() => {
    let frame = 0
    const hitTest = (x: number, y: number): Drop | null => {
      const seat = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-relay-seat]')
      if (!seat) return null
      const rows = [...seat.querySelectorAll<HTMLElement>('[data-relay-operator]')]
      const before = rows.findIndex((row) => y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2)
      return { seat: Number(seat.dataset.relaySeat), index: before < 0 ? rows.length : before }
    }
    const update = (x: number, y: number) => {
      if (!active.current) return
      active.current = { ...active.current, x, y, drop: hitTest(x, y) }
      setDrag(active.current)
    }
    const scroll = () => {
      if (!active.current) { frame = 0; return }
      const { x, y } = active.current
      const edge = 85
      const amount = y < edge ? -Math.ceil((edge - y) / 8) : y > window.innerHeight - edge ? Math.ceil((y - window.innerHeight + edge) / 8) : 0
      if (amount) { window.scrollBy(0, amount); update(x, y) }
      frame = requestAnimationFrame(scroll)
    }
    const cancel = () => {
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = null
      active.current = null
      setDrag(null)
      cancelAnimationFrame(frame)
      frame = 0
    }
    const move = (event: PointerEvent) => {
      if (!pending.current || event.pointerId !== pending.current.pointerId) return
      if (!active.current) {
        if (Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) > 9) cancel()
        return
      }
      event.preventDefault()
      update(event.clientX, event.clientY)
      if (!frame) frame = requestAnimationFrame(scroll)
    }
    const finish = (event: PointerEvent) => {
      if (!pending.current || event.pointerId !== pending.current.pointerId) return
      const current = active.current
      const drop = current ? hitTest(event.clientX, event.clientY) : null
      cancel()
      if (current && drop) commit.current(current.source, current.id, drop.seat, drop.index)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  const start = (event: ReactPointerEvent<HTMLButtonElement>, source: number, id: string, name: string) => {
    if (event.button !== 0 || !event.isPrimary || pending.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const { clientX: x, clientY: y, pointerId } = event
    pending.current = { pointerId, x, y, timer: setTimeout(() => {
      active.current = { source, id, name, x, y, drop: null }
      setDrag(active.current)
    }, 320) }
  }
  return { drag, start }
}
