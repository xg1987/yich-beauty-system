# GitHub Actions 自动部署指南

本项目已配置 GitHub Actions 实现 **Push 到 main 自动部署生产** + **PR 自动生成预览环境**。

## 1. 前置准备（必须做一次）

### 创建 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **My Profile** → **API Tokens** → **Create Token**
3. 选择 **Custom token**（推荐）
4. 权限配置如下：

   | 资源类型          | 权限     | 范围                  |
   |-------------------|----------|-----------------------|
   | Cloudflare Pages  | Edit     | 所有账户              |
   | Account Settings  | Read     | 所有账户              |

5. 点击 **Create Token**，复制生成的 Token（只会显示一次）

### 在 GitHub 中配置 Secrets

1. 打开本仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. 名称填写：`CLOUDFLARE_API_TOKEN`
4. 值粘贴刚才复制的 Token
5. 保存

---

## 2. 部署行为说明

| 触发方式       | 部署目标     | 说明 |
|----------------|--------------|------|
| Push 到 `main` | 生产环境     | 自动部署到 `https://yich-beauty-system-22u.pages.dev` |
| 创建 / 更新 PR | 预览环境     | 自动生成独立预览地址，PR 中会自动评论链接 |

---

## 3. 注意事项

- **D1 数据库迁移不会自动执行**  
  目前仍然需要手动在本地执行：
  ```bash
  npm run d1:migrate:remote
  ```
  建议上线前先在本地用 `dev:cloudflare` 验证通过后再部署。

- 构建过程已包含 `tsc --noEmit` 类型检查，类型错误会直接导致部署失败。

- 推荐在合并 PR 前先观察预览环境是否正常。

---

## 4. 后续优化建议（可选）

- 可以增加一个单独的 `d1-migrate` 手动触发的工作流
- 可以为不同环境配置不同的 D1 绑定（开发 / 生产）
- 可以加入 `verify:api` 或其他冒烟测试作为部署 gate

如需进一步自动化（例如自动迁移检查），可以随时告诉我。
