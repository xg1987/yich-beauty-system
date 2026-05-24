import {
  BadgeCent,
  Boxes,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LockKeyhole,
  PackagePlus,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { calculateOrderTotal, reportSummary } from "./domain/business";
import { canAccessView, hasPermission, type UserSession } from "./domain/auth";
import type { AppData, Appointment, InventoryLog, Order, Product, ViewKey } from "./domain/types";
import { money, shortDate, toLocalInputValue, tomorrowAt } from "./domain/utils";
import { type ApiActions, useApiData } from "./hooks/useApiData";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "工作台", icon: LayoutDashboard },
  { key: "appointments", label: "预约管理", icon: CalendarDays },
  { key: "pos", label: "开单收银", icon: CreditCard },
  { key: "customers", label: "客户会员", icon: UsersRound },
  { key: "catalog", label: "项目商品", icon: Sparkles },
  { key: "staff", label: "员工提成", icon: BadgeCent },
  { key: "inventory", label: "库存管理", icon: Boxes },
  { key: "reports", label: "报表分析", icon: ChartNoAxesColumnIncreasing },
  { key: "settings", label: "系统设置", icon: Settings },
];

export default function App() {
  const { data, session, loading, error, login, logout, runMutation, actions } = useApiData();
  const [view, setView] = useState<ViewKey>("dashboard");

  if (!session) {
    return <LoginScreen onLogin={login} loading={loading} error={error} />;
  }

  if (!data) {
    return (
      <div className="loading-page">
        <div className="loading-card">
          <strong>正在连接门店数据</strong>
          <span>{error ?? "请确认 API 服务已启动：npm run dev:api"}</span>
        </div>
      </div>
    );
  }

  const visibleNavItems = navItems.filter((item) => canAccessView(session, item.key));
  const activeView = canAccessView(session, view) ? view : visibleNavItems[0]?.key ?? "dashboard";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <strong>一宸 YiCh</strong>
            <span>门店经营系统</span>
          </div>
        </div>
        <nav>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={activeView === item.key ? "nav-item active" : "nav-item"} onClick={() => setView(item.key)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p>一宸 YiCh 美业管理系统 · 第一阶段 MVP</p>
            <h1>{navItems.find((item) => item.key === activeView)?.label}</h1>
          </div>
          <div className="topbar-actions">
            {error && <span className="error-chip">{error}</span>}
            <button className="ghost-button" onClick={() => void runMutation(actions.resetData)} disabled={loading}>重置演示数据</button>
            <button className="ghost-button" onClick={logout}>退出</button>
            <div className="user-chip">{session.user.name} · {session.user.roleName}</div>
          </div>
        </header>
        {activeView === "dashboard" && <Dashboard data={data} />}
        {activeView === "appointments" && <Appointments data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "pos" && <Pos data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "customers" && <Customers data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "catalog" && <Catalog data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "staff" && <StaffCommissions data={data} session={session} actions={actions} runMutation={runMutation} />}
        {activeView === "inventory" && <Inventory data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "reports" && <Reports data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "settings" && <SettingsView data={data} session={session} />}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin, loading, error }: { onLogin: (account: string, password: string) => Promise<void>; loading: boolean; error?: string }) {
  const [account, setAccount] = useState("admin@demo.local");
  const [password, setPassword] = useState("yich-demo");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onLogin(account, password);
  };

  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="brand large">
          <div className="brand-mark">D</div>
          <div>
            <strong>一宸 YiCh 美业管理系统</strong>
            <span>单店经营闭环 MVP</span>
          </div>
        </div>
        <h1>门店经营，从预约到财务一屏串起来</h1>
        <p>当前版本包含 Web 管理后台的核心流程：客户、预约、开单、会员卡、库存、提成和报表。</p>
        <form className="login-card" onSubmit={submit}>
          <label>
            账号
            <input value={account} onChange={(event) => setAccount(event.target.value)} />
          </label>
          <label>
            密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>
            <LockKeyhole size={17} />
            {loading ? "正在登录" : "进入演示系统"}
          </button>
          <small>演示账号：admin@demo.local / yich-demo</small>
        </form>
      </section>
    </div>
  );
}

