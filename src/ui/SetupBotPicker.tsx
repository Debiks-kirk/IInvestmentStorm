import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BOT_PROFILES, botProfile } from '../game/bots'
import type { CustomBotProfile, SeatConfig } from '../game/types'

type BotController = Extract<SeatConfig['controller'], { kind: 'bot' }>
export function SetupBotPicker({ controller, profiles, disabledKeys = [], onChange }: { controller: BotController; profiles: CustomBotProfile[]; disabledKeys?: string[]; onChange: (controller: BotController) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const currentKey = controller.profileId === 'custom' ? `custom:${controller.customProfile?.id}` : controller.profileId
  const name = controller.profileId === 'custom' ? controller.customProfile?.name ?? '自定义 Bot' : botProfile(controller.profileId).name
  const options: { key: string; name: string; summary: string; controller: BotController }[] = [
    ...BOT_PROFILES.map((profile) => ({ key: profile.id as string, name: profile.name, summary: profile.summary, controller: { ...controller, profileId: profile.id, customProfile: undefined } })),
    ...profiles.map((profile) => ({ key: `custom:${profile.id}`, name: profile.name, summary: '自定义策略', controller: { ...controller, profileId: 'custom' as const, customProfile: { ...profile, identityPriority: [...profile.identityPriority] } } })),
  ]
  // A saved custom template remains selectable even if its local library entry was deleted.
  if (!options.some((option) => option.key === currentKey) && controller.customProfile) options.push({ key: currentKey, name, summary: '已保存的自定义策略', controller })
  useEffect(() => {
    if (!open) return
    const root = document.getElementById('root')
    const previousInert = root?.inert ?? false
    if (root) root.inert = true
    sheet.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const controls = [...sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []]
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (root) root.inert = previousInert; trigger.current?.focus() }
  }, [open])
  const matching = options.filter((option) => option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <>
    <button ref={trigger} type="button" className="setup-bot-picker" aria-label={`${name} Bot 性格`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSearch(''); setOpen(true) }}><span className="setup-bot-avatar" aria-hidden="true">{name.slice(0, 1)}</span><strong>{name}</strong><span className="setup-bot-chevron" aria-hidden="true">⌄</span></button>
    {open && createPortal(<div className="modal-backdrop player-registry-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section ref={sheet} className="player-registry-sheet setup-bot-sheet" role="dialog" aria-modal="true" aria-label="选择 Bot"><header><h2>选择 Bot</h2><button className="icon-button" aria-label="关闭 Bot 选择" onClick={() => setOpen(false)}>×</button></header><input className="player-registry-search" aria-label="搜索 Bot" placeholder="搜索 Bot" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="setup-bot-options" role="listbox" aria-label="Bot 列表">{matching.map((option) => <button type="button" key={option.key} role="option" disabled={disabledKeys.includes(option.key)} aria-selected={currentKey === option.key} onClick={() => { onChange(option.controller); setOpen(false) }}><span className="setup-bot-avatar" aria-hidden="true">{option.name.slice(0, 1)}</span><span><strong>{option.name}</strong><small>{option.summary}</small></span><em>{disabledKeys.includes(option.key) ? '已入局' : currentKey === option.key ? '✓' : ''}</em></button>)}{!matching.length && <p>没有找到 Bot</p>}</div></section></div>, document.body)}
  </>
}
