import { createPortal } from 'react-dom'
import './progression.css'
import { AvatarIcon } from './AvatarIcon'
import { AvatarDrawingEditor, AvatarPicker } from './AvatarPicker'
import { useMemo, useRef, useState } from 'react'
import { achievementProgress, careerRatings } from '../game/progression'
import { careerRosterStats, createCareerDashboard, type MatchCareerRecord } from '../game/career'
import { formatCoins } from '../game/engine'
import { getIdentityDefinition } from '../game/identities'
import { defaultCustomBotProfile, memberNameKey } from '../game/members'
import type { BotDifficulty, CustomBotProfile, IdentityId, MemberProfile } from '../game/types'

type HallFilter = 'all' | 'human' | 'bot'
type ProfileTab = 'overview' | 'matches' | 'data' | 'relationships' | 'achievements'
const BOT_FIELDS: Array<{ key: Exclude<keyof CustomBotProfile, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'identityPriority'>; label: string }> = [
  { key: 'risk', label: '风险' }, { key: 'bankroll', label: '留钱' }, { key: 'collection', label: '收藏' },
  { key: 'market', label: '市场' }, { key: 'cards', label: '道具' }, { key: 'identity', label: '身份' },
  { key: 'interference', label: '干扰' }, { key: 'prediction', label: '预测' }, { key: 'comeback', label: '逆风' },
]

export function MemberAvatar({ member, small = false }: { member: MemberProfile; small?: boolean }) {
  return <span className={`member-avatar${small ? ' member-avatar--small' : ''}`} style={{ '--member-accent': member.avatar.accent } as React.CSSProperties} aria-hidden="true"><AvatarIcon avatar={member.avatar} /></span>
}

function winRate(champions: number, matches: number) { return matches ? `${Math.round(champions / matches * 100)}%` : '—' }
function modeText(mode: 'standard' | 'relay') { return mode === 'relay' ? '接力' : '标准' }
function dateText(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) }

