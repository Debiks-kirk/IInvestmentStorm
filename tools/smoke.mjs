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
  const toggle = page.getByRole('checkbox', { name: /首轮系统道具竞购/ })
  if (await toggle.isChecked()) await toggle.uncheck()
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
  while (await page.getByRole('button', { name: '知道了' }).count() > 0) await page.getByRole('button', { name: '知道了' }).last().click()
  while (await page.getByRole('button', { name: '收下道具卡' }).count() > 0) await page.getByRole('button', { name: '收下道具卡' }).last().click()
  if (predictionIndex !== null) await page.locator('.prediction-list button').nth(predictionIndex).click()
  if (useCard) {
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
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
}

async function runGame(page, playerCount, verifyPrivateRestore = false, motion = 'reduced') {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await assertNoHorizontalOverflow(page, '移动端首页')
  await page.getByRole('button', { name: '创建新对局' }).click()
  await setRange(page.locator('#player-count'), playerCount)
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption(motion)
  await assertNoHorizontalOverflow(page, `${playerCount} 人设置页`)
  if (playerCount === 10) await page.screenshot({ path: '.artifacts/setup-10-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /开始这局/ }).click()
  if (playerCount === 3) await page.screenshot({ path: '.artifacts/draw-machine-mobile.png', fullPage: true })
  await startRound(page)

  for (let index = 0; index < playerCount; index += 1) {
    await enterPrivateTurn(page)
    if (index === 0) {
      await assertNoHorizontalOverflow(page, `${playerCount} 人私密操作页`)
      const identityButton = page.getByRole('button', { name: '查看身份详情' })
      await identityButton.click()
      await page.getByText('身份档案', { exact: true }).waitFor()
      await page.getByRole('button', { name: '收起身份详情' }).click()
      await page.getByText('身份技能', { exact: true }).waitFor()
    }
    if (verifyPrivateRestore && index === 0) {
      await page.reload()
      await page.getByRole('button', { name: /继续第 1 轮/ }).click()
      await page.getByText('请把设备交给', { exact: true }).waitFor()
      await enterPrivateTurn(page)
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
  if (!await page.getByRole('button', { name: '稳一手' }).isDisabled()) throw new Error('新手局第一轮不应开放预测')
  await assertNoHorizontalOverflow(page, '新手引导第一轮')
  await setRange(page.getByLabel('秘密下注'), 4)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await page.getByRole('button', { name: /进入私密操作/ }).waitFor()
  await enterPrivateTurn(page)
  await setRange(page.getByLabel('秘密下注'), 6)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await enterPrivateTurn(page)
  await setRange(page.getByLabel('秘密下注'), 8)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await page.getByText('第 2 / 3 轮 · 解锁预测', { exact: true }).waitFor()
  if (await page.getByRole('button', { name: '稳一手' }).isDisabled()) throw new Error('新手局第二轮应开放预测')
  await page.locator('.prediction-list button').first().click()
  await assertNoHorizontalOverflow(page, '新手引导预测页')
  await setRange(page.getByLabel('秘密下注'), 4)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await submitPrivateTurn(page, 6)
  await submitPrivateTurn(page, 8)
  await page.getByRole('button', { name: '揭晓本轮结果' }).click()
  await page.getByRole('button', { name: /进入下一轮/ }).click()
  await startRound(page)
  await enterPrivateTurn(page)
  await page.getByText('第 3 / 3 轮 · 道具与主动身份', { exact: true }).waitFor()
  await page.locator('.card-choice').filter({ hasText: '反客为主' }).click()
  await page.getByRole('button', { name: '确认使用' }).click()
  await page.getByRole('button', { name: /花费 4 金币发动/ }).click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await page.getByRole('button', { name: /已安排逆转排名/ }).waitFor()
  await assertNoHorizontalOverflow(page, '新手引导道具与主动技能页')
}

async function runCardFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
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
  await enterPrivateTurn(page)
  await page.getByText('我的固定资产', { exact: true }).waitFor()
  if (await page.locator('.private-asset-row').count() < 1) throw new Error('已拍下物品的玩家未看到自己的固定资产分类。')
  await assertNoHorizontalOverflow(page, '私密固定资产页')
  await setRange(page.getByLabel('秘密下注'), 2)
  await page.getByRole('button', { name: '确认我的选择' }).click()
  await page.getByRole('button', { name: '确定提交' }).click()
  await enterPrivateTurn(page)
  await page.getByText(/你获得了/).waitFor()
  await page.screenshot({ path: '.artifacts/card-private-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '收下道具卡' }).click()
  const usableCards = page.locator('.card-choice:not([disabled])')
  if (await usableCards.count() > 0) await usableCards.first().click()
  const targetConfirm = page.getByRole('button', { name: '确认并选择玩家' })
  if (await targetConfirm.count() > 0) {
    await targetConfirm.click()
    const targetCards = page.locator('.target-picker-grid button')
    if (await targetCards.count() > 0) await targetCards.first().click()
  }
  const confirmUse = page.getByRole('button', { name: '确认使用' })
  const confirmReroll = page.getByRole('button', { name: '确认并抽取 6 张' })
  if (await confirmUse.count() > 0) await confirmUse.click()
  if (await confirmReroll.count() > 0) await confirmReroll.click()
  const rerollOptions = page.locator('.prize-reroll-option')
  if (await rerollOptions.count() > 0) {
    if (await rerollOptions.count() !== 6) throw new Error('改拍令确认后应锁定展示 6 张候选拍品。')
    await rerollOptions.first().click()
  }
  if (await page.getByText('你看到了底牌', { exact: true }).count() > 0) await page.getByRole('button', { name: '知道了' }).click()
  await setRange(page.getByLabel('秘密下注'), 6)
  await page.getByRole('button', { name: '确认我的选择' }).click()
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

async function runPresetFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.getByRole('button', { name: '6 人标准局' }).click()
  if (await page.locator('#player-count').inputValue() !== '6' || await page.locator('#rounds').inputValue() !== '6') throw new Error('系统预设未正确载入。')
  await page.getByLabel('配置名称').fill('冒烟六人局')
  await page.getByRole('button', { name: '另存配置' }).click()
  await page.getByText('我的配置', { exact: true }).waitFor()
  await page.locator('.preset-grid').nth(1).locator('button').first().click()
  if (await page.locator('#player-count').inputValue() !== '6') throw new Error('已保存配置未正确重新载入。')
  await page.getByRole('button', { name: '删除冒烟六人局' }).click()
  if (await page.getByText('冒烟六人局', { exact: true }).count() !== 0) throw new Error('已保存配置未被删除。')
  await assertNoHorizontalOverflow(page, '配置预设页')
}

async function runIdentityFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableFirstRoundSystemAuction(page)
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
}

async function runLobbyistTaskFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('2')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
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
  await page.getByRole('button', { name: '发动技能' }).click()
  await page.getByText('选择发布方式', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '说客发布方式选择')
  await page.getByRole('button', { name: /随机发布/ }).click()
  await page.getByText(/随机任务；基础费用 0 金币/).waitFor()
  await page.locator('.target-picker-grid button').first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await page.getByRole('button', { name: /已安排：随机任务/ }).waitFor()
  await page.getByRole('button', { name: /已安排：随机任务/ }).click()
  await page.getByRole('button', { name: '发动技能' }).click()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByText('选择指定任务', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '说客指定任务选择')
  await page.getByRole('button', { name: '返回发布方式' }).click()
  await page.getByText('选择发布方式', { exact: true }).waitFor()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByRole('button', { name: /获得第二名/ }).click()
  await page.getByText('选择任务对象', { exact: true }).waitFor()
  await page.locator('.target-picker-grid button').first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
  await page.getByRole('button', { name: /已安排：获得第二名/ }).waitFor()
  await page.getByRole('button', { name: /已安排：获得第二名/ }).click()
  await page.getByRole('button', { name: '发动技能' }).click()
  await page.getByRole('button', { name: /指定发布/ }).click()
  await page.getByRole('button', { name: /下注高于某人/ }).click()
  await page.locator('.target-picker-grid button').first().click()
  await page.getByText('选择比较对象', { exact: true }).waitFor()
  const comparisonCards = page.locator('.target-picker-grid button')
  if (await comparisonCards.count() < 2) throw new Error('说客的比较对象应包含说客本人和其他非任务对象玩家。')
  await comparisonCards.first().click()
  await page.getByRole('button', { name: '确认安排' }).click()
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
  await page.getByRole('button', { name: /继续第 3 轮/ }).click()
  await page.getByText('总资产', { exact: true }).first().waitFor()
  await page.getByText(/生活娱乐 3 件 \+10/).waitFor()
  await page.screenshot({ path: '.artifacts/final-assets-mobile.png', fullPage: true })
  await assertNoHorizontalOverflow(page, '固定资产终局页')
}

async function runBotSpectatorFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await page.locator('#motion').selectOption('reduced')
  for (let index = 1; index <= 3; index += 1) await page.getByLabel(`玩家 ${index} 类型`).selectOption('bot')
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.getByRole('button', { name: '继续自动' }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '继续自动' }).click()
  await page.getByText('全局结束', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByText('Bot 档案', { exact: true }).waitFor()
  await page.getByText('逐轮复盘', { exact: true }).waitFor()
  await page.getByText('本局名场面 · 5 张', { exact: true }).waitFor()
  await page.getByRole('button', { name: '原班再来一局' }).waitFor()
  await page.getByRole('button', { name: /复仇局/ }).waitFor()
  await assertNoHorizontalOverflow(page, '全 Bot 观战终局页')
}

async function runSystemAuctionFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await page.locator('#motion').selectOption('reduced')
  await page.getByRole('button', { name: /开始这局/ }).click()
  await page.getByText('系统发起首轮竞购', { exact: true }).waitFor()
  await finishAuction(page, 3)
  await page.getByRole('button', { name: '启动抽奖机' }).waitFor()
  await assertNoHorizontalOverflow(page, '首轮系统竞购结束页')
}

async function runFirstPlayerBananaFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
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
  const banana = page.locator('.card-choice').filter({ hasText: '香蕉皮' })
  if (await banana.isDisabled()) throw new Error('第一位玩家持有香蕉皮时不应被禁用')
  await banana.click()
  await page.getByRole('button', { name: '确认并选择玩家' }).click()
  if (await page.locator('.target-picker-grid button').count() !== 2) throw new Error('香蕉皮应允许第一位玩家选择全部两名其他玩家')
  await assertNoHorizontalOverflow(page, '首位香蕉皮目标选择')
}

