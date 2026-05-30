# 美业管理系统 PRD + 数据表设计 + 页面清单

## 1. 项目定位

### 1.1 产品名称

美业门店管理系统

### 1.2 适用行业

皮肤管理、生活美容、眉眼唇、SPA 养生、中医理疗、产后康复、运动康复、疗愈空间、轻医美门店等。

### 1.3 产品目标

为美业门店提供一套覆盖“客户到店、预约、开单、会员卡、服务消耗、员工提成、库存扣减、财务报表、会员运营”的经营管理系统。

当前版本聚焦单店经营，把预约、收银、会员、员工、库存、审批和报表先跑通。

### 1.4 核心用户

| 角色 | 使用目标 |
| --- | --- |
| 老板/投资人 | 查看经营数据、收入利润、会员资产、员工绩效 |
| 店长/经理 | 管理预约、员工排班、订单审核、业绩分析、库存和会员运营 |
| 前台 | 预约登记、客户接待、开单收银、办卡续卡 |
| 美容师/理疗师 | 查看预约、服务客户、记录项目消耗、查看提成 |
| 财务 | 对账、查看收入、退款、欠款、储值余额、财务报表 |
| 客户/会员 | 在线预约、查看卡项、消费记录 |

## 2. 产品范围

### 2.1 MVP 第一阶段

第一阶段目标是让一家单店可以完整跑通日常经营。

| 模块 | 功能 |
| --- | --- |
| 账号权限 | 登录、角色、员工账号、权限控制 |
| 客户会员 | 客户档案、标签、消费记录、会员等级 |
| 预约管理 | 新增预约、预约日历、到店确认、取消/爽约 |
| 项目商品 | 服务项目、商品、套餐、价格、时长 |
| 开单收银 | 开单、项目/商品选择、折扣、支付、退款 |
| 会员卡 | 储值卡、次数卡、套餐卡、开卡、续卡、扣次、余额 |
| 员工提成 | 项目提成、商品提成、手工提成、业绩归属 |
| 库存管理 | 入库、出库、消耗、盘点、库存预警 |
| 财务报表 | 营业额、支付方式、退款、会员储值、项目收入 |
| 经营分析 | 客流、客单价、复购、会员增长、员工排行 |
| 员工端 | 今日预约、服务记录、提成查看 |
| 经理端 | 门店概览、员工绩效、财务报表 |

## 3. 核心业务流程

### 3.1 预约到消费流程

1. 前台/客户创建预约。
2. 系统选择客户、服务项目、员工、时间。
3. 客户到店后确认到店。
4. 前台开单，选择服务项目/商品/卡项。
5. 客户使用会员卡、余额、现金、微信、支付宝等方式支付。
6. 系统生成订单、支付记录、服务记录。
7. 如果项目需要耗材，自动生成库存消耗。
8. 系统按规则生成员工提成。
9. 财务和经营报表实时更新。

### 3.2 开卡/扣卡流程

1. 前台为客户选择卡类型：储值卡、次数卡、套餐卡。
2. 客户支付开卡金额。
3. 系统生成会员卡和支付记录。
4. 后续消费时可选择卡项支付、扣次或扣余额。
5. 系统记录每次消耗明细。
6. 卡余额不足、次数不足或即将过期时触发提醒。

### 3.3 员工提成流程

1. 订单完成后，根据服务员工、销售员工、项目类型和提成规则计算。
2. 提成可分为服务提成、销售提成、商品提成、开卡提成。
3. 支持固定金额、比例、阶梯规则。
4. 财务可按日/月查看和结算提成。

### 3.4 库存消耗流程

1. 商品或耗材入库。
2. 项目服务配置默认耗材。
3. 订单完成后自动扣减对应耗材。
4. 支持手动出库、报损、盘点。
5. 库存低于预警值时提醒店长。

## 4. 功能需求

### 4.1 账号与权限

