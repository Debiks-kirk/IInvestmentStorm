import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Escape the sticky settings panel's stacking context and isolate background input. */
export function SetupRulesModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    const previousInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    const controls = () => Array.from(layerRef.current?.querySelectorAll<HTMLElement>(
      '.advanced-settings button:not(:disabled), .advanced-settings input:not(:disabled), .advanced-settings select:not(:disabled), .advanced-settings [tabindex="0"]',
    ) ?? []).filter((element) => element.getClientRects().length > 0)
    controls()[0]?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0]; const last = items[items.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<div className="setup-rules-layer" ref={layerRef}>{children}</div>, document.body)
}
