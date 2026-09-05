import assert from 'node:assert/strict'

export async function runIconFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: /游戏图鉴/ }).click()
  for (const width of [360, 844, 1366]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 800 })
    for (const [name, count] of [['身份', 10], ['道具', 13]]) {
      await page.getByRole('tab', { name: new RegExp(name) }).click()
      assert.equal(await page.locator('.collection-grid .game-art').count(), count)
      const sizes = await page.locator('.collection-grid .game-art').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => image.decode()))
        return images.map((image) => {
          const rect = image.getBoundingClientRect()
          const host = image.parentElement.getBoundingClientRect()
          const canvas = document.createElement('canvas')
          canvas.width = 1; canvas.height = 1
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return { src: image.currentSrc, width: rect.width, height: rect.height,
            hostWidth: host.width, hostHeight: host.height,
            naturalWidth: image.naturalWidth, alt: image.alt,
            backing: getComputedStyle(image.parentElement).backgroundColor,
            alpha: context.getImageData(0, 0, 1, 1).data[3] }
        })
      })
      for (const size of sizes) {
        assert.match(size.src, /minimal-v1\/(roles|cards)\/[^/]+\.webp$/)
        assert.equal(size.naturalWidth, 256)
        assert.equal(size.alpha, 0, 'Transparent corners must survive encoding')
        assert.equal(size.backing, 'rgb(243, 238, 227)')
        assert.equal(size.alt, '')
        assert.ok(size.width >= 28 && size.height >= 28)
        assert.ok(size.width <= size.hostWidth + 1 && size.height <= size.hostHeight + 1)
      }
      assert.equal(new Set(sizes.map((size) => size.src)).size, count)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `.artifacts/icons-${name === '身份' ? 'identities' : 'cards'}-${width}.png`, fullPage: true })
    }
  }
  // Verify light backing also survives a dark surrounding surface.
  await page.addStyleTag({ content: '.collection-card { background: #242524 !important; color: #fff !important; }' })
  assert.ok(await page.locator('.game-art-slot').evaluateAll((slots) => slots.every((slot) => getComputedStyle(slot).backgroundColor === 'rgb(243, 238, 227)')))
  await page.screenshot({ path: '.artifacts/icons-dark-surface.png', fullPage: true })
}
