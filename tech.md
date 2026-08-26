# 技术基线

## Bot 策略快照（v27）

- `PlayerController` 的 Bot 可选系统人格或 `custom`，后者内嵌 `CustomBotProfile`，保证预设可跨设备携带。
- `BotMemory.strategy` 是开局冻结的 `BotStrategyConfig`；会话迁移会为旧 Bot 由其原人格补齐，刷新与复仇局均不复用旧局行为随机数。
- 本地模板库键为 `who-is-raising:custom-bots:v1`，与对局存档、普通配置库分离；配置导入时复制模板为新 ID，避免覆盖本机同名或同 ID 模板。
- `bots.ts` 只消费 `BotObservation` 的公共信息、自己的物品/身份/库存及合法情报。类别加成通过 `calculateFixedAssets` 的边际差额计算，不读取对手实际收藏或余额。

## 预言家双轨推演（v20 兼容）

- `GameSession.prophetIdentityCandidates` 按“预言家 ID → 目标 ID”保存六个身份候选，身份草案完成时生成；候选含真实身份，顺序已锁定，刷新不重新随机。
- `ProphetDivination.identityGuesses` 允许同一回合保存两条猜测。`canMakeIdentityGuess` 同时读取新数组与旧版单条 `identityGuess`，以兼容历史会话，并阻止重复组合及已识破目标。
- `GameSession.prophetIdentityProgress` 是预言家跨轮私密进度的权威快照：每个目标保存 `excludedIdentityIds` 与可选的 `solvedIdentityId`。迁移通过完整历史重建该快照；UI 同时读取快照与历史作防御性合并，提交校验也拒绝已排除或已识破目标，防止状态重新出现。
- `PrivateTurn` 将观财／观星和观身份分别限流：前者每回合一次、受 `prophetDivinationLimit` 限制；后者免费、每回合最多两名，独立于该次数。累计正确数跨回合统计，达到 `min(3, 其他玩家数)` 后写入 `pendingProphetCardOffers`，候选六张不同道具在产生时即锁定。
- 奖励选择会从循环卡池移走所选实体；若池中没有该实体仍保留奖励发卡语义，避免被库存状态阻断。Bot 在私密回合优先完成尚未选满的奖励，确保全 Bot 对局不会停滞。

## 卡牌选择器与无限道具（2026-08-23）

- 三选一和六选二共用 `CardOfferPicker`，使用独立的响应式网格而非旧的 `merchant-offer-list`。它在桌面端三列、窄屏两列、360px 单列显示，并以 `已选 / 需要` 进度和绿色已选状态明确反馈六选二的第一次点击。
- `RoundTurn.cardUses` 不再在结算内核截断为两张，提交校验只拒绝同名道具重复使用。普通玩家可安排全部不同道具；Bot 为避免组合爆炸仍保留有界搜索，但包含一个所有可用不同卡的联合候选。

## 终局总资产走势（2026-08-24）

- `createAssetTrajectories` 是纯展示数据函数：将开局 `initialCoins` 和每份 `RoundResult.totalAssetUnitsAfter` 合成为每位玩家的总资产序列；旧结果缺少该字段时安全回退至 `balancesAfter`。
- `AssetTrajectoryChart` 在逐轮复盘顶部用内联 SVG 绘图，不写入会话。图例可点击聚焦某条线；响应式布局在窄屏保留可横向查看的图表坐标区，避免压缩折线或文字。

> 当前有效的架构、数据流与关键技术决策。最后更新：2026-08-06（本地对局历史）。

相关文档：[项目记忆](memory.md) · [计划](plan.md) · [进度](progress.md) · [调研](research.md)

## 目标与方案

### v20 页内竞购

- `GameSession.roundAuctions` 是本轮所有竞购卡的唯一运行时来源；`RoundTurn.auctionBids` 按 lot ID 保存每位玩家的私密报价。提交时用“普通下注 + 身份费用 + 所有竞购报价”做预算上限校验；结算时仅扣每张卡最高唯一价。
- `pendingMerchantOffers` 在商人确认发动时就从实体牌堆抽走三张不同卡，刷新后继续同一候选；选择一张安排下轮，其余立即回池。每轮开局每名商人私密获得一张循环卡。
- 回合结算先处理所有竞购卡，再进入纯竞拍结算函数，因此最终回合不依赖下一回合退款。旧 `merchantAuction` 字段仅保留 v19 迁移完成路径。

- React + TypeScript + Vite 单页应用；原生 CSS；Render Static Site。
- 无后端、数据库、账号或网络对局，状态保存在版本化 `localStorage` 中。

## 关键设计