export function MemberHall({
  members, records, notice, onBack, onChangeMember, onCreateHuman, onCreateBot, onArchiveMember, onRestoreMember,
  onExport, onImport, onOpenMatch, onRemoveMatch, onCloneBot,
}: {
  members: MemberProfile[]
  records: MatchCareerRecord[]
  notice?: string
  onBack: () => void
  onChangeMember: (member: MemberProfile) => void
  onCreateHuman: (name: string) => string | null
  onCreateBot: (name: string) => string | null
  onArchiveMember: (memberId: string) => void
  onRestoreMember: (memberId: string) => void
  onExport: (includeReplays: boolean) => Promise<void>
  onImport: (raw: string, renameConflicts: boolean) => Promise<string>
  onOpenMatch: (sessionId: string) => Promise<void>
  onRemoveMatch: (sessionId: string) => Promise<void>
  onCloneBot: (member: MemberProfile) => void
}) {
  const [showRanking, setShowRanking] = useState(false)
  const ratings = useMemo(() => careerRatings(records), [records])
  const [filter, setFilter] = useState<HallFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createKind, setCreateKind] = useState<'human' | 'bot' | null>(null)
  const [createName, setCreateName] = useState('')
  const [message, setMessage] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [allowRenameConflicts, setAllowRenameConflicts] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeReplays, setIncludeReplays] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => members.filter((member) => !member.archived && (filter === 'all' || member.kind === filter) && member.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [members, filter, query])
  const [page, setPage] = useState(0)
  const pageSize = 60
  const ranked = useMemo(() => [...visible].filter(m=>ratings.has(m.id)).sort((a,b)=>ratings.get(b.id)!.rating-ratings.get(a.id)!.rating || a.name.localeCompare(b.name)), [visible,ratings])
  const displayed = showRanking ? ranked : visible
  const pages = Math.max(1, Math.ceil(displayed.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const pagedMembers = displayed.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const selected = members.find((member) => member.id === selectedId) ?? null
  const create = () => {
    if (!createKind) return
    const error = createKind === 'human' ? onCreateHuman(createName) : onCreateBot(createName)
    if (error) { setMessage(error); return }
    setCreateName(''); setCreateKind(null); setMessage('已加入名册')
  }
  const readImport = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try { setMessage(await onImport(await file.text(), allowRenameConflicts)); setImportOpen(false) } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败，请检查备份文件') } finally { setImporting(false); if (importRef.current) importRef.current.value = '' }
  }
  if (selected) return <MemberProfilePage member={selected} members={members} records={records} onBack={() => setSelectedId(null)} onChange={onChangeMember} onArchive={() => onArchiveMember(selected.id)} onRestore={() => onRestoreMember(selected.id)} onOpenMatch={onOpenMatch} onRemoveMatch={onRemoveMatch} onCloneBot={onCloneBot} />
  return <section className="member-hall">
    <header className="member-hall__header">
      <button className="icon-button" onClick={onBack} aria-label="返回主页">←</button>
      <div><p className="eyebrow">本机名册</p><h1>玩家大厅</h1></div>
      <div className="member-hall__tools"><button className="icon-button" title="导出成员档案" aria-label="导出成员档案" onClick={() => setExportOpen(true)}>⇩</button><button className="icon-button" title="导入成员档案" aria-label="导入成员档案" onClick={() => setImportOpen(true)}>⇧</button></div>
    </header>
    <nav className="career-switch" aria-label="大厅视图"><button aria-pressed={!showRanking} onClick={()=>{setShowRanking(false);setPage(0)}}>名册</button><button aria-pressed={showRanking} onClick={()=>{setShowRanking(true);setPage(0)}}>等级榜</button></nav>
    {showRanking && <details className="rating-rules"><summary>等级分规则</summary><p>首局以 1200 分为基准；前 ⌈人数÷2⌉ 名进入加分段，其余进入扣分段，允许 0 分。3／6／10 人局参考分为 6／13／20，其他人数线性插值。加分随总资产高于全场均值的比例按平方根增长，领先越多加分越多，增速逐渐放缓，可超过参考分。扣分仍在低于均值 50% 时封顶。最终取整数。并列平均占用名次的分段，全员并列不加不扣。旧战绩资产不全时取分段中点。标准与接力均计入，接力须实际操作过回合。未参赛不排名；移除战绩会撤回该局分数。</p></details>}
    <div className="member-hall__bar">
      <label className="member-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="搜索成员" aria-label="搜索成员" /></label>
      <div className="member-filter" role="group" aria-label="筛选成员">
        {([['all', '全部'], ['human', '真人'], ['bot', 'Bot']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => { setFilter(value); setPage(0) }}>{label}</button>)}
      </div>
      <div className="member-hall__actions"><button className="button button--paper" onClick={() => { setCreateKind('human'); setMessage('') }}>注册玩家</button><button className="button button--primary" onClick={() => { setCreateKind('bot'); setMessage('') }}>创建 Bot</button></div>
    </div>
    {(message || notice) && <p className="member-hall__message" role="status">{message || notice}</p>}
    <div className="member-grid">
      {pagedMembers.map((member) => {
        const stats = careerRosterStats(member.id, records)
        const strategy = member.kind === 'bot' ? member.bot?.customProfile?.name ?? member.bot?.profileId ?? '自适应' : null
        return <button className={`member-card${showRanking ? ' member-card--ranked' : ''}`} key={member.id} onClick={() => setSelectedId(member.id)} style={{ '--member-accent': member.avatar.accent } as React.CSSProperties}>
          {showRanking && <b className="career-rank">{1 + ranked.filter(entry=>ratings.get(entry.id)!.rating > ratings.get(member.id)!.rating).length}</b>}
          <MemberAvatar member={member} />
          <span className="member-card__copy"><strong>{member.name}</strong><small>{member.kind === 'bot' ? `Bot · ${strategy}` : '真人玩家'}</small></span>
          {stats.matches ? <span className="member-card__record"><b>{showRanking ? ratings.get(member.id)?.rating : winRate(stats.champions, stats.matches)}</b><small>{stats.matches} 局{!showRanking && ratings.has(member.id) ? ` · ${ratings.get(member.id)!.rating} 分` : ''}</small></span> : <span className="member-card__record member-card__record--empty">尚未出战</span>}
        </button>
      })}
      {!displayed.length && <div className="member-empty"><strong>没有匹配的成员</strong><span>可以注册玩家或创建一位 Bot。</span></div>}
    </div>
    {displayed.length > pageSize && <nav className="member-pagination" aria-label="成员分页"><button disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 >= pages} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}>下一页</button></nav>}
    {createKind && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={createKind === 'human' ? '注册玩家' : '创建 Bot'}><section className="member-mini-modal"><button className="icon-button" aria-label="关闭" onClick={() => setCreateKind(null)}>×</button><p className="eyebrow">{createKind === 'human' ? '真人玩家' : '独立 Bot'}</p><h2>{createKind === 'human' ? '注册玩家' : '创建 Bot'}</h2><input autoFocus maxLength={20} value={createName} onChange={(event) => setCreateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') create() }} placeholder="输入名称" /><p>名称在本机唯一，可在个人页修改。</p><button className="button button--primary" onClick={create}>{createKind === 'human' ? '注册' : '创建'}</button></section></div>}
    {exportOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="导出成员档案"><section className="member-mini-modal"><button className="icon-button" aria-label="关闭" onClick={() => setExportOpen(false)}>×</button><p className="eyebrow">成员档案备份</p><h2>导出档案</h2><p>成员、战绩、外观与 Bot 记忆都会包含在备份中。</p><label className="member-replay-switch"><input type="checkbox" checked={includeReplays} onChange={(event) => setIncludeReplays(event.target.checked)} />同时包含完整复盘</label><button className="button button--primary" onClick={() => { void onExport(includeReplays); setExportOpen(false) }}>下载备份</button></section></div>}
    {importOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入成员档案"><section className="member-mini-modal"><button className="icon-button" aria-label="关闭" onClick={() => setImportOpen(false)}>×</button><p className="eyebrow">成员档案备份</p><h2>导入档案</h2><p>相同 ID 的资料保留本机版本。遇到同名但不同 ID 时，需明确保留独立副本。</p><label className="member-replay-switch"><input type="checkbox" checked={allowRenameConflicts} onChange={(event) => setAllowRenameConflicts(event.target.checked)} />同名成员保留为独立副本</label><input ref={importRef} type="file" accept="application/json" onChange={(event) => void readImport(event.target.files?.[0])} /><button className="button button--paper" disabled={importing} onClick={() => importRef.current?.click()}>{importing ? '导入中…' : '选择备份文件'}</button></section></div>}
  </section>
}

function MemberProfilePage({ member, members, records, onBack, onChange, onArchive, onRestore, onOpenMatch, onRemoveMatch, onCloneBot }: {
  member: MemberProfile
  members: MemberProfile[]
  records: MatchCareerRecord[]
  onBack: () => void
  onChange: (member: MemberProfile) => void
  onArchive: () => void
  onRestore: () => void
  onOpenMatch: (sessionId: string) => Promise<void>
  onRemoveMatch: (sessionId: string) => Promise<void>
  onCloneBot: (member: MemberProfile) => void
}) {
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [editing, setEditing] = useState(false)
  const [drawingOpen, setDrawingOpen] = useState(false)
  const closeDrawing = () => {
    setDrawingOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.member-avatar-options__heading button')?.focus())
  }
  const [name, setName] = useState(member.name)
  const [mode, setMode] = useState<'all' | 'standard' | 'relay'>('all')
  const [removing, setRemoving] = useState<string | null>(null)
  const dashboard = useMemo(() => createCareerDashboard(member, records), [member, records])
  const rating = useMemo(()=>careerRatings(records).get(member.id),[records,member.id])
  const achievements = useMemo(()=>achievementProgress(dashboard.summaries),[dashboard.summaries])
  const [achievementCategory,setAchievementCategory] = useState('全部')
  const summaries = dashboard.summaries.filter((summary) => mode === 'all' || summary.mode === mode)
  const featuredAchievements = (() => {
    const pinned = member.featuredAchievementIds ?? []
    const selected = dashboard.achievements.filter((achievement) => pinned.includes(achievement.id))
    return (selected.length ? selected : dashboard.achievements).slice(0, 3)
  })()
  const champions = summaries.filter((summary) => summary.champion).length
  const topIdentity = [...summaries].filter((summary) => summary.identityId).sort((a, b) => Number(Boolean(b.identityId)) - Number(Boolean(a.identityId)))[0]?.identityId
  const commonCards = dashboard.summaries.reduce((sum, current) => sum + current.cardUses, 0)
  const update = (patch: Partial<MemberProfile>) => onChange({ ...member, ...patch, updatedAt: new Date().toISOString() })
  const saveName = () => {
    const normalized = name.trim().normalize('NFC').slice(0, 20)
    if (!normalized) return
    if (members.some((entry) => entry.id !== member.id && memberNameKey(entry.name) === memberNameKey(normalized))) return
    update({ name: normalized }); setEditing(false)
  }
  const updateBot = (patch: Partial<NonNullable<MemberProfile['bot']>>) => update({ bot: { ...(member.bot ?? { profileId: 'adaptive', difficulty: 'standard' as BotDifficulty, memoryEnabled: true }), ...patch } })
  const updateStrategy = (patch: Partial<CustomBotProfile>) => {
    const current = member.bot?.customProfile ?? defaultCustomBotProfile(`${member.name} 策略`)
    updateBot({ profileId: 'custom', customProfile: { ...current, ...patch, updatedAt: new Date().toISOString(), identityPriority: patch.identityPriority ? [...patch.identityPriority] : [...current.identityPriority] } })
  }
  const movePriority = (identityId: IdentityId, direction: -1 | 1) => {
    const current = member.bot?.customProfile
    if (!current) return
    const index = current.identityPriority.indexOf(identityId); const target = index + direction
    if (target < 0 || target >= current.identityPriority.length) return
    const identityPriority = [...current.identityPriority]; [identityPriority[index], identityPriority[target]] = [identityPriority[target], identityPriority[index]]
    updateStrategy({ identityPriority })
  }
  return <section className="member-profile">
    <header className="member-profile__top" style={{ '--member-accent': member.avatar.accent } as React.CSSProperties}>
      <button className="icon-button" onClick={onBack} aria-label="返回玩家大厅">←</button>
      <MemberAvatar member={member} />
      <div><p className="eyebrow">{member.kind === 'bot' ? '独立 Bot' : '真人玩家'}</p><h1>{member.name}</h1><small>{member.archived ? '已移出名册' : member.kind === 'bot' ? (member.bot?.customProfile?.name ?? member.bot?.profileId ?? '自适应') : '本机成员'}</small></div>
      <button className="icon-button" title="编辑资料" aria-label="编辑资料" onClick={() => { setName(member.name); setEditing(true) }}>✎</button>
    </header>
    <div className="member-profile__featured">
      <span><small>等级分</small><b>{rating?.rating ?? '—'}</b></span>
      <span><small>对局</small><b>{summaries.length || '—'}</b></span><span><small>冠军率</small><b>{winRate(champions, summaries.length)}</b></span><span><small>场均净收益</small><b>{summaries.length ? formatCoins(Math.round(summaries.reduce((sum, value) => sum + value.netUnits, 0) / summaries.length)) : '—'}</b></span><span><small>平均击败</small><b>{summaries.length ? `${Math.round(summaries.reduce((sum, value) => sum + value.defeatRatio, 0) / summaries.length * 100)}%` : '—'}</b></span>
    </div>
    <nav className="member-profile__tabs" aria-label="个人主页分页">{([['overview', '概览'], ['matches', '战绩'], ['data', '数据'], ['relationships', '关系'], ['achievements', '成就']] as const).map(([value, label]) => <button key={value} className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab === 'achievements' && <section className="member-profile__body"><header className="achievement-heading"><h2>成就库</h2><span>{achievements.filter(a=>a.unlocked).length} / {achievements.length}</span></header><div className="career-switch" role="group" aria-label="成就分类">{['全部',...new Set(achievements.map(a=>a.category))].map(category=><button key={category} aria-pressed={achievementCategory===category} onClick={()=>setAchievementCategory(category)}>{category}</button>)}</div><div className="achievement-library">{achievements.filter(a=>achievementCategory==='全部'||a.category===achievementCategory).map(a=><article key={a.id} className={a.unlocked?'is-unlocked':''}><span aria-hidden="true">{a.unlocked?'✦':'◇'}</span><div><strong>{a.name}</strong><p>{a.detail}</p><progress max={a.target} value={a.progress} aria-label={a.name}/><small>{a.unlocked ? `已解锁 · ${a.modes.map(modeText).join(' / ')}` : `${a.progress} / ${a.target}`}</small></div></article>)}</div></section>}
    {tab === 'overview' && <div className="member-profile__body member-overview">
      <section className="member-profile-card"><header><h2>常用</h2></header><div className="member-favourites"><article><small>身份</small><strong>{topIdentity ? getIdentityDefinition(topIdentity).name : '尚无记录'}</strong></article><article><small>道具</small><strong>{commonCards ? `${commonCards} 次使用` : '尚无记录'}</strong></article><article><small>收藏倾向</small><strong>{summaries.find((summary) => summary.favouriteCategory)?.favouriteCategory ?? '尚无记录'}</strong></article></div></section>
      <section className="member-profile-card"><header><h2>精选成就</h2><button className="text-button" onClick={()=>setTab('achievements')}>成就库</button></header><div className="member-achievements">{featuredAchievements.map((achievement) => <article key={achievement.id}><span>✦</span><div><strong>{achievement.name}</strong><small>{achievement.detail}</small></div></article>)}{!dashboard.achievements.length && <p>完成对局后会在这里留下实绩。</p>}</div></section>
      <section className="member-profile-card"><header><h2>最近对局</h2><button className="text-button" onClick={() => setTab('matches')}>全部</button></header><div className="member-recent-matches">{summaries.slice(0, 5).map((summary) => <button key={`${summary.sessionId}-${summary.memberId}-${summary.role}`} onClick={() => void onOpenMatch(summary.sessionId)}><span>{summary.finalPlace} 名</span><strong>{modeText(summary.mode)} · {summary.playerCount} 人</strong><small>{summary.identityId ? getIdentityDefinition(summary.identityId).name : '无身份'} · {formatCoins(summary.netUnits)}</small></button>)}{!summaries.length && <p>尚未出战。</p>}</div></section>
    </div>}
    {tab === 'matches' && <div className="member-profile__body"><div className="member-match-filters">{([['all', '全部'], ['standard', '标准'], ['relay', '接力']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'is-active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div><div className="member-match-list">{summaries.map((summary) => <article key={`${summary.sessionId}-${summary.memberId}-${summary.role}`}><span>{summary.finalPlace}</span><div><strong>{modeText(summary.mode)} · {summary.playerCount} 人</strong><small>{summary.nameAtMatch} · {summary.identityId ? getIdentityDefinition(summary.identityId).name : '无身份'} · {dateText(records.find((record) => record.sessionId === summary.sessionId)?.completedAt ?? '')}</small></div><b>{formatCoins(summary.netUnits)}<small>等级分 {(rating?.changes[summary.sessionId] ?? 0) >= 0 ? '+' : ''}{rating?.changes[summary.sessionId] ?? '—'}</small></b><button className="text-button" onClick={() => void onOpenMatch(summary.sessionId)}>复盘</button>{removing === summary.sessionId ? <button className="text-button danger" onClick={() => { void onRemoveMatch(summary.sessionId); setRemoving(null) }}>确认移除</button> : <button className="text-button danger" onClick={() => setRemoving(summary.sessionId)}>移除</button>}</article>)}{!summaries.length && <p className="member-empty">尚无符合筛选的对局。</p>}</div></div>}
    {tab === 'data' && <div className="member-profile__body member-data-grid"><section className="member-profile-card"><h2>资金</h2><dl><div><dt>平均下注</dt><dd>{summaries.length ? formatCoins(Math.round(summaries.reduce((sum, value) => sum + value.totalBidUnits, 0) / summaries.length)) : '—'}</dd></div><div><dt>对外投资</dt><dd>{formatCoins(summaries.reduce((sum, value) => sum + value.investmentUnits, 0))}</dd></div><div><dt>预测净收益</dt><dd>{formatCoins(summaries.reduce((sum, value) => sum + value.predictionNetUnits, 0))}</dd></div></dl></section><section className="member-profile-card"><h2>市场</h2><dl><div><dt>道具成交</dt><dd>{summaries.reduce((sum, value) => sum + value.cardAuctionDeals, 0)}</dd></div><div><dt>拍品成交</dt><dd>{summaries.reduce((sum, value) => sum + value.assetAuctionDeals, 0)}</dd></div><div><dt>拍品售出</dt><dd>{summaries.reduce((sum, value) => sum + value.assetSales, 0)}</dd></div></dl></section><section className="member-profile-card"><h2>风险</h2><dl><div><dt>零余额回合</dt><dd>{summaries.reduce((sum, value) => sum + value.zeroBalanceRounds, 0)}</dd></div><div><dt>观望惩罚</dt><dd>{summaries.reduce((sum, value) => sum + value.passivityPenaltyCount, 0)} 次</dd></div><div><dt>道具使用</dt><dd>{commonCards}</dd></div></dl></section><section className="member-profile-card"><h2>身份专项</h2><dl><div><dt>技能发动</dt><dd>{summaries.reduce((sum, value) => sum + value.identityUses, 0)}</dd></div><div><dt>预测命中</dt><dd>{summaries.reduce((sum, value) => sum + value.predictionHits, 0)} / {summaries.reduce((sum, value) => sum + value.predictionAttempts, 0)}</dd></div><div><dt>拍品获得</dt><dd>{summaries.reduce((sum, value) => sum + value.itemsWon, 0)}</dd></div></dl></section></div>}
    {tab === 'relationships' && <div className="member-profile__body"><div className="member-relation-list">{dashboard.relationships.map((relation) => { const opponent = members.find((entry) => entry.id === relation.memberId); return <article key={relation.memberId}><MemberAvatar member={opponent ?? member} small /><div><strong>{opponent?.name ?? '已归档成员'}</strong><small>共同 {relation.sharedMatches} 局 · 胜 {relation.wins} / 负 {relation.losses}</small></div><span><small>交锋指数</small><b>{relation.rivalry}</b></span><span><small>定向影响</small><b>{relation.attackSuccesses} / {relation.attackAttempts}</b></span></article> })}{!dashboard.relationships.length && <p className="member-empty">尚无足够的共同对局记录。</p>}</div></div>}
    {editing && createPortal(<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="编辑成员"><section className={`member-mini-modal member-edit-modal${drawingOpen ? ' member-edit-modal--drawing' : ''}`}>{drawingOpen ? <AvatarDrawingEditor initial={member.avatar.drawing} onCancel={closeDrawing} onSave={drawing => { update({ avatar: { ...member.avatar, drawing } }); closeDrawing() }} /> : <><button className="icon-button" aria-label="关闭" onClick={() => setEditing(false)}>×</button><p className="eyebrow">个人资料</p><h2>编辑 {member.name}</h2><label>名称<input maxLength={20} value={name} onChange={(event) => setName(event.target.value)} /></label><label>主题色<input type="color" value={member.avatar.accent} onChange={(event) => update({ avatar: { ...member.avatar, accent: event.target.value } })} /></label><AvatarPicker avatar={member.avatar} onChange={avatar => update({ avatar })} onDraw={() => setDrawingOpen(true)} />{dashboard.achievements.length > 0 && <fieldset className="member-achievement-picker"><legend>首页成就（最多 3 项）</legend>{dashboard.achievements.map((achievement) => { const selected = (member.featuredAchievementIds ?? []).includes(achievement.id); const pinned = member.featuredAchievementIds ?? []; return <label key={achievement.id}><input type="checkbox" checked={selected} disabled={!selected && pinned.length >= 3} onChange={(event) => update({ featuredAchievementIds: event.target.checked ? [...pinned, achievement.id].slice(0, 3) : pinned.filter((id) => id !== achievement.id) })} />{achievement.name}</label> })}</fieldset>}{member.kind === 'bot' && <><label>默认难度<select value={member.bot?.difficulty ?? 'standard'} onChange={(event) => updateBot({ difficulty: event.target.value as BotDifficulty })}><option value="easy">简单</option><option value="standard">标准</option><option value="expert">高手</option></select></label><label className="member-replay-switch"><input type="checkbox" checked={member.bot?.memoryEnabled ?? true} onChange={(event) => updateBot({ memoryEnabled: event.target.checked })} />启用长期记忆</label><div className="member-edit-modal__bot-actions"><button className="button button--paper" onClick={() => updateBot({ memoryResetAt: new Date().toISOString() })}>重置长期记忆</button><button className="button button--paper" onClick={() => { onCloneBot(member); setEditing(false) }}>复制 Bot</button></div><details open={Boolean(member.bot?.customProfile)}><summary>策略与身份顺序</summary>{member.bot?.customProfile ? <div className="member-bot-strategy">{BOT_FIELDS.map((field) => <label key={field.key}><span>{field.label}<b>{member.bot?.customProfile?.[field.key]}</b></span><input type="range" min="0" max="100" value={member.bot?.customProfile?.[field.key] ?? 50} onChange={(event) => updateStrategy({ [field.key]: Number(event.target.value) } as Partial<CustomBotProfile>)} /></label>)}<ol>{member.bot.customProfile.identityPriority.map((identityId, index) => <li key={identityId}><b>{index + 1}</b><span>{getIdentityDefinition(identityId).name}</span><button type="button" aria-label={`上移 ${getIdentityDefinition(identityId).name}`} onClick={() => movePriority(identityId, -1)}>↑</button><button type="button" aria-label={`下移 ${getIdentityDefinition(identityId).name}`} onClick={() => movePriority(identityId, 1)}>↓</button></li>)}</ol></div> : <><p>使用内置策略；复制为自定义策略后可在这里调整完整参数与身份顺序。</p><button className="button button--paper" onClick={() => updateBot({ profileId: 'custom', customProfile: defaultCustomBotProfile(`${member.name} 策略`) })}>转为自定义策略</button></>}</details></>}<div className="member-edit-modal__actions"><button className="button button--paper" onClick={member.archived ? onRestore : onArchive}>{member.archived ? '恢复到名册' : '移出名册'}</button><button className="button button--primary" onClick={saveName}>保存</button></div></>}</section></div>, document.body)}
  </section>
}
