import type { CardId, IdentityId } from '../game/types'
import './GameIcon.css'

const ICON_ROOT = `${import.meta.env.BASE_URL}assets/icons/minimal-v1`

/** Labels remain in the surrounding UI; the image is decorative and never intercepts input. */
function GameIcon({ kind, id }: { kind: 'cards' | 'roles'; id: CardId | IdentityId }) {
  return <img className="game-art" src={`${ICON_ROOT}/${kind}/${id}.webp`} alt="" aria-hidden="true" width="256" height="256" decoding="async" draggable={false} />
}

export function CardIcon({ id }: { id: CardId }) {
  return <GameIcon kind="cards" id={id} />
}

export function IdentityIcon({ id }: { id: IdentityId }) {
  return <GameIcon kind="roles" id={id} />
}
