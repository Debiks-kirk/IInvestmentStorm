# 调研证据

> 外部资料与待核验事项。最后更新：2026-08-04。

相关文档：[项目记忆](memory.md) · [计划](plan.md) · [进度](progress.md) · [技术基线](tech.md)

## 已核验发现

- 游戏机制依据项目内 `rule.txt` 及用户确认的实施计划。
- Render 官方静态站点教程确认 Vite 站点可使用 `npm ci && npm run build` 构建并发布 `dist`：[Static sites - when and how](https://render.com/tutorials/web-service-vs-static-site/static-sites)。证据强度：官方一手资料；适用于当前 Blueprint。
- Render 官方文档确认 SPA 客户端路由可将 `/*` rewrite 到 `/index.html`：[Deploy a Create React App Static Site](https://render.com/docs/deploy-create-react-app)。证据强度：官方一手资料；当前应用虽无 URL 路由，保留 rewrite 可支持刷新和未来扩展。

## 待确认问题

- 首轮多人线下试玩后，核验默认 30 金币、6 轮和各人数奖励倍率的节奏与领先者优势。
