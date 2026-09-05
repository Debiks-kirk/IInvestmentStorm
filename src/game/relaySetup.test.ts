import { describe, expect, it } from 'vitest'
import { moveRelayOperator } from './relaySetup'
import type { RelaySeatConfig } from './types'

function lineup(): RelaySeatConfig[] {
  return [
    { name: '甲队', operators: [{ id: 'a', name: '甲', controller: { kind: 'human' } }, { id: 'b', name: '乙', controller: { kind: 'bot', profileId: 'adaptive', difficulty: 'expert' } }, { id: 'c', name: '丙', controller: { kind: 'human' } }] },
    { name: '乙队', operators: [{ id: 'd', name: '丁', controller: { kind: 'human' } }] },
    { name: '丙队', operators: [] },
  ]
}
describe('接力操作者拖动', () => {
  it('向前或向后插入保持其他人的顺序，不改变原草稿', () => {
    const seats = lineup()
    expect(moveRelayOperator(seats, 0, 'a', 0, 3)[0].operators.map((o) => o.id)).toEqual(['b', 'c', 'a'])
    expect(moveRelayOperator(seats, 0, 'c', 0, 0)[0].operators.map((o) => o.id)).toEqual(['c', 'a', 'b'])
    expect(seats[0].operators.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    expect(moveRelayOperator(seats, 0, 'b', 0, 2)).toBe(seats)
  })
  it('跨席位搬移而不是复制，完整保留操作者配置', () => {
    const seats = lineup()
    const moved = moveRelayOperator(seats, 0, 'b', 1, 0)
    expect(moved[0].operators.map((o) => o.id)).toEqual(['a', 'c'])
    expect(moved[1].operators.map((o) => o.id)).toEqual(['b', 'd'])
    expect(moved[1].operators[0]).toBe(seats[0].operators[1])
    expect(moved.flatMap((s) => s.operators)).toHaveLength(4)
  })
  it('最后一人可以移入空席位，原席位留空待补充', () => {
    const moved = moveRelayOperator(lineup(), 1, 'd', 2, 0)
    expect(moved[1].operators).toEqual([])
    expect(moved[2].operators.map((o) => o.id)).toEqual(['d'])
  })
  it('失效目标或操作者不改动阵容', () => {
    const seats = lineup()
    expect(moveRelayOperator(seats, 0, 'missing', 1, 0)).toBe(seats)
    expect(moveRelayOperator(seats, 0, 'a', 99, 0)).toBe(seats)
  })
})
