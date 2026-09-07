import assert from 'node:assert/strict'

export async function runLedgerFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(async () => {
    const { createSession, createDefaultSettings } = await import('/src/game/session.ts')
    const { settleRound } = await import('/src/game/engine.ts')
    const { buyLotteryTicket, settleLottery } = await import('/src/game/lottery.ts')
    const settings = createDefaultSettings(6)
    settings.animationSpeed = 'reduced'; settings.identitySettings.enabled = false
    const s = createSession(['牧城烟火', '流浪汉', '火花', '馆长', '追风', '狐狸'], settings)
    s.phase = 'privateTurn'; s.currentTurnIndex = 5
    Object.assign(s, buyLotteryTicket(s, s.players[5].id, 1))
    const turns = s.players.map((p, i) => ({ playerId: p.id, bidUnits: 6 + i, predictedPlayerId: null }))
    const settled = settleRound({ playersAfterBids: s.players, turns, item: s.itemDeck[0], roundIndex: 0, rewardMultipliers: settings.rewardMultipliers, correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1, fairnessOrderIds: s.fairnessOrderIds })
    const drawn = settleLottery(s.lottery, settled.players, settled.result, settings.rounds, () => 0)
    drawn.result.lottery.acknowledged = true
    Object.assign(s, { players: drawn.players, lottery: drawn.lottery, results: [drawn.result], turns, phase: 'roundResult' })
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify(s))
  })
  for (const revealBids of [false, true]) {
    await page.evaluate(reveal => { const key = 'who-is-raising:session:v1'; const s = JSON.parse(localStorage.getItem(key)); s.settings.revealBids = reveal; localStorage.setItem(key, JSON.stringify(s)) }, revealBids)
    await page.reload(); await page.getByRole('button', { name: /继续第/ }).click()
    for (const size of [{width:360,height:640},{width:700,height:900},{width:844,height:390},{width:1366,height:768}]) {
      await page.setViewportSize(size)
      const table = page.locator('.ledger-table')
      await table.scrollIntoViewIfNeeded()
      const rows = await table.locator(':scope > div').evaluateAll(rows => rows.map(row => {
        const total = row.querySelector(':scope > .delta').getBoundingClientRect()
        const name = row.querySelector(':scope > strong').getBoundingClientRect()
        const details = row.querySelector('.ledger-details').getBoundingClientRect()
        const r = row.getBoundingClientRect()
        return { total, name, details, r, overflow: row.scrollWidth > row.clientWidth + 1, numbers: [...row.querySelectorAll('small')].map(n => ({visible: n.getBoundingClientRect().width > 0, text: n.textContent})) }
      }))
      for (const row of rows) {
        assert.equal(row.overflow, false)
        assert.ok(Math.abs((row.total.top + row.total.bottom) / 2 - (row.name.top + row.name.bottom) / 2) < 3, '合计应与玩家姓名处于同一行')
        assert.ok(row.total.right <= row.r.right + 1)
        assert.ok(row.numbers.every(n => n.visible), '小屏仍能看到收益明细')
        if (size.width > 700) assert.ok(row.details.right <= row.total.left, '彩票明细不挤占合计列')
      }
      assert.ok(rows[5].numbers.some(n => n.text.startsWith('彩票 +')))
      assert.equal(rows[5].numbers.some(n => n.text.startsWith('下注 ')), revealBids)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({path: `.artifacts/ledger-lottery-${size.width}-${revealBids}.png`})
    }
  }
  console.log('彩票账本：中奖/未中奖、公开/隐藏下注、四种尺寸布局通过。')
}