function Dashboard({ data }: { data: AppData }) {
  const paidRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const todayAppointments = data.appointments.filter((item) => new Date(item.startAt).toDateString() === new Date().toDateString()).length;
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const pendingCommissions = data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="page-grid">
      <StatCard title="累计实收" value={money(paidRevenue)} hint="收银订单实时汇总" />
      <StatCard title="今日预约" value={`${todayAppointments} 单`} hint="含待确认和已到店" />
      <StatCard title="待结算提成" value={money(pendingCommissions)} hint="按完成订单生成" />
      <StatCard title="库存预警" value={`${lowStock.length} 项`} hint="低于预警值需补货" tone={lowStock.length ? "warn" : "ok"} />
      <section className="panel wide">
        <PanelTitle icon={<CalendarDays size={18} />} title="近期预约" action="按到店顺序" />
        <DataTable
          columns={["时间", "客户", "项目", "员工", "状态"]}
          rows={data.appointments
            .slice()
            .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
            .map((item) => [
              shortDate(item.startAt),
              nameOf(data.customers, item.customerId),
              nameOf(data.services, item.serviceId),
              nameOf(data.staff, item.staffId),
              <Badge key={item.id} text={item.status} />,
            ])}
        />
      </section>
      <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="库存提醒" action="耗材优先" />
        <div className="stack">
          {lowStock.length === 0 ? <p className="empty">暂无低库存商品</p> : lowStock.map((item) => <InventoryLine key={item.id} product={item} />)}
        </div>
      </section>
    </div>
  );
}

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

function Appointments({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [staffId, setStaffId] = useState(data.staff[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [startAt, setStartAt] = useState(toLocalInputValue(tomorrowAt(11)));
  const [note, setNote] = useState("");
  const [blockedStaffId, setBlockedStaffId] = useState(data.staff[1]?.id ?? data.staff[0]?.id ?? "");
  const [blockedStartAt, setBlockedStartAt] = useState(toLocalInputValue(tomorrowAt(16)));
  const [blockedEndAt, setBlockedEndAt] = useState(toLocalInputValue(tomorrowAt(17)));
  const [blockedReason, setBlockedReason] = useState("员工休息/培训");

  const addAppointment = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addAppointment({ customerId, staffId, serviceId, startAt: new Date(startAt).toISOString(), note }));
    setNote("");
  };

  const setStatus = (id: string, status: Appointment["status"]) => {
    void runMutation(() => actions.updateAppointmentStatus(id, status));
  };

  const addBlockedSlot = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.addStaffUnavailableSlot({
        staffId: blockedStaffId,
        startAt: new Date(blockedStartAt).toISOString(),
        endAt: new Date(blockedEndAt).toISOString(),
        reason: blockedReason,
      }),
    );
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="新增预约" action="员工时间锁定" />
        <form className="form" onSubmit={addAppointment}>
          <Select label="客户" value={customerId} onChange={setCustomerId} options={data.customers.map(optionOf)} />
          <Select label="服务员工" value={staffId} onChange={setStaffId} options={data.staff.map(optionOf)} />
          <Select label="服务项目" value={serviceId} onChange={setServiceId} options={data.services.map(optionOf)} />
          <label>
            预约时间
            <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </label>
          <label>
            备注
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="客户偏好、到店提醒等" />
          </label>
          <button className="primary-button">保存预约</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<CalendarDays size={18} />} title="锁定员工时间" action="不可预约" />
        <form className="form" onSubmit={addBlockedSlot}>
          <Select label="员工" value={blockedStaffId} onChange={setBlockedStaffId} options={data.staff.map(optionOf)} />
          <label>
            开始时间
            <input type="datetime-local" value={blockedStartAt} onChange={(event) => setBlockedStartAt(event.target.value)} />
          </label>
          <label>
            结束时间
            <input type="datetime-local" value={blockedEndAt} onChange={(event) => setBlockedEndAt(event.target.value)} />
          </label>
          <label>
            原因
            <input value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} />
          </label>
          <button className="primary-button">锁定时间</button>
        </form>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<ClipboardList size={18} />} title="预约列表" action="支持到店确认" />
        <div className="card-list">
          {data.appointments.map((item) => (
            <article className="record-card" key={item.id}>
              <div>
                <strong>{nameOf(data.customers, item.customerId)}</strong>
                <span>{shortDate(item.startAt)} · {nameOf(data.services, item.serviceId)} · {nameOf(data.staff, item.staffId)}</span>
                {item.note && <small>{item.note}</small>}
              </div>
              <div className="row-actions">
                <Badge text={item.status} />
                <button onClick={() => setStatus(item.id, "已确认")}>确认</button>
                <button onClick={() => setStatus(item.id, "已到店")}>到店</button>
                <button onClick={() => setStatus(item.id, "已完成")}>完成</button>
              </div>
            </article>
          ))}
        </div>
        <div className="divider" />
        <PanelTitle icon={<CalendarDays size={18} />} title="不可预约时段" action={`${data.staffUnavailableSlots.length} 条`} />
        <DataTable
          columns={["员工", "开始", "结束", "原因", "创建时间"]}
          rows={data.staffUnavailableSlots.map((slot) => [
            nameOf(data.staff, slot.staffId),
            shortDate(slot.startAt),
            shortDate(slot.endAt),
            slot.reason,
            shortDate(slot.createdAt),
          ])}
        />
      </section>
    </div>
  );
}

