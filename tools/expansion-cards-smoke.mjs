import assert from 'node:assert/strict'

export async function runExpansionCardsFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(async () => {
    const { createSession, createDefaultSettings } = await import('/src/game/session.ts')
    const settings = createDefaultSettings(3)
    settings.identitySettings.enabled = false; settings.animationSpeed = 'reduced'; settings.systemAuctionCardsPerRound = 0
    const s = createSession(['升级甲','升级乙','升级丙'],settings)
    s.phase = 'handoff'; s.players[0].cardInventory = ['sleeveUpgrade','sleeveUpgrade','sleeveUpgrade','red','luckyTickets']
    s.cardDeck = ['swap','bananaPeel','legendaryLoot']
    localStorage.setItem('who-is-raising:session:v1',JSON.stringify(s))
  })
  const enter = async () => {
    await page.getByRole('button',{name:'进入私密操作'}).click()
    while(await page.getByRole('button',{name:'知道了',exact:true}).count()) await page.getByRole('button',{name:'知道了',exact:true}).last().click()
  }
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  await page.reload(); await page.getByRole('button',{name:/继续第/}).click(); await enter()
  await page.setViewportSize({width:360,height:740})
  for (const target of ['红卡','偷天换日','香蕉皮']) {
    console.log(target, (await state()).players[0].cardInventory, (await state()).cardDeck)
    await page.getByTestId('backpack-tool').click()
    await page.getByRole('button',{name:/袖里乾坤/}).click()
    const modal = page.getByRole('dialog',{name:/袖里乾坤/})
    await modal.getByRole('button',{name:new RegExp(target)}).click()
    await page.screenshot({path:`.artifacts/upgrade-${target}.png`})
    await modal.getByRole('button',{name:'确认使用',exact:true}).click()
    await page.getByRole('dialog',{name:'道具使用结果'}).getByRole('button',{name:'收下'}).click()
  }
  assert.deepEqual((await state()).players[0].cardInventory,['luckyTickets','legendaryLoot'])
  await page.getByTestId('backpack-tool').click()
  await page.getByRole('button',{name:/天降彩券/}).click()
  await page.getByRole('dialog',{name:/天降彩券/}).getByRole('button',{name:'确认使用',exact:true}).click()
  await page.getByRole('dialog',{name:'道具使用结果'}).getByRole('button',{name:'收下'}).click()
  assert.equal((await state()).lottery.poolUnits,15)
  await page.reload(); await page.getByRole('button',{name:/继续第/}).click(); await enter()
  await page.getByRole('dialog',{name:'道具使用结果'}).getByRole('button',{name:'收下'}).click()
  assert.equal((await state()).instantCardUses.length,4)
  await page.getByTestId('lottery-entry').click()
  assert.equal(await page.getByRole('button',{name:/确认购票/}).isDisabled(),false)
  await page.getByRole('button',{name:'关闭彩票',exact:true}).click()
  await page.getByRole('button',{name:'确认提交',exact:true}).click()
  await page.getByRole('button',{name:'确定提交',exact:true}).click()
  assert.equal((await state()).turns[0].cardUses.filter(use=>use.cardId==='sleeveUpgrade').length,3)
  assert.equal((await state()).turns[0].cardUses.length,4)
  console.log('Expansion cards browser flow passed: 3 upgrades, gifts, refresh, submission')
}