| 功能 | 说明 |
| --- | --- |
| 登录 | 手机号/账号密码登录 |
| 角色管理 | 老板、店长、前台、员工、财务 |
| 权限管理 | 按菜单、按钮、数据范围控制权限 |
| 员工账号 | 员工绑定登录账号 |
| 操作日志 | 记录关键操作，如退款、改价、删除订单 |

### 4.2 客户与会员

| 功能 | 说明 |
| --- | --- |
| 客户档案 | 姓名、手机号、生日、性别、来源、备注 |
| 标签管理 | 敏感肌、老客户、高消费、待回访等 |
| 消费记录 | 订单、支付、卡项消耗、退款 |
| 会员等级 | 普通会员、VIP、黑金会员等 |
| 回访记录 | 服务后回访、投诉、满意度 |

### 4.3 预约管理

| 功能 | 说明 |
| --- | --- |
| 日历视图 | 按天/周查看员工预约 |
| 新增预约 | 选择客户、项目、员工、时间 |
| 状态流转 | 待确认、已确认、已到店、已完成、已取消、爽约 |
| 冲突检测 | 同一员工同一时间不可重复预约 |
| 预约提醒 | 后续可接短信/微信提醒 |

### 4.4 项目与商品

| 功能 | 说明 |
| --- | --- |
| 服务项目 | 项目名称、价格、时长、分类、是否启用 |
| 商品管理 | 商品名称、售价、成本、库存单位 |
| 套餐项目 | 多个项目组合销售 |
| 耗材配置 | 项目绑定默认耗材和用量 |
| 价格管理 | 支持门店价格、会员价、权限改价 |

### 4.5 开单收银

| 功能 | 说明 |
| --- | --- |
| 新建订单 | 选择客户、项目、商品、员工 |
| 折扣改价 | 按权限控制 |
| 多支付方式 | 现金、微信、支付宝、银行卡、会员余额、组合支付 |
| 订单状态 | 待支付、已支付、已完成、已退款、已取消 |
| 退款 | 支持整单退款、部分退款 |
| 小票/收据 | 可后续扩展打印 |

### 4.6 会员卡

| 类型 | 说明 |
| --- | --- |
| 储值卡 | 充值金额，可用于消费抵扣 |
| 次数卡 | 指定项目次数，消费时扣次 |
| 套餐卡 | 多项目组合，可按项目扣次 |
| 折扣卡 | 指定客户享受固定折扣 |

会员卡需要支持开卡、续费、赠送金额、赠送次数、冻结、过期、转卡、退卡。

### 4.7 员工提成

| 功能 | 说明 |
| --- | --- |
| 提成规则 | 按项目/商品/卡项配置 |
| 服务提成 | 给实际服务员工 |
| 销售提成 | 给开单或销售员工 |
| 多人分成 | 一个订单多个员工分配 |
| 月度结算 | 按周期生成提成报表 |

### 4.8 库存管理

| 功能 | 说明 |
| --- | --- |
| 商品库存 | 商品和耗材库存 |
| 入库 | 采购入库、调拨入库 |
| 出库 | 销售出库、服务消耗、报损 |
| 盘点 | 盘点差异调整 |
| 预警 | 库存低于阈值提醒 |

### 4.9 报表分析

| 报表 | 指标 |
| --- | --- |
| 财务报表 | 营业额、实收、退款、储值收入、耗卡金额 |
| 经营分析 | 客流、客单价、复购率、新客数、老客数 |
| 会员分析 | 新增会员、活跃会员、沉睡会员、卡余额 |
| 员工分析 | 业绩、服务数、提成、客单价 |
| 项目分析 | 项目销量、收入、复购、耗材成本 |

## 5. 页面清单

### 5.1 管理后台