function Pos({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(data.staff[1]?.id ?? data.staff[0]?.id ?? "");
  const [collaboratorStaffIds, setCollaboratorStaffIds] = useState<string[]>([]);
  const [productId, setProductId] = useState("");
  const [payMethod, setPayMethod] = useState<Order["payMethod"]>("微信");
  const [cardId, setCardId] = useState("");
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});

  const availableCards = data.memberCards.filter((item) => item.customerId === customerId && item.status === "正常");
  const total = calculateOrderTotal(data, serviceId, productId || undefined);

  const checkout = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.checkout({
        customerId,
        staffId,
        collaboratorStaffIds,
        serviceId,
        productId: productId || undefined,
        payMethod,
        cardId: payMethod === "会员卡" ? cardId : undefined,
      }),
    );
    setProductId("");
    setCollaboratorStaffIds([]);
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="快速开单" action="自动提成/扣库存" />
        <form className="form" onSubmit={checkout}>
          <Select label="客户" value={customerId} onChange={(value) => { setCustomerId(value); setCardId(""); }} options={data.customers.map(optionOf)} />
          <Select label="服务项目" value={serviceId} onChange={setServiceId} options={data.services.map(optionOf)} />
          <Select
            label="服务员工"
            value={staffId}
            onChange={(value) => {
              setStaffId(value);
              setCollaboratorStaffIds((previous) => previous.filter((id) => id !== value));
            }}
            options={data.staff.map(optionOf)}
          />
          <CheckboxGroup
            label="协作员工"
            values={collaboratorStaffIds}
            onChange={setCollaboratorStaffIds}
            options={data.staff.filter((item) => item.id !== staffId).map(optionOf)}
          />
          <Select label="附加商品" value={productId} onChange={setProductId} options={[{ value: "", label: "不销售商品" }, ...data.products.filter((item) => item.type === "sale").map(optionOf)]} />
          <Select label="支付方式" value={payMethod} onChange={(value) => setPayMethod(value as Order["payMethod"])} options={["微信", "支付宝", "现金", "银行卡", "会员卡"].map((item) => ({ value: item, label: item }))} />
          {payMethod === "会员卡" && (
            <Select
              label="选择会员卡"
              value={cardId}
              onChange={setCardId}
              options={availableCards.map((item) => ({ value: item.id, label: `${item.name} · ${item.type} · ${item.balance ? money(item.balance) : `${item.remainingTimes} 次`}` }))}
            />
          )}
          <div className="checkout-total">
            <span>应收金额</span>
            <strong>{money(total)}</strong>
          </div>
          <button className="primary-button" disabled={payMethod === "会员卡" && !cardId}>完成收银</button>
        </form>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<ClipboardList size={18} />} title="订单流水" action="最近订单" />
        <DataTable
          columns={["单号", "客户", "项目", "员工", "支付", "实收", "状态", "时间", "操作"]}
          rows={data.orders.map((order) => [
            order.orderNo,
            nameOf(data.customers, order.customerId),
            nameOf(data.services, order.serviceId),
            nameOf(data.staff, order.staffId),
            order.payMethod,
            money(order.paidAmount),
            <Badge key={`${order.id}-status`} text={order.status} tone={order.status === "已退款" ? "warn" : "ok"} />,
            shortDate(order.createdAt),
            order.status === "已支付" ? (
              <div key={`${order.id}-refund`} className="table-action">
                <input
                  aria-label={`${order.orderNo}退款金额`}
                  placeholder="全额"
                  value={refundAmounts[order.id] ?? ""}
                  onChange={(event) => setRefundAmounts((previous) => ({ ...previous, [order.id]: event.target.value }))}
                />
                <button
                  onClick={() =>
                    void runMutation(() =>
                      actions.refundOrder(
                        order.id,
                        "门店退款",
                        refundAmounts[order.id] ? Number(refundAmounts[order.id]) : undefined,
                      ),
                    )
                  }
                >
                  退款
                </button>
              </div>
            ) : (
              "已处理"
            ),
          ])}
        />
      </section>
    </div>
  );
}

