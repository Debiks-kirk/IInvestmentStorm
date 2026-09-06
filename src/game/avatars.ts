import type { AvatarDrawing, AvatarStroke, MemberAvatar } from './types'

export const AVATAR_PRESET_COUNT = 30
export const DRAWING_SIZE = 256
export const MAX_AVATAR_STROKES = 128
export const MAX_STROKE_POINTS = 512
export const DRAWING_BACKGROUND = '#fffaf2'
const colorPattern = /^#[0-9a-f]{6}$/i

/** Only bounded vector data is accepted, never uploaded SVG/HTML or data URLs. */
export function normalizeAvatarDrawing(value: unknown): AvatarDrawing | undefined {
  if (!value || typeof value !== 'object') return undefined
  const drawing = value as AvatarDrawing
  if (drawing.version !== 1 || !colorPattern.test(drawing.background) || !Array.isArray(drawing.strokes)
    || !drawing.strokes.length || drawing.strokes.length > MAX_AVATAR_STROKES) return undefined
  const strokes: AvatarStroke[] = []
  for (const stroke of drawing.strokes) {
    if (!stroke || !colorPattern.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 24
      || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > MAX_STROKE_POINTS) return undefined
    const points: [number, number][] = []
    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= DRAWING_SIZE)) return undefined
      points.push([point[0], point[1]])
    }
    strokes.push({ color: stroke.color, width: stroke.width, points })
  }
  return { version: 1, background: drawing.background, strokes }
}

export function cloneAvatar(avatar: MemberAvatar): MemberAvatar {
  const drawing = normalizeAvatarDrawing(avatar.drawing)
  return {
    shape: Number.isInteger(avatar.shape) && avatar.shape >= 0 && avatar.shape < AVATAR_PRESET_COUNT ? avatar.shape : 0,
    accent: colorPattern.test(avatar.accent) ? avatar.accent : '#557f74',
    ...(drawing ? { drawing } : {}),
  }
}

export function avatarStrokePath(stroke: AvatarStroke): string {
  const [first, ...rest] = stroke.points
  // A tiny segment with round caps makes single taps visible in SVG as well as canvas.
  return `M${first[0]} ${first[1]}${rest.length ? rest.map(p => `L${p[0]} ${p[1]}`).join('') : `l0 0.01`}`
}
