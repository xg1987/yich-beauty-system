# YiCh Beauty System - 框架设计方案 v2.0

编写时间：2026-05-28  
状态：待实施  
目标：将当前 `App.tsx` 单文件架构重构为多端、多角色、可维护的正式产品框架。

## 一、系统定位

一宸 YiCh 美业门店系统包含三个端，但不拆成三个独立项目。三端共用同一个 React 应用、同一套 API、同一个 Cloudflare Pages 部署，通过路由和角色权限区分。

```text
┌──────────────────────────────────────────────────────────┐
│                    统一入口（门户）                        │
│              邀请码注册 / 登录 / 角色识别                   │
│                         │                                 │
│            ┌────────────┼────────────────┐                │
│            ▼            ▼                ▼                │
│    ┌──────────┐  ┌──────────────┐  ┌──────────┐          │
│    │ 客户端    │  │ 门店工作台     │  │ Admin    │          │
│    │ C端       │  │ B端           │  │ 超管端    │          │
│    │          │  │              │  │          │          │
│    │ 线上预约  │  │ 老板视图       │  │ 多门店    │          │
│    │ 我的卡项  │  │ 经营看板       │  │ 全局配置  │          │
│    │ 消费记录  │  │ 员工管理       │  │ 数据监控  │          │
│    │ 优惠活动  │  │ 财务报表       │  │ 系统审计  │          │
│    │          │  │              │  │          │          │
│    │          │  │ 员工视图       │  │          │          │
│    │          │  │ 我的排班       │  │          │          │
│    │          │  │ 我的提成       │  │          │          │
│    │          │  │ 服务开单       │  │          │          │
│    └──────────┘  └──────────────┘  └──────────┘          │
└──────────────────────────────────────────────────────────┘
```

| 端 | 用户 | 入口方式 | 布局风格 |
| --- | --- | --- | --- |
| C端（客户） | 门店顾客 | 分享链接 `/store/:shareCode` | 移动优先、品牌色、大图大字 |
| B端（门店工作台） | 老板、店长、技师、前台、财务 | 登录 / 邀请码注册 | 侧边栏 + 顶栏 + 底部工作栏 |
| Admin端（超级管理员） | 平台运营 | 特殊账号登录 | 宽屏数据密集、灰色系 |

关键设计决策：B端老板和员工共用同一套系统，但首页和可见模块不同，不做两个独立应用。

## 二、角色权限体系

### 2.1 角色清单

| 角色 | role 值 | 注册方式 | 首页 |
| --- | --- | --- | --- |
| 超级管理员 | `superadmin` | 系统预设账号 | Admin 全局看板 |
| 老板 | `owner` | 自行注册门店 | 经营看板 |
| 店长 | `manager` | 邀请码注册 | 店长工作台 |
| 美容师 | `therapist` | 邀请码注册 | 我的服务台 |
| 前台 | `frontdesk` | 邀请码注册 | 到店工作台 |
| 财务 | `finance` | 邀请码注册 | 财务工作台 |

### 2.2 各角色可见模块

| 模块 | superadmin | owner | manager | therapist | frontdesk | finance |
| --- | --- | --- | --- | --- | --- | --- |
| Admin 全局看板 | 是 | 否 | 否 | 否 | 否 | 否 |
| 门店列表管理 | 是 | 否 | 否 | 否 | 否 | 否 |
| 系统配置 | 是 | 否 | 否 | 否 | 否 | 否 |
| 经营看板 | 否 | 是 | 是 | 否 | 否 | 否 |
| 预约管理 | 否 | 是 | 是 | 本人 | 是 | 否 |
| 收银开单 | 否 | 是 | 是 | 是 | 是 | 否 |
| 客户会员 | 否 | 是 | 是 | 本人客户 | 是 | 否 |
| 项目商品 | 否 | 是 | 是 | 否 | 否 | 否 |
| 库存管理 | 否 | 是 | 是 | 否 | 否 | 否 |
| 员工管理 + 邀请码 | 否 | 是 | 否 | 否 | 否 | 否 |
| 员工提成 | 否 | 是 | 是 | 本人 | 否 | 是 |
| 报表分析 | 否 | 是 | 是 | 否 | 否 | 是 |
| 审批中心 | 否 | 是 | 是 | 否 | 否 | 是 |
| 日结 / 反结 | 否 | 是 | 否 | 否 | 否 | 是 |
| 操作日志 | 否 | 是 | 否 | 否 | 否 | 否 |
| 门店设置 | 否 | 是 | 否 | 否 | 否 | 否 |
| 线上店铺设置 | 否 | 是 | 是 | 否 | 否 | 否 |

