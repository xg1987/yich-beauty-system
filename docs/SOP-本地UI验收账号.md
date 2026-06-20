# 本地 UI 验收账号 SOP

## 适用范围

- 只用于本地 `localhost` UI 验收。
- 不用于线上 `https://zhurongkftech.com/`。
- 不要为了看 UI 去猜生产账号密码，也不要重置生产员工密码。

## 固定本地账号

| 角色 | 账号 | 密码 | 用途 |
| --- | --- | --- | --- |
| 店长/老板端 | `manager@test.local` | `test-password` | 看店长工作台、今日预约排班表、管理入口、收银/预约/会员相关店长视角 |
| 员工端 | `therapist@test.local` | `test-password` | 看员工工作台、员工权限、员工端预约/收银/客户相关布局 |

## 固定规则

- 店长端 UI 问题，优先用 `manager@test.local / test-password`。
- 员工端 UI 问题，才用 `therapist@test.local / test-password`。
- 用户截图如果来自“今日预约排班表”“店长工作台”“今日经营/排班总览”，默认先用店长账号，不要误用员工账号。
- 如果本地登录失败，先检查本地 SQLite `data/yich-system.sqlite`，把账号修回上表，不要切到线上生产账号排查。
- 验证手机端布局时，优先使用 `390x844` 视口；必要时补测 `430x932`。

## 启动与登录

1. 确认本地 API：

```sh
curl -sS http://localhost:8787/api/health
```

2. 启动前端：

```sh
npm run dev
```

如果 `5173` 被占用，Vite 会自动换端口，以终端输出为准。

3. 打开本地页面后，按本次要看的角色登录固定账号。

## 注意

- 这组账号是本地 UI 验收基础设施，不代表线上真实账号。
- 除非用户明确要求，不要改生产 D1 密码。
- 做完 UI 修改后，必须让浏览器里实际页面显示变化；只跑 `npm run build` 不算完成 UI 验收。