| 一级菜单 | 页面 | 说明 | 阶段 |
| --- | --- | --- | --- |
| 工作台 | 门店概览 | 今日预约、今日收入、待办、库存预警 | MVP |
| 预约 | 预约日历 | 按员工/时间查看预约 | MVP |
| 预约 | 新增/编辑预约 | 创建和修改预约 | MVP |
| 收银 | 开单收银 | 项目、商品、卡项下单 | MVP |
| 收银 | 订单列表 | 查询订单、退款、详情 | MVP |
| 收银 | 支付记录 | 查看支付流水 | MVP |
| 客户 | 客户列表 | 搜索、筛选、标签 | MVP |
| 客户 | 客户详情 | 档案、消费、卡项、回访 | MVP |
| 会员 | 会员卡列表 | 查看客户持卡情况 | MVP |
| 会员 | 开卡/续卡 | 办卡、充值、续费 | MVP |
| 会员 | 卡项消耗记录 | 扣次、扣余额流水 | MVP |
| 项目商品 | 服务项目 | 项目价格、时长、耗材 | MVP |
| 项目商品 | 商品管理 | 商品价格、库存单位 | MVP |
| 项目商品 | 套餐管理 | 套餐组合 | MVP |
| 员工 | 员工列表 | 员工资料、状态、角色 | MVP |
| 员工 | 排班管理 | 员工排班和可预约时间 | MVP |
| 员工 | 提成规则 | 配置项目/商品/开卡提成 | MVP |
| 员工 | 提成报表 | 员工业绩和提成 | MVP |
| 库存 | 库存列表 | 当前库存和预警 | MVP |
| 库存 | 入库单 | 采购入库 | MVP |
| 库存 | 出库/报损 | 手动出库、报损 | MVP |
| 库存 | 盘点 | 库存盘点调整 | MVP |
| 报表 | 财务报表 | 收入、支付、退款、储值 | MVP |
| 报表 | 经营分析 | 客流、客单价、复购 | MVP |
| 报表 | 会员分析 | 活跃、沉睡、余额 | MVP |
| 报表 | 员工分析 | 业绩、提成、服务量 | MVP |
| 设置 | 门店设置 | 门店资料、营业时间 | MVP |
| 设置 | 角色权限 | 角色和权限配置 | MVP |
| 设置 | 操作日志 | 关键操作审计 | MVP |

### 5.2 员工端

| 页面 | 说明 | 阶段 |
| --- | --- | --- |
| 今日工作台 | 今日预约、待服务客户 | MVP |
| 预约详情 | 查看客户、项目、备注 | MVP |
| 服务记录 | 记录服务内容、耗材、备注 | MVP |
| 我的提成 | 查看日/月提成 | MVP |
| 我的业绩 | 查看服务数、成交额 | MVP |
| 客户资料 | 仅查看授权客户信息 | MVP |

### 5.3 客户端 H5/小程序

| 页面 | 说明 | 阶段 |
| --- | --- | --- |
| 线上店铺 | 服务项目展示和预约入口 | MVP |
| 在线预约 | 选择项目、填写到店意向 | MVP |

## 6. 数据表设计

### 6.1 组织与账号

#### stores 门店表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| name | varchar | 门店名称 |
| phone | varchar | 门店电话 |
| address | varchar | 地址 |
| business_hours | jsonb | 营业时间 |
| status | varchar | active/inactive |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

#### users 登录账号表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 所属门店 |
| phone | varchar | 登录手机号 |
| password_hash | varchar | 密码哈希 |
| role_id | uuid | 角色 |
| staff_id | uuid | 绑定员工，可为空 |
| status | varchar | active/disabled |
| last_login_at | timestamp | 最近登录 |
| created_at | timestamp | 创建时间 |

#### roles 角色表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店，平台角色可为空 |
| name | varchar | 角色名称 |
| permissions | jsonb | 权限列表 |
| created_at | timestamp | 创建时间 |

#### staff 员工表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 所属门店 |
| name | varchar | 姓名 |
| phone | varchar | 手机号 |
| position | varchar | 岗位 |
| avatar_url | varchar | 头像 |
| hire_date | date | 入职日期 |
| status | varchar | active/resigned |
| created_at | timestamp | 创建时间 |