### 2.3 邀请码注册流程

老板登录后在管理中心生成人员邀请码，员工只能通过邀请码加入门店。

```text
老板注册门店
  │
  ▼
老板在「管理中心」生成邀请码
  │
  ├── 选择角色（店长 / 美容师 / 前台 / 财务）
  ├── 填写登录账号
  ├── 设置有效期
  │
  ▼
生成邀请码，复制或分享给员工
  │
  ▼
员工打开登录页，选择「邀请码加入」
  │
  ├── 输入邀请码
  ├── 设置姓名
  ├── 设置密码
  │
  ▼
系统验证邀请码，创建账号，绑定角色，进入对应视图
```

规则：

- 邀请码是唯一的员工注册路径，不允许员工自行注册。
- 邀请码有有效期，默认 7 天。
- 邀请码一次性使用，加入后即失效。
- 老板可以随时作废未使用的邀请码。
- 店长是否能邀请员工需要由权限配置决定，默认仅老板可邀请。

## 三、前端目录结构

### 3.1 总览

```text
src/
├── main.tsx
├── App.tsx                         # 路由分发器，目标缩减到 100-150 行
│
├── routes/
│   ├── index.tsx                   # 路由定义总表
│   ├── guards.tsx                  # 权限守卫组件
│   └── roleRoutes.ts               # 角色到可访问路径映射
│
├── layouts/
│   ├── PublicLayout.tsx            # C端布局
│   ├── WorkbenchLayout.tsx         # B端工作台布局
│   └── AdminLayout.tsx             # Admin 布局
│
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   ├── RegisterStorePage.tsx
│   │   └── JoinInvitePage.tsx
│   │
│   ├── public/
│   │   ├── StorefrontPage.tsx
│   │   └── BookingPage.tsx
│   │
│   ├── owner/
│   │   ├── OwnerDashboard.tsx
│   │   ├── StaffManage.tsx
│   │   ├── ShopSettings.tsx
│   │   └── OnlineStorefront.tsx
│   │
│   ├── workbench/
│   │   ├── ManagerDashboard.tsx
│   │   ├── TherapistDashboard.tsx
│   │   ├── FrontdeskDashboard.tsx
│   │   └── FinanceDashboard.tsx
│   │
│   ├── shared/
│   │   ├── Appointments.tsx
│   │   ├── Cashier.tsx
│   │   ├── Customers.tsx
│   │   ├── Catalog.tsx
│   │   ├── Inventory.tsx
│   │   ├── StaffCommissions.tsx
│   │   ├── Reports.tsx
│   │   ├── Approvals.tsx
│   │   └── OperationLogs.tsx
│   │
│   └── admin/
│       ├── AdminDashboard.tsx
│       ├── ShopList.tsx
│       ├── SystemConfig.tsx
│       └── AuditLogs.tsx
│
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Textarea.tsx
│   │   ├── Select.tsx
│   │   ├── CheckboxGroup.tsx
│   │   ├── DataTable.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   ├── Tabs.tsx
│   │   ├── DatePicker.tsx
│   │   ├── EmptyState.tsx
│   │   └── LoadingSkeleton.tsx
│   │
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Topbar.tsx
│   │   ├── Workbar.tsx
│   │   ├── PageHero.tsx
│   │   ├── PanelTitle.tsx
│   │   └── StatCard.tsx
│   │
│   └── business/
│       ├── CustomerCard.tsx
│       ├── AppointmentCard.tsx
│       ├── OrderReceipt.tsx
│       ├── MemberCardBadge.tsx
│       ├── StaffAvatar.tsx
│       ├── InviteCodeCard.tsx
│       ├── NotificationPanel.tsx
│       └── AccountMenu.tsx
│
├── hooks/
│   ├── useApiData.ts
│   ├── useAuth.ts
│   ├── usePermission.ts
│   ├── useTheme.ts
│   └── useResponsive.ts
│
├── domain/
│   ├── types.ts
│   ├── business.ts
│   ├── auth.ts
│   ├── utils.ts
│   ├── seed.ts
│   └── testFixture.ts
│
├── api/
│   └── client.ts
│
├── cloudflare/
│   ├── d1Types.ts
│   ├── d1Database.ts
│   └── auth.ts
│
└── styles/
    ├── design-tokens.css
    ├── global.css
    ├── layouts.css
    ├── components.css
    └── pages.css
```

