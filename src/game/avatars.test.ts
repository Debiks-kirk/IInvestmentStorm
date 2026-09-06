import { describe, expect, it } from 'vitest'
import { avatarStrokePath, cloneAvatar, MAX_AVATAR_STROKES, MAX_STROKE_POINTS, normalizeAvatarDrawing } from './avatars'
import { cloneMember, createHumanMember } from './members'
import type { AvatarDrawing } from './types'

const drawing: AvatarDrawing = { version: 1, background: '#fffaf2', strokes: [{ color: '#a35b50', width: 6, points: [[0, 0], [128.5, 256]] }] }
describe('member drawings', () => {
  it('preserves a drawing through JSON backup and deep clones member data', () => {
    const member = createHumanMember('画家')
    member.avatar.drawing = drawing
    const copy = cloneMember(JSON.parse(JSON.stringify(member)))
    expect(copy.avatar.drawing).toEqual(drawing)
    const cloned = cloneMember(member)
    cloned.avatar.drawing!.strokes[0].points[0][0] = 20
    expect(member.avatar.drawing.strokes[0].points[0][0]).toBe(0)
    expect(cloneAvatar({ shape: 29, accent: '#557f74' })).toEqual({ shape: 29, accent: '#557f74' })
  })
  it('rejects invalid or oversized imported drawing data', () => {
    for (const value of [null, {}, '<svg onload=alert(1)>', { ...drawing, version: 2 }, { ...drawing, background: 'url(javascript:alert(1))' },
      { ...drawing, strokes: [] }, { ...drawing, strokes: Array(MAX_AVATAR_STROKES + 1).fill(drawing.strokes[0]) },
      ...[NaN, Infinity, -1, 257, '12'].map(x => ({ ...drawing, strokes: [{ ...drawing.strokes[0], points: [[x, 0]] }] })),
      { ...drawing, strokes: [{ ...drawing.strokes[0], width: 30 }] },
      { ...drawing, strokes: [{ ...drawing.strokes[0], points: Array(MAX_STROKE_POINTS + 1).fill([0, 0]) }] },
    ]) expect(normalizeAvatarDrawing(value)).toBeUndefined()
  })
  it('retains valid presets when bad drawing data is discarded', () => {
    expect(cloneAvatar({ shape: 24, accent: '#557f74', drawing: {} as AvatarDrawing })).toEqual({ shape: 24, accent: '#557f74' })
    expect(cloneAvatar({ shape: -1, accent: 'bad' })).toEqual({ shape: 0, accent: '#557f74' })
  })
  it('renders taps as visible dots and keeps line geometry', () => {
    expect(avatarStrokePath(drawing.strokes[0])).toBe('M0 0L128.5 256')
    expect(avatarStrokePath({ color: '#303533', width: 2, points: [[12, 14]] })).toBe('M12 14l0 0.01')
  })
})
