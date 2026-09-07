import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { runIconFlow } from './icon-smoke.mjs'
import { runSetupModalFlow } from './setup-modal-smoke.mjs'
import { runBotJointFlow } from './bot-joint-smoke.mjs'
import { runAvatarFlow } from './avatar-smoke.mjs'
import { runLotteryFlow } from './lottery-smoke.mjs'
import { runLedgerFlow } from './ledger-smoke.mjs'
import { runConnoisseurFlow } from './connoisseur-smoke.mjs'

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

async function enterPrivateTurn(page) {
  const button = page.getByRole('button', { name: '进入私密操作' })
  await button.click()
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

async function assertPlayerPickerLayout(page) {
  const problems = await page.locator('.target-picker-grid > button, .prediction-picker-grid > button, .spectator-takeover-picker__grid > button').evaluateAll(buttons => buttons.flatMap(button => {
    const avatar = button.querySelector('.avatar-art')
    const text = button.querySelector('strong')
    if (!avatar || !text) return []
    const a = avatar.getBoundingClientRect(), t = text.getBoundingClientRect(), b = button.getBoundingClientRect()
    if (!b.width || !b.height) return []
    return a.width > 64 || a.height > 64 || a.width < 20 || a.height < 20 || t.left < a.right || t.right > b.right + 1 || button.scrollWidth > button.clientWidth + 1
      ? [{ name: text.textContent, avatar: [a.width, a.height], textLeft: t.left, avatarRight: a.right }] : []
  }))
  assert.deepEqual(problems, [], '选人卡应有固定头像尺寸，文字不与头像重叠或横向溢出')
}

async function resetLocalGame(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('auction-battle-career')
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  })
}

