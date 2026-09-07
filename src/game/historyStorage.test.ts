import { describe, it, expect } from 'vitest'
import { historyDateRange } from './historyStorage'

describe('历史日期查询', () => {
  it('按本地日期查询，结束日期包含当天', () => {
    const range=historyDateRange('2026-09-08','2026-09-08')
    expect(range.start).toBe(new Date(2026,8,8).toISOString())
    expect(range.end).toBe(new Date(2026,8,9).toISOString())
    expect(historyDateRange()).toEqual({start:undefined,end:undefined})
    expect(historyDateRange('','2026-12-31').end).toBe(new Date(2027,0,1).toISOString())
  })
  it('拒绝倒置与非法日期', () => {
    expect(()=>historyDateRange('2026-09-09','2026-09-08')).toThrow()
    expect(()=>historyDateRange('2026-02-30')).toThrow()
    expect(()=>historyDateRange('garbage')).toThrow()
  })
})