- 显式阶段：`roundIntro → handoff → privateTurn → revealReady → roundResult → finalResult`。
- 结算为无 UI 依赖的纯函数；金币均以 0.5 金币为一个整数单位。
- 开局一次性生成物品牌堆和公平余数顺序，恢复对局时不重新随机。
- 私密页不作为可信恢复入口；刷新后一律降级到对应玩家的传递页。
- 页面由单个应用状态机驱动，无 URL 私密路由；首页负责显式恢复旧局。
- `roundStartPlayerIndex` 与 `playerIndexForRoundPosition` 是圆桌顺序的单一来源：座位数组始终固定，第 `roundIndex` 轮从 `roundIndex % playerCount` 开始，后续位置使用模运算环绕。`currentTurnIndex` 保存实际座位索引，常规竞拍提交按环形下一座位推进，并以已提交回合数而非数组下标判断本轮结束；道具竞购的 `bidderIndex` 保持“本轮第几位”序号，再通过同一映射取得实际座位。
- CSS 使用系统字体、内联纹理和物品 emoji 贴图，不依赖运行时网络资源；支持 360px 竖屏、横屏、降低动态效果和增强对比度。
- 轮前抽取界面为纯 CSS 抽奖机：抽象彩球在启动时翻滚，出奖槽随后衔接已有物品卡揭晓；抽奖结果仍由已保存的物品牌堆决定。
- `Player.cardInventory` 保存私密库存；`GameSession.cardDeck`、`pendingCardGrants` 与 `cardRulesStartRound` 管理循环卡池及刷新后的私密告知。每轮结算完成、开始下一轮前，会把该轮 `RoundTurn.cardUse` 的卡洗回牌堆；未使用库存不动，因此同一张卡不会同时存在于池中和多人手中。v1 存档补齐默认设置和空库存，历史回合不重算。
- 道具定义含 `rarity`（普通／稀有／罕见／传奇）这一纯展示字段，所有已启用类型仍等权参与抽取。`createCardDeck` 让非传奇卡初始化为两份物理副本、传奇“夺宝令”初始化为一份；卡池抽空后的补卡继续按启用类型均等随机补一张。v18 迁移会把缺失且合法的夺宝令补入循环池。
- `settleRound` 先计算正常获奖排名与 `winnerId`，再以已安排的夺宝令覆盖 `itemWinnerId`；绑匪只在没有夺宝令且目标仍是最终藏品得主时才可成功。因此夺宝仅转移收藏品，不干预奖金、预测与赢家付款的规则输入。
- 道具结算保持纯函数：先扣实际投资，再执行劫富济贫，再依提交顺序交换排名投资并施加双倍投入，之后按红黑卡的有效拍品价值发奖和结算预测，最后计算余额领跑者。公开账本不包含道具造成的个人余额变化。
- 金额继续以半金币整数单位表示；道具涉及的四分之一金币结果向下取整到半金币。实际投资、排名投资和有效拍品价值分别记录，避免交换/翻倍影响实际扣款。
- 会话格式升级为 v3：每个拍品有四类固定资产标签；终局纯函数计算现金、固定资产、总资产与类别明细并按总资产排名。固定资产只读取已获拍品，不写回玩家余额。
- 私密回合基于同一固定资产纯函数仅渲染当前操作玩家的非空类别：类别名、具体拍品、数量与已触发加成；一件时显示尚需收集数量，保证玩家可追踪个人资产而不增加任何公共信息。
- 身份系统尚未建模；私密页已预留独立的点击式身份详情入口和技能操作区，传递页亦使用单击进入私密操作。它们使用组件本地状态与静态占位，故不会写入会话、影响隐私恢复或改变结算；余额揭示继续使用长按。
- 配置预设使用独立 `localStorage` 键和版本号，与对局会话隔离；预设为姓名加完整 `GameSettings` 的快照，系统预设只读、自定义预设可管理。
- `createDefaultSettings(playerCount)` 是新局与系统预设的共同平衡基线：3 人为 5 轮／30 金币／普通猜错 −1.5V／夜行者 2／商人 1／赌徒命中 +33%、猜错跳过 −50%；6 人为 8 轮／30 金币／普通 −1V／夜行者 2／商人 3／赌徒 +67%、猜错跳过 −33%、绑匪费用 3；10 人为 10 轮／30 金币／普通 −0.5V／夜行者 3／商人 3／赌徒 +100%、猜错跳过 −20%、绑匪费用 2。所有控制器共用会话设置，Bot 不存在隐藏的预测罚款。其他人数继续使用通用默认，再允许从高级设置细调。
- `SYSTEM_PRESETS` 生成 6 套只读模板：每个 3／6／10 人规模均有全真人和 1 真人 + Bot 版本；Bot 模板使用连续的“机器人N”名称与标准自适应控制器。加载或导入的旧预设持有完整显式设置，因此不会因新默认值发生迁移式改写。
- 配置卡采用独立的渐变表面、可见边框与轻阴影；悬浮时轻微上移，激活态额外显示红色描边。保存卡通过 `preset-choice--saved` 预留右侧动作空间，导出与删除在同一绝对定位动作组中各自使用静态 flex 布局，避免旧的单按钮绝对定位规则造成重叠。
- `RoundResult.redistributionTransferUnits` 保存劫富济贫池的实际总额，公开界面仅渲染该匿名金额；v2 及更早会话迁移时补齐拍品类别和安全默认字段。
- Vitest 覆盖纯函数规则，Playwright Core 驱动系统 Chrome/Edge 完成端到端冒烟测试。

## 身份系统基线

### 绑票谈判（v25）

- `IdentityAction.kidnap` 保存名单、赎金档位与可选的旧单目标字段；旧已提交回合仍可读取。绑匪为不可重复身份，每轮均可发动，包含最后一轮；默认名单上限由 `ceil(玩家数 / 4)` 推导，设置填 `0` 即使用自动上限。
- `settleRound` 只结算绑票布置的高档／多目标附加费，并在最终拍品得主落在名单内时写入 `RoundResult.kidnapAttempt: pending`，不提前改写拍品归属。`GameSession.pendingKidnapNegotiation` 保存完整的暂停结算快照，因此刷新不会跳过或重新判定谈判。
- 新增 `kidnapNegotiation` 公共阶段：得标者可支付赎金保住拍品，或放弃拍品给绑匪。支付金额直接在两人间转移；放弃时移动实际藏品并撤销因该藏品刚触发的收藏家即时奖励。排名奖励、预测和投资分红保持原结果不变。

- 当前会话格式为 v11。`IdentitySettings` 具有独立的赌徒猜错／跳过倍率与商人拍卖次数上限；旧存档以旧跳过倍率补齐猜错倍率，旧商人的 `merchantAuctionUsed` 映射为已发动一次。
- 身份抽卡不再消费全局可用列表，而是从当前已选身份推导次数：非说客计数小于 2 时进入等权正常池，说客只允许计数 0；每次无放回抽两张不同候选，正常池不足才按低计数优先补位。已生成的 `identityDraft.choiceIds` 仍是刷新恢复的权威状态。
- `PlayerIdentity` 保存商人发动次数和最近发动回合；提交校验与 Bot 计划同时检查次数、同回合、最后一轮和卡池限制。