async function runSetupLayoutFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByLabel('玩家 1 类型').selectOption('bot')
  await page.locator('.seat-field').first().locator('.setup-bot-picker').waitFor()
  const secondPlayer = page.getByRole('textbox', { name: '玩家 2 名字', exact: true })
  await secondPlayer.fill('阿青')
  await page.locator('.seat-field').nth(1).locator('.registered-player-create').click()
  await secondPlayer.fill('青')
  await page.locator('.seat-field').nth(1).locator('.registered-player-results button').filter({ hasText: '阿青' }).click()
  if (await secondPlayer.inputValue() !== '阿青') throw new Error('真人玩家搜索未能选择已登记姓名。')
  const thirdPlayer = page.getByRole('textbox', { name: '玩家 3 名字', exact: true })
  await page.getByRole('button', { name: '玩家 3 名字：打开玩家名册', exact: true }).click()
  const registry = page.getByRole('dialog', { name: '玩家名册', exact: true })
  await registry.waitFor()
  if (!await registry.getByRole('option').filter({ hasText: '阿青' }).isDisabled()) throw new Error('名册允许重复选择已入局真人。')
  if (!await page.locator('#root').evaluate((root) => root.inert)) throw new Error('名册弹窗没有锁定背景交互。')
  await assertNoHorizontalOverflow(page, '玩家名册弹窗')
  await page.screenshot({ path: '.artifacts/player-registry-mobile.png' })
  await page.keyboard.press('Escape')
  await registry.waitFor({ state: 'hidden' })
  await thirdPlayer.fill('阿青')
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.locator('.error-box').getByText('“阿青”已被重复选择，每位玩家一局只能加入一次', { exact: true }).waitFor()
  await thirdPlayer.fill('阿紫')
  await page.locator('.seat-field').nth(2).locator('.registered-player-create').click()
  await thirdPlayer.fill('')
  await page.getByRole('button', { name: '玩家 3 名字：打开玩家名册', exact: true }).click()
  await registry.getByRole('option').filter({ hasText: '阿紫' }).click()
  await registry.waitFor({ state: 'hidden' })
  if (await thirdPlayer.inputValue() !== '阿紫') throw new Error('名册选择未写入玩家输入框。')
  if (await page.locator('#root').evaluate((root) => root.inert)) throw new Error('关闭名册后背景仍被锁定。')
  await setRange(page.locator('#player-count'), 4)
  await page.locator('#rounds').fill('7')
  await assertNoHorizontalOverflow(page, '标准模式设置页')
  const standardControlsFit = await page.locator('.setup-roster-panel').evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect()
    return [...panel.querySelectorAll('input, select, button')].filter((element) => {
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }).every((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= panelRect.left - 1 && rect.right <= panelRect.right + 1
    })
  })
  if (!standardControlsFit) throw new Error('标准模式设置控件超出玩家卡片。')
  await page.screenshot({ path: '.artifacts/standard-setup-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '接力模式' }).click()
  if (await page.locator('#relay-player-count').inputValue() !== '3' || await page.locator('#rounds').inputValue() !== '5') throw new Error('接力模式错误继承了标准模式的人数或轮数。')
  const firstRelayPlayer = page.getByRole('textbox', { name: '接力玩家 1 操作者 1 名字', exact: true })
  await firstRelayPlayer.fill('阿青')
  await page.getByRole('button', { name: '接力玩家 2 操作者 1 名字：打开玩家名册', exact: true }).click()
  if (!await registry.getByRole('option').filter({ hasText: '阿青' }).isDisabled()) throw new Error('接力名册允许跨席位重复真人。')
  if (await registry.getByRole('option').filter({ hasText: '阿紫' }).isDisabled()) throw new Error('标准模式草稿占用了接力名册名额。')
  await registry.getByRole('option').filter({ hasText: '阿紫' }).click()
  await page.getByRole('textbox', { name: '接力玩家 3 操作者 1 名字', exact: true }).fill('阿青')
  await page.getByLabel('配置名称').fill('重复接力测试')
    await page.getByRole('button', { name: '另存配置' }).click()
  await page.locator('.error-box').getByText('“阿青”已被重复选择，每位玩家一局只能加入一次', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '接力玩家 3 操作者 1 名字', exact: true }).fill('')
  await setRange(page.locator('#relay-player-count'), 5)
  await page.locator('#rounds').fill('6')
  await page.locator('.relay-seat-card').first().getByRole('button', { name: /添加.*操作者/ }).click()
  await page.getByLabel(/操作者 2 类型/).first().selectOption('bot')
  await assertNoHorizontalOverflow(page, '接力模式设置页')
  const relayControlsFit = await page.locator('.relay-seat-card').first().evaluate((card) => {
    const cardRect = card.getBoundingClientRect()
    return [...card.querySelectorAll('input, select, button')].every((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1
    })
  })
  if (!relayControlsFit) throw new Error('接力模式设置控件超出玩家卡片。')
  await page.getByRole('button', { name: '标准模式' }).click()
  if (await page.locator('#player-count').inputValue() !== '4' || await page.locator('#rounds').inputValue() !== '7') throw new Error('切回标准模式后草稿被接力模式污染。')
  if (await secondPlayer.inputValue() !== '阿青') throw new Error('切换模式后标准玩家草稿丢失。')
  await page.getByRole('button', { name: '接力模式' }).click()
  if (await page.locator('#relay-player-count').inputValue() !== '5' || await page.locator('#rounds').inputValue() !== '6') throw new Error('切回接力模式后草稿未独立保留。')
  if (await page.locator('.relay-seat-card').first().locator('.relay-operator').count() !== 2) throw new Error('切换模式后接力操作者草稿丢失。')
  await page.screenshot({ path: '.artifacts/relay-setup-mobile.png', fullPage: true })
  for (const viewport of [{ width: 844, height: 390, label: '手机横屏' }, { width: 1024, height: 768, label: '平板' }, { width: 1366, height: 768, label: '桌面' }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await assertNoHorizontalOverflow(page, `${viewport.label}接力设置页`)
    if (viewport.width === 1366) await page.screenshot({ path: '.artifacts/relay-setup-desktop.png', fullPage: true })
  }
  await page.setViewportSize({ width: 360, height: 640 })
}

async function runMemberHallFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', { name: '玩家大厅' }).click()
  await page.getByRole('heading', { name: '玩家大厅' }).waitFor()
  await assertNoHorizontalOverflow(page, '玩家大厅移动端')
  await page.getByRole('button', { name: '注册玩家' }).click()
  const dialog = page.getByRole('dialog', { name: '注册玩家' })
  await dialog.getByPlaceholder('输入名称').fill('档案甲')
  await dialog.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByRole('button', { name: /档案甲/ }).first().click()
  await page.getByRole('heading', { name: '档案甲' }).waitFor()
  await page.getByRole('button', { name: '编辑资料' }).click()
  const edit = page.getByRole('dialog', { name: '编辑成员' })
  if (!await edit.evaluate(node => node.parentElement === document.body)) throw new Error('编辑头像弹窗必须顶层挂载')
  if (await edit.locator('.member-avatar-picker button').count() !== 30) throw new Error('预设头像数量不正确')
  await edit.getByRole('button', { name: '头像：飞船', exact: true }).click()
  await edit.getByRole('button', { name: '头像：灵猫', exact: true }).click()
  if (await edit.getByRole('button', { name: '头像：灵猫', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('头像选中状态未更新')
  await page.screenshot({ path: '.artifacts/member-avatar-picker.png', fullPage: true })
  await edit.getByLabel('名称').fill('档案乙')
  await edit.getByRole('button', { name: '保存' }).click()
  await page.getByRole('heading', { name: '档案乙' }).waitFor()
  await page.getByRole('button', { name: '返回玩家大厅' }).click()
  await page.getByRole('button', { name: '创建 Bot' }).click()
  const botDialog = page.getByRole('dialog', { name: '创建 Bot' })
  await botDialog.getByPlaceholder('输入名称').fill('档案机器人')
  await botDialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('button', { name: /档案机器人/ }).first().waitFor()
  await page.getByRole('button', { name: /档案机器人/ }).first().click()
  await page.getByRole('button', { name: '编辑资料' }).click()
  await page.getByRole('button', { name: '头像：机灵', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '玩家大厅', exact: true }).click()
  await page.getByRole('button', { name: /档案机器人/ }).first().click()
  await page.getByRole('button', { name: '编辑资料' }).click()
  if (await page.getByRole('button', { name: '头像：机灵', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Bot 头像刷新后丢失')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await assertNoHorizontalOverflow(page, '玩家大厅成员卡')
}

async function finishFinalReveal(page, expectedCount, waitForAnimation = false) {
  if (waitForAnimation) {
    await page.locator('.podium-list article').nth(expectedCount - 1).waitFor({ timeout: 8000 })
    return
  }
  const skip = page.getByRole('button', { name: '跳过揭晓' })
  if (await skip.count() > 0) await skip.click()
}

async function startRound(page) {
  await page.getByRole('button', { name: '启动抽奖机' }).click()
  await page.getByRole('button', { name: /开始传递/ }).waitFor()
  await page.getByRole('button', { name: /开始传递/ }).click()
}

async function disableIdentities(page) {
  const toggle = page.locator('.identity-setting-group input[type="checkbox"]').first()
  if (await toggle.isChecked()) await toggle.uncheck()
}

async function disableFirstRoundSystemAuction(page) {
  // 道具竞购现已并入下注页，首轮不再有独立的开关或传递流程。
  await page.evaluate(() => {})
}

async function finishAdvancedSettings(page, preserveNames = false) {
  const close = page.getByRole('button', { name: '完成高级设置' })
  if (await close.count() > 0) await close.click()
  const pickers = page.locator('.registered-player-picker:visible')
  for (let index = 0; index < await pickers.count(); index += 1) {
    const picker = pickers.nth(index)
    const input = picker.locator('input')
    // Do not inherit a previous flow's display name: it can be a registered
    // member that is already selected on another seat.  Each smoke flow owns
    // a fresh, unique roster and validates the same quick-register route.
    const name = preserveNames && (await input.inputValue()).trim() || `烟测玩家${index + 1}`
    await input.fill('')
    await input.fill(name)
    const register = picker.locator('.registered-player-create')
    const registered = picker.locator('[title="已登记"]')
    await register.or(registered).waitFor({ state: 'visible', timeout: 2500 })
    if (await register.isVisible()) await register.click()
    else if (!await registered.isVisible()) throw new Error(`无法登记 ${name}`)
  }
}

async function dismissPrivateNotices(page) {
  const shopLater = page.getByRole('button', { name: '稍后决定', exact: true })
  if (await shopLater.count()) await shopLater.click()
  while (await page.getByRole('button', { name: '知道了' }).count() > 0) {
    await page.getByRole('button', { name: '知道了' }).last().click()
  }
  while (await page.getByRole('button', { name: /收下道具卡|收下/ }).count() > 0) {
    await page.getByRole('button', { name: /收下道具卡|收下/ }).last().click()
  }
  // The merchant prompt is queued after mandatory receipts, not necessarily
  // present when this helper first entered the private page.
  if (await shopLater.count()) await shopLater.click()
}

async function choosePrediction(page, index = 0) {
  await page.getByTestId('prediction-picker').click()
  await assertPlayerPickerLayout(page)
  await page.locator('.prediction-picker-grid button').nth(index).click()
}

async function openBackpack(page) {
  if (await page.locator('.card-inventory').isVisible()) return
  await page.getByTestId('backpack-tool').click()
  await page.getByRole('heading', { name: '选择一张卡' }).waitFor()
}

async function openIdentityTool(page) {
  await page.getByTestId('identity-tool').click()
  await page.locator('.focus-sheet--identity').waitFor()
}

async function openAssetsTool(page) {
  await page.getByTestId('assets-tool').click()
  await page.getByRole('heading', { name: '我的收藏' }).waitFor()
}

async function finishAuction(page, playerCount) {
  await page.getByRole('button', { name: '开始秘密竞购' }).click()
  for (let index = 0; index < playerCount; index += 1) {
    await page.getByRole('button', { name: /报价/ }).click()
    await page.getByRole('button', { name: /跳过竞购|确认不报价/ }).click()
  }
}

async function chooseIdentities(page, playerCount) {
  for (let index = 0; index < playerCount; index += 1) {
    await page.getByRole('button', { name: '选择身份' }).click()
    await page.locator('.identity-choice-card').first().click()
    const targetPicker = page.locator('.identity-setup .target-picker-trigger')
    if (await targetPicker.count() > 0) {
      await targetPicker.click()
      await page.locator('.target-picker-grid button').first().click()
    }
    const cards = page.locator('.merchant-offer-list button')
    if (await cards.count() > 0) await cards.first().click()
    await page.getByRole('button', { name: /确认身份与准备/ }).click()
  }
  await page.getByRole('button', { name: '启动抽奖机' }).waitFor()
}

async function submitPrivateTurn(page, bidUnits, predictionIndex = null, useCard = false) {
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  if (predictionIndex !== null) await choosePrediction(page, predictionIndex)
  if (useCard) {
    await openBackpack(page)
    await page.locator('.card-choice').first().click()
    const targetConfirm = page.getByRole('button', { name: '确认并选择玩家' })
    if (await targetConfirm.count() > 0) {
      await targetConfirm.click()
      await page.locator('.target-picker-grid button').first().click()
    } else {
      const confirmUse = page.getByRole('button', { name: '确认使用' })
      if (await confirmUse.count() > 0) await confirmUse.click()
    }
    if (await page.getByText('你看到了底牌', { exact: true }).count() > 0) await page.getByRole('button', { name: '知道了' }).click()
  }
  await setRange(page.getByLabel('秘密下注'), bidUnits)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
}

async function runGame(page, playerCount, verifyPrivateRestore = false, motion = 'reduced') {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await assertNoHorizontalOverflow(page, '移动端首页')
  await page.getByRole('button', { name: '创建新对局' }).click()
  await setRange(page.locator('#player-count'), playerCount)
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption(motion)
  await finishAdvancedSettings(page)
  await assertNoHorizontalOverflow(page, `${playerCount} 人设置页`)
  if (playerCount === 10) await page.screenshot({ path: '.artifacts/setup-10-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /开始这局/ }).click()
  if (playerCount === 3) await page.screenshot({ path: '.artifacts/draw-machine-mobile.png', fullPage: true })
  await startRound(page)

  for (let index = 0; index < playerCount; index += 1) {
    await enterPrivateTurn(page)
    if (index === 0) {
      await assertNoHorizontalOverflow(page, `${playerCount} 人私密操作页`)
      await openIdentityTool(page)
      await page.getByRole('button', { name: '关闭身份技能' }).click()
      await page.getByTestId('identity-tool').waitFor()
    }
    if (verifyPrivateRestore && index === 0) {
      await page.reload()
      await page.getByRole('button', { name: /继续第 1 轮/ }).click()
      await page.getByText('请把设备交给', { exact: true }).waitFor()
      await enterPrivateTurn(page)
    }
    await setRange(page.getByLabel('秘密下注'), index + 1)
    await page.getByRole('button', { name: '确认提交' }).click()
    await page.getByRole('button', { name: '确定提交' }).click()
  }

  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByText('本轮收益变化', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, `${playerCount} 人结算页`)
  await page.getByRole('button', { name: /查看最终排行榜/ }).click()
  await page.getByText('全局结束', { exact: true }).waitFor()
  await finishFinalReveal(page, playerCount, motion !== 'reduced')
  await assertNoHorizontalOverflow(page, `${playerCount} 人终局页`)
  const standings = page.locator('.podium-list article')
  if (await standings.count() !== playerCount) throw new Error(`${playerCount} 人局最终榜人数不正确。`)
}

async function runTutorialFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: /新手引导/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await page.getByText('第 1 / 3 轮 · 只学下注', { exact: true }).waitFor()
  if (await page.getByTestId('prediction-picker').count() > 0) throw new Error('新手局第一轮不应开放预测')
  await assertNoHorizontalOverflow(page, '新手引导第一轮')
  await setRange(page.getByLabel('秘密下注'), 4)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await page.getByRole('button', { name: /进入私密操作/ }).waitFor()
  await enterPrivateTurn(page)
  await setRange(page.getByLabel('秘密下注'), 6)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await enterPrivateTurn(page)
  await setRange(page.getByLabel('秘密下注'), 8)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await page.getByText('第 2 / 3 轮 · 解锁预测', { exact: true }).waitFor()
  if (await page.getByTestId('prediction-picker').count() === 0) throw new Error('新手局第二轮应开放预测')
  await choosePrediction(page)
  await assertNoHorizontalOverflow(page, '新手引导预测页')
  await setRange(page.getByLabel('秘密下注'), 4)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await submitPrivateTurn(page, 6)
  await submitPrivateTurn(page, 8)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await page.getByText('第 3 / 3 轮 · 道具与主动身份', { exact: true }).waitFor()
  await openBackpack(page)
  await page.locator('.card-choice').filter({ hasText: '反客为主' }).click()
  await page.getByRole('button', { name: '确认使用' }).click()
  await openIdentityTool(page)
  await page.getByRole('button', { name: /花费 4 金币发动/ }).click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await page.getByTestId('identity-tool').locator('i').waitFor()
  await assertNoHorizontalOverflow(page, '新手引导道具与主动技能页')
}

async function runCardFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
  await page.locator('#card-probability').fill('100')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await startRound(page)
  await submitPrivateTurn(page, 2)
  await submitPrivateTurn(page, 10)
  await submitPrivateTurn(page, 0, 0)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await openAssetsTool(page)
  if (await page.locator('.private-asset-row').count() < 1) throw new Error('已拍下物品的玩家未看到自己的固定资产分类。')
  await assertNoHorizontalOverflow(page, '私密固定资产页')
  await setRange(page.getByLabel('秘密下注'), 2)
  await page.getByRole('button', { name: '关闭资产' }).click()
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await page.screenshot({ path: '.artifacts/private-command-mobile.png' })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.screenshot({ path: '.artifacts/private-command-landscape.png', fullPage: true })
  await page.locator('.asset-summary-strip').screenshot({ path: '.artifacts/asset-summary-landscape.png' })
  await page.setViewportSize({ width: 360, height: 640 })
  await openBackpack(page)
  await page.waitForTimeout(120)
  await page.screenshot({ path: '.artifacts/backpack-mobile.png' })
  const usableCards = page.locator('.card-choice:not([disabled])')
  if (await usableCards.count() > 0) await usableCards.first().click()
  const targetConfirm = page.getByRole('button', { name: '确认并选择玩家' })
  if (await targetConfirm.count() > 0) {
    await targetConfirm.click()
    const targetCards = page.locator('.target-picker-grid button')
    await assertPlayerPickerLayout(page)
    if (await targetCards.count() > 0) await targetCards.first().click()
  }
  const confirmUse = page.getByRole('button', { name: '确认使用' })
  const confirmReroll = page.getByRole('button', { name: /确认并抽取 (6|9) 张/ })
  const confirmFateCoin = page.getByRole('button', { name: '确认并掷硬币' })
  if (await confirmUse.count() > 0) await confirmUse.click()
  if (await confirmReroll.count() > 0) await confirmReroll.click()
  if (await confirmFateCoin.count() > 0) {
    await confirmFateCoin.click()
    await page.getByRole('button', { name: '知道了' }).click()
  }
  const rerollOptions = page.locator('.prize-reroll-option')
  if (await rerollOptions.count() > 0) {
    const expected = await page.getByRole('dialog', { name: '调包令选择' }).count() ? 9 : 6
    if (await rerollOptions.count() !== expected) throw new Error(`改拍道具应锁定展示 ${expected} 张候选拍品。`)
    await rerollOptions.first().click()
    await page.getByRole('button', { name: '确认使用', exact: true }).click()
  }
  if (await page.getByRole('button', { name: '关闭背包' }).count() > 0) await page.getByRole('button', { name: '关闭背包' }).click()
  await dismissPrivateNotices(page)
  await setRange(page.getByLabel('秘密下注'), 6)
  await page.getByRole('button', { name: '确认提交' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await submitPrivateTurn(page, 0)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  const bananaNotice = page.getByRole('button', { name: '知道了' })
  if (await bananaNotice.count() > 0) await bananaNotice.click()
  // 发到的卡可能是被动护盾或仅私密生效的偷看卡；无论是否产生公共道具影响，都必须能完成结算。
  await page.getByText('本轮收益变化', { exact: true }).waitFor()
  if (await page.getByText('当前余额领跑者', { exact: true }).count() !== 0) throw new Error('新默认设置不应公开余额领跑者。')
  await assertNoHorizontalOverflow(page, '道具结算页')
}

async function runStackedCardsFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', {name:'创建新对局'}).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', {name:/高级规则/}).click()
  await disableIdentities(page)
  await page.locator('#card-probability').fill('0')
  await finishAdvancedSettings(page)
  await page.getByRole('button', {name:/开始这局/}).click()
  await page.evaluate(() => {
    const key='who-is-raising:session:v1', session=JSON.parse(localStorage.getItem(key))
    session.players[0].cardInventory=['red','red','black','swap','swap','fateCoin','fateCoin','fateCoin']
    localStorage.setItem(key,JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button', {name:/继续第 1 轮/}).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  for (let i=0;i<2;i++) {
    await openBackpack(page)
    await page.locator('.card-choice').filter({hasText:'命运硬币'}).click()
    await page.getByRole('button',{name:'确认并掷硬币'}).click()
    await page.getByRole('button',{name:'知道了',exact:true}).click()
  }
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  if (before.pendingFateCoinUse.previousUses.length!==1 || before.players[0].cardInventory.filter(id=>id==='fateCoin').length!==1) throw new Error('硬币没有逐张消费并锁定')
  await page.reload()
  await page.getByRole('button',{name:/继续第 1 轮/}).click()
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  for (let i=0;i<2;i++) {
    await openBackpack(page)
    await page.locator('.card-choice').filter({hasText:/^红卡/}).click()
    await page.getByRole('button',{name:'确认使用',exact:true}).click()
  }
  await openBackpack(page)
  if (!await page.locator('.card-choice').filter({hasText:/^红卡/}).isDisabled()) throw new Error('红卡数量耗尽后仍能使用')
  await page.getByRole('button',{name:'撤销一张红卡'}).click()
  await page.locator('.card-choice').filter({hasText:/^红卡/}).click()
  await page.getByRole('button',{name:'确认使用',exact:true}).click()
  await page.getByRole('button',{name:'确认提交',exact:true}).click()
  await page.getByRole('button',{name:'确定提交',exact:true}).click()
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  if(after.turns[0].cardUses.filter(use=>use.cardId==='red').length!==2) throw new Error('两张红卡没有成功提交')
  if(after.turns[0].cardUses.filter(use=>use.cardId==='fateCoin').length!==2 || after.players[0].balanceUnits!==before.players[0].balanceUnits || after.players[0].cardInventory.filter(id=>id==='fateCoin').length!==1) throw new Error('刷新或提交重复结算/消耗了硬币')
  await submitPrivateTurn(page,2)
  await submitPrivateTurn(page,4)
  await page.getByRole('button',{name:'揭晓本轮结果'}).click()
  await page.getByText(/两张红卡生效/).waitFor()
}

async function runExpansionFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', {name:'创建新对局'}).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', {name:/高级规则/}).click()
  await disableIdentities(page)
  await page.locator('#card-probability').fill('0')
  await finishAdvancedSettings(page)
  await page.getByRole('button', {name:/开始这局/}).click()
  await page.evaluate(() => {
    const key='who-is-raising:session:v1', session=JSON.parse(localStorage.getItem(key))
    const identity=(id)=>({id,thiefSuccesses:0,lobbyistNextFree:false,lobbyistLastIssuedRound:-1})
    session.players[0].identity=identity('connoisseur')
    session.players[0].cardInventory=['triumphRebate','triumphRebate','predictionPolicy']
    session.players[2].identity=identity('insurer')
    session.players[2].cardInventory=['predictionPolicy']
    session.settings.systemAuctionCardsPerRound=0
    session.settings.rewardMultipliers=[2,1]
    localStorage.setItem(key,JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button',{name:/继续第 1 轮/}).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await setRange(page.locator('.range--bid'), 18)
  for (const card of ['凯旋礼金','凯旋礼金','失算保单']) {
    await openBackpack(page)
    const choice=page.locator('.card-choice').filter({hasText:card})
    await choice.locator('img').evaluate(image=>image.decode())
    await choice.click()
    await page.getByRole('button',{name:'确认使用',exact:true}).click()
  }
  await openBackpack(page)
  await page.getByRole('button',{name:'撤销一张失算保单'}).click()
  await page.getByRole('button',{name:'关闭背包'}).click()
  await page.getByRole('button',{name:'确认提交',exact:true}).click()
  await page.getByRole('button',{name:'确定提交',exact:true}).click()
  await submitPrivateTurn(page,4)
  await submitPrivateTurn(page,2,1,true)
  await page.getByRole('button',{name:'揭晓本轮结果'}).click()
  await page.getByText(/两张凯旋礼金生效/).waitFor()
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  if(saved.results[0].deltas[0].cardUnits!==12) throw new Error('两张凯旋礼金未按实际下注逐张返还')
  if(saved.players[0].identity.connoisseurItemKeys.length!==1 || saved.players[0].identity.connoisseurCategories.length!==1) throw new Error('鉴赏家奖励未持久化')
  if(!saved.pendingIdentityNotices.some(notice=>notice.title==='鉴赏家收藏奖励' && notice.detail.includes('获得'))) throw new Error('缺少鉴赏家具体道具奖励通知')
  if(saved.results[0].deltas[2].identityUnits!==2) throw new Error('保险师落榜全额退款未进入实际结算')
  if(!saved.results[0].cardEffects.some(effect=>effect.cardId==='predictionPolicy')) throw new Error('保单猜错减免未进入实际结算')
  await page.screenshot({path:'.artifacts/expansion-settlement-360.png',fullPage:true})
  await page.reload()
  const restored=await page.evaluate(async()=>{ const { loadSession }=await import('/src/game/storage.ts'); return loadSession() })
  // Normalize undefined optional properties introduced by migration, not the
  // reward arrays or balances; comparison still uses the actual loaded state.
  assert.deepEqual(JSON.parse(JSON.stringify(restored.players)), saved.players, '刷新改变了新身份余额或奖励记录')
}

async function runPresetFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '6 人真人局' }).click()

  if (await page.locator('#player-count').inputValue() !== '6' || await page.locator('#rounds').inputValue() !== '8') throw new Error('系统预设未正确载入。')
  await finishAdvancedSettings(page, true)
  await page.getByLabel('配置名称').fill('冒烟六人局')
  await page.getByRole('button', { name: '另存配置' }).click()
  await page.waitForTimeout(150)
  if (await page.getByText('我的标准配置', { exact: true }).count() === 0) throw new Error(`标准配置保存失败：${await page.locator('.error-box').textContent()}`)
  await page.locator('.preset-choice--saved > button').first().click()
  if (await page.locator('#player-count').inputValue() !== '6') throw new Error('已保存配置未正确重新载入。')
  await page.getByRole('button', { name: '接力模式' }).click()
  if (await page.getByText('冒烟六人局', { exact: true }).count() !== 0) throw new Error('标准配置错误显示在接力配置库中。')
  await finishAdvancedSettings(page)
  await page.getByLabel('配置名称').fill('冒烟接力局')
  await page.getByRole('button', { name: '另存配置' }).click()
  await page.waitForTimeout(150)
  if (await page.getByText('我的接力配置', { exact: true }).count() === 0) throw new Error(`接力配置保存失败：${await page.locator('.error-box').textContent()}`)
  if (await page.getByText('冒烟六人局', { exact: true }).count() !== 0) throw new Error('接力配置库混入了标准配置。')
  await page.getByRole('button', { name: '标准模式' }).click()
  await page.getByText('冒烟六人局', { exact: true }).waitFor()
  if (await page.getByText('冒烟接力局', { exact: true }).count() !== 0) throw new Error('标准配置库混入了接力配置。')
  await page.evaluate(async () => {
    localStorage.removeItem('auction-battle:registered-players:v1')
    // Leave only the presets: restoration must not accidentally depend on an
    // already populated permanent registry from the previous steps.
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('auction-battle-career')
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('测试档案库仍被占用'))
    })
  })
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '玩家 1 名字：打开玩家名册', exact: true }).click()
  const migratedPlayer = page.getByRole('dialog', { name: '玩家名册', exact: true }).getByRole('option').filter({ hasText: '烟测玩家1' })
  await migratedPlayer.waitFor()
  if (await migratedPlayer.locator('.avatar-art').count() !== 1) throw new Error('真人名册缺少头像')
  const registeredAvatarPath = await migratedPlayer.locator('path').getAttribute('d')
  await migratedPlayer.click()
  const humanPicker = page.locator('.registered-player-picker').first()
  if (await humanPicker.locator('.registered-player-avatar path').getAttribute('d') !== registeredAvatarPath) throw new Error('选人输入框与档案头像不一致')
  await humanPicker.locator('input').focus()
  if (await humanPicker.getByRole('option').first().locator('.avatar-art').count() !== 1) throw new Error('真人搜索结果缺少头像')
  await page.getByRole('heading', { name: '设置玩家', exact: true }).click()
  if (await page.getByRole('textbox', { name: '玩家 1 名字', exact: true }).inputValue() !== '烟测玩家1') throw new Error('旧配置中的真人姓名未自动迁移到玩家名册。')
  await page.getByRole('button', { name: '删除冒烟六人局' }).click()
  if (await page.getByText('冒烟六人局', { exact: true }).count() !== 0) throw new Error('已保存配置未被删除。')
  await page.getByRole('button', { name: '接力模式' }).click()
  await page.getByText('冒烟接力局', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '配置预设页')
}

async function runIdentityFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableFirstRoundSystemAuction(page)
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await chooseIdentities(page, 3)
  await assertNoHorizontalOverflow(page, '身份选角后的首轮页')
  await startRound(page)
  for (let index = 0; index < 3; index += 1) await submitPrivateTurn(page, index + 1)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /查看最终排行榜/ }).click()
  await finishFinalReveal(page)
  await page.getByText('逐轮复盘', { exact: true }).waitFor()
  await page.getByText('身份公开', { exact: true }).waitFor()
  for (const viewport of [{width:360,height:640},{width:844,height:390},{width:1366,height:900}]) {
    await page.setViewportSize(viewport)
    const errors = await page.evaluate(() => {
      const failures = []
      document.querySelectorAll('.identity-final article').forEach(row => {
        const icon = row.querySelector('.game-art-slot')?.getBoundingClientRect()
        const text = row.querySelector('div')?.getBoundingClientRect()
        if (icon && text && icon.right > text.left) failures.push('身份文字与图标重叠')
      })
      document.querySelectorAll('.avatar-art').forEach(svg => {
        const a = svg.getBoundingClientRect(), b = svg.parentElement.getBoundingClientRect()
        if (a.width && b.width && (Math.abs(a.left+a.width/2-b.left-b.width/2)>2 || Math.abs(a.top+a.height/2-b.top-b.height/2)>2)) failures.push('头像未居中')
      })
      return failures
    })
    if (errors.length) throw new Error(`${viewport.width}px: ${errors.join('、')}`)
    await assertNoHorizontalOverflow(page, '身份复盘')
    await page.locator('.identity-final').screenshot({path:`.artifacts/identity-recap-${viewport.width}.png`})
  }
}

