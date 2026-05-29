# Admin 超级管理员端 - 功能规格

编写时间：2026-05-28  
状态：待实施  
目标：为平台级超级管理员提供多门店管理、系统配置、数据监控和审计能力。

## 一、Admin 账号

- 账号名：`admin` 或部署时自定义。
- 角色：`superadmin`。
- 创建方式：通过数据库 migration 或部署脚本预设。
- 密码：通过环境变量或安全初始化流程设置，不写入代码仓库。
- 登录方式：走统一登录入口，但不走邀请码流程。

所有 `/api/admin/*` 接口必须要求 `role = superadmin`。

## 二、Admin 全局看板 `/admin`

### 2.1 顶部统计卡片

| 指标 | 数据来源 |
| --- | --- |
| 平台门店总数 | `COUNT(storeProfiles)` |
| 活跃门店数 | 最近 7 天有订单或登录行为的门店 |
| 平台客户总数 | 跨门店 `COUNT(customers)` |
| 平台订单总数 | 跨门店 `COUNT(orders)` |
| 平台总营收 | `SUM(orders.paidAmount)` |
| 今日新增门店 | `storeProfiles.createdAt = today` |

### 2.2 最近门店列表

| 列 | 说明 |
| --- | --- |
| 门店名称 | `storeProfiles.name` |
| 老板 | `role = owner` 的 `authUser.name` |
| 客户数 | 该门店客户数量 |
| 订单数 | 该门店订单数量 |
| 状态 | 正常 / 停用 / 试用 |
| 创建时间 | `storeProfiles.createdAt` |

### 2.3 系统健康状态

展示：

- D1 数据库连接状态。
- Cloudflare Pages Functions 状态。
- 最近一次部署版本。
- 最近异常日志。
- 今日 API 请求量和错误量。

## 三、门店列表 `/admin/shops`

### 3.1 功能

- 搜索：按门店名称、老板名、手机号。
- 筛选：全部 / 正常 / 停用 / 试用。
- 查看门店详情。
- 启用 / 停用门店。
- 查看门店操作日志。

### 3.2 门店详情弹窗

显示：

- 基本信息：名称、地址、电话、创建时间。
- 老板账号信息。
- 员工数量。
- 客户数量。
- 订单数量。
- 最近 10 条操作日志。
- 最近活跃时间。

## 四、系统配置 `/admin/config`

| 配置项 | key | 默认值 | 说明 |
| --- | --- | --- | --- |
| 邀请码有效期 | `invite_default_days` | `7` | 默认有效天数 |
| 开放注册 | `allow_registration` | `true` | 是否允许新门店注册 |
| 维护模式 | `maintenance_mode` | `false` | 开启后普通用户看到维护页面 |
| 系统公告 | `system_announcement` | 空字符串 | 登录页或工作台展示 |

## 五、审计日志 `/admin/audit`

记录所有 Admin 关键操作：

- 登录 / 登出。
- 查看门店数据。
- 启用 / 停用门店。
- 修改系统配置。
- 导出日志。
- 访问敏感数据。

支持：

- 时间范围筛选。
- 操作类型筛选。
- 门店筛选。
- Admin 操作人筛选。
- 导出 CSV。

## 六、Admin 数据模型

在 `src/domain/types.ts` 中新增：

```ts
export type AdminRole = "superadmin";

export type ShopSummary = {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  staffCount: number;
  customerCount: number;
  orderCount: number;
  status: "正常" | "停用" | "试用";
  createdAt: string;
  lastActiveAt: string;
};

export type SystemConfig = {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedAt: string;
};

export type AdminAuditLog = {
  id: string;
  adminId: string;
  action: string;
  targetShopId?: string;
  detail: string;
  createdAt: string;
};

export type PlatformStats = {
  totalShops: number;
  activeShops: number;
  totalCustomers: number;
  totalOrders: number;
  totalRevenue: number;
  todayNewShops: number;
  todayNewOrders: number;
};
```

## 七、Admin API

```text
GET    /api/admin/stats                    平台统计
GET    /api/admin/shops                    门店列表
GET    /api/admin/shops/:id                门店详情
PATCH  /api/admin/shops/:id/status         启用 / 停用门店
GET    /api/admin/shops/:id/data           查看门店完整数据
GET    /api/admin/config                   系统配置列表
PATCH  /api/admin/config/:key              修改配置
GET    /api/admin/audit-logs               审计日志
POST   /api/admin/audit-logs/export        导出日志
```

权限要求：

- 所有 `/api/admin/*` 接口必须校验 `role = superadmin`。
- 访问门店完整数据必须写入 `adminAuditLogs`。
- 修改配置和停用门店必须写入 `adminAuditLogs`。

## 八、数据库迁移

建议新增文件：`migrations/0014_admin_system.sql`

```sql
-- 超级管理员支持
ALTER TABLE sessions ADD COLUMN shopId TEXT;

CREATE TABLE IF NOT EXISTS systemConfigs (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adminAuditLogs (
  id TEXT PRIMARY KEY,
  adminId TEXT NOT NULL,
  action TEXT NOT NULL,
  targetShopId TEXT,
  detail TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shopStatus (
  shopId TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '正常',
  updatedAt TEXT NOT NULL
);

-- 预设超级管理员账号：
-- 密码不能写死在 migration 中，需通过部署环境变量或安全初始化流程设置。

INSERT OR IGNORE INTO systemConfigs (id, key, value, description, updatedAt) VALUES
  ('cfg-001', 'invite_default_days', '7', '邀请码默认有效天数', datetime('now')),
  ('cfg-002', 'allow_registration', 'true', '是否开放门店注册', datetime('now')),
  ('cfg-003', 'maintenance_mode', 'false', '系统维护模式', datetime('now')),
  ('cfg-004', 'system_announcement', '', '系统公告内容', datetime('now'));
```

注意：如果 `sessions` 已经存在 `shopId` 字段，migration 需要改成兼容写法，避免重复添加字段。
