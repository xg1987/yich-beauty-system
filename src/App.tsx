import {
  BadgeCent,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  Copy,
  CreditCard,
  Database,
  DoorOpen,
  ArrowLeft,
  Eye,
  EyeOff,
  HeartHandshake,
  LayoutDashboard,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  PackagePlus,
  RefreshCw,
  Save,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { AccountMenu } from "./components/business/AccountMenu";
import { NotificationPanel, visibleNotifications } from "./components/business/NotificationPanel";
import { UserAvatar } from "./components/business/UserAvatar";
import { PageHero } from "./components/layout/PageHero";
import { PanelTitle } from "./components/layout/PanelTitle";
import { StatCard } from "./components/layout/StatCard";
import { Badge } from "./components/ui/Badge";
import { CheckboxGroup } from "./components/ui/CheckboxGroup";
import { DataTable } from "./components/ui/DataTable";
import { DateTimeInput } from "./components/ui/DateTimeInput";
import { Modal } from "./components/ui/Modal";
import { Select } from "./components/ui/Select";
import { calculateOrderTotal, platformInviteCodeForPlatformAdmin, reportSummary, storeStaffInviteCodeForStoreUser } from "./domain/business";
import { appointmentRangeMap, assignAppointmentRooms, calculateAppointmentRoomUsage, filterAppointmentsByRange, type AppointmentRange } from "./domain/appointments";
import { canAccessView, hasPermission, parseRolePermissionTemplates, serializeRolePermissionTemplates, type Permission, type UserSession } from "./domain/auth";
import type { AppData, Appointment, InventoryLog, Order, Product, R2UsageSnapshot, Service, ServiceConsumable, Staff, SystemConfigKey, UserRole, ViewKey, WorkerUsageSnapshot } from "./domain/types";
import { money, shortDate, toLocalInputValue, tomorrowAt } from "./domain/utils";
import { type ApiActions, useApiData } from "./hooks/useApiData";
import LoginPage from "./pages/auth/LoginPage";
import CustomerSignaturePage from "./pages/public/CustomerSignaturePage";
import StorefrontPage from "./pages/public/StorefrontPage";
import packageJson from "../package.json";

type WorkbarKey = "workbench" | "appointments" | "cashier" | "customers" | "admin";
type ThemeMode = "auto" | "day" | "night";
type EffectiveThemeMode = Exclude<ThemeMode, "auto">;
type CardType = "储值卡" | "次数卡" | "套餐卡";
type InventoryModuleKey = "stockIn" | "adjust" | "supplier" | "purchase" | "stocktake" | "list" | "logs";
type NavigateOptions = { fromAdmin?: boolean; inventoryModule?: InventoryModuleKey };
type NavigateToView = (view: ViewKey, options?: NavigateOptions) => void;

const THEME_KEY = "yich-system-theme";
const APP_VERSION = packageJson.version;
const APP_BUILD_DATE = "2026-06-05";
const AUTO_THEME_TIME_ZONE = "Asia/Shanghai";
const AUTO_THEME_DAY_START_HOUR = 8;
const AUTO_THEME_NIGHT_START_HOUR = 19;
const DEFAULT_APPOINTMENT_ROOM_NAMES = ["护理房 1", "护理房 2", "VIP护理房", "仪器房", "身心护理房", "备用房"];
const INVENTORY_CATEGORY_PRESETS: Record<string, string[]> = {
  面护类: ["膏霜", "面膜", "精华", "精油", "防晒", "软膜", "眼护", "套盒", "口服", "次抛"],
  养生类: ["泥灸", "私密", "套盒", "膏霜", "身体油", "泡脚汤", "艾灸"],
};
const inventoryCategoryOptions = Object.keys(INVENTORY_CATEGORY_PRESETS).map((category) => ({ value: category, label: category }));
const HIDDEN_ACCOUNT_LIST_ACCOUNTS = new Set(["admin@yich.local"]);
const VISIBLE_PLATFORM_ADMIN_ACCOUNT = "13827445244";
const permissionLabels: Record<Permission, string> = {
  "dashboard:view": "工作台",
  "appointments:manage": "预约管理",
  "pos:manage": "开单收银",
  "customers:manage": "客户档案",
  "catalog:manage": "项目商品",
  "staff:view": "查看员工",
  "staff:manage": "员工管理",
  "commissions:settle": "提成结算",
  "inventory:manage": "库存管理",
  "reports:view": "报表分析",
  "approvals:manage": "审批中心",
  "logs:view": "操作日志",
  "settings:view": "系统设置",
};
const permissionOptions = (Object.keys(permissionLabels) as Permission[]).map((permission) => ({
  value: permission,
  label: permissionLabels[permission],
}));
const roleScopeLabels: Record<UserRole, string> = {
  superadmin: "平台级",
  owner: "门店全部",
  manager: "门店管理",
  frontdesk: "到店业务",
  therapist: "本人服务",
  finance: "财务处理",
};

function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsInputValue(months: number, baseDate = new Date()) {
  if (!Number.isFinite(months) || months <= 0) return "";
  const date = new Date(baseDate);
  date.setMonth(date.getMonth() + Math.round(months));
  return dateInputValue(date);
}

function productExpiryText(product: Product) {
  return product.expiryAt ? shortDate(product.expiryAt) : "未设置";
}

function productExpiryStatus(product: Product) {
  if (!product.expiryAt) return undefined;
  const today = new Date(`${dateInputValue()}T00:00:00`).getTime();
  const expiry = new Date(`${product.expiryAt}T00:00:00`).getTime();
  if (Number.isNaN(expiry)) return undefined;
  const daysLeft = Math.ceil((expiry - today) / 86400000);
  if (daysLeft < 0) return { text: "已过期", tone: "warn" as const };
  if (daysLeft <= 30) return { text: "临期", tone: "warn" as const };
  return undefined;
}
const viewTitles: Record<ViewKey, string> = {
  dashboard: "工作台",
  appointments: "预约管理",
  pos: "开单收银",
  customers: "客户档案",
  catalog: "项目商品",
  staff: "人员账号",
  inventory: "库存管理",
  reports: "报表分析",
  approvals: "审批中心",
  logs: "操作日志",
  accounts: "账号管理",
  permissions: "权限审批",
  usage: "服务器用量监控",
  roomSettings: "房间设置",
  settings: "管理中心",
};

type ModuleTone = "rose" | "violet" | "teal" | "amber" | "jade" | "plum";
type FeatureModule<Key extends string> = {
  key: Key;
  title: string;
  desc: string;
  icon: typeof LayoutDashboard;
  tone: ModuleTone;
  meta?: string;
  points?: string[];
};

function ModuleOverview<Key extends string>({
  modules,
  activeKey,
  onSelect,
}: {
  modules: Array<FeatureModule<Key>>;
  activeKey?: Key;
  onSelect: (key: Key) => void;
}) {
  return (
    <section className="module-overview" aria-label="功能模块">
      {modules.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            aria-pressed={activeKey === item.key}
            className={`module-entry-card ${item.tone}${activeKey === item.key ? " active" : ""}`}
            key={item.key}
            onClick={() => onSelect(item.key)}
          >
            <span className={`admin-module-icon ${item.tone}`}><Icon size={20} /></span>
            <strong>{item.title}</strong>
            <small>{item.desc}</small>
            {item.points && (
              <span className="module-entry-points">
                {item.points.map((point) => <i key={point}>{point}</i>)}
              </span>
            )}
            {item.meta && <em>{item.meta}</em>}
          </button>
        );
      })}
    </section>
  );
}

function ModuleSubpageHeader({
  parentTitle,
  moduleTitle,
  onBack,
}: {
  parentTitle: string;
  moduleTitle: string;
  onBack: () => void;
}) {
  return (
    <div className="module-subpage-header">
      <button type="button" className="back-to-admin" onClick={onBack}>
        <ArrowLeft size={18} />
        返回{parentTitle}
      </button>
      <strong>{moduleTitle}</strong>
    </div>
  );
}

function isBusinessStaff(staff: Staff) {
  return staff.role !== "老板";
}

function businessStaffOf(data: AppData) {
  return data.staff.filter(isBusinessStaff);
}

function firstBusinessStaffId(data: AppData) {
  return businessStaffOf(data)[0]?.id ?? "";
}

function normalizedAccount(account: string) {
  return account.trim().toLowerCase();
}

function isVisibleAccount(user: { account: string }) {
  return !HIDDEN_ACCOUNT_LIST_ACCOUNTS.has(normalizedAccount(user.account));
}

function isVisiblePlatformAdmin(user: { account: string; role: UserRole }) {
  return normalizedAccount(user.account) === VISIBLE_PLATFORM_ADMIN_ACCOUNT || user.role === "superadmin";
}

function displayRoleName(user: { account: string; role: UserRole; roleName: string }) {
  if (isVisiblePlatformAdmin(user)) return "系统管理员";
  if (user.role === "owner" || user.role === "manager") return "店长";
  return user.roleName === "老板" || user.roleName === "主管" ? "店长" : user.roleName;
}

function displayStaffRole(role: string) {
  return role === "老板" || role === "主管" ? "店长" : role;
}

function userRoleForStaffRole(role: string): UserRole {
  if (role === "店长" || role === "主管") return "manager";
  if (role === "前台") return "frontdesk";
  if (role === "财务") return "finance";
  return "therapist";
}

function displayUserRole(role: UserRole) {
  const labels: Record<UserRole, string> = {
    superadmin: "系统管理员",
    owner: "店长",
    manager: "店长",
    frontdesk: "前台",
    therapist: "员工",
    finance: "财务",
  };
  return labels[role];
}

function roomNamesOf(data: AppData) {
  const names = data.storeProfiles[0]?.roomNames?.map((roomName) => roomName.trim()).filter(Boolean) ?? [];
  return names.length > 0 ? names : DEFAULT_APPOINTMENT_ROOM_NAMES;
}

function maintenanceRoomNamesOf(data: AppData, roomNames = roomNamesOf(data)) {
  const storeProfile = data.storeProfiles[0];
  const savedNames = storeProfile?.maintenanceRoomNames;
  if (savedNames?.length) {
    return Array.from(new Set(savedNames.map((roomName) => roomName.trim()).filter((roomName) => roomNames.includes(roomName))));
  }
  const legacyCount = Math.max(0, Math.min(roomNames.length, storeProfile?.maintenanceRoomCount ?? 0));
  return roomNames.slice(Math.max(0, roomNames.length - legacyCount));
}

function parseRoomNames(value: string) {
  return value
    .split(/\n|,|，/)
    .map((roomName) => roomName.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function hasTimeOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

function isActiveRoomAppointment(appointment: Appointment) {
  return !["已完成", "已取消", "爽约"].includes(appointment.status);
}

async function copyTextToClipboard(text: string) {
  const value = text.trim();
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  if (selection && selectedRange) {
    selection.removeAllRanges();
    selection.addRange(selectedRange);
  }

  return copied;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "auto" || value === "day" || value === "night";
}

function getSystemThemeMode(): EffectiveThemeMode {
  const shanghaiHourText = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: AUTO_THEME_TIME_ZONE,
  }).format(new Date());
  const shanghaiHour = Number(shanghaiHourText === "24" ? "0" : shanghaiHourText);
  if (!Number.isFinite(shanghaiHour)) return "day";
  return shanghaiHour >= AUTO_THEME_DAY_START_HOUR && shanghaiHour < AUTO_THEME_NIGHT_START_HOUR ? "day" : "night";
}

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "工作台", icon: LayoutDashboard },
  { key: "appointments", label: "预约管理", icon: CalendarDays },
  { key: "pos", label: "开单收银", icon: CreditCard },
  { key: "customers", label: "客户档案", icon: UsersRound },
  { key: "inventory", label: "库存管理", icon: Boxes },
  { key: "reports", label: "报表分析", icon: ChartNoAxesColumnIncreasing },
  { key: "approvals", label: "审批中心", icon: ShieldCheck },
  { key: "logs", label: "操作日志", icon: ClipboardList },
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
  const { data, session, loading, error, login, joinInvite, fetchPublicStore, createPublicBookingRequest, fetchPublicCustomerSignature, signPublicCustomerSignature, authenticate, updateAccountProfile, logout, runMutation, actions } = useApiData();
  const [view, setView] = useState<ViewKey>("dashboard");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [adminDetailFromCenter, setAdminDetailFromCenter] = useState(false);
  const [inventoryEntryModule, setInventoryEntryModule] = useState<InventoryModuleKey | undefined>();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedThemeMode = localStorage.getItem(THEME_KEY);
    return isThemeMode(savedThemeMode) ? savedThemeMode : "auto";
  });
  const [systemThemeMode, setSystemThemeMode] = useState<EffectiveThemeMode>(() => getSystemThemeMode());
  const effectiveThemeMode: EffectiveThemeMode = themeMode === "auto" ? systemThemeMode : themeMode;
  const topbarActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeMode);
    document.documentElement.dataset.themePreference = themeMode;
    document.documentElement.dataset.theme = effectiveThemeMode;
  }, [themeMode, effectiveThemeMode]);

  useEffect(() => {
    const syncSystemTheme = () => setSystemThemeMode(getSystemThemeMode());
    syncSystemTheme();
    const timer = window.setInterval(syncSystemTheme, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen && !notificationPanelOpen) return;

    const closeFloatingPanels = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && topbarActionsRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
      setNotificationPanelOpen(false);
    };

    document.addEventListener("pointerdown", closeFloatingPanels);
    return () => document.removeEventListener("pointerdown", closeFloatingPanels);
  }, [accountMenuOpen, notificationPanelOpen]);

  const publicStoreMatch = window.location.pathname.match(/^\/store\/([^/]+)/);
  if (publicStoreMatch) {
    return <StorefrontPage shareCode={decodeURIComponent(publicStoreMatch[1])} fetchPublicStore={fetchPublicStore} createPublicBookingRequest={createPublicBookingRequest} />;
  }

  const publicSignatureMatch = window.location.pathname.match(/^\/signature\/([^/]+)/);
  if (publicSignatureMatch) {
    return (
      <CustomerSignaturePage
        token={decodeURIComponent(publicSignatureMatch[1])}
        fetchSignature={fetchPublicCustomerSignature}
        signSignature={signPublicCustomerSignature}
      />
    );
  }

  if (!session) {
    return <LoginPage onLogin={login} onJoin={joinInvite} authenticate={authenticate} loading={loading} error={error} />;
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
  const notificationCount = visibleNotifications(data, session).filter((item) => !item.readByUserIds.includes(session.user.id)).length;
  const navigate: NavigateToView = (nextView, options) => {
    setView(nextView);
    setAccountSettingsOpen(false);
    setNotificationPanelOpen(false);
    setAccountMenuOpen(false);
    setAdminDetailFromCenter(Boolean(options?.fromAdmin && nextView !== "settings"));
    setInventoryEntryModule(nextView === "inventory" ? options?.inventoryModule : undefined);
  };
  const returnFromAccountSettings = (nextView: ViewKey) => {
    setView(nextView);
    setAccountSettingsOpen(false);
    setNotificationPanelOpen(false);
    setAccountMenuOpen(false);
    setAdminDetailFromCenter(false);
  };

  const isPlatformAdmin = session.user.role === "superadmin";
  const showAdminDetailBack = false;
  const showManagementBack = adminDetailFromCenter && activeView !== "settings" && activeView !== "roomSettings";
  const shellRoleLabel: Record<UserRole, string> = {
    superadmin: "管理后台",
    owner: "门店老板",
    manager: "门店主管",
    frontdesk: "前台营业",
    therapist: "员工页面",
    finance: "财务后台",
  };
  const shellDisplayName = session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;

  return (
    <div className={`app-shell theme-${effectiveThemeMode}`}>
      <aside className="sidebar">
        <div className="rail-admin">
          <div className="brand-mark">祝</div>
          <div>
            <strong>{shellRoleLabel[session.user.role]}</strong>
            <span>{shellDisplayName}</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-brand">
            <div className="brand-mark">祝</div>
            <div>
              <strong>{shellRoleLabel[session.user.role]}</strong>
              <span>{shellDisplayName}</span>
            </div>
          </div>
          <div className="topbar-title">
              <p>祝融｜坤锋 美业门店系统</p>
          </div>
          <div className="topbar-actions" ref={topbarActionsRef}>
            {error && <span className="error-chip">{error}</span>}
            <button className="icon-button notification-button" aria-label="通知" onClick={() => { setNotificationPanelOpen((open) => !open); setAccountMenuOpen(false); }}>
              <Bell size={18} />
              {notificationCount > 0 && <span>{notificationCount}</span>}
            </button>
            <button className="account-avatar-button" aria-label="账号中心" aria-expanded={accountMenuOpen} onClick={() => { setAccountMenuOpen((open) => !open); setNotificationPanelOpen(false); }}>
              <UserAvatar size={22} />
            </button>
            {notificationPanelOpen && (
              <NotificationPanel
                data={data}
                session={session}
                actions={actions}
                runMutation={runMutation}
                setView={navigate}
                onClose={() => setNotificationPanelOpen(false)}
              />
            )}
            {accountMenuOpen && (
              <AccountMenu
                session={session}
                logout={logout}
                openSettings={() => {
                  setAccountSettingsOpen(true);
                  setAccountMenuOpen(false);
                  setNotificationPanelOpen(false);
                }}
              />
            )}
          </div>
        </header>
        {accountSettingsOpen ? (
          <SettingsView
            session={session}
            setView={returnFromAccountSettings}
            returnView={activeView}
            updateProfile={updateAccountProfile}
            uploadAccountAvatar={actions.uploadAccountAvatar}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
          />
        ) : (
          <>
            {showManagementBack && (
              <div className="management-back-row">
                <button type="button" className="back-to-admin" onClick={() => navigate("settings")}>
                  <ArrowLeft size={18} />
                  管理中心
                  <span>{viewTitles[activeView]}</span>
                </button>
              </div>
            )}
            {activeView === "dashboard" && (isPlatformAdmin ? <PlatformAdminView data={data} /> : <Dashboard data={data} session={session} setView={navigate} />)}
            {activeView === "appointments" && <Appointments data={data} actions={actions} runMutation={runMutation} />}
            {activeView === "pos" && <Pos data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "customers" && <Customers data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "catalog" && <Catalog data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "staff" && <StaffCommissions data={data} session={session} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "inventory" && <Inventory data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} initialModule={inventoryEntryModule} onReturnManagement={() => navigate("settings")} />}
            {activeView === "reports" && <Reports data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "approvals" && <Approvals data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={() => navigate("settings")} />}
            {activeView === "logs" && <OperationLogs data={data} session={session} />}
            {activeView === "accounts" && <PlatformAccountAdminView data={data} session={session} setView={navigate} showBack={showAdminDetailBack} actions={actions} runMutation={runMutation} />}
            {activeView === "permissions" && <PlatformPermissionReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} actions={actions} runMutation={runMutation} />}
            {activeView === "usage" && <PlatformUsageReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} fetchR2Usage={actions.fetchR2Usage} fetchWorkerUsage={actions.fetchWorkerUsage} />}
            {activeView === "roomSettings" && <RoomSettings data={data} actions={actions} runMutation={runMutation} setView={navigate} />}
            {activeView === "settings" && (
              <ManagementCenter
                data={data}
                session={session}
                setView={navigate}
                openAccountSettings={() => setAccountSettingsOpen(true)}
                actions={actions}
                runMutation={runMutation}
              />
            )}
          </>
        )}
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

