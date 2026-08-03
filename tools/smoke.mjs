import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const chromeCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const executablePath = chromeCandidates.find(existsSync)
if (!executablePath) throw new Error('未找到可用于冒烟测试的 Chrome 或 Edge。')

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181'], {
  cwd: process.cwd(),
  stdio: 'ignore',
  windowsHide: true,
})

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:5181')
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite 开发服务器未能按时启动。')
}

async function holdToEnter(page) {
  const button = page.getByRole('button', { name: '长按进入私密操作' })
  await button.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0 })
  await page.waitForTimeout(820)
  await page.getByText('你的回合', { exact: true }).waitFor()
}

async function setRange(locator, value) {
  await locator.evaluate((element, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    valueSetter.call(element, String(nextValue))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (sizes.scrollWidth > sizes.width) throw new Error(`${label} 存在横向溢出：${sizes.scrollWidth}px > ${sizes.width}px。`)
}

async function startRound(page) {
  await page.getByRole('button', { name: '启动抽奖机' }).click()
  await page.getByRole('button', { name: /开始传递/ }).waitFor()
  await page.getByRole('button', { name: /开始传递/ }).click()
}

async function submitPrivateTurn(page, bidUnits, predictionIndex = null, useCard = false) {
  await holdToEnter(page)
  if (predictionIndex !== null) await page.locator('.prediction-list button').nth(predictionIndex).click()
  if (useCard) {
    await page.locator('.card-choice').first().click()
    const targets = page.locator('.card-targets button')
    if (await targets.count() > 0) await targets.first().click()
  }
  await setRange(page.getByLabel('秘密下注'), bidUnits)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
}

async function runGame(page, playerCount, verifyPrivateRestore = false) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await assertNoHorizontalOverflow(page, '移动端首页')
  await page.getByRole('button', { name: '创建新对局' }).click()
  await setRange(page.locator('#player-count'), playerCount)
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await page.locator('#motion').selectOption('reduced')
  await assertNoHorizontalOverflow(page, `${playerCount} 人设置页`)
  if (playerCount === 10) await page.screenshot({ path: '.artifacts/setup-10-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /开始这局/ }).click()
  if (playerCount === 3) await page.screenshot({ path: '.artifacts/draw-machine-mobile.png', fullPage: true })
  await startRound(page)

  for (let index = 0; index < playerCount; index += 1) {
    await holdToEnter(page)
    if (index === 0) await assertNoHorizontalOverflow(page, `${playerCount} 人私密操作页`)
    if (verifyPrivateRestore && index === 0) {
      await page.reload()
      await page.getByRole('button', { name: /继续第 1 轮/ }).click()
      await page.getByText('请把设备交给', { exact: true }).waitFor()
      await holdToEnter(page)
    }
    await setRange(page.getByLabel('秘密下注'), index + 1)
    await page.getByRole('button', { name: '确认我的选择' }).click()
    await page.getByRole('button', { name: '确定提交' }).click()
  }

  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByText('本轮收益变化', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, `${playerCount} 人结算页`)
  await page.getByRole('button', { name: /查看最终排行榜/ }).click()
  await page.getByText('全局结束', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, `${playerCount} 人终局页`)
  const standings = page.locator('.podium-list article')
  if (await standings.count() !== playerCount) throw new Error(`${playerCount} 人局最终榜人数不正确。`)
}

async function runCardFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await page.locator('#motion').selectOption('reduced')
  await page.locator('#card-probability').fill('100')
  await page.getByRole('button', { name: /开始这局/ }).click()
  await startRound(page)
  await submitPrivateTurn(page, 2)
  await submitPrivateTurn(page, 10)
  await submitPrivateTurn(page, 0, 0)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await submitPrivateTurn(page, 2)
  await submitPrivateTurn(page, 4)
  await holdToEnter(page)
  await page.getByText(/你获得了/).waitFor()
  await page.screenshot({ path: '.artifacts/card-private-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '收下道具卡' }).click()
  await page.locator('.card-choice').first().click()
  const targets = page.locator('.card-targets button')
  if (await targets.count() > 0) await targets.first().click()
  await setRange(page.getByLabel('秘密下注'), 6)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByText('本轮道具影响', { exact: true }).waitFor()
  await page.getByText('当前余额领跑者', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '道具结算页')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' })
  await runGame(page, 3, true)
  await runGame(page, 6)
  await runGame(page, 10)
  await runCardFlow(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => localStorage.clear())
  await page.goto('http://127.0.0.1:5181')
  await page.screenshot({ path: '.artifacts/home-desktop.png', fullPage: true })
  console.log('冒烟测试通过：3、6、10 人对局、刷新隐私保护、道具私密发放与移动端页面均已验证。')
} finally {
  await browser?.close()
  server.kill()
}
