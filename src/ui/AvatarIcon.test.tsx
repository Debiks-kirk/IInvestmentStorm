import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AVATAR_LIBRARY, AvatarIcon, AvatarMembers, PlayerAvatar } from './AvatarIcon'
import { avatarForMember, createBotMember, createHumanMember } from '../game/members'
import { SYSTEM_PRESETS } from '../game/presets'
import { createDefaultSettings } from '../game/session'

it('system presets leave human seats empty and deal four identities', () => {
  for (const preset of SYSTEM_PRESETS) {
    expect(preset.settings.identitySettings.identityChoiceCount).toBe(4)
    expect(preset.seats.filter(s => s.controller.kind === 'human').every(s => s.name === '')).toBe(true)
    expect(preset.seats.filter(s => s.controller.kind === 'bot').every(s => s.name.length > 0)).toBe(true)
  }
  for (const count of [3, 6, 10]) expect(createDefaultSettings(count).identitySettings.identityChoiceCount).toBe(4)
})

it('provides 30 distinct, stable and accessible decorative avatars', () => {
  expect(AVATAR_LIBRARY).toHaveLength(30)
  expect(new Set(AVATAR_LIBRARY.map(a => a[1])).size).toBe(30)
  expect(AVATAR_LIBRARY.slice(24).map(a => a[0])).toEqual(['月亮', '小狗', '小熊', '熊猫', '小鸡', '青蛙'])
  AVATAR_LIBRARY.forEach(([,path], shape) => {
    const markup = renderToStaticMarkup(<AvatarIcon avatar={{shape, accent:'#557f74'}} />)
    expect(markup).toContain(path)
    expect(markup).toContain('aria-hidden="true"')
  })
})

it('assigns new humans and bots a persisted default from their random member ID', () => {
  for (const create of [createHumanMember, createBotMember]) {
    const member = create('未设置头像')
    expect(member.avatar).toEqual(avatarForMember(member.id))
    expect(member.avatar.shape).toBeGreaterThanOrEqual(0)
    expect(member.avatar.shape).toBeLessThan(30)
    const restored = JSON.parse(JSON.stringify({...member, name:'改名'}))
    expect(restored.avatar).toEqual(member.avatar)
  }
})

it('uses permanent member avatar regardless of the seat name and falls back safely', () => {
  const member = createHumanMember('测试')
  member.avatar.shape = 15
  expect(renderToStaticMarkup(<AvatarMembers.Provider value={[member]}><PlayerAvatar player={{id:'seat', memberId:member.id}} /></AvatarMembers.Provider>)).toContain(AVATAR_LIBRARY[15][1])
  expect(renderToStaticMarkup(<AvatarIcon avatar={{shape:NaN, accent:'#557f74'}} />)).toContain(AVATAR_LIBRARY[0][1])
})

it('uses saved drawing strokes for in-game member avatars without preset path styles', () => {
  const member = createHumanMember('画家')
  member.avatar.drawing = { version: 1, background: '#fffaf2', strokes: [{ color: '#a35b50', width: 6, points: [[10, 20], [30, 40]] }] }
  const markup = renderToStaticMarkup(<AvatarMembers.Provider value={[member]}><PlayerAvatar player={{ id: 'seat', memberId: member.id }} /></AvatarMembers.Provider>)
  expect(markup).toContain('avatar-art--drawn')
  expect(markup).toContain('viewBox="0 0 256 256"')
  expect(markup).toContain('stroke="#a35b50"')
  expect(markup).toContain('stroke-width="6"')
  expect(markup).toContain('M10 20L30 40')
})
