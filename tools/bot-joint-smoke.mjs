import assert from 'node:assert/strict'

async function acknowledgePublicEffects(page) {
  for (let i = 0; i < 4; i++) {
    const banana = page.getByRole('dialog', { name: '香蕉皮！', exact: true })
    const swap = page.getByRole('button', { name: /继续揭晓/ })
    if (await banana.isVisible()) await banana.getByRole('button', { name: '知道了', exact: true }).click()
    else if (await swap.isVisible()) await swap.click()
    else break
  }
}

export async function runBotJointFlow(page, expansion = false) {
  for (const count of [3, 6, 10]) {
    await page.goto('http://127.0.0.1:5181')
    await page.evaluate(async ({ count, expansion }) => {
      const { createSession, createDefaultSettings } = await import('/src/game/session.ts')
      const { createPlayerIdentity } = await import('/src/game/identities.ts')
      const { emptyBotMemory, defaultBotStrategy } = await import('/src/game/bots.ts')
      const settings = createDefaultSettings(count)
      settings.rounds = 3
      settings.animationSpeed = 'reduced'
      const session = createSession(Array.from({ length: count }, (_, i) => ({ name: `联合Bot${i}`, controller: { kind: 'bot', profileId: 'adaptive', difficulty: 'expert' } })), settings)
      session.phase = 'roundIntro'
      session.identityDraft = null
      session.pendingSpectatorEvents = []
      session.players.forEach((player, i) => {
        player.balanceUnits = 100
        player.identity = createPlayerIdentity((expansion ? ['connoisseur', 'insurer', 'investor'] : ['investor', 'nightwalker', 'collector'])[i % 3])
        player.botMemory = emptyBotMemory(`${session.id}:${i}`, { ...defaultBotStrategy(), collection: 85, bankroll: 10 })
        player.cardInventory = expansion ? ['triumphRebate', 'predictionPolicy'] : []
      })
      const item = { ...session.itemDeck[0], id: 'joint-auction-item', category: 'property', value: 12 }
      session.roundAssetAuctions = [{ id: 'joint-asset', sellerId: session.players.at(-1).id, item, itemRoundIndex: 0, roundIndex: 0, minimumBidUnits: 8 }]
      session.players[0].items = Array.from({ length: 3 }, (_, i) => ({ item: { ...item, id: `owned-${i}` }, roundIndex: 0 }))
      session.roundStartBalanceUnits = Object.fromEntries(session.players.map((p) => [p.id, p.balanceUnits]))
      localStorage.setItem('who-is-raising:session:v1', JSON.stringify(session))
    }, { count, expansion })
    await page.reload()
    await page.getByRole('button', { name: /继续第/ }).click()
    await page.getByLabel('观战速度').selectOption('4')
    for (let round = 0; round < 3; round += 1) {
      const next = page.getByRole('button', { name: round === 2 ? /查看最终排行榜/ : '进入下一轮' })
      await next.waitFor({ timeout: 60000 })
      await acknowledgePublicEffects(page)
      const state = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
      assert.equal(state.results.length, round + 1)
      assert.equal(state.turns.length, count)
      assert.equal(new Set(state.turns.map((turn) => turn.playerId)).size, count)
      assert.ok(state.players.every((p) => p.balanceUnits >= 0))
      if (round === 0) {
        assert.ok(state.turns.every((turn) => Array.isArray(turn.auctionBids)))
        // Refresh at the paused boundary must not repeat spending or bidding.
        await page.reload()
        await page.getByRole('button', { name: /继续第/ }).click()
        await next.waitFor({ timeout: 60000 })
        await acknowledgePublicEffects(page)
        const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
        assert.deepEqual(restored.turns, state.turns)
        assert.deepEqual(restored.players.map((p) => p.balanceUnits), state.players.map((p) => p.balanceUnits))
      }
      await next.click()
    }
    await page.getByText('全局结束', { exact: true }).waitFor({ timeout: 30000 })
    await page.screenshot({ path: `.artifacts/bot-joint-${expansion ? 'expansion-' : ''}final-${count}.png`, fullPage: true })
  }
}
