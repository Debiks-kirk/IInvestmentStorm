import assert from 'node:assert/strict'

export async function runSetupModalFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '3 人真人局' }).click()
  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole('textbox', { name: `玩家 ${index} 名字`, exact: true }).fill(`层级玩家${index}`)
    await page.locator('.seat-field').nth(index - 1).locator('.registered-player-create').click()
  }
  await page.getByLabel('配置名称').fill('弹窗层级测试')
  await page.getByRole('button', { name: '另存配置' }).click()
  if (await page.locator('.error-box').count()) throw new Error(await page.locator('.error-box').innerText())
  await page.locator('.preset-choice--saved').waitFor()
  for (const [width, height] of [[1366, 1100], [360, 640], [844, 390]]) {
    await page.setViewportSize({ width, height })
    const trigger = page.getByRole('button', { name: /高级规则/ })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '高级规则' })
    await dialog.waitFor()
    await page.waitForTimeout(350)
    assert.ok(await dialog.evaluate((element) => element.closest('.setup-rules-layer')?.parentElement === document.body))
    assert.ok(await page.locator('#root').evaluate((root) => root.inert))
    // Check actual hit testing throughout the sheet, not just numeric z-index.
    assert.ok(await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      for (let x = bounds.left + 10; x < bounds.right - 10; x += 35) {
        for (let y = bounds.top + 10; y < bounds.bottom - 10; y += 35) {
          if (!element.contains(document.elementFromPoint(x, y))) return false
        }
      }
      return true
    }), 'No preset or export/delete control may cover the rules sheet')
    const scrollY = await page.evaluate(() => window.scrollY)
    await page.mouse.move(5, height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.scrollY), scrollY)
    await page.locator('.preset-delete').evaluate((button) => button.focus())
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)))
    await page.getByRole('button', { name: '完成高级设置' }).focus()
    await page.keyboard.press('Tab')
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)))
    await dialog.locator('#card-probability').fill('85')
    await page.screenshot({ path: `.artifacts/setup-rules-layer-${width}.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.locator('#root').evaluate((root) => root.inert), false)
    assert.ok(await trigger.evaluate((button) => button === document.activeElement))
    await trigger.click()
    assert.equal(await page.locator('#card-probability').inputValue(), '85')
    await page.getByRole('button', { name: '完成高级设置' }).click()
  }
  await page.getByRole('button', { name: '导出弹窗层级测试' }).click()
  await page.getByRole('dialog', { name: /导出/ }).waitFor()
}