- 会话状态机扩展为 `identityHandoff → identityDraft → roundIntro`，并为道具商人增加 `auctionIntro → auctionHandoff → auctionBid`。所有私密阶段刷新后都会降级回各自中立传递页。
- `GameSession` v4 持久化身份候选池、选角草稿、待处理身份道具、私密提示、说客契约、身份事件和商人竞购；`Player` 保存身份配置、次数与状态。每次选择、配置、报价和回合确认都会立即保存。
- `settleRound` 保持 UI 无关：在原有结算后处理赌徒、绑匪和说客；逆转者通过实际奖励与公开奖励双字段隔离秘密差额。猜中预测按完整奖励发放，第一名只扣其可用余额，剩余由系统补足；猜错的 `publicPredictionUnits` 始终记录规则应扣值，避免余额不足泄露。收藏家在 `rankFinalPlayers` 注入额外类别件数，并在实际获得同类别拍品后追加固定 5 金币；该奖励写入 `identityUnits` 和私密事件，且在常规预测付款后发放，不写入公共账本。
- 会话 v12 新增 `roundStartBalanceUnits` 与持久化 `prophetDivinations`。每轮进入 `roundIntro` 时冻结余额快照；观财由纯函数生成必含真实值、位置随机的半金币区间，推演确认后即与扣费、观星预览/观身份结果一同保存，刷新不会重掷。观身份奖励优先从当前卡池中选取未持有、未被竞购预留的卡；无可用卡才从启用卡定义补一张。
- 小偷的道具截获在所有同批发卡完成后统一路由，按照保存的公平顺序处理冲突；商人初始卡与竞购获得卡也走同一处理路径。商人启用时，设置验证要求至少一张道具卡处于启用状态。

## 身份规则结算（v5）

- 会话版本升为 v5。逆转者的 `reverserInvert` 动作在纯结算函数中扣费并倒转奖励人数范围内的排名；费用由总回合数判断最后两轮并翻倍，因此预测、拍品归属与奖励均使用倒转后的第一名。
- 赌徒的额外收入和猜错/跳过罚款全部归入 `identityUnits` 与私密身份事件；公共预测账本则刻意按普通玩家金额写入伪装值。猜错的 `predictionUnits` 使用普通罚款、跳过为 `±0`、猜中为普通预测收入，均不改变实际余额；赌徒下一次私密回合通过事件通知查看真实差额。
- 说客动作区分随机与指定：随机任务在提交瞬间抽取、写入 `LobbyistContract` 后不再重抽；指定任务附加独立费用。契约持久化 `specified` 字段，旧存档缺失时按已指定兼容。

## 私密反馈队列

- `pendingIdentityNotices` 以单条 ID 确认，不再按玩家批量清空。道具领取只更新其 `pendingCardGrants` 状态，因此不会吞掉说客任务或身份结算消息。
- 回合结算将新产生的 `IdentityEvent` 转成通知并随会话保存，下一次对应玩家进入私密回合时展示。进入下一轮时，待执行的说客契约会额外生成目标通知，内容含任务与违约金额；两类信息不会渲染到公共结算界面。
- 待执行说客契约同时由 `PrivateTurn` 从会话筛选为 `activeLobbyTasks`，固定渲染在身份技能区之前。该视图只含任务对象本人的任务、比较对象和配置中的失败付款，不显示发布者；结算引擎则为完成的任务补写一条给发布者的零金额事件，确保双方都能获得私密回执。逆转者的排名倒转已包含在公共 `RoundResult`，因此不走此持久任务/回执模式。
- 私密页现在将任务渲染为顶部 `task-inbox`，其余下注、预测、资产、身份技能和道具区维持展开。待展示通知按任务、道具、普通结算排序，每次只渲染一张；主动身份操作通过独立确认弹层才写入本轮选择。

## 操作时限与目标道具（v11）

- `GameSettings.turnTimerEnabled` 默认 `false`；开启时 `turnTimeLimitSeconds` 默认 20、合法范围 5–120 秒。配置预设与迁移都会保存/补齐两项设置；v10 及更早会话默认关闭并清理旧截止时间。`GameSession.operationDeadlineAt` 是开启状态下的绝对时间戳，私密页面刷新虽降级回传递页，仍不会重新计时。
- `PrivateTurn` 只有在任务、发卡等必读通知全部确认后才请求 `Game` 写入截止时间；Bot、选角、教学和通知不使用时钟。`AuctionBid` 在进入报价页即启动同一时钟。倒计时在确认弹层和目标选择层继续推进，剩余 5 秒使用警示状态。
- 超时提交使用当前已确认的 `RoundTurn`，丢弃仅打开而未确认的卡/技能。未完成的改拍令是已不可逆抽取，故自动锁定其首张保存候选以保证提交仍合法；常规人工提交依然要求自行选择候选。
- 目标卡点击只打开效果确认；确认后立即由 `PlayerTargetPicker` 呈现合法目标。目标选定后，偷天换日/香蕉皮可在提交前取消，偷看底牌则先显示私密数额并锁定卡牌，防止撤销后保留情报。命运硬币先确认再启动翻转动画。
- `LobbyistTaskPicker` 的首层只让玩家选择发布方式：随机发布不收指定费、系统立即锁定任务；指定发布以独立区域列出全部任务并显示额外费用。两条路径随后共用任务对象与可选比较对象的玩家卡流程。

## 目标道具限制

- `peek` 在操作页和提交校验中都只能指向已提交的回合，以保证偷看金额有实际内容且不泄露未来操作。
- `swap` 可指向任意其他玩家；结算函数已本来就在完整回合列表上按提交顺序交换排名金额，因此未来目标无需预先提交。该效果只影响排名金额，实际扣款仍由各自提交下注决定。