async function runLobbyistTaskFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.evaluate(() => {
    const raw = localStorage.getItem('who-is-raising:session:v1')
    if (!raw) throw new Error('未找到说客测试对局')
    const session = JSON.parse(raw)
    session.players[0].identity = { id: 'lobbyist', thiefSuccesses: 0, merchantAuctionUsed: false, lobbyistNextFree: false, lobbyistLastIssuedRound: null }
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button', { name: /继续第 1 轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await openIdentityTool(page)
  await page.getByRole('button', { name: '发动技能', exact: true }).click()
  await page.getByText('选择发布方式', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '说客发布方式选择')
  await page.getByRole('button', { name: /随机发布/ }).click()
  await page.getByText(/随机任务；基础费用 0 金币/).waitFor()
  await assertPlayerPickerLayout(page)
  await page.locator('.target-picker-grid button').first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await openIdentityTool(page)
  await page.getByRole('button', { name: /已安排：随机任务/ }).waitFor()
  await page.getByRole('button', { name: /已安排：随机任务/ }).click()
  await page.getByRole('button', { name: '发动技能', exact: true }).click()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByText('选择指定任务', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '说客指定任务选择')
  await page.getByRole('button', { name: '返回发布方式' }).click()
  await page.getByText('选择发布方式', { exact: true }).waitFor()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByRole('button', { name: /获得第二名/ }).click()
  await page.getByText('选择任务对象', { exact: true }).waitFor()
  await assertPlayerPickerLayout(page)
  await page.locator('.target-picker-grid button').first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await openIdentityTool(page)
  await page.getByRole('button', { name: /已安排：获得第二名/ }).waitFor()
  await page.getByRole('button', { name: /已安排：获得第二名/ }).click()
  await page.getByRole('button', { name: '发动技能', exact: true }).click()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByRole('button', { name: /下注高于某人/ }).click()
  await page.locator('.target-picker-grid button').first().click()
  await page.getByText('选择比较对象', { exact: true }).waitFor()
  const comparisonCards = page.locator('.target-picker-grid button')
  await assertPlayerPickerLayout(page)
  if (await comparisonCards.count() < 2) throw new Error('说客的比较对象应包含说客本人和其他非任务对象玩家。')
  await comparisonCards.first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await openIdentityTool(page)
  await page.getByRole('button', { name: /已安排：下注高于某人/ }).waitFor()
  await assertNoHorizontalOverflow(page, '说客任务卡与人物卡流程')
}

async function runAssetFinalFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => {
    localStorage.clear()
    const leisureItems = ['垃圾', '泡面', '可乐'].map((name, index) => ({ item: { id: `asset-${index}`, name, value: 4, emoji: '🎁', tone: '#000', category: 'leisure' }, roundIndex: index }))
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify({
      version: 3, id: 'asset-smoke', phase: 'finalResult', settings: { playerCount: 3, rounds: 3, initialCoins: 30, rewardMultipliers: [2, 1], correctPredictionMultiplier: 1, wrongPredictionMultiplier: 1.5, revealBids: false, revealBalanceLeader: false, cardGrantProbability: 80, disabledCardIds: [], animationSpeed: 'reduced' },
      players: [
        { id: 'p1', name: '收藏家', color: '#b65f55', balanceUnits: 44, items: leisureItems, cardInventory: [] },
        { id: 'p2', name: '现金王', color: '#557f74', balanceUnits: 50, items: [], cardInventory: [] },
        { id: 'p3', name: '玩家三', color: '#687c9b', balanceUnits: 30, items: [], cardInventory: [] },
      ],
      itemDeck: [], cardDeck: [], pendingCardGrants: [], cardRulesStartRound: 1, fairnessOrderIds: ['p1', 'p2', 'p3'], roundIndex: 2, currentTurnIndex: 0, turns: [], results: [], createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
    }))
  })
  await page.reload()
  await page.getByRole('button', { name: '查看上局结果' }).click()
  await page.getByText('总资产', { exact: true }).first().waitFor()
  await page.getByText(/生活娱乐 3 件 \+28/).waitFor()
  await page.screenshot({ path: '.artifacts/final-assets-mobile.png', fullPage: true })
  await assertNoHorizontalOverflow(page, '固定资产终局页')
}

