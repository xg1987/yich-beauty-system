import {
  BadgeCent,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  CreditCard,
  Database,
  ArrowLeft,
  Headphones,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Network,
  PackagePlus,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { calculateOrderTotal, reportSummary } from "./domain/business";
import { canAccessView, hasPermission, type UserSession } from "./domain/auth";
import type { AppData, Appointment, InventoryLog, Order, Product, UserRole, ViewKey } from "./domain/types";
import { money, shortDate, toLocalInputValue, tomorrowAt } from "./domain/utils";
import { type ApiActions, useApiData } from "./hooks/useApiData";

type WorkbarKey = "workbench" | "appointments" | "cashier" | "customers" | "admin";
type ThemeMode = "day" | "night";
type CardType = "储值卡" | "次数卡" | "套餐卡";

const THEME_KEY = "yich-system-theme";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "工作台", icon: LayoutDashboard },
  { key: "appointments", label: "预约管理", icon: CalendarDays },
  { key: "pos", label: "开单收银", icon: CreditCard },
  { key: "customers", label: "客户会员", icon: UsersRound },
  { key: "catalog", label: "项目商品", icon: Sparkles },
  { key: "staff", label: "员工提成", icon: BadgeCent },
  { key: "inventory", label: "库存管理", icon: Boxes },
  { key: "reports", label: "报表分析", icon: ChartNoAxesColumnIncreasing },
  { key: "approvals", label: "审批中心", icon: ShieldCheck },
  { key: "settings", label: "系统设置", icon: Settings },
];

const workbarItems: Array<{ key: WorkbarKey; label: string; icon: typeof LayoutDashboard; view: ViewKey }> = [
  { key: "workbench", label: "工作台", icon: LayoutDashboard, view: "dashboard" },
  { key: "appointments", label: "预约", icon: CalendarDays, view: "appointments" },
  { key: "cashier", label: "收银", icon: CreditCard, view: "pos" },
  { key: "customers", label: "客户", icon: UsersRound, view: "customers" },
  { key: "admin", label: "管理中心", icon: UserRound, view: "settings" },
];