### 6.2 客户与会员

#### customers 客户表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 所属门店 |
| name | varchar | 姓名 |
| phone | varchar | 手机号 |
| gender | varchar | 性别 |
| birthday | date | 生日 |
| source | varchar | 来源渠道 |
| level | varchar | 会员等级 |
| notes | text | 备注 |
| last_visit_at | timestamp | 最近到店 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

#### tags 标签表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| name | varchar | 标签名称 |
| color | varchar | 标签颜色 |
| created_at | timestamp | 创建时间 |

#### customer_tags 客户标签关系表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| customer_id | uuid | 客户 |
| tag_id | uuid | 标签 |
| created_at | timestamp | 创建时间 |

#### member_cards 会员卡表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| customer_id | uuid | 客户 |
| card_type | varchar | stored_value/package/times/discount |
| name | varchar | 卡名称 |
| balance_amount | decimal | 储值余额 |
| total_amount | decimal | 总充值金额 |
| remaining_times | int | 剩余次数 |
| expires_at | timestamp | 过期时间 |
| status | varchar | active/frozen/expired/refunded |
| created_at | timestamp | 创建时间 |

#### member_card_items 会员卡项目明细表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| member_card_id | uuid | 会员卡 |
| service_id | uuid | 服务项目 |
| total_times | int | 总次数 |
| remaining_times | int | 剩余次数 |
| created_at | timestamp | 创建时间 |

#### member_card_transactions 会员卡流水表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| member_card_id | uuid | 会员卡 |
| order_id | uuid | 关联订单 |
| type | varchar | open/recharge/consume/refund/adjust |
| amount_delta | decimal | 金额变动 |
| times_delta | int | 次数变动 |
| balance_after | decimal | 变动后余额 |
| note | text | 备注 |
| created_at | timestamp | 创建时间 |

### 6.3 预约与服务

#### appointments 预约表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| customer_id | uuid | 客户 |
| staff_id | uuid | 服务员工 |
| service_id | uuid | 预约项目 |
| start_at | timestamp | 开始时间 |
| end_at | timestamp | 结束时间 |
| status | varchar | pending/confirmed/arrived/completed/canceled/no_show |
| notes | text | 预约备注 |
| created_by | uuid | 创建人 |
| created_at | timestamp | 创建时间 |

#### services 服务项目表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| category_id | uuid | 分类 |
| name | varchar | 项目名称 |
| price | decimal | 标准价格 |
| duration_minutes | int | 服务时长 |
| description | text | 项目说明 |
| status | varchar | active/inactive |
| created_at | timestamp | 创建时间 |

#### service_categories 项目分类表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| name | varchar | 分类名称 |
| sort_order | int | 排序 |

#### service_consumables 项目耗材配置表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| service_id | uuid | 服务项目 |
| product_id | uuid | 耗材/商品 |
| quantity | decimal | 默认消耗数量 |
| created_at | timestamp | 创建时间 |

### 6.4 商品与库存

#### products 商品/耗材表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| name | varchar | 商品名称 |
| sku | varchar | SKU |
| product_type | varchar | sale/consumable |
| unit | varchar | 单位 |
| sale_price | decimal | 售价 |
| cost_price | decimal | 成本价 |
| warning_stock | decimal | 预警库存 |
| status | varchar | active/inactive |
| created_at | timestamp | 创建时间 |

#### inventory_stocks 库存表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| product_id | uuid | 商品/耗材 |
| quantity | decimal | 当前库存 |
| updated_at | timestamp | 更新时间 |

#### inventory_logs 库存流水表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| product_id | uuid | 商品/耗材 |
| type | varchar | inbound/outbound/consume/damage/adjust |
| quantity_delta | decimal | 数量变动 |
| quantity_after | decimal | 变动后库存 |
| related_order_id | uuid | 关联订单 |
| note | text | 备注 |
| created_by | uuid | 操作人 |
| created_at | timestamp | 创建时间 |