async function runBotSpectatorFlow(page, playerCount = 3, inspectControls = true) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await setRange(page.locator('#player-count'), playerCount)
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await page.locator('#motion').selectOption(inspectControls ? 'full' : 'reduced')
  for (let index = 1; index <= playerCount; index += 1) await page.getByLabel(`玩家 ${index} 类型`).selectOption('bot')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.locator('.spectator-controls').waitFor({ timeout: 8000 })
  await page.getByLabel('观战速度').selectOption('4')
  if (inspectControls) {
    await page.getByRole('button', { name: /暂停/ }).click()
    await page.getByRole('button', { name: /单步/ }).click()
    const spectatorEvent = page.locator('[data-testid="spectator-event"]')
    await spectatorEvent.waitFor({ timeout: 8000 })
    const eventContrast = await spectatorEvent.locator('article').evaluate((card) => {
      const title = card.querySelector('h1')
      return {
        cardOpacity: Number.parseFloat(getComputedStyle(card).opacity),
        titleOpacity: title ? Number.parseFloat(getComputedStyle(title).opacity) : 0,
        titleColor: title ? getComputedStyle(title).color : '',
      }
    })
    if (eventContrast.cardOpacity < 0.99 || eventContrast.titleOpacity < 0.99 || eventContrast.titleColor === 'rgb(255, 255, 255)') {
      throw new Error(`观战事件卡文字对比度异常：${JSON.stringify(eventContrast)}`)
    }
    await page.setViewportSize({ width: 360, height: 640 })
    await page.getByRole('button', { name: '▦ 数据' }).click()
    await page.getByText('实时数据中心', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭数据面板' }).click()
    await page.getByRole('button', { name: /继续/ }).click()
  }
  await page.getByRole('button', { name: /继续/ }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /继续/ }).click()
  await page.getByText('全局结束', { exact: true }).waitFor({ timeout: 30000 })
  await page.getByText('Bot 档案', { exact: true }).waitFor()
  await page.getByText('逐轮复盘', { exact: true }).waitFor()
  await page.getByText('本局名场面 · 5 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '原班再来一局' }).waitFor()
  await page.getByRole('button', { name: /复仇局/ }).waitFor()
  await assertNoHorizontalOverflow(page, `${playerCount} 人全 Bot 观战终局页`)
}

