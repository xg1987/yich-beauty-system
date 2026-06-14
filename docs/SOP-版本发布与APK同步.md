# 版本发布与 APK 同步 SOP

## 核心规则

- 软件版本号唯一来源是 `package.json` 的 `version`。
- 每次更新软件版本号，必须同步重新生成安卓 APK。
- 标准发布命令只能使用 `npm run deploy:pages`。
- 不允许直接运行 `wrangler pages deploy dist` 发布，除非本次版本更新后已经重新执行过 `npm run android:apk`，并确认 `dist` 里包含最新 APK。
- 每次推送、部署、更新版本号之前，必须在真实浏览器里完成 Web、平板、手机三端 UI 验收；不能只看 `npm run build`、不能只看截图、不能只测单一宽度。
- 正式版本 UI 不展示内部实现说明、调试提示或“全系统查询”等技术表述；员工端、店长端只展示业务可操作信息。
- 推荐、筛选、费用、记录等模块必须用客户能理解的业务语言，不解释系统如何推断、兜底或查询。

## 自动同步机制

- `npm run deploy:pages` 会先执行 `npm run android:apk`，再部署 Cloudflare Pages。
- `npm run android:apk` 会重新构建网页、同步 Capacitor、生成 APK，并把 APK 写入 `public/zhurongkftech-app.apk`。
- APK 写入后会再次执行网页构建，确保 `dist/zhurongkftech-app.apk` 是最新 APK。
- 打包 APK 前，脚本会临时移出旧 APK，防止旧 APK 被 Capacitor 打进新 APK 里，导致安装包体积递增。
- Android `versionName` 和 `versionCode` 从 `package.json.version` 自动生成，不再手动维护。

## 发布前检查

1. 确认 Cloudflare 登录账号：

```sh
npx wrangler whoami
```

必须是 `xionggang1243@gmail.com`。

2. 更新 `package.json` 的 `version`。

3. 重新生成 APK：

```sh
npm run android:apk
```

4. 检查 APK 版本号：

```sh
$ANDROID_HOME/build-tools/35.0.0/aapt dump badging public/zhurongkftech-app.apk | head
```

输出里的 `versionName` 必须等于 `package.json.version`。

5. 检查 APK 签名：

```sh
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --verbose public/zhurongkftech-app.apk
```

6. 检查业务规则：

```sh
npm run verify:business
```

7. 检查 API 与包体：

```sh
npm run verify:api
npm run verify:bundle
```

8. 真实浏览器三端验收：

必须使用真实浏览器打开本地页面，例如 `http://localhost:5173`，按本次改动涉及的真实角色和页面路径测试。Codex 操作时优先使用 in-app browser；人工验收时使用 Chrome/Safari 真实浏览器。以下三端都必须测：

- Web 端：桌面宽度，建议 `1280x720` 或当前桌面浏览器宽度。
- 平板端：建议 `820x1180`。
- 手机端：建议 `390x844`，必要时补测 `430x932`。

每个端至少确认：

- 页面能打开，不白屏，不长期停留在加载页。
- 顶部、底部导航、弹窗、按钮、输入框不遮挡、不重叠。
- 本次修改涉及的三个最关键按钮或入口都能点击，并出现正确结果。
- 员工端、店长端、老板端要按实际权限测试，不能只用管理员账号替代。
- 如果是更新版本相关改动，必须确认不会自动刷新打断使用；只有用户点“立即更新”或“重新进入”才允许刷新。

三端真实浏览器验收不通过时，禁止 `git push`、禁止 `npm run deploy:pages`。

9. 发布：

```sh
npm run deploy:pages
```

## 发布后检查

- 访问下载页：`https://zhurongkftech.com/download`
- 检查 APK 下载地址：`https://zhurongkftech.com/zhurongkftech-app.apk`
- 检查服务版本：

```sh
curl -sS https://zhurongkftech.com/api/health
```

返回的版本必须等于本次发布的 `package.json.version`。

- 发布后再次用真实浏览器检查 Web、平板、手机三端关键页面，确认线上版本和本地验收一致。

## 当前 APK 地址

```text
https://zhurongkftech.com/zhurongkftech-app.apk
```
