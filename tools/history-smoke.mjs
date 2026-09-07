import assert from 'node:assert/strict'

export async function runHistoryFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  const result = await page.evaluate(async () => {
    const {createSession,createDefaultSettings}=await import('/src/game/session.ts')
    const {saveHistory,migrateHistory,historyPage}=await import('/src/game/historyStorage.ts')
    const {database,loadCareerReplay,removeCareerMatch}=await import('/src/game/careerStorage.ts')
    const s=createSession(['甲','乙','丙'],createDefaultSettings(3))
    s.phase='finalResult'
    const date=new Date(2026,8,8,12).toISOString()
    // All modes and unregistered seats have complete snapshots, beyond the old 12 limit.
    for(let i=0;i<26;i++) await saveHistory({...s,id:'history-'+i,mode:i%2?'relay':'standard'},date)
    await Promise.all([saveHistory({...s,id:'history-0'},new Date(2026,9,1).toISOString()),saveHistory({...s,id:'history-0'})])
    localStorage.setItem('who-is-raising:history:v1',JSON.stringify({version:1,entries:[{id:'legacy',completedAt:new Date(2026,8,7,12).toISOString(),session:{...s,id:'legacy'}}]}))
    const db=await database()
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('replays','readwrite')
      tx.objectStore('replays').put({sessionId:'career-only',session:{...s,id:'career-only',updatedAt:new Date(2026,8,6,12).toISOString()}})
      tx.oncomplete=resolve;tx.onerror=reject
    })
    await migrateHistory();await migrateHistory()
    const original=await historyPage()
    const datePage=await historyPage(0,'2026-09-08','2026-09-08')
    const before=await loadCareerReplay('history-0')
    await removeCareerMatch('history-0')
    const after=await loadCareerReplay('history-0')
    // Inject failed writes, confirm existing history remains intact.
    const originalTransaction=IDBDatabase.prototype.transaction
    let rejected=false
    IDBDatabase.prototype.transaction=function(names,mode,...rest) {
      if(mode==='readwrite') throw new DOMException('Storage full','QuotaExceededError')
      return originalTransaction.call(this,names,mode,...rest)
    }
    try {await saveHistory({...s,id:'failure'})} catch {rejected=true}
    finally {IDBDatabase.prototype.transaction=originalTransaction}
    // 5,000 lightweight summaries: list queries must not load full sessions.
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('history','readwrite')
      for(let i=0;i<5000;i++) tx.objectStore('history').put({id:'stress-'+i,completedAt:'2028-01-01T12:00:00.000Z',playerCount:3,rounds:5,winner:'测试赢家',mode:'standard'})
      tx.oncomplete=resolve;tx.onerror=reject
    })
    db.close()
    const start=performance.now()
    const last=await historyPage(418)
    return {original:original.total,pageLength:original.entries.length,filtered:datePage.total,retained:Boolean(before&&after),rejected,total:last.total,queryMs:performance.now()-start,oldest:Boolean(await loadCareerReplay('legacy')),career:Boolean(await loadCareerReplay('career-only'))}
  })
  assert.equal(result.original,28);assert.equal(result.pageLength,12);assert.equal(result.filtered,26)
  assert.ok(result.retained&&result.rejected&&result.oldest&&result.career)
  assert.equal(result.total,5028)
  await page.reload()
  await page.getByRole('button',{name:'对局历史',exact:true}).click()
  await page.locator('.history-summary-card').first().waitFor()
  assert.equal(await page.locator('.history-summary-card').count(),12)
  await page.getByLabel('开始日期',{exact:true}).fill('2026-09-08')
  await page.getByLabel('结束日期',{exact:true}).fill('2026-09-08')
  await page.getByText('26 局',{exact:true}).waitFor()
  await page.getByRole('button',{name:'下一页',exact:true}).click()
  await page.getByText('2 / 3',{exact:true}).waitFor()
  await page.getByRole('button',{name:'下一页',exact:true}).click()
  await page.getByText('3 / 3',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.history-summary-card').length===2)
  for(const width of [360,844,1366]) {
    await page.setViewportSize({width,height:800})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    assert.ok(await page.locator('.history-card__copy').first().evaluate(node=>node.getBoundingClientRect().width>180), '标题不应被旧列宽样式挤窄')
    await page.screenshot({path:'.artifacts/history-'+width+'.png'})
  }
  await page.locator('.history-summary-card').first().click()
  await page.getByRole('button',{name:'返回历史',exact:true}).first().waitFor()
  await page.getByRole('button',{name:'返回历史',exact:true}).first().click()
  await page.getByLabel('开始日期',{exact:true}).fill('2030-01-01')
  await page.getByText('暂无对局记录',{exact:true}).waitFor()
  console.log('完整历史、旧局迁移、日期分页、复盘、存储失败及布局通过；5028 条摘要末页查询 '+result.queryMs.toFixed(1)+'ms。')
}