async function runSpectatorTakeoverFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await resetLocalGame(page)
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await setRange(page.locator('#player-count'), 3)
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await page.locator('#motion').selectOption('reduced')
  for (let index = 1; index <= 3; index += 1) await page.getByLabel(`玩家 ${index} 类型`).selectOption('bot')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.locator('.spectator-controls').waitFor({ timeout: 8000 })
  await page.getByLabel('观战速度').selectOption('4')
  await page.getByRole('button', { name: '接管下一轮' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '接管下一轮' }).click()
  const picker = page.locator('.spectator-takeover-picker')
  await picker.waitFor()
  for (const [width, height] of [[360, 640], [844, 390], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await assertPlayerPickerLayout(page)
    const names = picker.locator('.target-picker-grid strong')
    const originals = await names.allTextContents()
    await names.evaluateAll(nodes => nodes.forEach(node => { node.textContent = '二十字超长玩家名称用于检验头像文字换行排版' }))
    await assertPlayerPickerLayout(page)
    await names.evaluateAll((nodes, values) => nodes.forEach((node, index) => { node.textContent = values[index] }), originals)
    await assertNoHorizontalOverflow(page, '接管玩家弹窗')
    const footer = await picker.locator('.spectator-takeover-picker__footer').boundingBox()
    assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= height, '接管确认按钮必须始终留在视口内')
    await page.screenshot({ path: `.artifacts/takeover-picker-${width}.png` })
  }
  await page.setViewportSize({ width: 360, height: 640 })
  await picker.locator('.spectator-takeover-picker__grid button').first().click()
  assert.equal(await picker.locator('.spectator-takeover-picker__grid button').first().getAttribute('aria-pressed'), 'true')
  await picker.getByRole('button', { name: '开始接管下一轮' }).click()
  await page.getByRole('button', { name: '启动抽奖机' }).waitFor({ timeout: 10000 })
  if (await page.locator('.spectator-controls').count()) throw new Error('接管下一轮后不应继续显示观战控制')
}

