# 第一阶段 MVP 开发说明

## 当前实现范围

当前仓库已经完成 Web 管理后台的第一版可运行原型，覆盖单店经营闭环：

- 登录演示入口
- 工作台
- 预约管理
- 开单收银
- 客户会员
- 项目商品
- 员工提成
- 库存管理
- 报表分析
- 系统设置
- 订单退款
- 部分退款
- 会员卡流水
- 会员退卡
- 操作日志
- 项目次数卡
- 预约冲突检测
- 财务日结
- 员工数据范围权限
- 多员工协作提成拆分
- 员工不可预约时段

## 当前数据方式

第一版主数据源已经切到本地 HTTP API + SQLite。浏览器 `localStorage` 版 hook 仅保留为离线原型备用：

- 门店、账号、角色
- 员工
- 客户
- 会员卡
- 服务项目
- 商品/耗材
- 预约
- 员工不可预约时段
- 订单
- 提成
- 库存流水
- 退款记录
- 会员卡流水
- 操作日志
- 财务日结

当前代码已经把类型、种子数据、本地存储和业务规则拆开：

```text
src/domain/types.ts       核心业务类型
src/domain/seed.ts        演示种子数据
src/domain/business.ts    开单、库存、报表等业务规则
src/domain/utils.ts       日期、金额、ID 工具
src/hooks/useLocalData.ts 本地持久化数据 hook，保留为离线原型备用
src/hooks/useApiData.ts   API 数据 hook，当前 Web 后台主数据源
src/api/client.ts         前端 API 客户端
src/domain/auth.ts        角色、权限、视图访问规则
server/auth.ts            演示账号、登录、内存会话
server/database.ts        SQLite 数据库、建表、读写、种子数据
server/api.ts             本地 HTTP API 服务
server/start.ts           API 启动入口
```

## 已跑通的核心流程

```text
登录后台
  -> 查看工作台
  -> 新增/查看预约
  -> 锁定员工不可预约时段
  -> 开单收银
  -> 生成订单
  -> 自动扣减服务耗材/销售商品库存
  -> 自动生成员工服务提成，支持协作员工拆分
  -> 报表同步更新实收、订单数、提成、支付方式
  -> 退款时冲销提成、回滚库存、恢复会员卡、记录日志
  -> 部分退款时保留订单并按剩余实收调整提成
  -> 会员退卡时清零余额/次数并记录退卡流水
  -> 财务按营业日生成日结
```

## 本地运行

```bash
npm install
npm run dev:api
npm run dev
```

打开：

```text
http://localhost:5173/
```

也可以用一个命令同时启动前后端：

```bash
npm run dev:full
```

默认演示登录：

```text
账号：admin@demo.local
密码：yich-demo
角色：店长
```

## 构建验证

```bash
npm run build
```

当前已验证构建通过。

## 业务规则验证

```bash
npm run verify:business
```

当前验证覆盖：

- 微信开单生成订单
- 服务耗材自动扣减
- 销售商品自动扣减
- 储值卡余额扣减
- 次数卡扣次
- 余额不足拦截
- 员工提成生成、全额退款冲销、部分退款调整
- 多员工协作提成拆分
- 报表汇总
- 手动库存入库
- 会员卡流水
- 退卡流水
- 操作日志
- 项目次数卡限制
- 预约时间冲突检测
- 员工不可预约时段拦截
- 财务日结

## API/数据库验证

```bash
npm run verify:api
```

当前验证覆盖：

- API 健康检查
- 登录鉴权
- 角色权限拦截
- 员工数据范围过滤
- SQLite 自动建表和种子数据
- 新增客户
- 新增预约
- 员工不可预约时段
- 开单收银
- 退款冲销
- 部分退款
- 会员退卡
- 服务耗材扣减
- 销售商品扣减
- 储值卡扣余额
- 员工提成生成
- 多员工协作提成拆分
- 库存入库
- 多请求持久化
- 会员卡流水
- 操作日志
- 财务日结
- 重置演示数据

## 本地 API 运行

```bash
npm run dev:api
```

默认地址：

```text
http://localhost:8787
```

当前 API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | 登录并返回会话 |
| GET | `/api/auth/me` | 当前登录会话 |
| GET | `/api/auth/demo-users` | 演示账号列表 |
| GET | `/api/data` | 获取完整门店数据 |
| POST | `/api/reset` | 重置演示数据 |
| POST | `/api/checkout` | 开单收银 |
| POST | `/api/orders/:id/refund` | 订单退款 |
| POST | `/api/member-cards/:id/refund` | 会员退卡 |
| POST | `/api/inventory/adjust` | 库存调整 |
| POST | `/api/appointments` | 新增预约 |
| POST | `/api/staff-unavailable-slots` | 锁定员工不可预约时段 |
| PATCH | `/api/appointments/:id` | 更新预约状态 |
| POST | `/api/customers` | 新增客户 |
| POST | `/api/member-cards` | 开卡 |
| POST | `/api/services` | 新增服务项目 |
| POST | `/api/products` | 新增商品/耗材 |
| POST | `/api/commissions/settle` | 结算提成 |
| POST | `/api/daily-close` | 生成财务日结 |

SQLite 数据库文件默认写入：

```text
data/yich-system.sqlite
```

## 下一步建议

### 1. 数据库/API

已经完成本地 SQLite、HTTP API、登录会话和前端 API 数据源切换。下一步需要继续强化权限中间件、拆分页面模块，并把 Cloudflare 原生后端迁移到 Workers + D1。

当前已补齐第一版全额退款、部分退款、提成冲销、协作员工提成拆分、会员退卡、会员卡流水、操作日志、服务端权限拦截、员工数据范围过滤、项目次数卡、预约冲突检测、员工不可预约时段和财务日结。后续还需要把权限从“接口级/角色级”继续细化到字段级。

### 2. 页面拆分

当前为了快速推进，页面集中在 `src/App.tsx`。进入后端开发前建议拆分：

```text
src/
  modules/
    dashboard/
    appointments/
    pos/
    customers/
    catalog/
    staff/
    inventory/
    reports/
    settings/
  shared/
    components/
    data/
    utils/
```

### 3. 增强第一阶段业务

- 会员卡转卡
- 复杂排班班次和请假审批
- Cloudflare Workers + D1 后端迁移
- 导入真实项目/客户数据