function Customers({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [cardName, setCardName] = useState("新客储值卡");
  const [cardAmount, setCardAmount] = useState(1000);
  const [cardTimes, setCardTimes] = useState(0);
  const [cardServiceId, setCardServiceId] = useState(data.services[0]?.id ?? "");

  const addCustomer = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addCustomer({ name, phone }));
    setName("");
    setPhone("");
  };

  const openCard = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.openMemberCard({
        customerId,
        name: cardName,
        balance: cardAmount,
        remainingTimes: cardTimes,
        serviceId: cardTimes > 0 ? cardServiceId : undefined,
      }),
    );
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<UsersRound size={18} />} title="新增客户" action="客户资产沉淀" />
        <form className="form" onSubmit={addCustomer}>
          <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <button className="primary-button">保存客户</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="开卡/办卡" action="储值或次数" />
        <form className="form" onSubmit={openCard}>
          <Select label="客户" value={customerId} onChange={setCustomerId} options={data.customers.map(optionOf)} />
          <label>卡名称<input value={cardName} onChange={(event) => setCardName(event.target.value)} /></label>
          <label>储值金额<input type="number" value={cardAmount} onChange={(event) => setCardAmount(Number(event.target.value))} /></label>
          <label>次数卡次数<input type="number" value={cardTimes} onChange={(event) => setCardTimes(Number(event.target.value))} /></label>
          {cardTimes > 0 && <Select label="绑定项目" value={cardServiceId} onChange={setCardServiceId} options={data.services.map(optionOf)} />}
          <button className="primary-button">开卡</button>
        </form>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<UsersRound size={18} />} title="客户列表" action={`${data.customers.length} 位客户`} />
        <DataTable
          columns={["客户", "手机", "等级", "标签", "最近到店", "卡项"]}
          rows={data.customers.map((customer) => [
            customer.name,
            customer.phone,
            customer.level,
            customer.tags.join(" / "),
            shortDate(customer.lastVisit),
            data.memberCards
              .filter((card) => card.customerId === customer.id)
              .map((card) => `${card.name}${card.serviceId ? `(${nameOf(data.services, card.serviceId)})` : ""}`)
              .join("，") || "未开卡",
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="会员卡列表" action="余额/次数/退卡" />
        <DataTable
          columns={["客户", "卡项", "类型", "余额", "次数", "绑定项目", "状态", "操作"]}
          rows={data.memberCards.map((card) => [
            nameOf(data.customers, card.customerId),
            card.name,
            card.type,
            money(card.balance),
            card.remainingTimes,
            card.serviceId ? nameOf(data.services, card.serviceId) : "通用",
            <Badge key={`${card.id}-status`} text={card.status} tone={card.status === "已退卡" ? "warn" : "ok"} />,
            card.status === "正常" ? (
              <button key={`${card.id}-refund`} onClick={() => void runMutation(() => actions.refundMemberCard(card.id, "客户退卡"))}>
                退卡
              </button>
            ) : (
              "已处理"
            ),
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="卡项流水" action="开卡/消费/退款" />
        <DataTable
          columns={["卡项", "类型", "金额变动", "次数变动", "余额", "剩余次数", "备注", "时间"]}
          rows={data.memberCardTransactions.map((transaction) => [
            nameOf(data.memberCards, transaction.memberCardId),
            transaction.type,
            money(transaction.amountDelta),
            transaction.timesDelta,
            money(transaction.balanceAfter),
            transaction.remainingTimesAfter,
            transaction.note,
            shortDate(transaction.createdAt),
          ])}
        />
      </section>
    </div>
  );
}

function Catalog({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState(398);
  const [productName, setProductName] = useState("");
  const [productStock, setProductStock] = useState(10);

  const addService = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addService({ name: serviceName, price: servicePrice, category: "自定义项目", duration: 60 }));
    setServiceName("");
  };

  const addProduct = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addProduct({ name: productName, stock: productStock, type: "consumable", unit: "件" }));
    setProductName("");
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Sparkles size={18} />} title="新增项目" action="服务目录" />
        <form className="form" onSubmit={addService}>
          <label>项目名称<input value={serviceName} onChange={(event) => setServiceName(event.target.value)} required /></label>
          <label>标准价格<input type="number" value={servicePrice} onChange={(event) => setServicePrice(Number(event.target.value))} /></label>
          <button className="primary-button">保存项目</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<Boxes size={18} />} title="新增商品/耗材" action="库存资料" />
        <form className="form" onSubmit={addProduct}>
          <label>名称<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
          <label>初始库存<input type="number" value={productStock} onChange={(event) => setProductStock(Number(event.target.value))} /></label>
          <button className="primary-button">保存商品</button>
        </form>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<Sparkles size={18} />} title="项目与商品" action="价格/库存" />
        <div className="split-list">
          <DataTable columns={["项目", "分类", "价格", "时长"]} rows={data.services.map((item) => [item.name, item.category, money(item.price), `${item.duration} 分钟`])} />
          <DataTable columns={["商品", "类型", "库存", "预警"]} rows={data.products.map((item) => [item.name, item.type === "sale" ? "销售商品" : "服务耗材", `${item.stock}${item.unit}`, `${item.warningStock}${item.unit}`])} />
        </div>
      </section>
    </div>
  );
}