async function runBalanceRevealFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  const balance = page.getByRole('button', { name: '查看余额' })
  await balance.click()
  await page.getByText('当前余额', { exact: true }).waitFor()
  await page.screenshot({ path: '.artifacts/balance-flip-mobile.png' })
  await page.getByRole('button', { name: '隐藏余额' }).click()
  await page.getByText('点击翻牌', { exact: true }).waitFor()
}

async function runSystemAuctionFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await page.getByRole('dialog').getByText('本轮道具竞购', { exact: true }).waitFor()
  await page.getByRole('button', { name: '知道了' }).click()
  await page.getByRole('region', { name: '本轮市场' }).waitFor()
  if (await page.locator('.round-auction-card').count() < 1) throw new Error('系统竞购应在下注页提供至少一张道具卡')
  await assertNoHorizontalOverflow(page, '首轮系统竞购下注页')
}

async function runFirstPlayerBananaFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.getByRole('button', { name: '启动抽奖机' }).waitFor()
  await page.evaluate(() => {
    const raw = localStorage.getItem('who-is-raising:session:v1')
    if (!raw) throw new Error('未找到待测对局存档')
    const session = JSON.parse(raw)
    session.players[0].cardInventory = ['bananaPeel']
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button', { name: /继续第 1 轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await openBackpack(page)
  const banana = page.locator('.card-choice').filter({ hasText: '香蕉皮' })
  if (await banana.isDisabled()) throw new Error('第一位玩家持有香蕉皮时不应被禁用')
  await banana.click()
  await page.getByRole('button', { name: '确认并选择玩家' }).click()
  if (await page.locator('.target-picker-grid button').count() !== 2) throw new Error('香蕉皮应允许第一位玩家选择全部两名其他玩家')
  await assertNoHorizontalOverflow(page, '首位香蕉皮目标选择')
  await assertPlayerPickerLayout(page)
}

async function runTurnTimeoutFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  const timerToggle = page.getByRole('checkbox', { name: /启用操作倒计时/ })
  if (!await timerToggle.isChecked()) await timerToggle.check()
  await page.locator('#turn-time-limit').fill('5')
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await page.getByText('本次操作剩余', { exact: true }).waitFor()
  await page.waitForTimeout(5600)
  await page.getByText('请把设备交给', { exact: true }).waitFor()
  const firstTurn = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')).turns[0])
  if (!firstTurn || firstTurn.bidUnits !== 0 || firstTurn.predictedPlayerId !== null) throw new Error('超时应按当前已确认的默认选择自动提交')
}

