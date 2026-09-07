import assert from 'node:assert/strict'

export async function runConnoisseurFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(async () => {
    const { createSession, createDefaultSettings } = await import('/src/game/session.ts')
    const { createPlayerIdentity } = await import('/src/game/identities.ts')
    const { rewardConnoisseurItem } = await import('/src/game/connoisseur.ts')
    const { createCardDeck } = await import('/src/game/cards.ts')
    const settings = createDefaultSettings(3)
    settings.rounds = 4; settings.animationSpeed = 'reduced'; settings.systemAuctionCardsPerRound = 0
    const session = createSession(['奖励甲', '奖励乙', '奖励丙'], settings)
    session.phase = 'handoff'; session.identityDraft = null; session.currentTurnIndex = 0
    session.players[0].identity = createPlayerIdentity('connoisseur')
    let deck = createCardDeck([])
    for (const [index, category] of ['leisure', 'transport', 'luxury', 'property'].entries()) {
      deck = rewardConnoisseurItem(session.players[0], { item: { ...session.itemDeck[0], id: category, category }, roundIndex: index }, index, deck, [], () => 0).cardDeck
    }
    session.cardDeck = deck
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button', { name: /继续第/ }).click()
  await page.getByRole('button', { name: '进入私密操作' }).click()
  const dialog = page.getByRole('dialog', { name: '鉴赏家选卡奖励' })
  await dialog.getByRole('heading', { name: '道具 2 选 1' }).waitFor()
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  await dialog.locator('.card-offer-choice').first().click()
  await dialog.locator('.card-offer-choice').last().click()
  assert.equal(await dialog.locator('.card-offer-choice.is-selected').count(), 1)
  await page.reload()
  await page.getByRole('button', { name: /继续第/ }).click()
  await page.getByRole('button', { name: '进入私密操作' }).click()
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  assert.deepEqual(restored.players[0].identity.connoisseurOffers, before.players[0].identity.connoisseurOffers)
  assert.equal(await dialog.getByRole('button', { name: '确认领取' }).isDisabled(), true)
  for (const count of [2, 3, 4]) {
    await dialog.getByRole('heading', { name: `道具 ${count} 选 1` }).waitFor()
    assert.equal(await dialog.locator('.card-offer-choice').count(), count)
    await dialog.locator('.card-offer-choice').last().click()
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(layout.scroll <= layout.width)
    await page.screenshot({ path: `.artifacts/connoisseur-${count}-360.png` })
    await dialog.getByRole('button', { name: '确认领取' }).click()
  }
  await page.getByText('你的回合', { exact: true }).waitFor()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  assert.equal(after.players[0].cardInventory.length, 4)
  assert.equal(after.players[0].identity.connoisseurOffers.length, 0)
  assert.equal(after.cardDeck.length, before.cardDeck.length + 6)

  // Final-round rewards must survive the real loadSession migration, not skip to finalResult.
  await page.evaluate(() => {
    const key = 'who-is-raising:session:v1', s = JSON.parse(localStorage.getItem(key))
    s.phase = 'finalReceipt'; s.finalReceiptIndex = 0; s.roundIndex = 3
    s.players[0].identity.connoisseurOffers = [{ category: 'property', roundIndex: 3, offeredCardIds: ['red', 'black'] }]
    localStorage.setItem(key, JSON.stringify(s))
  })
  await page.reload()
  await page.getByRole('button', { name: /继续第/ }).click()
  await page.getByRole('button', { name: /查看结果/ }).click()
  await dialog.getByRole('heading', { name: '道具 2 选 1' }).waitFor()
  await dialog.locator('.card-offer-choice').first().click()
  await dialog.getByRole('button', { name: '确认领取' }).click()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  const final = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  assert.equal(final.phase, 'finalResult')
  assert.equal(final.players[0].cardInventory.length, 5)
}