### 3.2 技术原则

- 不做多个独立前端项目。
- 不引入 `react-router-dom`，当前阶段使用 hash-based route 即可。
- 不引入 Ant Design / MUI，保持 Cloudflare Pages 轻量部署。
- 不引入 Redux / MobX，现阶段 `useApiData` 足够。
- 不拆 `domain/business.ts`，业务核心先保持整体。
- 不改 `functions/api/[[path]].ts` 的接口结构，先拆前端。
- 每次只提取一个组件或一个页面，提取后立即验证。

## 四、三套 Layout

### 4.1 PublicLayout（C端客户）

```text
┌─────────────────────────────────┐
│ 品牌头部（店铺名 + Logo）        │
├─────────────────────────────────┤
│                                 │
│ 页面内容区                       │
│ 移动优先，居中显示               │
│                                 │
├─────────────────────────────────┤
│ 底部信息（门店电话 + 地址）       │
└─────────────────────────────────┘
```

特点：

- 移动优先，内容最大宽度约 480px。
- 品牌紫色 `#6d28d9` 为主色。
- 大圆角、大按钮、大字体。
- 无侧边栏，无底部工作栏。

### 4.2 WorkbenchLayout（B端门店工作台）

桌面端（大于等于 1024px）：

```text
┌──────┬──────────────────────────────────┐
│      │ 顶栏：系统名称 / 通知 / 头像       │
│ 侧边 ├──────────────────────────────────┤
│ 导航 │                                  │
│      │ 页面内容区                        │
│      │                                  │
└──────┴──────────────────────────────────┘
```

移动端（小于 1024px）：

```text
┌──────────────────────────────────┐
│ 顶栏：系统名称 / 通知 / 头像       │
├──────────────────────────────────┤
│                                  │
│ 页面内容区                        │
│                                  │
├──────────────────────────────────┤
│ 工作台  预约  收银  客户  管理     │
└──────────────────────────────────┘
```

侧边导航根据角色动态显示：

- 老板：全部菜单。
- 店长：预约、收银、客户、库存、提成、报表。
- 技师：我的预约、服务开单、我的提成。
- 前台：预约、收银、客户登记。
- 财务：报表、日结、提成结算、审批。

特点：

- 桌面端侧边栏可折叠。
- 移动端底部工作栏固定。
- 顶栏包含通知中心和账号菜单。
- 主题色为紫色 `#6d28d9`，背景为浅灰 `#f8f9fa`。

### 4.3 AdminLayout（超级管理员）

```text
┌────────────┬────────────────────────────────┐
│            │ 顶栏：Admin 后台 / 环境标识     │
│ Admin 导航 ├────────────────────────────────┤
│            │                                │
│ 看板       │ 页面内容区                      │
│ 门店       │ 宽屏、表格密集                  │
│ 配置       │                                │
│ 审计       │                                │
└────────────┴────────────────────────────────┘
```

特点：

- 始终显示侧边栏，Admin 默认面向桌面端。
- 灰色系为主，与 B 端视觉区分。
- 数据密集布局，小字体、紧凑间距。
- 顶栏显示当前 Admin 名称和环境标识（dev / staging / prod）。