async function runTurnTimeoutFlow(page) {
  await page.goto('http://127.0.0.1:5181')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '创建新对局' }).click()
  await page.locator('#rounds').fill('1')
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  const timerToggle = page.getByRole('checkbox', { name: /启用操作倒计时/ })
  if (!await timerToggle.isChecked()) await timerToggle.check()
  await page.locator('#turn-time-limit').fill('5')
  await page.locator('#motion').selectOption('reduced')
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
  await page.getByRole('button', { name: /高级设置/ }).click()
  await disableIdentities(page)
  await disableFirstRoundSystemAuction(page)
  await page.locator('#motion').selectOption('reduced')
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
  await page.locator('.card-choice').filter({ hasText: '改拍令' }).click()
  await page.getByRole('button', { name: '确认并抽取 6 张' }).waitFor()
  if (await page.locator('.prize-reroll-option').count() !== 0) throw new Error('改拍令确认前不应抽出候选拍品')
  await page.getByRole('button', { name: '确认并抽取 6 张' }).click()
  const offers = page.locator('.prize-reroll-option')
  await offers.first().waitFor()
  if (await offers.count() !== 6) throw new Error('改拍令确认后应展示 6 张候选拍品')
  await offers.first().click()
  await page.getByText('选择已确定', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, '改拍令六张候选页')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' })
  page.on('pageerror', (error) => console.error(`浏览器运行错误：${error.message}`))
  if (process.env.SMOKE_ONLY === 'lobbyist') {
    await runLobbyistTaskFlow(page)
    console.log('说客任务流程冒烟测试通过。')
  } else {
    await runGame(page, 3, true)
    await runGame(page, 6, false, 'fast')
    await runGame(page, 10)
    await runTutorialFlow(page)
    await runCardFlow(page)
    await runSystemAuctionFlow(page)
    await runFirstPlayerBananaFlow(page)
    await runTurnTimeoutFlow(page)
    await runPrizeRerollFlow(page)
    await runPresetFlow(page)
    await runIdentityFlow(page)
    await runLobbyistTaskFlow(page)
    await runAssetFinalFlow(page)
    await runBotSpectatorFlow(page)
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