## 终局逐轮复盘

- `FinalResult` 使用 `session.results` 与全局 `session.identityEvents` 按 `roundIndex` 关联，渲染可展开的逐轮复盘；无需重算历史回合或更改会话版本。
- 每轮复盘列出 `RoundTurn.bidUnits` 的实际下注、道具及目标、排名投资额变化、身份主动操作和事件详情、排名奖励/拍品、预测结果、第一名支付，以及逐人获奖/预测/身份收支。该信息仅在终局显示，因此不改变进行中的隐私边界。
- 最后一轮默认展开，其他回合使用原生 `details` 折叠；双列内容区在 600px 以下收为单列，避免移动端横向溢出。

## 逆转排名与身份技能状态

- 会话格式为 v6。`CardId` 增加 `reverseRank`；v5 及更早会话迁移时，如果该卡未被禁用且未在任一库存中，会补入循环卡池。已有 `RoundResult` 的 `rankingReversalCount` 安全默认 0，不重算历史结算。
- `settleRound` 将逆转者的 `reverserInvert` 和所有 `reverseRank` 道具使用计入同一逆转计数。计数为奇数时反转唯一获奖者列表，为偶数时保持正常顺序；相应描述通过 `cardEffects` 写入公共结算和终局复盘。
- `identitySkillMode` 集中判定主动身份（道具商人、逆转者、说客）与被动身份。私密 UI 以该判定渲染操作入口说明，并根据余额、轮数、使用次数和卡池状态将不可用操作替换为具体原因。

## 双道具与命运硬币

- 会话格式为 v7。`RoundTurn.cardUses` 是新的多卡字段，兼容读取旧 `cardUse`；迁移会把进行中和历史回合的旧单卡记录转换为数组，并把未禁用的 `fateCoin` 补入既有卡池。
- `settleRound` 先扁平化每位玩家的所有道具，再计算价值、排名与结算；命运硬币的 `coinResult` 是提交时已保存的 `heads` 或 `tails`，分别写入 `cardUnits` 的 +10 或 0，确保结算纯函数可重放。
- 私密页以 `confirmedCardUses` 管理本回合最多两个已确认道具。无目标卡直接弹出确认；目标卡在选择目标后弹出确认；命运硬币点击使用后启动 CSS 翻转，结果出现后才可确认，且确认后不可从已安排道具中取消，防止通过重试选择正面。其他已安排道具仍可在提交前取消。

## 香蕉皮与反弹护盾

- `CardId` 新增 `bananaPeel` 和 `reflectShield`；`CARD_DEFINITIONS` 是新局、设置逐卡禁用开关和循环卡池的唯一来源。存档迁移会在卡未禁用、未被任何人持有且不在牌堆时补入它们，因此不会制造重复卡。
- 结算引擎先收集护盾持有者，再统一解析目标型结算道具。`swap` 和 `bananaPeel` 指向护盾持有者时，目标会改为使用者本人；被反弹的换日成为自我交换而不改变排名。`peek` 在私密操作页即时读取已提交下注，不能被结算阶段的护盾反转。
- 香蕉皮在换日之后、排名之前生效：将目标原始下注的一半返还到 `cardUnits`，并把目标完全过滤出 `rankingTurns`，故不会因唯一 0 投资意外获奖。公共 `cardEffects` 带被影响玩家姓名；结果页额外显示一次确认弹窗，终局复盘仍保留完整道具使用记录。

## 绑匪与玩家目标卡片（历史实现）

- 此处的即时抢夺说明已由上方的 v25「绑票谈判」取代。`assassin` 仍显示为“绑匪”且全局不可重复；旧的单目标即时抢夺与 `kidnapActivationCoins` 发动费仅用于旧存档兼容，不参与新局结算。
- `PlayerTargetPicker` 是私密可复用的目标组件，身份草稿、目标道具、绑匪和说客的任务／比较对象均通过它选择玩家；用户先看到效果说明，再从大卡片中选择，目标卡片在窄屏收为单列。

## 离线 Bot 基线（v8）

- `SeatConfig` 取代纯名字开局数据；`Player.controller` 标注真人或 Bot，Bot 私有 `botMemory` 保存恩怨、最近策略及最多 80 条精简决策记录。旧会话按真人迁移，旧预设按全真人座位迁移。
- `buildBotObservation` 是唯一从会话构造 Bot 输入的适配层。它只输出公共历史、当前拍品、自己私有资产和合法提示；专家情报在此处从已提交回合裁剪为 ±2 金币区间。Bot 决策函数不接收完整会话。
- `bots.ts` 的策略器以性格权重、拍品价值、固定资产边际收益、余额、卡牌、身份、公开赢家和恩怨选择策略模式及行动；行动仍由 `Game` 的既有提交函数进行余额、目标和阶段校验。
- 混合局在 Bot 回合显示不泄密的思考页后自动提交；全 Bot 局自动通过选角、抽奖、竞购、揭晓与终局，并以本地 UI 状态提供暂停和 1×/2×/4×。终局复盘读取已保存日志，不重新推导隐藏信息。
- `estimateBalances` 只读取公开的回合总投资、最低获奖下注、获奖名次和公开收益变化，维护每位玩家的估计现金、上下界及常见下注。候选下注会按预计名次、唯一出价概率、排名奖励、固定资产边际价值、现金风险、任务与策略模式评分。
- `predictionDecision` 估算候选第一名的胜率、其可支付余额、猜中者分摊与猜错罚款；普通 Bot 仅在正期望时预测，赌徒则把跳过罚款作为比较基线。终局的身份公开直接读取已保存身份配置，不影响中途隐私。
- 回合计划层会在候选下注前枚举特殊语义：偷天换日以目标的公开推测投资作为 Bot 排名投资，并将目标的排名投资覆盖为 Bot 实际低投资；逆转者按倒转前/后的获奖位分别评分并计入 6/12 金币费用。这样不会把“换卡后仍按普通下注”或“逆转者只会抢第一”误当成最优。
- 身份特判只使用可见数据：绑匪估算目标胜率、收藏收益和失败成本，预言家用已合法预见的下一拍品边际资产价值调整留存，公开历史中同类别获胜次数会增加对手出价压力。普通计划的近似最优混合由会话稳定字段散列选择；目标道具和身份技能不混合，保证刷新和回放一致。
- 全 Bot 观战以本地 `botPaused`、`botSpeed` 和 `autoPausedRound` 控制，不修改会话数据。每个新 `roundResult` 只会自动暂停一次；继续后正常推进。暂停时可把当前行为主体（结算页为下一轮首位）从 Bot 改为真人，随后全 Bot 自动驱动自然停止并交给既有手动 UI。