export default function App() {
  const { data, session, loading, error, login, registerStore, joinInvite, authenticate, logout, runMutation, actions } = useApiData();
  const [view, setView] = useState<ViewKey>("dashboard");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [adminBackVisible, setAdminBackVisible] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) === "night" ? "night" : "day"));

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeMode);
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  if (!session) {
    return <LoginScreen onLogin={login} onRegister={registerStore} onJoin={joinInvite} authenticate={authenticate} loading={loading} error={error} />;
  }

  if (!data) {
    return (
      <div className="loading-page">
        <div className="loading-card">
          <strong>正在连接门店数据</strong>
          <span>{error ?? "正在连接服务，请稍后重试或联系管理员"}</span>
        </div>
      </div>
    );
  }

  const visibleNavItems = navItems.filter((item) => canAccessView(session, item.key));
  const activeView = canAccessView(session, view) ? view : visibleNavItems[0]?.key ?? "dashboard";
  const activeWorkbar = workbarForView(activeView);
  const notificationCount = notificationItems(data).filter((item) => item.count > 0).length;
  const navigate = (nextView: ViewKey, options?: { fromAdmin?: boolean }) => {
    setView(nextView);
    setNotificationPanelOpen(false);
    setAccountMenuOpen(false);
    setAdminBackVisible(Boolean(options?.fromAdmin && nextView !== "settings"));
  };

  return (
    <div className={`app-shell theme-${themeMode}`}>
      <aside className="sidebar">
        <div className="rail-admin">
          <div className="brand-mark">D</div>
          <div>
            <strong>管理后台</strong>
            <span>Admin</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <p>一宸 YiCh 美业门店系统</p>
          </div>
          <div className="topbar-actions">
            {error && <span className="error-chip">{error}</span>}
            <button className="icon-button notification-button" aria-label="通知" onClick={() => { setNotificationPanelOpen((open) => !open); setAccountMenuOpen(false); }}>
              <Bell size={18} />
              {notificationCount > 0 && <span>{notificationCount}</span>}
            </button>
            <button className="account-avatar-button" aria-label="账号中心" onClick={() => { setAccountMenuOpen((open) => !open); setNotificationPanelOpen(false); }}>
              <UserRound size={18} />
            </button>
            {notificationPanelOpen && <NotificationPanel data={data} setView={navigate} onClose={() => setNotificationPanelOpen(false)} />}
            {accountMenuOpen && (
              <AccountMenu
                session={session}
                logout={logout}
                openSettings={() => navigate("settings")}
              />
            )}
          </div>
        </header>
        {adminBackVisible && activeView !== "settings" && (
          <button className="back-to-admin" type="button" onClick={() => navigate("settings")}>
            <ArrowLeft size={16} />
            返回管理中心
          </button>
        )}
        {activeView === "dashboard" && <Dashboard data={data} session={session} setView={navigate} />}
        {activeView === "appointments" && <Appointments data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "pos" && <Pos data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "customers" && <Customers data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "catalog" && <Catalog data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "staff" && <StaffCommissions data={data} session={session} actions={actions} runMutation={runMutation} />}
        {activeView === "inventory" && <Inventory data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "reports" && <Reports data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "approvals" && <Approvals data={data} actions={actions} runMutation={runMutation} />}
        {activeView === "settings" && <SettingsView data={data} session={session} setView={(nextView) => navigate(nextView, { fromAdmin: true })} />}
      </main>
      <nav className="workbar" aria-label="主工作栏">
        {workbarItems.filter((item) => canAccessView(session, item.view)).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} className={activeWorkbar === item.key ? "active" : ""} onClick={() => navigate(item.view)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function notificationItems(data: AppData): Array<{ title: string; desc: string; count: number; view: ViewKey; icon: typeof Bell }> {
  const today = new Date();
  return [
    {
      title: "今日预约",
      desc: "查看待确认、到店和服务完成状态",
      count: data.appointments.filter((item) => new Date(item.startAt).toDateString() === today.toDateString()).length,
      view: "appointments",
      icon: CalendarDays,
    },
    {
      title: "客户回访",
      desc: "护理后跟进、微信或电话触达",
      count: data.customerFollowUps.filter((item) => item.status === "待跟进").length,
      view: "customers",
      icon: HeartHandshake,
    },
    {
      title: "库存预警",
      desc: "低于预警值的耗材和商品",
      count: data.products.filter((item) => item.stock <= item.warningStock).length,
      view: "inventory",
      icon: PackagePlus,
    },
    {
      title: "待审批",
      desc: "退款、改价和账号相关审批",
      count: data.approvalRequests.filter((item) => item.status === "待审批").length,
      view: "approvals",
      icon: ShieldCheck,
    },
  ];
}

function NotificationPanel({ data, setView, onClose }: { data: AppData; setView: (view: ViewKey) => void; onClose: () => void }) {
  const items = notificationItems(data);
  return (
    <aside className="notification-panel">
      <div className="notification-head">
        <strong>通知中心</strong>
        <button className="icon-button" aria-label="关闭通知" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="notification-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.title} className={item.count > 0 ? "has-count" : ""} onClick={() => { setView(item.view); onClose(); }}>
              <Icon size={18} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.desc}</small>
              </span>
              <em>{item.count}</em>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function workbarForView(view: ViewKey): WorkbarKey {
  if (view === "appointments") return "appointments";
  if (view === "pos") return "cashier";
  if (view === "customers") return "customers";
  if (["settings", "catalog", "inventory", "approvals", "staff", "reports"].includes(view)) return "admin";
  return "workbench";
}

function AccountMenu({
  session,
  logout,
  openSettings,
}: {
  session: UserSession;
  logout: () => void;
  openSettings: () => void;
}) {
  return (
    <aside className="account-menu" aria-label="账号菜单">
      <div className="account-menu-user">
        <div className="account-menu-avatar"><UserRound size={22} /></div>
        <div>
          <strong>{session.user.name}</strong>
          <span>{session.user.roleName}</span>
        </div>
      </div>
      <button type="button" onClick={openSettings}>
        <Settings size={17} />
        <span>系统设置</span>
      </button>
      <button className="danger" type="button" onClick={logout}>
        <LogOut size={17} />
        <span>退出登录</span>
      </button>
    </aside>
  );
}

function LoginScreen({
  onLogin,
  onRegister,
  onJoin,
  authenticate,
  loading,
  error,
}: {
  onLogin: (account: string, password: string) => Promise<void>;
  onRegister: (body: { storeName: string; ownerName: string; phone: string; address?: string; account: string; password: string }) => Promise<UserSession>;
  onJoin: (body: { inviteCode: string; name: string; password: string }) => Promise<UserSession>;
  authenticate: (authAction: () => Promise<UserSession>) => Promise<void>;
  loading: boolean;
  error?: string;
}) {
  const [mode, setMode] = useState<"login" | "register" | "join">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joinName, setJoinName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login") {
      void onLogin(account.trim(), password);
      return;
    }
    if (mode === "register") {
      void authenticate(() => onRegister({ storeName, ownerName, phone, address, account, password }));
      return;
    }
    void authenticate(() => onJoin({ inviteCode, name: joinName, password }));
  };

  return (
    <div className="login-page">
      {error && (
        <div className="login-error-toast" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
      <section className="login-panel">
        <div className="login-unified-card">
          <div className="login-hero">
            <div className="login-brand">
              <div className="brand-mark">D</div>
              <div>
                <strong>一宸 YiCh 美业门店系统</strong>
                <span>门店经营管理平台</span>
              </div>
            </div>
          </div>
          <form className={`login-card login-card-${mode}`} onSubmit={submit}>
            <div className="login-card-head">
              <strong>{mode === "login" ? "登录系统" : mode === "register" ? "注册门店" : "邀请码加入"}</strong>
              <span>{mode === "login" ? "使用门店账号进入工作台" : mode === "register" ? "创建老板账号并开通门店" : "邀请码由老板或店长在人员管理中生成"}</span>
            </div>
            {mode === "register" && (
              <>
                <label>门店名称<input value={storeName} onChange={(event) => setStoreName(event.target.value)} /></label>
                <label>老板姓名<input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
                <label>联系电话<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <label>门店地址<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
                <p className="register-note">预约、开单、会员、员工、库存、财务和经营分析统一管理。</p>
              </>
            )}
            {mode === "join" ? (
              <>
                <label>邀请码<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="请输入门店发放的邀请码" /></label>
                <label>姓名<input value={joinName} onChange={(event) => setJoinName(event.target.value)} placeholder="请输入姓名" /></label>
              </>
            ) : (
              <label>
                账号
                <input value={account} onChange={(event) => setAccount(event.target.value)} />
              </label>
            )}
            <label>
              密码
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={loading}>
              <LockKeyhole size={17} />
              {loading ? "处理中" : mode === "login" ? "进入系统" : mode === "register" ? "创建门店" : "加入门店"}
            </button>
            <div className="login-card-links">
              {mode !== "login" && <button type="button" onClick={() => setMode("login")}>返回登录</button>}
              {mode !== "join" && <button type="button" onClick={() => setMode("join")}>已有邀请码？加入门店</button>}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function Dashboard({ data, session, setView }: { data: AppData; session: UserSession; setView: (view: ViewKey) => void }) {
  const paidRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const today = new Date();
  const todayAppointmentsList = data.appointments
    .filter((item) => new Date(item.startAt).toDateString() === today.toDateString())
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const todayAppointments = todayAppointmentsList.length;
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const pendingCommissions = data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const pendingFollowUps = data.customerFollowUps.filter((item) => item.status === "待跟进").length;
  const activeCards = data.memberCards.filter((item) => item.status === "正常").length;
  const todayRevenue = data.orders
    .filter((item) => new Date(item.createdAt).toDateString() === today.toDateString())
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const completedAppointments = todayAppointmentsList.filter((item) => item.status === "已完成").length;
  const careList = data.customerFollowUps
    .filter((item) => item.status === "待跟进")
    .slice()
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 4);
  const roleTasks = roleHomeCards(data, session);

  return (
    <div className="dashboard-page">
      <section className="beauty-hero">
        <div className="beauty-hero-copy">
          <span className="eyebrow"><Sparkles size={15} /> {session.user.roleName}工作台</span>
          <h2>今日经营看板</h2>
          <p>把预约、收银、客户跟进和库存预警放在同一个首屏，适合店长和老板快速判断今天要先处理什么。</p>
        </div>
        <div className="hero-metrics">
          <DashboardMetric icon={<CalendarDays size={18} />} label="今日预约" value={`${todayAppointments} 单`} hint={`已完成 ${completedAppointments} 单`} />
          <DashboardMetric icon={<CreditCard size={18} />} label="今日实收" value={money(todayRevenue)} hint="当天收银汇总" />
          <DashboardMetric icon={<HeartHandshake size={18} />} label="待跟进" value={`${pendingFollowUps} 位`} hint="客户关怀任务" />
        </div>
      </section>

      <section className="action-strip" aria-label="今日待办">
        <button onClick={() => setView("appointments")}>
          <CalendarDays size={18} />
          <strong>{todayAppointments}</strong>
          <span>今日预约</span>
        </button>
        <button onClick={() => setView("customers")}>
          <HeartHandshake size={18} />
          <strong>{pendingFollowUps}</strong>
          <span>客户回访</span>
        </button>
        <button onClick={() => setView("inventory")}>
          <PackagePlus size={18} />
          <strong>{lowStock.length}</strong>
          <span>低库存</span>
        </button>
        <button onClick={() => setView("approvals")}>
          <ShieldCheck size={18} />
          <strong>{pendingApprovals}</strong>
          <span>待审批</span>
        </button>
      </section>

      <section className="panel role-home dashboard-panel">
        <PanelTitle icon={<LayoutDashboard size={18} />} title="常用入口" action="按当前账号权限显示" />
        <div className="quick-grid compact">
          {roleTasks.map((item) => (
            <button key={item.title} className="quick-card" onClick={() => setView(item.view)}>
              <strong>{item.value}</strong>
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title="今日服务动线" action="按到店时间" />
          <div className="timeline-list">
            {todayAppointmentsList.slice(0, 5).map((item) => (
              <article key={item.id} className="timeline-item">
                <time>{shortDate(item.startAt).split(" ")[1] ?? shortDate(item.startAt)}</time>
                <div>
                  <strong>{nameOf(data.customers, item.customerId)}</strong>
                  <span>{nameOf(data.services, item.serviceId)} · {nameOf(data.staff, item.staffId)}</span>
                </div>
                <Badge text={item.status} tone={item.status === "已完成" ? "ok" : undefined} />
              </article>
            ))}
            {todayAppointmentsList.length === 0 && <p className="empty">今日暂无预约，前台可从预约栏新增客户到店计划</p>}
          </div>
        </div>

        <div className="panel dashboard-panel">
          <PanelTitle icon={<HeartHandshake size={18} />} title="客户关怀" action={`${pendingFollowUps} 个待跟进`} />
          <div className="care-list">
            {careList.map((item) => (
              <article key={item.id} className="care-item">
                <div>
                  <strong>{nameOf(data.customers, item.customerId)}</strong>
                  <span>{item.method} · {shortDate(item.dueAt)}</span>
                </div>
                <small>{item.note}</small>
              </article>
            ))}
            {careList.length === 0 && <p className="empty">暂无待跟进客户</p>}
          </div>
        </div>
      </section>

      <section className="dashboard-columns lower">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营健康度" action="实时数据" />
          <div className="health-grid">
            <DashboardMetric icon={<CreditCard size={18} />} label="累计实收" value={money(paidRevenue)} hint="全部订单" />
            <DashboardMetric icon={<BadgeCent size={18} />} label="待结提成" value={money(pendingCommissions)} hint="待财务结算" />
            <DashboardMetric icon={<UsersRound size={18} />} label="有效会员卡" value={`${activeCards} 张`} hint={`${data.customers.length} 位客户`} />
            <DashboardMetric icon={<PackagePlus size={18} />} label="库存预警" value={`${lowStock.length} 项`} hint="低于预警值" />
          </div>
        </div>

        <div className="panel dashboard-panel">
          <PanelTitle icon={<PackagePlus size={18} />} title="耗材与商品提醒" action="低库存优先" />
          <div className="stack">
            {lowStock.length === 0 ? <p className="empty">暂无低库存商品</p> : lowStock.slice(0, 4).map((item) => <InventoryLine key={item.id} product={item} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="dashboard-metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function PageHero({
  icon,
  eyebrow,
  title,
  desc,
  stats,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  stats: Array<{ label: string; value: string; hint: string; icon: ReactNode }>;
}) {
  return (
    <section className="page-hero">
      <div className="page-hero-copy">
        <span className="eyebrow">{icon} {eyebrow}</span>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="page-hero-stats">
        {stats.map((item) => (
          <div className="page-hero-stat" key={item.label}>
            <span className="metric-icon">{item.icon}</span>
            <div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <em>{item.hint}</em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function roleHomeCards(data: AppData, session: UserSession): Array<{ title: string; value: string; hint: string; view: ViewKey }> {
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const pendingFollowUps = data.customerFollowUps.filter((item) => item.status === "待跟进").length;
  const todayAppointments = data.appointments.filter((item) => new Date(item.startAt).toDateString() === new Date().toDateString()).length;
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock).length;
  const revenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const myCommission = session.user.staffId
    ? data.commissions.filter((item) => item.staffId === session.user.staffId).reduce((sum, item) => sum + item.amount, 0)
    : 0;

  if (session.user.role === "therapist") {
    return [
      { title: "我的预约", value: `${todayAppointments} 单`, hint: "今日服务安排", view: "appointments" },
      { title: "待回访客户", value: `${pendingFollowUps} 位`, hint: "护理后跟进", view: "customers" },
      { title: "个人提成", value: money(myCommission), hint: "服务业绩汇总", view: "staff" },
    ];
  }
  if (session.user.role === "frontdesk") {
    return [
      { title: "今日预约", value: `${todayAppointments} 单`, hint: "确认到店与改约", view: "appointments" },
      { title: "快速开单", value: "收银", hint: "办卡/消费/退款", view: "pos" },
      { title: "客户会员", value: `${data.customers.length} 人`, hint: "建档与卡项", view: "customers" },
    ];
  }
  if (session.user.role === "finance") {
    return [
      { title: "日结锁账", value: `${data.dailyCloses.length} 天`, hint: "支付流水核对", view: "reports" },
      { title: "待审批", value: `${pendingApprovals} 单`, hint: "退款与改价", view: "approvals" },
      { title: "待结提成", value: money(data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0)), hint: "提成结算", view: "staff" },
    ];
  }
  return [
    { title: "经营收入", value: money(revenue), hint: "全店实收", view: "reports" },
    { title: "待审批", value: `${pendingApprovals} 单`, hint: "风险控制", view: "approvals" },
    { title: "人员管理", value: `${data.staff.length} 人`, hint: "账号/权限/提成", view: "staff" },
    { title: "库存预警", value: `${lowStock} 项`, hint: "采购与盘点", view: "inventory" },
  ];
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
  const [shiftStaffId, setShiftStaffId] = useState(data.staff[0]?.id ?? "");
  const [shiftStartAt, setShiftStartAt] = useState(toLocalInputValue(tomorrowAt(9)));
  const [shiftEndAt, setShiftEndAt] = useState(toLocalInputValue(tomorrowAt(21)));
  const [shiftNote, setShiftNote] = useState("正常班");

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

  const addShift = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.addStaffShift({
        staffId: shiftStaffId,
        startAt: new Date(shiftStartAt).toISOString(),
        endAt: new Date(shiftEndAt).toISOString(),
        note: shiftNote,
      }),
    );
  };

  const today = new Date();
  const todayAppointments = data.appointments.filter((item) => new Date(item.startAt).toDateString() === today.toDateString());
  const pendingArrival = todayAppointments.filter((item) => item.status === "已确认" || item.status === "待确认").length;
  const availableStaff = Math.max(0, data.staff.filter((staff) => staff.status === "active").length - data.staffUnavailableSlots.length);

  return (
    <div className="page-stack">
      <PageHero
        icon={<CalendarDays size={15} />}
        eyebrow="预约管理"
        title="预约管理"
        desc="管理客户预约、员工排班、不可预约时段与到店确认。"
        stats={[
          { label: "今日预约", value: `${todayAppointments.length} 单`, hint: "当天服务计划", icon: <CalendarDays size={18} /> },
          { label: "待到店", value: `${pendingArrival} 单`, hint: "需确认或接待", icon: <ClipboardList size={18} /> },
          { label: "可服务员工", value: `${availableStaff} 人`, hint: "扣除锁定时段", icon: <UsersRound size={18} /> },
        ]}
      />
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
        <div className="divider" />
        <PanelTitle icon={<CalendarDays size={18} />} title="员工排班" action="预约校验" />
        <form className="form" onSubmit={addShift}>
          <Select label="员工" value={shiftStaffId} onChange={setShiftStaffId} options={data.staff.map(optionOf)} />
          <label>
            上班时间
            <input type="datetime-local" value={shiftStartAt} onChange={(event) => setShiftStartAt(event.target.value)} />
          </label>
          <label>
            下班时间
            <input type="datetime-local" value={shiftEndAt} onChange={(event) => setShiftEndAt(event.target.value)} />
          </label>
          <label>
            班次说明
            <input value={shiftNote} onChange={(event) => setShiftNote(event.target.value)} />
          </label>
          <button className="primary-button">保存班次</button>
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
        <div className="divider" />
        <PanelTitle icon={<CalendarDays size={18} />} title="班次列表" action={`${data.staffShifts.length} 条`} />
        <DataTable
          columns={["员工", "上班", "下班", "说明", "创建时间"]}
          rows={data.staffShifts.map((shift) => [
            nameOf(data.staff, shift.staffId),
            shortDate(shift.startAt),
            shortDate(shift.endAt),
            shift.note,
            shortDate(shift.createdAt),
          ])}
        />
        </section>
      </div>
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
  const [discountAmount, setDiscountAmount] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [couponId, setCouponId] = useState("");
  const [approvalReason, setApprovalReason] = useState("客户活动价");
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundApprovalIds, setRefundApprovalIds] = useState<Record<string, string>>({});

  const availableCards = data.memberCards.filter((item) => item.customerId === customerId && item.status === "正常");
  const total = calculateOrderTotal(data, serviceId, productId || undefined);
  const availableCoupons = data.customerCoupons.filter((coupon) =>
    coupon.customerId === customerId &&
    coupon.status === "未使用" &&
    +new Date(coupon.expiresAt) >= Date.now() &&
    (!coupon.serviceId || coupon.serviceId === serviceId) &&
    total >= coupon.minSpend,
  );
  const selectedCoupon = availableCoupons.find((coupon) => coupon.id === couponId);
  const couponDiscount = selectedCoupon?.amount ?? 0;
  const paidTotal = Math.max(0, total - discountAmount - couponDiscount);
  const today = new Date();
  const todayOrders = data.orders.filter((order) => new Date(order.createdAt).toDateString() === today.toDateString());
  const todayPaid = todayOrders.reduce((sum, order) => sum + order.paidAmount, 0);
  const activeCards = data.memberCards.filter((card) => card.status === "正常").length;

  const checkout = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.checkout({
        customerId,
        staffId,
        collaboratorStaffIds,
        serviceId,
        productId: productId || undefined,
        discountAmount: discountAmount || undefined,
        adjustmentReason: adjustmentReason || undefined,
        approvalId: approvalId || undefined,
        couponId: couponId || undefined,
        payMethod,
        cardId: payMethod === "会员卡" ? cardId : undefined,
      }),
    );
    setProductId("");
    setCollaboratorStaffIds([]);
    setDiscountAmount(0);
    setAdjustmentReason("");
    setApprovalId("");
    setCouponId("");
  };

  const requestDiscountApproval = () => {
    void runMutation(() =>
      actions.createApproval({
        type: "改价折扣",
        targetId: `${customerId}:${serviceId}`,
        amount: discountAmount,
        reason: approvalReason,
      }),
    );
  };

  return (
    <div className="page-stack">
      <PageHero
        icon={<CreditCard size={15} />}
        eyebrow="开单收银"
        title="开单收银"
        desc="完成项目开单、会员卡扣款、支付记录、提成计算与库存扣减。"
        stats={[
          { label: "当前应收", value: money(paidTotal), hint: "按已选项目计算", icon: <CreditCard size={18} /> },
          { label: "今日收款", value: money(todayPaid), hint: `${todayOrders.length} 笔订单`, icon: <ChartNoAxesColumnIncreasing size={18} /> },
          { label: "有效会员卡", value: `${activeCards} 张`, hint: "可用于卡扣", icon: <BadgeCent size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="快速开单" action="自动提成/扣库存" />
        <form className="form" onSubmit={checkout}>
          <Select label="客户" value={customerId} onChange={(value) => { setCustomerId(value); setCardId(""); setCouponId(""); }} options={data.customers.map(optionOf)} />
          <Select label="服务项目" value={serviceId} onChange={(value) => { setServiceId(value); setCouponId(""); }} options={data.services.map(optionOf)} />
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
          <label>
            优惠/改价金额
            <input type="number" value={discountAmount} onChange={(event) => setDiscountAmount(Number(event.target.value))} min={0} />
          </label>
          <label>
            改价原因
            <input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="如老客维护、活动价" />
          </label>
          <Select
            label="营销券"
            value={couponId}
            onChange={setCouponId}
            options={[
              { value: "", label: "不使用营销券" },
              ...availableCoupons.map((coupon) => ({ value: coupon.id, label: `${coupon.name} · 抵扣${money(coupon.amount)} · 满${money(coupon.minSpend)}` })),
            ]}
          />
          {discountAmount > 0 && (
            <div className="sub-panel">
              <label>
                审批原因
                <input value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} />
              </label>
              <button type="button" onClick={requestDiscountApproval}>提交改价审批</button>
              <Select
                label="已通过审批"
                value={approvalId}
                onChange={setApprovalId}
                options={[
                  { value: "", label: "选择审批单" },
                  ...data.approvalRequests
                    .filter((item) => item.type === "改价折扣" && item.status === "已通过" && item.amount >= discountAmount)
                    .map((item) => ({ value: item.id, label: `${item.reason} · ${money(item.amount)}` })),
                ]}
              />
            </div>
          )}
          <div className="checkout-total">
            <span>应收金额</span>
            <strong>{money(paidTotal)}</strong>
            {selectedCoupon && <small>已用营销券抵扣 {money(couponDiscount)}</small>}
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
            `${money(order.paidAmount)}${order.discountAmount ? ` / 优惠${money(order.discountAmount)}` : ""}`,
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
                <input
                  aria-label={`${order.orderNo}退款审批`}
                  placeholder="审批ID"
                  value={refundApprovalIds[order.id] ?? ""}
                  onChange={(event) => setRefundApprovalIds((previous) => ({ ...previous, [order.id]: event.target.value }))}
                />
                <button
                  onClick={() =>
                    void runMutation(() =>
                      actions.refundOrder(
                        order.id,
                        "门店退款",
                        refundAmounts[order.id] ? Number(refundAmounts[order.id]) : undefined,
                        refundApprovalIds[order.id] || undefined,
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
    </div>
  );
}

function Customers({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [cardName, setCardName] = useState("新客储值卡");
  const [cardType, setCardType] = useState<CardType>("储值卡");
  const [cardAmount, setCardAmount] = useState(1000);
  const [cardTimes, setCardTimes] = useState(0);
  const [cardServiceId, setCardServiceId] = useState(data.services[0]?.id ?? "");
  const [cardServiceIds, setCardServiceIds] = useState<string[]>(data.services[0]?.id ? [data.services[0].id] : []);
  const [operationCardId, setOperationCardId] = useState(data.memberCards[0]?.id ?? "");
  const [rechargeAmount, setRechargeAmount] = useState(300);
  const [rechargeTimes, setRechargeTimes] = useState(0);
  const [extendTo, setExtendTo] = useState("2027-12-31");
  const [transferToCustomerId, setTransferToCustomerId] = useState(data.customers[1]?.id ?? data.customers[0]?.id ?? "");
  const [recordCustomerId, setRecordCustomerId] = useState(data.customers[0]?.id ?? "");
  const [recordStaffId, setRecordStaffId] = useState(data.staff[1]?.id ?? data.staff[0]?.id ?? "");
  const [recordServiceId, setRecordServiceId] = useState(data.services[0]?.id ?? "");
  const [skinCondition, setSkinCondition] = useState("敏感偏干");
  const [afterNote, setAfterNote] = useState("补水修护后泛红下降");
  const [followUpAt, setFollowUpAt] = useState(toLocalInputValue(tomorrowAt(18)));
  const [tagCustomerId, setTagCustomerId] = useState(data.customers[0]?.id ?? "");
  const [customerLevel, setCustomerLevel] = useState(data.customers[0]?.level ?? "普通会员");
  const [customerSource, setCustomerSource] = useState(data.customers[0]?.source ?? "门店登记");
  const [customerTags, setCustomerTags] = useState(data.customers[0]?.tags.join("，") ?? "新客");
  const [tagFilter, setTagFilter] = useState("");
  const [couponName, setCouponName] = useState("新客护理满减券");
  const [couponAmount, setCouponAmount] = useState(50);
  const [couponMinSpend, setCouponMinSpend] = useState(300);
  const [couponServiceId, setCouponServiceId] = useState("");
  const [couponValidDays, setCouponValidDays] = useState(30);
  const [issueCouponCustomerId, setIssueCouponCustomerId] = useState(data.customers[0]?.id ?? "");
  const [issueCouponTemplateId, setIssueCouponTemplateId] = useState(data.couponTemplates[0]?.id ?? "");

  useEffect(() => {
    const customer = data.customers.find((item) => item.id === tagCustomerId);
    if (!customer) return;
    setCustomerLevel(customer.level);
    setCustomerSource(customer.source);
    setCustomerTags(customer.tags.join("，"));
  }, [tagCustomerId, data.customers]);

  const addCustomer = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addCustomer({ name, phone }));
    setName("");
    setPhone("");
  };

  const openCard = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(async () => {
      if (cardType !== "储值卡" && cardTimes <= 0) {
        throw new Error("次数卡和套餐卡需要填写可用次数");
      }
      if (cardType === "次数卡" && !cardServiceId) {
        throw new Error("次数卡需要绑定一个服务项目");
      }
      if (cardType === "套餐卡" && cardServiceIds.length === 0) {
        throw new Error("套餐卡至少选择一个可用项目");
      }
      return actions.openMemberCard({
        customerId,
        name: cardName,
        type: cardType,
        balance: cardType === "储值卡" ? cardAmount : 0,
        remainingTimes: cardType === "储值卡" ? 0 : cardTimes,
        serviceId: cardType === "次数卡" ? cardServiceId : undefined,
        serviceIds: cardType === "套餐卡" ? cardServiceIds : undefined,
      });
    });
  };

  const rechargeCard = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.rechargeMemberCard(operationCardId, {
        amount: rechargeAmount,
        times: rechargeTimes,
        note: "门店充值",
      }),
    );
  };

  const addServiceRecord = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.addServiceRecord({
        customerId: recordCustomerId,
        staffId: recordStaffId,
        serviceId: recordServiceId,
        skinCondition,
        beforeNote: "到店皮肤检测",
        afterNote,
        nextFollowUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
      }),
    );
  };

  const updateCustomerTags = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.updateCustomer(tagCustomerId, {
        level: customerLevel,
        source: customerSource,
        tags: parseTags(customerTags),
      }),
    );
  };

  const createCoupon = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.createCouponTemplate({
        name: couponName,
        amount: couponAmount,
        minSpend: couponMinSpend,
        serviceId: couponServiceId || undefined,
        validDays: couponValidDays,
      }),
    );
  };

  const issueCoupon = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.issueCustomerCoupon({
        templateId: issueCouponTemplateId,
        customerId: issueCouponCustomerId,
      }),
    );
  };

  const activeCards = data.memberCards.filter((card) => card.status === "正常");
  const pendingFollowUps = data.customerFollowUps.filter((followUp) => followUp.status === "待跟进").length;
  const allTags = Array.from(new Set(data.customers.flatMap((customer) => customer.tags))).filter(Boolean);
  const filteredCustomers = tagFilter ? data.customers.filter((customer) => customer.tags.includes(tagFilter)) : data.customers;
  const projectScope = (serviceId?: string, serviceIds?: string[]) => {
    if (serviceIds?.length) return serviceIds.map((id) => nameOf(data.services, id)).join(" / ");
    return serviceId ? nameOf(data.services, serviceId) : "通用";
  };
  const recentVisits = data.customers.filter((customer) => {
    const days = (Date.now() - +new Date(customer.lastVisit)) / 86400000;
    return days <= 7;
  }).length;
  const activeCoupons = data.customerCoupons.filter((coupon) => coupon.status === "未使用").length;

  return (
    <div className="page-stack">
      <PageHero
        icon={<UsersRound size={15} />}
        eyebrow="客户会员"
        title="客户会员"
        desc="管理客户档案、会员卡项、护理记录与回访计划。"
        stats={[
          { label: "客户总数", value: `${data.customers.length} 位`, hint: `${recentVisits} 位近 7 天到店`, icon: <UsersRound size={18} /> },
          { label: "有效卡项", value: `${activeCards.length} 张`, hint: "储值与次数卡", icon: <CreditCard size={18} /> },
          { label: "营销券", value: `${activeCoupons} 张`, hint: "未使用客户券", icon: <BadgeCent size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<UsersRound size={18} />} title="新增客户" action="客户资产沉淀" />
        <form className="form" onSubmit={addCustomer}>
          <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <button className="primary-button">保存客户</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<UsersRound size={18} />} title="客户标签" action="分层筛选" />
        <form className="form" onSubmit={updateCustomerTags}>
          <Select label="客户" value={tagCustomerId} onChange={setTagCustomerId} options={data.customers.map(optionOf)} />
          <label>会员等级<input value={customerLevel} onChange={(event) => setCustomerLevel(event.target.value)} placeholder="普通会员 / VIP / 黑金会员" /></label>
          <label>客户来源<input value={customerSource} onChange={(event) => setCustomerSource(event.target.value)} placeholder="门店登记 / 抖音 / 转介绍" /></label>
          <label>客户标签<input value={customerTags} onChange={(event) => setCustomerTags(event.target.value)} placeholder="敏感肌，老客户，高消费" /></label>
          <button className="primary-button">保存标签</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<BadgeCent size={18} />} title="营销发券" action="活动券/客户券" />
        <form className="form" onSubmit={createCoupon}>
          <label>券名称<input value={couponName} onChange={(event) => setCouponName(event.target.value)} /></label>
          <label>抵扣金额<input type="number" value={couponAmount} onChange={(event) => setCouponAmount(Number(event.target.value))} /></label>
          <label>使用门槛<input type="number" value={couponMinSpend} onChange={(event) => setCouponMinSpend(Number(event.target.value))} /></label>
          <Select label="适用项目" value={couponServiceId} onChange={setCouponServiceId} options={[{ value: "", label: "全项目通用" }, ...data.services.map(optionOf)]} />
          <label>有效天数<input type="number" value={couponValidDays} onChange={(event) => setCouponValidDays(Number(event.target.value))} /></label>
          <button className="primary-button">创建券模板</button>
        </form>
        <form className="form compact-form" onSubmit={issueCoupon}>
          <Select label="发放客户" value={issueCouponCustomerId} onChange={setIssueCouponCustomerId} options={data.customers.map(optionOf)} />
          <Select label="券模板" value={issueCouponTemplateId} onChange={setIssueCouponTemplateId} options={data.couponTemplates.map(optionOf)} />
          <button className="primary-button" disabled={!issueCouponTemplateId}>发放给客户</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="开卡/办卡" action="储值或次数" />
        <form className="form" onSubmit={openCard}>
          <Select label="客户" value={customerId} onChange={setCustomerId} options={data.customers.map(optionOf)} />
          <label>卡名称<input value={cardName} onChange={(event) => setCardName(event.target.value)} /></label>
          <Select label="卡类型" value={cardType} onChange={(value) => setCardType(value as CardType)} options={["储值卡", "次数卡", "套餐卡"].map((item) => ({ value: item, label: item }))} />
          {cardType === "储值卡" && (
            <label>储值金额<input type="number" value={cardAmount} onChange={(event) => setCardAmount(Number(event.target.value))} /></label>
          )}
          {cardType !== "储值卡" && (
            <label>可用次数<input type="number" value={cardTimes} onChange={(event) => setCardTimes(Number(event.target.value))} /></label>
          )}
          {cardType === "次数卡" && <Select label="绑定项目" value={cardServiceId} onChange={setCardServiceId} options={data.services.map(optionOf)} />}
          {cardType === "套餐卡" && <CheckboxGroup label="可用项目" values={cardServiceIds} onChange={setCardServiceIds} options={data.services.map(optionOf)} />}
          <button className="primary-button">开卡</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="卡项操作" action="充值/冻结/延期/转卡" />
        <form className="form" onSubmit={rechargeCard}>
          <Select label="会员卡" value={operationCardId} onChange={setOperationCardId} options={data.memberCards.map((card) => ({ value: card.id, label: `${nameOf(data.customers, card.customerId)} · ${card.name}` }))} />
          <label>充值金额<input type="number" value={rechargeAmount} onChange={(event) => setRechargeAmount(Number(event.target.value))} /></label>
          <label>充值次数<input type="number" value={rechargeTimes} onChange={(event) => setRechargeTimes(Number(event.target.value))} /></label>
          <button className="primary-button">充值</button>
        </form>
        <div className="inline-actions">
          <button onClick={() => void runMutation(() => actions.updateMemberCardStatus(operationCardId, "冻结", "门店冻结"))}>冻结</button>
          <button onClick={() => void runMutation(() => actions.updateMemberCardStatus(operationCardId, "正常", "门店解冻"))}>解冻</button>
        </div>
        <div className="inline-form compact">
          <label>延期至<input type="date" value={extendTo} onChange={(event) => setExtendTo(event.target.value)} /></label>
          <button onClick={() => void runMutation(() => actions.extendMemberCard(operationCardId, extendTo, "客户延期"))}>延期</button>
        </div>
        <div className="inline-form compact">
          <Select label="转给客户" value={transferToCustomerId} onChange={setTransferToCustomerId} options={data.customers.map(optionOf)} />
          <button onClick={() => void runMutation(() => actions.transferMemberCard(operationCardId, transferToCustomerId, "客户转卡"))}>转卡</button>
        </div>
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="服务档案" action="护理记录/回访" />
        <form className="form" onSubmit={addServiceRecord}>
          <Select label="客户" value={recordCustomerId} onChange={setRecordCustomerId} options={data.customers.map(optionOf)} />
          <Select label="员工" value={recordStaffId} onChange={setRecordStaffId} options={data.staff.map(optionOf)} />
          <Select label="项目" value={recordServiceId} onChange={setRecordServiceId} options={data.services.map(optionOf)} />
          <label>皮肤情况<input value={skinCondition} onChange={(event) => setSkinCondition(event.target.value)} /></label>
          <label>服务记录<textarea value={afterNote} onChange={(event) => setAfterNote(event.target.value)} /></label>
          <label>下次回访<input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /></label>
          <button className="primary-button">保存档案</button>
        </form>
        </section>
        <section className="panel wide">
        <PanelTitle icon={<UsersRound size={18} />} title="客户列表" action={`${filteredCustomers.length}/${data.customers.length} 位客户`} />
        <div className="inline-actions">
          <button className={!tagFilter ? "active" : ""} onClick={() => setTagFilter("")}>全部</button>
          {allTags.map((tag) => (
            <button className={tagFilter === tag ? "active" : ""} key={tag} onClick={() => setTagFilter(tag)}>{tag}</button>
          ))}
        </div>
        <DataTable
          columns={["客户", "手机", "等级", "标签", "最近到店", "卡项"]}
          rows={filteredCustomers.map((customer) => [
            customer.name,
            customer.phone,
            customer.level,
            customer.tags.join(" / "),
            shortDate(customer.lastVisit),
            data.memberCards
              .filter((card) => card.customerId === customer.id)
              .map((card) => `${card.name}(${projectScope(card.serviceId, card.serviceIds)})`)
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
            projectScope(card.serviceId, card.serviceIds),
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
        <PanelTitle icon={<BadgeCent size={18} />} title="客户营销券" action="发放/核销状态" />
        <DataTable
          columns={["客户", "券名称", "抵扣", "门槛", "适用项目", "状态", "到期"]}
          rows={data.customerCoupons.map((coupon) => [
            nameOf(data.customers, coupon.customerId),
            coupon.name,
            money(coupon.amount),
            money(coupon.minSpend),
            coupon.serviceId ? nameOf(data.services, coupon.serviceId) : "通用",
            <Badge key={`${coupon.id}-status`} text={coupon.status} tone={coupon.status === "未使用" ? "ok" : "warn"} />,
            shortDate(coupon.expiresAt),
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
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="护理档案" action={`${data.customerServiceRecords.length} 条`} />
        <DataTable
          columns={["客户", "员工", "项目", "皮肤情况", "服务记录", "时间"]}
          rows={data.customerServiceRecords.map((record) => [
            nameOf(data.customers, record.customerId),
            nameOf(data.staff, record.staffId),
            nameOf(data.services, record.serviceId),
            record.skinCondition,
            record.afterNote,
            shortDate(record.createdAt),
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="客户跟进" action={`${data.customerFollowUps.length} 条`} />
        <DataTable
          columns={["客户", "员工", "方式", "计划时间", "状态", "备注", "操作"]}
          rows={data.customerFollowUps.map((followUp) => [
            nameOf(data.customers, followUp.customerId),
            nameOf(data.staff, followUp.staffId),
            followUp.method,
            shortDate(followUp.dueAt),
            <Badge key={`${followUp.id}-status`} text={followUp.status} />,
            followUp.note,
            followUp.status === "待跟进" ? (
              <button key={`${followUp.id}-done`} onClick={() => void runMutation(() => actions.completeFollowUp(followUp.id))}>完成</button>
            ) : (
              "已完成"
            ),
          ])}
        />
        </section>
      </div>
    </div>
  );
}

function Catalog({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState(398);
  const [serviceDuration, setServiceDuration] = useState(60);
  const [serviceConsumableProductId, setServiceConsumableProductId] = useState("");
  const [serviceConsumableQty, setServiceConsumableQty] = useState(1);
  const [productName, setProductName] = useState("");
  const [productStock, setProductStock] = useState(10);
  const consumableOptions = data.products
    .filter((product) => product.type === "consumable")
    .map((product) => ({ value: product.id, label: `${product.name} · ${product.stock}${product.unit}` }));

  const addService = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.addService({
        name: serviceName,
        price: servicePrice,
        category: "自定义项目",
        duration: serviceDuration,
        consumableProductId: serviceConsumableProductId || undefined,
        consumableQty: serviceConsumableProductId ? serviceConsumableQty : undefined,
      }),
    );
    setServiceName("");
    setServiceConsumableProductId("");
    setServiceConsumableQty(1);
  };

  const addProduct = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addProduct({ name: productName, stock: productStock, type: "consumable", unit: "件" }));
    setProductName("");
  };

  return (
    <div className="page-stack">
      <PageHero
        icon={<Sparkles size={15} />}
        eyebrow="项目商品"
        title="项目商品"
        desc="维护服务项目、商品资料、耗材库存和标准价格。"
        stats={[
          { label: "服务项目", value: `${data.services.length} 个`, hint: "可用于预约/开单", icon: <Sparkles size={18} /> },
          { label: "商品耗材", value: `${data.products.length} 个`, hint: "库存资料", icon: <Boxes size={18} /> },
          { label: "低库存", value: `${data.products.filter((item) => item.stock <= item.warningStock).length} 项`, hint: "需补货", icon: <PackagePlus size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<Sparkles size={18} />} title="新增项目" action="服务目录" />
        <form className="form" onSubmit={addService}>
          <label>项目名称<input value={serviceName} onChange={(event) => setServiceName(event.target.value)} required /></label>
          <label>标准价格<input type="number" value={servicePrice} onChange={(event) => setServicePrice(Number(event.target.value))} /></label>
          <label>服务时长<input type="number" value={serviceDuration} onChange={(event) => setServiceDuration(Number(event.target.value))} /></label>
          <Select
            label="默认耗材"
            value={serviceConsumableProductId}
            onChange={setServiceConsumableProductId}
            options={[{ value: "", label: "不绑定耗材" }, ...consumableOptions]}
          />
          {serviceConsumableProductId && (
            <label>单次用量<input type="number" min={0} step={0.1} value={serviceConsumableQty} onChange={(event) => setServiceConsumableQty(Number(event.target.value))} /></label>
          )}
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
          <DataTable
            columns={["项目", "分类", "价格", "时长", "默认耗材"]}
            rows={data.services.map((item) => [
              item.name,
              item.category,
              money(item.price),
              `${item.duration} 分钟`,
              item.consumableProductId
                ? `${nameOf(data.products, item.consumableProductId)} × ${item.consumableQty ?? 0}`
                : "未配置",
            ])}
          />
          <DataTable columns={["商品", "类型", "库存", "预警"]} rows={data.products.map((item) => [item.name, item.type === "sale" ? "销售商品" : "服务耗材", `${item.stock}${item.unit}`, `${item.warningStock}${item.unit}`])} />
        </div>
        </section>
      </div>
    </div>
  );
}

function StaffCommissions({ data, session, actions, runMutation }: { data: AppData; session: UserSession; actions: ApiActions; runMutation: RunMutation }) {
  const canManageStaff = hasPermission(session, "staff:manage");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("美容师");
  const [baseSalary, setBaseSalary] = useState(6500);
  const [commissionRate, setCommissionRate] = useState(0.12);
  const [inviteStaffId, setInviteStaffId] = useState(data.staff[0]?.id ?? "");
  const [inviteAccount, setInviteAccount] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("therapist");

  const settleAll = () => {
    void runMutation(actions.settleCommissions);
  };

  const addStaff = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addStaff({ name, phone, role, baseSalary, commissionRate }));
    setName("");
    setPhone("");
  };

  const createInvite = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createStaffInvite({ staffId: inviteStaffId, account: inviteAccount, role: inviteRole }));
  };

  const activeStaff = data.staff.filter((staff) => staff.status === "active").length;
  const pendingInvites = data.staffInvites.filter((invite) => invite.status === "待加入").length;
  const pendingCommission = data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="page-stack">
      <PageHero
        icon={<BadgeCent size={15} />}
        eyebrow="员工提成"
        title="员工提成"
        desc="管理员工档案、邀请码、岗位权限与提成结算。"
        stats={[
          { label: "在职员工", value: `${activeStaff} 人`, hint: `${data.staff.length} 人档案`, icon: <UsersRound size={18} /> },
          { label: "待加入员工", value: `${pendingInvites} 个`, hint: "邀请未完成", icon: <LockKeyhole size={18} /> },
          { label: "待结提成", value: money(pendingCommission), hint: "财务待处理", icon: <BadgeCent size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<BadgeCent size={18} />} title="员工档案" action={canManageStaff ? "先建档，再邀请加入" : "个人视图"} />
        {canManageStaff ? (
          <>
            <form className="form" onSubmit={addStaff}>
              <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
              <Select label="岗位" value={role} onChange={setRole} options={["店长", "美容师", "前台", "财务"].map((item) => ({ value: item, label: item }))} />
              <label>底薪<input type="number" value={baseSalary} onChange={(event) => setBaseSalary(Number(event.target.value))} /></label>
              <label>提成比例<input type="number" step="0.01" value={commissionRate} onChange={(event) => setCommissionRate(Number(event.target.value))} /></label>
              <button className="primary-button">保存员工档案</button>
            </form>
            <div className="divider" />
            <PanelTitle icon={<LockKeyhole size={18} />} title="邀请员工" action="邀请码加入" />
            <form className="form" onSubmit={createInvite}>
              <Select label="员工" value={inviteStaffId} onChange={setInviteStaffId} options={data.staff.map(optionOf)} />
              <label>员工手机号/账号<input value={inviteAccount} onChange={(event) => setInviteAccount(event.target.value)} placeholder="确认邀请码后用于登录" /></label>
              <Select
                label="账号角色"
                value={inviteRole}
                onChange={(value) => setInviteRole(value as UserRole)}
                options={[
                  { value: "manager", label: "店长" },
                  { value: "frontdesk", label: "前台" },
                  { value: "therapist", label: "美容师" },
                  { value: "finance", label: "财务" },
                ]}
              />
              <button className="primary-button">生成邀请</button>
            </form>
          </>
        ) : (
          <div className="settings-card compact">
            <strong>{session.user.name}</strong>
            <span>角色：{session.user.roleName}</span>
            <span>账号：{session.user.account}</span>
          </div>
        )}
        </section>
        <section className="panel wide">
        <PanelTitle icon={<UsersRound size={18} />} title="员工档案" action={`${data.staff.length} 人`} />
        <DataTable
          columns={["员工", "岗位", "手机号", "状态", "账号", "底薪", "提成比例", "操作"]}
          rows={data.staff.map((staff) => [
            staff.name,
            staff.role,
            staff.phone,
            <Badge key={`${staff.id}-status`} text={staff.status === "active" ? "在职" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />,
            data.authUsers.find((user) => user.staffId === staff.id)?.account ?? "未开通",
            money(staff.baseSalary ?? 0),
            `${Math.round((staff.commissionRate ?? 0) * 100)}%`,
            canManageStaff ? (
              <button
                key={`${staff.id}-toggle`}
                onClick={() => void runMutation(() => actions.updateStaff(staff.id, { status: staff.status === "active" ? "inactive" : "active" }))}
              >
                {staff.status === "active" ? "停用" : "启用"}
              </button>
            ) : (
              "仅查看"
            ),
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<LockKeyhole size={18} />} title="邀请记录" action={`${data.staffInvites.length} 条`} />
        <DataTable
          columns={["员工", "账号", "角色", "状态", "邀请码", "创建时间"]}
          rows={data.staffInvites.map((invite) => [
            nameOf(data.staff, invite.staffId),
            invite.account,
            invite.role,
            <Badge key={`${invite.id}-status`} text={invite.status} />,
            invite.inviteCode,
            shortDate(invite.createdAt),
          ])}
        />
        <div className="divider" />
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
    </div>
  );
}

function Inventory({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState<InventoryLog["type"]>("入库");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [purchaseProductId, setPurchaseProductId] = useState(data.products[0]?.id ?? "");
  const [purchaseQuantity, setPurchaseQuantity] = useState(5);
  const [unitCost, setUnitCost] = useState(68);
  const [stocktakeProductId, setStocktakeProductId] = useState(data.products[0]?.id ?? "");
  const [actualStock, setActualStock] = useState(data.products[0]?.stock ?? 0);

  const changeStock = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.adjustInventory({ productId, type, quantity }));
  };

  const addSupplier = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addSupplier({ name: supplierName, phone: supplierPhone, contact: "采购联系人" }));
  };

  const receivePurchase = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.receivePurchaseOrder({ supplierId, productId: purchaseProductId, quantity: purchaseQuantity, unitCost }));
  };

  const createStocktake = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createStocktake({ productId: stocktakeProductId, actualStock, reason: "门店盘点" }));
  };

  const lowStock = data.products.filter((item) => item.stock <= item.warningStock).length;
  const stockValue = data.products.reduce((sum, item) => sum + item.stock, 0);

  return (
    <div className="page-stack">
      <PageHero
        icon={<Boxes size={15} />}
        eyebrow="库存管理"
        title="库存管理"
        desc="管理商品耗材、采购入库、库存流水和盘点差异。"
        stats={[
          { label: "库存品项", value: `${data.products.length} 个`, hint: `合计库存 ${stockValue}`, icon: <Boxes size={18} /> },
          { label: "低库存", value: `${lowStock} 项`, hint: "低于预警值", icon: <PackagePlus size={18} /> },
          { label: "供应商", value: `${data.suppliers.length} 家`, hint: "采购基础资料", icon: <Building2 size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="库存操作" action="入库/报损/盘点" />
        <form className="form" onSubmit={changeStock}>
          <Select label="商品/耗材" value={productId} onChange={setProductId} options={data.products.map(optionOf)} />
          <Select label="操作类型" value={type} onChange={(value) => setType(value as InventoryLog["type"])} options={["入库", "报损", "盘点调整"].map((item) => ({ value: item, label: item }))} />
          <label>数量<input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <button className="primary-button">保存库存流水</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<Boxes size={18} />} title="供应商" action="采购基础资料" />
        <form className="form" onSubmit={addSupplier}>
          <label>供应商名称<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
          <label>联系电话<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} /></label>
          <button className="primary-button">新增供应商</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<PackagePlus size={18} />} title="采购入库" action="生成采购单" />
        <form className="form" onSubmit={receivePurchase}>
          <Select label="供应商" value={supplierId} onChange={setSupplierId} options={data.suppliers.map(optionOf)} />
          <Select label="商品/耗材" value={purchaseProductId} onChange={setPurchaseProductId} options={data.products.map(optionOf)} />
          <label>入库数量<input type="number" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(Number(event.target.value))} /></label>
          <label>采购单价<input type="number" value={unitCost} onChange={(event) => setUnitCost(Number(event.target.value))} /></label>
          <button className="primary-button">确认入库</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="库存盘点" action="调整账实差异" />
        <form className="form" onSubmit={createStocktake}>
          <Select label="商品/耗材" value={stocktakeProductId} onChange={setStocktakeProductId} options={data.products.map(optionOf)} />
          <label>实盘库存<input type="number" value={actualStock} onChange={(event) => setActualStock(Number(event.target.value))} /></label>
          <button className="primary-button">提交盘点</button>
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
        <div className="divider" />
        <PanelTitle icon={<PackagePlus size={18} />} title="采购与盘点记录" action="P1 门店进销存" />
        <div className="split-list">
          <DataTable
            columns={["供应商", "商品", "数量", "单价", "时间"]}
            rows={data.purchaseOrders.map((order) => [
              nameOf(data.suppliers, order.supplierId),
              nameOf(data.products, order.productId),
              order.quantity,
              money(order.unitCost),
              shortDate(order.createdAt),
            ])}
          />
          <DataTable
            columns={["商品", "账面", "实盘", "差异", "原因", "时间"]}
            rows={data.stocktakes.map((stocktake) => [
              nameOf(data.products, stocktake.productId),
              stocktake.systemStock,
              stocktake.actualStock,
              stocktake.delta,
              stocktake.reason,
              shortDate(stocktake.createdAt),
            ])}
          />
        </div>
        </section>
      </div>
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
    <div className="page-stack">
      <PageHero
        icon={<ChartNoAxesColumnIncreasing size={15} />}
        eyebrow="报表分析"
        title="报表分析"
        desc="查看实收、退款、会员储值、员工提成与营业日结。"
        stats={[
          { label: "实收现金流", value: money(summary.revenue), hint: `退款 ${money(summary.refundAmount)}`, icon: <CreditCard size={18} /> },
          { label: "项目服务数", value: `${summary.serviceCount} 单`, hint: "已完成收银", icon: <Sparkles size={18} /> },
          { label: "员工提成", value: money(summary.commission), hint: "服务提成合计", icon: <BadgeCent size={18} /> },
        ]}
      />
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
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营分析" action="核心指标" />
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
          onReverse={() => void runMutation(() => actions.reverseDailyClose(businessDate))}
        />
        <DataTable
          columns={["营业日", "状态", "实收", "退款", "订单", "微信", "会员卡", "提成", "时间"]}
          rows={data.dailyCloses.map((item) => [
            item.businessDate,
            <Badge key={`${item.id}-status`} text={item.status} tone={item.status === "已反结" ? "warn" : "ok"} />,
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
    </div>
  );
}

function Approvals({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const [type, setType] = useState<"改价折扣" | "订单退款">("改价折扣");
  const [targetId, setTargetId] = useState("manual");
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("门店例外处理");

  const createApproval = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createApproval({ type, targetId, amount, reason }));
  };

  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const passedApprovals = data.approvalRequests.filter((item) => item.status === "已通过").length;
  const rejectedApprovals = data.approvalRequests.filter((item) => item.status === "已拒绝").length;

  return (
    <div className="page-stack">
      <PageHero
        icon={<ShieldCheck size={15} />}
        eyebrow="审批中心"
        title="审批中心"
        desc="处理改价折扣、订单退款和门店例外审批。"
        stats={[
          { label: "待审批", value: `${pendingApprovals} 单`, hint: "需要处理", icon: <ShieldCheck size={18} /> },
          { label: "已通过", value: `${passedApprovals} 单`, hint: "可用于业务", icon: <ClipboardList size={18} /> },
          { label: "已拒绝", value: `${rejectedApprovals} 单`, hint: "风险拦截", icon: <LockKeyhole size={18} /> },
        ]}
      />
      <div className="content-grid">
        <section className="panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="提交审批" action="改价/退款" />
        <form className="form" onSubmit={createApproval}>
          <Select label="审批类型" value={type} onChange={(value) => setType(value as "改价折扣" | "订单退款")} options={["改价折扣", "订单退款"].map((item) => ({ value: item, label: item }))} />
          <label>关联对象<input value={targetId} onChange={(event) => setTargetId(event.target.value)} /></label>
          <label>金额<input type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
          <label>原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="primary-button">提交审批</button>
        </form>
        </section>
        <section className="panel wide">
        <PanelTitle icon={<ShieldCheck size={18} />} title="审批列表" action={`${data.approvalRequests.length} 条`} />
        <DataTable
          columns={["类型", "对象", "金额", "原因", "申请人", "状态", "时间", "操作"]}
          rows={data.approvalRequests.map((approval) => [
            approval.type,
            approval.targetId,
            money(approval.amount),
            approval.reason,
            nameOf(data.staff, data.staff.find((staff) => staff.id === approval.requestedBy)?.id ?? "") || approval.requestedBy,
            <Badge key={`${approval.id}-status`} text={approval.status} tone={approval.status === "已拒绝" ? "warn" : approval.status === "已通过" ? "ok" : undefined} />,
            shortDate(approval.createdAt),
            approval.status === "待审批" ? (
              <div key={`${approval.id}-actions`} className="row-actions">
                <button onClick={() => void runMutation(() => actions.decideApproval(approval.id, true))}>通过</button>
                <button onClick={() => void runMutation(() => actions.decideApproval(approval.id, false))}>拒绝</button>
              </div>
            ) : (
              approval.approvedAt ? shortDate(approval.approvedAt) : "已处理"
            ),
          ])}
        />
        </section>
      </div>
    </div>
  );
}

function DailyCloseControl({
  businessDate,
  setBusinessDate,
  onClose,
  onReverse,
}: {
  businessDate: string;
  setBusinessDate: (value: string) => void;
  onClose: () => void;
  onReverse: () => void;
}) {
  return (
    <div className="inline-form">
      <label>
        营业日
        <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
      </label>
      <button onClick={onClose}>生成日结</button>
      <button className="secondary-button" onClick={onReverse}>反结解锁</button>
    </div>
  );
}

function SettingsView({ data, session, setView }: { data: AppData; session: UserSession; setView: (view: ViewKey) => void }) {
  const store = data.storeProfiles[0];
  const activeStaff = data.staff.filter((staff) => staff.status === "active").length;
  const pendingInvites = data.staffInvites.filter((invite) => invite.status === "待加入").length;
  const pendingApprovals = data.approvalRequests.filter((approval) => approval.status === "待审批").length;
  const managementCards: Array<{
    title: string;
    desc: string;
    metric: string;
    icon: typeof LayoutDashboard;
    tone: "rose" | "violet" | "teal" | "amber";
    view: ViewKey;
  }> = [
    { title: "系统流程图", desc: "预约、开单、会员、库存、财务链路", metric: "全链路", icon: Network, tone: "rose", view: "dashboard" },
    { title: "客户运营", desc: "新客登记、客户来源、转化跟进", metric: `${data.customers.length} 客户`, icon: UsersRound, tone: "rose", view: "customers" },
    { title: "门店业绩", desc: "项目成交、协作服务、业绩归因", metric: `${data.orders.length} 订单`, icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "售后回访", desc: "回访任务、服务记录、售后触达", metric: `${data.customerFollowUps.length} 回访`, icon: Headphones, tone: "teal", view: "customers" },
    { title: "员工档案", desc: "岗位、底薪、提成比例、在职状态", metric: `${activeStaff} 在职`, icon: Building2, tone: "violet", view: "staff" },
    { title: "组织架构", desc: "老板、店长、前台、美容师、财务", metric: `${data.authUsers.length} 账号`, icon: Share2, tone: "teal", view: "staff" },
    { title: "邀请员工", desc: "为员工生成邀请码，加入后开通账号", metric: `${pendingInvites} 待加入`, icon: ShieldCheck, tone: "violet", view: "staff" },
    { title: "客户池", desc: "客户线索、会员资产、客户标签", metric: `${data.memberCards.length} 卡项`, icon: Database, tone: "violet", view: "customers" },
    { title: "跟进记录", desc: "按团队、顾问查看客户跟进内容", metric: `${pendingApprovals} 审批`, icon: MessageCircle, tone: "violet", view: "approvals" },
    { title: "公告中心", desc: "全员通知、团队公告、个人推送", metric: "待接入", icon: Megaphone, tone: "rose", view: "settings" },
    { title: "产品管理", desc: "产品、类别、项目、耗材资料", metric: `${data.products.length} 商品`, icon: Boxes, tone: "amber", view: "catalog" },
    { title: "薪资提成", desc: "底薪、提成比例、项目提成结算", metric: money(data.commissions.reduce((sum, item) => sum + item.amount, 0)), icon: HeartHandshake, tone: "teal", view: "staff" },
  ];

  return (
    <div className="admin-center-page">
      <section className="admin-profile-hero">
        <div className="admin-avatar">
          <UserRound size={34} />
        </div>
        <div className="admin-profile-copy">
          <span className="admin-role-pill"><ShieldCheck size={14} /> {session.user.roleName}</span>
          <h2>{session.user.name}</h2>
          <p>{session.user.account}</p>
        </div>
      </section>

      <section className="admin-code-panel">
        <div>
          <h2>管理员系统信号</h2>
          <p>员工出问题加这个微信咨询，留空则隐藏客服入口</p>
        </div>
        <input value={store?.phone ?? ""} readOnly aria-label="管理员联系信号" />
        <button className="primary-button" type="button"><LockKeyhole size={16} /> 保存</button>
      </section>

      <section className="admin-module-section">
        <div className="admin-section-title">
          <span>管理入口</span>
        </div>
        <div className="admin-module-grid">
          {managementCards.map((item) => (
            <AdminCenterCard key={item.title} item={item} onClick={() => setView(item.view)} />
          ))}
        </div>
      </section>

    </div>
  );
}

function AdminCenterCard({
  item,
  onClick,
}: {
  item: { title: string; desc: string; metric: string; icon: typeof LayoutDashboard; tone: "rose" | "violet" | "teal" | "amber" };
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className="admin-module-card" onClick={onClick}>
      <span className={`admin-module-icon ${item.tone}`}><Icon size={22} /></span>
      <strong>{item.title}</strong>
      <small>{item.desc}</small>
      <em>{item.metric}</em>
    </button>
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
        <span>暂无可选项</span>
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

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，、/\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
