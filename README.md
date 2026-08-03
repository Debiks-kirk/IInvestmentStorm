# 谁在加码

一款供 3–10 人共用一台设备游玩的密封竞价聚会游戏。玩家秘密下注并预测赢家；并列出价者失去排名奖励，最终金币最多者获胜。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

验证完整项目：

```bash
npm test
npm run test:smoke
npm run build
```

`test:smoke` 使用本机 Chrome 或 Edge 自动完成 3、6、10 人对局，并检查刷新隐私保护和移动端横向溢出。

## 部署到 Render

仓库内的 `render.yaml` 已声明静态站点：构建命令为 `npm ci && npm run build`，发布目录为 `dist`，并包含 SPA 回退规则。将仓库连接到 Render 后按 Blueprint 创建服务即可。

游戏不需要后端、数据库或环境变量。未完成对局只保存在当前浏览器的 `localStorage` 中。

## 项目状态

长期目标与决策见 [memory.md](memory.md)，里程碑见 [plan.md](plan.md)，实现基线见 [tech.md](tech.md)，可审计进展见 [progress.md](progress.md)。