## 首轮系统竞购与商人伪装

- `GameSettings.firstRoundSystemAuction` 默认 `true`。`createSession` 在创建时从 `cardDeck` 取首张，保存为 `{ source: 'system', merchantId: null, roundIndex: 0 }` 的 `MerchantAuction`，因此该卡不会同时被常规发卡抽到；身份选角结束后检测这个预留竞购并转入 `auctionIntro`。
- `MerchantAuction.source` 区分商人和系统来源。系统来源的得标者扣除报价但没有收款玩家；商人来源则仍将报价转给商人。无唯一正报价时，竞购卡洗回循环池；商人来源额外只向商人写私密的无人得标提示。
- 竞购的参与者统一是 `session.players`。当 `source === 'merchant'` 且当前参与者就是 `merchantId` 时，UI 和提交校验都把报价强制为 0；这保证手动、Bot 和刷新恢复路径一致，也不通过跳过某人泄露身份。
- 旧会话缺少新设置时迁移为 `false`，不改变已进行对局；旧商人竞购缺少 `source` 时按 `merchant` 兼容。新会话使用 v10 格式，加载时会将缺字段立即回写。
- `applyBidJitter` 位于 Bot 近似最优选择之后，用稳定散列给普通方案加 −1/0/+1 半金币单位的偏移，并重新估算该报价的名次概率。涉及换日目标投资或任意排名逆转的方案直接跳过该步骤，避免破坏其精确策略语义。
- 说客 Bot 通过 `BotObservation.lobbyistFeeUnits` 获取本回合真实可支付的随机任务费用，仅在“投资 + 费用”不超过余额时安排任务。`Game` 在自动 Bot 提交被拒绝时，会用原定报价和预测重试，同时移除道具与身份附加动作；该保底避免卡住且不丢失主体竞拍决策。

## 道具目标范围

- `cards.ts` 的 `cardTargetScope` 是目标范围唯一来源：`peek → previous`，`swap`/`bananaPeel → other`，其余卡为 `none`。`previous` 只读取已经提交的回合；`other` 从完整玩家列表中排除使用者，允许未来目标。
- 私密库存逐张卡计算可选目标，不能再用“当前选中卡”的候选集判断另一张卡；目标卡片弹层和 `submitTurn` 校验均使用同一个范围函数。该设计避免首位玩家持有香蕉皮或偷天换日时被错误禁用。

## 被动反弹护盾

- 反弹护盾不再写入 `RoundTurn.cardUses`：私密 UI 禁止手动点击，`submitTurn` 也拒绝旧式主动护盾记录，因此它不占两张道具上限。
- `settleRound` 从玩家库存构建待命护盾集合，按指定型卡牌的提交顺序处理。目标有护盾时，首次指定改为作用于使用者、移除目标库存中的护盾，并向 `RoundResult.autoConsumedCardIds` 写入一次 `reflectShield`；同轮之后该目标不再受保护。
- `nextRound` 将 `autoConsumedCardIds` 传给 `recycleUsedCards`，使自动消耗卡和普通已使用卡一样回到循环池。旧结果迁移默认空数组，不重算历史回合。

## 改拍令与预言牌堆

- `GameSession.itemDeck` 是实际结算牌堆；新会话同时复制为只读 `prophecyDeck`。改拍令只替换 `itemDeck[roundIndex + 1]`，所有预言家预览（包含 Bot）从 `prophecyDeck` 读取，故不会泄露被修改后的真实下一轮拍品。
- 使用改拍令时，点击只打开确认弹层；确认后才生成并持久化 `pendingPrizeReroll`（使用者、回合、原下一拍品和从 `ITEM_POOL` 中排除全部已安排拍品后抽得的 6 张候选）。卡牌随确认从私密库存移除并占用本回合两张道具之一；候选区为 2×3，选择后将 `chosenItemId` 锁定并写入实际牌堆，提交回合时才转为 `CardUse`、进入下轮循环回收。
- 此拆分避免刷新重抽、候选重复或使用后取消；迁移对旧会话以现有 `itemDeck` 补建预言牌堆，并把未禁用的新卡安全补入循环牌池。

## 说客默认数值

- `defaultIdentitySettings` 的 `lobbyistFailurePaymentCoins` 为 5。它只影响新建设置和系统预设；`normalizeIdentitySettings` 的展开顺序使已有存档或预设中明确保存的违约金继续优先，避免进行中的对局被重平衡。

## 说客任务与自动选卡流程

- `LOBBYIST_TASKS` 是任务标签、说明和是否需要比较对象的单一来源。六种任务为：第一名、第二名、不获奖、零下注、高于某人、低于某人；`settleRound` 以实际下注和最终排名判定，Bot 评分、任务通知和终局复盘复用相同任务类型。
- 任务对象始终不能是说客本人；只有高/低下注任务需要比较对象，比较对象只排除任务对象，因此可以选择说客本人。随机任务从完整任务池抽取，随机到比较任务时可正常把说客作为比较对象。
- 私密 UI 由 `LobbyistTaskPicker` 驱动：任务卡选择完成后直接切换到 `PlayerTargetPicker`，比较型任务再自动切换一次。任务未安排前不预扣指定任务费用；安排后提交按钮会将基础费和指定费一起纳入余额校验。