### 6.5 订单与财务

#### orders 订单表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| customer_id | uuid | 客户 |
| appointment_id | uuid | 关联预约，可为空 |
| order_no | varchar | 订单编号 |
| total_amount | decimal | 原价合计 |
| discount_amount | decimal | 优惠金额 |
| payable_amount | decimal | 应付金额 |
| paid_amount | decimal | 实付金额 |
| status | varchar | pending/paid/completed/refunded/canceled |
| sales_staff_id | uuid | 销售员工 |
| created_by | uuid | 开单人 |
| paid_at | timestamp | 支付时间 |
| created_at | timestamp | 创建时间 |

#### order_items 订单明细表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| order_id | uuid | 订单 |
| item_type | varchar | service/product/card |
| item_id | uuid | 项目/商品/卡项 ID |
| name | varchar | 下单时名称快照 |
| quantity | decimal | 数量 |
| unit_price | decimal | 单价 |
| discount_amount | decimal | 优惠 |
| subtotal_amount | decimal | 小计 |
| service_staff_id | uuid | 服务员工 |
| created_at | timestamp | 创建时间 |

#### payments 支付记录表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| order_id | uuid | 订单 |
| method | varchar | cash/wechat/alipay/card/balance/mixed |
| amount | decimal | 支付金额 |
| status | varchar | success/refunded/failed |
| transaction_no | varchar | 外部交易号 |
| paid_at | timestamp | 支付时间 |
| created_at | timestamp | 创建时间 |

#### refunds 退款记录表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| order_id | uuid | 订单 |
| payment_id | uuid | 支付记录 |
| amount | decimal | 退款金额 |
| reason | text | 退款原因 |
| approved_by | uuid | 审批人 |
| created_by | uuid | 操作人 |
| created_at | timestamp | 创建时间 |

### 6.6 提成

#### commission_rules 提成规则表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| target_type | varchar | service/product/card |
| target_id | uuid | 目标项目/商品/卡项 |
| commission_type | varchar | service/sales |
| calc_type | varchar | fixed/percent |
| value | decimal | 固定金额或比例 |
| status | varchar | active/inactive |
| created_at | timestamp | 创建时间 |

#### commissions 提成记录表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| staff_id | uuid | 员工 |
| order_id | uuid | 订单 |
| order_item_id | uuid | 订单明细 |
| commission_type | varchar | service/sales |
| base_amount | decimal | 计算基数 |
| commission_amount | decimal | 提成金额 |
| status | varchar | pending/settled/canceled |
| settled_at | timestamp | 结算时间 |
| created_at | timestamp | 创建时间 |

### 6.7 审计与日志

#### operation_logs 操作日志表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键 |
| store_id | uuid | 门店 |
| user_id | uuid | 操作人 |
| action | varchar | 操作动作 |
| target_type | varchar | 操作对象类型 |
| target_id | uuid | 操作对象 ID |
| before_data | jsonb | 修改前 |
| after_data | jsonb | 修改后 |
| ip | varchar | IP |
| created_at | timestamp | 创建时间 |

## 7. 权限设计

| 权限域 | 老板 | 店长 | 前台 | 员工 | 财务 |
| --- | --- | --- | --- | --- | --- |
| 工作台 | 全部 | 本店 | 本店 | 个人 | 财务数据 |
| 客户资料 | 全部 | 本店 | 本店 | 授权客户 | 本店 |
| 预约 | 全部 | 管理 | 创建/编辑 | 查看个人 | 查看 |
| 开单 | 全部 | 全部 | 创建 | 不可开单或仅协助 | 查看 |
| 退款 | 全部 | 审批 | 申请 | 无 | 审批/查看 |
| 员工 | 全部 | 本店 | 查看 | 个人 | 查看 |
| 提成 | 全部 | 本店 | 无 | 个人 | 全部 |
| 库存 | 全部 | 管理 | 查看 | 消耗登记 | 查看 |
| 财务 | 全部 | 本店 | 当日收银 | 无 | 全部 |
| 系统设置 | 全部 | 部分 | 无 | 无 | 无 |

