import type { RelaySeatConfig } from './types'

/** destinationIndex is a gap in the original destination list, before removal. */
export function moveRelayOperator(seats: RelaySeatConfig[], sourceSeat: number, operatorId: string, destinationSeat: number, destinationIndex: number): RelaySeatConfig[] {
  const source = seats[sourceSeat]
  const destination = seats[destinationSeat]
  const sourceIndex = source?.operators.findIndex((operator) => operator.id === operatorId) ?? -1
  if (!source || !destination || sourceIndex < 0 || !Number.isInteger(destinationIndex)) return seats
  let insertion = Math.max(0, Math.min(destinationIndex, destination.operators.length))
  if (sourceSeat === destinationSeat && sourceIndex < insertion) insertion -= 1
  if (sourceSeat === destinationSeat && insertion === sourceIndex) return seats
  const next = seats.map((seat) => ({ ...seat, operators: [...seat.operators] }))
  const [operator] = next[sourceSeat].operators.splice(sourceIndex, 1)
  next[destinationSeat].operators.splice(insertion, 0, operator)
  return next
}
