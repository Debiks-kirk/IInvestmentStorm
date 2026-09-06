import { createContext, useContext } from 'react'
import { avatarForMember } from '../game/members'
import type { MemberAvatar, MemberProfile } from '../game/types'
import './AvatarIcon.css'

// Stable numeric IDs: the first eight retain the original geometric choices.
export const AVATAR_LIBRARY = [
  ['菱光', 'M24 6 42 24 24 42 6 24Z'],
  ['圆环', 'M24 7a17 17 0 1 0 0 34 17 17 0 1 0 0-34 M24 13a11 11 0 1 0 0 22 11 11 0 1 0 0-22'],
  ['山峰', 'M24 7 43 40H5Z M17 25l7 7 7-7'],
  ['方舟', 'M9 9h30v30H9Z M17 17h14v14H17Z'],
  ['星芒', 'm24 5 5 14 14 5-14 5-5 14-5-14L5 24l14-5Z'],
  ['半月', 'M24 6a18 18 0 1 0 18 18H24Z'],
  ['浪花', 'M5 19q7-12 14 0t14 0 10 0 M5 30q7-12 14 0t14 0 10 0'],
  ['蜂巢', 'm24 5 17 10v18L24 43 7 33V15Z M24 14l9 5v10l-9 5-9-5V19Z'],
  ['灵猫', 'M9 21V7l11 9h8l11-9v14c6 26-36 26-30 0 M17 25h1m12 0h1 M21 31l3 3 3-3'],
  ['赤狐', 'M6 8l18 9L42 8l-4 22-14 12L10 30Z M6 8l12 22 6 12 6-12L42 8 M16 24h2m12 0h2'],
  ['夜枭', 'M8 8l16 7L40 8v20c0 20-32 20-32 0Z M17 20a5 5 0 1 0 0 10 5 5 0 1 0 0-10 M31 20a5 5 0 1 0 0 10 5 5 0 1 0 0-10 M21 33l3 4 3-4'],
  ['机灵', 'M10 15h28v24H10Z M24 15V8m-3 0h6 M17 23v4m14-4v4 M18 33h12 M5 23v9m38-9v9'],
  ['王冠', 'M7 13l10 9L24 7l7 15 10-9-5 24H12Z M12 42h24'],
  ['宇航员', 'M12 34C-2 3 50 3 36 34 M13 20h22v11H13Z M15 34v8h18v-8 M19 24h10'],
  ['小鲸', 'M6 31C2 9 32 9 33 26l9-9v14c0 16-33 13-36 0 M13 27h1 M19 12V7m5 6 4-5'],
  ['游鲨', 'M5 28Q18 8 34 22l9-8v24l-10-6Q17 43 5 28Z M18 19l5-13 5 13 M13 26h1'],
  ['小鹿', 'M14 18 7 9V5m0 7-4-2 M34 18l7-9V5m0 7 4-2 M14 18h20v14L24 43 14 32Z M19 26h1m8 0h1'],
  ['兔耳', 'M15 22C0 0 25-4 21 21 M27 21C23-4 48 0 33 22 M15 22C-1 44 49 44 33 22 M17 29h1m12 0h1 M22 35h4'],
  ['幽灵', 'M9 41V23C9 2 39 2 39 23v18l-8-5-7 5-7-5Z M18 22v5m12-5v5'],
  ['忍者', 'M9 17Q24-3 39 17v15Q24 49 9 32Z M9 20h30v10H9 M17 24l3 2m11-2-3 2 M39 19l6-6m-6 11 6 4'],
  ['飞龙', 'M6 38 15 17l-1-9 11 7 10-6-3 10 10 12-10 3-8 9-9-6Z M25 24h2 M32 19l5 1'],
  ['火苗', 'M24 4C27 21 38 14 39 30c0 21-35 18-30-2l8-13 2 12Z M24 26q-13 16 2 16 10-4-2-16Z'],
  ['四叶', 'M24 24C-9 24 14-8 24 18 34-8 57 24 24 24 57 24 34 56 24 30 14 56-9 24 24 24Z'],
  ['飞船', 'M13 29C12 15 27 6 41 7c0 14-9 29-22 28Z M26 15a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M13 24l-8 8 10 1m9 2-1 9 9-9 M11 37l-5 5'],
] as const

export const AvatarMembers = createContext<readonly MemberProfile[]>([])

export function AvatarIcon({ avatar }: { avatar: MemberAvatar }) {
  const index = Number.isInteger(avatar.shape) && avatar.shape >= 0 && avatar.shape < AVATAR_LIBRARY.length ? avatar.shape : 0
  return <svg className="avatar-art" viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={{ backgroundColor: avatar.accent }}><path d={AVATAR_LIBRARY[index][1]} /></svg>
}

export function PlayerAvatar({ player }: { player: { id: string; memberId?: string; color?: string } }) {
  const members = useContext(AvatarMembers)
  const avatar = members.find((member) => member.id === player.memberId)?.avatar ?? avatarForMember(player.id, player.color)
  return <AvatarIcon avatar={avatar} />
}