## 8. 关键规则

### 8.1 订单金额规则

订单金额 = 项目金额 + 商品金额 + 卡项金额 - 优惠金额。

实收金额需要按支付方式拆分记录。储值卡充值收入和项目消耗收入在财务报表中需要区分，否则会造成收入重复统计。

### 8.2 卡项收入规则

储值卡开卡/充值时产生“储值收入”，客户后续用余额消费时产生“储值消耗”。经营分析时建议同时展示：

| 指标 | 含义 |
| --- | --- |
| 实收现金流 | 今天实际收到多少钱 |
| 项目消耗业绩 | 今天实际服务消耗了多少钱 |
| 储值新增 | 今天新增充值多少钱 |
| 储值余额 | 客户尚未消费的余额 |

### 8.3 提成规则

提成应基于订单完成状态生成。退款后需要冲销对应提成。

### 8.4 库存规则

服务项目完成后才扣减耗材库存。取消订单不扣库存，退款是否回滚库存需要根据门店规则配置。

## 9. 推荐技术架构

### 9.1 前端

| 端 | 技术 |
| --- | --- |
| 管理后台 | Next.js / React |
| 员工端 | React 移动端 H5 |
| 客户端 | 微信小程序或 H5 |

### 9.2 后端

| 层 | 技术 |
| --- | --- |
| API | Node.js + NestJS 或 Fastify |
| 数据库 | PostgreSQL |
| ORM | Prisma |
| 缓存 | Redis，可二期加入 |
| 文件 | 本地存储或对象存储 |
| 部署 | Docker + 云服务器 / Render / Railway |

### 9.3 系统结构

建议先做单体应用，模块边界清晰即可，不需要一开始做微服务。

```
apps/
  web-admin/        管理后台
  web-mobile/       员工端/客户 H5
  api/              后端 API
packages/
  database/         Prisma schema
  shared/           公共类型和工具
```

## 10. MVP 交付优先级

### P0 必须做

- 登录和角色权限
- 门店设置
- 员工管理
- 客户管理
- 服务项目
- 预约管理
- 开单收银
- 会员卡
- 订单和支付记录
- 基础提成
- 基础库存
- 财务报表

### P1 应该做

- 标签管理
- 回访记录
- 排班管理
- 库存预警
- 经营分析
- 员工分析
- 会员分析
- 操作日志

## 11. 第一版开发里程碑

| 周期 | 目标 | 交付物 |
| --- | --- | --- |
| 第 1 周 | 项目初始化和基础架构 | 前后端框架、数据库、登录 |
| 第 2 周 | 主数据 | 门店、员工、客户、项目、商品 |
| 第 3 周 | 预约和开单 | 预约日历、开单收银、订单 |
| 第 4 周 | 会员卡 | 开卡、充值、扣卡、流水 |
| 第 5 周 | 提成和库存 | 提成规则、库存扣减、库存流水 |
| 第 6 周 | 报表和权限 | 财务报表、经营分析、角色权限 |
| 第 7 周 | 员工端 | 今日预约、服务记录、个人提成 |
| 第 8 周 | 测试和上线 | 数据校验、权限测试、部署 |

## 12. 待确认问题

1. 第一版是否只做单店，还是一开始就支持多门店？
2. 是否需要微信小程序，还是先用 H5？
3. 是否接真实微信/支付宝支付，还是第一版只记录线下收款？
4. 会员卡是否需要复杂规则，如赠送金额、跨项目扣次、转卡、退卡？
5. 提成规则是固定比例为主，还是需要阶梯提成？
6. 是否需要客户照片、服务前后对比照、隐私权限？
7. 第一版是否需要打印小票？