function ManagementCenter({
  data,
  session,
  setView,
  openAccountSettings,
  actions,
  runMutation,
}: {
  data: AppData;
  session: UserSession;
  setView: NavigateToView;
  openAccountSettings: () => void;
  actions: ApiActions;
  runMutation: RunMutation;
}) {
  const systemInviteCode = platformInviteCodeForPlatformAdmin({
    id: session.user.id,
    account: session.user.account,
    role: session.user.role,
  }, data.authUsers);
  const storeStaffInviteCode = storeStaffInviteCodeForStoreUser({
    id: session.user.id,
    account: session.user.account,
    role: session.user.role,
  }, data.authUsers);
  const managementInviteCode = systemInviteCode ?? storeStaffInviteCode ?? "";
  const showInviteSection = Boolean(managementInviteCode);
  const inviteSectionTitle = systemInviteCode ? "系统邀请码" : "员工邀请码";
  const inviteSectionHint = systemInviteCode ? "店长/门店加入或开通" : "员工加入门店";
  const displayName = session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;
  const displayRole = displayRoleName(session.user);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteCopyStatus, setInviteCopyStatus] = useState<"idle" | "copied" | "selected">("idle");
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const inviteInputRef = useRef<HTMLInputElement>(null);

  const copyInviteCode = () => {
    if (!managementInviteCode) return;
    void copyTextToClipboard(managementInviteCode).then((copied) => {
      if (copied) {
        setInviteCopyStatus("copied");
      } else {
        setInviteVisible(true);
        window.requestAnimationFrame(() => {
          inviteInputRef.current?.focus();
          inviteInputRef.current?.select();
        });
        setInviteCopyStatus("selected");
      }
      window.setTimeout(() => setInviteCopyStatus("idle"), 1800);
    });
  };

  type ManagementCard = {
    title: string;
    desc: string;
    icon: typeof LayoutDashboard;
    tone: ModuleTone;
    view?: ViewKey;
    inventoryModule?: InventoryModuleKey;
    onClick?: () => void;
  };

  const platformManagementCards: ManagementCard[] = [
    { title: "账号管理", desc: "账号状态 / 角色权限", icon: UsersRound, tone: "violet", view: "accounts" },
    { title: "权限审批", desc: "开屏授权 / 关键操作", icon: ShieldCheck, tone: "violet", view: "permissions" },
    { title: "平台总览", desc: "门店数据 / 经营汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "dashboard" },
    { title: "操作日志", desc: "登录记录 / 操作轨迹", icon: ClipboardList, tone: "amber", view: "logs" },
    { title: "服务器用量", desc: "D1 / R2 / Worker / 免费额度", icon: Database, tone: "teal", view: "usage" },
    { title: "预约管理", desc: "预约记录 / 到店状态", icon: CalendarDays, tone: "violet", view: "appointments" },
    { title: "开单收银", desc: "订单流水 / 收款记录", icon: CreditCard, tone: "rose", view: "pos" },
    { title: "客户档案", desc: "客户资料 / 项目卡", icon: HeartHandshake, tone: "violet", view: "customers" },
    { title: "项目商品", desc: "服务项目 / 商品资料", icon: PackagePlus, tone: "teal", view: "catalog" },
    { title: "员工提成", desc: "提成明细 / 结算记录", icon: BadgeCent, tone: "amber", view: "staff" },
    { title: "商品入库", desc: "新增商品 / 入库补货", icon: PackagePlus, tone: "teal", view: "inventory", inventoryModule: "stockIn" },
    { title: "库存列表", desc: "库存状态 / 预警查看", icon: Boxes, tone: "teal", view: "inventory", inventoryModule: "list" },
    { title: "报表分析", desc: "经营数据 / 财务汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "审批中心", desc: "退款改价 / 异常审批", icon: ShieldCheck, tone: "rose", view: "approvals" },
  ];
  const storeManagementCards: ManagementCard[] = [
    { title: "预约管理", desc: "预约记录 / 房间安排", icon: CalendarDays, tone: "violet", view: "appointments" },
    { title: "房间设置", desc: "房间数量 / 房名维护", icon: Building2, tone: "teal", onClick: () => setRoomSettingsOpen(true) },
    { title: "开单收银", desc: "订单流水 / 收款记录", icon: CreditCard, tone: "rose", view: "pos" },
    { title: "客户档案", desc: "客户资料 / 项目卡", icon: HeartHandshake, tone: "violet", view: "customers" },
    { title: "项目商品", desc: "服务项目 / 商品资料", icon: PackagePlus, tone: "teal", view: "catalog" },
    { title: "员工提成", desc: "员工提成 / 结算记录", icon: BadgeCent, tone: "amber", view: "staff" },
    { title: "商品入库", desc: "新增商品 / 入库补货", icon: PackagePlus, tone: "teal", view: "inventory", inventoryModule: "stockIn" },
    { title: "库存列表", desc: "库存状态 / 预警查看", icon: Boxes, tone: "teal", view: "inventory", inventoryModule: "list" },
    { title: "报表分析", desc: "经营数据 / 财务汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "审批中心", desc: "退款改价 / 异常审批", icon: ShieldCheck, tone: "rose", view: "approvals" },
    { title: "操作日志", desc: "登录记录 / 操作轨迹", icon: ClipboardList, tone: "amber", view: "logs" },
    { title: "系统设置", desc: "个人资料 / 通知外观", icon: Settings, tone: "violet", onClick: openAccountSettings },
  ];
  const staffManagementCards: ManagementCard[] = [
    { title: "个人资料", desc: "头像 / 姓名 / 账号设置", icon: UserRound, tone: "violet", onClick: openAccountSettings },
    { title: "工作台", desc: "今日任务 / 服务提醒", icon: LayoutDashboard, tone: "violet", view: "dashboard" },
    { title: "预约管理", desc: "我的预约 / 房间安排", icon: CalendarDays, tone: "violet", view: "appointments" },
    { title: "客户档案", desc: "客户资料 / 护理记录", icon: HeartHandshake, tone: "violet", view: "customers" },
    { title: "我的提成", desc: "提成明细 / 结算记录", icon: BadgeCent, tone: "amber", view: "staff" },
    { title: "外观通知", desc: "自动模式 / 推送通知", icon: Bell, tone: "rose", onClick: openAccountSettings },
  ];
  const financeManagementCards: ManagementCard[] = [
    { title: "个人资料", desc: "头像 / 姓名 / 账号设置", icon: UserRound, tone: "violet", onClick: openAccountSettings },
    { title: "工作台", desc: "今日任务 / 财务提醒", icon: LayoutDashboard, tone: "violet", view: "dashboard" },
    { title: "员工提成", desc: "提成明细 / 结算记录", icon: BadgeCent, tone: "amber", view: "staff" },
    { title: "报表分析", desc: "经营数据 / 财务汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "审批中心", desc: "退款改价 / 异常审批", icon: ShieldCheck, tone: "rose", view: "approvals" },
    { title: "外观通知", desc: "自动模式 / 推送通知", icon: Bell, tone: "rose", onClick: openAccountSettings },
  ];
  const managementCards = session.user.role === "superadmin"
    ? platformManagementCards
    : session.user.role === "owner" || session.user.role === "manager"
      ? storeManagementCards
      : session.user.role === "finance"
        ? financeManagementCards
        : staffManagementCards;
  const visibleManagementCards = managementCards.filter((item) => !item.view || canAccessView(session, item.view));

  return (
    <div className="admin-center-page">
      <section className="admin-profile-hero">
        <div className="admin-hero-pattern" aria-hidden="true" />
        <div className="admin-avatar">
          <UserAvatar size={78} />
        </div>
        <div className="admin-profile-copy">
          <span className="admin-role-pill"><ShieldCheck size={14} /> {displayRole}</span>
          <h2>{displayName}</h2>
          <p>{displayRole} · {session.user.account}</p>
        </div>
      </section>

      {showInviteSection && (
        <section className="admin-invite-section" aria-label={inviteSectionTitle}>
          <div className="admin-invite-heading">
            <span>{inviteSectionTitle}</span>
            <small>{inviteSectionHint}</small>
          </div>
          <div className="admin-invite-card">
            <span>{inviteSectionTitle}</span>
            <div className="admin-invite-code">
              <input
                ref={inviteInputRef}
                className="admin-invite-value"
                type={inviteVisible ? "text" : "password"}
                value={managementInviteCode}
                readOnly
                aria-label={`${inviteSectionTitle}内容`}
                tabIndex={-1}
              />
              <button type="button" aria-label={inviteVisible ? "隐藏邀请码" : "显示邀请码"} onClick={() => setInviteVisible((visible) => !visible)} disabled={!managementInviteCode}>
                {inviteVisible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              <button type="button" aria-label="复制邀请码" onClick={copyInviteCode} disabled={!managementInviteCode}>
                <Copy size={17} />
              </button>
            </div>
            {inviteCopyStatus !== "idle" && (
              <small className="admin-invite-copied">
                {inviteCopyStatus === "copied" ? "已复制" : "已选中，请按 Command+C"}
              </small>
            )}
          </div>
        </section>
      )}

      {session.user.role === "superadmin" && (
        <PlatformSystemConfigPanel data={data} actions={actions} runMutation={runMutation} />
      )}

      <section className="admin-module-section">
        <div className="admin-section-title">
          <span>管理入口</span>
        </div>
        <div className="admin-module-grid">
          {visibleManagementCards.map((item) => (
            <AdminCenterCard
              key={item.title}
              item={item}
              onClick={() => item.onClick ? item.onClick() : item.view && setView(item.view, { fromAdmin: true, inventoryModule: item.inventoryModule })}
            />
          ))}
        </div>
      </section>
      <Modal
        open={roomSettingsOpen}
        title="房间设置"
        subtitle="设置房间数量、房间名称和指定房间维护状态"
        size="large"
        onClose={() => setRoomSettingsOpen(false)}
      >
        <RoomSettingsContent data={data} actions={actions} runMutation={runMutation} onClose={() => setRoomSettingsOpen(false)} modal />
      </Modal>
    </div>
  );
}

function managementEntryDetails(
  item: { title: string; desc: string; icon: typeof LayoutDashboard; tone: ModuleTone; view?: ViewKey },
  data: AppData,
  session: UserSession,
) {
  const today = new Date();
  const todayAppointments = data.appointments.filter((appointment) => new Date(appointment.startAt).toDateString() === today.toDateString());
  const todayOrders = data.orders.filter((order) => new Date(order.createdAt).toDateString() === today.toDateString());
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.paidAmount, 0);
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const activeCards = data.memberCards.filter((card) => card.status === "正常").length;
  const pendingApprovals = data.approvalRequests.filter((request) => request.status === "待审批").length;
  const lowStock = data.products.filter((product) => product.stock <= product.warningStock).length;
  const businessStaff = businessStaffOf(data);
  const rooms = roomNamesOf(data);
  const maintenanceRooms = maintenanceRoomNamesOf(data, rooms).length;
  const operationLogs = data.operationLogs ?? [];
  const Icon = item.icon;
  const base = {
    tone: item.tone,
    icon: <Icon size={24} />,
    label: item.title,
    value: item.view ? viewTitles[item.view] : item.title,
    description: item.desc,
  };

  if (item.view === "appointments") {
    return {
      ...base,
      value: `${todayAppointments.length} 单`,
      items: [
        { label: "今日预约", value: `${todayAppointments.length} 单`, hint: "待确认、到店和已完成" },
        { label: "房间数量", value: `${rooms.length} 间`, hint: "来自房间设置" },
        { label: "维护房间", value: `${maintenanceRooms} 间`, hint: "预约不可选择" },
      ],
    };
  }
  if (item.view === "pos") {
    return {
      ...base,
      value: money(todayRevenue),
      items: [
        { label: "今日收款", value: money(todayRevenue), hint: `${todayOrders.length} 笔订单` },
        { label: "累计实收", value: money(totalRevenue), hint: "全部订单实收" },
        { label: "有效会员卡", value: `${activeCards} 张`, hint: "可用于卡扣" },
      ],
    };
  }
  if (item.view === "customers") {
    return {
      ...base,
      value: `${data.customers.length} 位`,
      items: [
        { label: "客户总数", value: `${data.customers.length} 位`, hint: "门店客户档案" },
        { label: "有效项目卡", value: `${activeCards} 张`, hint: "客户资产" },
        { label: "待签名", value: `${data.customerSignatures.filter((signature) => signature.status === "待签名").length} 份`, hint: "服务完成确认" },
      ],
    };
  }
  if (item.view === "catalog") {
    return {
      ...base,
      value: `${data.services.length + data.products.length} 项`,
      items: [
        { label: "服务项目", value: `${data.services.length} 项`, hint: "预约和开单可选" },
        { label: "商品耗材", value: `${data.products.length} 项`, hint: "销售品和服务耗材" },
        { label: "低库存", value: `${lowStock} 项`, hint: "需要补货或盘点" },
      ],
    };
  }
  if (item.view === "staff") {
    const scopedCommissions = session.user.staffId
      ? data.commissions.filter((commission) => commission.staffId === session.user.staffId)
      : data.commissions;
    return {
      ...base,
      value: `${businessStaff.length} 人`,
      items: [
        { label: "员工档案", value: `${businessStaff.length} 人`, hint: "岗位、状态和账号" },
        { label: "提成记录", value: `${scopedCommissions.length} 条`, hint: "按权限查看" },
        { label: "待结算", value: money(scopedCommissions.filter((commission) => commission.status === "待结算").reduce((sum, commission) => sum + commission.amount, 0)), hint: "当前待处理" },
      ],
    };
  }
  if (item.view === "inventory") {
    return {
      ...base,
      value: `${lowStock} 项`,
      items: [
        { label: "低库存", value: `${lowStock} 项`, hint: "低于安全库存" },
        { label: "商品耗材", value: `${data.products.length} 项`, hint: "库存基础资料" },
        { label: "库存流水", value: `${data.inventoryLogs.length} 条`, hint: "出入库和盘点" },
      ],
    };
  }
  if (item.view === "reports") {
    return {
      ...base,
      value: money(todayRevenue),
      items: [
        { label: "今日实收", value: money(todayRevenue), hint: "当天收入" },
        { label: "今日订单", value: `${todayOrders.length} 单`, hint: "当天收银记录" },
        { label: "累计实收", value: money(totalRevenue), hint: "经营汇总" },
      ],
    };
  }
  if (item.view === "approvals" || item.view === "permissions") {
    return {
      ...base,
      value: `${pendingApprovals} 单`,
      items: [
        { label: "待审批", value: `${pendingApprovals} 单`, hint: "需要处理" },
        { label: "已通过", value: `${data.approvalRequests.filter((request) => request.status === "已通过").length} 单`, hint: "审批结果" },
        { label: "已拒绝", value: `${data.approvalRequests.filter((request) => request.status === "已拒绝").length} 单`, hint: "审批结果" },
      ],
    };
  }
  if (item.view === "logs") {
    return {
      ...base,
      value: `${operationLogs.length} 条`,
      items: [
        { label: "操作记录", value: `${operationLogs.length} 条`, hint: "登录和业务操作" },
        { label: "操作类型", value: `${new Set(operationLogs.map((log) => log.action)).size} 类`, hint: "审计范围" },
        { label: "账号数量", value: `${data.authUsers.length} 个`, hint: "可追溯账号" },
      ],
    };
  }
  if (item.view === "accounts") {
    return {
      ...base,
      value: `${data.authUsers.length} 个`,
      items: [
        { label: "账号数量", value: `${data.authUsers.length} 个`, hint: "平台和门店账号" },
        { label: "员工档案", value: `${businessStaff.length} 人`, hint: "可绑定账号" },
        { label: "待加入邀请", value: `${data.staffInvites.filter((invite) => invite.status === "待加入").length} 个`, hint: "邀请码状态" },
      ],
    };
  }
  if (item.view === "usage") {
    return {
      ...base,
      value: "实时读取",
      items: [
        { label: "Worker 指标", value: "实时", hint: "进入页面后读取请求量" },
        { label: "R2 容量", value: "实时", hint: "进入页面后读取存储用量" },
        { label: "系统配置", value: `${data.systemConfigs?.length ?? 0} 项`, hint: "平台设置" },
      ],
    };
  }
  return {
    ...base,
    items: [
      { label: "今日预约", value: `${todayAppointments.length} 单`, hint: "工作台统计" },
      { label: "今日收款", value: money(todayRevenue), hint: "经营统计" },
      { label: "待审批", value: `${pendingApprovals} 单`, hint: "管理事项" },
    ],
  };
}

function PlatformSystemConfigPanel({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const configValue = (key: SystemConfigKey, fallback: string) =>
    (data.systemConfigs ?? []).find((item) => item.key === key)?.value ?? fallback;
  const [inviteDays, setInviteDays] = useState(configValue("invite_default_days", "7"));
  const [allowRegistration, setAllowRegistration] = useState(configValue("allow_registration", "true"));
  const [maintenanceMode, setMaintenanceMode] = useState(configValue("maintenance_mode", "false"));
  const [announcement, setAnnouncement] = useState(configValue("system_announcement", ""));
  const [savedKey, setSavedKey] = useState<SystemConfigKey | undefined>();

  useEffect(() => {
    setInviteDays(configValue("invite_default_days", "7"));
    setAllowRegistration(configValue("allow_registration", "true"));
    setMaintenanceMode(configValue("maintenance_mode", "false"));
    setAnnouncement(configValue("system_announcement", ""));
  }, [data.systemConfigs]);

  const saveConfig = (key: SystemConfigKey, value: string) => {
    void runMutation(() => actions.updateSystemConfig(key, value)).then(() => {
      setSavedKey(key);
      window.setTimeout(() => setSavedKey(undefined), 1400);
    });
  };

  return (
    <section className="panel dashboard-panel" aria-label="平台配置">
      <PanelTitle icon={<Settings size={18} />} title="平台配置" action={`${(data.systemConfigs ?? []).length || 4} 项`} />
      <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label>
          <span className="field-label">邀请码有效期</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <input type="number" min={1} max={90} value={inviteDays} onChange={(event) => setInviteDays(event.target.value)} />
            <button type="button" onClick={() => saveConfig("invite_default_days", inviteDays)}>
              {savedKey === "invite_default_days" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
        <label>
          <span className="field-label">门店注册</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <select value={allowRegistration} onChange={(event) => setAllowRegistration(event.target.value)}>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
            <button type="button" onClick={() => saveConfig("allow_registration", allowRegistration)}>
              {savedKey === "allow_registration" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
        <label>
          <span className="field-label">维护模式</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <select value={maintenanceMode} onChange={(event) => setMaintenanceMode(event.target.value)}>
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
            <button type="button" onClick={() => saveConfig("maintenance_mode", maintenanceMode)}>
              {savedKey === "maintenance_mode" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
      </div>
      <label style={{ display: "block", marginTop: "14px" }}>
        <span className="field-label">系统公告</span>
        <textarea value={announcement} maxLength={200} rows={3} onChange={(event) => setAnnouncement(event.target.value)} />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
        <button type="button" onClick={() => saveConfig("system_announcement", announcement)}>
          {savedKey === "system_announcement" ? "已保存" : "保存公告"}
        </button>
      </div>
    </section>
  );
}

function PlatformAdminView({
  data,
}: {
  data: AppData;
}) {
  const visibleAuthUsers = data.authUsers.filter(isVisibleAccount);
  const ownerAccounts = visibleAuthUsers.filter((user) => user.role === "owner" && !isVisiblePlatformAdmin(user));
  const staffAccounts = visibleAuthUsers.filter((user) => ["manager", "frontdesk", "therapist", "finance"].includes(user.role));
  const activeAccounts = visibleAuthUsers.filter((user) => user.status === "active").length;
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const todayAppointments = data.appointments.filter((item) => new Date(item.startAt).toDateString() === new Date().toDateString()).length;
  const platformMetrics = [
    { icon: <ShieldCheck size={18} />, label: "启用账号", value: `${activeAccounts} 个`, hint: "平台账号" },
    { icon: <Building2 size={18} />, label: "门店账号", value: `${ownerAccounts.length} 个`, hint: "负责人账号" },
    { icon: <UsersRound size={18} />, label: "员工账号", value: `${staffAccounts.length} 个`, hint: "门店成员" },
    { icon: <CalendarDays size={18} />, label: "今日预约", value: `${todayAppointments} 条`, hint: "门店预约" },
  ];

  return (
    <div className="dashboard-page platform-admin-workbench">
      <section className="workbench-hero role-hero-superadmin">
        <span className="workbench-hero-kicker"><Building2 size={15} /> 平台总览</span>
        <h2>平台总览</h2>
        <p>门店 {data.storeProfiles.length} 家 · 账号 {activeAccounts} 个 · 今日预约 {todayAppointments} 条</p>
      </section>

      <section className="workbench-metric-row" aria-label="平台关键数据">
        {platformMetrics.map((item) => (
          <DashboardMetric key={item.label} icon={item.icon} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="workbench-panel">
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="平台数据概览" action="数据总览" />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["客户总数", `${data.customers.length} 人`, "客户档案汇总"],
            ["订单总数", `${data.orders.length} 单`, "收银订单汇总"],
            ["实收汇总", money(totalRevenue), "已记录收款金额"],
            ["门店数量", `${data.storeProfiles.length} 家`, "已开通门店"],
          ]}
        />
      </section>
    </div>
  );
}

function PlatformPageTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="platform-page-title">
      <button type="button" aria-label="返回" title="返回" onClick={onBack}>
        <ArrowLeft size={22} />
      </button>
      <h1>{title}</h1>
    </div>
  );
}

function PlatformAppointmentsReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [appointmentRange, setAppointmentRange] = useState<AppointmentRange>("today");
  const appointmentRanges = appointmentRangeMap();
  const selectedAppointmentRange = appointmentRanges[appointmentRange];
  const pending = data.appointments.filter((item) => item.status === "待确认" || item.status === "已确认").length;
  const completed = data.appointments.filter((item) => item.status === "已完成").length;
  const onlinePendingRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理");
  const onlinePending = onlinePendingRequests.length;
  const rangeAppointments = filterAppointmentsByRange(data.appointments, appointmentRange);
  const rangePending = rangeAppointments.filter((item) => item.status === "待确认" || item.status === "已确认").length;
  const rangeCompleted = rangeAppointments.filter((item) => item.status === "已完成").length;
  const roomNames = roomNamesOf(data);
  const roomUsage = calculateAppointmentRoomUsage(
    rangeAppointments,
    selectedAppointmentRange,
    roomNames,
    maintenanceRoomNamesOf(data, roomNames),
  );
  const rows = rangeAppointments
    .slice(0, 120)
    .map((item) => [
      shortDate(item.startAt),
      nameOf(data.customers, item.customerId),
      nameOf(data.services, item.serviceId),
      nameOf(data.staff, item.staffId),
      <Badge key={`${item.id}-status`} text={item.status} tone={item.status === "已完成" ? "ok" : item.status === "已取消" || item.status === "爽约" ? "warn" : undefined} />,
      item.note || "-",
    ]);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="预约管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><CalendarDays size={15} /> 预约管理</span>
          <h1>预约记录</h1>
          <p>预约时间、客户项目、服务人员和到店状态汇总。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="预约总数" value={`${data.appointments.length} 条`} hint="预约记录" />
          <StatCard title="待到店" value={`${pending} 条`} hint="到店安排" />
          <StatCard title="已完成" value={`${completed} 条`} hint="服务完成" />
          <StatCard title="线上待处理" value={`${onlinePending} 条`} hint="线上预约" />
        </div>
      </section>

      <section className="appointment-page-grid">
        <div className="appointment-panel appointment-board-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title={`${selectedAppointmentRange.label}预约看板`} action={`${rangeAppointments.length} 条`} />
          <div className="appointment-date-strip" aria-label="预约日期筛选">
            {(["today", "tomorrow", "week"] as AppointmentRange[]).map((range) => (
              <button
                aria-pressed={appointmentRange === range}
                className={appointmentRange === range ? "active" : undefined}
                key={range}
                onClick={() => setAppointmentRange(range)}
                type="button"
              >
                {appointmentRanges[range].label}
              </button>
            ))}
          </div>
          <div className="appointment-timeline-board">
            {rangeAppointments.slice(0, 6).map((item) => (
              <article className="appointment-schedule-card" key={item.id}>
                <time>{shortDate(item.startAt).split(" ")[1] ?? shortDate(item.startAt)}</time>
                <div>
                  <strong>{nameOf(data.customers, item.customerId)}</strong>
                  <span>{nameOf(data.services, item.serviceId)} · {nameOf(data.staff, item.staffId)}</span>
                  {item.note && <small>{item.note}</small>}
                </div>
                <Badge text={item.status} tone={item.status === "已完成" ? "ok" : item.status === "已取消" || item.status === "爽约" ? "warn" : undefined} />
              </article>
            ))}
            {rangeAppointments.length === 0 && (
              <div className="appointment-empty-state">
                <CalendarDays size={28} />
                <strong>{selectedAppointmentRange.label}暂无预约安排</strong>
              </div>
            )}
          </div>
        </div>

        <div className="appointment-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="预约状态" action="实时汇总" />
          <div className="appointment-status-grid">
            <div>
              <span>{selectedAppointmentRange.label}预约</span>
              <strong>{rangeAppointments.length}</strong>
              <small>当前筛选范围</small>
            </div>
            <div>
              <span>待到店</span>
              <strong>{rangePending}</strong>
              <small>待确认 / 已确认</small>
            </div>
            <div>
              <span>已完成</span>
              <strong>{rangeCompleted}</strong>
              <small>服务已结束</small>
            </div>
            <div>
              <span>线上申请</span>
              <strong>{onlinePending}</strong>
              <small>待前台处理</small>
            </div>
          </div>
          <div className="appointment-panel-divider" />
          <PanelTitle icon={<Building2 size={18} />} title="房间使用情况" action={selectedAppointmentRange.label} />
          <div className="appointment-room-summary">
            <div>
              <span>房间总数</span>
              <strong>{roomUsage.availableRoomCount}</strong>
              <small>可预约房间</small>
            </div>
            <div>
              <span>已预约</span>
              <strong>{roomUsage.bookedRoomSlots}</strong>
              <small>房间占用</small>
            </div>
            <div>
              <span>剩余可约</span>
              <strong>{roomUsage.remainingRoomSlots}</strong>
              <small>{roomUsage.dayCount > 1 ? `${roomUsage.dayCount} 天容量` : "今日容量"}</small>
            </div>
            <div>
              <span>维护中</span>
              <strong>{roomUsage.maintenanceRoomCount}</strong>
              <small>暂不可约</small>
            </div>
          </div>
          <div className="appointment-room-list">
            {roomUsage.roomAssignments.map(({ appointment, roomName }) => (
              <article className="appointment-room-card" key={`${appointment.id}-room`}>
                <div>
                  <strong>{roomName}</strong>
                  <span>{nameOf(data.customers, appointment.customerId)}</span>
                </div>
                <time>{shortDate(appointment.startAt)}</time>
              </article>
            ))}
            {roomUsage.roomAssignments.length === 0 && <p className="appointment-soft-empty">暂无房间占用</p>}
          </div>
          <div className="appointment-panel-divider" />
          <PanelTitle icon={<Share2 size={18} />} title="线上预约申请" action={`${onlinePending} 条待处理`} />
          <div className="appointment-request-list">
            {onlinePendingRequests.slice(0, 3).map((request) => (
              <article className="appointment-request-card" key={request.id}>
                <div>
                  <strong>{request.customerName}</strong>
                  <span>{request.phone} · {shortDate(request.preferredAt)}</span>
                </div>
                <Badge text={request.status} />
              </article>
            ))}
            {onlinePendingRequests.length === 0 && <p className="appointment-soft-empty">暂无线上预约申请</p>}
          </div>
        </div>
      </section>

      <section className="appointment-panel">
        <PanelTitle icon={<ClipboardList size={18} />} title={`${selectedAppointmentRange.label}预约列表`} action={`${rangeAppointments.length} 条`} />
        {rows.length > 0 ? (
          <DataTable columns={["预约时间", "客户", "项目", "员工", "状态", "备注"]} rows={rows} />
        ) : (
          <p className="appointment-soft-empty">{selectedAppointmentRange.label}暂无预约记录</p>
        )}
      </section>
    </div>
  );
}

function PlatformOrdersReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const refundAmount = data.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const today = new Date();
  const todayOrders = data.orders.filter((order) => new Date(order.createdAt).toDateString() === today.toDateString());
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.paidAmount, 0);
  const paidOrders = data.orders.filter((order) => order.status === "已支付").length;
  const refundedOrders = data.orders.filter((order) => order.status !== "已支付").length;
  const averageOrderValue = data.orders.length ? Math.round(totalRevenue / data.orders.length) : 0;
  const recentOrders = data.orders
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);
  const payMethodSummary = (["微信", "支付宝", "现金", "银行卡", "会员卡"] as Order["payMethod"][]).map((method) => {
    const methodOrders = data.orders.filter((order) => order.payMethod === method);
    return {
      amount: methodOrders.reduce((sum, order) => sum + order.paidAmount, 0),
      count: methodOrders.length,
      method,
    };
  });
  const rows = data.orders
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 120)
    .map((order) => [
      order.orderNo,
      nameOf(data.customers, order.customerId),
      nameOf(data.services, order.serviceId),
      nameOf(data.staff, order.staffId),
      order.payMethod,
      money(order.paidAmount),
      <Badge key={`${order.id}-status`} text={order.status} tone={order.status === "已支付" ? "ok" : "warn"} />,
      shortDate(order.createdAt),
    ]);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="开单收银" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><CreditCard size={15} /> 开单收银</span>
          <h1>订单与收款记录</h1>
          <p>订单流水、支付方式、实收金额和退款记录。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="实收金额" value={money(totalRevenue)} hint="收款汇总" />
          <StatCard title="订单数" value={`${data.orders.length} 单`} hint="收银订单" />
          <StatCard title="退款金额" value={money(refundAmount)} hint={`${data.refunds.length} 条退款`} />
        </div>
      </section>

      <section className="cashier-page-grid">
        <div className="cashier-panel cashier-board-panel">
          <PanelTitle icon={<CreditCard size={18} />} title="今日收银看板" action={`${todayOrders.length} 单`} />
          <div className="cashier-revenue-card">
            <span>今日实收</span>
            <strong>{money(todayRevenue)}</strong>
            <small>今日订单 {todayOrders.length} 单 · 客单价 {money(averageOrderValue)}</small>
          </div>
          <div className="cashier-status-grid">
            <div>
              <span>已支付</span>
              <strong>{paidOrders}</strong>
              <small>正常收银订单</small>
            </div>
            <div>
              <span>退款/部分退款</span>
              <strong>{refundedOrders}</strong>
              <small>需关注售后</small>
            </div>
            <div>
              <span>退款金额</span>
              <strong>{money(refundAmount)}</strong>
              <small>{data.refunds.length} 条退款记录</small>
            </div>
          </div>
        </div>

        <div className="cashier-panel">
          <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="支付方式汇总" action="收款结构" />
          <div className="cashier-method-list">
            {payMethodSummary.map((item) => (
              <article key={item.method}>
                <div>
                  <strong>{item.method}</strong>
                  <span>{item.count} 单</span>
                </div>
                <em>{money(item.amount)}</em>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cashier-page-grid lower">
        <div className="cashier-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="最近订单" action="最新 5 单" />
          <div className="cashier-order-list">
            {recentOrders.map((order) => (
              <article className="cashier-order-card" key={order.id}>
                <div>
                  <strong>{order.orderNo}</strong>
                  <span>{nameOf(data.customers, order.customerId)} · {nameOf(data.services, order.serviceId)}</span>
                  <small>{order.payMethod} · {shortDate(order.createdAt)}</small>
                </div>
                <div>
                  <em>{money(order.paidAmount)}</em>
                  <Badge text={order.status} tone={order.status === "已支付" ? "ok" : "warn"} />
                </div>
              </article>
            ))}
            {recentOrders.length === 0 && <p className="cashier-soft-empty">暂无收银订单</p>}
          </div>
        </div>

        <div className="cashier-panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="收款概览" action="经营指标" />
          <div className="cashier-tip-list">
            <div>
              <span>到店未收银</span>
              <strong>{data.appointments.filter((appointment) => appointment.status === "已到店").length} 条</strong>
              <small>到店服务与收款衔接</small>
            </div>
            <div>
              <span>有效会员卡</span>
              <strong>{data.memberCards.filter((card) => card.status === "正常").length} 张</strong>
              <small>项目卡规模</small>
            </div>
          </div>
        </div>
      </section>

      <section className="cashier-panel">
        <PanelTitle icon={<CreditCard size={18} />} title="订单流水" action={`${data.orders.length} 单`} />
        {rows.length > 0 ? (
          <DataTable columns={["订单号", "客户", "项目", "员工", "支付方式", "实收", "状态", "时间"]} rows={rows} />
        ) : (
          <p className="cashier-soft-empty">暂无订单流水</p>
        )}
      </section>
    </div>
  );
}

function PlatformCustomersReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [activeModule, setActiveModule] = useState<"profile" | "cards" | "records" | "signature" | undefined>();
  const activeCards = data.memberCards.filter((card) => card.status === "正常").length;
  const totalRemainingTimes = data.memberCards.reduce((sum, card) => sum + card.remainingTimes, 0);
  const pendingFollowUps = data.customerFollowUps.filter((item) => item.status === "待跟进").length;
  const pendingSignatures = data.customerSignatures.filter((item) => item.status === "待签名").length;
  const rows = data.customers.slice(0, 120).map((customer) => [
    customer.name,
    customer.phone,
    shortDate(customer.lastVisit),
    `${data.memberCards.filter((card) => card.customerId === customer.id).length} 张`,
    `${data.customerServiceRecords.filter((record) => record.customerId === customer.id).length} 条`,
    `${data.customerSignatures.filter((signature) => signature.customerId === customer.id).length} 份`,
  ]);
  const cardRows = data.memberCards.slice(0, 120).map((card) => [
    nameOf(data.customers, card.customerId),
    card.name,
    card.type,
    money(card.balance),
    `${card.remainingTimes} 次`,
    <Badge key={`${card.id}-status`} text={card.status} tone={card.status === "正常" ? "ok" : "warn"} />,
    shortDate(card.expiresAt),
  ]);
  type PlatformCustomerModuleKey = NonNullable<typeof activeModule>;
  const customerModules: Array<FeatureModule<PlatformCustomerModuleKey>> = [
    { key: "profile", title: "客户档案", desc: "客户资料和客户列表", icon: UsersRound, tone: "violet", meta: `${data.customers.length} 位` },
    { key: "cards", title: "项目次数卡", desc: "储值卡、次数卡和套餐卡", icon: CreditCard, tone: "rose", meta: `${activeCards} 张` },
    { key: "records", title: "服务记录", desc: "护理过程和回访计划", icon: ClipboardList, tone: "jade", meta: `${data.customerServiceRecords.length} 条` },
    { key: "signature", title: "服务确认签名", desc: "平板现场签名记录", icon: LockKeyhole, tone: "plum", meta: `${data.customerSignatures.length} 份` },
  ];
  const activeModuleTitle = activeModule ? customerModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";

  return (
    <div className="page-stack customer-module-page module-hub">
      {showBack && <PlatformPageTitle title="客户档案" onBack={() => setView("settings")} />}
      <PageHero
        icon={<HeartHandshake size={15} />}
        eyebrow="客户档案"
        title="客户服务档案"
        desc="客户资料、项目次数卡、到店服务记录和现场签名确认。"
        stats={[
          { label: "客户总数", value: `${data.customers.length} 人`, hint: "客户档案", icon: <UsersRound size={18} /> },
          { label: "项目卡", value: `${data.memberCards.length} 张`, hint: `${totalRemainingTimes} 次可核销`, icon: <CreditCard size={18} /> },
          { label: "待签名", value: `${pendingSignatures} 份`, hint: "服务确认", icon: <LockKeyhole size={18} /> },
        ]}
      />
      <ModuleOverview modules={customerModules} activeKey={activeModule} onSelect={setActiveModule} />
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "客户档案"}
        subtitle="客户资料、项目卡和服务确认记录"
        size="large"
        onClose={() => setActiveModule(undefined)}
      >
      <div className="module-detail-stack customer-modal-detail">
        {activeModule === "profile" && (
          <section className="panel">
            <PanelTitle icon={<UsersRound size={18} />} title="客户列表" action={`${data.customers.length} 位客户`} />
            {rows.length > 0 ? (
              <DataTable columns={["客户", "手机", "最近到店", "项目卡", "服务记录", "签名"]} rows={rows} />
            ) : (
              <p className="customer-soft-empty">暂无客户列表</p>
            )}
          </section>
        )}
        {activeModule === "cards" && (
          <section className="panel">
            <PanelTitle icon={<CreditCard size={18} />} title="项目卡列表" action="余额/次数/状态" />
            {cardRows.length > 0 ? (
              <DataTable columns={["客户", "卡名", "类型", "余额", "次数", "状态", "有效期"]} rows={cardRows} />
            ) : (
              <p className="customer-soft-empty">暂无项目卡列表</p>
            )}
          </section>
        )}
        {activeModule === "records" && (
          <>
            <section className="panel">
              <PanelTitle icon={<ClipboardList size={18} />} title="服务记录" action={`${data.customerServiceRecords.length} 条`} />
              <DataTable
                columns={["客户", "员工", "项目", "订单", "卡项消耗", "护理步骤", "客户反馈", "下次建议", "时间"]}
                rows={data.customerServiceRecords.map((record) => [
                  nameOf(data.customers, record.customerId),
                  nameOf(data.staff, record.staffId),
                  nameOf(data.services, record.serviceId),
                  record.orderId ? data.orders.find((order) => order.id === record.orderId)?.orderNo ?? record.orderId : "未关联",
                  record.memberCardTransactionId ? "已关联项目卡核销" : "未扣卡",
                  record.careSteps || "未记录",
                  record.customerFeedback || "未记录",
                  record.nextCareAdvice || "未记录",
                  shortDate(record.createdAt),
                ])}
              />
            </section>
            <section className="panel">
              <PanelTitle icon={<MessageCircle size={18} />} title="客户跟进" action={`${pendingFollowUps} 位待跟进`} />
              <DataTable
                columns={["客户", "员工", "方式", "计划时间", "状态", "备注"]}
                rows={data.customerFollowUps.map((followUp) => [
                  nameOf(data.customers, followUp.customerId),
                  nameOf(data.staff, followUp.staffId),
                  followUp.method,
                  shortDate(followUp.dueAt),
                  <Badge key={`${followUp.id}-status`} text={followUp.status} />,
                  followUp.note,
                ])}
              />
            </section>
          </>
        )}
        {activeModule === "signature" && (
          <section className="panel">
            <PanelTitle icon={<LockKeyhole size={18} />} title="服务签名记录" action={`${data.customerSignatures.length} 份`} />
            <DataTable
              columns={["客户", "标题", "状态", "签名人", "创建/签名时间"]}
              rows={data.customerSignatures.map((signature) => [
                nameOf(data.customers, signature.customerId),
                signature.title,
                <Badge key={`${signature.id}-status`} text={signature.status} tone={signature.status === "已签名" ? "ok" : "warn"} />,
                signature.signerName ?? "-",
                `${shortDate(signature.createdAt)}${signature.signedAt ? ` / ${shortDate(signature.signedAt)}` : ""}`,
              ])}
            />
          </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

function PlatformCatalogReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="项目商品" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><PackagePlus size={15} /> 项目商品</span>
          <h1>项目商品资料</h1>
          <p>服务项目、商品资料、耗材配置和库存数量。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="服务项目" value={`${data.services.length} 项`} hint="门店服务" />
          <StatCard title="商品资料" value={`${data.products.length} 项`} hint="销售品和耗材" />
          <StatCard title="耗材品" value={`${data.products.filter((item) => item.type === "consumable").length} 项`} hint="服务扣库存" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="服务项目" action={`${data.services.length} 项`} />
          <DataTable
            columns={["项目", "分类", "价格", "时长", "耗材配置"]}
            rows={data.services.map((service) => [
              service.name,
              service.category,
              money(service.price),
              `${service.duration} 分钟`,
              serviceFormulaSummary(service, data.products),
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Boxes size={18} />} title="商品资料" action={`${data.products.length} 项`} />
          <DataTable
            columns={["商品", "类型", "单位", "售价", "成本", "库存"]}
            rows={data.products.map((product) => [
              product.name,
              product.type === "sale" ? "销售商品" : "耗材",
              product.unit,
              money(product.price),
              money(product.cost),
              `${product.stock} ${product.unit}`,
            ])}
          />
        </div>
      </section>
    </div>
  );
}

function PlatformStaffReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const staffRows = businessStaffOf(data);
  const staffIds = new Set(staffRows.map((staff) => staff.id));
  const activeStaff = staffRows.filter((item) => item.status === "active").length;
  const pendingCommission = data.commissions.filter((item) => staffIds.has(item.staffId) && item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="员工提成" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><BadgeCent size={15} /> 员工提成</span>
          <h1>员工、邀请码与提成</h1>
          <p>员工账号、邀请码状态、底薪配置和提成流水。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="员工数" value={`${staffRows.length} 人`} hint={`${activeStaff} 人启用`} />
          <StatCard title="待结算提成" value={money(pendingCommission)} hint="员工提成合计" />
          <StatCard title="员工邀请码" value={`${data.staffInvites.length} 个`} hint="邀请码状态" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<UsersRound size={18} />} title="员工列表" action={`${staffRows.length} 人`} />
          <DataTable
            columns={["姓名", "手机", "岗位", "状态", "底薪", "提成比例"]}
            rows={staffRows.map((staff) => [
              staff.name,
              staff.phone,
              displayStaffRole(staff.role),
              <Badge key={`${staff.id}-status`} text={staff.status === "active" ? "启用" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />,
              money(staff.baseSalary ?? 0),
              `${staff.commissionRate ?? 0}%`,
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="提成流水" action={`${data.commissions.length} 条`} />
          <DataTable
            columns={["员工", "类型", "基数", "比例", "金额", "状态", "时间"]}
            rows={data.commissions.filter((commission) => staffIds.has(commission.staffId)).map((commission) => [
              nameOf(data.staff, commission.staffId),
              commission.type,
              money(commission.baseAmount),
              `${commission.rate}%`,
              money(commission.amount),
              <Badge key={`${commission.id}-status`} text={commission.status} tone={commission.status === "已结算" ? "ok" : undefined} />,
              shortDate(commission.createdAt),
            ])}
          />
        </div>
      </section>
    </div>
  );
}

function PlatformInventoryReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const stockTotal = data.products.reduce((sum, item) => sum + item.stock, 0);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="库存管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><Boxes size={15} /> 库存管理</span>
          <h1>库存预警与流水</h1>
          <p>库存状态、预警项目、出入库流水和盘点记录。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="商品数" value={`${data.products.length} 项`} hint="商品与耗材" />
          <StatCard title="低库存" value={`${lowStock.length} 项`} hint="低于预警线" />
          <StatCard title="库存合计" value={`${stockTotal}`} hint="所有库存数量" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Boxes size={18} />} title="库存状态" action={`${data.products.length} 项`} />
          <DataTable
            columns={["商品", "类型", "库存", "预警线", "单位", "状态"]}
            rows={data.products.map((product) => [
              product.name,
              product.type === "sale" ? "销售商品" : "耗材",
              product.stock,
              product.warningStock,
              product.unit,
              <Badge key={`${product.id}-stock`} text={product.stock <= product.warningStock ? "低库存" : "正常"} tone={product.stock <= product.warningStock ? "warn" : "ok"} />,
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="库存流水" action={`${data.inventoryLogs.length} 条`} />
          <DataTable
            columns={["时间", "商品", "类型", "变动", "库存后", "备注"]}
            rows={data.inventoryLogs.slice(0, 120).map((log) => [
              shortDate(log.createdAt),
              nameOf(data.products, log.productId),
              log.type,
              log.delta,
              log.stockAfter,
              log.note || "-",
            ])}
          />
        </div>
      </section>
    </div>
  );
}

function PlatformApprovalsReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const pending = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const passed = data.approvalRequests.filter((item) => item.status === "已通过").length;
  const rejected = data.approvalRequests.filter((item) => item.status === "已拒绝").length;

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="审批中心" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={15} /> 审批中心</span>
          <h1>关键审批记录</h1>
          <p>退款、改价、异常操作和关键审批记录。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="待审批" value={`${pending} 单`} hint="待处理" />
          <StatCard title="已通过" value={`${passed} 单`} hint="历史通过" />
          <StatCard title="已拒绝" value={`${rejected} 单`} hint="历史拒绝" />
        </div>
      </section>
      <section className="panel dashboard-panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="审批记录" action={`${data.approvalRequests.length} 条`} />
        <DataTable
          columns={["类型", "目标", "金额", "原因", "申请人", "状态", "申请时间", "处理时间"]}
          rows={data.approvalRequests.map((request) => [
            request.type,
            request.targetId,
            money(request.amount),
            request.reason,
            data.authUsers.find((user) => user.id === request.requestedBy)?.name ?? "系统",
            <Badge key={`${request.id}-status`} text={request.status} tone={request.status === "已通过" ? "ok" : request.status === "已拒绝" ? "warn" : undefined} />,
            shortDate(request.createdAt),
            request.approvedAt ? shortDate(request.approvedAt) : "-",
          ])}
        />
      </section>
    </div>
  );
}

function PlatformAccountAdminView({
  data,
  session,
  setView,
  showBack,
  actions,
  runMutation,
}: {
  data: AppData;
  session: UserSession;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  actions: ApiActions;
  runMutation: RunMutation;
}) {
  const visibleAuthUsers = data.authUsers.filter(isVisibleAccount);
  const adminAccounts = visibleAuthUsers.filter(isVisiblePlatformAdmin);
  const ownerAccounts = visibleAuthUsers.filter((user) => user.role === "owner" && !isVisiblePlatformAdmin(user));
  const staffAccounts = visibleAuthUsers.filter((user) => ["manager", "frontdesk", "therapist", "finance"].includes(user.role));
  const storeRows = data.storeProfiles.map((store) => {
    const ownerStaff = data.staff.find((staff) => {
      const linkedUser = data.authUsers.find((user) => user.staffId === staff.id);
      return staff.role === "老板" && (!linkedUser || !isVisiblePlatformAdmin(linkedUser));
    });
    const ownerUser = ownerStaff ? data.authUsers.find((user) => user.staffId === ownerStaff.id) : ownerAccounts[0];
    return [
      store.name,
      ownerUser?.name ?? "未绑定",
      ownerUser?.account ?? "未绑定",
      store.phone,
      <Badge key={`${store.id}-status`} text={(store.status ?? "active") === "active" ? "启用" : "停用"} tone={(store.status ?? "active") === "active" ? "ok" : "warn"} />,
      shortDate(store.createdAt),
      <button
        key={`${store.id}-toggle`}
        type="button"
        onClick={() => void runMutation(() => actions.updateStoreStatus(store.id, (store.status ?? "active") === "active" ? "disabled" : "active"))}
      >
        {(store.status ?? "active") === "active" ? "停用" : "启用"}
      </button>,
    ];
  });

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="账号管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><UsersRound size={15} /> 平台账号</span>
          <h1>账号管理</h1>
          <p>平台账号、门店账号、员工账号和门店绑定关系。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="系统管理员" value={`${adminAccounts.length} 个`} hint="平台管理员" />
          <StatCard title="门店账号" value={`${ownerAccounts.length} 个`} hint="负责人账号" />
          <StatCard title="员工账号" value={`${staffAccounts.length} 个`} hint="门店工作台成员" />
        </div>
      </section>

      <section className="account-admin-stack">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<UsersRound size={18} />} title="账号列表" action={`${visibleAuthUsers.length} 个账号`} />
          <DataTable
            columns={["姓名", "账号", "角色", "状态", "创建时间", "操作"]}
            rows={visibleAuthUsers.map((user) => [
              user.name,
              user.account,
              displayRoleName(user),
              <Badge key={`${user.id}-status`} text={user.status === "active" ? "启用" : "停用"} tone={user.status === "active" ? "ok" : "warn"} />,
              shortDate(user.createdAt),
              user.id === session.user.id ? (
                <span key={`${user.id}-self`}>当前账号</span>
              ) : (
                <button
                  key={`${user.id}-toggle`}
                  type="button"
                  onClick={() => void runMutation(() => actions.updateAuthUserStatus(user.id, user.status === "active" ? "disabled" : "active"))}
                >
                  {user.status === "active" ? "停用" : "启用"}
                </button>
              ),
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Building2 size={18} />} title="门店账号" action={`${data.storeProfiles.length} 家门店`} />
          <DataTable
            columns={["门店", "负责人", "登录账号", "门店电话", "状态", "开通时间", "操作"]}
            rows={storeRows}
          />
        </div>
      </section>
    </div>
  );
}

function PlatformPermissionReadOnlyView({
  data,
  setView,
  showBack,
  actions,
  runMutation,
}: {
  data: AppData;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  actions: ApiActions;
  runMutation: (mutation: () => Promise<AppData>) => Promise<AppData>;
}) {
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const pendingStaffInvites = data.staffInvites.filter((item) => item.status === "待加入").length;
  const storeOwnerApplications = data.storeOwnerApplications ?? [];
  const pendingOwnerApplications = storeOwnerApplications.filter((item) => item.status === "待审批").length;
  const currentTemplates = parseRolePermissionTemplates(data.systemConfigs);
  const [draftTemplates, setDraftTemplates] = useState(currentTemplates);
  const [savedPermissions, setSavedPermissions] = useState(false);

  useEffect(() => {
    setDraftTemplates(parseRolePermissionTemplates(data.systemConfigs));
  }, [data.systemConfigs]);

  const setRoleTemplate = (role: UserRole, permissions: string[]) => {
    setDraftTemplates((current) => ({
      ...current,
      [role]: permissions as Permission[],
    }));
  };
  const saveRoleTemplates = () => {
    void runMutation(() => actions.updateSystemConfig("role_permissions", serializeRolePermissionTemplates(draftTemplates))).then(() => {
      setSavedPermissions(true);
      window.setTimeout(() => setSavedPermissions(false), 1400);
    });
  };
  const roleRows = (Object.entries(draftTemplates) as Array<[UserRole, Permission[]]>).map(([role, permissions]) => [
    displayUserRole(role),
    permissions.map((permission) => permissionLabels[permission]).join("、"),
    roleScopeLabels[role],
  ]);

  return (
    <div className="admin-center-page platform-admin-page permission-admin-page">
      {showBack && <PlatformPageTitle title="权限审批" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={15} /> 权限审批</span>
          <h1>权限与授权记录</h1>
          <p>角色边界、账号授权、邀请码和关键审批状态。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="待审批" value={`${pendingApprovals} 单`} hint="关键审批" />
          <StatCard title="员工邀请码" value={`${pendingStaffInvites} 个`} hint="待加入" />
          <StatCard title="门店申请" value={`${pendingOwnerApplications} 个`} hint="待审批" />
        </div>
      </section>

      <section className="permission-dashboard-grid">
        <div className="panel dashboard-panel permission-store-card">
          <PanelTitle icon={<Building2 size={18} />} title="门店申请" action={`${storeOwnerApplications.length} 条`} />
          <DataTable
            columns={["门店", "申请人", "账号", "电话", "状态", "申请时间", "操作"]}
            rows={storeOwnerApplications.map((application) => [
              application.storeName,
              application.ownerName,
              application.account,
              application.phone,
              <Badge
                key={`${application.id}-store-application-status`}
                text={application.status}
                tone={application.status === "已通过" ? "ok" : application.status === "已拒绝" ? "warn" : undefined}
              />,
              shortDate(application.createdAt),
              application.status === "待审批" ? (
                <div className="admin-approval-actions" key={`${application.id}-store-application-actions`}>
                  <button type="button" onClick={() => void runMutation(() => actions.decideStoreOwnerApplication(application.id, true))}>
                    通过
                  </button>
                  <button type="button" onClick={() => void runMutation(() => actions.decideStoreOwnerApplication(application.id, false))}>
                    拒绝
                  </button>
                </div>
              ) : application.decidedAt ? shortDate(application.decidedAt) : "-",
            ])}
          />
        </div>
        <div className="permission-support-grid">
          <div className="panel dashboard-panel permission-role-card">
            <PanelTitle icon={<ShieldCheck size={18} />} title="角色权限" action="可配置模板" />
            <DataTable columns={["角色", "可见模块", "范围"]} rows={roleRows} />
            <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
              {(Object.keys(draftTemplates) as UserRole[]).map((role) => (
                <CheckboxGroup
                  key={role}
                  label={displayUserRole(role)}
                  values={draftTemplates[role]}
                  onChange={(values) => setRoleTemplate(role, values)}
                  options={permissionOptions}
                />
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={saveRoleTemplates}>
                  {savedPermissions ? "已保存" : "保存权限模板"}
                </button>
              </div>
            </div>
          </div>
          <div className="panel dashboard-panel permission-approval-card">
            <PanelTitle icon={<ClipboardList size={18} />} title="关键审批" action={`${data.approvalRequests.length} 条`} />
            <DataTable
              columns={["类型", "目标", "金额", "申请人", "状态", "申请时间"]}
              rows={data.approvalRequests.map((request) => [
                request.type,
                request.targetId,
                money(request.amount),
                data.authUsers.find((user) => user.id === request.requestedBy)?.name ?? "系统",
                <Badge key={`${request.id}-permission-status`} text={request.status} tone={request.status === "已通过" ? "ok" : request.status === "已拒绝" ? "warn" : undefined} />,
                shortDate(request.createdAt),
              ])}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function PlatformAuditReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const allLogs = [...(data.operationLogs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const logs = allLogs.filter((log) => {
    const userName = data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统";
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const matchesSearch = !normalizedSearchTerm
      || log.summary.toLowerCase().includes(normalizedSearchTerm)
      || log.action.toLowerCase().includes(normalizedSearchTerm)
      || log.targetType.toLowerCase().includes(normalizedSearchTerm)
      || userName.toLowerCase().includes(normalizedSearchTerm);
    const matchesAction = !actionFilter || log.action === actionFilter;
    const matchesUser = !userFilter || log.userId === userFilter;
    return matchesSearch && matchesAction && matchesUser;
  });
  const actionCount = new Set(logs.map((item) => item.action)).size;
  const userCount = new Set(logs.map((item) => item.userId)).size;
  const uniqueActions = Array.from(new Set(allLogs.map((item) => item.action))).sort((a, b) => a.localeCompare(b));
  const uniqueUserIds = Array.from(new Set(allLogs.map((item) => item.userId))).sort((a, b) => {
    const leftName = data.authUsers.find((user) => user.id === a)?.name ?? a;
    const rightName = data.authUsers.find((user) => user.id === b)?.name ?? b;
    return leftName.localeCompare(rightName);
  });

  const exportLogs = () => {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [
      ["时间", "操作人", "动作", "对象类型", "摘要"].map(escapeCsv).join(","),
      ...logs.map((log) =>
        [
          log.createdAt,
          data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统",
          log.action,
          log.targetType,
          log.summary,
        ].map(escapeCsv).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `平台操作日志_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="操作日志" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ClipboardList size={15} /> 操作日志</span>
          <h1>操作日志</h1>
          <p>登录记录、关键动作、对象类型和操作摘要。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="日志数" value={`${logs.length} 条`} hint="操作记录" />
          <StatCard title="动作类型" value={`${actionCount} 类`} hint="操作分类" />
          <StatCard title="操作账号" value={`${userCount} 个`} hint="涉及账号" />
        </div>
      </section>

      <section className="panel dashboard-panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="最近操作" action={`${logs.length} 条`} />
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="搜索操作、对象、摘要或账号"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ flex: 1, minWidth: "220px" }}
          />
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="">所有动作</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
            <option value="">所有账号</option>
            {uniqueUserIds.map((userId) => (
              <option key={userId} value={userId}>{data.authUsers.find((user) => user.id === userId)?.name ?? userId}</option>
            ))}
          </select>
          <button type="button" onClick={exportLogs}>导出 CSV</button>
        </div>
        <DataTable
          columns={["时间", "操作人", "动作", "对象类型", "摘要"]}
          rows={logs.slice(0, 120).map((log) => [
            shortDate(log.createdAt),
            data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统",
            log.action,
            log.targetType,
            log.summary,
          ])}
        />
      </section>
    </div>
  );
}

function PlatformUsageReadOnlyView({
  data,
  setView,
  showBack,
  fetchR2Usage,
  fetchWorkerUsage,
}: {
  data: AppData;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  fetchR2Usage: () => Promise<R2UsageSnapshot>;
  fetchWorkerUsage: () => Promise<WorkerUsageSnapshot>;
}) {
  const [r2Usage, setR2Usage] = useState<R2UsageSnapshot | undefined>();
  const [r2Loading, setR2Loading] = useState(true);
  const [r2Error, setR2Error] = useState("");
  const [workerUsage, setWorkerUsage] = useState<WorkerUsageSnapshot | undefined>();
  const [workerLoading, setWorkerLoading] = useState(true);
  const [workerError, setWorkerError] = useState("");
  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"] as const;
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  };
  const loadR2Usage = async () => {
    setR2Loading(true);
    setR2Error("");
    try {
      setR2Usage(await fetchR2Usage());
    } catch (caught) {
      setR2Usage(undefined);
      setR2Error(caught instanceof Error ? caught.message : "R2 真实容量读取失败");
    } finally {
      setR2Loading(false);
    }
  };
  const loadWorkerUsage = async () => {
    setWorkerLoading(true);
    setWorkerError("");
    try {
      setWorkerUsage(await fetchWorkerUsage());
    } catch (caught) {
      setWorkerUsage(undefined);
      setWorkerError(caught instanceof Error ? caught.message : "Worker 请求量读取失败");
    } finally {
      setWorkerLoading(false);
    }
  };
  const loadUsage = async () => {
    await Promise.all([loadR2Usage(), loadWorkerUsage()]);
  };

  useEffect(() => {
    void loadUsage();
  }, []);

  const d1Tables = [
    ["storeProfiles", data.storeProfiles.length],
    ["authUsers", data.authUsers.length],
    ["staff", data.staff.length],
    ["customers", data.customers.length],
    ["services", data.services.length],
    ["products", data.products.length],
    ["appointments", data.appointments.length],
    ["orders", data.orders.length],
    ["memberCards", data.memberCards.length],
    ["inventoryLogs", data.inventoryLogs.length],
    ["operationLogs", data.operationLogs.length],
    ["approvalRequests", data.approvalRequests.length],
  ] as const;
  const d1Records = d1Tables.reduce((sum, [, count]) => sum + count, 0);
  const r2LimitBytes = r2Usage?.limitBytes ?? 10 * 1024 * 1024 * 1024;
  const r2UsedBytes = r2Usage?.totalBytes ?? 0;
  const r2ObjectCount = r2Usage?.objectCount ?? 0;
  const r2UsagePercent = r2LimitBytes > 0 ? Math.min(100, (r2UsedBytes / r2LimitBytes) * 100) : 0;
  const r2UsageLabel = r2Usage?.available ? (r2UsagePercent > 0 && r2UsagePercent < 0.1 ? "<0.1%" : `${r2UsagePercent.toFixed(1)}%`) : "未绑定";
  const r2Rows = r2Usage?.available
    ? r2Usage.prefixes.map((item) => [item.prefix, `${item.objectCount} 个`, formatBytes(item.bytes)])
    : [[r2Usage?.message ?? r2Error ?? "R2 Bucket 未绑定，无法读取真实容量", "-", "-"]];
  const workerRequests = workerUsage?.requests ?? 0;
  const workerErrors = workerUsage?.errors ?? 0;
  const workerSubrequests = workerUsage?.subrequests ?? 0;
  const workerErrorRate = workerRequests > 0 ? (workerErrors / workerRequests) * 100 : 0;
  const workerRows = workerUsage?.available
    ? workerUsage.rows.map((row) => [
        row.scriptName,
        row.requests.toLocaleString("zh-CN"),
        row.errors.toLocaleString("zh-CN"),
        row.subrequests.toLocaleString("zh-CN"),
      ])
    : [[workerUsage?.message ?? workerError ?? "Cloudflare Metrics 配置未完成，无法读取真实请求量", "-", "-", "-"]];
  const d1TableLabels: Record<string, string> = {
    storeProfiles: "门店资料",
    authUsers: "登录账号",
    staff: "员工档案",
    customers: "客户档案",
    services: "服务项目",
    products: "商品资料",
    appointments: "预约记录",
    orders: "收银订单",
    memberCards: "项目卡",
    inventoryLogs: "库存流水",
    operationLogs: "操作日志",
    approvalRequests: "审批记录",
  };
  const updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const r2Status = r2Loading ? "检查中" : r2Usage?.available ? "正常" : "需配置";
  const workerStatus = workerLoading ? "检查中" : workerUsage?.available ? (workerErrorRate >= 5 ? "需关注" : "正常") : "需配置";
  const systemHealthRows = [
    [
      "API 服务",
      <Badge key="api-status" text="正常" tone="ok" />,
      "当前账号已通过 API 拉取到业务数据",
    ],
    [
      "D1 数据库",
      <Badge key="d1-status" text={d1Records >= 0 ? "正常" : "异常"} tone={d1Records >= 0 ? "ok" : "warn"} />,
      `已纳入 ${d1Tables.length} 张业务表，当前 ${d1Records} 条记录`,
    ],
    [
      "R2 图片存储",
      <Badge key="r2-status" text={r2Status} tone={r2Usage?.available ? "ok" : r2Loading ? undefined : "warn"} />,
      r2Loading ? "正在读取真实容量" : r2Usage?.available ? `已用 ${formatBytes(r2UsedBytes)}，对象 ${r2ObjectCount} 个` : r2Usage?.message ?? r2Error ?? "R2 Bucket 未绑定",
    ],
    [
      "Worker 请求监控",
      <Badge key="worker-status" text={workerStatus} tone={workerUsage?.available && workerErrorRate < 5 ? "ok" : workerLoading ? undefined : "warn"} />,
      workerLoading ? "正在读取请求统计" : workerUsage?.available ? `最近 ${workerUsage.windowHours} 小时错误率 ${workerErrorRate.toFixed(2)}%` : workerUsage?.message ?? workerError ?? "Cloudflare Metrics 未配置",
    ],
  ];

  return (
    <div className="admin-center-page platform-admin-page usage-monitor-page">
      {showBack && <PlatformPageTitle title="服务器用量监控" onBack={() => setView("settings")} />}
      <header className="usage-monitor-header">
        <div className="usage-monitor-title">
          <div>
            {!showBack && <h1>服务器用量监控</h1>}
            <p>Cloudflare 资源统计 · {updatedAt}</p>
          </div>
        </div>
        <button className="usage-refresh-button" type="button" onClick={() => void loadUsage()}>
          <RefreshCw size={16} />
        </button>
      </header>

      <section className="usage-card">
        <PanelTitle icon={<ShieldCheck size={18} />} title="系统健康状态" action="实时检查" />
        <DataTable columns={["项目", "状态", "说明"]} rows={systemHealthRows} />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="R2 图片存储" action="对象存储" />
        <div className="usage-metrics">
          <div>
            <strong>{r2Loading ? "读取中" : r2ObjectCount}</strong>
            <span>对象总数</span>
          </div>
          <div>
            <strong>{r2Loading ? "读取中" : formatBytes(r2UsedBytes)}</strong>
            <span>真实已用容量</span>
          </div>
          <div>
            <strong>{formatBytes(r2LimitBytes)}</strong>
            <span>免费额度</span>
          </div>
        </div>

        <div className="usage-soft-meter" aria-label="R2 存储状态">
          <div>
            <span>R2 存储状态</span>
            <strong>{r2Loading ? "读取真实数据中" : r2Usage?.available ? `${r2UsageLabel} · 剩余 ${formatBytes(Math.max(0, r2LimitBytes - r2UsedBytes))}` : r2Usage?.message ?? r2Error}</strong>
          </div>
        </div>

        <DataTable
          columns={["目录", "对象数", "真实容量"]}
          rows={r2Loading ? [["读取中", "-", "-"]] : r2Rows.length > 0 ? r2Rows : [["暂无对象", "0 个", "0 B"]]}
        />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="D1 数据库" action="数据表" />
        <div className="usage-metrics">
          <div>
            <strong>{d1Records}</strong>
            <span>总记录数</span>
          </div>
          <div>
            <strong>{d1Tables.length}</strong>
            <span>监控表数</span>
          </div>
          <div>
            <strong>5 GB</strong>
            <span>免费额度</span>
          </div>
        </div>

        <DataTable
          columns={["数据表", "记录数", "说明"]}
          rows={d1Tables.map(([table, count]) => [table, `${count} 行`, d1TableLabels[table]])}
        />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="Worker 请求统计" action={`最近 ${workerUsage?.windowHours ?? 24} 小时`} />
        <div className="usage-metrics">
          <div>
            <strong>{workerLoading ? "读取中" : workerRequests.toLocaleString("zh-CN")}</strong>
            <span>请求数</span>
          </div>
          <div>
            <strong>{workerLoading ? "读取中" : workerErrors.toLocaleString("zh-CN")}</strong>
            <span>错误数</span>
          </div>
          <div>
            <strong>{workerLoading ? "读取中" : `${workerErrorRate.toFixed(2)}%`}</strong>
            <span>错误率</span>
          </div>
        </div>
        <DataTable
          columns={["Worker", "请求数", "错误数", "子请求"]}
          rows={workerLoading ? [["读取中", "-", "-", "-"]] : workerRows.length > 0 ? workerRows : [["暂无请求记录", "0", "0", "0"]]}
        />
        <div className="usage-inline-note">
          <span>子请求合计</span>
          <strong>{workerLoading ? "读取中" : workerSubrequests.toLocaleString("zh-CN")}</strong>
        </div>
      </section>
    </div>
  );
}

function PlatformDataReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const summary = reportSummary(data);
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const paidOrders = data.orders.filter((order) => order.status !== "已退款").length;
  const activeMemberCards = data.memberCards.filter((card) => card.status === "正常").length;

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="报表分析" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ChartNoAxesColumnIncreasing size={15} /> 报表分析</span>
          <h1>数据总览</h1>
          <p>经营收入、订单记录、客户资产和库存指标汇总。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="门店数" value={`${data.storeProfiles.length} 家`} hint="已开通门店" />
          <StatCard title="客户数" value={`${data.customers.length} 人`} hint="客户档案" />
          <StatCard title="实收金额" value={money(totalRevenue)} hint={`${paidOrders} 个收银订单`} />
        </div>
      </section>

      <section className="action-strip" aria-label="平台数据指标">
        <button type="button">
          <UsersRound size={18} />
          <strong>{data.authUsers.length}</strong>
          <span>账号总数</span>
        </button>
        <button type="button">
          <CalendarDays size={18} />
          <strong>{data.appointments.length}</strong>
          <span>预约记录</span>
        </button>
        <button type="button">
          <CreditCard size={18} />
          <strong>{data.orders.length}</strong>
          <span>订单记录</span>
        </button>
        <button type="button">
          <BadgeCent size={18} />
          <strong>{activeMemberCards}</strong>
          <span>有效会员卡</span>
        </button>
      </section>

      <section className="panel dashboard-panel">
        <PanelTitle icon={<Database size={18} />} title="核心指标" action="数据汇总" />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["实收金额", money(summary.revenue), "收银记录汇总"],
            ["退款金额", money(summary.refundAmount), "退款记录汇总"],
            ["会员储值余额", money(summary.cardBalance), "客户资产余额"],
            ["员工提成", money(summary.commission), "员工提成汇总"],
            ["低库存项", `${summary.lowStockCount} 项`, "库存模块预警数量"],
          ]}
        />
      </section>
    </div>
  );
}

function workbarForView(view: ViewKey): WorkbarKey {
  if (view === "appointments") return "appointments";
  if (view === "pos") return "cashier";
  if (view === "customers") return "customers";
  if (["settings", "catalog", "inventory", "approvals", "staff", "reports", "logs", "accounts", "permissions", "usage", "roomSettings"].includes(view)) return "admin";
  return "workbench";
}

function Dashboard({ data, session, setView }: { data: AppData; session: UserSession; setView: (view: ViewKey) => void }) {
  const paidRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const today = new Date();
  const todayAppointmentsList = data.appointments
    .filter((item) => new Date(item.startAt).toDateString() === today.toDateString())
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const userStaffId = session.user.staffId;
  const roleAppointmentsList = session.user.role === "therapist" && userStaffId
    ? todayAppointmentsList.filter((item) => item.staffId === userStaffId)
    : todayAppointmentsList;
  const todayAppointments = roleAppointmentsList.length;
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const pendingCommissions = data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const followUps = data.customerFollowUps.filter((item) => item.status === "待跟进");
  const roleFollowUps = session.user.role === "therapist" && userStaffId ? followUps.filter((item) => item.staffId === userStaffId) : followUps;
  const pendingFollowUps = roleFollowUps.length;
  const activeCards = data.memberCards.filter((item) => item.status === "正常").length;
  const todayRevenue = data.orders
    .filter((item) => new Date(item.createdAt).toDateString() === today.toDateString())
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const completedAppointments = roleAppointmentsList.filter((item) => item.status === "已完成").length;
  const onlineRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理").length;
  const myCommission = userStaffId ? data.commissions.filter((item) => item.staffId === userStaffId && item.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0) : 0;
  const careList = roleFollowUps
    .slice()
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 4);
  const dashboardContent = roleDashboardContent({
    activeCards,
    completedAppointments,
    lowStockCount: lowStock.length,
    myCommission,
    onlineRequests,
    paidRevenue,
    pendingApprovals,
    pendingCommissions,
    pendingFollowUps,
    role: session.user.role,
    todayAppointments,
    todayRevenue,
  });
  const roleTasks = roleHomeCards(data, session).filter((item) => canAccessView(session, item.view)).slice(0, 4);
  const todayLabel = today.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const isOrdinaryEmployee = session.user.role === "therapist" || session.user.role === "frontdesk";
  const heroLine = session.user.role === "therapist" ? "护理有序，客户安心" : session.user.role === "frontdesk" ? "到店有序，客户清晰" : "今日有序，门店有数";
  const heroStats = session.user.role === "therapist"
    ? `我的预约 ${todayAppointments} · 待回访 ${pendingFollowUps} · 提成 ${money(myCommission)}`
    : isOrdinaryEmployee
      ? `预约 ${todayAppointments} · 待到店 ${roleAppointmentsList.filter((item) => ["待确认", "已确认"].includes(item.status)).length} · 客户 ${data.customers.length}`
      : `预约 ${todayAppointments} · 待到店 ${roleAppointmentsList.filter((item) => ["待确认", "已确认"].includes(item.status)).length} · 营业额 ${money(todayRevenue)}`;

  return (
    <div className="dashboard-page workbench-visual-page">
      <section className={`workbench-hero role-hero-${session.user.role}`}>
        <span className="workbench-hero-kicker"><Sparkles size={15} /> {dashboardContent.title}</span>
        <h2>{heroLine}</h2>
        <p>{heroStats}</p>
        <small>{todayLabel}</small>
      </section>

      <section className="workbench-metric-row" aria-label="今日关键数据">
        {dashboardContent.metrics.map((item) => (
          <DashboardMetric key={item.label} icon={item.icon} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="workbench-content-grid">
        <div className="workbench-panel workbench-today-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title="今日待办" action={dashboardContent.scheduleTitle} />
          <div className="timeline-list">
            {roleAppointmentsList.slice(0, 5).map((item) => (
              <article key={item.id} className="timeline-item">
                <time>{shortDate(item.startAt).split(" ")[1] ?? shortDate(item.startAt)}</time>
                <div>
                  <strong>{nameOf(data.customers, item.customerId)}</strong>
                  <span>{nameOf(data.services, item.serviceId)} · {nameOf(data.staff, item.staffId)}</span>
                </div>
                <Badge text={item.status} tone={item.status === "已完成" ? "ok" : undefined} />
              </article>
            ))}
            {roleAppointmentsList.length === 0 && <p className="empty">{dashboardContent.emptySchedule}</p>}
          </div>
        </div>

        <div className="workbench-panel">
          <PanelTitle icon={<HeartHandshake size={18} />} title={dashboardContent.followTitle} action={`${pendingFollowUps} 个待跟进`} />
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

      <section className="workbench-panel workbench-quick-panel">
        <PanelTitle icon={<LayoutDashboard size={18} />} title="快捷入口" action="高频操作" />
        <div className="workbench-quick-list">
          {roleTasks.map((item) => (
            <button key={item.title} onClick={() => setView(item.view)}>
              <strong>{item.value}</strong>
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

type WorkbenchQuickDetailInput = {
  activeCards: number;
  customerCount: number;
  lowStockCount: number;
  onlineRequests: number;
  paidRevenue: number;
  pendingApprovals: number;
  pendingFollowUps: number;
  todayAppointments: number;
  todayRevenue: number;
};

function workbenchQuickTaskDetails(view: ViewKey, input: WorkbenchQuickDetailInput) {
  if (view === "appointments") {
    return {
      tone: "violet",
      icon: <CalendarDays size={24} />,
      label: "预约管理",
      description: "查看今日预约、房间安排和到店状态。",
      items: [
        { label: "今日预约", value: `${input.todayAppointments} 单`, hint: "当前工作台统计" },
        { label: "线上申请", value: `${input.onlineRequests} 单`, hint: "待转门店预约" },
        { label: "客户跟进", value: `${input.pendingFollowUps} 位`, hint: "护理后待联系" },
      ],
    };
  }
  if (view === "pos") {
    return {
      tone: "teal",
      icon: <CreditCard size={24} />,
      label: "开单收银",
      description: "进入快速开单或查看订单流水。",
      items: [
        { label: "今日实收", value: money(input.todayRevenue), hint: "当天收银汇总" },
        { label: "累计实收", value: money(input.paidRevenue), hint: "全部订单实收" },
        { label: "有效项目卡", value: `${input.activeCards} 张`, hint: "可用于卡扣" },
      ],
    };
  }
  if (view === "customers") {
    return {
      tone: "rose",
      icon: <UsersRound size={24} />,
      label: "客户档案",
      description: "维护客户资料、项目次数卡和服务记录。",
      items: [
        { label: "客户总数", value: `${input.customerCount} 人`, hint: "当前门店客户档案" },
        { label: "有效项目卡", value: `${input.activeCards} 张`, hint: "客户资产" },
        { label: "待跟进", value: `${input.pendingFollowUps} 位`, hint: "客户关怀任务" },
      ],
    };
  }
  if (view === "settings") {
    return {
      tone: "amber",
      icon: <Settings size={24} />,
      label: "管理中心",
      description: "房间设置、审批、库存和门店配置集中管理。",
      items: [
        { label: "待审批", value: `${input.pendingApprovals} 单`, hint: "退款和改价" },
        { label: "库存预警", value: `${input.lowStockCount} 项`, hint: "低于安全库存" },
        { label: "房间设置", value: "独立入口", hint: "房间数量和维护状态" },
      ],
    };
  }
  if (view === "staff") {
    return {
      tone: "amber",
      icon: <BadgeCent size={24} />,
      label: "员工结算",
      description: "查看个人提成、员工提成和结算记录。",
      items: [
        { label: "待结事项", value: `${input.pendingApprovals} 项`, hint: "按权限查看" },
        { label: "今日预约", value: `${input.todayAppointments} 单`, hint: "关联服务" },
        { label: "累计实收", value: money(input.paidRevenue), hint: "经营参考" },
      ],
    };
  }
  if (view === "reports") {
    return {
      tone: "violet",
      icon: <ChartNoAxesColumnIncreasing size={24} />,
      label: "经营报表",
      description: "查看收入、订单和经营指标。",
      items: [
        { label: "今日实收", value: money(input.todayRevenue), hint: "当天收入" },
        { label: "累计实收", value: money(input.paidRevenue), hint: "全部订单" },
        { label: "低库存", value: `${input.lowStockCount} 项`, hint: "经营风险" },
      ],
    };
  }
  if (view === "approvals") {
    return {
      tone: "rose",
      icon: <ShieldCheck size={24} />,
      label: "审批中心",
      description: "处理退款、改价和关键业务审批。",
      items: [
        { label: "待审批", value: `${input.pendingApprovals} 单`, hint: "需要处理" },
        { label: "今日预约", value: `${input.todayAppointments} 单`, hint: "业务参考" },
        { label: "今日实收", value: money(input.todayRevenue), hint: "财务参考" },
      ],
    };
  }
  if (view === "inventory") {
    return {
      tone: "amber",
      icon: <PackagePlus size={24} />,
      label: "库存管理",
      description: "查看库存预警、采购和出入库记录。",
      items: [
        { label: "低库存", value: `${input.lowStockCount} 项`, hint: "低于安全库存" },
        { label: "今日实收", value: money(input.todayRevenue), hint: "经营参考" },
        { label: "客户项目卡", value: `${input.activeCards} 张`, hint: "可能影响耗材" },
      ],
    };
  }
  return {
    tone: "violet",
    icon: <LayoutDashboard size={24} />,
    label: "功能入口",
    description: "打开对应功能页面继续处理。",
    items: [
      { label: "今日预约", value: `${input.todayAppointments} 单`, hint: "工作台统计" },
      { label: "今日实收", value: money(input.todayRevenue), hint: "工作台统计" },
      { label: "待跟进", value: `${input.pendingFollowUps} 位`, hint: "工作台统计" },
    ],
  };
}

type RoleDashboardInput = {
  activeCards: number;
  completedAppointments: number;
  lowStockCount: number;
  myCommission: number;
  onlineRequests: number;
  paidRevenue: number;
  pendingApprovals: number;
  pendingCommissions: number;
  pendingFollowUps: number;
  role: UserRole;
  todayAppointments: number;
  todayRevenue: number;
};

type RoleDashboardContent = {
  title: string;
  desc: string;
  scheduleTitle: string;
  emptySchedule: string;
  followTitle: string;
  healthTitle: string;
  metrics: Array<{ icon: ReactNode; label: string; value: string; hint: string }>;
  healthMetrics: Array<{ icon: ReactNode; label: string; value: string; hint: string }>;
  actions: Array<{ icon: ReactNode; label: string; value: string; view: ViewKey }>;
};

function roleDashboardContent(input: RoleDashboardInput): RoleDashboardContent {
  if (input.role === "therapist") {
    return {
      title: "员工服务工作台",
      desc: "今日预约、护理记录、客户回访和个人提成集中呈现。",
      scheduleTitle: "我的今日预约",
      emptySchedule: "今天暂无分配给你的预约",
      followTitle: "我的客户回访",
      healthTitle: "个人服务概览",
      metrics: [
        { icon: <CalendarDays size={18} />, label: "我的预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
        { icon: <HeartHandshake size={18} />, label: "我的回访", value: `${input.pendingFollowUps} 位`, hint: "护理后跟进任务" },
        { icon: <BadgeCent size={18} />, label: "个人提成", value: money(input.myCommission), hint: "服务提成累计" },
      ],
      healthMetrics: [
        { icon: <CalendarDays size={18} />, label: "今日服务", value: `${input.todayAppointments} 单`, hint: `完成 ${input.completedAppointments} 单` },
        { icon: <HeartHandshake size={18} />, label: "客户回访", value: `${input.pendingFollowUps} 位`, hint: "待跟进" },
        { icon: <BadgeCent size={18} />, label: "累计提成", value: money(input.myCommission), hint: "个人业绩" },
        { icon: <UsersRound size={18} />, label: "服务客户", value: `${input.pendingFollowUps + input.completedAppointments} 位`, hint: "今日相关客户" },
      ],
      actions: [
        { icon: <CalendarDays size={18} />, label: "我的预约", value: `${input.todayAppointments}`, view: "appointments" },
        { icon: <HeartHandshake size={18} />, label: "客户回访", value: `${input.pendingFollowUps}`, view: "customers" },
      ],
    };
  }
  if (input.role === "frontdesk") {
    return {
      title: "前台到店工作台",
      desc: "把预约确认、线上到店申请和客户建档放在首屏，前台按到店流程连续处理。",
      scheduleTitle: "今日到店安排",
      emptySchedule: "今日暂无预约，可从预约栏新增到店计划",
      followTitle: "待联系客户",
      healthTitle: "前台执行概览",
      metrics: [
        { icon: <Share2 size={18} />, label: "线上申请", value: `${input.onlineRequests} 单`, hint: "待确认到店" },
        { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
        { icon: <UsersRound size={18} />, label: "项目卡", value: `${input.activeCards} 张`, hint: "有效卡项" },
      ],
      healthMetrics: [
        { icon: <Share2 size={18} />, label: "线上申请", value: `${input.onlineRequests} 单`, hint: "待处理" },
        { icon: <CalendarDays size={18} />, label: "到店安排", value: `${input.todayAppointments} 单`, hint: `完成 ${input.completedAppointments} 单` },
        { icon: <UsersRound size={18} />, label: "项目卡", value: `${input.activeCards} 张`, hint: "有效卡项" },
        { icon: <HeartHandshake size={18} />, label: "待回访", value: `${input.pendingFollowUps} 位`, hint: "客户关怀" },
      ],
      actions: [
        { icon: <Share2 size={18} />, label: "线上预约", value: `${input.onlineRequests}`, view: "appointments" },
        { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments}`, view: "appointments" },
        { icon: <UsersRound size={18} />, label: "客户建档", value: "客户", view: "customers" },
      ],
    };
  }
  if (input.role === "finance") {
    return {
      title: "财务日结工作台",
      desc: "围绕实收、退款、提成、日结锁账和审批风险组织数据，财务优先核对资金与结算。",
      scheduleTitle: "今日收银关联服务",
      emptySchedule: "今日暂无需要核对的到店服务",
      followTitle: "财务相关待办",
      healthTitle: "资金结算概览",
      metrics: [
        { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "当天收银汇总" },
        { icon: <BadgeCent size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "待财务结算" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals} 单`, hint: "退款和改价风险" },
      ],
      healthMetrics: [
        { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "收银流水" },
        { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "累计实收", value: money(input.paidRevenue), hint: "全部订单" },
        { icon: <BadgeCent size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "员工结算" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals} 单`, hint: "风险控制" },
      ],
      actions: [
        { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "财务报表", value: "报表", view: "reports" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals}`, view: "approvals" },
        { icon: <CreditCard size={18} />, label: "收银流水", value: money(input.todayRevenue), view: "pos" },
      ],
    };
  }
  const operatorLabel = "店长";
  return {
    title: `${operatorLabel}经营看板`,
    desc: `${operatorLabel}首屏看现金流、客户档案、审批风险和库存风险，用一页判断门店今天是否健康。`,
    scheduleTitle: "今日服务动线",
    emptySchedule: "今日暂无预约，前台可从预约栏新增客户到店计划",
    followTitle: "客户关怀",
    healthTitle: "经营健康度",
    metrics: [
      { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
      { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "当天收银汇总" },
      { icon: <ShieldCheck size={18} />, label: "待处理", value: `${input.pendingApprovals + input.lowStockCount + input.onlineRequests} 项`, hint: "审批、库存和线上预约" },
    ],
    healthMetrics: [
      { icon: <CreditCard size={18} />, label: "累计实收", value: money(input.paidRevenue), hint: "全部订单" },
      { icon: <BadgeCent size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "待财务结算" },
      { icon: <UsersRound size={18} />, label: "有效项目卡", value: `${input.activeCards} 张`, hint: "客户档案" },
      { icon: <PackagePlus size={18} />, label: "库存预警", value: `${input.lowStockCount} 项`, hint: "低于预警值" },
    ],
    actions: [
      { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "经营收入", value: money(input.paidRevenue), view: "reports" },
      { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals}`, view: "approvals" },
      { icon: <PackagePlus size={18} />, label: "低库存", value: `${input.lowStockCount}`, view: "inventory" },
    ],
  };
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
      { title: "我的提成", value: money(myCommission), hint: "个人结算", view: "staff" },
    ];
  }
  if (session.user.role === "frontdesk") {
    return [
      { title: "今日预约", value: `${todayAppointments} 单`, hint: "确认到店与改约", view: "appointments" },
      { title: "客户档案", value: `${data.customers.length} 人`, hint: "建档与项目卡", view: "customers" },
      { title: "待联系客户", value: `${pendingFollowUps} 位`, hint: "到店与回访", view: "customers" },
    ];
  }
  if (session.user.role === "finance") {
    return [
      { title: "日结锁账", value: `${data.dailyCloses.length} 天`, hint: "支付流水核对", view: "reports" },
      { title: "待审批", value: `${pendingApprovals} 单`, hint: "退款与改价", view: "approvals" },
      { title: "收银流水", value: money(revenue), hint: "支付记录", view: "pos" },
    ];
  }
  return [
    { title: "预约管理", value: `${todayAppointments} 单`, hint: "今日预约和到店", view: "appointments" },
    { title: "开单收银", value: money(revenue), hint: "收银和订单流水", view: "pos" },
    { title: "客户档案", value: `${data.customers.length} 人`, hint: "客户资料和服务档案", view: "customers" },
    { title: "管理中心", value: `${pendingApprovals + lowStock} 项`, hint: "审批、库存和设置", view: "settings" },
  ];
}

function RoomSettings({ data, actions, runMutation, setView }: { data: AppData; actions: ApiActions; runMutation: RunMutation; setView: NavigateToView }) {
  return (
    <div className="page-stack module-subpage room-settings-page">
      <ModuleSubpageHeader parentTitle="管理中心" moduleTitle="房间设置" onBack={() => setView("settings")} />
      <RoomSettingsContent data={data} actions={actions} runMutation={runMutation} onClose={() => setView("settings")} />
    </div>
  );
}

function RoomSettingsContent({
  data,
  actions,
  runMutation,
  onClose,
  modal = false,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  onClose: () => void;
  modal?: boolean;
}) {
  const storeProfile = data.storeProfiles[0];
  const [roomNames, setRoomNames] = useState(() => roomNamesOf(data));
  const [maintenanceRoomNames, setMaintenanceRoomNames] = useState(() => maintenanceRoomNamesOf(data));
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const nextRoomNames = roomNamesOf(data);
    setRoomNames(nextRoomNames);
    setMaintenanceRoomNames(maintenanceRoomNamesOf(data, nextRoomNames));
  }, [data.storeProfiles]);

  const normalizedRoomNames = roomNames.map((roomName) => roomName.trim()).filter(Boolean);
  const normalizedMaintenanceRoomNames = normalizedRoomNames.filter((roomName) => maintenanceRoomNames.includes(roomName));
  const persistedRoomNames = roomNamesOf(data);
  const persistedMaintenanceRoomNames = maintenanceRoomNamesOf(data, persistedRoomNames);
  const hasUnsavedChanges =
    normalizedRoomNames.join("\n") !== persistedRoomNames.join("\n") || normalizedMaintenanceRoomNames.join("\n") !== persistedMaintenanceRoomNames.join("\n");
  const saveStateText = isSaving ? "保存中..." : saved ? "已同步到预约页" : hasUnsavedChanges ? "有未保存修改" : "当前设置已同步";
  const draftRoomUsage = calculateAppointmentRoomUsage(
    filterAppointmentsByRange(data.appointments, "today"),
    appointmentRangeMap().today,
    normalizedRoomNames,
    normalizedMaintenanceRoomNames,
  );

  const updateRoomName = (index: number, value: string) => {
    setSaved(false);
    setSettingsError(undefined);
    const oldRoomName = roomNames[index]?.trim();
    const nextRoomName = value.trim();
    setRoomNames((current) => current.map((roomName, roomIndex) => roomIndex === index ? value : roomName));
    if (oldRoomName && maintenanceRoomNames.includes(oldRoomName)) {
      setMaintenanceRoomNames((current) => current.map((roomName) => roomName === oldRoomName ? nextRoomName : roomName).filter(Boolean));
    }
  };

  const addRoom = () => {
    if (roomNames.length >= 20) return;
    setSaved(false);
    setSettingsError(undefined);
    setRoomNames((current) => [...current, `房间 ${current.length + 1}`]);
  };

  const removeRoom = (index: number) => {
    if (roomNames.length <= 1) return;
    setSaved(false);
    setSettingsError(undefined);
    const removedRoomName = roomNames[index]?.trim();
    setRoomNames((current) => current.filter((_, roomIndex) => roomIndex !== index));
    setMaintenanceRoomNames((current) => current.filter((roomName) => roomName !== removedRoomName));
  };

  const updateRoomMaintenance = (roomName: string, isMaintenance: boolean) => {
    const normalizedRoomName = roomName.trim();
    if (!normalizedRoomName) return;
    setSaved(false);
    setSettingsError(undefined);
    setMaintenanceRoomNames((current) => {
      const nextNames = current.filter((name) => name !== normalizedRoomName);
      return isMaintenance ? [...nextNames, normalizedRoomName] : nextNames;
    });
  };

  const saveRoomSettings = (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    setSettingsError(undefined);
    setSaved(false);
    if (!storeProfile) {
      setSettingsError("请先完成门店注册");
      return;
    }
    if (normalizedRoomNames.length === 0) {
      setSettingsError("请至少设置 1 间房间");
      return;
    }
    const duplicatedRoomName = normalizedRoomNames.find((roomName, index) => normalizedRoomNames.indexOf(roomName) !== index);
    if (duplicatedRoomName) {
      setSettingsError(`房间名称不能重复：${duplicatedRoomName}`);
      return;
    }
    setIsSaving(true);
    void runMutation(() =>
      actions.updateStoreProfile({
        name: storeProfile.name,
        phone: storeProfile.phone,
        address: storeProfile.address,
        businessHours: storeProfile.businessHours,
        roomNames: normalizedRoomNames,
        maintenanceRoomNames: normalizedMaintenanceRoomNames,
        maintenanceRoomCount: normalizedMaintenanceRoomNames.length,
      }),
    ).then(() => setSaved(true)).catch((caught) => setSettingsError(caught instanceof Error ? caught.message : "房间设置保存失败")).finally(() => setIsSaving(false));
  };

  return (
      <div className={`module-detail-stack ${modal ? "room-settings-modal-detail" : ""}`}>
        <section className="panel room-settings-panel">
          <PanelTitle icon={<Building2 size={18} />} title="房间设置" action={`${normalizedRoomNames.length} 间`} />
          <div className="room-settings-summary">
            <div>
              <span>房间数量</span>
              <strong>{normalizedRoomNames.length}</strong>
              <small>预约页按这里生成房间组件</small>
            </div>
            <div>
              <span>可预约</span>
              <strong>{draftRoomUsage.availableRoomCount}</strong>
              <small>新增预约可选择</small>
            </div>
            <div>
              <span>今日占用</span>
              <strong>{draftRoomUsage.bookedRoomSlots}</strong>
              <small>当前预约占房</small>
            </div>
            <div>
              <span>维护中</span>
              <strong>{normalizedMaintenanceRoomNames.length}</strong>
              <small>{normalizedMaintenanceRoomNames.length ? normalizedMaintenanceRoomNames.join("、") : "暂无维护房间"}</small>
            </div>
          </div>
          <form className="room-settings-form" onSubmit={saveRoomSettings}>
            <div className="room-settings-toolbar">
              <div>
                <strong>{roomNames.length} 个房间组件</strong>
                <span className={`room-save-status ${isSaving ? "saving" : saved ? "saved" : hasUnsavedChanges ? "dirty" : ""}`}>{saveStateText}</span>
              </div>
              <button type="button" onClick={addRoom} disabled={roomNames.length >= 20}>
                <PackagePlus size={16} />
                新增房间
              </button>
            </div>
            <div className="room-editor-grid">
              {roomNames.map((roomName, index) => {
                const normalizedRoomName = roomName.trim();
                const isMaintenance = normalizedMaintenanceRoomNames.includes(normalizedRoomName);
                const assignment = draftRoomUsage.roomAssignments.find((item) => item.roomName === normalizedRoomName)?.appointment;
                const statusText = isMaintenance ? "维护中" : assignment ? "已占用" : "可预约";
                return (
                  <article className={`room-editor-card ${isMaintenance ? "maintenance" : assignment ? "occupied" : "available"}`} key={`room-${index}`}>
                    <div className="room-editor-card-header">
                      <span className="room-card-index">
                        <DoorOpen size={16} />
                        <em>{index + 1}</em>
                      </span>
                      <strong>{statusText}</strong>
                    </div>
                    <label>
                      房间名称
                      <input value={roomName} onChange={(event) => updateRoomName(index, event.target.value)} placeholder={`房间 ${index + 1}`} />
                    </label>
                    <label>
                      房间状态
                      <select
                        value={isMaintenance ? "maintenance" : "available"}
                        onChange={(event) => updateRoomMaintenance(normalizedRoomName, event.target.value === "maintenance")}
                        disabled={!normalizedRoomName}
                      >
                        <option value="available">可预约</option>
                        <option value="maintenance">维护中</option>
                      </select>
                    </label>
                    <div className="room-editor-card-meta">
                      <span>{isMaintenance ? "该房间暂不可预约" : assignment ? `${nameOf(data.customers, assignment.customerId)} · ${shortDate(assignment.startAt)}` : "预约页会显示为可选房间"}</span>
                      <small>{normalizedRoomName || "未命名房间"}</small>
                    </div>
                    <button type="button" className="room-editor-remove" onClick={() => removeRoom(index)} disabled={roomNames.length <= 1}>
                      删除
                    </button>
                  </article>
                );
              })}
            </div>
            {settingsError && <p className="form-error">{settingsError}</p>}
            {saved && <p className="form-success">房间设置已保存，预约页会按指定房间状态筛选。</p>}
            <div className="row-actions">
              <button className="primary-button" disabled={isSaving}>
                <Save size={16} />
                {isSaving ? "保存中..." : saved ? "已保存" : "保存房间设置"}
              </button>
              <button type="button" onClick={onClose}>取消</button>
            </div>
          </form>
        </section>
      </div>
  );
}

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

function Appointments({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const serviceStaff = businessStaffOf(data);
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [staffId, setStaffId] = useState(firstBusinessStaffId(data));
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [startAt, setStartAt] = useState(toLocalInputValue(tomorrowAt(11)));
  const [note, setNote] = useState("");
  const [blockedStaffId, setBlockedStaffId] = useState(serviceStaff[1]?.id ?? serviceStaff[0]?.id ?? "");
  const [blockedStartAt, setBlockedStartAt] = useState(toLocalInputValue(tomorrowAt(16)));
  const [blockedEndAt, setBlockedEndAt] = useState(toLocalInputValue(tomorrowAt(17)));
  const [blockedReason, setBlockedReason] = useState("员工休息/培训");
  const [shiftStaffId, setShiftStaffId] = useState(firstBusinessStaffId(data));
  const [shiftStartAt, setShiftStartAt] = useState(toLocalInputValue(tomorrowAt(9)));
  const [shiftEndAt, setShiftEndAt] = useState(toLocalInputValue(tomorrowAt(21)));
  const [shiftNote, setShiftNote] = useState("正常班");
  const [onlineRequestStaffId, setOnlineRequestStaffId] = useState(firstBusinessStaffId(data));
  const [activeAppointmentAction, setActiveAppointmentAction] = useState<"reschedule" | "cancel" | undefined>();
  const [activeAppointmentId, setActiveAppointmentId] = useState("");
  const [rescheduleStaffId, setRescheduleStaffId] = useState(firstBusinessStaffId(data));
  const [rescheduleServiceId, setRescheduleServiceId] = useState(data.services[0]?.id ?? "");
  const [rescheduleStartAt, setRescheduleStartAt] = useState(toLocalInputValue(tomorrowAt(12)));
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [cancelReason, setCancelReason] = useState("客户临时取消");
  const staffOptions = serviceStaff.map(optionOf);
  const serviceStaffIds = new Set(serviceStaff.map((staff) => staff.id));
  const roomNames = roomNamesOf(data);
  const [roomName, setRoomName] = useState(roomNames[0] ?? "");
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);

  useEffect(() => {
    const firstStaffId = serviceStaff[0]?.id ?? "";
    if (!serviceStaff.some((staff) => staff.id === staffId)) setStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === blockedStaffId)) setBlockedStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === shiftStaffId)) setShiftStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === onlineRequestStaffId)) setOnlineRequestStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === rescheduleStaffId)) setRescheduleStaffId(firstStaffId);
  }, [blockedStaffId, onlineRequestStaffId, rescheduleStaffId, serviceStaff, shiftStaffId, staffId]);

  const addAppointment = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addAppointment({ customerId, staffId, serviceId, startAt: new Date(startAt).toISOString(), roomName, note })).then(() => {
      setNote("");
      setShowAppointmentForm(false);
    });
  };

  const setStatus = (id: string, status: Appointment["status"], reason?: string) => {
    void runMutation(() => actions.updateAppointmentStatus(id, status, reason));
  };

  const openReschedule = (appointment: Appointment) => {
    setActiveAppointmentId(appointment.id);
    setActiveAppointmentAction("reschedule");
    setRescheduleStaffId(appointment.staffId);
    setRescheduleServiceId(appointment.serviceId);
    setRescheduleStartAt(toLocalInputValue(appointment.startAt));
    setRescheduleNote(appointment.note);
  };

  const openCancel = (appointment: Appointment) => {
    setActiveAppointmentId(appointment.id);
    setActiveAppointmentAction("cancel");
    setCancelReason(appointment.cancelReason ?? "客户临时取消");
  };

  const submitReschedule = (event: FormEvent) => {
    event.preventDefault();
    const appointmentId = activeAppointmentId;
    void runMutation(() =>
      actions.rescheduleAppointment(appointmentId, {
        staffId: rescheduleStaffId,
        serviceId: rescheduleServiceId,
        startAt: new Date(rescheduleStartAt).toISOString(),
        note: rescheduleNote,
      }),
    ).then(() => {
      setActiveAppointmentAction(undefined);
      setActiveAppointmentId("");
    });
  };

  const submitCancel = (event: FormEvent) => {
    event.preventDefault();
    const appointmentId = activeAppointmentId;
    void runMutation(() => actions.updateAppointmentStatus(appointmentId, "已取消", cancelReason)).then(() => {
      setActiveAppointmentAction(undefined);
      setActiveAppointmentId("");
    });
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

  // 排班增强：简单冲突检测
  const checkAvailability = (staffId: string, start: string, end: string) => {
    const conflicts = data.staffUnavailableSlots.filter(slot =>
      slot.staffId === staffId &&
      !(new Date(end) <= new Date(slot.startAt) || new Date(start) >= new Date(slot.endAt))
    );
    return conflicts.length > 0;
  };

  const today = new Date();
  const todayAppointments = data.appointments.filter((item) => new Date(item.startAt).toDateString() === today.toDateString());
  const pendingArrival = todayAppointments.filter((item) => item.status === "已确认" || item.status === "待确认").length;
  const lockedServiceStaff = new Set(data.staffUnavailableSlots.filter((slot) => serviceStaffIds.has(slot.staffId)).map((slot) => slot.staffId));
  const availableStaff = Math.max(0, serviceStaff.filter((staff) => staff.status === "active").length - lockedServiceStaff.size);
  const pendingOnlineRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理");
  const maintenanceRoomNames = new Set(maintenanceRoomNamesOf(data, roomNames));
  const roomUsage = calculateAppointmentRoomUsage(todayAppointments, appointmentRangeMap().today, roomNames, Array.from(maintenanceRoomNames));
  const selectedService = data.services.find((item) => item.id === serviceId);
  const selectedStartAt = new Date(startAt);
  const selectedEndAt = new Date(selectedStartAt.getTime() + (selectedService?.duration ?? 60) * 60 * 1000);
  const selectedTimeConflict = checkAvailability(staffId, startAt, selectedEndAt.toISOString());
  const overlappingRoomAssignments = assignAppointmentRooms(
    data.appointments
      .filter(isActiveRoomAppointment)
      .filter((appointment) => {
        const appointmentService = data.services.find((item) => item.id === appointment.serviceId);
        const appointmentStart = new Date(appointment.startAt);
        const appointmentEnd = new Date(appointmentStart.getTime() + (appointmentService?.duration ?? 60) * 60 * 1000);
        return hasTimeOverlap(selectedStartAt, selectedEndAt, appointmentStart, appointmentEnd);
      }),
    roomNames,
    Array.from(maintenanceRoomNames),
  );
  const roomAvailabilityOptions = roomNames.map((name) => {
    const isMaintenance = maintenanceRoomNames.has(name);
    const conflictAppointment = overlappingRoomAssignments.find((assignment) => assignment.roomName === name)?.appointment;
    const disabled = isMaintenance || Boolean(conflictAppointment);
    const reason = isMaintenance ? "维护中" : conflictAppointment ? "该时间已预约" : "可预约";
    return {
      value: name,
      label: `${name} · ${reason}`,
      disabled,
      conflictAppointment,
      isMaintenance,
    };
  });
  const firstAvailableRoom = roomAvailabilityOptions.find((option) => !option.disabled)?.value ?? "";
  useEffect(() => {
    const selectedRoom = roomAvailabilityOptions.find((option) => option.value === roomName);
    if (!selectedRoom || selectedRoom.disabled) setRoomName(firstAvailableRoom);
  }, [firstAvailableRoom, roomAvailabilityOptions, roomName]);

  return (
    <div className="page-stack appointment-room-page">
      <PageHero
        icon={<CalendarDays size={15} />}
        eyebrow="预约管理"
        title="预约管理"
        desc="选择预约时间并分配可用房间，已占用或维护中的房间不能重复预约。"
      />
      <div className="module-detail-stack">
        <section className="panel appointment-room-panel">
          <div className="appointment-room-board-head">
            <div>
              <span><Building2 size={18} /> 当前房间使用情况</span>
              <strong>{roomUsage.remainingRoomSlots} 间可预约</strong>
            </div>
            <button type="button" className="appointment-room-add-button" onClick={() => setShowAppointmentForm(true)}>
              <CalendarDays size={18} />
              新增预约
            </button>
          </div>
          <div className="appointment-room-summary">
            <div>
              <span>可用房间</span>
              <strong>{roomUsage.availableRoomCount}</strong>
              <small>管理中心配置</small>
            </div>
            <div>
              <span>今日占用</span>
              <strong>{roomUsage.bookedRoomSlots}</strong>
              <small>已有预约</small>
            </div>
            <div>
              <span>当前剩余</span>
              <strong>{roomUsage.remainingRoomSlots}</strong>
              <small>可继续预约</small>
            </div>
            <div>
              <span>维护中</span>
              <strong>{roomUsage.maintenanceRoomCount}</strong>
              <small>不可预约</small>
            </div>
          </div>
          <div className="appointment-room-list-head">
            <strong>房间列表（共 {roomNames.length} 间）</strong>
            <small>房间数量来自管理中心的房间设置</small>
          </div>
          <div className="appointment-room-state-scroll">
            <div className="appointment-room-state-grid">
              {roomNames.map((name, index) => {
                const assignment = roomUsage.roomAssignments.find((item) => item.roomName === name)?.appointment;
                const isMaintenance = maintenanceRoomNames.has(name);
                const statusText = isMaintenance ? "维护中" : assignment ? "已占用" : "空闲";
                const statusHint = isMaintenance
                  ? "暂不可预约"
                  : assignment
                    ? `${nameOf(data.customers, assignment.customerId)} · ${shortDate(assignment.startAt)}`
                    : "今日暂无预约";
                return (
                  <article className={`appointment-room-state-card ${isMaintenance ? "maintenance" : assignment ? "occupied" : "available"}`} key={`${name}-${index}`}>
                    <span className="room-card-index appointment-room-card-index">
                      <DoorOpen size={16} />
                      <em>{index + 1}</em>
                    </span>
                    <b>{statusText}</b>
                    <strong>{name}</strong>
                    <small>{statusHint}</small>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      <Modal
        open={showAppointmentForm}
        title="新增预约"
        subtitle="选择预约时间后，系统会自动筛选可用房间"
        size="large"
        onClose={() => setShowAppointmentForm(false)}
      >
        <div className="module-detail-stack appointment-modal-detail">
          <form className="form appointment-create-form" onSubmit={addAppointment}>
            <Select label="客户" value={customerId} onChange={setCustomerId} options={data.customers.map(optionOf)} />
            <Select label="服务员工" value={staffId} onChange={setStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增员工" }]} />
            <Select label="服务项目" value={serviceId} onChange={setServiceId} options={data.services.map(optionOf)} />
            <DateTimeInput label="预约时间" value={startAt} onChange={setStartAt} />
            <Select
              label="房间"
              value={roomName}
              onChange={setRoomName}
              options={roomAvailabilityOptions.length ? roomAvailabilityOptions : [{ value: "", label: "请先到管理中心设置房间", disabled: true }]}
            />
            <div className="appointment-room-choice-note">
              <strong>可预约</strong>
              <span>{roomAvailabilityOptions.filter((option) => !option.disabled).map((option) => option.value).join("、") || "暂无可用房间"}</span>
            </div>
            <label>
              备注
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="客户偏好、到店提醒等" />
            </label>
            {selectedTimeConflict && <p className="form-warning">该员工在此时间段有不可预约安排，建议调整时间</p>}
            <div className="row-actions">
              <button className="primary-button" disabled={!staffId || !roomName}>保存预约</button>
              <button type="button" onClick={() => setShowAppointmentForm(false)}>取消</button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}

function Pos({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const serviceStaff = businessStaffOf(data);
  const [appointmentId, setAppointmentId] = useState("");
  const [checkoutCustomerMode, setCheckoutCustomerMode] = useState<"customer" | "walkin">("customer");
  const [checkoutContentMode, setCheckoutContentMode] = useState<"service" | "product" | "mixed">("service");
  const [customerSearch, setCustomerSearch] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(firstBusinessStaffId(data));
  const [collaboratorStaffIds, setCollaboratorStaffIds] = useState<string[]>([]);
  const [productId, setProductId] = useState("");
  const [payMethod, setPayMethod] = useState<Order["payMethod"]>("微信");
  const [cardId, setCardId] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundApprovalIds, setRefundApprovalIds] = useState<Record<string, string>>({});
  const [activeModule, setActiveModule] = useState<"quick" | "orders" | undefined>(fromManagement ? "quick" : undefined);
  const staffOptions = serviceStaff.map(optionOf);
  const saleProducts = data.products.filter((item) => item.type === "sale");
  const firstSaleProductId = saleProducts[0]?.id ?? "";
  const usesCustomer = checkoutCustomerMode === "customer";
  const usesService = checkoutContentMode !== "product";
  const usesProduct = checkoutContentMode !== "service";
  const selectedCustomer = data.customers.find((item) => item.id === customerId);
  const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
  const customerSearchResults = data.customers
    .filter((customer) => {
      if (!normalizedCustomerSearch) return true;
      return `${customer.name} ${customer.phone}`.toLowerCase().includes(normalizedCustomerSearch);
    })
    .slice(0, 8);

  useEffect(() => {
    const firstStaffId = serviceStaff[0]?.id ?? "";
    if (!serviceStaff.some((staff) => staff.id === staffId)) setStaffId(firstStaffId);
    setCollaboratorStaffIds((previous) => {
      const next = previous.filter((id) => serviceStaff.some((staff) => staff.id === id) && id !== staffId);
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [serviceStaff, staffId]);

  useEffect(() => {
    if (!usesCustomer) {
      setAppointmentId("");
      setCardId("");
      if (payMethod === "会员卡") setPayMethod("微信");
    }
    if (!usesService) {
      setAppointmentId("");
      setCollaboratorStaffIds([]);
      setCardId("");
    }
    if (usesProduct && !productId && firstSaleProductId) setProductId(firstSaleProductId);
    if (!usesProduct && productId) setProductId("");
  }, [firstSaleProductId, payMethod, productId, usesCustomer, usesProduct, usesService]);

  const availableCards = usesCustomer
    ? data.memberCards.filter((item) => {
        if (item.customerId !== customerId || item.status !== "正常") return false;
        return usesService || item.type === "储值卡";
      })
    : [];
  const total = calculateOrderTotal(data, usesService ? serviceId : undefined, usesProduct ? productId || undefined : undefined);
  const paidTotal = Math.max(0, total - discountAmount);
  const today = new Date();
  const todayOrders = data.orders.filter((order) => new Date(order.createdAt).toDateString() === today.toDateString());
  const todayPaid = todayOrders.reduce((sum, order) => sum + order.paidAmount, 0);
  const activeCards = data.memberCards.filter((card) => card.status === "正常").length;
  const arrivedAppointments = data.appointments.filter(
    (appointment) => appointment.status === "已到店" && !data.orders.some((order) => order.appointmentId === appointment.id && order.status !== "已退款"),
  );

  const clearAppointment = () => {
    setAppointmentId("");
  };

  const orderCustomerName = (order: Order) => {
    if (order.customerId) return nameOf(data.customers, order.customerId);
    const name = order.guestName?.trim();
    const phone = order.guestPhone?.trim();
    if (!name && !phone) return "散客";
    return [name || "散客", phone].filter(Boolean).join(" · ");
  };
  const orderItemName = (order: Order) => {
    const serviceName = order.serviceId ? nameOf(data.services, order.serviceId) : "";
    const productName = order.productId ? nameOf(data.products, order.productId) : "";
    return [serviceName !== "-" ? serviceName : "", productName !== "-" ? productName : ""].filter(Boolean).join(" + ") || "产品销售";
  };

  // 打印小票功能
  const printReceipt = (order: Order) => {
    const customer = data.customers.find((c) => c.id === order.customerId);
    const service = data.services.find((s) => s.id === order.serviceId);
    const staff = data.staff.find((s) => s.id === order.staffId);
    const product = order.productId ? data.products.find((p) => p.id === order.productId) : null;
    const receiptCustomer = customer
      ? `${customer.name}${customer.phone ? ` (${customer.phone})` : ""}`
      : `${order.guestName || "散客"}${order.guestPhone ? ` (${order.guestPhone})` : ""}`;

    const printContent = `
      <div style="font-family: monospace; padding: 20px; max-width: 300px; margin: 0 auto;">
        <h2 style="text-align: center; margin: 0;">${data.storeProfiles[0]?.name || '祝融｜坤锋美业'}</h2>
        <p style="text-align: center; margin: 4px 0; font-size: 12px;">${data.storeProfiles[0]?.phone || ''}</p>
        <hr />
        <p>订单号: ${order.orderNo}</p>
        <p>时间: ${new Date(order.createdAt).toLocaleString('zh-CN')}</p>
        <p>客户: ${receiptCustomer}</p>
        <p>服务: ${service?.name || '无服务项目'}</p>
        ${product ? `<p>商品: ${product.name} ×1</p>` : ''}
        <p>服务人员: ${staff?.name || ''}</p>
        <hr />
        <p>原价: ¥${order.totalAmount}</p>
        ${order.discountAmount ? `<p>折扣: -¥${order.discountAmount}</p>` : ''}
        <p><strong>实付: ¥${order.paidAmount}</strong></p>
        <p>支付方式: ${order.payMethod}</p>
        <hr />
        <p style="text-align: center; font-size: 12px;">感谢您的光临！</p>
        <p style="text-align: center; font-size: 11px;">${new Date().toLocaleDateString()}</p>
      </div>
    `;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head><title>收银小票</title></head>
          <body>${printContent}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 300);
    } else {
      // Fallback: use a hidden div
      const printDiv = document.createElement('div');
      printDiv.innerHTML = printContent;
      printDiv.style.position = 'absolute';
      printDiv.style.left = '-9999px';
      document.body.appendChild(printDiv);
      window.print();
      document.body.removeChild(printDiv);
    }
  };

  const useAppointmentForCheckout = (id: string) => {
    setAppointmentId(id);
    if (!id) return;
    const appointment = data.appointments.find((item) => item.id === id);
    if (!appointment) return;
    setCheckoutCustomerMode("customer");
    setCheckoutContentMode("service");
    setCustomerId(appointment.customerId);
    setCustomerSearch("");
    setGuestName("");
    setGuestPhone("");
    setStaffId(appointment.staffId);
    setServiceId(appointment.serviceId);
    setCollaboratorStaffIds([]);
    setCardId("");
  };

  const checkout = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.checkout({
        customerId: usesCustomer ? customerId : undefined,
        guestName: usesCustomer ? undefined : guestName.trim(),
        guestPhone: usesCustomer ? undefined : guestPhone.trim(),
        staffId,
        collaboratorStaffIds: usesService ? collaboratorStaffIds : [],
        serviceId: usesService ? serviceId : undefined,
        productId: usesProduct ? productId || undefined : undefined,
        discountAmount: discountAmount || undefined,
        adjustmentReason: adjustmentReason || undefined,
        approvalId: approvalId || undefined,
        appointmentId: usesCustomer && usesService ? appointmentId || undefined : undefined,
        payMethod,
        cardId: usesCustomer && payMethod === "会员卡" ? cardId : undefined,
      }),
    );
    setAppointmentId("");
    setGuestName("");
    setGuestPhone("");
    if (!usesProduct) setProductId("");
    setCollaboratorStaffIds([]);
    setDiscountAmount(0);
    setAdjustmentReason("");
    setApprovalId("");
  };

  type PosModuleKey = NonNullable<typeof activeModule>;
  const posModules: Array<FeatureModule<PosModuleKey>> = [
    {
      key: "quick",
      title: "快速开单",
      desc: "散客、客户、项目、产品和支付",
      icon: CreditCard,
      tone: "rose",
      meta: "开始收银",
      points: ["散客服务", "客户服务", "产品销售", "项目+产品"],
    },
    {
      key: "orders",
      title: "订单流水",
      desc: "查看收款记录、小票和退款入口",
      icon: ClipboardList,
      tone: "amber",
      meta: `${data.orders.length} 单`,
      points: ["最近订单", "支付记录", "退款从订单进入"],
    },
  ];
  const activeModuleTitle = activeModule ? posModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack cashier-module-page module-hub">
      <PageHero
        icon={<CreditCard size={15} />}
        eyebrow="开单收银"
        title="开单收银"
        desc="完成项目开单、会员卡扣款、支付记录、提成计算与库存扣减。"
        stats={[
          { label: "今日收款", value: money(todayPaid), hint: `${todayOrders.length} 笔订单`, icon: <ChartNoAxesColumnIncreasing size={18} /> },
          { label: "今日订单", value: `${todayOrders.length} 单`, hint: "当日收银记录", icon: <ClipboardList size={18} /> },
          { label: "会员卡可用", value: `${activeCards} 张`, hint: "支持卡扣支付", icon: <BadgeCent size={18} /> },
        ]}
      />
      {!fromManagement && (
        <section className="cashier-workflow" aria-label="收银工作区">
          <button
            type="button"
            className={`cashier-workflow-card cashier-workflow-primary ${activeModule === "quick" ? "active" : ""}`}
            onClick={() => setActiveModule("quick")}
          >
            <span className="admin-module-icon rose">
              <CreditCard size={22} />
            </span>
            <span className="cashier-workflow-copy">
              <strong>快速开单</strong>
              <small>VIP会员、散客服务、产品销售都从这里完成收款。</small>
              <span className="module-entry-points">
                <i>VIP会员</i>
                <i>散客服务</i>
                <i>产品销售</i>
                <i>项目+产品</i>
              </span>
            </span>
            <em>开始收银</em>
          </button>
          <button
            type="button"
            className={`cashier-workflow-card cashier-workflow-secondary ${activeModule === "orders" ? "active" : ""}`}
            onClick={() => setActiveModule("orders")}
          >
            <span className="admin-module-icon amber">
              <ClipboardList size={22} />
            </span>
            <span className="cashier-workflow-copy">
              <strong>订单流水</strong>
              <small>查看最近订单、支付记录、小票和退款入口。</small>
              <span className="module-entry-points">
                <i>最近订单</i>
                <i>支付记录</i>
                <i>退款从订单进入</i>
              </span>
            </span>
            <em>{data.orders.length} 单</em>
          </button>
        </section>
      )}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "开单收银"}
        subtitle="VIP会员、散客服务、产品销售和订单记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack cashier-modal-detail">
        {activeModule === "quick" && (
        <section className="panel">
        <PanelTitle
          icon={<CreditCard size={18} />}
          title="快速开单"
          action="散客 / 客户 / 产品"
        />
        <form className="form" onSubmit={checkout}>
          <div className="checkout-mode-panel">
            <label>开单对象</label>
            <div className="segmented checkout-segmented two">
              <button
                type="button"
                className={checkoutCustomerMode === "customer" ? "active" : ""}
                onClick={() => {
                  setCheckoutCustomerMode("customer");
                  setCheckoutContentMode("service");
                  setGuestName("");
                  setGuestPhone("");
                }}
              >
                老客户
              </button>
              <button type="button" className={checkoutCustomerMode === "walkin" ? "active" : ""} onClick={() => setCheckoutCustomerMode("walkin")}>散客</button>
            </div>
          </div>
          <div className="checkout-mode-panel">
            <label>消费类型</label>
            <div className="segmented checkout-segmented">
              <button type="button" className={checkoutContentMode === "service" ? "active" : ""} onClick={() => setCheckoutContentMode("service")}>{usesCustomer ? "VIP会员" : "单次服务"}</button>
              <button type="button" className={checkoutContentMode === "product" ? "active" : ""} onClick={() => setCheckoutContentMode("product")}>产品购买</button>
              <button type="button" className={checkoutContentMode === "mixed" ? "active" : ""} onClick={() => setCheckoutContentMode("mixed")}>服务+产品</button>
            </div>
          </div>
          {usesCustomer ? (
            <div className="checkout-customer-search">
              <label>
                客户
                <input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.phone}` : "输入客户姓名或手机号搜索"}
                />
              </label>
              <div className="checkout-customer-result-list">
                {customerSearchResults.length ? customerSearchResults.map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    className={customer.id === customerId ? "active" : ""}
                    onClick={() => {
                      clearAppointment();
                      setCustomerId(customer.id);
                      setCustomerSearch("");
                      setCardId("");
                    }}
                  >
                    <strong>{customer.name}</strong>
                    <span>{customer.phone}</span>
                  </button>
                )) : (
                  <div className="checkout-customer-empty">没有找到客户，可切换为散客开单。</div>
                )}
              </div>
            </div>
          ) : (
            <div className="checkout-guest-fields">
              <div className="checkout-context-note">
                <strong>散客开单</strong>
                <span>记录姓名和电话，方便后续回访和二次开发。</span>
              </div>
              <div className="checkout-guest-grid">
                <label>
                  散客姓名
                  <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="如 张女士" />
                </label>
                <label>
                  联系电话
                  <input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="用于回访和客户开发" />
                </label>
              </div>
            </div>
          )}
          {usesCustomer && usesService && (
            <>
              <Select
                label="关联到店预约（可选）"
                value={appointmentId}
                onChange={useAppointmentForCheckout}
                options={[
                  { value: "", label: arrivedAppointments.length ? "不关联预约，直接开单" : "暂无待收银到店预约" },
                  ...arrivedAppointments.map((appointment) => ({
                    value: appointment.id,
                    label: `${shortDate(appointment.startAt)} · ${nameOf(data.customers, appointment.customerId)} · ${nameOf(data.services, appointment.serviceId)}`,
                  })),
                ]}
              />
              {appointmentId && <p className="form-note">已带入预约信息，收银完成后预约会自动标记为已完成。</p>}
            </>
          )}
          {usesService && (
            <Select label="服务项目" value={serviceId} onChange={(value) => { clearAppointment(); setServiceId(value); }} options={data.services.map(optionOf)} />
          )}
          {usesProduct && (
            <Select
              label={usesService ? "销售商品" : "购买产品"}
              value={productId}
              onChange={setProductId}
              options={saleProducts.length ? saleProducts.map(optionOf) : [{ value: "", label: "请先到项目商品新增产品" }]}
            />
          )}
          <Select
            label={usesService ? "服务员工" : "收银员工"}
            value={staffId}
            onChange={(value) => {
              clearAppointment();
              setStaffId(value);
              setCollaboratorStaffIds((previous) => previous.filter((id) => id !== value));
            }}
            options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增员工" }]}
          />
          {usesService && (
            <CheckboxGroup
              label="协作员工"
              values={collaboratorStaffIds}
              onChange={setCollaboratorStaffIds}
              options={serviceStaff.filter((item) => item.id !== staffId).map(optionOf)}
            />
          )}
          <Select
            label="支付方式"
            value={payMethod}
            onChange={(value) => setPayMethod(value as Order["payMethod"])}
            options={(usesCustomer ? ["微信", "支付宝", "现金", "银行卡", "会员卡"] : ["微信", "支付宝", "现金", "银行卡"]).map((item) => ({ value: item, label: item }))}
          />
          {payMethod === "会员卡" && (
            <Select
              label="选择会员卡"
              value={cardId}
              onChange={setCardId}
              options={availableCards.length
                ? availableCards.map((item) => ({ value: item.id, label: `${item.name} · ${item.type} · ${item.balance ? money(item.balance) : `${item.remainingTimes} 次`}` }))
                : [{ value: "", label: usesService ? "当前客户暂无可用会员卡" : "产品购买仅支持储值卡" }]}
            />
          )}
          <label>
            优惠/改价金额
            <input type="number" value={discountAmount} onChange={(event) => setDiscountAmount(Number(event.target.value))} min={0} />
          </label>
          <label>
            改价原因
            <input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="如老客维护、会员权益" />
          </label>
          {discountAmount > 0 && (
            <div className="sub-panel">
              <Select
                label="已通过改价审批"
                value={approvalId}
                onChange={setApprovalId}
                options={[
                  { value: "", label: "选择审批单" },
                  ...data.approvalRequests
                    .filter((item) => item.type === "改价折扣" && item.status === "已通过" && item.amount >= discountAmount)
                    .map((item) => ({ value: item.id, label: `${item.reason} · ${money(item.amount)}` })),
                ]}
              />
              <p className="form-note">改价审批请到管理中心的审批中心提交并通过后再选择。</p>
            </div>
          )}
          <div className="checkout-total">
            <span>应收金额</span>
            <strong>{money(paidTotal)}</strong>
          </div>
          <button
            className="primary-button"
            disabled={
              !staffId
              || (usesCustomer && !customerId)
              || (!usesCustomer && (!guestName.trim() || !guestPhone.trim()))
              || (usesService && !serviceId)
              || (usesProduct && !productId)
              || (payMethod === "会员卡" && (!usesCustomer || !cardId))
            }
          >
            完成收银
          </button>
        </form>
        </section>
        )}
        {activeModule === "orders" && (
        <section className="panel">
        <PanelTitle
          icon={<ClipboardList size={18} />}
          title="订单流水"
          action="最近订单"
        />
          <DataTable
          columns={["单号", "客户", "项目", "员工", "来源", "支付", "实收", "状态", "时间", "操作"]}
          rows={data.orders
            .map((order) => [
            order.orderNo,
            orderCustomerName(order),
            orderItemName(order),
            nameOf(data.staff, order.staffId),
            order.appointmentId ? "预约到店" : "手工开单",
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
        )}
      </div>
      </Modal>
    </div>
  );
}

function Customers({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const serviceStaff = businessStaffOf(data);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [cardName, setCardName] = useState("面部护理十次卡");
  const [cardType, setCardType] = useState<CardType>("次数卡");
  const [cardAmount, setCardAmount] = useState(2980);
  const [cardTimes, setCardTimes] = useState(10);
  const [cardServiceId, setCardServiceId] = useState(data.services[0]?.id ?? "");
  const [cardServiceIds, setCardServiceIds] = useState<string[]>(data.services[0]?.id ? [data.services[0].id] : []);
  const [operationCardId, setOperationCardId] = useState(data.memberCards[0]?.id ?? "");
  const [rechargeAmount, setRechargeAmount] = useState(300);
  const [rechargeTimes, setRechargeTimes] = useState(0);
  const [extendTo, setExtendTo] = useState("2027-12-31");
  const [transferToCustomerId, setTransferToCustomerId] = useState(data.customers[1]?.id ?? data.customers[0]?.id ?? "");
  const [recordCustomerId, setRecordCustomerId] = useState(data.customers[0]?.id ?? "");
  const [recordStaffId, setRecordStaffId] = useState(serviceStaff[1]?.id ?? serviceStaff[0]?.id ?? "");
  const [recordServiceId, setRecordServiceId] = useState(data.services[0]?.id ?? "");
  const [recordOrderId, setRecordOrderId] = useState("");
  const [skinCondition, setSkinCondition] = useState("敏感偏干");
  const [beforeNote, setBeforeNote] = useState("到店皮肤检测");
  const [careSteps, setCareSteps] = useState("清洁、导入、修护、保湿");
  const [productsUsed, setProductsUsed] = useState("清洁精华液、修护护理包");
  const [afterNote, setAfterNote] = useState("补水修护后泛红下降");
  const [customerFeedback, setCustomerFeedback] = useState("体验舒适，接受下次护理建议");
  const [nextCareAdvice, setNextCareAdvice] = useState("7 天内加强保湿防晒，下次复查泛红情况");
  const [followUpAt, setFollowUpAt] = useState(toLocalInputValue(tomorrowAt(18)));
  const [signatureCustomerId, setSignatureCustomerId] = useState(data.customers[0]?.id ?? "");
  const [signatureRecordId, setSignatureRecordId] = useState("");
  const [signatureOrderId, setSignatureOrderId] = useState("");
  const [signatureTitle, setSignatureTitle] = useState("服务完成确认签名");
  const [signatureContent, setSignatureContent] = useState("本人确认本次到店服务已完成，服务项目、项目卡核销和服务档案内容无误。");
  const [signatureValidDays, setSignatureValidDays] = useState(7);
  const [activeModule, setActiveModule] = useState<"profile" | "cards" | "records" | "signature" | undefined>(fromManagement ? "profile" : undefined);

  useEffect(() => {
    if (recordOrderId && !data.orders.some((order) => order.id === recordOrderId && order.customerId === recordCustomerId)) {
      setRecordOrderId("");
    }
  }, [recordCustomerId, recordOrderId, data.orders]);

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
        orderId: recordOrderId || undefined,
        skinCondition,
        beforeNote,
        careSteps,
        productsUsed,
        afterNote,
        customerFeedback,
        nextCareAdvice,
        nextFollowUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
      }),
    );
  };

  const createSignature = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.createCustomerSignature({
        customerId: signatureCustomerId,
        serviceRecordId: signatureRecordId || undefined,
        orderId: signatureOrderId || undefined,
        title: signatureTitle,
        content: signatureContent,
        validDays: signatureValidDays,
      }),
    );
  };

  const activeCards = data.memberCards.filter((card) => card.status === "正常");
  const totalRemainingTimes = activeCards.reduce((sum, card) => sum + card.remainingTimes, 0);
  const pendingSignatures = data.customerSignatures.filter((signature) => signature.status === "待签名").length;
  const recordLinkedOrderIds = new Set(data.customerServiceRecords.map((record) => record.orderId).filter(Boolean));
  const staffOptions = serviceStaff.map(optionOf);

  useEffect(() => {
    const firstStaffId = serviceStaff[0]?.id ?? "";
    if (!serviceStaff.some((staff) => staff.id === recordStaffId)) setRecordStaffId(firstStaffId);
  }, [recordStaffId, serviceStaff]);
  const serviceProductSummary = (order: Order) => {
    const service = data.services.find((item) => item.id === order.serviceId);
    const consumables =
      service?.consumables?.length
        ? service.consumables
        : service?.consumableProductId && service.consumableQty
          ? [{ productId: service.consumableProductId, quantity: service.consumableQty }]
          : [];
    const serviceProducts = consumables
      .filter((item) => item.productId && item.quantity > 0)
      .map((item) => {
        const product = data.products.find((productItem) => productItem.id === item.productId);
        return product ? `${product.name} x${item.quantity}${product.unit}` : "";
      })
      .filter(Boolean);
    const retailProduct = order.productId ? data.products.find((item) => item.id === order.productId) : undefined;
    return [...serviceProducts, retailProduct ? `${retailProduct.name} x1${retailProduct.unit}` : undefined].filter(Boolean).join("、");
  };
  const cardConsumptionSummary = (order: Order) => {
    const transaction = data.memberCardTransactions.find((item) => item.orderId === order.id && item.type === "消费");
    if (!transaction) return "";
    const card = data.memberCards.find((item) => item.id === transaction.memberCardId);
    const amountText = transaction.amountDelta ? `${Math.abs(transaction.amountDelta)} 元` : "";
    const timesText = transaction.timesDelta ? `${Math.abs(transaction.timesDelta)} 次` : "";
    return `${card?.name ?? "会员卡"}扣${amountText || timesText}`;
  };
  const hydrateServiceRecordFromOrder = (orderId: string) => {
    setRecordOrderId(orderId);
    if (!orderId) return;
    const order = data.orders.find((item) => item.id === orderId);
    if (!order) return;
    const serviceName = nameOf(data.services, order.serviceId);
    const cardText = cardConsumptionSummary(order);
    setRecordCustomerId(order.customerId);
    setRecordStaffId(order.staffId);
    setRecordServiceId(order.serviceId);
    setSkinCondition("本次到店服务记录");
    setBeforeNote(`${order.orderNo} 到店服务，支付方式：${order.payMethod}${cardText ? `，${cardText}` : ""}`);
    setCareSteps(`完成${serviceName}服务流程`);
    setProductsUsed(serviceProductSummary(order));
    setAfterNote(`${serviceName}服务已完成`);
    setCustomerFeedback("");
    setNextCareAdvice(`根据${serviceName}项目周期安排下次护理`);
    setFollowUpAt(toLocalInputValue(tomorrowAt(72)));
  };
  const recordOrderOptions = [
    { value: "", label: "不关联订单" },
    ...data.orders
      .filter((order) => order.customerId === recordCustomerId && order.serviceId && !recordLinkedOrderIds.has(order.id) && order.status !== "已退款")
      .map((order) => ({
        value: order.id,
        label: `${order.orderNo} · ${nameOf(data.services, order.serviceId)} · ${money(order.paidAmount)}${cardConsumptionSummary(order) ? ` · ${cardConsumptionSummary(order)}` : ""}`,
      })),
  ];
  const signatureRecordOptions = [
    { value: "", label: "不关联服务档案" },
    ...data.customerServiceRecords
      .filter((record) => record.customerId === signatureCustomerId)
      .map((record) => ({
        value: record.id,
        label: `${nameOf(data.services, record.serviceId)} · ${shortDate(record.createdAt)}`,
      })),
  ];
  const signatureOrderOptions = [
    { value: "", label: "不关联订单" },
    ...data.orders
      .filter((order) => order.customerId === signatureCustomerId && order.serviceId && order.status !== "已退款")
      .map((order) => ({
        value: order.id,
        label: `${order.orderNo} · ${nameOf(data.services, order.serviceId)} · ${money(order.paidAmount)}`,
      })),
  ];
  const signatureUrl = (token: string) => `${window.location.origin}/signature/${token}`;
  const projectScope = (serviceId?: string, serviceIds?: string[]) => {
    if (serviceIds?.length) return serviceIds.map((id) => nameOf(data.services, id)).join(" / ");
    return serviceId ? nameOf(data.services, serviceId) : "通用";
  };
  const recentVisits = data.customers.filter((customer) => {
    const days = (Date.now() - +new Date(customer.lastVisit)) / 86400000;
    return days <= 7;
  }).length;
  type CustomerModuleKey = NonNullable<typeof activeModule>;
  const customerModules: Array<FeatureModule<CustomerModuleKey>> = [
    { key: "profile", title: "客户档案", desc: "新增客户和客户列表", icon: UsersRound, tone: "violet", meta: `${data.customers.length} 位` },
    { key: "cards", title: "项目次数卡", desc: "开项目卡、充值次数和核销记录", icon: CreditCard, tone: "rose", meta: `${activeCards.length} 张` },
    { key: "records", title: "服务记录", desc: "护理过程、项目卡消耗和回访", icon: ClipboardList, tone: "jade", meta: `${data.customerServiceRecords.length} 条` },
    { key: "signature", title: "服务确认签名", desc: "客户到店后用平板现场签名", icon: LockKeyhole, tone: "plum", meta: `${data.customerSignatures?.length ?? 0} 份` },
  ];
  const activeModuleTitle = activeModule ? customerModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack customer-module-page module-hub">
      <PageHero
        icon={<UsersRound size={15} />}
        eyebrow="客户档案"
        title="客户服务档案"
        desc="管理客户资料、项目次数卡、到店服务记录和现场签名确认。"
        stats={[
          { label: "客户总数", value: `${data.customers.length} 位`, hint: `${recentVisits} 位近 7 天到店`, icon: <UsersRound size={18} /> },
          { label: "有效项目卡", value: `${activeCards.length} 张`, hint: `${totalRemainingTimes} 次可核销`, icon: <CreditCard size={18} /> },
          { label: "待签名", value: `${pendingSignatures} 份`, hint: "服务完成确认", icon: <LockKeyhole size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={customerModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "客户档案"}
        subtitle="客户资料、项目卡和服务确认记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack customer-modal-detail">
        {activeModule && (
        <section className="panel">
        {activeModule === "profile" && (
        <>
        <PanelTitle icon={<UsersRound size={18} />} title="新增客户" action="客户档案沉淀" />
        <form className="form" onSubmit={addCustomer}>
          <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <button className="primary-button">保存客户</button>
        </form>
        </>
        )}
        {activeModule === "cards" && (
        <>
        <PanelTitle icon={<CreditCard size={18} />} title="开项目卡" action="储值/次数/套餐" />
        <form className="form" onSubmit={openCard}>
          <Select label="客户" value={customerId} onChange={setCustomerId} options={data.customers.map(optionOf)} />
          <label>项目卡名称<input value={cardName} onChange={(event) => setCardName(event.target.value)} /></label>
          <Select label="卡类型" value={cardType} onChange={(value) => setCardType(value as CardType)} options={["储值卡", "次数卡", "套餐卡"].map((item) => ({ value: item, label: item }))} />
          {cardType === "储值卡" && (
            <label>储值金额<input type="number" value={cardAmount} onChange={(event) => setCardAmount(Number(event.target.value))} /></label>
          )}
          {cardType !== "储值卡" && (
            <label>可用次数<input type="number" value={cardTimes} onChange={(event) => setCardTimes(Number(event.target.value))} /></label>
          )}
          {cardType === "次数卡" && <Select label="绑定项目" value={cardServiceId} onChange={setCardServiceId} options={data.services.map(optionOf)} />}
          {cardType === "套餐卡" && <CheckboxGroup label="可用项目" values={cardServiceIds} onChange={setCardServiceIds} options={data.services.map(optionOf)} />}
          <button className="primary-button">保存项目卡</button>
        </form>
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="项目卡操作" action="充值/加次/冻结/延期" />
        <form className="form" onSubmit={rechargeCard}>
          <Select label="项目卡" value={operationCardId} onChange={setOperationCardId} options={data.memberCards.map((card) => ({ value: card.id, label: `${nameOf(data.customers, card.customerId)} · ${card.name}` }))} />
          <label>充值金额<input type="number" value={rechargeAmount} onChange={(event) => setRechargeAmount(Number(event.target.value))} /></label>
          <label>增加次数<input type="number" value={rechargeTimes} onChange={(event) => setRechargeTimes(Number(event.target.value))} /></label>
          <button className="primary-button">保存调整</button>
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
        </>
        )}
        {activeModule === "records" && (
        <>
        <PanelTitle icon={<ClipboardList size={18} />} title="服务记录" action="护理记录/项目卡核销" />
        <div className="order-record-shortcuts">
          {data.orders
            .filter((order) => !recordLinkedOrderIds.has(order.id) && order.status !== "已退款")
            .slice(0, 4)
            .map((order) => (
              <button type="button" key={order.id} onClick={() => hydrateServiceRecordFromOrder(order.id)}>
                <strong>{order.orderNo}</strong>
                <span>{nameOf(data.customers, order.customerId)} · {nameOf(data.services, order.serviceId)}</span>
                <small>{cardConsumptionSummary(order) || order.payMethod}</small>
              </button>
            ))}
        </div>
        <form className="form" onSubmit={addServiceRecord}>
          <Select label="客户" value={recordCustomerId} onChange={setRecordCustomerId} options={data.customers.map(optionOf)} />
          <Select label="关联订单" value={recordOrderId} onChange={hydrateServiceRecordFromOrder} options={recordOrderOptions} />
          <Select label="员工" value={recordStaffId} onChange={setRecordStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增员工" }]} />
          <Select label="项目" value={recordServiceId} onChange={setRecordServiceId} options={data.services.map(optionOf)} />
          <label>皮肤情况<input value={skinCondition} onChange={(event) => setSkinCondition(event.target.value)} /></label>
          <label>服务前记录<textarea value={beforeNote} onChange={(event) => setBeforeNote(event.target.value)} /></label>
          <label>护理步骤<textarea value={careSteps} onChange={(event) => setCareSteps(event.target.value)} /></label>
          <label>使用产品/耗材<textarea value={productsUsed} onChange={(event) => setProductsUsed(event.target.value)} /></label>
          <label>服务后记录<textarea value={afterNote} onChange={(event) => setAfterNote(event.target.value)} /></label>
          <label>客户反馈<textarea value={customerFeedback} onChange={(event) => setCustomerFeedback(event.target.value)} /></label>
          <label>下次护理建议<textarea value={nextCareAdvice} onChange={(event) => setNextCareAdvice(event.target.value)} /></label>
          <DateTimeInput label="下次回访" value={followUpAt} onChange={setFollowUpAt} />
          <button className="primary-button" disabled={!recordStaffId}>保存档案</button>
        </form>
        </>
        )}
        {activeModule === "signature" && (
        <>
        <PanelTitle icon={<LockKeyhole size={18} />} title="服务确认签名" action="平板现场签名" />
        <form className="form" onSubmit={createSignature}>
          <Select label="客户" value={signatureCustomerId} onChange={(value) => { setSignatureCustomerId(value); setSignatureRecordId(""); setSignatureOrderId(""); }} options={data.customers.map(optionOf)} />
          <Select label="关联档案" value={signatureRecordId} onChange={setSignatureRecordId} options={signatureRecordOptions} />
          <Select label="关联订单" value={signatureOrderId} onChange={setSignatureOrderId} options={signatureOrderOptions} />
          <label>签名标题<input value={signatureTitle} onChange={(event) => setSignatureTitle(event.target.value)} /></label>
          <label>确认内容<textarea value={signatureContent} onChange={(event) => setSignatureContent(event.target.value)} /></label>
          <label>有效期（天）<input type="number" min={1} value={signatureValidDays} onChange={(event) => setSignatureValidDays(Number(event.target.value))} /></label>
          <button className="primary-button" disabled={!signatureCustomerId}>生成现场签名页</button>
        </form>
        </>
        )}
        </section>
        )}
        {activeModule === "profile" && (
        <section className="panel">
        <PanelTitle icon={<UsersRound size={18} />} title="客户列表" action={`${data.customers.length} 位客户`} />
        <DataTable
          columns={["客户", "手机", "最近到店", "项目卡", "服务记录", "签名"]}
          rows={data.customers.map((customer) => [
            customer.name,
            customer.phone,
            shortDate(customer.lastVisit),
            data.memberCards
              .filter((card) => card.customerId === customer.id)
              .map((card) => `${card.name}(${projectScope(card.serviceId, card.serviceIds)})`)
              .join("，") || "未开卡",
            `${data.customerServiceRecords.filter((record) => record.customerId === customer.id).length} 条`,
            `${data.customerSignatures.filter((signature) => signature.customerId === customer.id).length} 份`,
          ])}
        />
        </section>
        )}
        {activeModule === "cards" && (
        <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="项目卡列表" action="余额/次数/退卡" />
        <DataTable
          columns={["客户", "项目卡", "类型", "余额", "剩余次数", "适用项目", "状态", "操作"]}
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
        <PanelTitle icon={<CreditCard size={18} />} title="项目卡流水" action="开卡/核销/退款" />
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
        )}
        {activeModule === "records" && (
        <section className="panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="服务记录" action={`${data.customerServiceRecords.length} 条`} />
        <DataTable
          columns={["客户", "员工", "项目", "订单", "卡项消耗", "皮肤情况", "服务前", "护理步骤", "使用产品", "服务后", "客户反馈", "下次建议", "时间"]}
          rows={data.customerServiceRecords.map((record) => [
            nameOf(data.customers, record.customerId),
            nameOf(data.staff, record.staffId),
            nameOf(data.services, record.serviceId),
            record.orderId ? data.orders.find((order) => order.id === record.orderId)?.orderNo ?? record.orderId : "未关联",
            record.memberCardTransactionId
              ? (() => {
                  const transaction = data.memberCardTransactions.find((item) => item.id === record.memberCardTransactionId);
                  const card = transaction ? data.memberCards.find((item) => item.id === transaction.memberCardId) : undefined;
                  return transaction ? `${card?.name ?? "项目卡"} · ${transaction.amountDelta ? `${Math.abs(transaction.amountDelta)} 元` : `${Math.abs(transaction.timesDelta)} 次`}` : "未扣卡";
                })()
              : "未扣卡",
            record.skinCondition,
            record.beforeNote,
            record.careSteps || "未记录",
            record.productsUsed || "未记录",
            record.afterNote,
            record.customerFeedback || "未记录",
            record.nextCareAdvice || "未记录",
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
        )}
        {activeModule === "signature" && (
        <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title="服务签名记录" action={`${data.customerSignatures?.length ?? 0} 份`} />
        <DataTable
          columns={["客户", "标题", "状态", "现场签名页", "签名人", "创建/签名时间"]}
          rows={(data.customerSignatures ?? []).map((signature) => [
            nameOf(data.customers, signature.customerId),
            signature.title,
            <Badge key={`${signature.id}-status`} text={signature.status} tone={signature.status === "已签名" ? "ok" : "warn"} />,
            signature.status === "待签名" ? (
              <a key={`${signature.id}-link`} href={signatureUrl(signature.token)} target="_blank" rel="noreferrer">
                打开现场签名页
              </a>
            ) : (
              "已完成"
            ),
            signature.signerName ?? "-",
            `${shortDate(signature.createdAt)}${signature.signedAt ? ` / ${shortDate(signature.signedAt)}` : ""}`,
          ])}
        />
        </section>
        )}

      </div>
      </Modal>
    </div>
  );
}

function Catalog({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState(398);
  const [serviceDuration, setServiceDuration] = useState(60);
  const [serviceConsumableProductId, setServiceConsumableProductId] = useState("");
  const [serviceConsumableQty, setServiceConsumableQty] = useState(1);
  const [recipeServiceId, setRecipeServiceId] = useState(data.services[0]?.id ?? "");
  const [recipeProductId, setRecipeProductId] = useState(data.products.find((product) => product.type === "consumable")?.id ?? "");
  const [recipeQty, setRecipeQty] = useState(1);
  const [productName, setProductName] = useState("");
  const [productStock, setProductStock] = useState(10);
  const [showServiceCreate, setShowServiceCreate] = useState(false);
  const [activeModule, setActiveModule] = useState<"service" | "recipe" | "product" | "serviceList" | "productList" | "formulaList" | undefined>(fromManagement ? "serviceList" : undefined);
  const consumableOptions = data.products
    .filter((product) => product.type === "consumable")
    .map((product) => ({ value: product.id, label: `${product.name} · ${product.stock}${product.unit}` }));

  const addService = (event: FormEvent) => {
    event.preventDefault();
    const consumables = serviceConsumableProductId ? [{ productId: serviceConsumableProductId, quantity: serviceConsumableQty }] : [];
    void runMutation(() =>
      actions.addService({
        name: serviceName,
        price: servicePrice,
        category: "自定义项目",
        duration: serviceDuration,
        consumables,
        consumableProductId: serviceConsumableProductId || undefined,
        consumableQty: serviceConsumableProductId ? serviceConsumableQty : undefined,
      }),
    );
    setServiceName("");
    setServiceConsumableProductId("");
    setServiceConsumableQty(1);
    setShowServiceCreate(false);
  };

  const selectedRecipeService = data.services.find((service) => service.id === recipeServiceId);
  const recipeConsumables = serviceConsumablesOf(selectedRecipeService);
  const addRecipeConsumable = (event: FormEvent) => {
    event.preventDefault();
    if (!recipeServiceId || !recipeProductId) return;
    const nextConsumables = mergeConsumables([...recipeConsumables, { productId: recipeProductId, quantity: recipeQty }]);
    void runMutation(() => actions.updateServiceConsumables(recipeServiceId, nextConsumables));
  };

  const removeRecipeConsumable = (productId: string) => {
    const nextConsumables = recipeConsumables.filter((item) => item.productId !== productId);
    if (nextConsumables.length === 0) return;
    void runMutation(() => actions.updateServiceConsumables(recipeServiceId, nextConsumables));
  };

  const addProduct = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addProduct({ name: productName, stock: productStock, type: "consumable", unit: "件" }));
    setProductName("");
  };
  type CatalogModuleKey = NonNullable<typeof activeModule>;
  const catalogModules: Array<FeatureModule<CatalogModuleKey>> = [
    { key: "service", title: "新增项目", desc: "服务名称、价格、时长和默认耗材", icon: Sparkles, tone: "violet", meta: "服务目录" },
    { key: "recipe", title: "项目配方", desc: "配置项目消耗的耗材", icon: PackagePlus, tone: "jade", meta: "自动扣库存" },
    { key: "product", title: "新增商品", desc: "新增商品、耗材和初始库存", icon: Boxes, tone: "teal", meta: "库存资料" },
    { key: "serviceList", title: "项目目录", desc: "查看服务项目、价格和时长", icon: ClipboardList, tone: "rose", meta: `${data.services.length} 个` },
    { key: "productList", title: "商品耗材", desc: "查看商品、耗材和库存预警", icon: Boxes, tone: "amber", meta: `${data.products.length} 个` },
    { key: "formulaList", title: "配方总览", desc: "查看项目对应耗材消耗", icon: PackagePlus, tone: "plum", meta: "扣库存规则" },
  ];
  const activeModuleTitle = activeModule ? catalogModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub catalog-module-page">
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
      {!fromManagement && <ModuleOverview modules={catalogModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "项目商品"}
        subtitle="服务项目、商品耗材和库存关联资料"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack catalog-modal-detail">
        {activeModule === "service" && (
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
        </section>
        )}
        {activeModule === "recipe" && (
        <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="项目配方" action="多耗材自动扣库存" />
        <form className="form" onSubmit={addRecipeConsumable}>
          <Select label="服务项目" value={recipeServiceId} onChange={setRecipeServiceId} options={data.services.map(optionOf)} />
          <Select label="耗材" value={recipeProductId} onChange={setRecipeProductId} options={consumableOptions.length ? consumableOptions : [{ value: "", label: "暂无耗材" }]} />
          <label>单次用量<input type="number" min={0.01} step={0.01} value={recipeQty} onChange={(event) => setRecipeQty(Number(event.target.value))} /></label>
          <button className="primary-button" disabled={!recipeServiceId || !recipeProductId}>加入配方</button>
        </form>
        <div className="recipe-list">
          {recipeConsumables.map((item) => (
            <div key={item.productId}>
              <span>{nameOf(data.products, item.productId)} × {item.quantity}</span>
              <button type="button" onClick={() => removeRecipeConsumable(item.productId)} disabled={recipeConsumables.length <= 1}>移除</button>
            </div>
          ))}
          {recipeConsumables.length === 0 && <p className="empty">当前项目未配置耗材配方</p>}
        </div>
        </section>
        )}
        {activeModule === "product" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="新增商品/耗材" action="库存资料" />
        <form className="form" onSubmit={addProduct}>
          <label>名称<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
          <label>初始库存<input type="number" value={productStock} onChange={(event) => setProductStock(Number(event.target.value))} /></label>
          <button className="primary-button">保存商品</button>
        </form>
        </section>
        )}
        {activeModule === "serviceList" && (
        <section className="panel">
        <PanelTitle
          icon={<Sparkles size={18} />}
          title="项目目录"
          action={
            <div className="module-panel-actions">
              <span>{data.services.length} 个服务项目</span>
              <button type="button" onClick={() => setShowServiceCreate((visible) => !visible)}>
                {showServiceCreate ? "收起新增" : "新增项目"}
              </button>
            </div>
          }
        />
          {(showServiceCreate || data.services.length === 0) && (
          <div className="catalog-inline-control">
            <div>
              <strong>新增项目</strong>
              <span>服务名称、价格、时长和默认耗材</span>
            </div>
            <form className="form catalog-inline-form" onSubmit={addService}>
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
          </div>
          )}
          <DataTable
            columns={["项目", "分类", "价格", "时长", "耗材配方", "操作"]}
            rows={data.services.map((item) => [
              item.name,
              item.category,
              money(item.price),
              `${item.duration} 分钟`,
              serviceFormulaSummary(item, data.products),
              <button key={`${item.id}-recipe`} type="button" onClick={() => { setRecipeServiceId(item.id); setActiveModule("recipe"); }}>
                配方
              </button>,
            ])}
          />
        </section>
        )}
        {activeModule === "productList" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="商品耗材" action="库存资料" />
        <DataTable columns={["商品", "类型", "库存", "预警"]} rows={data.products.map((item) => [item.name, item.type === "sale" ? "销售商品" : "服务耗材", `${item.stock}${item.unit}`, `${item.warningStock}${item.unit}`])} />
        </section>
        )}
        {activeModule === "formulaList" && (
        <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="配方总览" action="项目扣库存规则" />
        <DataTable
          columns={["项目", "分类", "耗材配方"]}
          rows={data.services.map((item) => [item.name, item.category, serviceFormulaSummary(item, data.products)])}
        />
        </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

function StaffCommissions({
  data,
  session,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  session: UserSession;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const canManageStaff = hasPermission(session, "staff:manage");
  const staffRows = businessStaffOf(data);
  const staffIds = new Set(staffRows.map((staff) => staff.id));
  const staffRoleOptions = ["店长", "员工", "前台"].map((item) => ({ value: item, label: item }));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("员工");
  const [baseSalary, setBaseSalary] = useState(6500);
  const [commissionRate, setCommissionRate] = useState(0.12);
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingRole, setEditingRole] = useState("员工");
  const [editingBaseSalary, setEditingBaseSalary] = useState(0);
  const [editingCommissionRate, setEditingCommissionRate] = useState(0);
  const [editingStatus, setEditingStatus] = useState<Staff["status"]>("active");
  const [inviteStaffId, setInviteStaffId] = useState(staffRows[0]?.id ?? "");
  const [inviteAccount, setInviteAccount] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("therapist");
  const [inviteValidDays, setInviteValidDays] = useState(7);
  const [lastInviteCode, setLastInviteCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [activeModule, setActiveModule] = useState<"profile" | "invite" | "salary" | "settlements" | "commissions" | undefined>(fromManagement ? "profile" : undefined);
  const editingStaff = staffRows.find((staff) => staff.id === editingStaffId);

  const settleAll = () => {
    void runMutation(actions.settleCommissions);
  };

  const addStaff = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addStaff({ name, phone, role, baseSalary, commissionRate }));
    setName("");
    setPhone("");
  };

  const startEditStaff = (staff: Staff) => {
    setEditingStaffId(staff.id);
    setEditingName(staff.name);
    setEditingPhone(staff.phone);
    setEditingRole(staff.role);
    setEditingBaseSalary(staff.baseSalary ?? 0);
    setEditingCommissionRate(staff.commissionRate ?? 0);
    setEditingStatus(staff.status);
  };

  const cancelEditStaff = () => {
    setEditingStaffId("");
    setEditingName("");
    setEditingPhone("");
    setEditingRole("员工");
    setEditingBaseSalary(0);
    setEditingCommissionRate(0);
    setEditingStatus("active");
  };

  const saveStaffEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingStaffId) return;
    void runMutation(() =>
      actions.updateStaff(editingStaffId, {
        name: editingName,
        phone: editingPhone,
        role: editingRole,
        baseSalary: editingBaseSalary,
        commissionRate: editingCommissionRate,
        status: editingStatus,
      }),
    ).then(cancelEditStaff);
  };

  const createInvite = (event: FormEvent) => {
    event.preventDefault();
    const account = inviteAccount;
    void runMutation(() => actions.createStaffInvite({ staffId: inviteStaffId, account, role: inviteRole, validDays: inviteValidDays }))
      .then((nextData) => {
        const nextInvite = nextData.staffInvites.find((invite) => invite.staffId === inviteStaffId && invite.account === account && invite.status === "待加入");
        setLastInviteCode(nextInvite?.inviteCode ?? "");
        setInviteAccount("");
      });
  };

  const copyLastInviteCode = () => {
    if (!lastInviteCode) return;
    void copyTextToClipboard(lastInviteCode).then((copied) => {
      if (!copied) return;
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1400);
    });
  };

  const activeStaff = staffRows.filter((staff) => staff.status === "active").length;
  const pendingInvites = data.staffInvites.filter((invite) => invite.status === "待加入").length;
  const pendingCommission = data.commissions.filter((item) => staffIds.has(item.staffId) && item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
  const inviteStaffOptions = staffRows
    .filter((staff) => !staff.accountId && !data.authUsers.some((user) => user.staffId === staff.id))
    .map(optionOf);

  useEffect(() => {
    if (!inviteStaffOptions.some((option) => option.value === inviteStaffId)) {
      setInviteStaffId(inviteStaffOptions[0]?.value ?? "");
    }
  }, [inviteStaffId, inviteStaffOptions]);
  const salaryRows = staffRows.map((staff) => {
    const staffCommissions = data.commissions.filter((item) => item.staffId === staff.id && item.status !== "已冲销");
    const pending = staffCommissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
    const settled = staffCommissions.filter((item) => item.status === "已结算").reduce((sum, item) => sum + item.amount, 0);
    const serviceCommission = staffCommissions.filter((item) => item.type === "服务提成").reduce((sum, item) => sum + item.amount, 0);
    const salesCommission = staffCommissions.filter((item) => item.type === "销售提成").reduce((sum, item) => sum + item.amount, 0);
    return {
      staff,
      pending,
      settled,
      serviceCommission,
      salesCommission,
      expected: (staff.baseSalary ?? 0) + pending + settled,
    };
  });
  type StaffModuleKey = NonNullable<typeof activeModule>;
  const staffModules: Array<FeatureModule<StaffModuleKey>> = [
    { key: "profile", title: "员工档案", desc: "建档、岗位、底薪和状态", icon: UsersRound, tone: "violet", meta: `${staffRows.length} 人` },
    { key: "invite", title: "员工邀请码", desc: "创建一次性邀请，员工自行加入", icon: LockKeyhole, tone: "rose", meta: `${pendingInvites} 个待加入` },
    { key: "salary", title: "薪资汇总", desc: "底薪、项目提成和预计薪资", icon: HeartHandshake, tone: "teal", meta: money(pendingCommission) },
    { key: "settlements", title: "结算流水", desc: "批量结算记录和操作人", icon: ClipboardList, tone: "amber", meta: `${data.commissionSettlements.length} 批` },
    { key: "commissions", title: "提成记录", desc: "订单提成、比例和状态", icon: BadgeCent, tone: "violet", meta: `${data.commissions.filter((item) => staffIds.has(item.staffId)).length} 条` },
  ];
  const activeModuleTitle = activeModule ? staffModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub staff-module-page">
      <PageHero
        icon={<BadgeCent size={15} />}
        eyebrow="人员账号"
        title="人员账号"
        desc="管理员工档案、邀请码、岗位权限与基础提成。"
        stats={[
          { label: "在职员工", value: `${activeStaff} 人`, hint: `${staffRows.length} 人档案`, icon: <UsersRound size={18} /> },
          { label: "待加入员工", value: `${pendingInvites} 个`, hint: "邀请未完成", icon: <LockKeyhole size={18} /> },
          { label: "待结提成", value: money(pendingCommission), hint: "财务待处理", icon: <BadgeCent size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={staffModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "人员账号"}
        subtitle="员工档案、提成结算和账号信息"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack staff-modal-detail">
        {(activeModule === "profile" || activeModule === "invite") && (
        <section className="panel">
        <PanelTitle
          icon={activeModule === "invite" ? <LockKeyhole size={18} /> : <BadgeCent size={18} />}
          title={activeModule === "invite" ? "邀请员工" : "员工档案"}
          action={activeModule === "invite" ? "一次性员工邀请" : canManageStaff ? "先建档，再邀请加入" : "个人视图"}
        />
        {canManageStaff && activeModule === "profile" ? (
          <>
            <form className="form" onSubmit={addStaff}>
              <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
              <Select label="岗位" value={role} onChange={setRole} options={staffRoleOptions} />
              <label>底薪<input type="number" value={baseSalary} onChange={(event) => setBaseSalary(Number(event.target.value))} /></label>
              <label>提成比例<input type="number" step="0.01" value={commissionRate} onChange={(event) => setCommissionRate(Number(event.target.value))} /></label>
              <button className="primary-button">保存员工档案</button>
            </form>
          </>
        ) : canManageStaff && activeModule === "invite" ? (
          <>
            <form className="form" onSubmit={createInvite}>
              <Select label="员工" value={inviteStaffId} onChange={setInviteStaffId} options={inviteStaffOptions} />
              <label>员工手机号/账号<input value={inviteAccount} onChange={(event) => setInviteAccount(event.target.value)} placeholder="员工加入门店后用于登录" /></label>
              <Select
                label="账号角色"
                value={inviteRole}
                onChange={(value) => setInviteRole(value as UserRole)}
                options={[
                  { value: "manager", label: "店长" },
                  { value: "frontdesk", label: "前台" },
                  { value: "therapist", label: "员工" },
                ]}
              />
              <label>有效期（天）<input type="number" min={1} value={inviteValidDays} onChange={(event) => setInviteValidDays(Number(event.target.value))} /></label>
              <button className="primary-button" disabled={!inviteStaffId}>创建一次性邀请</button>
            </form>
            {lastInviteCode && (
              <div className="invite-result-card">
                <span>员工一次性邀请码</span>
                <strong>{lastInviteCode}</strong>
                <small>把这个邀请码发给员工，员工在登录页选择“加入门店”，填写邀请码、姓名和密码后开通账号。</small>
                <button type="button" onClick={copyLastInviteCode}>{inviteCopied ? "已复制" : "复制邀请码"}</button>
              </div>
            )}
          </>
        ) : (
          <div className="settings-card compact">
            <strong>{session.user.name}</strong>
            <span>角色：{displayRoleName(session.user)}</span>
            <span>账号：{session.user.account}</span>
          </div>
        )}
        </section>
        )}
        {activeModule === "profile" && (
        <section className="panel">
        <PanelTitle icon={<UsersRound size={18} />} title="员工档案" action={`${staffRows.length} 人`} />
        {canManageStaff && editingStaff && (
          <form className="staff-edit-form" onSubmit={saveStaffEdit}>
            <div className="staff-edit-head">
              <strong>编辑员工档案</strong>
              <span>{editingStaff.name} · {data.authUsers.find((user) => user.staffId === editingStaff.id)?.account ?? "未开通账号"}</span>
            </div>
            <label>姓名<input value={editingName} onChange={(event) => setEditingName(event.target.value)} required /></label>
            <label>手机号<input value={editingPhone} onChange={(event) => setEditingPhone(event.target.value)} required /></label>
            <Select label="岗位" value={editingRole} onChange={setEditingRole} options={staffRoleOptions} />
            <label>底薪<input type="number" min={0} value={editingBaseSalary} onChange={(event) => setEditingBaseSalary(Number(event.target.value))} /></label>
            <label>提成比例<input type="number" min={0} step="0.01" value={editingCommissionRate} onChange={(event) => setEditingCommissionRate(Number(event.target.value))} /></label>
            <Select
              label="状态"
              value={editingStatus}
              onChange={(value) => setEditingStatus(value as Staff["status"])}
              options={[
                { value: "active", label: "在职" },
                { value: "inactive", label: "停用" },
              ]}
            />
            <div className="staff-edit-actions">
              <button className="primary-button" type="submit">保存修改</button>
              <button type="button" onClick={cancelEditStaff}>取消</button>
            </div>
          </form>
        )}
        <DataTable
          columns={["员工", "岗位", "手机号", "状态", "账号", "底薪", "提成比例", "操作"]}
          rows={staffRows.map((staff) => [
            staff.name,
            displayStaffRole(staff.role),
            staff.phone,
            <Badge key={`${staff.id}-status`} text={staff.status === "active" ? "在职" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />,
            data.authUsers.find((user) => user.staffId === staff.id)?.account ?? "未开通",
            money(staff.baseSalary ?? 0),
            `${Math.round((staff.commissionRate ?? 0) * 100)}%`,
            canManageStaff ? (
              <div className="row-actions" key={`${staff.id}-actions`}>
                <button type="button" onClick={() => startEditStaff(staff)}>编辑</button>
                <button
                  type="button"
                  onClick={() => void runMutation(() => actions.updateStaff(staff.id, { status: staff.status === "active" ? "inactive" : "active" }))}
                >
                  {staff.status === "active" ? "停用" : "启用"}
                </button>
              </div>
            ) : (
              "仅查看"
            ),
          ])}
        />
        </section>
        )}
        {activeModule === "salary" && (
        <section className="panel">
        <PanelTitle icon={<HeartHandshake size={18} />} title="薪资汇总" action="底薪 + 提成" />
        <DataTable
          columns={["员工", "岗位", "底薪", "项目提成", "商品提成", "待结提成", "已结提成", "预计薪资"]}
          rows={salaryRows.map((row) => [
            row.staff.name,
            displayStaffRole(row.staff.role),
            money(row.staff.baseSalary ?? 0),
            money(row.serviceCommission),
            money(row.salesCommission),
            money(row.pending),
            money(row.settled),
            money(row.expected),
          ])}
        />
        </section>
        )}
        {activeModule === "invite" && (
        <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title="邀请记录" action={`${data.staffInvites.length} 条`} />
        <DataTable
          columns={["员工", "账号", "角色", "状态", "邀请码", "有效期", "加入时间", "操作"]}
          rows={data.staffInvites.map((invite) => [
            nameOf(data.staff, invite.staffId),
            invite.account,
            displayUserRole(invite.role),
            <Badge key={`${invite.id}-status`} text={invite.status === "待加入" && invite.expiresAt && +new Date(invite.expiresAt) <= Date.now() ? "已过期" : invite.status} />,
            invite.inviteCode,
            invite.expiresAt ? shortDate(invite.expiresAt) : "未设置",
            invite.joinedAt ? shortDate(invite.joinedAt) : "-",
            canManageStaff && invite.status === "待加入" ? (
              <button key={`${invite.id}-revoke`} onClick={() => void runMutation(() => actions.revokeStaffInvite(invite.id))}>作废</button>
            ) : (
              invite.revokedAt ? shortDate(invite.revokedAt) : "-"
            ),
          ])}
        />
        </section>
        )}
        {activeModule === "settlements" && (
        <section className="panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="结算流水" action={`${data.commissionSettlements.length} 批`} />
        <DataTable
          columns={["类型", "金额", "笔数", "操作人", "时间"]}
          rows={data.commissionSettlements.map((item) => [
            item.type,
            money(item.amount),
            `${item.count} 笔`,
            nameOf(data.authUsers, item.createdBy),
            shortDate(item.createdAt),
          ])}
        />
        </section>
        )}
        {activeModule === "commissions" && (
        <section className="panel">
        <PanelTitle
          icon={<BadgeCent size={18} />}
          title="提成记录"
          action={hasPermission(session, "commissions:settle") ? <button onClick={settleAll}>全部结算</button> : "仅查看"}
        />
        <DataTable
          columns={["员工", "类型", "订单", "计算基数", "比例", "提成", "状态", "结算批次", "时间"]}
          rows={data.commissions.filter((item) => staffIds.has(item.staffId)).map((item) => [
            nameOf(data.staff, item.staffId),
            item.type,
            data.orders.find((order) => order.id === item.orderId)?.orderNo ?? item.orderId,
            money(item.baseAmount),
            `${Math.round((item.rate ?? 0) * 100)}%`,
            money(item.amount),
            <Badge key={item.id} text={item.status} />,
            item.settlementId ?? "-",
            shortDate(item.createdAt),
          ])}
        />
        </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

function Inventory({
  data,
  actions,
  runMutation,
  fromManagement = false,
  initialModule,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  initialModule?: InventoryModuleKey;
  onReturnManagement?: () => void;
}) {
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
  const [newInventoryProductName, setNewInventoryProductName] = useState("");
  const [newInventoryProductCategory, setNewInventoryProductCategory] = useState("面护类");
  const [newInventoryProductSubcategory, setNewInventoryProductSubcategory] = useState("膏霜");
  const [newInventoryProductUnit, setNewInventoryProductUnit] = useState("件");
  const [newInventoryProductStock, setNewInventoryProductStock] = useState("");
  const [newInventoryWarningStock, setNewInventoryWarningStock] = useState("5");
  const [newInventoryShelfLifeMonths, setNewInventoryShelfLifeMonths] = useState("3");
  const [newInventoryExpiryAt, setNewInventoryExpiryAt] = useState(addMonthsInputValue(3));
  const [stockExpiryAt, setStockExpiryAt] = useState(addMonthsInputValue(data.products[0]?.shelfLifeMonths ?? 24));
  const [purchaseExpiryAt, setPurchaseExpiryAt] = useState(addMonthsInputValue(data.products[0]?.shelfLifeMonths ?? 24));
  const [activeModule, setActiveModule] = useState<InventoryModuleKey | undefined>(fromManagement ? initialModule ?? "stockIn" : undefined);
  const newInventorySubcategoryOptions = INVENTORY_CATEGORY_PRESETS[newInventoryProductCategory] ?? [];

  const defaultExpiryForProduct = (nextProductId: string) => {
    const product = data.products.find((item) => item.id === nextProductId);
    return addMonthsInputValue(product?.shelfLifeMonths ?? 24);
  };

  const changeStock = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.adjustInventory({ productId, type, quantity, expiryAt: type === "入库" ? stockExpiryAt : undefined }));
  };

  const stockInExistingProduct = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.adjustInventory({ productId, type: "入库", quantity, expiryAt: stockExpiryAt || undefined }));
  };

  const addInventoryProduct = (event: FormEvent) => {
    event.preventDefault();
    const stock = numberFromInput(newInventoryProductStock, 0);
    const warningStock = numberFromInput(newInventoryWarningStock, 0);
    const shelfLifeMonths = optionalNumberFromInput(newInventoryShelfLifeMonths);
    void runMutation(() =>
      actions.addProduct({
        name: newInventoryProductName,
        stock,
        type: "consumable",
        category: newInventoryProductCategory.trim() || "面护类",
        subcategory: newInventoryProductSubcategory.trim(),
        unit: newInventoryProductUnit,
        warningStock,
        shelfLifeMonths,
        expiryAt: newInventoryExpiryAt || undefined,
      }),
    );
    setNewInventoryProductName("");
    setNewInventoryProductCategory("面护类");
    setNewInventoryProductSubcategory("膏霜");
    setNewInventoryProductUnit("件");
    setNewInventoryProductStock("");
    setNewInventoryWarningStock("5");
    setNewInventoryShelfLifeMonths("3");
    setNewInventoryExpiryAt(addMonthsInputValue(3));
  };

  const addSupplier = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addSupplier({ name: supplierName, phone: supplierPhone, contact: "采购联系人" }));
  };

  const receivePurchase = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.receivePurchaseOrder({ supplierId, productId: purchaseProductId, quantity: purchaseQuantity, unitCost, expiryAt: purchaseExpiryAt || undefined }));
  };

  const createStocktake = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createStocktake({ productId: stocktakeProductId, actualStock, reason: "门店盘点" }));
  };

  const lowStockItems = data.products.filter((item) => item.stock <= item.warningStock);
  const lowStock = lowStockItems.length;
  const stockValue = data.products.reduce((sum, item) => sum + item.stock, 0);

  useEffect(() => {
    const options = INVENTORY_CATEGORY_PRESETS[newInventoryProductCategory];
    if (options?.length && !options.includes(newInventoryProductSubcategory)) {
      setNewInventoryProductSubcategory(options[0]);
    }
  }, [newInventoryProductCategory, newInventoryProductSubcategory]);

  useEffect(() => {
    if (type === "入库") setStockExpiryAt(defaultExpiryForProduct(productId));
  }, [productId, type]);

  useEffect(() => {
    setPurchaseExpiryAt(defaultExpiryForProduct(purchaseProductId));
  }, [purchaseProductId]);

  useEffect(() => {
    if (fromManagement) setActiveModule(initialModule ?? "stockIn");
  }, [fromManagement, initialModule]);

  const restockLowInventory = () => {
    if (lowStockItems.length === 0) return;
    void runMutation(() => actions.restockLowInventory(supplierId || undefined));
  };
  const inventoryModules: Array<FeatureModule<InventoryModuleKey>> = [
    { key: "stockIn", title: "商品入库", desc: "新增商品和已有商品补货", icon: PackagePlus, tone: "teal", meta: "入库操作" },
    { key: "list", title: "库存列表", desc: "库存状态、预警和到期查看", icon: Boxes, tone: "rose", meta: `${lowStock} 项低库存` },
    { key: "adjust", title: "库存操作", desc: "入库、报损和盘点调整", icon: Boxes, tone: "teal", meta: "流水入口" },
    { key: "supplier", title: "供应商", desc: "维护采购基础资料", icon: Building2, tone: "amber", meta: `${data.suppliers.length} 家` },
    { key: "purchase", title: "采购入库", desc: "供应商采购和入库记录", icon: PackagePlus, tone: "jade", meta: "补货" },
    { key: "stocktake", title: "库存盘点", desc: "账实差异和盘点记录", icon: ClipboardList, tone: "violet", meta: `${data.stocktakes.length} 条` },
    { key: "logs", title: "库存流水", desc: "出入库、采购和盘点历史", icon: ClipboardList, tone: "plum", meta: `${data.inventoryLogs.length} 条` },
  ];
  const activeModuleTitle = activeModule ? inventoryModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub inventory-module-page">
      <PageHero
        icon={<Boxes size={15} />}
        eyebrow="库存管理"
        title="库存管理"
        desc="管理商品库、采购入库、库存流水和盘点差异。"
        stats={[
          { label: "库存品项", value: `${data.products.length} 个`, hint: `合计库存 ${stockValue}`, icon: <Boxes size={18} /> },
          { label: "低库存", value: `${lowStock} 项`, hint: "低于预警值 - 已增强提醒", icon: <PackagePlus size={18} /> },
          { label: "供应商", value: `${data.suppliers.length} 家`, hint: "采购基础资料", icon: <Building2 size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={inventoryModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "库存管理"}
        subtitle="库存预警、出入库流水和采购记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack inventory-modal-detail">
        {activeModule === "adjust" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="库存操作" action="入库/报损/盘点" />
        <form className="form" onSubmit={changeStock}>
          <Select label="物品" value={productId} onChange={setProductId} options={data.products.map(optionOf)} />
          <Select label="操作类型" value={type} onChange={(value) => setType(value as InventoryLog["type"])} options={["入库", "报损", "盘点调整"].map((item) => ({ value: item, label: item }))} />
          <label>数量<input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          {type === "入库" && <label>到期日期<input type="date" value={stockExpiryAt} onChange={(event) => setStockExpiryAt(event.target.value)} /></label>}
          <button className="primary-button">保存库存流水</button>
        </form>
        </section>
        )}
        {activeModule === "supplier" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="供应商" action="采购基础资料" />
        <form className="form" onSubmit={addSupplier}>
          <label>供应商名称<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
          <label>联系电话<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} /></label>
          <button className="primary-button">新增供应商</button>
        </form>
        </section>
        )}
        {activeModule === "purchase" && (
        <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="采购入库" action="生成采购单" />
        <form className="form" onSubmit={receivePurchase}>
          <Select label="供应商" value={supplierId} onChange={setSupplierId} options={data.suppliers.map(optionOf)} />
          <Select label="物品" value={purchaseProductId} onChange={(value) => { setPurchaseProductId(value); setPurchaseExpiryAt(defaultExpiryForProduct(value)); }} options={data.products.map(optionOf)} />
          <label>入库数量<input type="number" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(Number(event.target.value))} /></label>
          <label>采购单价<input type="number" value={unitCost} onChange={(event) => setUnitCost(Number(event.target.value))} /></label>
          <label>到期日期<input type="date" value={purchaseExpiryAt} onChange={(event) => setPurchaseExpiryAt(event.target.value)} /></label>
          <button className="primary-button">确认入库</button>
        </form>
        </section>
        )}
                {activeModule === "stocktake" && (
                <section className="panel">
                <PanelTitle icon={<ClipboardList size={18} />} title="库存盘点" action="调整账实差异" />
                <form className="form" onSubmit={createStocktake}>
                  <Select label="物品" value={stocktakeProductId} onChange={setStocktakeProductId} options={data.products.map(optionOf)} />
          <label>实盘库存<input type="number" value={actualStock} onChange={(event) => setActualStock(Number(event.target.value))} /></label>
          <button className="primary-button">提交盘点</button>
                </form>
                </section>
                )}
                {activeModule === "stockIn" && (
                <section className="panel">
                <PanelTitle icon={<PackagePlus size={18} />} title="商品入库" action="新增商品 / 入库补货" />
                <div className="catalog-inline-control inventory-inline-control">
                  <div>
                    <strong>新增商品</strong>
                    <span>录入大类、小类、单位、初始库存、预警和保质期</span>
                  </div>
                  <form className="form catalog-inline-form inventory-product-form" onSubmit={addInventoryProduct}>
                    <label>物品名称<input value={newInventoryProductName} onChange={(event) => setNewInventoryProductName(event.target.value)} required /></label>
                    <Select
                      label="大类"
                      value={newInventoryProductCategory}
                      onChange={(value) => {
                        setNewInventoryProductCategory(value);
                        setNewInventoryProductSubcategory(INVENTORY_CATEGORY_PRESETS[value]?.[0] ?? "");
                      }}
                      options={inventoryCategoryOptions}
                    />
                    <Select
                      label="小类"
                      value={newInventoryProductSubcategory}
                      onChange={setNewInventoryProductSubcategory}
                      options={newInventorySubcategoryOptions.map((subcategory) => ({ value: subcategory, label: subcategory }))}
                    />
                    <label>单位<input value={newInventoryProductUnit} onChange={(event) => setNewInventoryProductUnit(event.target.value)} required /></label>
                    <label>初始库存<input type="number" min={0} value={newInventoryProductStock} onChange={(event) => setNewInventoryProductStock(event.target.value)} /></label>
                    <label>预警库存<input type="number" min={0} value={newInventoryWarningStock} onChange={(event) => setNewInventoryWarningStock(event.target.value)} /></label>
                    <label>保质期(月)<input type="number" min={0} value={newInventoryShelfLifeMonths} onChange={(event) => {
                      const nextValue = event.target.value;
                      setNewInventoryShelfLifeMonths(nextValue);
                      const months = optionalNumberFromInput(nextValue);
                      setNewInventoryExpiryAt(months === undefined ? "" : addMonthsInputValue(months));
                    }} /></label>
                    <label>首批到期<input type="date" value={newInventoryExpiryAt} onChange={(event) => setNewInventoryExpiryAt(event.target.value)} /></label>
                    <div className="form-submit-row">
                      <button className="primary-button">保存商品</button>
                    </div>
                  </form>
                </div>
                {data.products.length > 0 && (
                  <div className="catalog-inline-control inventory-inline-control">
                    <div>
                      <strong>已有商品入库</strong>
                      <span>选择库存中的商品，记录补货数量和本批到期日期</span>
                    </div>
                    <form className="form catalog-inline-form" onSubmit={stockInExistingProduct}>
                      <Select label="已有商品" value={productId} onChange={(value) => { setProductId(value); setStockExpiryAt(defaultExpiryForProduct(value)); }} options={data.products.map(optionOf)} />
                      <label>入库数量<input type="number" min={0.01} step={0.01} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
                      <label>到期日期<input type="date" value={stockExpiryAt} onChange={(event) => setStockExpiryAt(event.target.value)} /></label>
                      <div className="form-submit-row">
                        <button className="primary-button">确认入库</button>
                      </div>
                    </form>
                  </div>
                )}
                {lowStock > 0 && (
                  <div className="inventory-warning-row">
                    <strong>库存预警已触发</strong>：{lowStock} 个商品低于安全库存。
                    <button type="button" onClick={restockLowInventory}>一键补货入库</button>
                  </div>
                )}
                </section>
                )}
                {activeModule === "list" && (
                <section className="panel">
                <PanelTitle
                  icon={<Boxes size={18} />}
                  title="库存列表"
                  action="库存状态总览"
                />
                {lowStock > 0 && (
                  <div className="inventory-warning-row">
                    <strong>库存预警已触发</strong>：{lowStock} 个商品低于安全库存。
                  </div>
                )}
                <DataTable
                  columns={["名称", "大类", "小类", "库存", "预警", "到期", "状态"]}
                  rows={data.products.map((item) => {
                    const expiryStatus = productExpiryStatus(item);
                    const stockStatus = item.stock <= item.warningStock ? { text: "需补货", tone: "warn" as const } : undefined;
                    return [
              item.name,
              item.category ?? "面护类",
              item.subcategory ?? "-",
              `${item.stock}${item.unit}`,
              `${item.warningStock}${item.unit}`,
              productExpiryText(item),
                      <div key={`${item.id}-status`} className="inventory-status-stack">
                        {expiryStatus && <Badge text={expiryStatus.text} tone={expiryStatus.tone} />}
                        {stockStatus && <Badge text={stockStatus.text} tone={stockStatus.tone} />}
                        {!expiryStatus && !stockStatus && <Badge text="正常" tone="ok" />}
                      </div>,
                    ];
                  })}
                />
        </section>
        )}
        {activeModule === "logs" && (
        <section className="panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="库存流水" action="自动记录" />
        <DataTable columns={["商品", "类型", "变动", "结余", "备注", "到期", "时间"]} rows={data.inventoryLogs.map((log) => [nameOf(data.products, log.productId), log.type, log.delta, log.stockAfter, log.note, log.expiryAt ? shortDate(log.expiryAt) : "-", shortDate(log.createdAt)])} />
        <div className="divider" />
        <PanelTitle icon={<PackagePlus size={18} />} title="采购与盘点记录" action="P1 门店进销存" />
        <div className="split-list">
          <DataTable
            columns={["供应商", "商品", "数量", "单价", "到期", "时间"]}
            rows={data.purchaseOrders.map((order) => [
              nameOf(data.suppliers, order.supplierId),
              nameOf(data.products, order.productId),
              order.quantity,
              money(order.unitCost),
              order.expiryAt ? shortDate(order.expiryAt) : "-",
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
        )}
      </div>
      </Modal>
    </div>
  );
}

function Reports({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeModule, setActiveModule] = useState<"summary" | "payments" | "daily" | "staff" | "members" | "services" | "trend" | undefined>(fromManagement ? "summary" : undefined);
  const summary = reportSummary(data);
  const exportCsv = (filename: string, columns: string[], rows: Array<Array<string | number>>) => {
    const csv = [
      columns.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  const payMethods = ["微信", "支付宝", "现金", "银行卡", "会员卡"].map((method) => ({
    method,
    amount: data.orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + order.paidAmount, 0),
  }));

  // 员工业绩排行 (B feature)
  const staffPerformance = businessStaffOf(data)
    .map((staff) => {
      const staffOrders = data.orders.filter((o) => o.staffId === staff.id);
      const revenue = staffOrders.reduce((sum, o) => sum + o.paidAmount, 0);
      const commissions = data.commissions.filter((c) => c.staffId === staff.id).reduce((sum, c) => sum + (c.amount || 0), 0);
      return { staff, revenue, commissions, orderCount: staffOrders.length };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // 会员分析 (B feature)
  const totalCardBalance = data.memberCards.reduce((sum, card) => sum + (card.balance || 0), 0);
  const activeMembers = data.memberCards.filter((c) => c.status === "正常").length;
  const newCustomersThisMonth = data.customers.filter((c) => {
    const created = new Date(c.lastVisit || Date.now());
    const now = new Date();
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  // 额外：Top 服务项目排行 (B 深化)
  const serviceRevenue = data.services.map(service => {
    const revenue = data.orders
      .filter(o => o.serviceId === service.id)
      .reduce((sum, o) => sum + o.paidAmount, 0);
    return { name: service.name, revenue };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const dailyTrend = Array.from({ length: 14 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    const dayOrders = data.orders.filter((order) => order.createdAt.slice(0, 10) === key && order.status !== "已退款");
    const dayRefunds = data.refunds.filter((refund) => refund.createdAt.slice(0, 10) === key);
    return {
      date: key,
      revenue: dayOrders.reduce((sum, order) => sum + order.paidAmount, 0),
      orders: dayOrders.length,
      refunds: dayRefunds.reduce((sum, refund) => sum + refund.amount, 0),
      appointments: data.appointments.filter((appointment) => appointment.startAt.slice(0, 10) === key).length,
    };
  });
  const exportReportSummary = () => exportCsv("yich-report-summary.csv", ["指标", "结果", "说明"], [
    ["实收现金流", summary.revenue, "扣除退款前的实收订单合计"],
    ["退款金额", summary.refundAmount, "退款记录合计"],
    ["服务订单", summary.serviceCount, "已完成收银订单"],
    ["员工提成", summary.commission, "服务提成合计"],
    ["会员卡余额", summary.cardBalance, "客户未消耗储值"],
    ["低库存项", summary.lowStockCount, "低于预警值"],
  ]);
  const exportTrend = () => exportCsv("yich-report-trend.csv", ["日期", "实收", "订单", "退款", "预约"], dailyTrend.map((item) => [
    item.date,
    item.revenue,
    item.orders,
    item.refunds,
    item.appointments,
  ]));
  type ReportsModuleKey = NonNullable<typeof activeModule>;
  const reportModules: Array<FeatureModule<ReportsModuleKey>> = [
    { key: "summary", title: "经营总览", desc: "客单价、预约转化和库存风险", icon: ChartNoAxesColumnIncreasing, tone: "violet", meta: money(summary.revenue) },
    { key: "trend", title: "经营趋势", desc: "近 14 天实收、订单和预约", icon: ChartNoAxesColumnIncreasing, tone: "teal", meta: `${dailyTrend.length} 天` },
    { key: "payments", title: "收银流水", desc: "支付方式和实收结构", icon: CreditCard, tone: "rose", meta: `${data.orders.length} 单` },
    { key: "daily", title: "财务日结", desc: "营业日锁定和反结记录", icon: ClipboardList, tone: "amber", meta: `${data.dailyCloses.length} 天` },
    { key: "staff", title: "员工业绩", desc: "员工订单、实收和提成排行", icon: BadgeCent, tone: "jade", meta: `${staffPerformance.length} 人` },
    { key: "members", title: "会员资产", desc: "会员卡余额和客户规模", icon: UsersRound, tone: "teal", meta: `${activeMembers} 张` },
    { key: "services", title: "项目排行", desc: "热门项目和项目实收", icon: Sparkles, tone: "plum", meta: `${serviceRevenue.length} 项` },
  ];
  const activeModuleTitle = activeModule ? reportModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub reports-module-page">
      <PageHero
        icon={<ChartNoAxesColumnIncreasing size={15} />}
        eyebrow="报表分析"
        title="报表分析"
        desc="查看实收、退款、会员储值、员工提成与营业日结。"
        stats={[
          { label: "实收现金流", value: money(summary.revenue), hint: `退款 ${money(summary.refundAmount)}`, icon: <CreditCard size={18} /> },
          { label: "项目服务数", value: `${summary.serviceCount} 单`, hint: "已完成收银", icon: <Sparkles size={18} /> },
          { label: "员工提成", value: money(summary.commission), hint: "服务提成合计", icon: <BadgeCent size={18} /> },
          { label: "会员资产", value: `${activeMembers} 张`, hint: `余额 ${money(summary.cardBalance)}`, icon: <UsersRound size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={reportModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "报表分析"}
        subtitle="经营指标、收银流水和财务日结数据"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack reports-modal-detail">
        {activeModule === "payments" && (
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
        )}
        {activeModule === "summary" && (
        <section className="panel">
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营分析" action={<button type="button" onClick={exportReportSummary}>导出 CSV</button>} />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["客单价", money(summary.averageOrderValue), "实收 / 订单数"],
            ["客户数", `${data.customers.length} 人`, "客户资产规模"],
            ["预约转化", `${data.orders.length}/${data.appointments.length}`, "已收银订单 / 预约"],
            ["低库存项", `${summary.lowStockCount} 项`, "低于预警值"],
          ]}
        />
        <div className="divider" />
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营趋势" action={<button type="button" onClick={exportTrend}>导出趋势 CSV</button>} />
        <DataTable
          columns={["日期", "实收", "订单", "退款", "预约"]}
          rows={dailyTrend.map((item) => [
            item.date,
            money(item.revenue),
            `${item.orders} 单`,
            money(item.refunds),
            `${item.appointments} 单`,
          ])}
        />
        </section>
        )}
        {activeModule === "trend" && (
        <section className="panel">
          <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营趋势" action={<button type="button" onClick={exportTrend}>导出 CSV</button>} />
          <DataTable
            columns={["日期", "实收", "订单", "退款", "预约"]}
            rows={dailyTrend.map((item) => [
              item.date,
              money(item.revenue),
              `${item.orders} 单`,
              money(item.refunds),
              `${item.appointments} 单`,
            ])}
          />
        </section>
        )}
        {activeModule === "daily" && (
        <section className="panel">
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
        )}

        {/* 员工业绩排行 (B) */}
        {activeModule === "staff" && (
        <section className="panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="员工业绩排行" action="按实收排序" />
          <DataTable
            columns={["员工", "角色", "订单数", "实收业绩", "提成合计"]}
            rows={staffPerformance.map((item) => [
              item.staff.name,
              displayStaffRole(item.staff.role),
              item.orderCount,
              money(item.revenue),
              money(item.commissions),
            ])}
          />
        </section>
        )}

        {/* 会员分析 (B) */}
        {activeModule === "members" && (
        <section className="panel">
          <PanelTitle icon={<UsersRound size={18} />} title="会员分析" action="客户资产概览" />
          <DataTable
            columns={["指标", "数值", "说明"]}
            rows={[
              ["有效会员卡", `${activeMembers} 张`, "当前正常状态"],
              ["会员卡总余额", money(totalCardBalance), "客户未消耗储值"],
              ["本月新增客户", `${newCustomersThisMonth} 人`, "按最近到店时间"],
              ["客户总数", `${data.customers.length} 人`, "累计建档"],
            ]}
          />
        </section>
        )}

        {/* Top 服务项目排行 (B 深化) */}
        {activeModule === "services" && (
        <section className="panel">
          <PanelTitle icon={<Sparkles size={18} />} title="热门项目排行" action="按实收" />
          <DataTable
            columns={["项目", "实收金额"]}
            rows={serviceRevenue.map(s => [s.name, money(s.revenue)])}
          />
        </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

function Approvals({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const [type, setType] = useState<"改价折扣" | "订单退款">("改价折扣");
  const [targetId, setTargetId] = useState("manual");
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("门店例外处理");
  const [activeModule, setActiveModule] = useState<"submit" | "pending" | "refund" | "passed" | "rejected" | "all" | undefined>(fromManagement ? "pending" : undefined);

  const createApproval = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createApproval({ type, targetId, amount, reason }));
  };

  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const passedApprovals = data.approvalRequests.filter((item) => item.status === "已通过").length;
  const rejectedApprovals = data.approvalRequests.filter((item) => item.status === "已拒绝").length;
  const approvalRows = data.approvalRequests.filter((approval) => {
    if (activeModule === "pending") return approval.status === "待审批";
    if (activeModule === "refund") return approval.type === "订单退款";
    if (activeModule === "passed") return approval.status === "已通过";
    if (activeModule === "rejected") return approval.status === "已拒绝";
    return true;
  });
  const refundApprovals = data.approvalRequests.filter((item) => item.type === "订单退款").length;
  type ApprovalModuleKey = NonNullable<typeof activeModule>;
  const approvalModules: Array<FeatureModule<ApprovalModuleKey>> = [
    { key: "submit", title: "提交审批", desc: "改价、退款和门店例外处理", icon: ShieldCheck, tone: "violet", meta: "申请入口" },
    { key: "pending", title: "待审批", desc: "需要处理的风险单据", icon: ClipboardList, tone: "rose", meta: `${pendingApprovals} 单` },
    { key: "refund", title: "退款审批", desc: "订单退款申请和处理记录", icon: RefreshCw, tone: "jade", meta: `${refundApprovals} 单` },
    { key: "passed", title: "已通过", desc: "已批准可用于业务", icon: ShieldCheck, tone: "teal", meta: `${passedApprovals} 单` },
    { key: "rejected", title: "已拒绝", desc: "已拦截的异常申请", icon: LockKeyhole, tone: "amber", meta: `${rejectedApprovals} 单` },
    { key: "all", title: "全部记录", desc: "查看完整审批流水", icon: ClipboardList, tone: "plum", meta: `${data.approvalRequests.length} 条` },
  ];
  const activeModuleTitle = activeModule ? approvalModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub approvals-module-page">
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
      {!fromManagement && <ModuleOverview modules={approvalModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "审批中心"}
        subtitle="改价退款、待审事项和审批记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack approvals-modal-detail">
        {activeModule === "submit" && (
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
        )}
        {(activeModule === "pending" || activeModule === "refund" || activeModule === "passed" || activeModule === "rejected" || activeModule === "all") && (
        <section className="panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="审批列表" action={`${approvalRows.length} 条`} />
        <DataTable
          columns={["类型", "对象", "金额", "原因", "申请人", "状态", "时间", "操作"]}
          rows={approvalRows.map((approval) => [
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
        )}
      </div>
      </Modal>
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

function OperationLogs({ data, session }: { data: AppData; session: UserSession }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const logs = [...(data.operationLogs ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((log) => {
      const matchesSearch =
        !searchTerm ||
        log.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.action.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesAction = !actionFilter || log.action === actionFilter;
      return matchesSearch && matchesAction;
    });

  const uniqueActions = Array.from(new Set((data.operationLogs ?? []).map((l) => l.action)));

  const exportLogs = () => {
    const csv = [
      ["时间", "操作人", "动作", "对象类型", "摘要"].join(","),
      ...logs.map((log) =>
        [
          log.createdAt,
          nameOf(data.staff, data.authUsers.find((u) => u.id === log.userId)?.staffId ?? "") || "系统",
          log.action,
          log.targetType,
          `"${log.summary.replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `操作日志_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="page-stack">
      <PageHero
        icon={<ClipboardList size={15} />}
        eyebrow="系统记录"
        title="操作日志"
        desc="关键操作记录、业务变更和异常追踪。"
        stats={[
          { label: "总记录数", value: `${data.operationLogs?.length ?? 0} 条`, hint: "已记录操作", icon: <ClipboardList size={18} /> },
        ]}
      />

      <div className="panel">
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="搜索操作内容或动作..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1, minWidth: "240px" }}
          />
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">所有动作</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <button onClick={exportLogs}>导出 CSV</button>
        </div>

        {logs.length === 0 ? (
          <p className="empty">暂无操作记录</p>
        ) : (
          <DataTable
            columns={["时间", "操作人", "动作", "对象类型", "摘要"]}
            rows={logs.slice(0, 100).map((log) => [
              shortDate(log.createdAt),
              nameOf(data.staff, data.authUsers.find((u) => u.id === log.userId)?.staffId ?? "") || "系统",
              log.action,
              log.targetType,
              log.summary,
            ])}
          />
        )}

        {logs.length > 100 && (
          <p style={{ marginTop: "12px", color: "var(--yich-muted)", fontSize: "13px" }}>
            仅显示最近 100 条记录
          </p>
        )}
      </div>
    </div>
  );
}

const AVATAR_COMPRESSION_STEPS = [
  { size: 360, quality: 0.72 },
  { size: 300, quality: 0.64 },
  { size: 240, quality: 0.56 },
  { size: 180, quality: 0.48 },
  { size: 128, quality: 0.42 },
];
const AVATAR_MAX_DATA_URL_LENGTH = 150_000;

function renderAvatarDataUrl(image: HTMLImageElement, maxSize: number, quality: number) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("头像处理失败，请重新选择图片");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function normalizeAvatarSource(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      try {
        for (const step of AVATAR_COMPRESSION_STEPS) {
          const dataUrl = renderAvatarDataUrl(image, step.size, step.quality);
          if (dataUrl.length <= AVATAR_MAX_DATA_URL_LENGTH) {
            resolve(dataUrl);
            return;
          }
        }
        reject(new Error("头像无法自动压缩，请换一张图片后再保存"));
      } catch (caught) {
        reject(caught instanceof Error ? caught : new Error("头像处理失败，请重新选择图片"));
      }
    };

    image.onerror = () => {
      reject(new Error("头像读取失败，请重新选择图片"));
    };

    image.src = source;
  });
}

async function normalizeAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  const imageUrl = URL.createObjectURL(file);
  try {
    return await normalizeAvatarSource(imageUrl);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function dataUrlToFile(dataUrl: string, filename: string) {
  const [meta, base64] = dataUrl.split(",");
  const match = /data:(.*?);base64/.exec(meta);
  const type = match?.[1] ?? "image/jpeg";
  const binary = window.atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type });
}

function isR2AvatarUrl(value: string) {
  return value.startsWith("/api/assets/");
}

function accountAvatarErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : fallback;
  if (/SQLITE_TOOBIG|string or blob too big|413|Payload Too Large|头像文件过大/i.test(message)) {
    return "头像文件过大，请重新上传头像";
  }
  if (message.includes("R2 Bucket") || message.includes("未绑定 R2")) {
    return "头像存储服务未配置，请联系管理员";
  }
  return message;
}

function SettingsView({
  session,
  setView,
  returnView = "dashboard",
  updateProfile,
  uploadAccountAvatar,
  themeMode,
  setThemeMode,
}: {
  session: UserSession;
  setView: (view: ViewKey) => void;
  returnView?: ViewKey;
  updateProfile: (body: { name: string; avatarUrl?: string }) => Promise<{ session: UserSession; data: AppData }>;
  uploadAccountAvatar: (file: File) => Promise<{ avatarUrl: string; key: string; size: number }>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  const displayName = session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;
  const displayRole = displayRoleName(session.user);
  const [activePanel, setActivePanel] = useState<"profile" | "security" | "appearance" | "notice">("profile");
  const [profileName, setProfileName] = useState(displayName);
  const [avatarUrl, setAvatarUrl] = useState(session.user.avatarUrl ?? "");
  const [signature, setSignature] = useState("以诚待人，以礼从商。传递华夏智慧，服务雅士人生。");
  const [copiedWechat, setCopiedWechat] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | undefined>();
  const [avatarProcessing, setAvatarProcessing] = useState(false);

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setSaved(false);
    setProfileError(undefined);
    setAvatarProcessing(true);
    try {
      const compactAvatarUrl = await normalizeAvatarFile(file);
      const uploaded = await uploadAccountAvatar(dataUrlToFile(compactAvatarUrl, "avatar.jpg"));
      setAvatarUrl(uploaded.avatarUrl);
    } catch (caught) {
      setProfileError(accountAvatarErrorMessage(caught, "头像处理失败，请重新选择图片"));
    } finally {
      setAvatarProcessing(false);
    }
  };

  const copyWechat = () => {
    void copyTextToClipboard("yichen_admin").then((copied) => {
      if (!copied) return;
      setCopiedWechat(true);
      window.setTimeout(() => setCopiedWechat(false), 1400);
    });
  };

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    setProfileError(undefined);
    setAvatarProcessing(true);
    void (async () => {
      let nextAvatarUrl = avatarUrl;
      if (nextAvatarUrl && !isR2AvatarUrl(nextAvatarUrl)) {
        const compactAvatarUrl = nextAvatarUrl.startsWith("data:image/") ? nextAvatarUrl : await normalizeAvatarSource(nextAvatarUrl);
        const uploaded = await uploadAccountAvatar(dataUrlToFile(compactAvatarUrl, "avatar.jpg"));
        nextAvatarUrl = uploaded.avatarUrl;
      }
      if (nextAvatarUrl && !isR2AvatarUrl(nextAvatarUrl)) {
        throw new Error("头像存储失败，请重新上传头像");
      }
      await updateProfile({ name: profileName.trim() || displayName, avatarUrl: nextAvatarUrl });
      setAvatarUrl(nextAvatarUrl);
    })()
      .then(() => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1400);
      })
      .catch((caught) => {
        setProfileError(accountAvatarErrorMessage(caught, "账号资料保存失败，请稍后重试"));
      })
      .finally(() => {
        setAvatarProcessing(false);
      });
  };

  const settingTabs = [
    { key: "profile", label: "个人信息", icon: UserRound },
    { key: "security", label: "账户与安全", icon: LockKeyhole },
    { key: "appearance", label: "外观模式", icon: Sparkles },
    { key: "notice", label: "推送通知", icon: Bell },
  ] as const;

  return (
    <div className="settings-profile-page">
      <header className="settings-profile-title">
        <button type="button" aria-label="返回" title="返回" onClick={() => setView(returnView)}>
          <ArrowLeft size={22} />
        </button>
        <h1>系统设置</h1>
      </header>

      <section className="settings-contact-card">
        <div className="settings-contact-copy">
          <MessageCircle size={18} />
          <div>
            <strong>联系管理员</strong>
            <span>系统使用问题 · 账号问题 · 业务问题 都可以加管理员微信咨询</span>
          </div>
        </div>
        <div className="settings-wechat-line">
          <span>微信号</span>
          <strong>yichen_admin</strong>
          <button type="button" onClick={copyWechat}>
            <Copy size={16} />
            {copiedWechat ? "已复制" : "复制"}
          </button>
        </div>
      </section>

      <div className="settings-profile-layout">
        <nav className="settings-profile-nav" aria-label="系统设置分类">
          {settingTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={activePanel === item.key ? "active" : ""}
                onClick={() => setActivePanel(item.key)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <form className="settings-profile-card" onSubmit={saveSettings}>
          <label className="settings-avatar-editor">
            <span className="settings-avatar-frame">
              <UserAvatar avatarUrl={avatarUrl} size={52} showImage />
            </span>
            <span>{avatarProcessing ? "头像处理中" : "点击更换头像"}</span>
            <input type="file" accept="image/*" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
          </label>

          {profileError && <div className="settings-profile-message error">{profileError}</div>}
          {saved && !profileError && <div className="settings-profile-message success">头像和资料已保存</div>}

          {activePanel === "profile" && (
            <>
              <div className="settings-field-grid">
                <label>
                  真实姓名
                  <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                </label>
                <label>
                  职位
                  <input value={displayRole} readOnly />
                </label>
              </div>
              <label className="settings-signature-field">
                个性签名
                <textarea value={signature} onChange={(event) => setSignature(event.target.value)} />
              </label>
            </>
          )}

          {activePanel === "security" && (
            <div className="settings-static-panel">
              <strong>账户与安全</strong>
              <span>账号：{session.user.account}</span>
              <span>角色：{displayRole}</span>
            </div>
          )}

          {activePanel === "appearance" && (
            <div className="settings-static-panel">
              <strong>外观模式</strong>
              <div className="settings-mode-toggle">
                <button type="button" className={themeMode === "auto" ? "active" : ""} onClick={() => setThemeMode("auto")}>自动</button>
                <button type="button" className={themeMode === "day" ? "active" : ""} onClick={() => setThemeMode("day")}>日间模式</button>
                <button type="button" className={themeMode === "night" ? "active" : ""} onClick={() => setThemeMode("night")}>夜间模式</button>
              </div>
            </div>
          )}

          {activePanel === "notice" && (
            <div className="settings-static-panel">
              <strong>推送通知</strong>
              <span>预约、审批、库存预警会在顶部通知中显示。</span>
            </div>
          )}

          <div className="settings-save-row">
            <button className="primary-button" type="submit" disabled={avatarProcessing}>
              <Save size={18} />
              {avatarProcessing ? "处理中" : saved ? "已保存" : "保存设置"}
            </button>
          </div>
        </form>
      </div>

      <footer className="settings-version" aria-label="软件版本">
        <strong>祝融｜坤锋 美业门店系统 · v{APP_VERSION}</strong>
        <span>© 2026 祝融｜坤锋 · 构建于 {APP_BUILD_DATE}</span>
      </footer>
    </div>
  );
}

function AdminCenterCard({
  item,
  onClick,
}: {
  item: { title: string; desc: string; metric?: string; icon: typeof LayoutDashboard; tone: ModuleTone };
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button type="button" className={`admin-module-card module-entry-card ${item.tone}`} onClick={onClick}>
      <span className={`admin-module-icon ${item.tone}`}><Icon size={22} /></span>
      <strong>{item.title}</strong>
      <small>{item.desc}</small>
      {item.metric && <em>{item.metric}</em>}
    </button>
  );
}


function appointmentTone(appointment: Appointment): "ok" | "warn" | undefined {
  if (appointment.status === "已到店" || appointment.status === "已完成") return "ok";
  if (appointment.status === "已取消" || appointment.status === "爽约") return "warn";
  return undefined;
}

function serviceConsumablesOf(service?: Service): ServiceConsumable[] {
  const consumables = service?.consumables?.filter((item) => item.productId && item.quantity > 0) ?? [];
  if (consumables.length > 0) return consumables;
  if (service?.consumableProductId && (service.consumableQty ?? 0) > 0) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
  return [];
}

function mergeConsumables(consumables: ServiceConsumable[]) {
  const merged = new Map<string, number>();
  consumables.forEach((item) => {
    if (!item.productId || item.quantity <= 0) return;
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  });
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

function serviceFormulaSummary(service: Service, products: Product[]) {
  const consumables = serviceConsumablesOf(service);
  if (consumables.length === 0) return "未配置";
  return consumables.map((item) => `${nameOf(products, item.productId)} × ${item.quantity}`).join(" / ");
}

function optionOf(item: { id: string; name: string }) {
  return { value: item.id, label: item.name };
}

function numberFromInput(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberFromInput(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