function StaffCommissions({ data, session, actions, runMutation }: { data: AppData; session: UserSession; actions: ApiActions; runMutation: RunMutation }) {
  const settleAll = () => {
    void runMutation(actions.settleCommissions);
  };

  return (
    <div className="page-grid">
      {data.staff.map((staff) => {
        const amount = data.commissions.filter((item) => item.staffId === staff.id).reduce((sum, item) => sum + item.amount, 0);
        return <StatCard key={staff.id} title={staff.name} value={money(amount)} hint={`${staff.role} · ${staff.phone}`} />;
      })}
      <section className="panel wide">
        <PanelTitle
          icon={<BadgeCent size={18} />}
          title="提成记录"
          action={hasPermission(session, "commissions:settle") ? <button onClick={settleAll}>全部结算</button> : "仅查看"}
        />
        <DataTable
          columns={["员工", "类型", "计算基数", "提成", "状态", "时间"]}
          rows={data.commissions.map((item) => [
            nameOf(data.staff, item.staffId),
            item.type,
            money(item.baseAmount),
            money(item.amount),
            <Badge key={item.id} text={item.status} />,
            shortDate(item.createdAt),
          ])}
        />
      </section>
    </div>
  );
}

function Inventory({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState<InventoryLog["type"]>("入库");

  const changeStock = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.adjustInventory({ productId, type, quantity }));
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="库存操作" action="入库/报损/盘点" />
        <form className="form" onSubmit={changeStock}>
          <Select label="商品/耗材" value={productId} onChange={setProductId} options={data.products.map(optionOf)} />
          <Select label="操作类型" value={type} onChange={(value) => setType(value as InventoryLog["type"])} options={["入库", "报损", "盘点调整"].map((item) => ({ value: item, label: item }))} />
          <label>数量<input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <button className="primary-button">保存库存流水</button>
        </form>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<Boxes size={18} />} title="库存列表" action="低库存自动标记" />
        <DataTable
          columns={["名称", "类型", "库存", "预警", "状态"]}
          rows={data.products.map((item) => [
            item.name,
            item.type === "sale" ? "销售商品" : "服务耗材",
            `${item.stock}${item.unit}`,
            `${item.warningStock}${item.unit}`,
            <Badge key={item.id} text={item.stock <= item.warningStock ? "需补货" : "正常"} tone={item.stock <= item.warningStock ? "warn" : "ok"} />,
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="库存流水" action="自动记录" />
        <DataTable columns={["商品", "类型", "变动", "结余", "备注", "时间"]} rows={data.inventoryLogs.map((log) => [nameOf(data.products, log.productId), log.type, log.delta, log.stockAfter, log.note, shortDate(log.createdAt)])} />
      </section>
    </div>
  );
}

function Reports({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const summary = reportSummary(data);
  const payMethods = ["微信", "支付宝", "现金", "银行卡", "会员卡"].map((method) => ({
    method,
    amount: data.orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + order.paidAmount, 0),
  }));

  return (
    <div className="page-grid">
      <StatCard title="实收现金流" value={money(summary.revenue)} hint={`退款 ${money(summary.refundAmount)}`} />
      <StatCard title="项目服务数" value={`${summary.serviceCount} 单`} hint="已完成收银订单" />
      <StatCard title="会员储值余额" value={money(summary.cardBalance)} hint="未消耗客户资产" />
      <StatCard title="员工提成" value={money(summary.commission)} hint="服务提成合计" />
      <section className="panel">
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="支付方式分析" action="实收拆分" />
        <div className="bar-list">
          {payMethods.map((item) => (
            <div className="bar-row" key={item.method}>
              <span>{item.method}</span>
              <div><i style={{ width: `${summary.revenue ? Math.max(8, (item.amount / summary.revenue) * 100) : 0}%` }} /></div>
              <strong>{money(item.amount)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营分析" action="MVP 指标" />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["客单价", money(summary.averageOrderValue), "实收 / 订单数"],
            ["客户数", `${data.customers.length} 人`, "客户资产规模"],
            ["预约转化", `${data.orders.length}/${data.appointments.length}`, "已收银订单 / 预约"],
            ["低库存项", `${summary.lowStockCount} 项`, "低于预警值"],
          ]}
        />
      </section>
      <section className="panel wide">
        <PanelTitle icon={<ClipboardList size={18} />} title="财务日结" action="营业日锁定记录" />
        <DailyCloseControl
          businessDate={businessDate}
          setBusinessDate={setBusinessDate}
          onClose={() => void runMutation(() => actions.createDailyClose(businessDate))}
        />
        <DataTable
          columns={["营业日", "实收", "退款", "订单", "微信", "会员卡", "提成", "时间"]}
          rows={data.dailyCloses.map((item) => [
            item.businessDate,
            money(item.revenue),
            money(item.refundAmount),
            item.orderCount,
            money(item.wechatAmount),
            money(item.memberCardAmount),
            money(item.commissionAmount),
            shortDate(item.createdAt),
          ])}
        />
      </section>
    </div>
  );
}

function DailyCloseControl({
  businessDate,
  setBusinessDate,
  onClose,
}: {
  businessDate: string;
  setBusinessDate: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="inline-form">
      <label>
        营业日
        <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
      </label>
      <button onClick={onClose}>生成日结</button>
    </div>
  );
}

function SettingsView({ data, session }: { data: AppData; session: UserSession }) {
  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Settings size={18} />} title="门店资料" action="MVP 默认门店" />
        <div className="settings-card">
          <strong>一宸 YiCh 皮肤管理中心</strong>
          <span>营业时间：10:00 - 21:00</span>
          <span>地址：上海市静安区示例路 88 号</span>
          <span>电话：021-8888-0000</span>
        </div>
      </section>
      <section className="panel wide">
        <PanelTitle icon={<LockKeyhole size={18} />} title="角色权限" action="第一阶段预设" />
        <div className="settings-card compact">
          <strong>当前登录：{session.user.name}</strong>
          <span>角色：{session.user.roleName}</span>
          <span>账号：{session.user.account}</span>
        </div>
        <div className="divider" />
        <DataTable
          columns={["角色", "可用模块", "关键限制"]}
          rows={[
            ["老板", "全部模块", "可查看所有财务和设置"],
            ["店长", "预约、开单、员工、库存、报表", "不可删除关键财务流水"],
            ["前台", "预约、客户、开单", "退款和改价需审批"],
            ["美容师", "今日预约、服务记录、个人提成", "只能查看授权客户"],
            ["财务", "订单、支付、退款、报表", "不能修改服务项目"],
          ]}
        />
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="操作日志" action={`${data.operationLogs.length} 条`} />
        <DataTable
          columns={["动作", "对象", "说明", "时间"]}
          rows={data.operationLogs.map((log) => [log.action, `${log.targetType}:${log.targetId}`, log.summary, shortDate(log.createdAt)])}
        />
      </section>
    </div>
  );
}

function StatCard({ title, value, hint, tone }: { title: string; value: string; hint: string; tone?: "ok" | "warn" }) {
  return (
    <section className={`stat-card ${tone ?? ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </section>
  );
}

function PanelTitle({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="panel-title">
      <div>{icon}<h2>{title}</h2></div>
      {action && <span>{action}</span>}
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  if (rows.length === 0) return <p className="empty">暂无数据</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CheckboxGroup({
  label,
  values,
  onChange,
  options,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  return (
    <fieldset className="check-group">
      <legend>{label}</legend>
      {options.length === 0 ? (
        <span>暂无可选员工</span>
      ) : (
        options.map((option) => (
          <label key={option.value}>
            <input type="checkbox" checked={values.includes(option.value)} onChange={() => toggle(option.value)} />
            {option.label}
          </label>
        ))
      )}
    </fieldset>
  );
}

function Badge({ text, tone }: { text: string; tone?: "ok" | "warn" }) {
  return <span className={`badge ${tone ?? ""}`}>{text}</span>;
}

function InventoryLine({ product }: { product: Product }) {
  return (
    <div className="inventory-line">
      <strong>{product.name}</strong>
      <span>{product.stock}{product.unit} / 预警 {product.warningStock}{product.unit}</span>
    </div>
  );
}

function optionOf(item: { id: string; name: string }) {
  return { value: item.id, label: item.name };
}

function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}
