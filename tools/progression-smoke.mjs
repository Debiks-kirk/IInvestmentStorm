import assert from 'node:assert/strict'

export async function runProgressionFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  const expected = await page.evaluate(async () => {
    const {createHumanMember} = await import('/src/game/members.ts')
    const {createSession,createDefaultSettings} = await import('/src/game/session.ts')
    const {settleRound} = await import('/src/game/engine.ts')
    const {saveCareerMembers,archiveCareerMatch} = await import('/src/game/careerStorage.ts')
    const members = ['等级甲','等级乙','等级丙','未参赛'].map(createHumanMember)
    await saveCareerMembers(members)
    const settings=createDefaultSettings(3); settings.rounds=1
    const s=createSession(members.slice(0,3).map(m=>({name:m.name,memberId:m.id,controller:{kind:'human'}})),settings,{careerEnabled:true})
    const turns=s.players.map((p,i)=>({playerId:p.id,operatorMemberId:p.memberId,decisionOrigin:'human',bidUnits:6-i,predictedPlayerId:null}))
    const settled=settleRound({playersAfterBids:s.players,turns,item:s.itemDeck[0],roundIndex:0,rewardMultipliers:[2,1],correctPredictionMultiplier:1,wrongPredictionMultiplier:1,fairnessOrderIds:s.players.map(p=>p.id)})
    s.players=settled.players;s.results=[settled.result];s.phase='finalResult'
    await archiveCareerMatch(s);await archiveCareerMatch(s)
    const {careerRatings}=await import('/src/game/progression.ts')
    const {createMatchCareerRecord}=await import('/src/game/career.ts')
    return Math.max(...[...careerRatings([createMatchCareerRecord(s)]).values()].map(r=>r.rating))
  })
  await page.reload();await page.getByRole('button',{name:'玩家大厅',exact:true}).click()
  await page.getByRole('button',{name:'等级榜',exact:true}).click()
  assert.equal(await page.locator('.member-card--ranked').count(),3)
  assert.ok((await page.locator('.member-card--ranked').first().textContent()).includes(String(expected)))
  assert.equal(await page.locator('.member-card--ranked').filter({hasText:'未参赛'}).count(),0)
  for(const width of [360,844,1366]) {
    await page.setViewportSize({width,height:800})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:`.artifacts/rating-board-${width}.png`})
  }
  await page.locator('.member-card--ranked').first().click()
  await page.getByRole('button',{name:'成就',exact:true}).click()
  assert.equal(await page.locator('.achievement-library article').count(),31)
  await page.getByRole('button',{name:'彩票',exact:true}).click()
  assert.equal(await page.locator('.achievement-library article').count(),3)
  await page.getByRole('button',{name:'全部',exact:true}).click()
  await page.setViewportSize({width:360,height:740})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(await page.locator('.member-profile__tabs').evaluate(el=>new Set([...el.children].map(child=>Math.round(child.getBoundingClientRect().y))).size),1)
  await page.locator('.achievement-heading').scrollIntoViewIfNeeded()
  await page.screenshot({path:'.artifacts/achievements-mobile.png'})
  console.log('等级榜、未参赛空值、重复归档、成就分类及360/844/1366布局通过。')
}
