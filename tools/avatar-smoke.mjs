import assert from 'node:assert/strict'

export async function runAvatarFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.getByRole('button', { name: '玩家大厅', exact: true }).click()
  await page.getByRole('button', { name: '注册玩家' }).click()
  const register = page.getByRole('dialog', { name: '注册玩家' })
  await register.getByPlaceholder('输入名称').fill('头像画家')
  await register.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByRole('button', { name: /头像画家/ }).first().click()
  await page.getByRole('button', { name: '编辑资料' }).click()
  const dialog = page.getByRole('dialog', { name: '编辑成员' })
  assert.equal(await dialog.locator('.member-avatar-picker button').count(), 30)
  for (const name of ['月亮', '小狗', '小熊', '熊猫', '小鸡', '青蛙']) {
    await dialog.getByRole('button', { name: `头像：${name}`, exact: true }).click()
    assert.equal(await dialog.getByRole('button', { name: `头像：${name}`, exact: true }).getAttribute('aria-pressed'), 'true')
  }
  await page.screenshot({ path: '.artifacts/avatar-presets-mobile.png', fullPage: true })
  await dialog.getByRole('button', { name: '手绘头像', exact: true }).click()
  const editor = page.getByRole('region', { name: '手绘头像画板' })
  const canvas = editor.getByLabel('绘制头像')
  assert.equal(await editor.getByRole('button', { name: '保存头像' }).isDisabled(), true)

  // Actual touch input on the drawing canvas, not synthetic DOM pointer events.
  await canvas.scrollIntoViewIfNeeded()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const box = await canvas.boundingBox()
  const scrollBefore = await page.evaluate(() => ({ body: window.scrollY, modal: document.querySelector('.member-mini-modal').scrollTop }))
  const pos = (x, y) => ({ x: box.x + box.width * x, y: box.y + box.height * y })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pos(.2, .25), id: 1 }] })
  for (let i = 0; i < 24; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...pos(.2 + i * .025, .25 + Math.sin(i / 23 * Math.PI) * .45), id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const scrollAfter = await page.evaluate(() => ({ body: window.scrollY, modal: document.querySelector('.member-mini-modal').scrollTop }))
  assert.deepEqual(scrollAfter, scrollBefore, '画板触摸不应滚动背景或弹窗')
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await cdp.detach()
  assert.equal(await editor.locator('.avatar-drawing-preview path').count(), 1)
  assert.equal(await canvas.evaluate(el => getComputedStyle(el).touchAction), 'none')

  await editor.getByRole('button', { name: '画笔颜色：砖红' }).click()
  await canvas.scrollIntoViewIfNeeded()
  const dot = await canvas.boundingBox()
  await page.mouse.click(dot.x + dot.width * .38, dot.y + dot.height * .32)
  assert.equal(await editor.locator('.avatar-drawing-preview path').count(), 2)
  await editor.getByRole('button', { name: '清空', exact: true }).click()
  assert.equal(await editor.getByRole('button', { name: '保存头像' }).isDisabled(), true)
  await editor.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await editor.locator('.avatar-drawing-preview path').count(), 2, '撤销清空恢复全部笔画')
  await editor.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await editor.locator('.avatar-drawing-preview path').count(), 1)

  // Verify canvas and saved SVG actually contain ink, rather than only counting metadata.
  const pixels = await canvas.evaluate(el => {
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) count++
    return count
  })
  assert.ok(pixels > 500, '画板应实际绘制可见笔画')
  for (const [width, height] of [[360, 640], [844, 390], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await canvas.scrollIntoViewIfNeeded()
    const sizes = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, modal: document.querySelector('.member-mini-modal').scrollWidth, client: document.querySelector('.member-mini-modal').clientWidth }))
    assert.ok(sizes.body <= sizes.width && sizes.modal <= sizes.client, `头像画板 ${width}px 不得溢出`)
    await page.screenshot({ path: `.artifacts/avatar-drawing-${width}.png`, fullPage: true })
  }
  await editor.getByRole('button', { name: '保存头像' }).click()
  assert.equal(await dialog.locator('.member-drawn-avatar path').count(), 1)
  assert.equal(await dialog.locator('.member-avatar-picker button[aria-pressed="true"]').count(), 0)
  await dialog.getByRole('button', { name: '编辑手绘头像' }).click()
  await editor.getByRole('button', { name: '清空', exact: true }).click()
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await dialog.locator('.member-drawn-avatar path').count(), 1, '取消不可覆盖已存头像')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '玩家大厅', exact: true }).click()
  await page.getByRole('button', { name: /头像画家/ }).first().click()
  assert.equal(await page.locator('.member-profile__top .avatar-art--drawn path').count(), 1, '刷新后主页应保留手绘头像')

  // Real IndexedDB backup, restore, and rename exercise the same profile persistence as the UI.
  const backupResult = await page.evaluate(async () => {
    const storage = await import('/src/game/careerStorage.ts')
    const data = await storage.loadCareerData()
    const raw = await storage.exportCareerBackup()
    const preview = storage.inspectCareerBackup(raw, { members: [], records: [] })
    const drawn = preview.backup.members.find(m => m.name === '头像画家')
    const merged = await storage.importCareerBackup(preview, { members: [], records: [] }, false)
    return { before: data.members.find(m => m.name === '头像画家').avatar, preview: drawn.avatar, after: merged.members.find(m => m.name === '头像画家').avatar }
  })
  assert.deepEqual(backupResult.before, backupResult.preview)
  assert.deepEqual(backupResult.before, backupResult.after)
  await page.getByRole('button', { name: '编辑资料' }).click()
  await dialog.getByRole('button', { name: '头像：月亮', exact: true }).click()
  assert.equal(await dialog.locator('.member-drawn-avatar').count(), 0, '选预设需切回预设')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 640 })
}
