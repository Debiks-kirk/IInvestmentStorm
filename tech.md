# 技术基线

> 当前有效的架构、数据流与关键技术决策。最后更新：2026-08-03。

相关文档：[项目记忆](memory.md) · [计划](plan.md) · [进度](progress.md) · [调研](research.md)

## 目标与方案

- React + TypeScript + Vite 单页应用；原生 CSS；Render Static Site。
- 无后端、数据库、账号或网络对局，状态保存在版本化 `localStorage` 中。

## 关键设计

- 显式阶段：`roundIntro → handoff → privateTurn → revealReady → roundResult → finalResult`。
- 结算为无 UI 依赖的纯函数；金币均以 0.5 金币为一个整数单位。
- 开局一次性生成物品牌堆和公平余数顺序，恢复对局时不重新随机。
- 私密页不作为可信恢复入口；刷新后一律降级到对应玩家的传递页。

## 实现状态

- 工程初始化中，规则引擎和界面尚待实现。

## 开放技术问题

- 需要在依赖安装后验证当前工具链的类型检查与生产构建。

