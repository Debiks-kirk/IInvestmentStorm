import type { CardId, IdentityId } from '../game/types'
import './GameIcon.css'

const ICON_ROOT = `${import.meta.env.BASE_URL}assets/icons/minimal-v1`

/** Labels remain in the surrounding UI; the image is decorative and never intercepts input. */
function GameIcon({ kind, id }: { kind: 'cards' | 'roles'; id: CardId | IdentityId }) {
  if (['luckyTickets', 'tieCharm', 'sleeveUpgrade'].includes(id)) return <svg className="game-art" viewBox="0 0 256 256" aria-hidden="true"><rect x="12" y="12" width="232" height="232" rx="52" fill={id === 'tieCharm' ? '#597e79' : id === 'luckyTickets' ? '#a17b49' : '#75668a'} stroke="#eadcc2" strokeWidth="5"/><g fill="none" stroke="#fff4dc" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round">{id === 'tieCharm' ? <><path d="M128 50 191 80v48c0 42-63 76-63 76s-63-34-63-76V80Z"/><path d="m102 126 19 19 35-42"/></> : id === 'luckyTickets' ? <><path d="M62 77h132v30a21 21 0 0 0 0 42v30H62v-30a21 21 0 0 0 0-42Z"/><path d="m128 101 8 18 20 3-15 14 4 20-17-10-17 10 4-20-15-14 20-3Z"/></> : <><path d="M61 169h134l-22 32H83Z M92 161V99h72v62 M106 84l22-28 22 28 M128 56v74"/><path d="m183 59 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z"/></>}</g></svg>
  const expansion = ['insurer', 'connoisseur', 'triumphRebate', 'predictionPolicy'].includes(id)
  const src = expansion ? `${import.meta.env.BASE_URL}assets/icons/expansion-v1/${kind}/${id}.png` : `${ICON_ROOT}/${kind}/${id}.webp`
  return <img className="game-art" src={src} alt="" aria-hidden="true" width="256" height="256" decoding="async" draggable={false} />
}

export function CardIcon({ id }: { id: CardId }) {
  return <GameIcon kind="cards" id={id} />
}

export function IdentityIcon({ id }: { id: IdentityId }) {
  return <GameIcon kind="roles" id={id} />
}