## 五、UI 设计规范

### 5.1 Design Tokens

目标文件：`src/styles/design-tokens.css`

```css
:root {
  --brand-primary: #6d28d9;
  --brand-primary-hover: #5b21b6;
  --brand-primary-soft: rgba(109, 40, 217, 0.08);
  --brand-accent: #db2777;

  --success: #059669;
  --success-soft: rgba(5, 150, 105, 0.08);
  --warning: #d97706;
  --warning-soft: rgba(217, 119, 6, 0.08);
  --danger: #dc2626;
  --danger-soft: rgba(220, 38, 38, 0.08);
  --info: #2563eb;
  --info-soft: rgba(37, 99, 235, 0.08);

  --ink-900: #111827;
  --ink-800: #1f2937;
  --ink-700: #374151;
  --ink-600: #4b5563;
  --ink-500: #6b7280;
  --ink-400: #9ca3af;
  --ink-300: #d1d5db;
  --ink-200: #e5e7eb;
  --ink-100: #f3f4f6;
  --ink-50: #f9fafb;

  --bg-page: #f8f9fa;
  --bg-card: #ffffff;
  --bg-sidebar: #1e1b4b;
  --bg-sidebar-admin: #1f2937;

  --border-subtle: #e5e7eb;
  --border-focus: var(--brand-primary);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", "Fira Code", monospace;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
  --text-2xl: 22px;
  --text-3xl: 28px;

  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;

  --sidebar-width: 220px;
  --sidebar-collapsed: 64px;
  --topbar-height: 56px;
  --workbar-height: 56px;
}
```

### 5.2 组件样式标准

Button:

- 高度：36px（sm）/ 40px（md）/ 44px（lg）
- 圆角：`var(--radius-md)`
- 变体：primary / secondary / ghost / danger
- 禁用态：`opacity: 0.5` + `cursor: not-allowed`

Input / Select:

- 高度：40px
- 圆角：`var(--radius-md)`
- 边框：`1px solid var(--border-subtle)`
- 聚焦：`2px solid var(--border-focus)`
- 标签在上方，字号 `var(--text-sm)`，颜色 `var(--ink-600)`

Card:

- 圆角：`var(--radius-lg)`
- 边框：`1px solid var(--border-subtle)`
- 背景：`var(--bg-card)`
- 内边距：`var(--space-5)`

DataTable:

- 行高：44px
- 表头：背景 `var(--ink-50)`，字重 500
- 斑马纹：奇数行 `var(--bg-card)`，偶数行 `var(--ink-50)`
- Hover：背景 `var(--brand-primary-soft)`

Badge:

- 圆角：`var(--radius-full)`
- 内边距：2px 10px
- 字号：`var(--text-xs)`
- ok 使用绿色系，warn 使用橙色系，默认使用灰色系

Modal:

- 遮罩：`rgba(0, 0, 0, 0.4)`
- 容器：最大宽度 520px，居中
- 圆角：`var(--radius-xl)`
- 动画：fadeIn + scaleUp，250ms

Toast:

- 位置：右上角
- 最大 3 条堆叠
- 自动消失：3 秒
- 支持 success / error / info

### 5.3 不同角色的视觉差异

| 端 / 角色 | 视觉方向 |
| --- | --- |
| 老板端 | 深色侧边栏 + 数据看板风格 + 宽松间距 |
| 员工端 | 浅色简洁 + 大按钮 + 高信息密度 |
| C端客户 | 品牌色为主 + 移动优先 + 大图大字 |
| Admin端 | 紧凑数据密集 + 灰色系 + 功能优先 |

## 六、实施步骤

### Step 1：创建目录骨架（Day 1）

```bash
mkdir -p src/routes
mkdir -p src/layouts
mkdir -p src/pages/auth
mkdir -p src/pages/public
mkdir -p src/pages/owner
mkdir -p src/pages/workbench
mkdir -p src/pages/shared
mkdir -p src/pages/admin
mkdir -p src/components/layout
mkdir -p src/components/business
mkdir -p src/styles
mkdir -p docs/architecture
```

