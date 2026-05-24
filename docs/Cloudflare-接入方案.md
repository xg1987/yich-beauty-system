# 一宸 YiCh 美业系统 Cloudflare 接入方案

## 当前结论

Web 管理端运行在 Cloudflare Pages，后端 `/api/*` 通过 Pages Functions 运行在 Cloudflare Workers runtime，数据存储使用 Cloudflare D1。

## Pages 部署

本项目已加入 Wrangler 和 Pages 配置：

- 项目名：`yich-beauty-system`
- 线上地址：`https://yich-beauty-system-22u.pages.dev`
- 构建命令：`npm run build`
- 输出目录：`dist`
- SPA 回退：`public/_redirects`
- 安全响应头：`public/_headers`
- D1 绑定名：`DB`
- D1 数据库：`yich-beauty-db`

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

线上环境使用同域 `/api/*`，由 Pages Functions 处理。前端仍支持通过 `VITE_API_BASE_URL` 指向外部 API：

```bash
VITE_API_BASE_URL=https://api.yich.example.com
```

本地 Vite 开发时该变量留空，前端会继续走 Vite 代理的 `/api`；Cloudflare 部署时也留空，让页面直接请求同域 `/api`。

## D1 迁移

本项目包含 D1 migration：

```bash
npm run d1:migrate:local
npm run d1:migrate:remote
```

## 本地 Cloudflare runtime 验证

```bash
npm run build
npm run d1:migrate:local
npm run dev:cloudflare
```

另开终端验证：

```bash
API_BASE_URL=http://localhost:8788 npm run verify:cloudflare-api
```

## 线上验证

```bash
npm run d1:migrate:remote
npm run deploy:pages
API_BASE_URL=https://yich-beauty-system-22u.pages.dev npm run verify:cloudflare-api
```

Cloudflare 后端复用 `src/domain/business.ts` 的业务规则，D1 读写层在 `src/cloudflare/d1Database.ts`，入口在 `functions/api/[[path]].ts`。
