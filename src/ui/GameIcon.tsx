import type { CardId, IdentityId } from '../game/types'
import './GameIcon.css'

const ICON_ROOT = `${import.meta.env.BASE_URL}assets/icons/minimal-v1`
const UPLOADED_CARD_ICONS: Partial<Record<CardId | IdentityId, string>> = {
  luckyTickets: 'heavenlyLottery',
  tieCharm: 'solitaryCharm',
  sleeveUpgrade: 'sleeveAlchemy',
}

/** Labels remain in the surrounding UI; the image is decorative and never intercepts input. */
function GameIcon({ kind, id }: { kind: 'cards' | 'roles'; id: CardId | IdentityId }) {
  const uploaded = UPLOADED_CARD_ICONS[id]
  const expansion = Boolean(uploaded) || ['insurer', 'connoisseur', 'triumphRebate', 'predictionPolicy'].includes(id)
  const src = expansion ? `${import.meta.env.BASE_URL}assets/icons/expansion-v1/${kind}/${uploaded ?? id}.png` : `${ICON_ROOT}/${kind}/${id}.webp`
  return <img className="game-art" src={src} alt="" aria-hidden="true" width="256" height="256" decoding="async" draggable={false} />
}

export function CardIcon({ id }: { id: CardId }) {
  return <GameIcon kind="cards" id={id} />
}

export function IdentityIcon({ id }: { id: IdentityId }) {
  return <GameIcon kind="roles" id={id} />
}