## 实现状态

- 完整可玩首版已实现；28 个单元测试、3/6/10 人端到端冒烟测试和生产构建均通过。
- Render Blueprint 已配置并已由连接的 GitHub 仓库部署为 Vite 静态站点；后续发布可由仓库推送触发，或在 Render 控制台手动同步。

## 本地对局历史

- `GameHistoryEntry` 保存 `id`、`completedAt` 与完整的终局 `GameSession` 深拷贝。`storage.ts` 以独立键 `who-is-raising:history:v1` 读写，历史容量上限为 12；解析失败或结构不合法时安全返回空列表。
- 根组件只在 `phase === 'finalResult'` 时调用 `archiveGameHistory`。同一会话 ID 会替换旧快照且保留原完成时间，因此终局页面重渲染或刷新不会产生重复历史。
- 历史详情复用 `rankFinalPlayers`、`createGameHighlights` 与 `RoundReview` 的纯展示路径；不提供继续、重开、提交或结算入口，因此存档不会被历史浏览污染。

## Bot 资金经营与资产协同（v19）

- `BotBehavior` 新增每局固定的 `bankrollBias` 与 `assetFocusBias`。它们由会话与 Bot ID 稳定生成，并与既有人格的风险、收藏、道具、身份倾向共同影响评分，刷新不改变本局风格。
- `reserveForPlan` 会在非终局为周转、已持有道具和高主动身份成本留出现金；评分同时惩罚过早跌入低现金区。高风险或冲刺策略仍可主动放低留存，因此不会把全部 Bot 统一成保守打法。
- 收藏家对自己选定类别的拍品，直接计入结算中的即时 +5 金币、固定资产跳档和已有同类藏品的连胜价值；其它类别不享受该专属加成。
- 对手报价样本在一次 Bot 方案搜索内缓存。这样在枚举半金币报价和道具/身份组合时不会反复生成相同样本，避免复杂评分拖慢自动回合。

## 开放技术问题

- 真实设备的浏览器存储配额、不同平台 emoji 风格和长时聚会体验需通过线下试玩继续观察。

## 说客两步发布弹窗（2026-08-05）

- `LobbyistTaskPicker` 只管理临时 UI 步骤：首层选择随机或指定，指定层才渲染任务列表。随机任务直接进入任务对象卡；指定任务选定后进入相同人物／比较对象流程。
- 费用与任务仍由既有 `PrivateTurn` 状态和提交校验处理；人物选择说明统一显示基础费用、指定费与合计，不提前扣款。关闭弹窗会卸载临时步骤，故不会留下未安排任务。
- 指定任务卡在窄屏强制单列，容器使用 `min-width: 0`、受限宽度和 `overflow-x: hidden`；`prefers-reduced-motion` 沿用全局动画降级。`tools/smoke.mjs` 支持 `SMOKE_ONLY=lobbyist` 运行此交互回归。

## 分阶段回合揭晓

- `RoundResults` 仅使用本地展示状态 `ties | rankings | settlement`，不修改 `GameSession`，因此刷新恢复、结算幂等性和历史回放不受动画影响。
- 常规速度依次等待并列核验和名次揭晓；快速模式使用更短等待；降低动态效果和“跳过动画”立即切换到 `settlement`。定时器在组件卸载或跳过时清理，避免延迟状态更新。
- 道具效果、预测、公开账本和余额领跑者只在最后一段挂载。拍品、并列卡、排名行与结算面板使用 CSS 进入动效；`reflectShield` 与 `fateCoin` 使用专属强调动画，并由全局 `prefers-reduced-motion` 规则统一降级。

## Bot 受控随机策略

- `nearOptimalChoice` 先过滤掉比最佳方案低出质量窗口的候选，再按 `exp((score - best) / temperature)` 分配 softmax 权重。温度由人格风险/道具偏好、难度、回合位置和连续策略共同计算：高手更集中，简单 Bot 更分散，终局更谨慎。
- `applyBidJitter` 以 Box–Muller 变换从稳定散列生成均值为 0 的正态样本，按温度的一半作为标准差，并截断在 ±2 金币内；结果仍是半金币整数单位且不超过可用余额。
- 所有伪随机数均由会话 ID、Bot ID、回合、拍品和人格确定，故同一未提交决策在重新渲染时一致，提交后也自然持久化；新局 `session.id` 不同，即使完全复用 Bot 预设也会走向不同。换日与排名逆转因需要精确名次语义直接跳过报价扰动。

## 终局榜单与领奖台

- `FinalResult` 只维护本地 `revealedCount`，按 `rankFinalPlayers` 的逆序从末位到首位挂载榜单条目，不会写回会话或影响最终资产计算。完整/快速/降低动态效果分别使用不同节奏；任意时候可跳过到完整状态。
- 自动揭晓的 `useEffect` 依赖当前 `revealedCount`：每揭晓一位就清理前一计时器并安排下一位，直到完整，避免只调度首张后停在中途。降低动态效果直接初始化完整数量。
- 当全部名次出现后，前三个最终条目按第 3、2、1 名次顺序进入 `champion-podium`。领奖台只表现终局演出，仍按总资产与共享名次显示；身份公开、Bot 档案和逐轮复盘在榜单揭晓完成后才挂载。

## 终局叙事与复仇局