每个新文件先 `export default` 空组件，占位不写业务逻辑。

### Step 2：从 App.tsx 提取通用组件（Day 2-3）

提取顺序：

1. `src/components/ui/Select.tsx`
2. `src/components/ui/Badge.tsx`
3. `src/components/ui/CheckboxGroup.tsx`
4. `src/components/ui/DataTable.tsx`
5. `src/components/ui/Input.tsx`
6. `src/components/ui/Modal.tsx`
7. `src/components/ui/Toast.tsx`
8. `src/components/layout/PageHero.tsx`
9. `src/components/layout/PanelTitle.tsx`
10. `src/components/layout/StatCard.tsx`
11. `src/components/business/NotificationPanel.tsx`
12. `src/components/business/AccountMenu.tsx`

提取规则：

- 每个组件一个文件。
- 在组件文件内 export 组件。
- 在 `App.tsx` 中改为 import 引用。
- 保持 props 类型不变。
- 每提取一个组件，运行验证。

### Step 3：提取页面组件（Day 4-6）

提取顺序：

1. `src/pages/shared/Appointments.tsx`
2. `src/pages/shared/Cashier.tsx`
3. `src/pages/shared/Customers.tsx`
4. `src/pages/shared/Catalog.tsx`
5. `src/pages/shared/Inventory.tsx`
6. `src/pages/shared/StaffCommissions.tsx`
7. `src/pages/shared/Reports.tsx`
8. `src/pages/shared/Approvals.tsx`
9. `src/pages/shared/OperationLogs.tsx`
10. `src/pages/auth/LoginPage.tsx`
11. `src/pages/public/StorefrontPage.tsx`
12. `src/pages/owner/OwnerDashboard.tsx`
13. `src/pages/owner/StaffManage.tsx`
14. `src/pages/owner/ShopSettings.tsx`

每提取一个页面：

1. 复制代码到新文件。
2. 调整 import 路径。
3. 在 `App.tsx` 中改为 import。
4. 运行本地验证。
5. 单独提交。

### Step 4：搭建路由系统（Day 7）

`src/routes/index.tsx` 实现逻辑：

1. 读取 `window.location.hash`。
2. 匹配路由表。
3. 检查登录状态。
4. 检查角色权限。
5. 渲染对应 Layout + Page。

### Step 5：搭建三套 Layout（Day 8-9）

1. `PublicLayout`：品牌头部 + 内容区 + 底部信息。
2. `WorkbenchLayout`：侧边栏 + 顶栏 + 内容区 + 底部工作栏。
3. `AdminLayout`：Admin 侧边栏 + 顶栏 + 内容区。

响应式断点：768px / 1024px / 1280px。

### Step 6：实现 Admin 端（Day 10-12）

1. 新增 migration：`0014_admin_system.sql`。
2. 新增 API：`/api/admin/*`。
3. 新建 Admin 四个页面。
4. 创建 `superadmin` 预设账号。
5. 测试 Admin 登录、全局看板、门店管理。

### Step 7：完善 UI 样式（Day 13-15）

1. 统一所有组件使用 `design-tokens.css` 变量。
2. 拆分现有 `styles.css`。
3. 实现日 / 夜间主题切换。
4. 做移动端适配测试。
5. 优化打印小票样式。

## 七、实施注意事项

不要做：

- 不要引入 `react-router-dom`，当前 hash 路由足够。
- 不要引入 Ant Design / MUI。
- 不要引入 Redux / MobX。
- 不要把 `domain/business.ts` 拆分。
- 不要改 `functions/api/[[path]].ts` 的接口结构，先拆前端。
- 不要在 Step 3 之前写新功能，先搬家，再加功能。

必须做：

- 每提取一个组件或页面，立即验证。
- 每一步完成后运行 `npm run build`，必要时运行 `npm run verify:business` 和 `npm run verify:api`。
- 提取组件时保持 props 类型不变。
- `App.tsx` 最终缩减到 100-150 行。
- 所有新文件使用 TypeScript。
- 样式统一使用 CSS 变量，不混用 Tailwind。