async function runPrizeRerollFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.evaluate(() => {
    const raw = localStorage.getItem('who-is-raising:session:v1')
    if (!raw) throw new Error('未找到改拍令测试对局')
    const session = JSON.parse(raw)
    session.players[0].cardInventory = ['prizeReroll']
    localStorage.setItem('who-is-raising:session:v1', JSON.stringify(session))
  })
  await page.reload()
  await page.getByRole('button', { name: /继续第 1 轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await dismissPrivateNotices(page)
  await openBackpack(page)
  await page.locator('.card-choice').filter({ hasText: '改拍令' }).click()
  await page.getByRole('button', { name: '确认并抽取 6 张' }).waitFor()
  if (await page.locator('.prize-reroll-option').count() !== 0) throw new Error('改拍令确认前不应抽出候选拍品')
  await page.getByRole('button', { name: '确认并抽取 6 张' }).click()
  const offers = page.locator('.prize-reroll-option')
  await offers.first().waitFor()
  if (await offers.count() !== 6) throw new Error('改拍令确认后应展示 6 张候选拍品')
  await offers.first().click()
  await page.getByRole('button', { name: '确认使用' }).waitFor()
  if (await page.getByRole('button', { name: '确认使用' }).isDisabled()) throw new Error('改拍令选中拍品后应允许确认使用')
  await assertNoHorizontalOverflow(page, '改拍令六张候选页')
}

async function runRelayDragFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '接力模式' }).click()
  const cards = page.locator('.relay-seat-card')
  await cards.first().getByRole('button', { name: /添加.*操作者/ }).click()
  await cards.first().getByRole('textbox', { name: /操作者 1 名字/ }).fill('甲')
  await cards.first().locator('.registered-player-create').click()
  await cards.first().getByRole('textbox', { name: /操作者 2 名字/ }).fill('乙')
  await cards.first().locator('.registered-player-create').click()
  await cards.nth(1).getByRole('textbox', { name: /操作者 1 名字/ }).fill('丙')
  await cards.nth(1).locator('.registered-player-create').click()
  const ids = await cards.first().locator('[data-relay-operator]').evaluateAll((rows) => rows.map((row) => row.dataset.relayOperator))
  const drag = async (id, target, edge = 'after', cancel = false) => {
    const handle = page.locator(`[data-relay-operator="${id}"] .relay-operator__order`)
    await handle.scrollIntoViewIfNeeded()
    const sourceBox = await handle.boundingBox()
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.locator('.relay-drag-ghost').waitFor()
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, edge === 'before' ? box.y + 3 : box.y + box.height - 3, { steps: 5 })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.locator('.relay-drag-ghost').waitFor({ state: 'hidden' })
  }
  await drag(ids[0], page.locator(`[data-relay-operator="${ids[1]}"]`))
  if (await cards.first().locator('[data-relay-operator]').first().getAttribute('data-relay-operator') !== ids[1]) throw new Error('长按拖动未改变棒次。')
  await drag(ids[0], cards.nth(1).locator('.relay-add-operator'))
  if (await cards.nth(1).locator(`[data-relay-operator="${ids[0]}"]`).count() !== 1 || await cards.first().locator(`[data-relay-operator="${ids[0]}"]`).count()) throw new Error('跨玩家拖动没有移动操作者。')
  await drag(ids[1], cards.nth(1).locator('.relay-add-operator'), 'after', true)
  if (await cards.first().locator(`[data-relay-operator="${ids[1]}"]`).count() !== 1) throw new Error('取消拖动改变了阵容。')
  await drag(ids[1], cards.nth(1).locator('.relay-add-operator'))
  await cards.first().getByText('拖入或添加一位操作者', { exact: true }).waitFor()
  await drag(ids[1], cards.first().locator('.relay-add-operator'))
  await cards.first().getByLabel('乙 类型').selectOption('bot')
  await cards.first().getByRole('button', { name: /Bot 性格$/ }).click()
  const chooser = page.getByRole('dialog', { name: '选择 Bot', exact: true })
  await chooser.getByRole('option').filter({ hasText: '馆长' }).click()
  await cards.first().getByLabel('馆长 Bot 难度').selectOption('expert')
  for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport)
    await assertNoHorizontalOverflow(page, '接力拖动单行布局')
    const aligned = await cards.first().locator('.relay-operator').evaluate((row) => {
      const fields = [...row.querySelectorAll('.relay-operator__identity, .relay-operator__kind, .relay-operator__difficulty')].map((el) => el.getBoundingClientRect())
      return fields.every((rect) => Math.abs(rect.top - fields[0].top) < 3 && rect.width > 35)
    })
    if (!aligned) throw new Error('Bot 名称、控制方式与难度未保持单行。')
    await cards.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.artifacts/relay-compact-${viewport.width}.png` })
  }
  await page.setViewportSize({ width: 360, height: 640 })
  await cards.first().getByRole('button', { name: '馆长 Bot 性格', exact: true }).click()
  await chooser.waitFor()
  await page.screenshot({ path: '.artifacts/bot-picker-mobile.png' })
  await page.keyboard.press('Escape')
  await finishAdvancedSettings(page, true)
  await page.getByLabel('配置名称').fill('拖动后的接力')
  await page.getByRole('button', { name: '另存配置' }).click()
  await page.getByRole('button', { name: '拖动后的接力', exact: false }).first().waitFor()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:presets:v1')).presets.at(-1))
  // Dropping over the header now inserts before the existing operators.
  if (saved.relaySeats[0].operators[0].controller.difficulty !== 'expert' || saved.relaySeats[1].operators.map((o) => o.name).join(',') !== '甲,丙') throw new Error(`拖动或 Bot 修改未保存到配置：${JSON.stringify(saved.relaySeats)}`)
  // Dispatch real touch input so touch-action, long-press and pointer capture are exercised.
  await cards.nth(1).locator('.relay-operator-list').scrollIntoViewIfNeeded()
  const touchRows = cards.nth(1).locator('[data-relay-operator]')
  const touchFirstId = await touchRows.first().getAttribute('data-relay-operator')
  const touchHandle = await touchRows.first().locator('.relay-operator__order').boundingBox()
  const touchTarget = await touchRows.last().boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const point = { x: touchHandle.x + touchHandle.width / 2, y: touchHandle.y + touchHandle.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  if (await page.locator('.relay-drag-ghost').count()) throw new Error('短按误触发拖动。')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.locator('.relay-drag-ghost').waitFor()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTarget.x + touchTarget.width / 2, y: touchTarget.y + touchTarget.height - 3 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.locator('.relay-drag-ghost').waitFor({ state: 'hidden' })
  if (await touchRows.last().getAttribute('data-relay-operator') !== touchFirstId) throw new Error('手机触摸长按拖动未生效。')
  await cdp.detach()
}

async function runRelaySetupFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '接力模式' }).click()
  await page.getByRole('textbox', { name: '接力玩家 1 名字', exact: true }).fill('甲队')
  await page.getByRole('textbox', { name: '甲队 操作者 1 名字', exact: true }).fill('甲一')
  await page.locator('.relay-seat-card').first().getByRole('button', { name: /添加.*操作者/ }).click()
  await page.getByRole('textbox', { name: '甲队 操作者 2 名字', exact: true }).fill('甲二')
  await page.getByLabel('甲二 类型').selectOption('bot')
  await page.getByRole('button', { name: '分段接力' }).click()
  await page.getByRole('button', { name: /高级规则/ }).click()
  await disableIdentities(page)
  await page.locator('#motion').selectOption('reduced')
  await finishAdvancedSettings(page)
  for (const [width, height] of [[360, 640], [844, 390], [1366, 900]]) {
    await page.setViewportSize({ width, height })
    await page.locator('.relay-operator').last().locator('select').first().focus()
    const startButton = page.getByRole('button', { name: /开始这局/ })
    await startButton.scrollIntoViewIfNeeded()
    if (!await startButton.evaluate((button) => {
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    })) throw new Error(`接力开始按钮在 ${width}px 被焦点卡片遮挡`)
    await assertNoHorizontalOverflow(page, `接力设置 ${width}px`)
    if (width === 360) {
      const singleSeat = page.locator('.relay-seat-card').nth(1)
      const bounds = await singleSeat.boundingBox()
      if (!bounds || bounds.height > 210) throw new Error(`手机单操作者席位过高：${bounds?.height}px`)
      const addSize = await singleSeat.getByRole('button', { name: '添加下一位操作者' }).boundingBox()
      if (!addSize || addSize.width < 44 || addSize.height < 44) throw new Error('添加操作者触摸区域不足')
      console.log(`360px 单操作者席位高度：${Math.round(bounds.height)}px`)
    }
    await page.screenshot({ path: `.artifacts/relay-start-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: /开始这局/ }).click()
  const relaySession = await page.evaluate(() => JSON.parse(localStorage.getItem('who-is-raising:session:v1')))
  if (relaySession.mode !== 'relay' || relaySession.relayMethod !== 'segments') throw new Error('接力模式设置未写入会话')
  if (relaySession.players[0].relayOperators.length !== 2 || relaySession.players[0].relayOperators[1].controller.kind !== 'bot') throw new Error('接力操作者配置未完整保存')
  if (await page.locator('.spectator-controls').count() > 0) throw new Error('混合接力局不应进入全 Bot 观战')
  await startRound(page)
  await page.getByText('本回合替', { exact: false }).waitFor()
  await page.getByText('甲队', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '接力模式传递页')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true })
  // Disposable context: fixtures only clear storage created by this test run.
  // Never attach to a user's browser or pass a persistent profile directory.
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error(`浏览器运行错误：${error.message}`))
  if (process.env.SMOKE_ONLY !== 'lottery') await page.addLocatorHandler(page.getByRole('dialog', { name: '幸运开奖', exact: true }), async dialog => { const skip = dialog.getByRole('button', { name: '跳过开奖动画' }); if (await skip.isVisible()) await skip.click(); await dialog.getByRole('button', { name: '收起开奖结果' }).click() })
  if (process.env.SMOKE_ONLY === 'ledger') {
    await runLedgerFlow(page)
  } else if (process.env.SMOKE_ONLY === 'lottery') {
    await runLotteryFlow(page)
    await runBotJointFlow(page)
  } else if (process.env.SMOKE_ONLY === 'connoisseur') {
    await runConnoisseurFlow(page)
    await runExpansionFlow(page)
    await runBotJointFlow(page, true)
    console.log('鉴赏家四档、刷新、终局领取、保险师全额退款及 Bot 流程通过。')
  } else if (process.env.SMOKE_ONLY === 'player-pickers') {
    await runSpectatorTakeoverFlow(page)
    console.log('接管选人布局专项通过。')
  } else if (process.env.SMOKE_ONLY === 'avatars') {
    await runAvatarFlow(page)
    console.log('30 款预设头像、手绘触摸/鼠标、撤销清空、取消、保存刷新和档案备份恢复通过。')
  } else if (process.env.SMOKE_ONLY === 'expansion') {
    await runIconFlow(page)
    await page.setViewportSize({width:360,height:640})
    await runExpansionFlow(page)
    await runBotJointFlow(page, true)
    console.log('新增身份、道具、图标、逐张使用、结算奖励及刷新专项通过。')
  } else if (process.env.SMOKE_ONLY === 'stacked-cards') {
    await runStackedCardsFlow(page)
    console.log('同玩家双红卡、多硬币、逐张撤销、刷新及实际提交结算通过。')
  } else if (process.env.SMOKE_ONLY === 'bot-joint') {
    await runBotJointFlow(page)
    console.log('3/6/10 人三轮联合 Bot 对局、市场与刷新恢复通过。')
  } else if (process.env.SMOKE_ONLY === 'setup-modal') {
    await runSetupModalFlow(page)
    console.log('高级规则弹窗层级、背景隔离、滚动、焦点与关闭恢复冒烟通过。')
  } else if (process.env.SMOKE_ONLY === 'icons') {
    await runIconFlow(page)
    await runCardFlow(page)
    await runIdentityFlow(page)
    await runSystemAuctionFlow(page)
    console.log('图标资源、透明背景、明暗底衬、移动端布局与身份／道具／竞购冒烟通过。')
  } else if (process.env.SMOKE_ONLY === 'relay-drag') {
    await runRelayDragFlow(page)
    console.log('接力长按拖动、跨席位移动、Bot 单行选择与配置保存冒烟通过。')
  } else if (process.env.SMOKE_ONLY === 'members') {
    await runMemberHallFlow(page)
    console.log('玩家大厅成员注册与资料编辑冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'setup') {
    await runSetupLayoutFlow(page)
    console.log('标准与接力模式设置页移动端布局冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'preset') {
    await runPresetFlow(page)
    console.log('标准与接力配置库隔离冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'relay') {
    await runRelaySetupFlow(page)
    console.log('接力模式建局与操作者交接冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'lobbyist') {
    await runLobbyistTaskFlow(page)
    console.log('说客任务流程冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'bot') {
    await runBotSpectatorFlow(page, 3, true)
    await runBotSpectatorFlow(page, 6, false)
    await runBotSpectatorFlow(page, 10, false)
    await runSpectatorTakeoverFlow(page)
    console.log('3/6/10 人全 Bot 观战流程冒烟测试通过。')
  } else if (process.env.SMOKE_ONLY === 'balance') {
    await runBalanceRevealFlow(page)
    console.log('余额翻牌流程冒烟测试通过。')
  } else {
    await runMemberHallFlow(page)
    await page.reload()
    await runAvatarFlow(page)
    await runSpectatorTakeoverFlow(page)
    await runSetupLayoutFlow(page)
    await runGame(page, 3, true)
    await runGame(page, 6, false, 'fast')
    await runGame(page, 10)
    await runCardFlow(page)
    await runSystemAuctionFlow(page)
    await runFirstPlayerBananaFlow(page)
    await runTurnTimeoutFlow(page)
    await runPrizeRerollFlow(page)
    await runRelaySetupFlow(page)
    await runPresetFlow(page)
    await runIdentityFlow(page)
    await runLobbyistTaskFlow(page)
    await runAssetFinalFlow(page)
    await runBalanceRevealFlow(page)
    await runBotSpectatorFlow(page, 3, true)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => localStorage.clear())
    await page.goto('http://127.0.0.1:5181')
    await page.screenshot({ path: '.artifacts/home-desktop.png', fullPage: true })
    console.log('冒烟测试通过：3、6、10 人对局、全 Bot 观战、刷新隐私保护、道具私密发放、配置预设与移动端页面均已验证。')
  }
} finally {
  await browser?.close()
  server.kill()
}