- `highlights.ts` 是无 UI 依赖的展示纯函数层：`createGameHighlights` 从已结算回合和 `rankFinalPlayers` 产出固定五张名场面；`createRoundBulletin` 以优先级生成一条公开、无数值的结算播报。二者不写入会话，也不参与任何金额计算。
- `FinalResult` 只在榜单完整揭晓后挂载默认折叠的名场面 `<details>`，并把两种再开局操作收在终局底部；这避免在进行中的竞价或主排行榜堆叠额外信息。
- `createRematchSession(previous, keepBotGrudges)` 通过既有 `createSession` 重建所有局内牌堆、金币、身份与记录。复仇模式仅复制 Bot 的 `grudgeByPlayerId`，并以玩家座位把旧 ID 映射到新 ID；缺失旧控制器按真人兼容，历史 `decisionLog` 不复制。

## 三轮新手引导局

- `createTutorialSession()` 复用普通会话创建器，再覆盖为三位人类、固定三张拍品、无首轮系统竞购、无随机发卡的三轮教学会话；会话上的可选 `tutorial: { kind: 'firstGame' }` 是持久化开关，刷新仍保留当前教学阶段。
- `PrivateTurn` 只从 `tutorial` 与 `roundIndex` 推导 UI 解锁状态：首轮禁用预测，前两轮隐藏预置道具和身份，第三轮才显示卡牌二次确认和逆转者技能区。该限制只影响展示和交互入口，不改写核心结算函数。
# 2026-08-05：回合反馈与卡池

- 会话版本升级至 v14：保存竞购队列、每轮总资产快照及 `pendingFateCoinUse`。旧终局拍品回执会在迁移时直接进入最终榜单，避免玩家逐人确认公共已展示的信息。
- `createCardDeck` 生成启用卡的两张物理副本；`drawCard` 只在抽取时空池补一张。库存与回收不再以 `Set` 去重。
- 中场竞购位于零基 `floor(rounds / 2)`：即 3/4/6 轮局分别为第 2/3/4 轮；若商人竞购同轮，系统竞购先执行。

## 预言家与命运硬币的即时动作

- `useProphetDivination` 仅在 `mode === 'identity'` 时收取 `prophetDivinationCoins`；身份猜测会同时写入 `ProphetDivination` 和持久化私密通知，因此正确与错误均有即时反馈。
- `resolveFateCoin` 在硬币动画结束时原子地移除库存卡、改变余额并写入 `pendingFateCoinUse`；`submitTurn` 只接受与该锁定记录一致的硬币使用。Bot 在提交回合时走同一金额语义，结算引擎对带 `fateDeltaUnits` 的记录只生成说明，不再改余额。
- 道具竞购结束后给每名玩家创建不含赢家姓名或报价的结果通知；成功获得道具或被偷走仍由现有发卡/身份通知给出实际私密结果。

## 夜行者双影下注（v16）

- `RoundTurn.bidUnits` stores the chosen visible A at submission. `IdentityAction.nightwalkerDoubleBid.shadowBidUnits` stores B. At settlement, the pure engine evaluates A/B after all turns are present, applies the winning bid as the actual payment/ranking bid, and records `RoundResult.nightwalkerOutcomes` for the end-game review.
- For simultaneous Nightwalkers, evaluations resolve in fixed turn order: prior Nightwalkers’ selected bids are included; later Nightwalkers remain on A. This makes replay/refresh deterministic without exposing any secret choice during the round.
- The UI locks the ordinary bid controls after confirmation so A/B cannot drift apart. Ranking-changing card choices are disabled while the action is armed; serverless submission validation repeats this boundary. A fate-coin loss that makes B illegal clamps/revokes the pending choice before submit.
- `IdentityAction.nightwalkerDoubleBid` 可选保存 `prioritizeItem`；缺字段按 `true` 解释，兼容已有存档。私密弹窗默认勾选“优先拿藏品”，玩家可在每次发动时关闭。
- 结算引擎对 A/B 分别运行与正式排名相同的唯一出价、目标道具、反客为主与奖区逆转模拟，额外记录是否会作为排名第一获得拍品。若开启优先且仅一档得拍品，优先采用该档；否则继续比较“排名奖励 − 实际下注”，同分保留 A。
- 夜行者模拟刻意位于绑匪结算之前，因此不会读入绑匪是否抢走拍品；`NightwalkerOutcome` 会持久记录两档拍品结果、开关与采用原因，供终局复盘解释。
- 结算时还会以 A/B 金额和净收益计算差额，写入夜行者的私密 `IdentityEvent`：采用 A 明示“比 B 少投入”，采用 B 明示“比 A 多投入”，并同步说明排名净收益高／低或相同。终局复盘从同一 `NightwalkerOutcome` 重算并展示这些差额。

## 身份候选与主动技能次数（v17）

- `IdentitySettings.identityChoiceCount` controls how many distinct cards are dealt to each player at setup (2–5). `dealIdentityChoices` preserves the existing repeat-minimizing weighting and returns that many unique candidates; validation requires at least that many enabled non-lobbyist identities, so a candidate screen never silently shows fewer cards.
- The advanced settings carry per-game caps for active roles. Merchant continues to use its auction counter and Nightwalker its double-bid counter; prophet uses persisted divination history; kidnapper, thief, reverser and lobbyist share `PlayerIdentity.activeSkillUses` because a player owns only one identity. UI affordances, submit validation and Bot candidate planning all use the same persisted counters.

## 可移植配置格式与高级设置弹窗

- `exportGamePreset` emits a standalone JSON object with `format: "who-is-raising-preset"` and `version: 1`. The payload includes only preset name, seats and cloned settings. `importGamePreset` accepts only this format, reconstructs defaults for missing legacy fields, bounds seat count to 3–10, and returns fresh data without importing IDs or timestamps.
- The setup screen keeps mutable `settings` and `seats` as its source of truth. The advanced dialog edits those same values directly, so closing it never requires an extra save; `createGamePreset` still captures the full state. Export/import dialogs are separate from the advanced dialog and use a JSON textarea plus an optional browser file picker, avoiding any backend dependency.

