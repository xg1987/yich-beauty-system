# 一宸 YiCh 美业系统 Cloudflare 接入方案

## 当前结论

第一步先把 Web 管理端接入 Cloudflare Pages。当前后端使用 Node.js `node:sqlite` 和本地 SQLite 文件，不能直接部署到 Cloudflare Workers；如果后端也要完全跑在 Cloudflare，需要迁移为 Workers + D1。

## Pages 部署

本项目已加入 Wrangler 和 Pages 配置：

- 项目名：`yich-beauty-system`
- 线上地址：`https://yich-beauty-system.pages.dev`
- 构建命令：`npm run build`
- 输出目录：`dist`
- SPA 回退：`public/_redirects`
- 安全响应头：`public/_headers`

本机登录 Cloudflare：

```bash
npm run cf:login
```

部署前端：

```bash
npm run deploy:pages
```

如果通过 Cloudflare Dashboard 创建 Pages 项目，配置如下：

- Framework preset：Vite
- Build command：`npm run build`
- Build output directory：`dist`
- Environment variable：`VITE_API_BASE_URL`

## API 接入方式

前端现在支持通过 `VITE_API_BASE_URL` 指向远程 API：

```bash
VITE_API_BASE_URL=https://api.yich.example.com
```

本地开发时该变量留空，前端会继续走 Vite 代理的 `/api`。部署到 Cloudflare Pages 后，如果后端仍在 Node 服务器上，需要把 `VITE_API_BASE_URL` 设置为 Node API 的公网 HTTPS 地址。

## 后端上 Cloudflare 的下一步

Cloudflare 原生后端建议做成：

- Cloudflare Workers：承载 `/api/*`
- Cloudflare D1：替代本地 SQLite 文件
- Wrangler D1 migrations：管理数据表
- Pages 环境变量：绑定同域 API 或 Worker 路由

迁移时要把 `server/database.ts` 的 `node:sqlite` 读写层替换为 D1 binding，业务规则可继续复用 `src/domain/business.ts`。