## Bot 联合计划与反并列（v15）

- `BotMemory.behavior` 存储每局固定、UI 不公开的七项行为倾向；`recentBidUnits` 仅保留最近八次自己报价作长期风格记录。新会话以 `gameId:playerId` 创建，迁移缺失字段时以相同稳定种子补齐；`createRematchSession` 重新保留新会话的行为字段，只映射 `grudgeByPlayerId`。
- `decideBotTurn` 枚举每个合法半金币报价，并对每个对手从现金区间、公开拍品历史、已提交情报生成 11 个确定性报价样本。排名评分读取第一／唯一／并列概率，撞价会扣分；计划数量以确定性上限限制，保证 10 人 Bot 观战不会因完整组合爆炸而停住。
- 卡牌、逆转者、绑匪、小偷、商人和说客均先生成合法联合计划，再连同现金风险、固定资产、恩怨、任务、预测期望和卡牌效用一起评分。命运硬币为保守 Bot 预留最坏损失；改拍令先进入已持久化的候选选择流程；预言家在提交前按其隐藏倾向选择观财、观星或罕见的付费观身份。
- 道具竞购的 `decideBotMerchantBid` 也枚举半金币报价，并按卡价值、现金保留、人格卡牌偏好与报价指纹从近优方案选择。Bot 观察适配器仍只输出公共结算、本人私密状态和合法情报，禁止读取对手余额、库存、身份或未公开下注。
- `tools/smoke.mjs` 额外支持 `SMOKE_ONLY=bot`，用于独立回归完整全 Bot 观战流程，避免无关的人类教学流程掩盖 Bot 自动化结果。
- 道具竞购会为每位参与者写入私密回执。唯一得标者和未得标者采用直接的成功／失败文案并带道具名称；商人来源竞购对商人本人改写为成交／流拍，避免暴露或误解其规则性 0 报价。
- `task-inbox` 从标题摘要升级为持久化任务详情视图：它由 `identityContracts` 的当前目标契约渲染任务定义、比较对象名称和设置中的违约金额，故关闭私密通知不改变或隐藏后续操作所需信息。
- `IdentitySettings.prophetDivinationCoins` 的新局默认值为 3，仅用于观身份；观财／观星始终免费。迁移和预设归一化保留已保存的显式值；Bot 观察适配器携带实际费用，以便付费推演的可用性判断不依赖硬编码。
- `BalanceReveal` 使用指针事件而非点击：按下即显示，松开／取消／丢失捕获／失焦即隐藏。余额按钮设置 `touch-action: none` 和 `-webkit-touch-callout: none`，避免手机浏览器将按住解释为滚动或系统长按并丢掉事件；`SMOKE_ONLY=balance` 验证触摸指针完整路径。

## 私密操作页 UI 架构（2026-08-25）

- `PrivateTurn` 使用 `PrivateToolPanel` 维护 `prediction | identity | assets | backpack` 的单一临时界面状态；焦点弹窗只影响展示与临时选择，所有已确认动作继续通过既有 `onSubmit`、会话持久化与纯结算函数处理。
- `BalanceReveal` 采用点击式 3D 翻牌，`.is-visible` 状态明确设置暖白前景、金色点缀与深色背景；减少动态效果仍保留即时可读的正反面切换。
- `assetTierWindow` 只生成当前件数附近三档，调用 `fixedAssetCoins` 复用固定资产的唯一计算来源。套装累计档为 2/3/4/5 件，之后每件额外 +30；摘要使用 `asset.itemCount`，因而收藏家私密虚拟件数也会与其实际终局加成一致。
- `tools/smoke.mjs` 已保存私密操作手机/横屏、资产摘要、背包和余额翻牌截图；全量烟测涵盖 3/6/10 人、全 Bot、刷新隐私、教程、身份、竞购与终局路径。

### Bot 绑票与拍品竞购

- `decideBotKidnapResponse` 只读取被绑 Bot 自己的库存、余额、拍品和稳定行为参数，比较赎金与实际资产损失后决定保住或放弃拍品。
- `decideBotAssetAuctionOffer` 仅依据自己的藏品与公开各轮拍品类别赢家记录发起下一轮竞购；它避开收藏家目标类，并把起拍价设在自身资产损失之上，以减少低价资敌。
- `CollectionBook` 复用 `IDENTITY_DEFINITIONS`、`CARD_DEFINITIONS`、`ITEM_POOL` 与 `ASSET_CATEGORY_CONFIGS` 作为图鉴唯一数据源；图鉴不读取对局存档，也不影响任何游戏状态。

### Bot 拍品市场策略（v26）

- `BotBehavior.assetMarketBias` 是随 `gameId:playerId` 稳定生成的隐藏人格参数；存档迁移会与其他行为参数一并补齐。它只用于 Bot 自己的出售、竞购与赎金取舍，不会显示给玩家。
- `decideBotAssetAuctionBids` 可选接收公开回合摘要，按类别出现次数、不同赢家和公开高总下注构造 `marketHeat`。在套装、收藏家类别或热门类别有充分价值时，单回合最多一张拍品可按小概率获得高价上限与较激进报价；其随机源是会话种子，刷新可复现。
- `decideBotAssetAuctionOffer` 以市场倾向抽取每回合卖货意愿，仍保留收藏家目标类别保护、自身套装损失、竞争对手受益和最低保本价约束。`decideBotKidnapResponse` 同时加入市场倾向、资产专注与稳定正态扰动。
- `BotObservation.humanOpponentIds` 只包含公开的座位控制器类型。仅专家绑匪有 38% 概率随机挑一名真人加 3.8 个百分点的目标评分，作为轻微戏剧性偏向，不读取任何真人私密状态。
