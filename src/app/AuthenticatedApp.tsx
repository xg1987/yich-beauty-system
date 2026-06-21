import {
  BadgeCent,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  CalendarClock,
  Camera,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  ClipboardList,
  Copy,
  CreditCard,
  Database,
  DoorOpen,
  ArrowLeft,
  BedDouble,
  Eye,
  EyeOff,
  FileBox,
  Gift,
  HeartHandshake,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Minus,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  ReceiptText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Crown,
  Trash2,
  UserRound,
  UserCheck,
  UserCog,
  UsersRound,
  Warehouse,
  X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, lazy, memo, type PointerEvent as ReactPointerEvent, ReactNode, Suspense, type TouchEvent as ReactTouchEvent, useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu } from "../components/business/AccountMenu";
import { BrandIcon } from "../components/business/BrandIcon";
import { UserAvatar } from "../components/business/UserAvatar";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import { StatCard } from "../components/layout/StatCard";
import { ModuleOverview, type FeatureModule, type ModuleTone } from "../components/layout/ModuleOverview";
import { Badge } from "../components/ui/Badge";
import { CheckboxGroup } from "../components/ui/CheckboxGroup";
import { DataTable } from "../components/ui/DataTable";
import { DateTimeInput } from "../components/ui/DateTimeInput";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { memberCardCashIn, platformInviteCodeForPlatformAdmin, reportSummary, storeStaffInviteCodeForStoreUser } from "../domain/business";
import { buildCashierFlowRecords } from "../domain/cashierFlow";
import { appointmentEndAt, appointmentRangeMap, appointmentServiceIds, assignAppointmentRooms, calculateAppointmentRoomUsage, filterAppointmentsByRange, isAppointmentInArrivalConfirmationWindow, appointmentArrivalConfirmationWindow, type AppointmentRange } from "../domain/appointments";
import { canAccessView, hasPermission, parseRolePermissionTemplates, serializeRolePermissionTemplates, type Permission, type UserSession } from "../domain/auth";
import {
  formatProductStockWithServiceUnits,
  formatStockQuantity,
  normalizeProductServiceUnitsPerStockUnit,
  productServiceDeductionLabel,
  productServiceStockDeductible,
  productServiceUnit,
  productServiceUnitsPerStockUnit,
  serviceStockQuantityForProduct,
} from "../domain/products";
import type { AiUsageCapability, AppData, Appointment, AuthUser, CashPayMethod, CustomerSignature, InventoryLog, Order, Product, R2UsageSnapshot, Service, ServiceConsumable, Staff, StaffUnavailableSlot, StoreAiUsagePermissions, StoreOperationalPermissions, SystemConfigKey, UserRole, ViewKey, WorkerUsageSnapshot } from "../domain/types";
import { makeId, money, shortDate, toLocalInputValue, tomorrowAt } from "../domain/utils";
import type { ApiActions, UseApiDataResult } from "../hooks/useApiData";
import { canvasToSignatureDataUrl } from "../lib/signatureImage";
import { writeCachedStoreName } from "../lib/storeNameCache";
import packageJson from "../../package.json";
import { MutationPendingContext, SubmitStatusButton, useMutationPending } from "./mutationPending";

type WorkbarKey = "workbench" | "appointments" | "cashier" | "card" | "customers" | "marketing" | "reports" | "accounts" | "logs" | "admin";
type WorkbarItem = { key: WorkbarKey; label: string; icon: typeof LayoutDashboard; view: ViewKey; options?: NavigateOptions };
type ThemeMode = "day" | "night";
type CardType = "储值卡" | "次数卡" | "套餐卡" | "折扣卡";
type CardCustomerMode = "existing" | "new";
type CustomerFollowUpType = "服务后回访" | "下次护理提醒" | "卡项会员提醒" | "客户关系维护" | "异常处理";
type PosModuleKey = "card" | "product" | "signature" | "single" | "orders";
type CheckoutCartItem = { productId: string; quantity: number };
type InventoryModuleKey = "stockIn" | "loss" | "adjust" | "supplier" | "purchase" | "stocktake" | "list" | "batches" | "logs";
type CatalogModuleKey = "service" | "recipe" | "product" | "serviceList" | "productList" | "formulaList";
type NavigateOptions = { fromAdmin?: boolean; posModule?: PosModuleKey; appointmentId?: string; posCustomerId?: string; posSignatureId?: string; inventoryModule?: InventoryModuleKey; catalogModule?: CatalogModuleKey };
type NavigateToView = (view: ViewKey, options?: NavigateOptions) => void;
type AiProviderKey = "openai" | "deepseek" | "seedance" | "kling" | "hailuo" | "grok";
type AiVideoResolution = "480p" | "720p" | "1080p";
type AiVideoAspectRatio = "9:16" | "1:1" | "16:9";

function cardCustomerDraftError(mode: CardCustomerMode, name: string, phone: string) {
  if (mode !== "new") return "";
  if (!name || !phone) return "请登记客户姓名和手机号";
  return phone.length === 11 ? "" : "客户手机号必须为 11 位数字";
}
type AiTextModelConfig = {
  enabled: boolean;
  provider: Extract<AiProviderKey, "openai" | "deepseek">;
  model: string;
  apiKey: string;
  inputTokenUsdPerMillion: number;
  outputTokenUsdPerMillion: number;
};
const OPENAI_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] as const;
type OpenAiImageModel = typeof OPENAI_IMAGE_MODELS[number];
type AiImageModelConfig = {
  enabled: boolean;
  provider: "openai";
  model: OpenAiImageModel;
  apiKey: string;
  defaultSize: "1024x1024" | "1024x1536" | "1536x1024";
  defaultQuality: "standard" | "high";
  maxImagesPerRequest: number;
  textInputUsdPerMillion: number;
  imageInputUsdPerMillion: number;
  imageOutputUsdPerMillion: number;
};
type AiVideoProviderConfig = {
  provider: Extract<AiProviderKey, "seedance" | "kling" | "hailuo" | "grok">;
  enabled: boolean;
  model: string;
  apiKey: string;
  defaultDurationSeconds: number;
  defaultResolution: AiVideoResolution;
  defaultAspectRatio: AiVideoAspectRatio;
  priceUsdBySpec: Record<string, number>;
};
type AiGenerationConfig = {
  copy: AiTextModelConfig;
  image: AiImageModelConfig;
  video: {
    defaultProvider: AiVideoProviderConfig["provider"];
    providers: AiVideoProviderConfig[];
  };
};
type LoadingGateStage = "connecting" | "slow" | "stalled";
type EditableNumber = number | "";

const inventoryModuleKeys: InventoryModuleKey[] = ["stockIn", "loss", "adjust", "stocktake", "list", "batches", "logs"];

const THEME_KEY = "yich-system-theme";
const APP_VERSION = packageJson.version;
const APP_BUILD_DATE = "2026-06-17";
const DEFAULT_SYSTEM_TITLE = "祝融｜坤锋美业门店系统";
const LEGACY_DEFAULT_APPOINTMENT_ROOM_NAMES = ["护理房 1", "护理房 2", "VIP护理房", "仪器房", "身心护理房", "备用房"];
const LEGACY_DEFAULT_APPOINTMENT_ROOM_NAME_SET = new Set(LEGACY_DEFAULT_APPOINTMENT_ROOM_NAMES);
const DEFAULT_STORED_VALUE_CARD_NAME = "储值卡";
const DEFAULT_PROJECT_CARD_NAME = "面部护理十次卡";
const DEFAULT_DISCOUNT_CARD_NAME = "会员折扣卡";
const normalizeMobilePhoneDraft = (value: string) => value.replace(/\D/g, "").slice(0, 11);
const AI_VIDEO_DURATIONS = [5, 10, 15];
const AI_VIDEO_RESOLUTIONS: AiVideoResolution[] = ["480p", "720p", "1080p"];
export const AI_VIDEO_ASPECT_RATIOS: AiVideoAspectRatio[] = ["9:16", "1:1", "16:9"];
const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-0-fast-260128";
export const AI_PROVIDER_LABELS: Record<AiProviderKey, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  seedance: "Seedance",
  kling: "Kling",
  hailuo: "海螺",
  grok: "Grok Imagine",
};
const AI_USAGE_CAPABILITY_LABELS: Record<AiUsageCapability, string> = {
  copy: "AI 写文案",
  image: "AI 做产品设计图",
  video: "AI 做产品视频",
};
const DEFAULT_STORE_AI_USAGE_PERMISSIONS: StoreAiUsagePermissions = {
  owner: { copy: true, image: true, video: true },
  staff: { copy: true, image: true, video: false },
};
const DEFAULT_STORE_OPERATIONAL_PERMISSIONS: StoreOperationalPermissions = {
  staffCanViewAllAppointments: true,
};
const DEFAULT_AI_GENERATION_CONFIG: AiGenerationConfig = {
  copy: {
    enabled: true,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "",
    inputTokenUsdPerMillion: 0.435,
    outputTokenUsdPerMillion: 0.87,
  },
  image: {
    enabled: true,
    provider: "openai",
    model: "gpt-image-2",
    apiKey: "",
    defaultSize: "1024x1024",
    defaultQuality: "high",
    maxImagesPerRequest: 4,
    textInputUsdPerMillion: 5,
    imageInputUsdPerMillion: 8,
    imageOutputUsdPerMillion: 30,
  },
  video: {
    defaultProvider: "seedance",
    providers: [
      {
        provider: "seedance",
        enabled: true,
        model: DEFAULT_SEEDANCE_MODEL,
        apiKey: "",
        defaultDurationSeconds: 5,
        defaultResolution: "480p",
        defaultAspectRatio: "9:16",
        priceUsdBySpec: {
          "5s:480p": 0.3408,
          "5s:720p": 0.7332,
          "5s:1080p": 1.8279,
          "10s:480p": 0.6816,
          "10s:720p": 1.4665,
          "10s:1080p": 3.6558,
          "15s:480p": 1.0224,
          "15s:720p": 2.1997,
          "15s:1080p": 5.4837,
        },
      },
      {
        provider: "kling",
        enabled: false,
        model: "kling-v3",
        apiKey: "",
        defaultDurationSeconds: 5,
        defaultResolution: "480p",
        defaultAspectRatio: "9:16",
        priceUsdBySpec: {
          "5s:480p": 0,
          "5s:720p": 0.42,
          "5s:1080p": 0.56,
          "10s:480p": 0,
          "10s:720p": 0.84,
          "10s:1080p": 1.12,
          "15s:480p": 0,
          "15s:720p": 1.26,
          "15s:1080p": 1.68,
        },
      },
      {
        provider: "hailuo",
        enabled: false,
        model: "MiniMax-Hailuo-2.3",
        apiKey: "",
        defaultDurationSeconds: 5,
        defaultResolution: "480p",
        defaultAspectRatio: "9:16",
        priceUsdBySpec: {
          "5s:480p": 0.1,
          "5s:720p": 0.28,
          "5s:1080p": 0.49,
          "10s:480p": 0.15,
          "10s:720p": 0.56,
          "10s:1080p": 0,
          "15s:480p": 0,
          "15s:720p": 0,
          "15s:1080p": 0,
        },
      },
      {
        provider: "grok",
        enabled: false,
        model: "grok-imagine-video-1.5",
        apiKey: "",
        defaultDurationSeconds: 5,
        defaultResolution: "480p",
        defaultAspectRatio: "9:16",
        priceUsdBySpec: {
          "5s:480p": 0.4,
          "5s:720p": 0.4,
          "5s:1080p": 0,
          "10s:480p": 0.8,
          "10s:720p": 0.8,
          "10s:1080p": 0,
          "15s:480p": 1.2,
          "15s:720p": 1.2,
          "15s:1080p": 0,
        },
      },
    ],
  },
};
const cashPayMethodOptions = (["微信", "支付宝", "现金", "银行卡"] as CashPayMethod[]).map((item) => ({ value: item, label: item }));
const customerFollowUpTypeOptions = (["服务后回访", "下次护理提醒", "卡项会员提醒", "客户关系维护", "异常处理"] as CustomerFollowUpType[]).map((item) => ({ value: item, label: item }));
const INVENTORY_CATEGORY_PRESETS: Record<string, string[]> = {
  面护类: ["洁面", "膏霜", "面膜", "精华", "精油", "防晒", "软膜", "眼护", "套盒", "口服", "次抛", "小样"],
  养生类: ["泥灸", "私密", "套盒", "膏霜", "身体油", "泡脚汤", "艾灸"],
};
const inventoryLossReasonOptions = ["破损", "过期", "试用", "盘点差异", "其他损耗"];

function parseEditableNumber(value: string): EditableNumber {
  return value === "" ? "" : Number(value);
}

function editableNumberValue(value: EditableNumber) {
  return value === "" ? Number.NaN : value;
}

function editableNumberOrZero(value: EditableNumber) {
  return value === "" || !Number.isFinite(value) ? 0 : value;
}

export function searchInputSync(setValue: (value: string) => void) {
  const sync = (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const pushValue = () => setValue(input.value);
    pushValue();
    queueMicrotask(pushValue);
    window.requestAnimationFrame(pushValue);
  };
  return {
    onInput: sync,
    onChange: sync,
    onCompositionEnd: sync,
    onBlur: sync,
  };
}

type CustomerOptionItem = AppData["customers"][number];

function normalizeCustomerLookupText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function customerDisplayLabel(customer: CustomerOptionItem) {
  return customer.phone ? `${customer.name} · ${customer.phone}` : customer.name;
}

function customerMatchesSearchText(customer: CustomerOptionItem, value: string) {
  const normalized = normalizeCustomerLookupText(value);
  if (!normalized) return true;
  return [customer.name, customer.phone, customerDisplayLabel(customer), `${customer.name}${customer.phone}`]
    .filter(Boolean)
    .some((candidate) => normalizeCustomerLookupText(candidate) === normalized);
}

function findUniqueCustomerBySearchText(customers: CustomerOptionItem[], value: string) {
  const normalized = normalizeCustomerLookupText(value);
  if (!normalized) return undefined;
  const matches = customers.filter((customer) => customerMatchesSearchText(customer, value));
  return matches.length === 1 ? matches[0] : undefined;
}

function nextAppointmentDateTimeRange(durationMinutes = 60) {
  const start = new Date();
  start.setSeconds(0, 0);
  const nextSlotMinute = Math.ceil((start.getMinutes() + 1) / 30) * 30;
  if (nextSlotMinute >= 60) {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  } else {
    start.setMinutes(nextSlotMinute, 0, 0);
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    start: toLocalInputValue(start.toISOString()),
    end: toLocalInputValue(end.toISOString()),
  };
}

function formatBirthdayDraft(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function normalizeBirthdayForSubmit(value: string) {
  const birthday = formatBirthdayDraft(value).trim();
  if (!birthday) return "";
  const match = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  if (date.getTime() > Date.now()) return "";
  return birthday;
}

function inventoryCategoryMap(products: Product[], presets: Record<string, string[]> = INVENTORY_CATEGORY_PRESETS) {
  const map = new Map<string, Set<string>>();
  const addCategory = (category: string) => {
    const name = category.trim();
    if (!name) return undefined;
    if (!map.has(name)) map.set(name, new Set());
    return map.get(name);
  };

  Object.entries(presets).forEach(([category, subcategories]) => {
    const bucket = addCategory(category);
    subcategories.forEach((subcategory) => {
      const name = subcategory.trim();
      if (name) bucket?.add(name);
    });
  });
  products.forEach((product) => {
    const bucket = addCategory(product.category ?? "面护类");
    const subcategory = product.subcategory?.trim();
    if (subcategory) bucket?.add(subcategory);
  });
  return map;
}

function inventoryCategoryNames(products: Product[], presets?: Record<string, string[]>) {
  return Array.from(inventoryCategoryMap(products, presets).keys());
}

function inventorySubcategoryNames(products: Product[], category: string, presets?: Record<string, string[]>) {
  const map = inventoryCategoryMap(products, presets);
  if (category === "全部") {
    return Array.from(new Set(Array.from(map.values()).flatMap((items) => Array.from(items))));
  }
  return Array.from(map.get(category) ?? []);
}

function GlobalMutationStatus() {
  const pending = useMutationPending();
  if (!pending) return null;
  return (
    <div className="global-mutation-status" role="status" aria-live="assertive" aria-busy="true">
      <div className="global-mutation-card">
        <RefreshCw size={16} aria-hidden="true" />
        <strong>正在保存</strong>
      </div>
    </div>
  );
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function downloadCsvFile(filename: string, columns: Array<string | number>, rows: Array<Array<string | number>>) {
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

const HIDDEN_ACCOUNT_LIST_ACCOUNTS = new Set(["admin@yich.local"]);
const VISIBLE_PLATFORM_ADMIN_ACCOUNT = "13827445244";

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
  if (!product.expiryAt) return "未设置";
  return /^\d{4}-\d{2}-\d{2}$/.test(product.expiryAt) ? product.expiryAt.replace(/-/g, "/") : shortDate(product.expiryAt);
}

function productShelfLifeText(product: Product) {
  return product.shelfLifeMonths ? `${product.shelfLifeMonths}个月` : "未设置";
}

function productServicePackageText(product: Product) {
  return productServiceDeductionLabel(product).replace("扣库存 · ", "");
}

function productExpiryDaysText(product: Product) {
  if (!product.expiryAt) return "-";
  const today = new Date(`${dateInputValue()}T00:00:00`).getTime();
  const expiry = new Date(`${product.expiryAt}T00:00:00`).getTime();
  if (Number.isNaN(expiry)) return "-";
  const daysLeft = Math.ceil((expiry - today) / 86400000);
  if (daysLeft < 0) return `已过期${Math.abs(daysLeft)}天`;
  return `${daysLeft}天`;
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
  dashboard: "今日总览",
  appointments: "预约管理",
  pos: "开单收银",
  customers: "客户档案",
  marketing: "营销中心",
  catalog: "项目商品",
  staff: "人员账号",
  inventory: "库存管理",
  reports: "报表分析",
  approvals: "审批中心",
  logs: "操作日志",
  accounts: "账号管理",
  permissions: "权限审批",
  platformConfig: "平台配置",
  aiConfig: "AI 能力配置",
  aiCredits: "AI积分充值",
  aiTest: "AI 智能测试中心",
  aiUsage: "AI费用统计",
  storeCustomerDetails: "分店客户明细",
  usage: "服务器用量监控",
  roomSettings: "房间设置",
  settings: "管理中心",
};

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

export function businessStaffOf(data: AppData) {
  return data.staff.filter(isBusinessStaff);
}

function firstBusinessStaffId(data: AppData) {
  return businessStaffOf(data)[0]?.id ?? "";
}

function activeStaffOf(data: AppData) {
  return data.staff.filter((staff) => staff.status === "active");
}

const WORKBENCH_SCHEDULE_START_HOUR = 8;
const WORKBENCH_SCHEDULE_END_HOUR = 23;
const WORKBENCH_SCHEDULE_TOTAL_MINUTES = (WORKBENCH_SCHEDULE_END_HOUR - WORKBENCH_SCHEDULE_START_HOUR) * 60;
const WORKBENCH_SCHEDULE_HOURS = Array.from(
  { length: WORKBENCH_SCHEDULE_END_HOUR - WORKBENCH_SCHEDULE_START_HOUR + 1 },
  (_, index) => WORKBENCH_SCHEDULE_START_HOUR + index,
);

function firstActiveStaffId(data: AppData) {
  return activeStaffOf(data)[0]?.id ?? "";
}

export function primaryStoreName(data: AppData) {
  return data.storeProfiles[0]?.name?.trim() || "";
}

function normalizedAccount(account: string) {
  return account.trim().toLowerCase();
}

export function isVisibleAccount(user: { account: string }) {
  return !HIDDEN_ACCOUNT_LIST_ACCOUNTS.has(normalizedAccount(user.account));
}

export function isVisiblePlatformAdmin(user: { account: string; role: UserRole }) {
  return normalizedAccount(user.account) === VISIBLE_PLATFORM_ADMIN_ACCOUNT || user.role === "superadmin";
}

export function displayRoleName(user: { account: string; role: UserRole; roleName: string }) {
  if (isVisiblePlatformAdmin(user)) return "系统管理员";
  if (user.role === "owner" || user.role === "manager") return "店长";
  if (user.role === "therapist") return "服务人员";
  return user.roleName === "老板" || user.roleName === "主管" ? "店长" : user.roleName;
}

export function displayStaffRole(role: string) {
  return role === "老板" || role === "主管" ? "店长" : role;
}

function userRoleForStaffRole(role: string): UserRole {
  if (role === "店长" || role === "主管") return "manager";
  if (role === "前台") return "frontdesk";
  if (role === "财务") return "finance";
  return "therapist";
}

export function displayUserRole(role: UserRole) {
  const labels: Record<UserRole, string> = {
    superadmin: "系统管理员",
    owner: "店长",
    manager: "店长",
    frontdesk: "前台",
    therapist: "服务人员",
    finance: "财务",
  };
  return labels[role];
}

export function displayAuthUserStatus(status: AuthUser["status"]) {
  if (status === "active") return "启用";
  if (status === "pending") return "待审核";
  return "停用";
}

export function authUserStatusTone(status: AuthUser["status"]) {
  if (status === "active") return "ok" as const;
  if (status === "pending") return undefined;
  return "warn" as const;
}

export function roomNamesOf(data: AppData) {
  const storeProfile = data.storeProfiles[0];
  const names = Array.from(new Set(storeProfile?.roomNames?.map((roomName) => roomName.trim()).filter(Boolean) ?? []));
  if (storeProfile?.roomNamesConfiguredAt) return names;
  return names.filter((roomName) => !LEGACY_DEFAULT_APPOINTMENT_ROOM_NAME_SET.has(roomName));
}

export function maintenanceRoomNamesOf(data: AppData, roomNames = roomNamesOf(data)) {
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

function shortTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function appointmentTimeRange(data: AppData, appointment: Appointment) {
  return `${shortDate(appointment.startAt)}-${shortTime(appointmentEndAt(appointment, data.services).toISOString())}`;
}

export function appointmentServiceNames(data: AppData, appointment: Pick<Appointment, "serviceId" | "serviceIds">) {
  return appointmentServiceIds(appointment).map((serviceId) => nameOf(data.services, serviceId)).join("、") || "到店确认项目";
}

function appointmentConsumptionNames(data: AppData, appointment: Appointment, order?: Order) {
  if (!order) return appointmentServiceNames(data, appointment);
  const savedName = order.serviceName?.trim();
  if (savedName) return savedName;
  const serviceIds = (order.serviceIds?.length ? order.serviceIds : [order.serviceId]).filter(Boolean);
  return serviceIds.map((serviceId) => nameOf(data.services, serviceId)).join("、") || appointmentServiceNames(data, appointment);
}

function appointmentRangeForDate(startAt: string, ranges: Record<AppointmentRange, { start: Date; end: Date }>): AppointmentRange | undefined {
  const timestamp = +new Date(startAt);
  if (!Number.isFinite(timestamp)) return undefined;
  return (["today", "tomorrow", "week"] as AppointmentRange[]).find((range) =>
    timestamp >= ranges[range].start.getTime() && timestamp <= ranges[range].end.getTime(),
  );
}

function visibleNotificationsForSession(data: AppData, session: UserSession) {
  return (data.notifications ?? [])
    .filter((item) => item.audienceRoles.includes(session.user.role))
    .filter((item) => session.user.role !== "therapist" || !item.staffId || item.staffId === session.user.staffId)
    .filter((item) => canAccessView(session, item.view))
    .filter((item) => !(item.archivedByUserIds ?? []).includes(session.user.id));
}

function findStaffAppointmentConflict(data: AppData, staffId: string, startAt: Date, endAt: Date) {
  return data.appointments.filter(isActiveRoomAppointment).find((appointment) => {
    if (appointment.staffId !== staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(appointment.startAt), appointmentEndAt(appointment, data.services));
  });
}

function findStaffUnavailableConflict(data: AppData, staffId: string, startAt: Date, endAt: Date) {
  return data.staffUnavailableSlots.find((slot) => slot.staffId === staffId && hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt)));
}

function staffAppointmentConflictText(data: AppData, appointment?: Appointment) {
  return appointment
    ? `${nameOf(data.staff, appointment.staffId)} ${appointmentTimeRange(data, appointment)} 已为 ${nameOf(data.customers, appointment.customerId)} 预约 ${appointmentServiceNames(data, appointment)}，房间：${appointment.roomName || "未分配房间"}。请更换服务人员或调整时间。`
    : "";
}

function staffUnavailableConflictText(data: AppData, slot?: StaffUnavailableSlot) {
  return slot
    ? `${nameOf(data.staff, slot.staffId)} ${shortDate(slot.startAt)}-${shortTime(slot.endAt)} 不可预约${slot.reason ? `：${slot.reason}` : ""}。请更换服务人员或调整时间。`
    : "";
}

function isActiveRoomAppointment(appointment: Appointment) {
  return !["已完成", "已取消", "爽约"].includes(appointment.status);
}

export async function copyTextToClipboard(text: string) {
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
  return value === "day" || value === "night";
}

function cloneAiGenerationConfig(config: AiGenerationConfig = DEFAULT_AI_GENERATION_CONFIG): AiGenerationConfig {
  return JSON.parse(JSON.stringify(config)) as AiGenerationConfig;
}

export function videoSpecKey(durationSeconds: number, resolution: AiVideoResolution) {
  return `${durationSeconds}s:${resolution}`;
}

export function boundedPrice(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function normalizeOpenAiImageModel(value: unknown, fallback: OpenAiImageModel): OpenAiImageModel {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  return OPENAI_IMAGE_MODELS.includes(model as OpenAiImageModel) ? model as OpenAiImageModel : fallback;
}

function normalizeSeedanceModel(value: unknown, fallback = DEFAULT_SEEDANCE_MODEL) {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  const normalized = model.toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "seedance-2.0" || normalized === "doubao-seedance-2.0" || normalized === "doubao-seedance-2-0") {
    return "doubao-seedance-2-0-260128";
  }
  if (normalized === "seedance-2.0-fast" || normalized === "doubao-seedance-2.0-fast" || normalized === "doubao-seedance-2-0-fast") {
    return DEFAULT_SEEDANCE_MODEL;
  }
  if (normalized === "seedance-1.5-pro" || normalized === "doubao-seedance-1.5-pro" || normalized === "doubao-seedance-1-5-pro") {
    return "doubao-seedance-1-5-pro-250728";
  }
  return model;
}

function normalizeAiGenerationConfig(input: unknown): AiGenerationConfig {
  const fallback = cloneAiGenerationConfig();
  if (!input || typeof input !== "object") return fallback;
  const record = input as Partial<AiGenerationConfig>;
  const copy = record.copy && typeof record.copy === "object" ? record.copy as Partial<AiTextModelConfig> : {};
  const image = record.image && typeof record.image === "object" ? record.image as Partial<AiImageModelConfig> : {};
  const video = record.video && typeof record.video === "object" ? record.video as Partial<AiGenerationConfig["video"]> : {};
  const inputProviders = Array.isArray(video.providers) ? video.providers : [];
  const providers = fallback.video.providers.map((defaultProvider) => {
    const incoming = inputProviders.find((item) => item && typeof item === "object" && (item as Partial<AiVideoProviderConfig>).provider === defaultProvider.provider) as Partial<AiVideoProviderConfig> | undefined;
    return {
      ...defaultProvider,
      ...incoming,
      enabled: typeof incoming?.enabled === "boolean" ? incoming.enabled : defaultProvider.enabled,
      apiKey: typeof incoming?.apiKey === "string" ? incoming.apiKey : defaultProvider.apiKey,
      model: defaultProvider.provider === "seedance"
        ? normalizeSeedanceModel(incoming?.model, defaultProvider.model)
        : typeof incoming?.model === "string" ? incoming.model : defaultProvider.model,
      defaultDurationSeconds: AI_VIDEO_DURATIONS.includes(Number(incoming?.defaultDurationSeconds)) ? Number(incoming?.defaultDurationSeconds) : defaultProvider.defaultDurationSeconds,
      defaultResolution: AI_VIDEO_RESOLUTIONS.includes(incoming?.defaultResolution as AiVideoResolution) ? incoming?.defaultResolution as AiVideoResolution : defaultProvider.defaultResolution,
      defaultAspectRatio: AI_VIDEO_ASPECT_RATIOS.includes(incoming?.defaultAspectRatio as AiVideoAspectRatio) ? incoming?.defaultAspectRatio as AiVideoAspectRatio : defaultProvider.defaultAspectRatio,
      priceUsdBySpec: Object.fromEntries(
        Object.entries(incoming?.priceUsdBySpec ?? defaultProvider.priceUsdBySpec ?? {}).map(([key, value]) => [key, boundedPrice(value)]),
      ),
    };
  });
  const defaultProvider = providers.some((provider) => provider.provider === video.defaultProvider)
    ? video.defaultProvider as AiVideoProviderConfig["provider"]
    : fallback.video.defaultProvider;
  return {
    copy: {
      ...fallback.copy,
      ...copy,
      enabled: typeof copy.enabled === "boolean" ? copy.enabled : fallback.copy.enabled,
      provider: copy.provider === "openai" || copy.provider === "deepseek" ? copy.provider : fallback.copy.provider,
      apiKey: typeof copy.apiKey === "string" ? copy.apiKey : fallback.copy.apiKey,
      model: typeof copy.model === "string" ? copy.model : fallback.copy.model,
      inputTokenUsdPerMillion: boundedPrice(copy.inputTokenUsdPerMillion),
      outputTokenUsdPerMillion: boundedPrice(copy.outputTokenUsdPerMillion),
    },
    image: {
      ...fallback.image,
      ...image,
      enabled: typeof image.enabled === "boolean" ? image.enabled : fallback.image.enabled,
      apiKey: typeof image.apiKey === "string" ? image.apiKey : fallback.image.apiKey,
      model: normalizeOpenAiImageModel(image.model, fallback.image.model),
      defaultSize: ["1024x1024", "1024x1536", "1536x1024"].includes(image.defaultSize ?? "") ? image.defaultSize as AiImageModelConfig["defaultSize"] : fallback.image.defaultSize,
      defaultQuality: image.defaultQuality === "standard" || image.defaultQuality === "high" ? image.defaultQuality : fallback.image.defaultQuality,
      maxImagesPerRequest: Math.max(1, Math.min(8, Math.trunc(Number(image.maxImagesPerRequest) || fallback.image.maxImagesPerRequest))),
      textInputUsdPerMillion: boundedPrice(image.textInputUsdPerMillion),
      imageInputUsdPerMillion: boundedPrice(image.imageInputUsdPerMillion),
      imageOutputUsdPerMillion: boundedPrice(image.imageOutputUsdPerMillion),
    },
    video: {
      defaultProvider,
      providers,
    },
  };
}

export function aiGenerationConfigFromSystemConfigs(configs?: AppData["systemConfigs"]) {
  const rawValue = configs?.find((item) => item.key === "ai_generation_config")?.value;
  if (!rawValue) return cloneAiGenerationConfig();
  try {
    return normalizeAiGenerationConfig(JSON.parse(rawValue));
  } catch {
    return cloneAiGenerationConfig();
  }
}

export function serializeAiGenerationConfig(config: AiGenerationConfig) {
  return JSON.stringify(normalizeAiGenerationConfig(config));
}

function normalizeStoreAiUsagePermissions(input: unknown): StoreAiUsagePermissions {
  const source = input && typeof input === "object" ? input as Partial<StoreAiUsagePermissions> : {};
  const owner = source.owner && typeof source.owner === "object" ? source.owner as Partial<StoreAiUsagePermissions["owner"]> : {};
  const staff = source.staff && typeof source.staff === "object" ? source.staff as Partial<StoreAiUsagePermissions["staff"]> : {};
  return {
    owner: {
      copy: typeof owner.copy === "boolean" ? owner.copy : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.copy,
      image: typeof owner.image === "boolean" ? owner.image : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.image,
      video: typeof owner.video === "boolean" ? owner.video : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.video,
    },
    staff: {
      copy: typeof staff.copy === "boolean" ? staff.copy : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.copy,
      image: typeof staff.image === "boolean" ? staff.image : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.image,
      video: typeof staff.video === "boolean" ? staff.video : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.video,
    },
  };
}

export function storeAiUsagePermissions(data: AppData) {
  return normalizeStoreAiUsagePermissions(data.storeProfiles[0]?.aiUsagePermissions);
}

function normalizeStoreOperationalPermissions(input: unknown): StoreOperationalPermissions {
  const source = input && typeof input === "object" ? input as Partial<StoreOperationalPermissions> : {};
  return {
    staffCanViewAllAppointments: typeof source.staffCanViewAllAppointments === "boolean"
      ? source.staffCanViewAllAppointments
      : DEFAULT_STORE_OPERATIONAL_PERMISSIONS.staffCanViewAllAppointments,
  };
}

function aiUsagePermissionGroup(role: UserRole): keyof StoreAiUsagePermissions {
  return role === "owner" || role === "manager" ? "owner" : "staff";
}

function aiCapabilityPlatformEnabled(config: AiGenerationConfig, capability: AiUsageCapability) {
  if (capability === "copy") return config.copy.enabled;
  if (capability === "image") return config.image.enabled;
  return config.video.providers.some((provider) => provider.enabled);
}

export function aiCapabilityUsageState(config: AiGenerationConfig, permissions: StoreAiUsagePermissions, role: UserRole, capability: AiUsageCapability) {
  if (!aiCapabilityPlatformEnabled(config, capability)) return { enabled: false, label: "平台未启用" };
  const group = aiUsagePermissionGroup(role);
  if (!permissions[group][capability]) return { enabled: false, label: "未开通" };
  return { enabled: true, label: "可用" };
}

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "今日总览", icon: LayoutDashboard },
  { key: "appointments", label: "预约管理", icon: CalendarDays },
  { key: "pos", label: "开单收银", icon: CreditCard },
  { key: "customers", label: "客户档案", icon: UsersRound },
  { key: "marketing", label: "营销中心", icon: Megaphone },
  { key: "inventory", label: "库存管理", icon: Boxes },
  { key: "reports", label: "报表分析", icon: ChartNoAxesColumnIncreasing },
  { key: "approvals", label: "审批中心", icon: ShieldCheck },
  { key: "logs", label: "操作日志", icon: ClipboardList },
  { key: "settings", label: "系统设置", icon: Settings },
];

const workbarItems: WorkbarItem[] = [
  { key: "workbench", label: "今日", icon: LayoutDashboard, view: "dashboard" },
  { key: "appointments", label: "预约", icon: CalendarDays, view: "appointments" },
  { key: "cashier", label: "收银", icon: CreditCard, view: "pos" },
  { key: "customers", label: "客户", icon: UsersRound, view: "customers" },
  { key: "admin", label: "管理中心", icon: UserRound, view: "settings" },
];

const platformAdminAllowedViews = new Set<ViewKey>(["dashboard", "reports", "accounts", "permissions", "platformConfig", "aiConfig", "aiCredits", "aiTest", "aiUsage", "storeCustomerDetails", "logs", "usage", "settings"]);

const employeeWorkbarItems: WorkbarItem[] = [
  { key: "workbench", label: "工作", icon: LayoutDashboard, view: "dashboard" },
  { key: "appointments", label: "预约", icon: CalendarDays, view: "appointments" },
  { key: "cashier", label: "收银", icon: CreditCard, view: "pos", options: { posModule: "single" } },
  { key: "customers", label: "客户", icon: UsersRound, view: "customers" },
  { key: "marketing", label: "营销", icon: Megaphone, view: "marketing" },
];

const platformWorkbarItems: WorkbarItem[] = [
  { key: "workbench", label: "总览", icon: LayoutDashboard, view: "dashboard" },
  { key: "reports", label: "数据", icon: ChartNoAxesColumnIncreasing, view: "reports" },
  { key: "accounts", label: "账号", icon: UsersRound, view: "accounts" },
  { key: "logs", label: "日志", icon: ClipboardList, view: "logs" },
  { key: "admin", label: "管理", icon: UserRound, view: "settings" },
];

function initialViewFromUrl(): ViewKey {
  const requestedView = new URLSearchParams(window.location.search).get("view");
  return requestedView && requestedView in viewTitles ? (requestedView as ViewKey) : "dashboard";
}

function initialInventoryModuleFromUrl(): InventoryModuleKey {
  const requestedModule = new URLSearchParams(window.location.search).get("module");
  return inventoryModuleKeys.some((key) => key === requestedModule) ? (requestedModule as InventoryModuleKey) : "stockIn";
}

function LoadingGate({
  stage,
  loading,
  error,
  refreshData,
  logout,
}: {
  stage: LoadingGateStage;
  loading: boolean;
  error?: string;
  refreshData: () => Promise<void>;
  logout: () => void;
}) {
  const isError = Boolean(error);
  const showActions = isError || stage === "stalled";
  const title = isError ? "连接失败" : stage === "stalled" ? "连接较慢" : "正在进入系统";
  const hint = isError ? "请检查网络后重试" : stage === "stalled" ? "数据加载时间较长，可以重试或退出后重新登录" : "正在准备业务数据";

  return (
    <div className={`app-route-loading app-data-loading ${isError ? "is-error" : ""}`} aria-live="polite">
      <section className="app-route-loading-card" aria-busy={!isError && !showActions}>
        <span className="app-route-loading-mark" aria-hidden="true" />
        <strong>{title}</strong>
        <small>{hint}</small>
        {showActions && (
          <div className="app-route-loading-actions">
            <button type="button" className="app-route-loading-primary" disabled={loading && !isError && stage !== "stalled"} onClick={() => void refreshData()}>
              {loading && !isError && stage !== "stalled" ? "连接中" : "重试"}
            </button>
            <button type="button" className="app-route-loading-secondary" onClick={logout}>
              退出
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

const LazyDashboard = lazy(() => import("./dashboardView").then((module) => ({ default: module.Dashboard })));
const MemoAppointments = memo(Appointments);
const MemoPos = memo(Pos);
const MemoCustomers = memo(Customers);
const MemoCatalog = memo(Catalog);
const MemoInventory = memo(Inventory);
const MemoManagementCenter = memo(ManagementCenter);
const MemoRoomSettings = memo(RoomSettings);
const LazyApprovalsView = lazy(() => import("./approvalsView").then((module) => ({ default: module.ApprovalsView })));
const LazySettingsView = lazy(() => import("./settingsView").then((module) => ({ default: module.SettingsView })));
const LazyPlatformAdminView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAdminView })));
const LazyPlatformDataReadOnlyView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformDataReadOnlyView })));
const LazyPlatformAccountAdminView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAccountAdminView })));
const LazyPlatformPermissionReadOnlyView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformPermissionReadOnlyView })));
const LazyPlatformSystemConfigView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformSystemConfigView })));
const LazyPlatformAiConfigView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAiConfigView })));
const LazyPlatformAiCreditsView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAiCreditsView })));
const LazyPlatformAiTestCenterView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAiTestCenterView })));
const LazyPlatformAiUsageReadOnlyView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformAiUsageReadOnlyView })));
const LazyPlatformStoreCustomerDetailsView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformStoreCustomerDetailsView })));
const LazyPlatformUsageReadOnlyView = lazy(() => import("./platformViews").then((module) => ({ default: module.PlatformUsageReadOnlyView })));
const LazyMarketingCenter = lazy(() => import("./marketingCenter").then((module) => ({ default: module.MarketingCenter })));
const LazyStaffCommissions = lazy(() => import("./staffCommissions").then((module) => ({ default: module.StaffCommissions })));
const LazyReports = lazy(() => import("../pages/shared/Reports"));
const LazyOperationLogs = lazy(() => import("../pages/shared/OperationLogs"));
const LazyCustomerRefundManagement = lazy(() => import("../components/business/ManagementOperations").then((module) => ({ default: module.CustomerRefundManagement })));
const LazyStaffScheduleManagement = lazy(() => import("../components/business/ManagementOperations").then((module) => ({ default: module.StaffScheduleManagement })));
const LazyNotificationPanel = lazy(() => import("../components/business/NotificationPanel").then((module) => ({ default: module.NotificationPanel })));

function ViewFallback({ title }: { title: string }) {
  return (
    <div className="page-stack">
      <section className="panel">
        <p className="empty">{title}加载中...</p>
      </section>
    </div>
  );
}

export default function AuthenticatedApp({ apiState }: { apiState: UseApiDataResult }) {
  const { data, session, loading, mutationPending, error, updateAccountProfile, logout, refreshData, refreshDataView, setActiveDataScope, runMutation, actions } = apiState;
  const [view, setView] = useState<ViewKey>(initialViewFromUrl);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [adminDetailFromCenter, setAdminDetailFromCenter] = useState(false);
  const [posEntryModule, setPosEntryModule] = useState<PosModuleKey | undefined>();
  const [posEntryAppointmentId, setPosEntryAppointmentId] = useState<string | undefined>();
  const [posEntryCustomerId, setPosEntryCustomerId] = useState<string | undefined>();
  const [posEntrySignatureId, setPosEntrySignatureId] = useState<string | undefined>();
  const [posEntryKey, setPosEntryKey] = useState(0);
  const [appointmentEntryId, setAppointmentEntryId] = useState<string | undefined>();
  const [appointmentEntryKey, setAppointmentEntryKey] = useState(0);
  const [inventoryEntryModule, setInventoryEntryModule] = useState<InventoryModuleKey | undefined>(() => initialViewFromUrl() === "inventory" ? initialInventoryModuleFromUrl() : undefined);
  const [catalogEntryModule, setCatalogEntryModule] = useState<CatalogModuleKey | undefined>();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedThemeMode = localStorage.getItem(THEME_KEY);
    return isThemeMode(savedThemeMode) ? savedThemeMode : "day";
  });
  const [loadingGateStage, setLoadingGateStage] = useState<LoadingGateStage>("connecting");
  const topbarActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeMode);
    document.documentElement.dataset.themePreference = themeMode;
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

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

  useEffect(() => {
    if (!session || data || error) {
      setLoadingGateStage("connecting");
      return;
    }

    const slowTimer = window.setTimeout(() => setLoadingGateStage("slow"), 5_000);
    const stalledTimer = window.setTimeout(() => setLoadingGateStage("stalled"), 12_000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(stalledTimer);
    };
  }, [session, data, error]);

  useEffect(() => {
    if (!data || !session) return;
    const nextStoreName = primaryStoreName(data);
    writeCachedStoreName(session, session.user.role === "superadmin" ? "" : nextStoreName);
  }, [data, session?.user.id, session?.user.role]);

  useEffect(() => {
    if (!session) {
      setActiveDataScope(undefined);
      return;
    }
    const platformAdmin = session.user.role === "superadmin";
    const scopedNavItems = navItems.filter((item) => canAccessView(session, item.key) && (!platformAdmin || platformAdminAllowedViews.has(item.key)));
    const nextActiveView = canAccessView(session, view) && (!platformAdmin || platformAdminAllowedViews.has(view)) ? view : scopedNavItems[0]?.key ?? "dashboard";
    setActiveDataScope(nextActiveView);
    if (data) {
      void refreshDataView(nextActiveView);
    }
  }, [session?.token, session?.user.role, view]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".app-shell .main")?.scrollTo({ top: 0, left: 0 });
    });
  }, [view, accountSettingsOpen]);

  const navigate = useCallback<NavigateToView>((nextView, options) => {
    setView(nextView);
    setAccountSettingsOpen(false);
    setNotificationPanelOpen(false);
    setAccountMenuOpen(false);
    setAdminDetailFromCenter(Boolean(options?.fromAdmin && nextView !== "settings"));
    setPosEntryModule(nextView === "pos" ? options?.posModule : undefined);
    setPosEntryAppointmentId(nextView === "pos" ? options?.appointmentId : undefined);
    setPosEntryCustomerId(nextView === "pos" ? options?.posCustomerId : undefined);
    setPosEntrySignatureId(nextView === "pos" ? options?.posSignatureId : undefined);
    setAppointmentEntryId(nextView === "appointments" ? options?.appointmentId : undefined);
    if (nextView === "appointments" && options?.appointmentId) setAppointmentEntryKey((key) => key + 1);
    if (nextView === "pos") setPosEntryKey((key) => key + 1);
    setInventoryEntryModule(nextView === "inventory" ? options?.inventoryModule : undefined);
    setCatalogEntryModule(nextView === "catalog" ? options?.catalogModule : undefined);
  }, []);
  const returnFromAccountSettings = useCallback((nextView: ViewKey) => {
    setView(nextView);
    setAccountSettingsOpen(false);
    setNotificationPanelOpen(false);
    setAccountMenuOpen(false);
    setAdminDetailFromCenter(false);
  }, []);
  const returnToManagement = useCallback(() => navigate("settings"), [navigate]);

  if (!session) {
    return null;
  }

  if (!data) {
    return (
      <LoadingGate
        stage={loadingGateStage}
        loading={loading}
        error={error}
        refreshData={refreshData}
        logout={logout}
      />
    );
  }

  const isPlatformAdmin = session.user.role === "superadmin";
  const isEmployeeOperator = session.user.role === "therapist" || session.user.role === "frontdesk";
  const visibleNavItems = navItems.filter((item) => canAccessView(session, item.key) && (!isPlatformAdmin || platformAdminAllowedViews.has(item.key)));
  const activeView = canAccessView(session, view) && (!isPlatformAdmin || platformAdminAllowedViews.has(view)) ? view : visibleNavItems[0]?.key ?? "dashboard";
  const activeWorkbar = workbarForView(activeView, posEntryModule, isEmployeeOperator);
  const currentWorkbarItems = isPlatformAdmin ? platformWorkbarItems : isEmployeeOperator ? employeeWorkbarItems : workbarItems;
  const notificationCount = visibleNotificationsForSession(data, session).filter((item) => !item.readByUserIds.includes(session.user.id)).length;

  const showAdminDetailBack = false;
  const showManagementBack = adminDetailFromCenter && activeView !== "settings" && activeView !== "roomSettings";
  const shellRoleLabel: Record<UserRole, string> = {
    superadmin: "管理后台",
    owner: "门店老板",
    manager: "门店主管",
    frontdesk: "前台营业",
    therapist: "",
    finance: "财务后台",
  };
  const shellDisplayName = session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;
  const shellPrimaryLabel = shellRoleLabel[session.user.role] || shellDisplayName;
  const shellSecondaryLabel = shellRoleLabel[session.user.role] ? shellDisplayName : "";
  const topbarStoreName = primaryStoreName(data);
  const topbarTitle = session.user.role === "superadmin" ? DEFAULT_SYSTEM_TITLE : topbarStoreName || DEFAULT_SYSTEM_TITLE;
  const currentAuthUser = data.authUsers.find((user) => user.id === session.user.id);
  const currentAvatarUrl = currentAuthUser?.avatarUrl ?? session.user.avatarUrl;

  return (
    <MutationPendingContext.Provider value={mutationPending}>
    <div className={`app-shell theme-${themeMode}`} data-mutating={mutationPending ? "true" : undefined}>
      <aside className="sidebar">
        <div className="rail-admin">
          <BrandIcon className="brand-mark brand-icon-mark" />
          <div>
            <strong>{shellPrimaryLabel}</strong>
            {shellSecondaryLabel && <span>{shellSecondaryLabel}</span>}
          </div>
        </div>
      </aside>
      <header className="topbar">
        <div className="topbar-brand">
          <BrandIcon className="brand-mark brand-icon-mark" />
          <div>
            <strong>{shellPrimaryLabel}</strong>
            {shellSecondaryLabel && <span>{shellSecondaryLabel}</span>}
          </div>
        </div>
        <div className="topbar-title">
            <p>{topbarTitle}</p>
        </div>
        <div className="topbar-actions" ref={topbarActionsRef}>
          <button className="icon-button notification-button" aria-label="通知" onClick={() => { setNotificationPanelOpen((open) => !open); setAccountMenuOpen(false); }}>
            <Bell size={18} />
            {notificationCount > 0 && <span>{notificationCount}</span>}
          </button>
          <button className="account-avatar-button" aria-label="账号中心" aria-expanded={accountMenuOpen} onClick={() => { setAccountMenuOpen((open) => !open); setNotificationPanelOpen(false); }}>
            <UserAvatar />
          </button>
          {notificationPanelOpen && (
            <Suspense fallback={null}>
              <LazyNotificationPanel
                data={data}
                session={session}
                actions={actions}
                runMutation={runMutation}
                mutationPending={mutationPending}
                setView={navigate}
                onClose={() => setNotificationPanelOpen(false)}
              />
            </Suspense>
          )}
          {accountMenuOpen && (
            <AccountMenu
              session={session}
              avatarUrl={currentAvatarUrl}
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
      <main className="main">
        <GlobalMutationStatus />
        {error && <span className="error-chip app-error-chip">{error}</span>}
        {accountSettingsOpen ? (
          <Suspense fallback={<ViewFallback title="系统设置" />}>
            <LazySettingsView
              session={session}
              setView={returnFromAccountSettings}
              returnView={activeView}
              updateProfile={updateAccountProfile}
              uploadAccountAvatar={actions.uploadAccountAvatar}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
            />
          </Suspense>
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
            {activeView === "dashboard" && (isPlatformAdmin ? (
              <Suspense fallback={<ViewFallback title="平台总览" />}>
                <LazyPlatformAdminView data={data} />
              </Suspense>
            ) : (
              <Suspense fallback={<ViewFallback title="今日总览" />}>
                <LazyDashboard data={data} session={session} setView={navigate} />
              </Suspense>
            ))}
            {activeView === "appointments" && <MemoAppointments data={data} session={session} actions={actions} runMutation={runMutation} setView={navigate} initialAppointmentId={appointmentEntryId} initialAppointmentKey={appointmentEntryKey} />}
            {activeView === "pos" && <MemoPos data={data} session={session} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} initialModule={posEntryModule} initialAppointmentId={posEntryAppointmentId} initialCustomerId={posEntryCustomerId} initialSignatureId={posEntrySignatureId} initialEntryKey={posEntryKey} onReturnManagement={returnToManagement} onReturnAppointments={() => navigate("appointments")} />}
            {activeView === "customers" && <MemoCustomers data={data} actions={actions} runMutation={runMutation} setView={navigate} fromManagement={showManagementBack} onReturnManagement={returnToManagement} />}
            {activeView === "marketing" && (
              <Suspense fallback={<ViewFallback title="营销中心" />}>
                <LazyMarketingCenter data={data} session={session} actions={actions} refreshMarketingData={() => refreshDataView("marketing")} />
              </Suspense>
            )}
            {activeView === "catalog" && <MemoCatalog data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} initialModule={catalogEntryModule} onReturnManagement={returnToManagement} />}
            {activeView === "staff" && (
              <Suspense fallback={<ViewFallback title="人员账号" />}>
                <LazyStaffCommissions data={data} session={session} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={returnToManagement} />
              </Suspense>
            )}
            {activeView === "inventory" && <MemoInventory data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} initialModule={inventoryEntryModule} onReturnManagement={returnToManagement} />}
            {activeView === "reports" && (isPlatformAdmin
              ? (
                <Suspense fallback={<ViewFallback title="报表分析" />}>
                  <LazyPlatformDataReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} />
                </Suspense>
              )
              : (
                <Suspense fallback={<ViewFallback title="报表分析" />}>
                  <LazyReports data={data} actions={actions} runMutation={runMutation} mutationPending={mutationPending} fromManagement={showManagementBack} onReturnManagement={returnToManagement} />
                </Suspense>
              )
            )}
            {activeView === "approvals" && (
              <Suspense fallback={<ViewFallback title="审批中心" />}>
                <LazyApprovalsView data={data} actions={actions} runMutation={runMutation} fromManagement={showManagementBack} onReturnManagement={returnToManagement} />
              </Suspense>
            )}
            {activeView === "logs" && (
              <Suspense fallback={<ViewFallback title="操作日志" />}>
                <LazyOperationLogs data={data} session={session} />
              </Suspense>
            )}
            {activeView === "accounts" && (
              <Suspense fallback={<ViewFallback title="账号管理" />}>
                <LazyPlatformAccountAdminView data={data} session={session} setView={navigate} showBack={showAdminDetailBack} actions={actions} runMutation={runMutation} />
              </Suspense>
            )}
            {activeView === "permissions" && (
              <Suspense fallback={<ViewFallback title="权限管理" />}>
                <LazyPlatformPermissionReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} actions={actions} runMutation={runMutation} />
              </Suspense>
            )}
            {activeView === "platformConfig" && (
              <Suspense fallback={<ViewFallback title="平台配置" />}>
                <LazyPlatformSystemConfigView data={data} actions={actions} runMutation={runMutation} />
              </Suspense>
            )}
            {activeView === "aiConfig" && (
              <Suspense fallback={<ViewFallback title="AI 配置" />}>
                <LazyPlatformAiConfigView data={data} setView={navigate} actions={actions} runMutation={runMutation} />
              </Suspense>
            )}
            {activeView === "aiCredits" && (
              <Suspense fallback={<ViewFallback title="AI 积分充值" />}>
                <LazyPlatformAiCreditsView data={data} session={session} setView={navigate} actions={actions} runMutation={runMutation} />
              </Suspense>
            )}
            {activeView === "aiTest" && (
              <Suspense fallback={<ViewFallback title="AI 测试中心" />}>
                <LazyPlatformAiTestCenterView data={data} setView={navigate} actions={actions} />
              </Suspense>
            )}
            {activeView === "aiUsage" && (
              <Suspense fallback={<ViewFallback title="AI费用统计" />}>
                <LazyPlatformAiUsageReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} />
              </Suspense>
            )}
            {activeView === "storeCustomerDetails" && (
              <Suspense fallback={<ViewFallback title="分店客户明细" />}>
                <LazyPlatformStoreCustomerDetailsView data={data} setView={navigate} showBack={showAdminDetailBack} />
              </Suspense>
            )}
            {activeView === "usage" && (
              <Suspense fallback={<ViewFallback title="用量监控" />}>
                <LazyPlatformUsageReadOnlyView data={data} setView={navigate} showBack={showAdminDetailBack} fetchR2Usage={actions.fetchR2Usage} fetchWorkerUsage={actions.fetchWorkerUsage} />
              </Suspense>
            )}
            {activeView === "roomSettings" && <MemoRoomSettings data={data} actions={actions} runMutation={runMutation} setView={navigate} />}
            {activeView === "settings" && (
              <MemoManagementCenter
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
        {currentWorkbarItems.filter((item) => canAccessView(session, item.view) && (!isPlatformAdmin || platformAdminAllowedViews.has(item.view))).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} className={activeWorkbar === item.key ? "active" : ""} onClick={() => navigate(item.view, item.options)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
    </MutationPendingContext.Provider>
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
  const currentAuthUser = data.authUsers.find((user) => user.id === session.user.id);
  const currentAvatarUrl = currentAuthUser?.avatarUrl ?? session.user.avatarUrl;
  const linkedStaff = currentAuthUser?.staffId ? data.staff.find((staff) => staff.id === currentAuthUser.staffId) : undefined;
  const accountContact = session.user.account.includes("@") ? session.user.account.split("@")[0] : session.user.account;
  const displayContact = linkedStaff?.phone ?? accountContact;
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteCopyStatus, setInviteCopyStatus] = useState<"idle" | "copied" | "selected">("idle");
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [customerRefundOpen, setCustomerRefundOpen] = useState(false);
  const [staffScheduleOpen, setStaffScheduleOpen] = useState(false);
  const [aiUsagePermissionsOpen, setAiUsagePermissionsOpen] = useState(false);
  const [operationalPermissionsOpen, setOperationalPermissionsOpen] = useState(false);
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
    catalogModule?: CatalogModuleKey;
    onClick?: () => void;
  };

  const platformManagementCards: ManagementCard[] = [
    { title: "平台总览", desc: "门店数据 / 经营汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "dashboard" },
    { title: "经营数据", desc: "经营报表 / 门店汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "账号管理", desc: "账号状态 / 角色权限", icon: UsersRound, tone: "violet", view: "accounts" },
    { title: "门店开通审核", desc: "门店申请 / 授权审批", icon: ShieldCheck, tone: "violet", view: "permissions" },
    { title: "平台配置", desc: "邀请码 / 注册 / 维护 / 公告", icon: Settings, tone: "violet", view: "platformConfig" },
    { title: "预约权限", desc: "员工查看全店预约开关", icon: CalendarDays, tone: "teal", onClick: () => setOperationalPermissionsOpen(true) },
    { title: "AI 能力配置", desc: "模型 / API Key / 成本规则", icon: Sparkles, tone: "plum", view: "aiConfig" },
    { title: "AI积分充值", desc: "给账号充值积分", icon: CreditCard, tone: "plum", view: "aiCredits" },
    { title: "AI 测试中心", desc: "验证模型 / Key / 视频任务", icon: Megaphone, tone: "plum", view: "aiTest" },
    { title: "AI 使用权限", desc: "门店店长 / 员工功能开关", icon: Sparkles, tone: "plum", onClick: () => setAiUsagePermissionsOpen(true) },
    { title: "AI费用统计", desc: "文案 / 图片 / 视频费用", icon: BadgeCent, tone: "plum", view: "aiUsage" },
    { title: "分店客户明细", desc: "客户业务 / 消费明细", icon: UsersRound, tone: "violet", view: "storeCustomerDetails" },
    { title: "操作日志", desc: "登录记录 / 操作轨迹", icon: ClipboardList, tone: "amber", view: "logs" },
    { title: "服务器用量", desc: "D1 / R2 / Worker / 免费额度", icon: Database, tone: "teal", view: "usage" },
  ];
  const storeManagementCards: ManagementCard[] = [
    { title: "账号管理", desc: "员工审核 / 密码重置", icon: UserCog, tone: "violet", view: "accounts" },
    { title: "商品入库", desc: "新增商品 / 已有补货", icon: PackagePlus, tone: "teal", view: "inventory", inventoryModule: "stockIn" },
    { title: "项目商品", desc: "服务项目 / 商品资料", icon: PackageOpen, tone: "teal", view: "catalog" },
    { title: "商品档案", desc: "商品资料 / 编码规格", icon: FileBox, tone: "teal", view: "catalog", catalogModule: "productList" },
    { title: "库存列表", desc: "库存状态 / 预警查看", icon: Warehouse, tone: "teal", view: "inventory", inventoryModule: "list" },
    { title: "销售业绩", desc: "经营数据 / 员工业绩", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "营销中心", desc: "生日祝福 / 引流文案", icon: Camera, tone: "plum", view: "marketing" },
    { title: "客户退费", desc: "会员卡退费 / 退卡记录", icon: CreditCard, tone: "rose", onClick: () => setCustomerRefundOpen(true) },
    { title: "商品损耗", desc: "损耗登记 / 库存扣减", icon: PackageMinus, tone: "rose", view: "inventory", inventoryModule: "loss" },
    { title: "员工管理", desc: "员工档案 / 权限状态", icon: UserCheck, tone: "violet", view: "staff" },
    { title: "员工排班", desc: "班次查看 / 不可预约时间", icon: CalendarClock, tone: "teal", onClick: () => setStaffScheduleOpen(true) },
    { title: "预约权限", desc: "员工查看全店预约开关", icon: LockKeyhole, tone: "teal", onClick: () => setOperationalPermissionsOpen(true) },
    { title: "员工提成", desc: "员工提成 / 结算记录", icon: ReceiptText, tone: "amber", view: "staff" },
    { title: "房间设置", desc: "房间数量 / 房名维护", icon: Building2, tone: "teal", onClick: () => setRoomSettingsOpen(true) },
    { title: "库存盘点", desc: "账实差异 / 盘点记录", icon: ClipboardCheck, tone: "violet", view: "inventory", inventoryModule: "stocktake" },
    { title: "审批中心", desc: "退款改价 / 异常审批", icon: ShieldCheck, tone: "rose", view: "approvals" },
    { title: "操作日志", desc: "登录记录 / 操作轨迹", icon: ClipboardList, tone: "amber", view: "logs" },
  ];
  const staffManagementCards: ManagementCard[] = [
    { title: "个人资料", desc: "头像 / 姓名 / 账号设置", icon: UserRound, tone: "violet", onClick: openAccountSettings },
    { title: "我的提成", desc: "提成明细 / 结算记录", icon: CreditCard, tone: "amber", view: "staff" },
    { title: "外观通知", desc: "日间 / 夜间 / 推送通知", icon: Bell, tone: "rose", onClick: openAccountSettings },
  ];
  const financeManagementCards: ManagementCard[] = [
    { title: "个人资料", desc: "头像 / 姓名 / 账号设置", icon: UserRound, tone: "violet", onClick: openAccountSettings },
    { title: "员工提成", desc: "提成明细 / 结算记录", icon: CreditCard, tone: "amber", view: "staff" },
    { title: "销售业绩", desc: "经营数据 / 财务汇总", icon: ChartNoAxesColumnIncreasing, tone: "violet", view: "reports" },
    { title: "审批中心", desc: "退款改价 / 异常审批", icon: ShieldCheck, tone: "rose", view: "approvals" },
    { title: "外观通知", desc: "日间 / 夜间 / 推送通知", icon: Bell, tone: "rose", onClick: openAccountSettings },
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
          <UserAvatar avatarUrl={currentAvatarUrl} size={78} showImage />
        </div>
        <div className="admin-profile-copy">
          <span className="admin-role-pill"><ShieldCheck size={14} /> {displayRole}</span>
          <h2>{displayName}</h2>
          <p>{displayRole} · {displayContact}</p>
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

      <section className="admin-module-section">
        <div className="admin-section-title">
          <span>管理入口</span>
        </div>
        <div className="admin-module-grid">
          {visibleManagementCards.map((item) => (
            <AdminCenterCard
              key={item.title}
              item={item}
              onClick={() => item.onClick ? item.onClick() : item.view && setView(item.view, { fromAdmin: true, inventoryModule: item.inventoryModule, catalogModule: item.catalogModule })}
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
      <Modal
        open={aiUsagePermissionsOpen}
        title="AI 使用权限"
        subtitle="设置店长和员工可使用的 AI 写文案、AI 做产品设计图和 AI 做产品视频能力"
        size="large"
        onClose={() => setAiUsagePermissionsOpen(false)}
      >
        <AiUsagePermissionsContent data={data} session={session} actions={actions} runMutation={runMutation} onClose={() => setAiUsagePermissionsOpen(false)} />
      </Modal>
      <Modal
        open={operationalPermissionsOpen}
        title="预约权限"
        subtitle="设置服务人员是否可以查看本门店全店预约"
        size="large"
        onClose={() => setOperationalPermissionsOpen(false)}
      >
        <OperationalPermissionsContent data={data} session={session} actions={actions} runMutation={runMutation} onClose={() => setOperationalPermissionsOpen(false)} />
      </Modal>
      <Modal
        open={customerRefundOpen}
        title="客户退费"
        subtitle="处理会员卡退费、退卡关闭和退费记录"
        size="large"
        onClose={() => setCustomerRefundOpen(false)}
      >
        <Suspense fallback={<ViewFallback title="客户退费" />}>
          <LazyCustomerRefundManagement data={data} actions={actions} runMutation={runMutation} />
        </Suspense>
      </Modal>
      <Modal
        open={staffScheduleOpen}
        title="员工排班"
        subtitle="查看每位员工班次和不可预约时间，预约会按这里判断"
        size="large"
        onClose={() => setStaffScheduleOpen(false)}
      >
        <Suspense fallback={<ViewFallback title="员工排班" />}>
          <LazyStaffScheduleManagement data={data} actions={actions} runMutation={runMutation} />
        </Suspense>
      </Modal>
    </div>
  );
}

function workbarForView(view: ViewKey, posModule?: PosModuleKey, employeeMode = false): WorkbarKey {
  if (view === "appointments") return "appointments";
  if (view === "pos") return employeeMode && posModule === "card" ? "card" : "cashier";
  if (view === "customers") return "customers";
  if (view === "marketing") return "marketing";
  if (view === "reports") return "reports";
  if (view === "accounts") return "accounts";
  if (view === "logs") return "logs";
  if (["settings", "catalog", "inventory", "approvals", "staff", "reports", "logs", "accounts", "permissions", "platformConfig", "aiConfig", "aiCredits", "aiTest", "aiUsage", "storeCustomerDetails", "usage", "roomSettings"].includes(view)) return "admin";
  return "workbench";
}

function RoomSettings({ data, actions, runMutation, setView }: { data: AppData; actions: ApiActions; runMutation: RunMutation; setView: NavigateToView }) {
  return (
    <div className="page-stack module-subpage room-settings-page">
      <ModuleSubpageHeader parentTitle="管理中心" moduleTitle="房间设置" onBack={() => setView("settings")} />
      <RoomSettingsContent data={data} actions={actions} runMutation={runMutation} onClose={() => setView("settings")} />
    </div>
  );
}

function AiUsagePermissionsContent({ data, session, actions, runMutation, onClose }: { data: AppData; session: UserSession; actions: ApiActions; runMutation: RunMutation; onClose: () => void }) {
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const isPlatformAdmin = session.user.role === "superadmin";
  const [selectedStoreId, setSelectedStoreId] = useState(() => data.storeProfiles[0]?.id ?? "");
  const selectedStore = data.storeProfiles.find((store) => store.id === selectedStoreId) ?? data.storeProfiles[0];
  const [draft, setDraft] = useState(() => normalizeStoreAiUsagePermissions(selectedStore?.aiUsagePermissions));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const capabilityKeys: AiUsageCapability[] = ["copy", "image", "video"];
  const roleRows: Array<{ key: keyof StoreAiUsagePermissions; label: string; hint: string }> = [
    { key: "owner", label: "店长", hint: "店长账号和主管账号" },
    { key: "staff", label: "员工", hint: "前台、技师、财务等员工账号" },
  ];

  useEffect(() => {
    const nextStore = data.storeProfiles.find((store) => store.id === selectedStoreId) ?? data.storeProfiles[0];
    if (nextStore && nextStore.id !== selectedStoreId) {
      setSelectedStoreId(nextStore.id);
    }
    setDraft(normalizeStoreAiUsagePermissions(nextStore?.aiUsagePermissions));
    setSaved(false);
    setError("");
  }, [data.storeProfiles, selectedStoreId]);

  const setCapability = (roleKey: keyof StoreAiUsagePermissions, capability: AiUsageCapability, enabled: boolean) => {
    setSaved(false);
    setError("");
    setDraft((current) => ({
      ...current,
      [roleKey]: {
        ...current[roleKey],
        [capability]: enabled,
      },
    }));
  };

  const savePermissions = (event: FormEvent) => {
    event.preventDefault();
    if (isPlatformAdmin && !selectedStore?.id) {
      setError("请先选择门店");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError("");
    void runMutation(() => actions.updateAiUsagePermissions(draft, isPlatformAdmin ? selectedStore?.id : undefined))
      .then(() => {
        setSaved(true);
        window.setTimeout(onClose, 600);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "AI 使用权限保存失败"))
      .finally(() => setSaving(false));
  };

  return (
    <form className="ai-permission-panel" onSubmit={savePermissions}>
      {isPlatformAdmin && (
        <label className="ai-permission-store-picker">
          <span>门店</span>
          <select value={selectedStore?.id ?? ""} onChange={(event) => setSelectedStoreId(event.target.value)}>
            {data.storeProfiles.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="ai-permission-status-grid">
        {capabilityKeys.map((capability) => (
          <article key={capability} className={!aiCapabilityPlatformEnabled(aiConfig, capability) ? "disabled" : ""}>
            <span>{AI_USAGE_CAPABILITY_LABELS[capability]}</span>
            <strong>{aiCapabilityPlatformEnabled(aiConfig, capability) ? "平台已启用" : "平台未启用"}</strong>
          </article>
        ))}
      </div>

      <div className="ai-permission-matrix" role="table" aria-label="AI 使用权限矩阵">
        <div className="ai-permission-head" role="row">
          <span>对象</span>
          {capabilityKeys.map((capability) => <span key={capability}>{AI_USAGE_CAPABILITY_LABELS[capability].replace("AI ", "")}</span>)}
        </div>
        {roleRows.map((row) => (
          <div className="ai-permission-row" role="row" key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <small>{row.hint}</small>
            </div>
            {capabilityKeys.map((capability) => {
              const platformEnabled = aiCapabilityPlatformEnabled(aiConfig, capability);
              return (
                <label key={`${row.key}-${capability}`} className={!platformEnabled ? "disabled" : ""}>
                  <input
                    type="checkbox"
                    checked={draft[row.key][capability] && platformEnabled}
                    disabled={!platformEnabled}
                    onChange={(event) => setCapability(row.key, capability, event.target.checked)}
                  />
                  <span>{draft[row.key][capability] && platformEnabled ? "开启" : platformEnabled ? "关闭" : "不可用"}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success">AI 使用权限已保存。</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中..." : saved ? "已保存" : "保存权限"}
        </button>
      </div>
    </form>
  );
}

function OperationalPermissionsContent({ data, session, actions, runMutation, onClose }: { data: AppData; session: UserSession; actions: ApiActions; runMutation: RunMutation; onClose: () => void }) {
  const isPlatformAdmin = session.user.role === "superadmin";
  const [selectedStoreId, setSelectedStoreId] = useState(() => data.storeProfiles[0]?.id ?? "");
  const selectedStore = data.storeProfiles.find((store) => store.id === selectedStoreId) ?? data.storeProfiles[0];
  const [draft, setDraft] = useState(() => normalizeStoreOperationalPermissions(selectedStore?.operationalPermissions));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const appointmentCount = selectedStore
    ? data.appointments.filter((appointment) => appointment.storeId === selectedStore.id || (!appointment.storeId && data.storeProfiles.length === 1)).length
    : data.appointments.length;

  useEffect(() => {
    const nextStore = data.storeProfiles.find((store) => store.id === selectedStoreId) ?? data.storeProfiles[0];
    if (nextStore && nextStore.id !== selectedStoreId) {
      setSelectedStoreId(nextStore.id);
    }
    setDraft(normalizeStoreOperationalPermissions(nextStore?.operationalPermissions));
    setSaved(false);
    setError("");
  }, [data.storeProfiles, selectedStoreId]);

  const savePermissions = (event: FormEvent) => {
    event.preventDefault();
    if (isPlatformAdmin && !selectedStore?.id) {
      setError("请先选择门店");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError("");
    void runMutation(() => actions.updateOperationalPermissions(draft, isPlatformAdmin ? selectedStore?.id : undefined))
      .then(() => {
        setSaved(true);
        window.setTimeout(onClose, 600);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "预约权限保存失败"))
      .finally(() => setSaving(false));
  };

  return (
    <form className="ai-permission-panel" onSubmit={savePermissions}>
      {isPlatformAdmin && (
        <label className="ai-permission-store-picker">
          <span>门店</span>
          <select value={selectedStore?.id ?? ""} onChange={(event) => setSelectedStoreId(event.target.value)}>
            {data.storeProfiles.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="ai-permission-status-grid">
        <article>
          <span>当前状态</span>
          <strong>{draft.staffCanViewAllAppointments ? "同店共享" : "仅看本人"}</strong>
        </article>
        <article>
          <span>门店预约</span>
          <strong>{appointmentCount} 单</strong>
        </article>
      </div>

      <div className="ai-permission-matrix" role="table" aria-label="预约可见范围">
        <div className="ai-permission-head" role="row">
          <span>对象</span>
          <span>查看</span>
          <span>操作</span>
          <span>规则</span>
        </div>
        <div className="ai-permission-row" role="row">
          <div>
            <strong>同店员工</strong>
            <small>默认开启资源共享，关闭后员工仅查看本人预约</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={draft.staffCanViewAllAppointments}
              onChange={(event) => {
                setSaved(false);
                setError("");
                setDraft({ staffCanViewAllAppointments: event.target.checked });
              }}
            />
            <span>{draft.staffCanViewAllAppointments ? "全店可见" : "仅看本人"}</span>
          </label>
          <span className="permission-state-pill">{draft.staffCanViewAllAppointments ? "可处理" : "仅本人"}</span>
          <span className="permission-state-pill">{draft.staffCanViewAllAppointments ? "已开启" : "已关闭"}</span>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success">预约权限已保存。</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中..." : saved ? "已保存" : "保存权限"}
        </button>
      </div>
    </form>
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

const APPOINTMENT_WORKFLOW_PREVIEW_LIMIT = 6;

function Appointments({ data, session, actions, runMutation, setView, initialAppointmentId, initialAppointmentKey = 0 }: { data: AppData; session: UserSession; actions: ApiActions; runMutation: RunMutation; setView: NavigateToView; initialAppointmentId?: string; initialAppointmentKey?: number }) {
  const mutationPending = useMutationPending();
  const serviceStaff = businessStaffOf(data);
  const currentAppointmentStaffId = session.user.staffId ?? "";
  const defaultAppointmentStaffId = currentAppointmentStaffId && serviceStaff.some((staff) => staff.id === currentAppointmentStaffId)
    ? currentAppointmentStaffId
    : firstBusinessStaffId(data);
  const [customerId, setCustomerId] = useState("");
  const [appointmentCustomerSearch, setAppointmentCustomerSearch] = useState("");
  const appointmentCustomerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const appointmentAutoReviewCustomerIdRef = useRef("");
  const [appointmentReviewReady, setAppointmentReviewReady] = useState(false);
  const [staffId, setStaffId] = useState(defaultAppointmentStaffId);
  const [startAt, setStartAt] = useState(() => nextAppointmentDateTimeRange().start);
  const [endAt, setEndAt] = useState(() => nextAppointmentDateTimeRange().end);
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
  const [selectedAppointmentDetailId, setSelectedAppointmentDetailId] = useState("");
  const [focusedAppointmentId, setFocusedAppointmentId] = useState("");
  const appliedInitialAppointmentIdRef = useRef<string | undefined>(undefined);
  const [rescheduleStaffId, setRescheduleStaffId] = useState(defaultAppointmentStaffId);
  const [rescheduleServiceId, setRescheduleServiceId] = useState(data.services[0]?.id ?? "");
  const [rescheduleServiceIds, setRescheduleServiceIds] = useState<string[]>(() => data.services[0]?.id ? [data.services[0].id] : []);
  const [rescheduleStartAt, setRescheduleStartAt] = useState(() => nextAppointmentDateTimeRange().start);
  const [rescheduleEndAt, setRescheduleEndAt] = useState(() => nextAppointmentDateTimeRange().end);
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [cancelReason, setCancelReason] = useState("客户临时取消");
  const staffOptions = serviceStaff.map(optionOf);
  const appointmentStaffOptions = staffOptions;
  const selectedAppointmentCustomer = data.customers.find((item) => item.id === customerId);
  const appointmentCustomerSearchText = appointmentCustomerSearch.trim();
  const normalizedAppointmentCustomerSearch = appointmentCustomerSearchText.toLowerCase();
  const appointmentCustomerSearchResults = normalizedAppointmentCustomerSearch
    ? data.customers
        .filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(normalizedAppointmentCustomerSearch))
        .slice(0, 8)
    : [];
  const resolveAppointmentCustomerFromSearch = (value: string) => {
    const normalized = normalizeCustomerLookupText(value.trim());
    if (!normalized) return selectedAppointmentCustomer;
    if (selectedAppointmentCustomer && customerMatchesSearchText(selectedAppointmentCustomer, value)) return selectedAppointmentCustomer;
    const exactMatches = data.customers.filter((customer) => {
      const name = normalizeCustomerLookupText(customer.name);
      const phone = normalizeCustomerLookupText(customer.phone ?? "");
      return name === normalized || Boolean(phone && phone === normalized);
    });
    if (exactMatches.length === 1) return exactMatches[0];
    if (normalized.length >= 4) {
      const phoneMatches = data.customers.filter((customer) => normalizeCustomerLookupText(customer.phone ?? "").includes(normalized));
      if (phoneMatches.length === 1) return phoneMatches[0];
    }
    return undefined;
  };
  const resolvedAppointmentCustomer = resolveAppointmentCustomerFromSearch(appointmentCustomerSearch);
  const appointmentCustomerSearchUnresolved = Boolean(
    appointmentCustomerSearchText &&
      !resolvedAppointmentCustomer,
  );
  const updateAppointmentCustomerSearch = (value: string) => {
    setAppointmentCustomerSearch(value);
    if (value.trim() && selectedAppointmentCustomer && !customerMatchesSearchText(selectedAppointmentCustomer, value)) {
      setCustomerId("");
    }
    if (!value.trim() && !selectedAppointmentCustomer) {
      setCustomerId("");
    }
  };
  const selectAppointmentCustomer = (customer: CustomerOptionItem) => {
    setCustomerId(customer.id);
    setAppointmentCustomerSearch(customerDisplayLabel(customer));
    setAppointmentReviewReady(false);
  };
  const readAppointmentCustomerSearchValue = () => appointmentCustomerSearchInputRef.current?.value ?? appointmentCustomerSearch;
  const syncAppointmentCustomerSearchFromInput = () => {
    const value = readAppointmentCustomerSearchValue();
    if (value !== appointmentCustomerSearch) updateAppointmentCustomerSearch(value);
    return value;
  };
  const serviceStaffIds = new Set(serviceStaff.map((staff) => staff.id));
  const roomNames = roomNamesOf(data);
  const [roomName, setRoomName] = useState(roomNames[0] ?? "");
  const [rescheduleRoomName, setRescheduleRoomName] = useState(roomNames[0] ?? "");
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [appointmentRange, setAppointmentRange] = useState<AppointmentRange>("today");
  const [expandedWorkflowGroups, setExpandedWorkflowGroups] = useState<Record<string, boolean>>({});
  const hasConfiguredRooms = roomNames.length > 0;
  const minAppointmentDateTime = toLocalInputValue(new Date().toISOString());

  useEffect(() => {
    if (appointmentAutoReviewCustomerIdRef.current && appointmentAutoReviewCustomerIdRef.current === customerId) {
      appointmentAutoReviewCustomerIdRef.current = "";
      return;
    }
    setAppointmentReviewReady(false);
  }, [customerId, staffId, startAt, endAt, roomName, note]);

  useEffect(() => {
    setExpandedWorkflowGroups({});
  }, [appointmentRange]);

  useEffect(() => {
    if (!showAppointmentForm) return;
    const input = appointmentCustomerSearchInputRef.current;
    if (!input) return;
    const sync = () => updateAppointmentCustomerSearch(input.value);
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    input.addEventListener("compositionend", sync);
    input.addEventListener("keyup", sync);
    return () => {
      input.removeEventListener("input", sync);
      input.removeEventListener("change", sync);
      input.removeEventListener("compositionend", sync);
      input.removeEventListener("keyup", sync);
    };
  }, [selectedAppointmentCustomer, showAppointmentForm]);

  useEffect(() => {
    const firstStaffId = defaultAppointmentStaffId;
    if (!serviceStaff.some((staff) => staff.id === staffId)) setStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === blockedStaffId)) setBlockedStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === shiftStaffId)) setShiftStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === onlineRequestStaffId)) setOnlineRequestStaffId(firstStaffId);
    if (!serviceStaff.some((staff) => staff.id === rescheduleStaffId)) setRescheduleStaffId(firstStaffId);
  }, [blockedStaffId, defaultAppointmentStaffId, onlineRequestStaffId, rescheduleStaffId, serviceStaff, shiftStaffId, staffId]);

  useEffect(() => {
    const currentStartAt = new Date(startAt);
    const currentEndAt = new Date(endAt);
    if (Number.isNaN(currentStartAt.getTime())) return;
    if (Number.isNaN(currentEndAt.getTime()) || !(currentStartAt < currentEndAt)) {
      setEndAt(toLocalInputValue(new Date(currentStartAt.getTime() + 60 * 60 * 1000).toISOString()));
    }
  }, [endAt, startAt]);

  const addAppointment = (event: FormEvent) => {
    event.preventDefault();
    const currentCustomerSearch = syncAppointmentCustomerSearchFromInput();
    const currentResolvedCustomer = resolveAppointmentCustomerFromSearch(currentCustomerSearch);
    const currentCustomerUnresolved = Boolean(currentCustomerSearch.trim() && !currentResolvedCustomer);
    const appointmentCustomerId = currentResolvedCustomer?.id ?? customerId;
    const nextStartAt = new Date(startAt);
    if (!hasConfiguredRooms || !roomNames.includes(roomName) || nextStartAt < new Date()) return;
    if (!appointmentCustomerId || currentCustomerUnresolved) {
      void runMutation(() => {
        throw new Error("请先输入完整姓名/手机号，或从客户搜索结果中点选客户后再保存预约。");
      });
      return;
    }
    if (selectedTimeConflict) {
      void runMutation(() => {
        throw new Error(selectedStaffAppointmentConflictText || selectedStaffUnavailableConflictText || "该人员在此时间段已有安排");
      });
      return;
    }
    if (!appointmentReviewReady) {
      if (currentResolvedCustomer && currentResolvedCustomer.id !== customerId) {
        appointmentAutoReviewCustomerIdRef.current = currentResolvedCustomer.id;
        setCustomerId(currentResolvedCustomer.id);
        setAppointmentCustomerSearch(customerDisplayLabel(currentResolvedCustomer));
      }
      setAppointmentReviewReady(true);
      return;
    }
    void runMutation(() =>
      actions.addAppointment({
        customerId: appointmentCustomerId,
        staffId,
        serviceId: "",
        serviceIds: [],
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        roomName,
        note,
      }),
    ).then(() => {
      setNote("");
      setCustomerId("");
      setAppointmentCustomerSearch("");
      setAppointmentReviewReady(false);
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
    setRescheduleServiceIds(appointmentServiceIds(appointment));
    setRescheduleStartAt(toLocalInputValue(appointment.startAt));
    setRescheduleEndAt(toLocalInputValue(appointmentEndAt(appointment, data.services).toISOString()));
    setRescheduleRoomName(roomNames.includes(appointment.roomName ?? "") ? appointment.roomName ?? "" : roomNames[0] ?? "");
    setRescheduleNote(appointment.note);
  };

  const openCancel = (appointment: Appointment) => {
    setActiveAppointmentId(appointment.id);
    setActiveAppointmentAction("cancel");
    setCancelReason(appointment.cancelReason ?? "客户临时取消");
  };

  const closeAppointmentAction = () => {
    setActiveAppointmentAction(undefined);
    setActiveAppointmentId("");
  };

  const submitReschedule = (event: FormEvent) => {
    event.preventDefault();
    const nextStartAt = new Date(rescheduleStartAt);
    if (!hasConfiguredRooms || !roomNames.includes(rescheduleRoomName) || nextStartAt < new Date()) return;
    const appointmentId = activeAppointmentId;
    void runMutation(() =>
      actions.rescheduleAppointment(appointmentId, {
        staffId: rescheduleStaffId,
        serviceId: rescheduleServiceId,
        serviceIds: rescheduleServiceIds,
        startAt: new Date(rescheduleStartAt).toISOString(),
        endAt: new Date(rescheduleEndAt).toISOString(),
        roomName: rescheduleRoomName,
        note: rescheduleNote,
      }),
    ).then(() => {
      closeAppointmentAction();
      setView("appointments");
    });
  };

  const submitCancel = (event: FormEvent) => {
    event.preventDefault();
    const appointmentId = activeAppointmentId;
    void runMutation(() => actions.updateAppointmentStatus(appointmentId, "已取消", cancelReason)).then(() => {
      closeAppointmentAction();
    });
  };

  const openAppointmentForm = () => {
    const nextRange = nextAppointmentDateTimeRange();
    setCustomerId("");
    setAppointmentCustomerSearch("");
    setAppointmentReviewReady(false);
    setStaffId(defaultAppointmentStaffId);
    setStartAt(nextRange.start);
    setEndAt(nextRange.end);
    setRoomName(roomNames[0] ?? "");
    setNote("");
    setShowAppointmentForm(true);
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

  const lockedServiceStaff = new Set(data.staffUnavailableSlots.filter((slot) => serviceStaffIds.has(slot.staffId)).map((slot) => slot.staffId));
  const availableStaff = Math.max(0, serviceStaff.filter((staff) => staff.status === "active").length - lockedServiceStaff.size);
  const pendingOnlineRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理");
  const maintenanceRoomNames = new Set(maintenanceRoomNamesOf(data, roomNames));
  const appointmentRanges = appointmentRangeMap();
  const selectedAppointmentRange = appointmentRanges[appointmentRange];
  const appointmentNow = new Date();
  const rangeAppointments = filterAppointmentsByRange(data.appointments, appointmentRange)
    .slice()
    .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt));
  const visibleRangeAppointments = rangeAppointments.filter((appointment) => appointment.status !== "已取消" && appointment.status !== "爽约");
  const confirmationPendingAppointments = visibleRangeAppointments.filter((appointment) => appointment.status === "已确认" || appointment.status === "待确认");
  const overdueAppointments = confirmationPendingAppointments.filter((appointment) => appointmentEndAt(appointment, data.services) < appointmentNow);
  const arrivalConfirmationAppointments = confirmationPendingAppointments.filter((appointment) => isAppointmentInArrivalConfirmationWindow(appointment, data.services, appointmentNow));
  const bookedAppointments = confirmationPendingAppointments.filter((appointment) => appointmentArrivalConfirmationWindow(appointment, data.services).opensAt > appointmentNow);
  const arrivedAppointments = visibleRangeAppointments.filter((appointment) => appointment.status === "已到店");
  const completedRangeAppointments = visibleRangeAppointments.filter((appointment) => appointment.status === "已完成");
  const findAppointmentOrder = (appointment: Appointment) =>
    data.orders.find((order) => order.status !== "已退款" && order.appointmentId === appointment.id);
  const findAppointmentSignature = (order: Order | undefined) => {
    if (!order) return undefined;
    const signatures = data.customerSignatures.filter((item) => item.orderId === order.id);
    return signatures.find((item) => item.status === "已签名" && item.title === "服务完成确认签名") ??
      signatures.find((item) => item.status === "已签名") ??
      signatures.find((item) => item.title === "服务完成确认签名") ??
      signatures[0];
  };
  const arrivedServiceSignatureTasks = arrivedAppointments.map((appointment) => {
    const order = findAppointmentOrder(appointment);
    const signature = findAppointmentSignature(order);
    return { appointment, order, signature };
  }).filter((item) => item.signature?.status !== "已签名");
  const completedServiceSignatureTasks = completedRangeAppointments
    .map((appointment) => {
      const order = findAppointmentOrder(appointment);
      const signature = findAppointmentSignature(order);
      return { appointment, order, signature };
    })
    .filter((item): item is { appointment: Appointment; order: Order; signature: CustomerSignature | undefined } =>
      Boolean(item.order && item.signature?.status !== "已签名"),
    );
  const pendingServiceSignatureTasks = [...arrivedServiceSignatureTasks, ...completedServiceSignatureTasks]
    .sort((left, right) => +new Date(left.appointment.startAt) - +new Date(right.appointment.startAt));
  const appointmentHasLinkedSignedOrder = (appointment: Appointment) =>
    findAppointmentSignature(findAppointmentOrder(appointment))?.status === "已签名";
  const effectivelyCompletedRangeAppointments = visibleRangeAppointments
    .filter((appointment) => appointment.status === "已完成" || appointmentHasLinkedSignedOrder(appointment))
    .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt));
  useEffect(() => {
    const initialAppointmentToken = initialAppointmentId ? `${initialAppointmentId}:${initialAppointmentKey}` : undefined;
    if (!initialAppointmentId || appliedInitialAppointmentIdRef.current === initialAppointmentToken) return;
    const targetAppointment = data.appointments.find((appointment) => appointment.id === initialAppointmentId);
    if (!targetAppointment) return;
    appliedInitialAppointmentIdRef.current = initialAppointmentToken;
    setFocusedAppointmentId(targetAppointment.id);
    const targetRange = appointmentRangeForDate(targetAppointment.startAt, appointmentRanges);
    if (targetRange) setAppointmentRange(targetRange);
    if (targetAppointment.status === "已完成" || appointmentHasLinkedSignedOrder(targetAppointment)) {
      setSelectedAppointmentDetailId(targetAppointment.id);
    } else {
      setSelectedAppointmentDetailId("");
    }
    const targetWorkflowKey =
      (targetAppointment.status === "已确认" || targetAppointment.status === "待确认")
        ? appointmentEndAt(targetAppointment, data.services) < appointmentNow
          ? "overdue"
          : isAppointmentInArrivalConfirmationWindow(targetAppointment, data.services, appointmentNow)
            ? "arrival"
            : "booked"
        : pendingServiceSignatureTasks.some((item) => item.appointment.id === targetAppointment.id) || targetAppointment.status === "已到店"
          ? "signature"
          : "";
    if (targetWorkflowKey) {
      setExpandedWorkflowGroups((current) => ({ ...current, [targetWorkflowKey]: true }));
    }
    window.setTimeout(() => {
      const targetElement = Array.from(document.querySelectorAll<HTMLElement>("[data-appointment-id]"))
        .find((element) => element.dataset.appointmentId === targetAppointment.id);
      (targetElement ?? document.querySelector<HTMLElement>(".appointment-range-list"))?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 260);
  }, [
    initialAppointmentId,
    initialAppointmentKey,
    data.appointments,
    data.orders,
    data.customerSignatures,
    appointmentRanges,
    overdueAppointments,
    bookedAppointments,
    arrivalConfirmationAppointments,
    pendingServiceSignatureTasks,
  ]);
  const selectedStartAt = new Date(startAt);
  const selectedEndAt = new Date(endAt);
  const selectedTimeRangeInvalid = Number.isNaN(selectedStartAt.getTime()) || Number.isNaN(selectedEndAt.getTime()) || !(selectedStartAt < selectedEndAt);
  const selectedTimeInPast = !selectedTimeRangeInvalid && selectedStartAt < new Date();
  const selectedTimeLabel = selectedTimeRangeInvalid
    ? "时间段无效"
    : `${shortTime(selectedStartAt.toISOString())}-${shortTime(selectedEndAt.toISOString())}`;
  const selectedStaffAppointmentConflict = !staffId || selectedTimeRangeInvalid || selectedTimeInPast
    ? undefined
    : findStaffAppointmentConflict(data, staffId, selectedStartAt, selectedEndAt);
  const selectedStaffUnavailableConflict = !staffId || selectedTimeRangeInvalid || selectedTimeInPast
    ? undefined
    : findStaffUnavailableConflict(data, staffId, selectedStartAt, selectedEndAt);
  const selectedStaffAppointmentConflictText = staffAppointmentConflictText(data, selectedStaffAppointmentConflict);
  const selectedStaffUnavailableConflictText = staffUnavailableConflictText(data, selectedStaffUnavailableConflict);
  const selectedTimeConflict = Boolean(selectedStaffAppointmentConflict || selectedStaffUnavailableConflict);
  const overlappingRoomAssignments = selectedTimeRangeInvalid || selectedTimeInPast
    ? []
    : assignAppointmentRooms(
        data.appointments
          .filter(isActiveRoomAppointment)
          .filter((appointment) => {
            const appointmentStart = new Date(appointment.startAt);
            const appointmentEnd = appointmentEndAt(appointment, data.services);
            return hasTimeOverlap(selectedStartAt, selectedEndAt, appointmentStart, appointmentEnd);
          }),
        roomNames,
        Array.from(maintenanceRoomNames),
      );
  const roomAvailabilityOptions = roomNames.map((name) => {
    const isMaintenance = maintenanceRoomNames.has(name);
    const conflictAppointment = overlappingRoomAssignments.find((assignment) => assignment.roomName === name)?.appointment;
    const disabled = selectedTimeRangeInvalid || selectedTimeInPast || isMaintenance || Boolean(conflictAppointment);
    const reason = selectedTimeRangeInvalid
      ? "请先填写正确时间段"
      : selectedTimeInPast
        ? "不能预约过去时间"
      : isMaintenance
        ? "维护中"
        : conflictAppointment
          ? `${appointmentTimeRange(data, conflictAppointment)} 已占用`
          : `可预约 ${selectedTimeLabel}`;
    return {
      value: name,
      label: `${name} · ${reason}`,
      disabled,
      conflictAppointment,
      isMaintenance,
      reason,
    };
  });
  const firstAvailableRoom = roomAvailabilityOptions.find((option) => !option.disabled)?.value ?? "";
  const selectedAppointmentStaff = data.staff.find((item) => item.id === staffId);
  const roomIcon = (name: string) => {
    if (/vip/i.test(name)) return <Crown size={18} />;
    if (name.includes("身心")) return <HeartPulse size={18} />;
    if (name.includes("仪器")) return <Sparkles size={18} />;
    if (name.includes("备用")) return <DoorOpen size={18} />;
    return <BedDouble size={18} />;
  };
  useEffect(() => {
    const selectedRoom = roomAvailabilityOptions.find((option) => option.value === roomName);
    if (!selectedRoom || selectedRoom.disabled) setRoomName(firstAvailableRoom);
  }, [firstAvailableRoom, roomAvailabilityOptions, roomName]);
  useEffect(() => {
    if (!roomNames.includes(rescheduleRoomName)) setRescheduleRoomName(roomNames[0] ?? "");
  }, [rescheduleRoomName, roomNames]);
  const rescheduleStartDate = new Date(rescheduleStartAt);
  const rescheduleEndDate = new Date(rescheduleEndAt);
  const rescheduleTimeRangeInvalid = Number.isNaN(rescheduleStartDate.getTime()) || Number.isNaN(rescheduleEndDate.getTime()) || !(rescheduleStartDate < rescheduleEndDate);
  const rescheduleTimeInPast = !rescheduleTimeRangeInvalid && rescheduleStartDate < new Date();
  const appointmentSaveDisabled = !(customerId || resolvedAppointmentCustomer) || appointmentCustomerSearchUnresolved || !staffId || !roomName || selectedTimeRangeInvalid || selectedTimeInPast || !hasConfiguredRooms || !roomNames.includes(roomName);
  const rescheduleSaveDisabled = !rescheduleStaffId || !rescheduleRoomName || rescheduleTimeRangeInvalid || rescheduleTimeInPast || !hasConfiguredRooms || !roomNames.includes(rescheduleRoomName);
  const appointmentDetailAction = (appointment: Appointment) => {
    if (appointment.status === "已完成" || appointmentHasLinkedSignedOrder(appointment)) {
      return (
        <button type="button" onClick={() => setSelectedAppointmentDetailId(appointment.id)}>
          查看详情
        </button>
      );
    }
    return <span>-</span>;
  };
  const appointmentListAction = (appointment: Appointment) => {
    if (appointment.status === "已完成" || appointmentHasLinkedSignedOrder(appointment)) {
      return appointmentDetailAction(appointment);
    }
    if (appointment.status === "已确认" || appointment.status === "待确认") {
      return (
        <>
          <button type="button" disabled={mutationPending} onClick={() => openReschedule(appointment)}>改约</button>
          <button type="button" disabled={mutationPending} onClick={() => openCancel(appointment)}>取消</button>
        </>
      );
    }
    if (appointment.status === "已到店") {
      return (
        <>
          <button type="button" onClick={() => setView("pos", { posModule: "single", appointmentId: appointment.id })}>进入收银</button>
          <button type="button" disabled={mutationPending} onClick={() => openCancel(appointment)}>取消</button>
        </>
      );
    }
    return <span>-</span>;
  };
  const appointmentStatusText = (status: Appointment["status"]) => {
    if (status === "待确认" || status === "已确认") return "已预约";
    if (status === "已到店") return "待确认到店";
    return status;
  };
  const appointmentBadgeTone = (status: Appointment["status"]) =>
    status === "已完成" || status === "已到店" ? "ok" : status === "已取消" || status === "爽约" ? "warn" : undefined;
  const appointmentFocusClass = (appointment: Appointment) => appointment.id === focusedAppointmentId ? " is-notification-target" : "";
  const renderBookedAppointmentCard = (appointment: Appointment) => (
    <article className={`appointment-work-card status-${appointment.status}${appointmentFocusClass(appointment)}`} data-appointment-id={appointment.id} key={appointment.id}>
      <div className="appointment-work-card-main">
        <time>{appointmentTimeRange(data, appointment)}</time>
        <Badge text="已预约" />
        <strong>{nameOf(data.customers, appointment.customerId)}</strong>
        <span>{appointmentServiceNames(data, appointment)} · {nameOf(data.staff, appointment.staffId)}</span>
        <small>{appointment.roomName ?? "未分配房间"}{appointment.note ? ` · ${appointment.note}` : ""}</small>
      </div>
      <div className="appointment-work-card-actions">
        <button type="button" disabled={mutationPending} onClick={() => openReschedule(appointment)}>改约</button>
        <button type="button" disabled={mutationPending} onClick={() => openCancel(appointment)}>取消</button>
      </div>
    </article>
  );
  const renderCheckInAppointmentCard = (appointment: Appointment, isOverdue = false) => (
    <article className={`appointment-work-card ${isOverdue ? "status-overdue " : ""}status-${appointment.status}${appointmentFocusClass(appointment)}`} data-appointment-id={appointment.id} key={appointment.id}>
      <div className="appointment-work-card-main">
        <time>{appointmentTimeRange(data, appointment)}</time>
        <Badge text={isOverdue ? "已过期" : "待确认到店"} tone={isOverdue ? "warn" : "ok"} />
        <strong>{nameOf(data.customers, appointment.customerId)}</strong>
        <span>{appointmentServiceNames(data, appointment)} · {nameOf(data.staff, appointment.staffId)}</span>
        <small>
          {appointment.roomName ?? "未分配房间"}
          {isOverdue ? " · 已超过预约结束时间" : appointment.note ? ` · ${appointment.note}` : ""}
        </small>
      </div>
      <div className="appointment-work-card-actions">
        <button type="button" disabled={mutationPending} onClick={() => setStatus(appointment.id, "已到店")}>
          确认到店
        </button>
        {isOverdue && <button type="button" disabled={mutationPending} onClick={() => setStatus(appointment.id, "爽约")}>
          标记爽约
        </button>}
        {isOverdue && <button type="button" disabled={mutationPending} onClick={() => openReschedule(appointment)}>改约</button>}
        <button type="button" disabled={mutationPending} onClick={() => openCancel(appointment)}>{isOverdue ? "取消" : "删除/取消"}</button>
      </div>
    </article>
  );
  const signatureUrl = (token: string) => `${window.location.origin}/signature/${token}`;
  const openSignaturePage = (token: string) => {
    window.location.assign(signatureUrl(token));
  };
  const createServiceSignature = (appointment: Appointment, order: Order) => {
    void runMutation(() =>
      actions.createCustomerSignature({
        customerId: appointment.customerId,
        orderId: order.id,
        title: "服务完成确认签名",
        content: `${nameOf(data.customers, appointment.customerId)} 确认本次到店服务、消费项目、支付金额和服务结果无误。`,
        validDays: 7,
      }),
    ).then((nextData) => {
      const nextSignature = nextData.customerSignatures.find(
        (item) => item.orderId === order.id && item.title === "服务完成确认签名" && item.status === "待签名",
      );
      if (nextSignature) openSignaturePage(nextSignature.token);
    });
  };
  const renderServiceSignatureCard = ({ signature, order, appointment }: { signature: CustomerSignature | undefined; order?: Order; appointment: Appointment }) => (
    <article className={`appointment-work-card status-待签名${appointmentFocusClass(appointment)}`} data-appointment-id={appointment.id} key={signature?.id ?? appointment.id}>
      <div className="appointment-work-card-main">
        <time>{appointmentTimeRange(data, appointment)}</time>
        <Badge text={signature?.status === "已签名" ? "已签名" : signature ? "待服务签名" : order ? "待生成签名" : "已到店待服务"} tone="warn" />
        <strong>{nameOf(data.customers, appointment.customerId)}</strong>
        <span>{order ? order.serviceName ?? nameOf(data.services, order.serviceId) : appointmentServiceNames(data, appointment)} · {nameOf(data.staff, order?.staffId ?? appointment.staffId)}</span>
        <small>{appointment.roomName ?? "未分配房间"}{order ? ` · ${order.orderNo}` : " · 已确认到店"}</small>
      </div>
      <div className="appointment-work-card-actions">
        {signature?.status === "待签名" && <button type="button" onClick={() => openSignaturePage(signature.token)}>打开签名</button>}
        {!signature && order && (
          <button type="button" disabled={mutationPending} onClick={() => createServiceSignature(appointment, order)}>
            生成签名
          </button>
        )}
        {!signature && !order && (
          <button type="button" onClick={() => setView("pos", { posModule: "single", appointmentId: appointment.id })}>
            进入收银生成签名
          </button>
        )}
        {!order && <button type="button" disabled={mutationPending} onClick={() => openCancel(appointment)}>删除/取消</button>}
        {appointment.status === "已完成" && <button type="button" onClick={() => setSelectedAppointmentDetailId(appointment.id)}>查看详情</button>}
      </div>
    </article>
  );
  const renderWorkflowItems = <T,>(key: string, items: T[], renderItem: (item: T) => ReactNode) => {
    const expanded = Boolean(expandedWorkflowGroups[key]);
    const visibleItems = expanded ? items : items.slice(0, APPOINTMENT_WORKFLOW_PREVIEW_LIMIT);
    const hiddenCount = Math.max(0, items.length - APPOINTMENT_WORKFLOW_PREVIEW_LIMIT);
    return (
      <>
        {visibleItems.map(renderItem)}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="appointment-workflow-more-button"
            onClick={() => setExpandedWorkflowGroups((current) => ({ ...current, [key]: !expanded }))}
          >
            {expanded ? "收起预约" : `更多预约 ${hiddenCount} 条`}
          </button>
        )}
      </>
    );
  };
  const appointmentWorkflowGroups = [
    {
      key: "booked",
      title: "已预约",
      value: bookedAppointments.length,
      renderItems: () => renderWorkflowItems("booked", bookedAppointments, renderBookedAppointmentCard),
      empty: "暂无已预约",
    },
    {
      key: "arrival",
      title: "待确认到店",
      value: arrivalConfirmationAppointments.length,
      renderItems: () => renderWorkflowItems("arrival", arrivalConfirmationAppointments, (appointment) => renderCheckInAppointmentCard(appointment)),
      empty: "暂无待确认到店",
    },
    {
      key: "signature",
      title: "待服务签名",
      value: pendingServiceSignatureTasks.length,
      renderItems: () => renderWorkflowItems("signature", pendingServiceSignatureTasks, renderServiceSignatureCard),
      empty: "暂无待签名服务",
    },
  ];
  const activeAppointment = data.appointments.find((appointment) => appointment.id === activeAppointmentId);
  const selectedCompletedAppointment = effectivelyCompletedRangeAppointments.find((appointment) => appointment.id === selectedAppointmentDetailId);
  const selectedCompletedOrder = selectedCompletedAppointment
    ? findAppointmentOrder(selectedCompletedAppointment)
    : undefined;
  const selectedCompletedSignature = selectedCompletedOrder
    ? findAppointmentSignature(selectedCompletedOrder)
    : undefined;

  return (
    <div className="page-stack appointment-room-page">
      <PageHero
        icon={<CalendarDays size={15} />}
        eyebrow="预约管理"
        title="预约管理"
      />
      <div className="module-detail-stack">
        <section className="panel appointment-workbench-panel">
          <div className="appointment-workbench-head appointment-workbench-controls">
            <div className="appointment-workbench-summary" aria-label={`${selectedAppointmentRange.label}预约概览`}>
              <em><CalendarDays size={13} />预约 {visibleRangeAppointments.length}</em>
              <em><DoorOpen size={13} />待到店 {arrivalConfirmationAppointments.length}</em>
              <em><Pencil size={13} />待签名 {pendingServiceSignatureTasks.length}</em>
            </div>
            <div className="appointment-range-tabs" aria-label="预约日期筛选">
              {(["today", "tomorrow", "week"] as AppointmentRange[]).map((range) => (
                <button
                  type="button"
                  key={range}
                  className={appointmentRange === range ? "active" : undefined}
                  aria-pressed={appointmentRange === range}
                  onClick={() => setAppointmentRange(range)}
                >
                  {appointmentRanges[range].label}
                </button>
              ))}
            </div>
            <button type="button" className="appointment-room-add-button" onClick={openAppointmentForm}>
              <CalendarDays size={18} />
              新增预约
            </button>
          </div>
          <div className="appointment-workflow-grid">
            {appointmentWorkflowGroups.map((group) => (
              <section className={`appointment-workflow-column ${group.key}`} key={group.key}>
                <div className="appointment-workflow-title">
                  <div>
                    <strong>{group.title}</strong>
                  </div>
                  <em>{group.value}</em>
                </div>
                <div className="appointment-workflow-list">
                  {group.renderItems()}
                  {group.value === 0 && (
                    <div className="appointment-work-empty">{group.empty}</div>
                  )}
                </div>
              </section>
            ))}
          </div>
          {overdueAppointments.length > 0 && (
            <section className="appointment-overdue-section" aria-label="过期待处理">
              <div className="appointment-overdue-head">
                <div>
                  <strong>过期待处理</strong>
                  <span>超过预约结束时间仍未确认到店，需要尽快处理</span>
                </div>
                <em>{overdueAppointments.length}</em>
              </div>
              <div className="appointment-overdue-list">
                {renderWorkflowItems("overdue", overdueAppointments, (appointment) => renderCheckInAppointmentCard(appointment, true))}
              </div>
            </section>
          )}
          <div className="appointment-range-list">
            <div className="appointment-room-list-head">
              <strong>{selectedAppointmentRange.label}预约明细</strong>
              <small>共 {visibleRangeAppointments.length} 单 · 已完成 {effectivelyCompletedRangeAppointments.length} 单</small>
            </div>
            {visibleRangeAppointments.length > 0 ? (
              <DataTable
                columns={["时间", "客户", "项目", "服务人员", "房间", "状态", "操作"]}
                rows={visibleRangeAppointments.slice(0, 60).map((appointment) => {
                  const order = findAppointmentOrder(appointment);
                  const effectivelyCompleted = appointment.status === "已完成" || appointmentHasLinkedSignedOrder(appointment);
                  return {
                    key: appointment.id,
                    className: appointment.id === focusedAppointmentId ? "is-notification-target" : undefined,
                    dataAttributes: { "data-appointment-id": appointment.id },
                    cells: [
                      appointmentTimeRange(data, appointment),
                      nameOf(data.customers, appointment.customerId),
                      effectivelyCompleted ? appointmentConsumptionNames(data, appointment, order) : appointmentServiceNames(data, appointment),
                      nameOf(data.staff, order?.staffId ?? appointment.staffId),
                      appointment.roomName ?? "-",
                      <Badge key={`${appointment.id}-status`} text={effectivelyCompleted ? "已完成" : appointmentStatusText(appointment.status)} tone={effectivelyCompleted ? "ok" : appointmentBadgeTone(appointment.status)} />,
                      <div key={`${appointment.id}-action`} className="table-action">
                        {appointmentListAction(appointment)}
                      </div>,
                    ],
                  };
                })}
              />
            ) : (
              <div className="appointment-work-empty">当前范围暂无预约记录</div>
            )}
            {selectedCompletedAppointment && (
              <div className={`appointment-completed-detail${selectedCompletedAppointment.id === focusedAppointmentId ? " is-notification-target" : ""}`} data-appointment-id={selectedCompletedAppointment.id}>
                <div className="appointment-completed-detail-head">
                  <strong>预约完成详情</strong>
                  <button type="button" onClick={() => setSelectedAppointmentDetailId("")}>收起</button>
                </div>
                <dl>
                  <div><dt>客户</dt><dd>{nameOf(data.customers, selectedCompletedAppointment.customerId)}</dd></div>
                  <div><dt>消费项目</dt><dd>{appointmentConsumptionNames(data, selectedCompletedAppointment, selectedCompletedOrder)}</dd></div>
                  <div><dt>服务人员</dt><dd>{nameOf(data.staff, selectedCompletedOrder?.staffId ?? selectedCompletedAppointment.staffId)}</dd></div>
                  <div><dt>房间</dt><dd>{selectedCompletedAppointment.roomName ?? "-"}</dd></div>
                  <div><dt>预约时间</dt><dd>{appointmentTimeRange(data, selectedCompletedAppointment)}</dd></div>
                  <div><dt>完成时间</dt><dd>{selectedCompletedAppointment.completedAt ? shortDate(selectedCompletedAppointment.completedAt) : selectedCompletedSignature?.signedAt ? shortDate(selectedCompletedSignature.signedAt) : selectedCompletedOrder ? shortDate(selectedCompletedOrder.createdAt) : "-"}</dd></div>
                  <div><dt>订单编号</dt><dd>{selectedCompletedOrder?.orderNo ?? "-"}</dd></div>
                  <div><dt>支付方式</dt><dd>{selectedCompletedOrder?.payMethod ?? "-"}</dd></div>
                  <div><dt>实收/扣款</dt><dd>{selectedCompletedOrder ? money(selectedCompletedOrder.paidAmount) : "-"}</dd></div>
                  <div><dt>签名状态</dt><dd>{selectedCompletedSignature?.status ?? "-"}</dd></div>
                </dl>
                {selectedCompletedSignature?.signatureText && (
                  <div className="appointment-completed-signature">
                    <strong>客户签名</strong>
                    <img src={selectedCompletedSignature.signatureText} alt="客户签名" />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <Modal
        open={showAppointmentForm}
        title="新增预约"
        subtitle="选择预约时间后，系统会自动筛选可用房间"
        size="large"
        className="appointment-create-modal"
        onClose={() => setShowAppointmentForm(false)}
      >
        <div className="module-detail-stack appointment-modal-detail">
          <form className="form appointment-create-form" onSubmit={addAppointment}>
            <div className="checkout-customer-search">
              <label>
                客户
                <input
                  ref={appointmentCustomerSearchInputRef}
                  autoComplete="off"
                  inputMode="search"
                  value={appointmentCustomerSearch}
                  {...searchInputSync(updateAppointmentCustomerSearch)}
                  placeholder={selectedAppointmentCustomer ? customerDisplayLabel(selectedAppointmentCustomer) : "输入客户姓名或手机号搜索"}
                />
              </label>
              {selectedAppointmentCustomer && !appointmentCustomerSearchUnresolved && (
                <div className="checkout-selected-customer">
                  <span>已选择客户</span>
                  <strong>{customerDisplayLabel(selectedAppointmentCustomer)}</strong>
                </div>
              )}
              {appointmentCustomerSearchUnresolved && (
                <p className="checkout-customer-warning">请从下方搜索结果中点选客户，不能只输入姓名保存。</p>
              )}
              {!selectedAppointmentCustomer && !normalizedAppointmentCustomerSearch && (
                <p className="checkout-customer-warning">新增预约必须先搜索并点选客户，避免默认客户误提交。</p>
              )}
              {normalizedAppointmentCustomerSearch && appointmentCustomerSearchUnresolved && (
                <div className="checkout-customer-result-list">
                  {appointmentCustomerSearchResults.length ? appointmentCustomerSearchResults.map((customer) => (
                    <button
                      type="button"
                      key={customer.id}
                      className={customer.id === customerId ? "active" : ""}
                      onClick={() => selectAppointmentCustomer(customer)}
                    >
                      <strong>{customer.name}</strong>
                      <span>{customer.phone || "未留手机号"}</span>
                    </button>
                  )) : (
                    <div className="checkout-customer-empty">没有找到客户，请先到客户档案建档。</div>
                  )}
                </div>
              )}
            </div>
            <Select
              label="服务人员"
              value={staffId}
              onChange={setStaffId}
              options={appointmentStaffOptions.length ? appointmentStaffOptions : [{ value: "", label: "请先到人员账号新增人员" }]}
            />
            <div className="appointment-time-grid">
              <DateTimeInput label="开始时间" value={startAt} onChange={setStartAt} minDateTime={minAppointmentDateTime} />
              <DateTimeInput label="结束时间" value={endAt} onChange={setEndAt} minDateTime={startAt > minAppointmentDateTime ? startAt : minAppointmentDateTime} />
            </div>
            <div className="appointment-room-slot-section">
              <div className="appointment-room-list-head">
                <strong>房间</strong>
                <small>{selectedTimeLabel}</small>
              </div>
              <div className="appointment-room-slot-grid">
                {roomAvailabilityOptions.length ? roomAvailabilityOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`appointment-room-slot-button ${roomName === option.value ? "selected" : ""} ${option.disabled ? "disabled" : ""}`}
                    disabled={option.disabled}
                    onClick={() => setRoomName(option.value)}
                  >
                    <span className="appointment-room-slot-icon" aria-hidden="true">
                      {roomIcon(option.value)}
                    </span>
                    <span className="appointment-room-slot-text">
                      <strong>{option.value}</strong>
                      <span>{option.reason}</span>
                    </span>
                  </button>
                )) : (
                  <div className="checkout-product-empty">请先到房间管理配置预约房间</div>
                )}
              </div>
            </div>
            <div className="appointment-room-choice-note">
              <strong>可预约</strong>
              <span>{roomAvailabilityOptions.filter((option) => !option.disabled).map((option) => option.value).join("、") || "暂无可用房间"}</span>
            </div>
            <label>
              备注
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="客户偏好、到店提醒等" />
            </label>
            {selectedTimeRangeInvalid && <p className="form-warning">结束时间必须晚于开始时间。</p>}
            {selectedTimeInPast && <p className="form-warning">预约时间不能早于当前时间，请重新选择。</p>}
            {selectedStaffAppointmentConflictText && <p className="form-warning">{selectedStaffAppointmentConflictText}</p>}
            {selectedStaffUnavailableConflictText && <p className="form-warning">{selectedStaffUnavailableConflictText}</p>}
            {!hasConfiguredRooms && <p className="form-warning">当前门店还没有可用于预约的房间，请先到房间管理配置。</p>}
            {appointmentReviewReady && selectedAppointmentCustomer && selectedAppointmentStaff && !selectedTimeRangeInvalid && (
              <div className="appointment-confirm-panel">
                <strong>请核对预约信息</strong>
                <span>客户：{customerDisplayLabel(selectedAppointmentCustomer)}</span>
                <span>服务人员：{selectedAppointmentStaff.name}</span>
                <span>时间：{shortDate(selectedStartAt.toISOString())}-{shortTime(selectedEndAt.toISOString())}</span>
                <span>房间：{roomName}</span>
                <small>再次点击“确认保存预约”后才会创建预约记录。</small>
              </div>
            )}
            <div className="row-actions">
              <SubmitStatusButton idleText={appointmentReviewReady ? "确认保存预约" : "核对预约"} busyText="保存中..." disabled={appointmentSaveDisabled} />
              <button type="button" onClick={() => { setAppointmentReviewReady(false); setShowAppointmentForm(false); }}>取消</button>
            </div>
          </form>
        </div>
      </Modal>
      <Modal
        open={activeAppointmentAction === "reschedule"}
        title="改约"
        subtitle={activeAppointment ? `${nameOf(data.customers, activeAppointment.customerId)} · ${appointmentTimeRange(data, activeAppointment)}` : "调整预约时间和房间"}
        size="large"
        onClose={closeAppointmentAction}
      >
        <form className="form appointment-action-form" onSubmit={submitReschedule}>
          <Select
            label="服务人员"
            value={rescheduleStaffId}
            onChange={setRescheduleStaffId}
            options={appointmentStaffOptions.length ? appointmentStaffOptions : [{ value: "", label: "请先新增人员" }]}
          />
          <div className="appointment-time-grid">
            <DateTimeInput label="开始时间" value={rescheduleStartAt} onChange={setRescheduleStartAt} minDateTime={minAppointmentDateTime} />
            <DateTimeInput label="结束时间" value={rescheduleEndAt} onChange={setRescheduleEndAt} minDateTime={rescheduleStartAt > minAppointmentDateTime ? rescheduleStartAt : minAppointmentDateTime} />
          </div>
          <Select label="房间" value={rescheduleRoomName} onChange={setRescheduleRoomName} options={roomNames.length ? roomNames.map((name) => ({ value: name, label: name })) : [{ value: "", label: "请先到房间管理配置预约房间" }]} />
          <label>
            备注
            <textarea value={rescheduleNote} onChange={(event) => setRescheduleNote(event.target.value)} placeholder="改约原因或客户偏好" />
          </label>
          {rescheduleTimeRangeInvalid && <p className="form-warning">改约结束时间必须晚于开始时间。</p>}
          {rescheduleTimeInPast && <p className="form-warning">改约时间不能早于当前时间，请重新选择。</p>}
          <div className="row-actions">
            <SubmitStatusButton idleText="保存改约" busyText="保存中..." disabled={rescheduleSaveDisabled} />
            {!hasConfiguredRooms && <button type="button" onClick={() => { closeAppointmentAction(); setView("roomSettings"); }}>房间管理</button>}
            <button type="button" onClick={closeAppointmentAction}>取消</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={activeAppointmentAction === "cancel"}
        title="取消预约"
        subtitle={activeAppointment ? `${nameOf(data.customers, activeAppointment.customerId)} · ${appointmentTimeRange(data, activeAppointment)}` : "取消预约必须填写原因"}
        onClose={closeAppointmentAction}
      >
        <form className="form appointment-action-form" onSubmit={submitCancel}>
          <label>
            取消原因
            <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="如客户临时取消、改期未定等" />
          </label>
          <div className="row-actions">
            <SubmitStatusButton idleText="确认取消" busyText="处理中..." disabled={!cancelReason.trim()} />
            <button type="button" onClick={closeAppointmentAction}>返回</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Pos({
  data,
  session,
  actions,
  runMutation,
  fromManagement = false,
  initialModule,
  initialAppointmentId,
  initialCustomerId,
  initialSignatureId,
  initialEntryKey = 0,
  onReturnManagement,
  onReturnAppointments,
}: {
  data: AppData;
  session: UserSession;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  initialModule?: PosModuleKey;
  initialAppointmentId?: string;
  initialCustomerId?: string;
  initialSignatureId?: string;
  initialEntryKey?: number;
  onReturnManagement?: () => void;
  onReturnAppointments?: () => void;
}) {
  const mutationPending = useMutationPending();
  const serviceStaff = activeStaffOf(data);
  const initialCheckoutAppointment = initialAppointmentId ? data.appointments.find((appointment) => appointment.id === initialAppointmentId) : undefined;
  const normalizePosModule = (module: PosModuleKey | undefined): PosModuleKey | undefined => module;
  const [appointmentId, setAppointmentId] = useState(initialCheckoutAppointment?.id ?? "");
  const [checkoutCustomerMode, setCheckoutCustomerMode] = useState<"customer" | "walkin">(initialCheckoutAppointment ? "customer" : "walkin");
  const [checkoutContentMode, setCheckoutContentMode] = useState<"service" | "product">("service");
  const [customerSearch, setCustomerSearch] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [customerId, setCustomerId] = useState(initialCheckoutAppointment?.customerId ?? data.customers[0]?.id ?? "");
  const initialCheckoutServiceIds = initialCheckoutAppointment ? appointmentServiceIds(initialCheckoutAppointment) : [];
  const [checkoutServiceIds, setCheckoutServiceIds] = useState<string[]>(initialCheckoutServiceIds);
  const [staffId, setStaffId] = useState(initialCheckoutAppointment?.staffId ?? firstActiveStaffId(data));
  const [collaboratorStaffIds, setCollaboratorStaffIds] = useState<string[]>([]);
  const [checkoutProductItems, setCheckoutProductItems] = useState<CheckoutCartItem[]>([]);
  const [checkoutGiftItems, setCheckoutGiftItems] = useState<CheckoutCartItem[]>([]);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [servicePickerCategory, setServicePickerCategory] = useState("全部");
  const [servicePickerSearch, setServicePickerSearch] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerMode, setProductPickerMode] = useState<"sale" | "gift">("sale");
  const [productPickerCategory, setProductPickerCategory] = useState("全部");
  const [productPickerSubcategory, setProductPickerSubcategory] = useState("全部小类");
  const [productPickerSearch, setProductPickerSearch] = useState("");
  const [payMethod, setPayMethod] = useState<Order["payMethod"]>("微信");
  const [cardId, setCardId] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [checkoutDiscountRateInput, setCheckoutDiscountRateInput] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [selectedCashierRecordId, setSelectedCashierRecordId] = useState("");
  const [checkoutValidationMessages, setCheckoutValidationMessages] = useState<string[]>([]);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutSuccessMessage, setCheckoutSuccessMessage] = useState("");
  const [cardFormMessage, setCardFormMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const checkoutSubmittingRef = useRef(false);
  const checkoutRequestIdRef = useRef(makeId("checkout"));
  const appliedInitialAppointmentRef = useRef<string | undefined>(undefined);
  const appliedInitialCustomerRef = useRef<string | undefined>(undefined);
  const appliedInitialSignatureRef = useRef<string | undefined>(undefined);
  const cardCustomerDraftTouchedRef = useRef(false);
  const cardCustomerNameInputRef = useRef<HTMLInputElement | null>(null);
  const cardCustomerPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const cardNameInputRef = useRef<HTMLInputElement | null>(null);
  const [cardCustomerMode, setCardCustomerMode] = useState<CardCustomerMode>("new");
  const [cardCustomerName, setCardCustomerName] = useState("");
  const [cardCustomerPhone, setCardCustomerPhone] = useState("");
  const [cardCustomerBirthday, setCardCustomerBirthday] = useState("");
  const [cardCustomerNote, setCardCustomerNote] = useState("");
  const [cardName, setCardName] = useState(DEFAULT_PROJECT_CARD_NAME);
  const [cardType, setCardType] = useState<CardType>("储值卡");
  const [cardAmount, setCardAmount] = useState<EditableNumber>(5000);
  const [cardPaidAmount, setCardPaidAmount] = useState<EditableNumber>(5000);
  const [cardPayMethod, setCardPayMethod] = useState<CashPayMethod>("微信");
  const [cardTimes, setCardTimes] = useState<EditableNumber>(10);
  const [cardDiscountRate, setCardDiscountRate] = useState<EditableNumber>(9);
  const [cardServiceId, setCardServiceId] = useState(data.services[0]?.id ?? "");
  const [cardServiceIds, setCardServiceIds] = useState<string[]>(data.services[0]?.id ? [data.services[0].id] : []);
  const [cardServiceTimes, setCardServiceTimes] = useState<Record<string, EditableNumber>>(() => (
    data.services[0]?.id ? { [data.services[0].id]: data.services[0].defaultTimes || 10 } : {}
  ));
  const [cardExpiresAt, setCardExpiresAt] = useState(addMonthsInputValue(12));
  const [cardNote, setCardNote] = useState("");
  const [selectedSignatureId, setSelectedSignatureId] = useState("");
  const [signatureSignerName, setSignatureSignerName] = useState("");
  const [signatureMessage, setSignatureMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const [hasSignatureDrawing, setHasSignatureDrawing] = useState(false);
  const [signatureNow, setSignatureNow] = useState(() => Date.now());
  const [activeModule, setActiveModule] = useState<PosModuleKey | undefined>(() => normalizePosModule(fromManagement ? initialModule ?? "single" : initialModule));
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);
  const cardAmountValue = editableNumberValue(cardAmount);
  const cardPaidAmountValue = editableNumberValue(cardPaidAmount);
  const cardTimesValue = editableNumberValue(cardTimes);
  const cardDiscountRateValue = editableNumberValue(cardDiscountRate);
  const sellableProducts = data.products;
  const usesCustomer = checkoutCustomerMode === "customer";
  const usesService = checkoutContentMode === "service";
  const usesProduct = checkoutContentMode === "product";
  const checkoutStaff = serviceStaff;
  const staffOptions = checkoutStaff.map(optionOf);
  const selectedCustomer = data.customers.find((item) => item.id === customerId);
  const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
  const customerSearchResults = normalizedCustomerSearch
    ? data.customers
        .filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(normalizedCustomerSearch))
        .slice(0, 8)
    : [];
  const customerSearchUnresolved = Boolean(
    usesCustomer &&
      customerSearch.trim() &&
      (!selectedCustomer || !customerMatchesSearchText(selectedCustomer, customerSearch)),
  );
  const checkoutCustomerSelectionInvalid = usesCustomer && (!customerId || customerSearchUnresolved);

  useEffect(() => {
    const firstStaffId = checkoutStaff[0]?.id ?? "";
    if (!checkoutStaff.some((staff) => staff.id === staffId)) setStaffId(firstStaffId);
    setCollaboratorStaffIds((previous) => {
      const next = previous.filter((id) => serviceStaff.some((staff) => staff.id === id) && id !== staffId);
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [checkoutStaff, serviceStaff, staffId]);

  useEffect(() => {
    if (!checkoutSuccessMessage) return;
    const timer = window.setTimeout(() => setCheckoutSuccessMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [checkoutSuccessMessage]);

  useEffect(() => {
    if (activeModule !== "signature") return;
    setSignatureNow(Date.now());
    const timer = window.setInterval(() => setSignatureNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [activeModule]);

  useEffect(() => {
    const validProductIds = new Set(sellableProducts.map((product) => product.id));
    const keepValidItems = (items: CheckoutCartItem[]) => {
      const next = items.filter((item) => validProductIds.has(item.productId));
      return next.length === items.length ? items : next;
    };
    if (!usesCustomer) {
      setAppointmentId("");
      setCardId("");
      if (payMethod === "会员卡") setPayMethod("微信");
    }
    if (!usesService) {
      setAppointmentId("");
      setCollaboratorStaffIds([]);
      setCardId("");
      setCheckoutServiceIds((ids) => (ids.length ? [] : ids));
      setServicePickerOpen(false);
    }
    if (!usesProduct) {
      setCheckoutProductItems((items) => (items.length ? [] : items));
      setCheckoutGiftItems((items) => (items.length ? [] : items));
      setProductPickerOpen(false);
      setCheckoutDiscountRateInput("");
      setDiscountAmount(0);
      return;
    }
    setCheckoutProductItems(keepValidItems);
    setCheckoutGiftItems(keepValidItems);
  }, [payMethod, sellableProducts, usesCustomer, usesProduct, usesService]);

  const availableCards = usesCustomer
    ? data.memberCards.filter((item) => {
        if (item.customerId !== customerId || item.status !== "正常") return false;
        if (item.type === "折扣卡") return false;
        return usesService || item.type === "储值卡";
      })
    : [];
  const checkoutProductRows = checkoutProductItems
    .map((item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId);
      return product ? { ...item, product, amount: product.price * item.quantity } : undefined;
    })
    .filter((item): item is CheckoutCartItem & { product: Product; amount: number } => Boolean(item));
  const checkoutGiftRows = checkoutGiftItems
    .map((item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId);
      return product ? { ...item, product } : undefined;
    })
    .filter((item): item is CheckoutCartItem & { product: Product } => Boolean(item));
  const productSubtotal = checkoutProductRows.reduce((sum, item) => sum + item.amount, 0);
  const selectedServices = checkoutServiceIds
    .map((serviceId) => data.services.find((service) => service.id === serviceId))
    .filter((service): service is Service => Boolean(service));
  const selectedServiceRows = Array.from(
    selectedServices.reduce((rows, service) => {
      const current = rows.get(service.id);
      rows.set(service.id, {
        service,
        quantity: (current?.quantity ?? 0) + 1,
      });
      return rows;
    }, new Map<string, { service: Service; quantity: number }>()).values(),
  );
  const serviceSubtotal = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const focusedCheckoutServiceId = usesService ? selectedServiceRows[0]?.service.id : undefined;
  const selectedCustomerCheckoutCards = usesCustomer
    ? data.memberCards.filter((card) => card.customerId === customerId && card.status === "正常")
    : [];
  const selectedCustomerDebitCards = selectedCustomerCheckoutCards.filter((card) => card.type !== "折扣卡");
  const selectedCustomerProjectCards = selectedCustomerCheckoutCards.filter((card) => card.type !== "储值卡" && memberCardPurchasedServiceIds(card).length > 0);
  const selectedCustomerStoredValueCards = selectedCustomerCheckoutCards.filter((card) => card.type === "储值卡");
  const selectedCustomerStoreServices = data.services.filter((service) =>
    service.status !== "停用"
    && (!selectedCustomer?.storeId || !service.storeId || service.storeId === selectedCustomer.storeId),
  );
  const selectedCustomerProjectServiceIds = new Set(selectedCustomerProjectCards.flatMap(memberCardPurchasedServiceIds));
  const selectedCustomerSelectableServiceIds = new Set(
    selectedCustomerStoredValueCards.length
      ? selectedCustomerStoreServices.map((service) => service.id)
      : Array.from(selectedCustomerProjectServiceIds),
  );
  const selectedCustomerSelectableServiceIdsKey = Array.from(selectedCustomerSelectableServiceIds).sort().join("|");
  const checkoutAutoDebitPlan = buildUiMemberCardDebitPlan(
    selectedCustomerProjectCards,
    selectedServices.map((service) => service.id),
    data.services,
  );
  const checkoutAutoDebitCoveredQuantity = checkoutAutoDebitPlan.reduce((sum, row) => sum + row.quantity, 0);
  const checkoutAutoDebitRequiredQuantity = selectedServices.length;
  const checkoutAutoDebitCoversOrder = checkoutAutoDebitRequiredQuantity === 0 || checkoutAutoDebitCoveredQuantity >= checkoutAutoDebitRequiredQuantity;
  const checkoutRelevantProjectCards = selectedCustomerProjectCards.filter((card) =>
    selectedServices.some((service) => signatureMemberCardSupportsService(card, service.id)),
  );
  const checkoutAutoDebitShortfalls = selectedServiceRows
    .map(({ service, quantity }) => {
      const covered = checkoutAutoDebitPlan
        .filter((row) => row.service.id === service.id)
        .reduce((sum, row) => sum + row.quantity, 0);
      if (covered >= quantity) return "";
      const available = checkoutRelevantProjectCards
        .filter((card) => signatureMemberCardSupportsService(card, service.id))
        .reduce((sum, card) => sum + signatureMemberCardRemainingForService(card, service.id), 0);
      return `${service.name} 剩余${available}次，本单需${quantity}次`;
    })
    .filter(Boolean);
  const checkoutCardSelectedServiceText = (card: AppData["memberCards"][number]) => {
    if (!usesService || selectedServiceRows.length === 0) return memberCardTimesText(card, data.services);
    return selectedServiceRows
      .map(({ service, quantity }) => `${service.name} 需${quantity}份 / ${memberCardTimesText(card, data.services, service.id)}`)
      .join("；");
  };
  const checkoutCardServiceUsageRows = (card: AppData["memberCards"][number]) => {
    if (card.type === "储值卡") {
      return [{
        key: `${card.id}:balance`,
        name: "储值余额",
        scopeText: "全店可用",
        remainingText: money(card.balance),
        requiredText: selectedServiceRows.length ? `本单 ${money(checkoutDiscountedPrice)}` : "未选择项目",
        statusText: checkoutDiscountedPrice > 0 && card.balance < checkoutDiscountedPrice ? "余额不足" : "可用",
        blocked: checkoutDiscountedPrice > 0 && card.balance < checkoutDiscountedPrice,
      }];
    }
    const entitlementMap = new Map((card.serviceEntitlements ?? []).map((item) => [item.serviceId, item]));
    const scopedServiceIds = card.serviceEntitlements?.length
      ? card.serviceEntitlements.map((item) => item.serviceId)
      : card.serviceIds?.length
        ? card.serviceIds
        : card.serviceId
          ? [card.serviceId]
          : [];
    const rows = selectedServiceRows.length
      ? selectedServiceRows.map(({ service, quantity }) => {
          const entitlement = entitlementMap.get(service.id);
          const supports = card.serviceEntitlements?.length
            ? Boolean(entitlement)
            : scopedServiceIds.length
              ? scopedServiceIds.includes(service.id)
              : true;
          const remainingTimes = entitlement?.remainingTimes ?? (supports ? card.remainingTimes : 0);
          return {
            key: `${card.id}:${service.id}`,
            name: service.name,
            scopeText: supports ? "本单可用" : "不可用于本项目",
            remainingText: entitlement ? `${entitlement.remainingTimes}/${entitlement.totalTimes}次` : `${remainingTimes}次`,
            requiredText: `本单需 ${quantity} 次`,
            statusText: supports && remainingTimes >= quantity ? "够扣" : "不足",
            blocked: !supports || remainingTimes < quantity,
          };
        })
      : scopedServiceIds.map((serviceId) => {
          const entitlement = entitlementMap.get(serviceId);
          return {
            key: `${card.id}:${serviceId}`,
            name: nameOf(data.services, serviceId),
            scopeText: "可用项目",
            remainingText: entitlement ? `${entitlement.remainingTimes}/${entitlement.totalTimes}次` : `${card.remainingTimes}次`,
            requiredText: "待选择",
            statusText: "可用",
            blocked: false,
          };
        });
    return rows.length ? rows : [{
      key: `${card.id}:general`,
      name: "通用项目",
      scopeText: "全店可用",
      remainingText: `${card.remainingTimes}次`,
      requiredText: selectedServiceRows.length ? `本单 ${selectedServiceRows.reduce((sum, row) => sum + row.quantity, 0)} 次` : "待选择",
      statusText: card.remainingTimes > 0 ? "可用" : "不足",
      blocked: card.remainingTimes <= 0,
    }];
  };
  useEffect(() => {
    if (!usesService || !usesCustomer) return;
    setCheckoutServiceIds((ids) => {
      const next = ids.filter((id) => selectedCustomerSelectableServiceIds.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [selectedCustomerSelectableServiceIdsKey, usesCustomer, usesService]);
  const total = (usesService ? serviceSubtotal : 0) + (usesProduct ? productSubtotal : 0);
  const checkoutDiscountedPrice = Math.max(0, total - discountAmount);
  const checkoutSavedAmount = Math.max(0, discountAmount);
  const servicePickerSourceServices = usesCustomer
    ? selectedCustomerStoreServices.filter((service) => selectedCustomerSelectableServiceIds.has(service.id))
    : data.services;
  const serviceCategoryName = (service: Service) => service.category?.trim() || "未分类";
  const servicePickerCategories = [
    "全部",
    ...Array.from(new Set(servicePickerSourceServices.map(serviceCategoryName))),
  ];
  const servicesInPickerCategory = (category: string) =>
    category === "全部" ? servicePickerSourceServices : servicePickerSourceServices.filter((service) => serviceCategoryName(service) === category);
  const servicePickerCategoryCount = (category: string) => servicesInPickerCategory(category).length;
  const normalizedServicePickerSearch = servicePickerSearch.trim().toLowerCase();
  const servicePickerServices = servicesInPickerCategory(servicePickerCategory).filter((service) => {
    const searchTarget = `${service.name} ${service.category}`.toLowerCase();
    return !normalizedServicePickerSearch || searchTarget.includes(normalizedServicePickerSearch);
  });
  const servicePickerEmptyText = usesCustomer && servicePickerSourceServices.length === 0
    ? "当前客户暂无已购买项目"
    : "没有匹配的项目";
  const productCategoryName = (product: Product) => product.category?.trim() || "未分类";
  const productSubcategoryName = (product: Product) => product.subcategory?.trim() || "未分小类";
  const productPickerCategories = [
    "全部",
    ...inventoryCategoryNames(sellableProducts),
  ];
  const productsInPickerCategory = (category: string) =>
    category === "全部" ? sellableProducts : sellableProducts.filter((product) => productCategoryName(product) === category);
  const productPickerCategoryCount = (category: string) => productsInPickerCategory(category).length;
  const productsInCurrentPickerCategory = productsInPickerCategory(productPickerCategory);
  const productPickerSubcategories = [
    "全部小类",
    ...Array.from(new Set([
      ...inventorySubcategoryNames(sellableProducts, productPickerCategory),
      ...productsInCurrentPickerCategory.map(productSubcategoryName),
    ])),
  ];
  const productPickerSubcategoryCount = (subcategory: string) =>
    subcategory === "全部小类"
      ? productsInCurrentPickerCategory.length
      : productsInCurrentPickerCategory.filter((product) => productSubcategoryName(product) === subcategory).length;
  const normalizedProductPickerSearch = productPickerSearch.trim().toLowerCase();
  const productPickerProducts = sellableProducts.filter((product) => {
    const categoryName = productCategoryName(product);
    const subcategoryName = productSubcategoryName(product);
    const matchesCategory = productPickerCategory === "全部" || categoryName === productPickerCategory;
    const matchesSubcategory = productPickerSubcategory === "全部小类" || subcategoryName === productPickerSubcategory;
    const searchTarget = `${product.name} ${product.category ?? ""} ${product.subcategory ?? ""}`.toLowerCase();
    return matchesCategory && matchesSubcategory && (!normalizedProductPickerSearch || searchTarget.includes(normalizedProductPickerSearch));
  });
  const paidTotal = Math.max(0, total - discountAmount);
  const serviceAutoDebitActive = usesCustomer && usesService && selectedServiceRows.length > 0 && checkoutRelevantProjectCards.length > 0;
  const selectedCheckoutCard = payMethod === "会员卡" && !serviceAutoDebitActive ? availableCards.find((card) => card.id === cardId) : undefined;
  const checkoutSelectedCardUsageRows = selectedCheckoutCard ? checkoutCardServiceUsageRows(selectedCheckoutCard) : [];
  const checkoutBlockedCardUsageRows = payMethod === "会员卡" && !serviceAutoDebitActive
    ? checkoutSelectedCardUsageRows.filter((row) => row.blocked)
    : [];
  const checkoutMemberCardBlocked = checkoutBlockedCardUsageRows.length > 0;
  const checkoutMemberCardBlockedText = checkoutBlockedCardUsageRows
    .map((row) => `${row.name}：${row.remainingText}，${row.requiredText}`)
    .join("；");
  const checkoutDebitCandidateCards = usesCustomer && usesService && selectedServiceRows.length > 0
    ? selectedCustomerCheckoutCards
        .filter((card) => card.type !== "折扣卡")
        .filter((card) => checkoutCardServiceUsageRows(card).every((row) => !row.blocked))
        .sort((left, right) => {
          const leftStored = left.type === "储值卡" ? 1 : 0;
          const rightStored = right.type === "储值卡" ? 1 : 0;
          if (leftStored !== rightStored) return leftStored - rightStored;
          const leftExpiry = left.expiresAt ? +new Date(left.expiresAt) : Number.POSITIVE_INFINITY;
          const rightExpiry = right.expiresAt ? +new Date(right.expiresAt) : Number.POSITIVE_INFINITY;
          if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
          return left.remainingTimes - right.remainingTimes;
        })
    : [];
  const checkoutDebitCandidateIdsKey = checkoutDebitCandidateCards.map((card) => card.id).join("|");
  const selectedCheckoutDebitCard = cardId
    ? selectedCustomerCheckoutCards.find((card) => card.id === cardId)
    : undefined;
  const checkoutDebitCardOptionLabel = (card: AppData["memberCards"][number]) =>
    `${card.name} · ${card.type} · ${checkoutCardSelectedServiceText(card)}`;
  const checkoutDebitCardOptions = checkoutDebitCandidateCards.length
    ? checkoutDebitCandidateCards.map((card) => ({ value: card.id, label: checkoutDebitCardOptionLabel(card) }))
    : [{ value: "", label: "当前服务没有可扣卡来源" }];
  const checkoutServiceCardBlocked = Boolean(
    usesCustomer
    && usesService
    && selectedServiceRows.length > 0
    && checkoutRelevantProjectCards.length > 0
    && !checkoutAutoDebitCoversOrder,
  );
  const checkoutServiceCardBlockedText = checkoutAutoDebitShortfalls.join("；");
  const today = new Date();
  const todayOrders = data.orders.filter((order) => new Date(order.createdAt).toDateString() === today.toDateString());
  const todayMemberCardIncomeTransactions = data.memberCardTransactions.filter((transaction) => new Date(transaction.createdAt).toDateString() === today.toDateString() && memberCardCashIn(transaction) > 0);
  const todayPaid = todayOrders
    .filter((order) => order.payMethod !== "会员卡")
    .reduce((sum, order) => sum + order.paidAmount, 0)
    + todayMemberCardIncomeTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
  const selectedSignature = data.customerSignatures.find((signature) => signature.id === selectedSignatureId);
  const selectedSignatureContext = selectedSignature ? signatureRecordContext(data, selectedSignature) : undefined;
  const selectedSignatureCardUsageRows = selectedSignatureContext?.order ? signatureMemberCardUsageRows(data, selectedSignatureContext.order) : [];
  const selectedSignatureServiceRows = selectedSignatureContext?.order ? signatureServiceQuantityRows(data, selectedSignatureContext.order) : [];
  const selectedSignatureCardBlockedRows = selectedSignatureCardUsageRows.filter((row) => row.blocked);
  const selectedSignatureExpired = selectedSignature ? customerSignatureIsExpired(selectedSignature, signatureNow) : false;
  const selectedSignatureLinkedToOrder = selectedSignatureContext ? signatureRecordCanCompleteCheckout(selectedSignatureContext) : false;
  const selectedSignatureCardBlocked = selectedSignatureCardBlockedRows.length > 0;
  const selectedSignatureCanComplete = Boolean(
    selectedSignature
    && selectedSignature.status === "待签名"
    && !selectedSignatureExpired
    && selectedSignatureLinkedToOrder
    && !selectedSignatureCardBlocked,
  );
  const selectedSignatureBlockMessage = selectedSignature && selectedSignature.status === "待签名" && !selectedSignatureCanComplete
    ? selectedSignatureExpired
      ? "签名链接已过期，请重新生成签名后再让客户确认。"
      : selectedSignatureCardBlocked
        ? `会员卡项目次数不足，不能完成签名扣卡：${selectedSignatureCardBlockedRows.map((row) => `${row.serviceName} 剩 ${row.beforeText}，本次用 ${row.usedText}`).join("；")}`
        : "这条签名未关联收银订单，不能作为收银确认签名。"
    : undefined;
  useEffect(() => {
    if (!usesCustomer || !usesService || selectedServiceRows.length === 0) return;
    if (serviceAutoDebitActive) {
      if (cardId) setCardId("");
      return;
    }
    if (checkoutDebitCandidateCards.length === 0) {
      if (cardId) setCardId("");
      return;
    }
    if (!checkoutDebitCandidateCards.some((card) => card.id === cardId)) {
      setCardId(checkoutDebitCandidateCards[0].id);
    }
  }, [cardId, checkoutDebitCandidateIdsKey, selectedServiceRows.length, serviceAutoDebitActive, usesCustomer, usesService]);
  const arrivedAppointments = data.appointments.filter(
    (appointment) => appointment.status === "已到店" && !data.orders.some((order) => order.appointmentId === appointment.id && order.status !== "已退款"),
  );
  const selectedCheckoutAppointment = appointmentId ? data.appointments.find((appointment) => appointment.id === appointmentId) : undefined;
  const selectedCheckoutAppointmentServiceIds = selectedCheckoutAppointment ? appointmentServiceIds(selectedCheckoutAppointment) : [];
  const selectedCheckoutAppointmentNeedsServiceSelection = Boolean(selectedCheckoutAppointment && selectedCheckoutAppointmentServiceIds.length === 0);
  const checkoutAppointmentServiceLabel = (appointment: Appointment) => {
    const label = appointmentServiceNames(data, appointment);
    return appointmentServiceIds(appointment).length ? label : `${label}（需选实际服务）`;
  };

  const clearAppointment = () => {
    setAppointmentId("");
  };

  const updateCheckoutCustomerSearch = (value: string) => {
    setCustomerSearch(value);
    const uniqueMatch = findUniqueCustomerBySearchText(data.customers, value);
    if (uniqueMatch) {
      if (uniqueMatch.id !== customerId) {
        clearAppointment();
        setCardId("");
      }
      setCustomerId(uniqueMatch.id);
      return;
    }
    if (value.trim() && selectedCustomer && !customerMatchesSearchText(selectedCustomer, value)) {
      clearAppointment();
      setCustomerId("");
      setCardId("");
    }
  };

  const cashierFlowRecords = buildCashierFlowRecords(data);
  const selectedCashierRecord = cashierFlowRecords.find((record) => record.id === selectedCashierRecordId);
  const selectedCashierOrder = selectedCashierRecord?.kind === "order" ? selectedCashierRecord.order : undefined;
  const selectedCashierTransaction = selectedCashierRecord?.kind === "memberCard" ? selectedCashierRecord.transaction : undefined;
  const selectedCashierMemberCard = selectedCashierTransaction
    ? data.memberCards.find((card) => card.id === selectedCashierTransaction.memberCardId)
    : selectedCashierOrder?.cardId
      ? data.memberCards.find((card) => card.id === selectedCashierOrder.cardId)
      : undefined;
  const selectedCashierCustomerId = selectedCashierOrder?.customerId || selectedCashierMemberCard?.customerId || "";
  const selectedCashierCustomer = data.customers.find((customer) => customer.id === selectedCashierCustomerId);
  const selectedCashierAppointment = selectedCashierOrder?.appointmentId
    ? data.appointments.find((appointment) => appointment.id === selectedCashierOrder.appointmentId)
    : undefined;
  const selectedCashierSignature = selectedCashierOrder
    ? data.customerSignatures.find((signature) => signature.orderId === selectedCashierOrder.id)
    : undefined;
  const openCashierSignature = () => {
    if (!selectedCashierSignature) return;
    setSelectedSignatureId(selectedCashierSignature.id);
    setActiveModule("signature");
  };
  const closeSignatureCapture = () => {
    setActiveModule("orders");
    setSelectedSignatureId("");
    setSignatureMessage(undefined);
    setHasSignatureDrawing(false);
  };
  useEffect(() => {
    const customerName = selectedSignature ? nameOf(data.customers, selectedSignature.customerId) : "";
    setSignatureSignerName(customerName === "-" ? "" : customerName);
    setSignatureMessage(undefined);
    setHasSignatureDrawing(false);
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }, [data.customers, selectedSignature?.id]);

  const signaturePointFromClient = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const drawSignaturePoint = (canvas: HTMLCanvasElement, point: { x: number; y: number }) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#15141a";
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignatureDrawing(true);
  };

  const startSignatureDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    signatureDrawingRef.current = true;
    const point = signaturePointFromClient(event.currentTarget, event.clientX, event.clientY);
    context.beginPath();
    context.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drawSignature = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const point = signaturePointFromClient(event.currentTarget, event.clientX, event.clientY);
    drawSignaturePoint(event.currentTarget, point);
  };

  const startTouchSignatureDrawing = (event: ReactTouchEvent<HTMLCanvasElement>) => {
    const touch = event.touches[0];
    const context = event.currentTarget.getContext("2d");
    if (!touch || !context) return;
    event.preventDefault();
    signatureDrawingRef.current = true;
    const point = signaturePointFromClient(event.currentTarget, touch.clientX, touch.clientY);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const drawTouchSignature = (event: ReactTouchEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    const point = signaturePointFromClient(event.currentTarget, touch.clientX, touch.clientY);
    drawSignaturePoint(event.currentTarget, point);
  };

  const stopSignatureDrawing = () => {
    signatureDrawingRef.current = false;
  };

  const clearSignatureDrawing = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureDrawing(false);
  };

  const signSelectedSignature = () => {
    setSignatureMessage(undefined);
    const signatureToSign = selectedSignature;
    if (!signatureToSign || !selectedSignatureCanComplete) {
      setSignatureMessage({ type: "error", text: selectedSignatureBlockMessage ?? "请选择可完成的服务签名记录。" });
      return;
    }
    if (!signatureSignerName.trim()) {
      setSignatureMessage({ type: "error", text: "请填写签名人姓名。" });
      return;
    }
    const canvas = signatureCanvasRef.current;
    if (!canvas || !hasSignatureDrawing) {
      setSignatureMessage({ type: "error", text: "请先完成手写签名。" });
      return;
    }
    void runMutation(() =>
      actions.signCustomerSignature(signatureToSign.id, {
        signerName: signatureSignerName.trim(),
        signatureText: canvasToSignatureDataUrl(canvas),
      }),
    ).then((nextData) => {
      const signedSignature = nextData.customerSignatures.find((signature) => signature.id === signatureToSign.id);
      if (signedSignature) setSelectedSignatureId(signedSignature.id);
      setSignatureMessage({ type: "success", text: "客户确认签名已完成。" });
      const signedOrder = signedSignature?.orderId ? nextData.orders.find((order) => order.id === signedSignature.orderId) : undefined;
      if (signedOrder?.appointmentId && onReturnAppointments) {
        window.setTimeout(() => onReturnAppointments(), 450);
      }
    }).catch((caught) => {
      setSignatureMessage({ type: "error", text: caught instanceof Error ? caught.message : "签名失败" });
    });
  };
  const cashierPaymentText = (record: ReturnType<typeof buildCashierFlowRecords>[number]) => {
    if (record.kind === "order" && record.payMethod === "会员卡") return "会员卡扣款";
    return record.payMethod;
  };

  const useAppointmentForCheckout = (id: string) => {
    setAppointmentId(id);
    if (!id) return;
    const appointment = data.appointments.find((item) => item.id === id);
    if (!appointment) return;
    const nextServiceIds = appointmentServiceIds(appointment);
    setCheckoutValidationMessages([]);
    setCheckoutCustomerMode("customer");
    setCheckoutContentMode("service");
    setCustomerId(appointment.customerId);
    setCustomerSearch("");
    setGuestName("");
    setGuestPhone("");
    setStaffId(appointment.staffId);
    if (nextServiceIds.length > 0) {
      setCheckoutServiceIds(nextServiceIds);
      resetCheckoutDiscount();
    }
    setCollaboratorStaffIds([]);
    setCardId("");
    setServicePickerOpen(false);
  };

  useEffect(() => {
    if (!initialAppointmentId) {
      appliedInitialAppointmentRef.current = undefined;
      return;
    }
    const entryId = `${initialEntryKey}:${initialAppointmentId}`;
    if (appliedInitialAppointmentRef.current === entryId) return;
    appliedInitialAppointmentRef.current = entryId;
    setActiveModule("single");
    useAppointmentForCheckout(initialAppointmentId);
  }, [initialAppointmentId, initialEntryKey, data.appointments]);

  const openCheckoutModule = (module: "product" | "single") => {
    const isProductModule = module === "product";
    checkoutRequestIdRef.current = makeId("checkout");
    setCheckoutContentMode(isProductModule ? "product" : "service");
    setCheckoutCustomerMode("walkin");
    setCheckoutServiceIds([]);
    setAppointmentId("");
    setCustomerSearch("");
    setCardId("");
    setCollaboratorStaffIds([]);
    setDiscountAmount(0);
    setCheckoutDiscountRateInput("");
    setAdjustmentReason("");
    setCheckoutValidationMessages([]);
    setCheckoutSuccessMessage("");
    if (!isProductModule) {
      setCheckoutProductItems([]);
      setCheckoutGiftItems([]);
      setProductPickerOpen(false);
    } else {
      setServicePickerOpen(false);
    }
    if (payMethod === "会员卡" || isProductModule) setPayMethod("微信");
    setActiveModule(module);
  };

  const resetCheckoutDiscount = () => {
    setDiscountAmount(0);
    setCheckoutDiscountRateInput("");
  };

  const setCheckoutItemQuantity = (mode: "sale" | "gift", productId: string, quantity: number) => {
    const product = sellableProducts.find((item) => item.id === productId);
    const maxQuantity = product ? Math.max(0, Math.floor(product.stock)) : 0;
    const nextQuantity = Math.min(maxQuantity, Math.max(0, Math.floor(quantity)));
    const setter = mode === "sale" ? setCheckoutProductItems : setCheckoutGiftItems;
    setter((items) => {
      if (nextQuantity <= 0) return items.filter((item) => item.productId !== productId);
      if (items.some((item) => item.productId === productId)) {
        return items.map((item) => (item.productId === productId ? { ...item, quantity: nextQuantity } : item));
      }
      return [...items, { productId, quantity: nextQuantity }];
    });
    if (mode === "sale") resetCheckoutDiscount();
  };

  const addCheckoutItem = (mode: "sale" | "gift", productId: string) => {
    const items = mode === "sale" ? checkoutProductItems : checkoutGiftItems;
    const currentQuantity = items.find((item) => item.productId === productId)?.quantity ?? 0;
    setCheckoutItemQuantity(mode, productId, currentQuantity + 1);
  };

  const openProductPicker = (mode: "sale" | "gift") => {
    setProductPickerMode(mode);
    setProductPickerCategory("全部");
    setProductPickerSubcategory("全部小类");
    setProductPickerSearch("");
    setProductPickerOpen(true);
  };

  const openServicePicker = () => {
    setServicePickerCategory("全部");
    setServicePickerSearch("");
    setServicePickerOpen(true);
  };

  const setCheckoutServiceQuantity = (nextServiceId: string, quantity: number) => {
    const nextQuantity = Math.max(0, Math.floor(quantity));
    clearAppointment();
    resetCheckoutDiscount();
    setCheckoutServiceIds((previous) => {
      let inserted = false;
      const replacement = nextQuantity > 0 ? Array.from({ length: nextQuantity }, () => nextServiceId) : [];
      const next: string[] = [];
      previous.forEach((id) => {
        if (id !== nextServiceId) {
          next.push(id);
          return;
        }
        if (!inserted) {
          next.push(...replacement);
          inserted = true;
        }
      });
      if (!inserted) next.push(...replacement);
      return next;
    });
  };

  const selectCheckoutService = (nextServiceId: string) => {
    clearAppointment();
    resetCheckoutDiscount();
    setCheckoutServiceIds((previous) => {
      return previous.includes(nextServiceId)
        ? previous.filter((id) => id !== nextServiceId)
        : [...previous, nextServiceId];
    });
  };

  const applyCheckoutDiscountRate = (value: string) => {
    setCheckoutDiscountRateInput(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setDiscountAmount(0);
      return;
    }
    const rawRate = Number(trimmed);
    if (!Number.isFinite(rawRate)) {
      setDiscountAmount(0);
      return;
    }
    const percentRate = rawRate <= 10 ? rawRate * 10 : rawRate;
    const boundedRate = Math.min(100, Math.max(0, percentRate));
    const nextPaidAmount = Math.round(total * boundedRate / 100);
    setDiscountAmount(Math.max(0, total - nextPaidAmount));
  };

  const updateCardServiceIds = (serviceIds: string[]) => {
    const nextServiceIds = Array.from(new Set(serviceIds.filter(Boolean)));
    setCardServiceIds(nextServiceIds);
    setCardServiceId(nextServiceIds[0] ?? "");
    setCardServiceTimes((previous) => {
      const next: Record<string, EditableNumber> = {};
      nextServiceIds.forEach((id) => {
        const service = data.services.find((item) => item.id === id);
        next[id] = previous[id] ?? service?.defaultTimes ?? (typeof cardTimes === "number" && cardTimes > 0 ? cardTimes : 1);
      });
      return next;
    });
  };

  const changeCardCustomerMode = (value: CardCustomerMode) => {
    setCardCustomerMode(value);
    if (value === "existing") cardCustomerDraftTouchedRef.current = false;
  };

  const updateCardCustomerName = (value: string) => {
    cardCustomerDraftTouchedRef.current = true;
    setCardCustomerName(value);
  };

  const updateCardCustomerPhone = (value: string, input?: HTMLInputElement | null) => {
    const nextPhone = normalizeMobilePhoneDraft(value);
    cardCustomerDraftTouchedRef.current = true;
    setCardCustomerPhone(nextPhone);
    if (input && input.value !== nextPhone) input.value = nextPhone;
  };

  const readCardCustomerName = () => (cardCustomerNameInputRef.current?.value ?? cardCustomerName).trim();

  const readCardCustomerPhone = () => normalizeMobilePhoneDraft(cardCustomerPhoneInputRef.current?.value ?? cardCustomerPhone);

  const readCardName = () => (cardNameInputRef.current?.value ?? cardName).trim();

  const updateCardName = (value: string) => {
    setCardName(value);
  };

  const updateCardServiceTimes = (serviceId: string, value: EditableNumber) => {
    setCardServiceTimes((previous) => ({ ...previous, [serviceId]: value }));
  };

  const buildCardServiceEntitlements = () =>
    cardServiceIds.map((serviceId) => {
      const totalTimes = editableNumberValue(cardServiceTimes[serviceId]);
      return { serviceId, totalTimes, remainingTimes: totalTimes };
    });

  const clearCardCustomerDraft = () => {
    cardCustomerDraftTouchedRef.current = false;
    setCardCustomerName("");
    setCardCustomerPhone("");
    setCardCustomerBirthday("");
    setCardCustomerNote("");
    if (cardCustomerNameInputRef.current) cardCustomerNameInputRef.current.value = "";
    if (cardCustomerPhoneInputRef.current) cardCustomerPhoneInputRef.current.value = "";
  };

  useEffect(() => {
    if (initialModule) {
      setActiveModule(normalizePosModule(initialModule));
      return;
    }
    if (fromManagement) setActiveModule(normalizePosModule("single"));
  }, [fromManagement, initialModule, initialEntryKey]);

  useEffect(() => {
    if (!initialSignatureId) {
      appliedInitialSignatureRef.current = undefined;
      return;
    }
    const entryId = `${initialEntryKey}:${initialSignatureId}`;
    if (appliedInitialSignatureRef.current === entryId) return;
    const targetSignature = data.customerSignatures.find((signature) => signature.id === initialSignatureId);
    if (!targetSignature) return;
    appliedInitialSignatureRef.current = entryId;
    setSelectedSignatureId(targetSignature.id);
    setActiveModule("signature");
  }, [initialSignatureId, initialEntryKey, data.customerSignatures]);

  useEffect(() => {
    if (!initialCustomerId) {
      appliedInitialCustomerRef.current = undefined;
      return;
    }
    if (appliedInitialCustomerRef.current === initialCustomerId) return;
    if (cardCustomerDraftTouchedRef.current) return;
    if (!data.customers.some((customer) => customer.id === initialCustomerId)) return;
    appliedInitialCustomerRef.current = initialCustomerId;
    setActiveModule("card");
    setCustomerId(initialCustomerId);
    setCardCustomerMode("existing");
    setCardCustomerName("");
    setCardCustomerPhone("");
  }, [data.customers, initialCustomerId, initialEntryKey]);

  const openCard = (event: FormEvent) => {
    event.preventDefault();
    setCardFormMessage(undefined);
    const draftError = cardCustomerDraftError(cardCustomerMode, readCardCustomerName(), readCardCustomerPhone());
    if (draftError) {
      setCardFormMessage({ type: "error", text: draftError });
      return;
    }
    void runMutation(async () => {
      const submittedCardName = cardType === "储值卡" ? DEFAULT_STORED_VALUE_CARD_NAME : cardType === "折扣卡" ? (readCardName() || DEFAULT_DISCOUNT_CARD_NAME) : readCardName();
      const submittedCustomerName = cardCustomerMode === "new" ? readCardCustomerName() : "";
      const submittedCustomerPhone = cardCustomerMode === "new" ? readCardCustomerPhone() : "";
      const submittedCustomerBirthday = cardCustomerMode === "new" ? normalizeBirthdayForSubmit(cardCustomerBirthday) : "";
      const submittedCustomerNote = cardCustomerMode === "new" ? cardCustomerNote.trim() : "";
      const submittedServiceEntitlements = cardType === "次数卡" || cardType === "套餐卡" ? buildCardServiceEntitlements() : [];
      const submittedRemainingTimes = submittedServiceEntitlements.reduce((sum, item) => sum + item.totalTimes, 0);
      if (cardCustomerMode === "existing" && !customerId) throw new Error("请选择开卡客户");
      if (cardCustomerMode === "new" && cardCustomerBirthday.trim() && !submittedCustomerBirthday) throw new Error("客户生日请按 YYYY-MM-DD 填写");
      if (cardType !== "储值卡" && !submittedCardName) throw new Error("请填写卡名称");
      if (!Number.isFinite(cardPaidAmountValue) || cardPaidAmountValue <= 0) throw new Error("请填写开卡实收金额");
      if (cardType === "储值卡" && (!Number.isFinite(cardAmountValue) || cardAmountValue <= 0)) throw new Error("请填写储值到账金额");
      if ((cardType === "次数卡" || cardType === "套餐卡") && cardServiceIds.length === 0) throw new Error("请选择可用项目");
      if ((cardType === "次数卡" || cardType === "套餐卡") && submittedServiceEntitlements.some((item) => !Number.isFinite(item.totalTimes) || item.totalTimes <= 0)) throw new Error("请填写每个可用项目的次数");
      if ((cardType === "次数卡" || cardType === "套餐卡") && submittedRemainingTimes <= 0) throw new Error("请填写可用次数");
      if (cardType === "折扣卡" && (!Number.isFinite(cardDiscountRateValue) || cardDiscountRateValue < 1 || cardDiscountRateValue >= 10)) throw new Error("折扣卡折扣必须在 1 折到 9.9 折之间");
      return actions.openMemberCard({
        customerId: cardCustomerMode === "existing" ? customerId : undefined,
        customerName: cardCustomerMode === "new" ? submittedCustomerName : undefined,
        customerPhone: cardCustomerMode === "new" ? submittedCustomerPhone : undefined,
        customerBirthday: submittedCustomerBirthday || undefined,
        customerNote: submittedCustomerNote || undefined,
        name: submittedCardName,
        type: cardType,
        balance: cardType === "储值卡" ? cardAmountValue : 0,
        remainingTimes: cardType === "次数卡" || cardType === "套餐卡" ? submittedRemainingTimes : 0,
        discountRate: cardType === "折扣卡" ? cardDiscountRateValue / 10 : undefined,
        benefitText: cardType === "折扣卡" ? `${cardDiscountRateValue} 折权益` : undefined,
        serviceId: cardType === "次数卡" || cardType === "套餐卡" ? cardServiceIds[0] : undefined,
        serviceIds: cardType === "次数卡" || cardType === "套餐卡" ? cardServiceIds : undefined,
        serviceEntitlements: cardType === "次数卡" || cardType === "套餐卡" ? submittedServiceEntitlements : undefined,
        paidAmount: cardPaidAmountValue,
        payMethod: cardPayMethod,
        expiresAt: cardExpiresAt,
        note: cardNote.trim() || undefined,
      });
    }).then(() => {
      clearCardCustomerDraft();
      setCardNote("");
      setCardFormMessage({ type: "success", text: "开卡成功，已写入收银流水。" });
      setCheckoutSuccessMessage("开卡成功，已写入收银流水。");
      if (fromManagement && onReturnManagement) {
        onReturnManagement();
      } else {
        window.setTimeout(() => setActiveModule("orders"), 800);
      }
    }).catch((caught) => {
      setCardFormMessage({ type: "error", text: caught instanceof Error ? caught.message : "开卡保存失败" });
    });
  };

  const checkout = (event: FormEvent) => {
    event.preventDefault();
    if (checkoutSubmittingRef.current || checkoutSubmitting) return;
    const messages: string[] = [];
    if (!staffId) {
      messages.push(usesProduct && !usesService ? "请选择收银人员。商品开单可以选择店长/老板或服务人员。" : "请选择服务人员。");
    }
    if (usesService && selectedServices.length === 0) {
      messages.push(selectedCheckoutAppointmentNeedsServiceSelection ? "这条预约没有绑定服务项目，请先选择实际服务项目后再收银。" : "请选择服务项目。");
    }
    if (usesProduct && checkoutProductItems.length === 0) messages.push("请选择销售商品。");
    if (usesProduct && checkoutProductRows.some((item) => item.product.price <= 0)) {
      const zeroPriceNames = checkoutProductRows.filter((item) => item.product.price <= 0).map((item) => item.product.name).join("、");
      messages.push(`商品 ${zeroPriceNames} 的售价为 0，请先到商品资料填写售价。`);
    }
    if (usesCustomer && !customerId) messages.push("请选择会员客户，或把开单对象切换为新客。");
    if (customerSearchUnresolved) messages.push("请先从客户搜索结果中选择客户，确认后再收银。");
    if (!usesCustomer && !guestName.trim()) messages.push("请填写客户姓名，收银完成后需要客户签名。");
    if (!usesCustomer && !guestPhone.trim()) {
      messages.push("请填写客户手机号，收银完成后需要客户签名。");
    } else if (!usesCustomer && guestPhone.length !== 11) {
      messages.push("客户电话必须为 11 位数字。");
    }
    if (discountAmount < 0) messages.push("折扣金额不能小于 0。");
    if (discountAmount >= total && total > 0) messages.push("折扣不能大于或等于原价。");
    if (payMethod === "会员卡" && !serviceAutoDebitActive && (!usesCustomer || !cardId)) messages.push("会员卡支付需要先选择会员客户和可用会员卡。");
    if (!serviceAutoDebitActive && usesCustomer && usesService && selectedServiceRows.length > 0 && checkoutDebitCandidateCards.length > 0 && !cardId) {
      messages.push("请选择本次扣卡来源。");
    }
    if (payMethod === "会员卡" && checkoutMemberCardBlocked) {
      messages.push(`会员卡项目次数不足，不能扣卡：${checkoutMemberCardBlockedText}`);
    }
    if (checkoutServiceCardBlocked) {
      messages.push(`客户已购项目次数不足，不能继续开单：${checkoutServiceCardBlockedText}`);
    }

    if (messages.length > 0) {
      setCheckoutValidationMessages(messages);
      return;
    }

    setCheckoutValidationMessages([]);
    checkoutSubmittingRef.current = true;
    setCheckoutSubmitting(true);
    void runMutation(() =>
      actions.checkout({
        checkoutRequestId: checkoutRequestIdRef.current,
        customerId: usesCustomer ? customerId : undefined,
        guestName: usesCustomer ? undefined : guestName.trim(),
        guestPhone: usesCustomer ? undefined : guestPhone,
        staffId,
        collaboratorStaffIds: usesService ? collaboratorStaffIds : [],
        serviceId: usesService ? selectedServices[0]?.id : undefined,
        serviceIds: usesService ? checkoutServiceIds : undefined,
        productItems: usesProduct ? checkoutProductItems : undefined,
        giftProductItems: usesProduct ? checkoutGiftItems : undefined,
        discountAmount: discountAmount || undefined,
        adjustmentReason: adjustmentReason || undefined,
        appointmentId: usesCustomer && usesService ? appointmentId || undefined : undefined,
        payMethod,
        cardId: usesCustomer && !serviceAutoDebitActive && (payMethod === "会员卡" || usesService) ? cardId || undefined : undefined,
      }),
    ).then((nextData) => {
      const latestOrder = nextData.orders[0];
      const latestOrderNo = latestOrder?.orderNo;
      const pendingSignature = latestOrder
        ? nextData.customerSignatures.find((signature) => signature.orderId === latestOrder.id && signature.status === "待签名")
        : undefined;
      if (pendingSignature) {
        setSelectedSignatureId(pendingSignature.id);
        setActiveModule("signature");
      }
      setAppointmentId("");
      setGuestName("");
      setGuestPhone("");
      setCheckoutServiceIds([]);
      if (usesProduct) {
        setCheckoutProductItems([]);
        setCheckoutGiftItems([]);
      }
      setCollaboratorStaffIds([]);
      setDiscountAmount(0);
      setCheckoutDiscountRateInput("");
      setAdjustmentReason("");
      const signatureHint = pendingSignature ? "请在当前窗口完成客户签名。" : "";
      setCheckoutSuccessMessage(latestOrderNo ? `下单成功，订单 ${latestOrderNo} 已生成。${signatureHint}` : `下单成功，订单已生成。${signatureHint}`);
      checkoutRequestIdRef.current = makeId("checkout");
      if (pendingSignature) {
        return;
      }
      if (fromManagement && onReturnManagement) {
        onReturnManagement();
      } else {
        setActiveModule(undefined);
      }
    })
      .catch((caught) => {
        setCheckoutValidationMessages([caught instanceof Error ? caught.message : "收银失败，请稍后重试"]);
      })
      .finally(() => {
        checkoutSubmittingRef.current = false;
        setCheckoutSubmitting(false);
      });
  };

  const posModuleTitles: Record<NonNullable<typeof activeModule>, string> = {
    card: "开卡",
    product: "商品",
    signature: "客户确认签名",
    single: "项目服务",
    orders: "收银流水",
  };
  const activeModuleTitle = activeModule ? posModuleTitles[activeModule] : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  const renderCheckoutCustomerControls = () => (
    <>
      <Select
        label="开单对象"
        value={checkoutCustomerMode}
        onChange={(value) => {
          const nextMode = value as "customer" | "walkin";
          setCheckoutCustomerMode(nextMode);
          clearAppointment();
          if (nextMode === "customer") {
            setGuestName("");
            setGuestPhone("");
            return;
          }
          setCardId("");
          if (payMethod === "会员卡") setPayMethod("微信");
        }}
        options={[
          { value: "walkin", label: "新客" },
          { value: "customer", label: "会员" },
        ]}
      />
      {usesCustomer ? (
        <div className="checkout-customer-search">
          <label>
            客户
            <input
              value={customerSearch}
              {...searchInputSync(updateCheckoutCustomerSearch)}
              placeholder={selectedCustomer ? customerDisplayLabel(selectedCustomer) : "输入客户姓名或手机号搜索"}
            />
          </label>
          {selectedCustomer && !customerSearchUnresolved && (
            <div className="checkout-selected-customer">
              <span>已选择客户</span>
              <strong>{customerDisplayLabel(selectedCustomer)}</strong>
            </div>
          )}
          {customerSearchUnresolved && (
            <p className="checkout-customer-warning">请从下方搜索结果中点选客户，不能只输入姓名收银。</p>
          )}
          {normalizedCustomerSearch && (
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
                <div className="checkout-customer-empty">没有找到客户，可切换为新客开单。</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="checkout-guest-fields">
          <div className="checkout-guest-grid">
            <label>
              {usesProduct && !usesService ? "新客姓名" : "客户姓名"}
              <input value={guestName} onChange={(event) => setGuestName(event.target.value)} autoComplete="name" placeholder="用于客户签名和流水追溯" />
            </label>
            <label>
              {usesProduct && !usesService ? "联系电话" : "客户电话"}
              <input type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} value={guestPhone} onChange={(event) => setGuestPhone(normalizeMobilePhoneDraft(event.target.value))} placeholder="11 位手机号" />
            </label>
          </div>
        </div>
      )}
      {usesCustomer && usesService && (
        <div className="checkout-customer-card-summary">
          <div className="checkout-product-section-head">
            <span>项目扣卡计划</span>
            <strong>{checkoutAutoDebitPlan.length ? `${checkoutAutoDebitPlan.length} 条自动扣除` : selectedCustomerProjectCards.length ? "待选项目" : "暂无项目卡"}</strong>
          </div>
          {selectedServiceRows.length > 0 && checkoutAutoDebitPlan.length > 0 ? (
            <div className="checkout-customer-card-usage auto-debit">
              {checkoutAutoDebitPlan.map((row) => (
                <div key={`${row.card.id}:${row.service.id}`}>
                  <span>{row.service.name}</span>
                  <small>{row.card.name}</small>
                  <em>{row.beforeText}</em>
                  <b>本单扣 {row.quantity} 次</b>
                  <i>{row.afterText}</i>
                </div>
              ))}
            </div>
          ) : selectedServiceRows.length > 0 && checkoutServiceCardBlocked ? (
            <div className="checkout-product-empty">当前项目次数不足：{checkoutServiceCardBlockedText}</div>
          ) : selectedCustomerProjectCards.length ? (
            <div className="checkout-customer-card-list">
              {selectedCustomerProjectCards.map((card) => {
                const usageRows = checkoutCardServiceUsageRows(card);
                return (
                  <div className="checkout-customer-card-row" key={card.id}>
                    <div className="checkout-customer-card-title">
                      <strong>{card.name}</strong>
                      <span>{card.type} · {memberCardProjectScopeText(card, data.services)}</span>
                    </div>
                    <div className="checkout-customer-card-usage">
                      {usageRows.map((row) => (
                        <div className={row.blocked ? "blocked" : ""} key={row.key}>
                          <span>{row.name}</span>
                          <small>{row.scopeText}</small>
                          <em>{row.remainingText}</em>
                          <b>{row.requiredText}</b>
                          <i>{row.statusText}</i>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="checkout-product-empty">当前客户暂无项目次数卡。</div>
          )}
        </div>
      )}
    </>
  );

  const renderCheckoutCart = (mode: "sale" | "gift") => {
    const rows = mode === "sale" ? checkoutProductRows : checkoutGiftRows;
    if (!rows.length) {
      return (
        <div className="checkout-product-empty">
          {mode === "sale" ? "还没有选择商品" : "没有赠送商品"}
        </div>
      );
    }

    return (
      <div className="checkout-product-list">
        {rows.map((row) => (
          <div className="checkout-product-line" key={`${mode}-${row.productId}`}>
            <div>
              <strong>{row.product.name}</strong>
              <span>{row.product.category || "未分类"} · 库存 {row.product.stock}</span>
            </div>
            <div className="checkout-product-qty" aria-label={`${row.product.name} 数量`}>
              <button type="button" aria-label={`减少${row.product.name}`} onClick={() => setCheckoutItemQuantity(mode, row.productId, row.quantity - 1)}>
                <Minus size={14} />
              </button>
              <input
                inputMode="numeric"
                value={row.quantity}
                onChange={(event) => setCheckoutItemQuantity(mode, row.productId, Number(event.target.value))}
              />
              <button type="button" aria-label={`添加${row.product.name}`} onClick={() => setCheckoutItemQuantity(mode, row.productId, row.quantity + 1)}>
                <Plus size={14} />
              </button>
            </div>
            <span className="checkout-product-price">
              {mode === "sale" ? money(row.product.price * row.quantity) : "赠品"}
            </span>
            <button type="button" className="checkout-product-remove" onClick={() => setCheckoutItemQuantity(mode, row.productId, 0)} aria-label={`移除${row.product.name}`}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="page-stack cashier-module-page module-hub">
      <PageHero
        icon={<CreditCard size={15} />}
        eyebrow="开单收银"
        title="开单收银"
        stats={[
          { label: "今日收款", value: money(todayPaid), hint: `${todayOrders.length} 笔订单${todayMemberCardIncomeTransactions.length ? ` · 会员${todayMemberCardIncomeTransactions.length} 笔` : ""}`, icon: <ChartNoAxesColumnIncreasing size={18} /> },
          { label: "今日订单", value: `${todayOrders.length} 单`, hint: "当日收银记录", icon: <ClipboardList size={18} /> },
        ]}
      />
      {!fromManagement && (
        <section className="cashier-orbit" aria-label="收银工作区">
          <div className="cashier-orbit-side left">
            <button
              type="button"
              className={`cashier-orbit-card left top ${activeModule === "product" ? "active" : ""}`}
              onClick={() => openCheckoutModule("product")}
            >
              <PackagePlus size={22} />
              <strong>商品开单</strong>
              <em>库存扣减</em>
            </button>
            <button
              type="button"
              className={`cashier-orbit-card left bottom ${activeModule === "single" ? "active" : ""}`}
              onClick={() => openCheckoutModule("single")}
            >
              <CreditCard size={22} />
              <strong>项目服务</strong>
              <em>项目收款</em>
            </button>
          </div>
          <button
            type="button"
            className={`cashier-orbit-center ${activeModule === "card" ? "active" : ""}`}
            onClick={() => {
              setCardFormMessage(undefined);
              setCheckoutSuccessMessage("");
              setActiveModule("card");
            }}
          >
            <CreditCard size={34} />
            <strong>开卡</strong>
            <em>会员卡 / 套餐</em>
          </button>
          <div className="cashier-orbit-side right">
            <button
              type="button"
              className={`cashier-orbit-card right bottom ${activeModule === "orders" ? "active" : ""}`}
              onClick={() => setActiveModule("orders")}
            >
              <ClipboardList size={22} />
              <strong>收银流水</strong>
              <em>{cashierFlowRecords.length} 笔</em>
            </button>
          </div>
        </section>
      )}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "开单收银"}
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack cashier-modal-detail">
        {activeModule === "card" && (
        <section className="panel sg">
        <PanelTitle icon={<CreditCard size={18} />} title="开卡" action="储值 / 次数 / 套餐 / 折扣" />
        <form className="form" onSubmit={openCard}>
          <Select label="客户登记" value={cardCustomerMode} onChange={(value) => changeCardCustomerMode(value as CardCustomerMode)} options={[{ value: "new", label: "新客户登记" }, { value: "existing", label: "已有客户" }]} />
          {cardCustomerMode === "existing" ? (
            <Select
              label="客户"
              value={customerId}
              onChange={setCustomerId}
              options={data.customers.map(customerOptionOf)}
              searchable
            />
          ) : (
            <>
              <label>客户姓名<input ref={cardCustomerNameInputRef} defaultValue={cardCustomerName} onInput={(event) => updateCardCustomerName(event.currentTarget.value)} onBlur={(event) => updateCardCustomerName(event.currentTarget.value)} onCompositionEnd={(event) => updateCardCustomerName(event.currentTarget.value)} autoComplete="name" /></label>
              <label>客户手机号<input ref={cardCustomerPhoneInputRef} type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} defaultValue={cardCustomerPhone} onInput={(event) => updateCardCustomerPhone(event.currentTarget.value, event.currentTarget)} onBlur={(event) => updateCardCustomerPhone(event.currentTarget.value, event.currentTarget)} /></label>
              <label>客户生日（选填）<input type="text" inputMode="numeric" autoComplete="bday" placeholder="1998-06-12" maxLength={10} value={cardCustomerBirthday} onChange={(event) => setCardCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} onBlur={(event) => setCardCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} /></label>
              <label>客户备注（选填）<input value={cardCustomerNote} onChange={(event) => setCardCustomerNote(event.target.value)} placeholder="如护理偏好、禁忌、沟通注意事项" /></label>
            </>
          )}
          <Select label="卡类型" value={cardType} onChange={(value) => setCardType(value as CardType)} options={["储值卡", "次数卡", "套餐卡", "折扣卡"].map((item) => ({ value: item, label: item }))} />
          {cardType !== "储值卡" && (
            <label>卡名称<input ref={cardNameInputRef} defaultValue={cardName} onInput={(event) => updateCardName(event.currentTarget.value)} onBlur={(event) => updateCardName(event.currentTarget.value)} onCompositionEnd={(event) => updateCardName(event.currentTarget.value)} placeholder="如面部护理十次卡" /></label>
          )}
          {cardType === "储值卡" && (
            <label>充值到账余额<input type="number" min={0} value={cardAmount} onChange={(event) => setCardAmount(parseEditableNumber(event.target.value))} /></label>
          )}
          {cardType === "折扣卡" && (
            <label>会员折扣<input type="number" min={1} max={9.9} step={0.1} value={cardDiscountRate} onChange={(event) => setCardDiscountRate(parseEditableNumber(event.target.value))} /></label>
          )}
          {(cardType === "次数卡" || cardType === "套餐卡") && (
            <fieldset className="card-entitlement-group">
              <legend>项目权益明细</legend>
              {data.services.length === 0 ? (
                <span>暂无可选项目</span>
              ) : (
                data.services.map((service) => {
                  const selected = cardServiceIds.includes(service.id);
                  return (
                    <div key={service.id} className={selected ? "card-entitlement-row selected" : "card-entitlement-row"}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => updateCardServiceIds(selected ? cardServiceIds.filter((id) => id !== service.id) : [...cardServiceIds, service.id])}
                        />
                        <span>{service.name}</span>
                      </label>
                      {selected && (
                        <label className="card-entitlement-times">
                          <span>次数</span>
                          <input
                            type="number"
                            min={1}
                            value={cardServiceTimes[service.id] ?? service.defaultTimes ?? 1}
                            onChange={(event) => updateCardServiceTimes(service.id, parseEditableNumber(event.target.value))}
                          />
                        </label>
                      )}
                    </div>
                  );
                })
              )}
            </fieldset>
          )}
          <label>实收金额<input type="number" min={0} value={cardPaidAmount} onChange={(event) => setCardPaidAmount(parseEditableNumber(event.target.value))} /></label>
          <Select label="支付方式" value={cardPayMethod} onChange={(value) => setCardPayMethod(value as CashPayMethod)} options={cashPayMethodOptions} />
          <label>有效期至<input type="date" value={cardExpiresAt} onChange={(event) => setCardExpiresAt(event.target.value)} /></label>
          <label>备注<input value={cardNote} onChange={(event) => setCardNote(event.target.value)} placeholder={cardType === "折扣卡" ? "如生日月权益、全店项目折扣" : cardType === "储值卡" ? "如充值赠送、全店通用说明" : "如活动价、赠送说明"} /></label>
          {cardFormMessage && (
            <p className={cardFormMessage.type === "success" ? "form-success" : "form-error"}>
              {cardFormMessage.text}
            </p>
          )}
          <SubmitStatusButton idleText="保存开卡" busyText="保存中..." />
        </form>
        </section>
        )}
        {(activeModule === "product" || activeModule === "single") && (
        <section className="panel">
        <PanelTitle
          icon={<CreditCard size={18} />}
          title={activeModule === "product" ? "商品" : "项目服务"}
          action={activeModule === "product" ? "商品收银" : "项目收银"}
        />
        <form className="form" onSubmit={checkout}>
          {renderCheckoutCustomerControls()}
          {usesService && (
            <div className="checkout-product-picker">
              <div className="checkout-product-toolbar single">
                <button type="button" onClick={openServicePicker}>
                  <Sparkles size={16} />
                  选择项目
                </button>
              </div>
              <div className="checkout-product-section">
                <div className="checkout-product-section-head">
                  <span>服务项目</span>
                  <strong>{money(serviceSubtotal)}</strong>
                </div>
                {selectedServiceRows.length ? (
                  selectedServiceRows.map(({ service, quantity }) => (
                    <div className="checkout-service-line" key={service.id}>
                      <div>
                        <strong>{service.name}</strong>
                        <span>{service.category || "未分类"} · 单价 {money(service.price)}</span>
                        {usesCustomer && (
                          <small className="checkout-service-card-source">
                            扣卡：{checkoutAutoDebitPlan
                              .filter((row) => row.service.id === service.id)
                              .map((row) => `${row.card.name} ${row.quantity}次`)
                              .join("；") || "无可扣次数"}
                          </small>
                        )}
                      </div>
                      <div className="checkout-product-qty" aria-label={`${service.name} 份数`}>
                        <button type="button" aria-label={`减少${service.name}`} onClick={() => setCheckoutServiceQuantity(service.id, quantity - 1)}>
                          <Minus size={14} />
                        </button>
                        <input
                          inputMode="numeric"
                          value={quantity}
                          onChange={(event) => setCheckoutServiceQuantity(service.id, Number(event.target.value))}
                        />
                        <button type="button" aria-label={`添加${service.name}`} onClick={() => setCheckoutServiceQuantity(service.id, quantity + 1)}>
                          <Plus size={14} />
                        </button>
                      </div>
                      <span>{money(service.price * quantity)}</span>
                      <button type="button" className="checkout-product-remove" onClick={() => setCheckoutServiceQuantity(service.id, 0)} aria-label={`移除${service.name}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="checkout-product-empty">还没有选择项目</div>
                )}
              </div>
            </div>
          )}
          {usesService && arrivedAppointments.length > 0 && (
            <div className="checkout-arrived-appointments">
              <div className="checkout-product-section-head">
                <span>待确认到店预约</span>
                <strong>{arrivedAppointments.length} 单</strong>
              </div>
              <div className="checkout-arrived-list">
                {arrivedAppointments.map((appointment) => (
                  <button
                    type="button"
                    key={appointment.id}
                    className={appointment.id === appointmentId ? "active" : ""}
                    onClick={() => useAppointmentForCheckout(appointment.id)}
                  >
                    <strong>{nameOf(data.customers, appointment.customerId)} · {checkoutAppointmentServiceLabel(appointment)}</strong>
                    <span>{appointmentTimeRange(data, appointment)} · {appointment.roomName ?? "未分配房间"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {usesProduct && (
            <div className="checkout-product-picker">
              <div className="checkout-product-toolbar">
                <button type="button" onClick={() => openProductPicker("sale")}>
                  <PackagePlus size={16} />
                  选择商品
                </button>
                <button type="button" onClick={() => openProductPicker("gift")}>
                  <Gift size={16} />
                  选择赠品
                </button>
              </div>
              <div className="checkout-product-section">
                <div className="checkout-product-section-head">
                  <span>销售商品</span>
                  <strong>{checkoutProductRows.length ? money(productSubtotal) : "未选择"}</strong>
                </div>
                {renderCheckoutCart("sale")}
              </div>
              {checkoutGiftRows.length > 0 && (
                <div className="checkout-product-section gift">
                  <div className="checkout-product-section-head">
                    <span>赠送商品</span>
                    <strong>{checkoutGiftRows.reduce((sum, item) => sum + item.quantity, 0)} 件</strong>
                  </div>
                  {renderCheckoutCart("gift")}
                </div>
              )}
            </div>
          )}
          <Select
            label={usesService ? "服务人员" : "收银人员"}
            value={staffId}
            onChange={(value) => {
              clearAppointment();
              setStaffId(value);
              setCollaboratorStaffIds((previous) => previous.filter((id) => id !== value));
            }}
            options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增人员" }]}
          />
          {usesService && (
            <CheckboxGroup
              label="协作人员"
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
          {usesCustomer && usesService && (
            <>
              <Select
                label="关联到店预约（可选）"
                value={appointmentId}
                onChange={useAppointmentForCheckout}
                options={[
                  { value: "", label: arrivedAppointments.length ? "不关联预约，直接开单" : "暂无待确认到店预约" },
                  ...arrivedAppointments.map((appointment) => ({
                    value: appointment.id,
                    label: `${shortDate(appointment.startAt)} · ${nameOf(data.customers, appointment.customerId)} · ${checkoutAppointmentServiceLabel(appointment)}`,
                  })),
                ]}
              />
              {appointmentId && (
                <p className="form-note">
                  {selectedCheckoutAppointmentNeedsServiceSelection
                    ? "这条预约是到店确认项目，请在上方选择实际服务项目；收银后将生成客户签名，客户签名后预约才会标记为已完成。"
                    : "已带入预约信息，收银后将生成客户签名，客户签名后预约才会标记为已完成。"}
                </p>
              )}
            </>
          )}
          {payMethod === "会员卡" && !serviceAutoDebitActive && (
            <Select
              label="选择会员卡"
              value={cardId}
              onChange={setCardId}
              options={(usesService && selectedServiceRows.length > 0 ? checkoutDebitCandidateCards : availableCards).length
                ? (usesService && selectedServiceRows.length > 0 ? checkoutDebitCandidateCards : availableCards).map((item) => ({ value: item.id, label: `${item.name} · ${item.type} · ${memberCardTimesText(item, data.services, focusedCheckoutServiceId)}` }))
                : [{ value: "", label: usesService ? "当前客户暂无可用会员卡" : "商品购买仅支持储值卡" }]}
            />
          )}
          <>
            <label>
              折扣
              <input
                inputMode="decimal"
                value={checkoutDiscountRateInput}
                onChange={(event) => applyCheckoutDiscountRate(event.target.value)}
                placeholder="如 95 表示 95 折"
              />
            </label>
            <div className="checkout-discount-summary">
              <span>原价 <strong>{money(total)}</strong></span>
              <span>折扣金额 <strong>{money(discountAmount)}</strong></span>
              <span>折后 <strong>{money(checkoutDiscountedPrice)}</strong></span>
              <span>节省 <strong>{money(checkoutSavedAmount)}</strong></span>
            </div>
          </>
          <label>
            {usesProduct && !usesService ? "折扣说明" : "改价原因"}
            <input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder={usesProduct && !usesService ? "如新客折扣、活动价" : "如老客维护、会员权益"} />
          </label>
          <div className="checkout-total">
            <span>应收金额</span>
            <strong>{money(paidTotal)}</strong>
          </div>
          {checkoutMemberCardBlocked && (
            <p className="form-error">会员卡项目次数不足，不能扣卡：{checkoutMemberCardBlockedText}</p>
          )}
          {checkoutServiceCardBlocked && (
            <p className="form-error">客户已购项目次数不足，不能继续开单：{checkoutServiceCardBlockedText}</p>
          )}
          <button className="primary-button" disabled={checkoutSubmitting || checkoutCustomerSelectionInvalid || checkoutMemberCardBlocked || checkoutServiceCardBlocked}>
            {checkoutSubmitting ? "正在收银..." : "完成收银"}
          </button>
        </form>
        </section>
        )}
        {activeModule === "signature" && (
        <section className="panel sg">
          <PanelTitle icon={<LockKeyhole size={18} />} title="客户确认签名" action={selectedSignature ? "当前服务" : "未选择"} />
          {selectedSignature ? (
            <SignatureRecordDetail data={data} signature={selectedSignature} />
          ) : (
            <div className="checkout-product-empty">暂无当前服务签名。完成收银后，会在这里显示本次服务确认。</div>
          )}
        {selectedSignatureBlockMessage && (
          <p className="signature-blocked-message">{selectedSignatureBlockMessage}</p>
        )}
        {selectedSignatureCanComplete && (
          <div className="signature-panel-ready">
            <strong>大屏签名栏已打开</strong>
            <span>请客户在弹出的签名栏中确认本次服务和扣卡信息。</span>
            {signatureMessage && <p className={signatureMessage.type === "success" ? "form-success" : "form-error"}>{signatureMessage.text}</p>}
          </div>
        )}
        </section>
        )}
        {activeModule === "orders" && (
        <section className="panel">
        <PanelTitle
          icon={<ClipboardList size={18} />}
          title="收银流水"
          action={`${cashierFlowRecords.length} 笔`}
        />
          <DataTable
          columns={["客户", "来源", "内容", "服务人员", "支付/扣款", "金额", "状态", "时间", "操作"]}
          rows={cashierFlowRecords
            .map((record) => [
            record.customerName,
            record.source,
            record.itemName,
            record.staffName,
            cashierPaymentText(record),
            money(record.paidAmount),
            <Badge key={`${record.id}-status`} text={record.status} tone={record.status === "已退款" ? "warn" : "ok"} />,
            shortDate(record.createdAt),
            <button key={`${record.id}-detail`} type="button" onClick={() => setSelectedCashierRecordId(record.id)}>
              查看详情
            </button>,
          ])}
        />
        {selectedCashierRecord && (
          <div className="cashier-record-detail">
            <div className="cashier-record-detail-head">
              <strong>流水详情</strong>
              <button type="button" onClick={() => setSelectedCashierRecordId("")}>收起</button>
            </div>
            <dl>
              <div><dt>客户</dt><dd>{selectedCashierCustomer ? `${selectedCashierCustomer.name} · ${selectedCashierCustomer.phone || "-"}` : selectedCashierRecord.customerName}</dd></div>
              <div><dt>来源</dt><dd>{selectedCashierRecord.source}</dd></div>
              <div><dt>内容</dt><dd>{selectedCashierRecord.itemName}</dd></div>
              <div><dt>服务人员</dt><dd>{selectedCashierRecord.staffName}</dd></div>
              <div><dt>支付/扣款</dt><dd>{cashierPaymentText(selectedCashierRecord)}</dd></div>
              <div><dt>金额</dt><dd>{money(selectedCashierRecord.paidAmount)}</dd></div>
              <div><dt>状态</dt><dd>{selectedCashierRecord.status}</dd></div>
              <div><dt>时间</dt><dd>{shortDate(selectedCashierRecord.createdAt)}</dd></div>
              <div><dt>流水编号</dt><dd>{selectedCashierRecord.orderNo}</dd></div>
              <div><dt>关联预约</dt><dd>{selectedCashierAppointment ? appointmentTimeRange(data, selectedCashierAppointment) : "-"}</dd></div>
              <div><dt>会员卡</dt><dd>{selectedCashierMemberCard?.name ?? "-"}</dd></div>
              <div>
                <dt>客户签名</dt>
                <dd>
                  {selectedCashierSignature ? (
                    <span className="cashier-record-signature-status">
                      <Badge
                        text={customerSignatureIsExpired(selectedCashierSignature, signatureNow) ? "已过期" : selectedCashierSignature.status}
                        tone={selectedCashierSignature.status === "已签名" ? "ok" : "warn"}
                      />
                      {selectedCashierSignature.status === "待签名" && !customerSignatureIsExpired(selectedCashierSignature, signatureNow) && (
                        <button type="button" onClick={openCashierSignature}>
                          让客户签名
                        </button>
                      )}
                      {selectedCashierSignature.status === "待签名" && customerSignatureIsExpired(selectedCashierSignature, signatureNow) && (
                        <small>签名已过期，请重新生成</small>
                      )}
                    </span>
                  ) : "-"}
                </dd>
              </div>
            </dl>
            {selectedCashierSignature?.signatureText && (
              <div className="cashier-record-signature">
                <strong>客户签名</strong>
                <img src={selectedCashierSignature.signatureText} alt="客户签名" />
              </div>
            )}
          </div>
        )}
        </section>
        )}
      </div>
      </Modal>
      {activeModule === "signature" && selectedSignatureCanComplete && selectedSignature && selectedSignatureContext && (
        <div className="signature-capture-backdrop" role="dialog" aria-modal="true" aria-label="客户大屏签名">
          <section className="signature-capture-dialog">
            <div className="signature-capture-header">
              <button type="button" className="signature-capture-return" onClick={closeSignatureCapture}>
                <ArrowLeft size={18} />
                <span>返回</span>
              </button>
              <div className="signature-capture-title">
                <span>客户确认签名</span>
                <strong>{selectedSignatureContext.customerName}</strong>
              </div>
              <button type="button" className="signature-capture-close" onClick={closeSignatureCapture} aria-label="关闭签名栏">
                <X size={22} />
              </button>
            </div>
            <div className="signature-capture-summary">
              <span><small>收银内容</small>{selectedSignatureContext.serviceName}</span>
              <span><small>服务人员</small>{selectedSignatureContext.staffName}</span>
              <span><small>订单编号</small>{selectedSignatureContext.orderNo}</span>
              <span><small>金额/支付</small>{selectedSignatureContext.order ? `${money(selectedSignatureContext.order.paidAmount)} · ${selectedSignatureContext.order.payMethod}` : "-"}</span>
            </div>
            {selectedSignatureCardUsageRows.length > 0 && (
              <div className="signature-capture-card-usage">
                {selectedSignatureCardUsageRows.map((row) => (
                  <p className={row.blocked ? "blocked" : ""} key={row.key}>
                    <strong>{row.cardName} · {row.serviceName}</strong>
                    <span>本次用 {row.usedText}，扣前 {row.beforeText}，扣后剩 {row.afterText}（{row.statusText}）</span>
                  </p>
                ))}
              </div>
            )}
            {selectedSignatureCardUsageRows.length === 0 && selectedSignatureServiceRows.length > 0 && (
              <div className="signature-capture-card-usage">
                {selectedSignatureServiceRows.map((row) => (
                  <p key={`${row.serviceId}:service`}>
                    <strong>{row.name}</strong>
                    <span>本次服务 {row.quantity} 次，请客户确认服务内容无误。</span>
                  </p>
                ))}
              </div>
            )}
            <label className="signature-capture-name">
              签名人姓名
              <input value={signatureSignerName} onChange={(event) => setSignatureSignerName(event.target.value)} />
            </label>
            <label className="signature-capture-canvas-label">
              手写签名
              <div className="signature-canvas-wrap signature-capture-canvas-wrap">
                <canvas
                  ref={signatureCanvasRef}
                  width={960}
                  height={420}
                  className="signature-canvas signature-capture-canvas"
                  onPointerDown={startSignatureDrawing}
                  onPointerMove={drawSignature}
                  onPointerUp={stopSignatureDrawing}
                  onPointerCancel={stopSignatureDrawing}
                  onTouchStart={startTouchSignatureDrawing}
                  onTouchMove={drawTouchSignature}
                  onTouchEnd={stopSignatureDrawing}
                  onTouchCancel={stopSignatureDrawing}
                />
                {!hasSignatureDrawing && <span>请客户在此处手写签名</span>}
              </div>
            </label>
            {signatureMessage && <p className={signatureMessage.type === "success" ? "form-success" : "form-error"}>{signatureMessage.text}</p>}
            <div className="signature-capture-actions">
              <button type="button" onClick={clearSignatureDrawing}>清除</button>
              <button type="button" onClick={closeSignatureCapture}>取消</button>
              <button type="button" className="signature-complete-button" disabled={mutationPending} onClick={signSelectedSignature}>
                <LockKeyhole size={18} />
                {mutationPending ? "正在保存签名..." : "确认签名"}
              </button>
            </div>
          </section>
        </div>
      )}
      <Modal
        open={servicePickerOpen}
        title="选择项目"
        size="large"
        onClose={() => setServicePickerOpen(false)}
        footer={
          <div className="modal-actions">
            <button type="button" onClick={() => setServicePickerOpen(false)}>返回</button>
            <button type="button" className="primary-button" disabled={selectedServices.length === 0} onClick={() => setServicePickerOpen(false)}>
              确认选择
            </button>
          </div>
        }
      >
        <div className="product-picker-modal">
          <div className="product-picker-filters">
            <label>
              <Search size={15} />
              <input value={servicePickerSearch} {...searchInputSync(setServicePickerSearch)} placeholder="搜索项目名称或分类" />
            </label>
            <div className="product-picker-category-list">
              {servicePickerCategories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={category === servicePickerCategory ? "active" : ""}
                  onClick={() => setServicePickerCategory(category)}
                >
                  <span>{category}</span>
                  <em>{servicePickerCategoryCount(category)}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="product-picker-grid">
            {servicePickerServices.length ? servicePickerServices.map((service) => {
              const quantity = checkoutServiceIds.filter((id) => id === service.id).length;
              return (
              <button
                type="button"
                className={`product-picker-card service-picker-card ${quantity > 0 ? "selected" : ""}`}
                key={service.id}
                onClick={() => selectCheckoutService(service.id)}
              >
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.category || "未分类"} · {service.duration} 分钟</span>
                </div>
                <div className="product-picker-card-meta">
                  <span>{money(service.price)}</span>
                  <small>{quantity > 0 ? `已选 ${quantity} 份` : "默认 1 份"}</small>
                </div>
              </button>
              );
            }) : (
              <div className="product-picker-empty">{servicePickerEmptyText}</div>
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={productPickerOpen}
        title={productPickerMode === "sale" ? "选择商品" : "选择赠品"}
        subtitle={productPickerMode === "sale" ? "可选择多个商品并调整数量" : "赠品会扣库存，不计入应收金额"}
        size="large"
        onClose={() => setProductPickerOpen(false)}
      >
        <div className="product-picker-modal">
          <div className="product-picker-filters">
            <label>
              <Search size={15} />
              <input value={productPickerSearch} {...searchInputSync(setProductPickerSearch)} placeholder="搜索商品名称或分类" />
            </label>
            <div className="product-picker-category-list">
              {productPickerCategories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={category === productPickerCategory ? "active" : ""}
                  onClick={() => {
                    setProductPickerCategory(category);
                    setProductPickerSubcategory("全部小类");
                  }}
                >
                  <span>{category}</span>
                  <em>{productPickerCategoryCount(category)}</em>
                </button>
              ))}
            </div>
            <div className="product-picker-subcategory-list">
              {productPickerSubcategories.map((subcategory) => (
                <button
                  type="button"
                  key={subcategory}
                  className={subcategory === productPickerSubcategory ? "active" : ""}
                  onClick={() => setProductPickerSubcategory(subcategory)}
                >
                  <span>{subcategory}</span>
                  <em>{productPickerSubcategoryCount(subcategory)}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="product-picker-grid">
            {productPickerProducts.length ? productPickerProducts.map((product) => {
              const pickerItems = productPickerMode === "sale" ? checkoutProductItems : checkoutGiftItems;
              const quantity = pickerItems.find((item) => item.productId === product.id)?.quantity ?? 0;
              return (
                <article className={`product-picker-card ${quantity ? "selected" : ""}`} key={`${productPickerMode}-${product.id}`}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.category || "未分类"} · {product.subcategory || "未分组"}</span>
                  </div>
                  <div className="product-picker-card-meta">
                    <span>{money(product.price)}</span>
                    <small>库存 {product.stock}{product.unit}</small>
                  </div>
                  <div className="product-picker-card-actions">
                    {quantity > 0 && (
                      <button type="button" aria-label={`减少${product.name}`} onClick={() => setCheckoutItemQuantity(productPickerMode, product.id, quantity - 1)}>
                        <Minus size={14} />
                      </button>
                    )}
                    <strong className="product-picker-selected-count" aria-live="polite">
                      {quantity > 0 ? `已选 ${quantity} 件` : "未选"}
                    </strong>
                    <button type="button" aria-label={`添加${product.name}`} disabled={product.stock <= quantity} onClick={() => addCheckoutItem(productPickerMode, product.id)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="product-picker-empty">没有匹配的商品</div>
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={checkoutValidationMessages.length > 0}
        title="请补全开单信息"
        subtitle="确认收银前需要先处理下面的问题"
        onClose={() => setCheckoutValidationMessages([])}
      >
        <div className="checkout-validation-modal" role="alert" aria-live="assertive">
          {checkoutValidationMessages.map((message) => (
            <div key={message} className="checkout-validation-item">
              {message}
            </div>
          ))}
        </div>
      </Modal>
      {checkoutSuccessMessage && (
        <div className="checkout-success-toast" role="status" aria-live="polite">
          {checkoutSuccessMessage}
        </div>
      )}
    </div>
  );
}

function Customers({
  data,
  actions,
  runMutation,
  setView,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  setView: NavigateToView;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const mutationPending = useMutationPending();
  const serviceStaff = businessStaffOf(data);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [cardCustomerMode, setCardCustomerMode] = useState<CardCustomerMode>("new");
  const [cardCustomerName, setCardCustomerName] = useState("");
  const [cardCustomerPhone, setCardCustomerPhone] = useState("");
  const [cardCustomerBirthday, setCardCustomerBirthday] = useState("");
  const [cardCustomerNote, setCardCustomerNote] = useState("");
  const [cardName, setCardName] = useState(DEFAULT_PROJECT_CARD_NAME);
  const [cardType, setCardType] = useState<CardType>("储值卡");
  const [cardAmount, setCardAmount] = useState<EditableNumber>(5000);
  const [cardPaidAmount, setCardPaidAmount] = useState<EditableNumber>(5000);
  const [cardPayMethod, setCardPayMethod] = useState<CashPayMethod>("微信");
  const [cardTimes, setCardTimes] = useState<EditableNumber>(10);
  const [cardDiscountRate, setCardDiscountRate] = useState<EditableNumber>(9);
  const [cardServiceId, setCardServiceId] = useState(data.services[0]?.id ?? "");
  const [cardServiceIds, setCardServiceIds] = useState<string[]>(data.services[0]?.id ? [data.services[0].id] : []);
  const [cardServiceTimes, setCardServiceTimes] = useState<Record<string, EditableNumber>>(() => (
    data.services[0]?.id ? { [data.services[0].id]: data.services[0].defaultTimes || 10 } : {}
  ));
  const [cardExpiresAt, setCardExpiresAt] = useState(addMonthsInputValue(12));
  const [cardNote, setCardNote] = useState("");
  const [cardFormMessage, setCardFormMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const customerCardDraftTouchedRef = useRef(false);
  const customerCardNameInputRef = useRef<HTMLInputElement | null>(null);
  const customerCardPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const customerCardCardNameInputRef = useRef<HTMLInputElement | null>(null);
  const [operationCardId, setOperationCardId] = useState(data.memberCards[0]?.id ?? "");
  const [rechargeAmount, setRechargeAmount] = useState<EditableNumber>(300);
  const [rechargeTimes, setRechargeTimes] = useState<EditableNumber>(0);
  const [rechargePaidAmount, setRechargePaidAmount] = useState<EditableNumber>(300);
  const [rechargePayMethod, setRechargePayMethod] = useState<CashPayMethod>("微信");
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
  const [followUpCustomerId, setFollowUpCustomerId] = useState(data.customers[0]?.id ?? "");
  const [followUpStaffId, setFollowUpStaffId] = useState(serviceStaff[0]?.id ?? "");
  const [followUpType, setFollowUpType] = useState<CustomerFollowUpType>("服务后回访");
  const [followUpMethod, setFollowUpMethod] = useState<"电话" | "微信" | "到店">("微信");
  const [followUpDueAt, setFollowUpDueAt] = useState(toLocalInputValue(tomorrowAt(24)));
  const [followUpNote, setFollowUpNote] = useState("");
  const [activeModule, setActiveModule] = useState<"profile" | "cards" | "followup" | "signature" | undefined>();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<"all" | "follow" | "card" | "recent">("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState(data.customers[0]?.id ?? "");
  const [customerDetailTab, setCustomerDetailTab] = useState<"overview" | "cards" | "orders" | "records" | "signatures" | "followups">("overview");
  const [selectedSignatureId, setSelectedSignatureId] = useState("");
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editCustomerSource, setEditCustomerSource] = useState("");
  const [editCustomerLevel, setEditCustomerLevel] = useState("");
  const [editCustomerBirthday, setEditCustomerBirthday] = useState("");
  const [editCustomerTags, setEditCustomerTags] = useState("");
  const [editCustomerNote, setEditCustomerNote] = useState("");
  const [editCustomerReason, setEditCustomerReason] = useState("");
  const [editingFollowUpId, setEditingFollowUpId] = useState("");
  const [editFollowUpStaffId, setEditFollowUpStaffId] = useState("");
  const [editFollowUpMethod, setEditFollowUpMethod] = useState<"电话" | "微信" | "到店">("微信");
  const [editFollowUpDueAt, setEditFollowUpDueAt] = useState("");
  const [editFollowUpNote, setEditFollowUpNote] = useState("");
  const [editFollowUpReason, setEditFollowUpReason] = useState("");
  const cardAmountValue = editableNumberValue(cardAmount);
  const cardPaidAmountValue = editableNumberValue(cardPaidAmount);
  const cardTimesValue = editableNumberValue(cardTimes);
  const cardDiscountRateValue = editableNumberValue(cardDiscountRate);
  const rechargeAmountValue = editableNumberOrZero(rechargeAmount);
  const rechargeTimesValue = editableNumberOrZero(rechargeTimes);
  const rechargePaidAmountValue = editableNumberOrZero(rechargePaidAmount);

  useEffect(() => {
    if (recordOrderId && !data.orders.some((order) => order.id === recordOrderId && order.customerId === recordCustomerId)) {
      setRecordOrderId("");
    }
  }, [recordCustomerId, recordOrderId, data.orders]);

  const addCustomer = (event: FormEvent) => {
    event.preventDefault();
    const submittedName = name.trim();
    const submittedPhone = normalizeMobilePhoneDraft(phone);
    void runMutation(async () => {
      if (!submittedName) throw new Error("请输入客户姓名");
      if (submittedPhone.length !== 11) throw new Error("手机号必须为 11 位数字");
      return actions.addCustomer({ name: submittedName, phone: submittedPhone });
    }).then(() => {
      setName("");
      setPhone("");
    });
  };

  const parseCustomerTags = (value: string) =>
    Array.from(new Set(value.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean)));

  const openCustomerEdit = (customer: AppData["customers"][number]) => {
    setEditCustomerName(customer.name);
    setEditCustomerPhone(normalizeMobilePhoneDraft(customer.phone));
    setEditCustomerSource(customer.source);
    setEditCustomerLevel(customer.level);
    setEditCustomerBirthday(formatBirthdayDraft(customer.birthday ?? ""));
    setEditCustomerTags(customer.tags.join("，"));
    setEditCustomerNote(customer.note ?? "");
    setEditCustomerReason("");
    setCustomerEditOpen(true);
  };

  const saveCustomerEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer) return;
    const nextName = editCustomerName.trim();
    const nextPhone = normalizeMobilePhoneDraft(editCustomerPhone);
    const nextBirthday = normalizeBirthdayForSubmit(editCustomerBirthday);
    if (!nextName || !nextPhone) return;
    if (nextPhone.length !== 11) return;
    if (editCustomerBirthday.trim() && !nextBirthday) return;
    void runMutation(() =>
      actions.updateCustomer(selectedCustomer.id, {
        name: nextName,
        phone: nextPhone,
        level: editCustomerLevel.trim() || "普通会员",
        source: editCustomerSource.trim() || "门店登记",
        birthday: nextBirthday,
        tags: parseCustomerTags(editCustomerTags),
        note: editCustomerNote.trim(),
        reason: editCustomerReason.trim(),
      }),
    ).then(() => setCustomerEditOpen(false));
  };

  const openFollowUpEdit = (followUp: AppData["customerFollowUps"][number]) => {
    setEditingFollowUpId(followUp.id);
    setEditFollowUpStaffId(followUp.staffId);
    setEditFollowUpMethod(followUp.method);
    setEditFollowUpDueAt(toLocalInputValue(followUp.dueAt));
    setEditFollowUpNote(followUp.note);
    setEditFollowUpReason("");
  };

  const saveFollowUpEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingFollowUpId || !editFollowUpDueAt || !editFollowUpNote.trim()) return;
    void runMutation(() =>
      actions.updateFollowUp(editingFollowUpId, {
        staffId: editFollowUpStaffId,
        dueAt: new Date(editFollowUpDueAt).toISOString(),
        method: editFollowUpMethod,
        note: editFollowUpNote.trim(),
        reason: editFollowUpReason.trim(),
      }),
    ).then(() => setEditingFollowUpId(""));
  };

  const changeCardCustomerMode = (value: CardCustomerMode) => {
    setCardCustomerMode(value);
    if (value === "existing") customerCardDraftTouchedRef.current = false;
  };

  const updateCardCustomerName = (value: string) => {
    customerCardDraftTouchedRef.current = true;
    setCardCustomerName(value);
  };

  const updateCardCustomerPhone = (value: string, input?: HTMLInputElement | null) => {
    const nextPhone = normalizeMobilePhoneDraft(value);
    customerCardDraftTouchedRef.current = true;
    setCardCustomerPhone(nextPhone);
    if (input && input.value !== nextPhone) input.value = nextPhone;
  };

  const readCardCustomerName = () => (customerCardNameInputRef.current?.value ?? cardCustomerName).trim();

  const readCardCustomerPhone = () => normalizeMobilePhoneDraft(customerCardPhoneInputRef.current?.value ?? cardCustomerPhone);

  const readCardName = () => (customerCardCardNameInputRef.current?.value ?? cardName).trim();

  const updateCardName = (value: string) => {
    setCardName(value);
  };

  const clearCardCustomerDraft = () => {
    customerCardDraftTouchedRef.current = false;
    setCardCustomerName("");
    setCardCustomerPhone("");
    setCardCustomerBirthday("");
    setCardCustomerNote("");
    if (customerCardNameInputRef.current) customerCardNameInputRef.current.value = "";
    if (customerCardPhoneInputRef.current) customerCardPhoneInputRef.current.value = "";
  };

  const updateCardServiceIds = (serviceIds: string[]) => {
    const nextServiceIds = Array.from(new Set(serviceIds.filter(Boolean)));
    setCardServiceIds(nextServiceIds);
    setCardServiceId(nextServiceIds[0] ?? "");
    setCardServiceTimes((previous) => {
      const next: Record<string, EditableNumber> = {};
      nextServiceIds.forEach((id) => {
        const service = data.services.find((item) => item.id === id);
        next[id] = previous[id] ?? service?.defaultTimes ?? (typeof cardTimes === "number" && cardTimes > 0 ? cardTimes : 1);
      });
      return next;
    });
  };

  const updateCardServiceTimes = (serviceId: string, value: EditableNumber) => {
    setCardServiceTimes((previous) => ({ ...previous, [serviceId]: value }));
  };

  const buildCardServiceEntitlements = () =>
    cardServiceIds.map((serviceId) => {
      const totalTimes = editableNumberValue(cardServiceTimes[serviceId]);
      return { serviceId, totalTimes, remainingTimes: totalTimes };
    });

  const openCard = (event: FormEvent) => {
    event.preventDefault();
    setCardFormMessage(undefined);
    const draftError = cardCustomerDraftError(cardCustomerMode, readCardCustomerName(), readCardCustomerPhone());
    if (draftError) {
      setCardFormMessage({ type: "error", text: draftError });
      return;
    }
    void runMutation(async () => {
      const submittedCardName = cardType === "储值卡" ? DEFAULT_STORED_VALUE_CARD_NAME : cardType === "折扣卡" ? (readCardName() || DEFAULT_DISCOUNT_CARD_NAME) : readCardName();
      const submittedCustomerName = cardCustomerMode === "new" ? readCardCustomerName() : "";
      const submittedCustomerPhone = cardCustomerMode === "new" ? readCardCustomerPhone() : "";
      const submittedCustomerBirthday = cardCustomerMode === "new" ? normalizeBirthdayForSubmit(cardCustomerBirthday) : "";
      const submittedCustomerNote = cardCustomerMode === "new" ? cardCustomerNote.trim() : "";
      const submittedServiceEntitlements = cardType === "次数卡" || cardType === "套餐卡" ? buildCardServiceEntitlements() : [];
      const submittedRemainingTimes = submittedServiceEntitlements.reduce((sum, item) => sum + item.totalTimes, 0);
      if (cardCustomerMode === "existing" && !customerId) throw new Error("请选择开卡客户");
      if (cardCustomerMode === "new" && cardCustomerBirthday.trim() && !submittedCustomerBirthday) throw new Error("客户生日请按 YYYY-MM-DD 填写");
      if (cardType !== "储值卡" && !submittedCardName) throw new Error("请填写卡名称");
      if (!Number.isFinite(cardPaidAmountValue) || cardPaidAmountValue <= 0) {
        throw new Error("请填写开卡实收金额");
      }
      if (cardType === "储值卡" && (!Number.isFinite(cardAmountValue) || cardAmountValue <= 0)) {
        throw new Error("储值卡需要填写到账余额");
      }
      if ((cardType === "次数卡" || cardType === "套餐卡") && cardServiceIds.length === 0) {
        throw new Error("请选择可用项目");
      }
      if ((cardType === "次数卡" || cardType === "套餐卡") && submittedServiceEntitlements.some((item) => !Number.isFinite(item.totalTimes) || item.totalTimes <= 0)) {
        throw new Error("请填写每个可用项目的次数");
      }
      if ((cardType === "次数卡" || cardType === "套餐卡") && submittedRemainingTimes <= 0) {
        throw new Error("次数卡和套餐卡需要填写可用次数");
      }
      if (cardType === "折扣卡" && (!Number.isFinite(cardDiscountRateValue) || cardDiscountRateValue < 1 || cardDiscountRateValue >= 10)) {
        throw new Error("折扣卡折扣必须在 1 折到 9.9 折之间");
      }
      return actions.openMemberCard({
        customerId: cardCustomerMode === "existing" ? customerId : undefined,
        customerName: cardCustomerMode === "new" ? submittedCustomerName : undefined,
        customerPhone: cardCustomerMode === "new" ? submittedCustomerPhone : undefined,
        customerBirthday: submittedCustomerBirthday || undefined,
        customerNote: submittedCustomerNote || undefined,
        name: submittedCardName,
        type: cardType,
        balance: cardType === "储值卡" ? cardAmountValue : 0,
        remainingTimes: cardType === "次数卡" || cardType === "套餐卡" ? submittedRemainingTimes : 0,
        discountRate: cardType === "折扣卡" ? cardDiscountRateValue / 10 : undefined,
        benefitText: cardType === "折扣卡" ? `${cardDiscountRateValue} 折权益` : undefined,
        serviceId: cardType === "次数卡" || cardType === "套餐卡" ? cardServiceIds[0] : undefined,
        serviceIds: cardType === "次数卡" || cardType === "套餐卡" ? cardServiceIds : undefined,
        serviceEntitlements: cardType === "次数卡" || cardType === "套餐卡" ? submittedServiceEntitlements : undefined,
        paidAmount: cardPaidAmountValue,
        payMethod: cardPayMethod,
        expiresAt: cardExpiresAt,
        note: cardNote.trim() || undefined,
      });
    }).then(() => {
      clearCardCustomerDraft();
      setCardNote("");
      setCardFormMessage({ type: "success", text: "开卡成功，已写入收银流水。" });
    }).catch((caught) => {
      setCardFormMessage({ type: "error", text: caught instanceof Error ? caught.message : "开卡保存失败" });
    });
  };

  const rechargeCard = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() =>
      actions.rechargeMemberCard(operationCardId, {
        amount: rechargeAmountValue,
        times: rechargeTimesValue,
        paidAmount: rechargePaidAmountValue || undefined,
        payMethod: rechargePaidAmountValue > 0 ? rechargePayMethod : undefined,
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

  const addCustomerFollowUp = (event: FormEvent) => {
    event.preventDefault();
    const note = followUpNote.trim();
    if (!note || !followUpDueAt) return;
    void runMutation(() =>
      actions.addFollowUp({
        customerId: followUpCustomerId,
        staffId: followUpStaffId,
        dueAt: new Date(followUpDueAt).toISOString(),
        method: followUpMethod,
        note: `【${followUpType}】${note}`,
      }),
    ).then(() => {
      setFollowUpNote("");
      setCustomerDetailTab("followups");
      setActiveModule(undefined);
    });
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

  useEffect(() => {
    if (data.customers.length === 0) {
      if (selectedCustomerId) setSelectedCustomerId("");
      return;
    }
    if (!data.customers.some((customer) => customer.id === selectedCustomerId)) {
      setSelectedCustomerId(data.customers[0].id);
    }
  }, [data.customers, selectedCustomerId]);
  const serviceProductSummary = (order: Order) => {
    const service = data.services.find((item) => item.id === order.serviceId);
    const consumables =
      order.serviceConsumables?.length
        ? order.serviceConsumables
        : service?.consumables?.length
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
    const retailProducts = order.productItems?.length
      ? order.productItems.map((item) => {
          const product = data.products.find((productItem) => productItem.id === item.productId);
          return product ? `${product.name} x${item.quantity}${product.unit}` : "";
        })
      : [
          order.productId
            ? (() => {
                const product = data.products.find((productItem) => productItem.id === order.productId);
                return product ? `${product.name} x1${product.unit}` : "";
              })()
            : "",
        ];
    return [...serviceProducts, ...retailProducts].filter(Boolean).join("、");
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
    const serviceName = order.serviceName || nameOf(data.services, order.serviceId);
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
        label: `${order.orderNo} · ${order.serviceName || nameOf(data.services, order.serviceId)} · ${money(order.paidAmount)}${cardConsumptionSummary(order) ? ` · ${cardConsumptionSummary(order)}` : ""}`,
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
        label: `${order.orderNo} · ${order.serviceName || nameOf(data.services, order.serviceId)} · ${money(order.paidAmount)}`,
      })),
  ];
  const signatureUrl = (token: string) => `${window.location.origin}/signature/${token}`;
  const selectedSignature = data.customerSignatures.find((signature) => signature.id === selectedSignatureId);
  const recentVisits = data.customers.filter((customer) => {
    const days = (Date.now() - +new Date(customer.lastVisit)) / 86400000;
    return days <= 7;
  }).length;
  const pendingFollowUps = data.customerFollowUps.filter((followUp) => followUp.status === "待跟进").length;
  const customerRecentVisit = (lastVisit: string) => {
    const days = (Date.now() - +new Date(lastVisit)) / 86400000;
    return Number.isFinite(days) && days <= 30;
  };
  const customerHasPendingFollowUp = (id: string) => data.customerFollowUps.some((followUp) => followUp.customerId === id && followUp.status === "待跟进");
  const customerHasActiveCard = (id: string) => data.memberCards.some((card) => card.customerId === id && card.status === "正常");
  const filteredCustomers = data.customers.filter((customer) => {
    const keyword = customerSearch.trim().toLowerCase();
    const matchesKeyword = !keyword
      || customer.name.toLowerCase().includes(keyword)
      || customer.phone.toLowerCase().includes(keyword)
      || customer.tags.some((tag) => tag.toLowerCase().includes(keyword));
    const matchesFilter =
      customerFilter === "all"
      || (customerFilter === "follow" && customerHasPendingFollowUp(customer.id))
      || (customerFilter === "card" && customerHasActiveCard(customer.id))
      || (customerFilter === "recent" && customerRecentVisit(customer.lastVisit));
    return matchesKeyword && matchesFilter;
  });
  const selectedCustomer = data.customers.find((customer) => customer.id === selectedCustomerId) ?? filteredCustomers[0] ?? data.customers[0];
  const selectedCustomerCards = selectedCustomer ? data.memberCards.filter((card) => card.customerId === selectedCustomer.id) : [];
  const selectedCustomerActiveCards = selectedCustomerCards.filter((card) => card.status === "正常");
  const selectedCustomerRecords = selectedCustomer
    ? data.customerServiceRecords
        .filter((record) => record.customerId === selectedCustomer.id)
        .slice()
        .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
    : [];
  const selectedCustomerOrders = selectedCustomer
    ? data.orders
        .filter((order) => order.customerId === selectedCustomer.id)
        .slice()
        .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
    : [];
  const selectedCustomerOrderIds = new Set(selectedCustomerOrders.map((order) => order.id));
  const selectedCustomerRefunds = selectedCustomer
    ? data.refunds
        .filter((refund) => selectedCustomerOrderIds.has(refund.orderId))
        .slice()
        .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
    : [];
  const selectedCustomerSignatures = selectedCustomer
    ? data.customerSignatures
        .filter((signature) => signature.customerId === selectedCustomer.id)
        .slice()
        .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
    : [];
  const selectedCustomerFollowUps = selectedCustomer
    ? data.customerFollowUps
        .filter((followUp) => followUp.customerId === selectedCustomer.id)
        .slice()
        .sort((left, right) => +new Date(right.dueAt) - +new Date(left.dueAt))
    : [];
  const selectedCardBalance = selectedCustomerActiveCards.reduce((sum, card) => sum + card.balance, 0);
  const selectedRemainingTimes = selectedCustomerActiveCards.reduce((sum, card) => sum + card.remainingTimes, 0);
  const selectedCardTimesSummary = selectedCustomerActiveCards.length
    ? memberCardTimesText(selectedCustomerActiveCards[0], data.services)
    : "-";
  const activeCardCustomerCount = new Set(activeCards.map((card) => card.customerId)).size;
  const lastServiceRecord = selectedCustomerRecords[0];
  const latestOrder = selectedCustomerOrders[0];
  const nextFollowUp = selectedCustomerFollowUps.find((followUp) => followUp.status === "待跟进");
  const customerInitial = selectedCustomer?.name.trim().slice(0, 1) || "客";
  const customerFilterOptions = [
    { key: "all", label: "全部", count: data.customers.length },
    { key: "follow", label: "待跟进", count: pendingFollowUps },
    { key: "card", label: "有项目卡", count: activeCardCustomerCount },
    { key: "recent", label: "近期到店", count: recentVisits },
  ] as const;
  const customerDetailTabs = [
    { key: "overview", label: "客户概览", count: selectedCustomer ? 1 : 0 },
    { key: "cards", label: "项目卡", count: selectedCustomerCards.length },
    { key: "orders", label: "消费记录", count: selectedCustomerOrders.length },
    { key: "records", label: "服务记录", count: selectedCustomerRecords.length },
    { key: "signatures", label: "签名记录", count: selectedCustomerSignatures.length },
    { key: "followups", label: "跟进计划", count: selectedCustomerFollowUps.length },
  ] as const;
  const showEmptyCustomerDetail = !selectedCustomer;
  type CustomerModuleKey = NonNullable<typeof activeModule>;
  const customerModules: Array<FeatureModule<CustomerModuleKey>> = [
    { key: "profile", title: "客户档案", desc: "客户资料和客户列表", icon: UsersRound, tone: "violet", meta: `${data.customers.length} 位` },
    { key: "cards", title: "项目次数卡", desc: "开项目卡、充值次数和核销记录", icon: CreditCard, tone: "rose", meta: `${activeCards.length} 张` },
    { key: "followup", title: "新增跟进计划", desc: "回访、护理提醒、会员关怀", icon: MessageCircle, tone: "jade", meta: `${pendingFollowUps} 位` },
    { key: "signature", title: "服务确认签名", desc: "", icon: LockKeyhole, tone: "plum", meta: `${data.customerSignatures?.length ?? 0} 份` },
  ];
  const activeModuleTitle = activeModule ? customerModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const activeModuleSubtitle = activeModule === "followup" ? "为当前客户设置回访、护理提醒或会员关怀任务" : "客户资料、项目卡和服务确认记录";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };
  const openCustomerModule = (module: CustomerModuleKey) => {
    if (selectedCustomer) {
      setCustomerId(selectedCustomer.id);
      setRecordCustomerId(selectedCustomer.id);
      setFollowUpCustomerId(selectedCustomer.id);
      setSignatureCustomerId(selectedCustomer.id);
    }
    setActiveModule(module);
  };
  const renewSelectedCustomer = () => {
    if (!selectedCustomer) return;
    setView("pos", { posModule: "card", posCustomerId: selectedCustomer.id });
  };

  return (
    <div className="page-stack customer-module-page module-hub">
      <PageHero
        icon={<UsersRound size={15} />}
        eyebrow="客户档案"
        title="客户管理"
        stats={[
          { label: "客户总数", value: `${data.customers.length} 位`, hint: `${recentVisits} 位近 7 天到店`, icon: <UsersRound size={18} /> },
          { label: "有效项目卡", value: `${activeCards.length} 张`, hint: `${totalRemainingTimes} 次可核销`, icon: <CreditCard size={18} /> },
          { label: "待跟进", value: `${pendingFollowUps} 位`, hint: "客户关怀任务", icon: <MessageCircle size={18} /> },
          { label: "待签名", value: `${pendingSignatures} 份`, hint: "客户确认签名", icon: <LockKeyhole size={18} /> },
        ]}
      />
      <section className="customer-workspace">
        <aside className="customer-directory-panel">
          <div className="customer-directory-head">
            <div>
              <span><UsersRound size={17} /> 客户列表</span>
            </div>
          </div>
          <label className="customer-search-field">
            <Search size={17} />
            <input value={customerSearch} {...searchInputSync(setCustomerSearch)} placeholder="搜索姓名 / 手机号 / 标签" />
          </label>
          <div className="customer-filter-tabs" aria-label="客户筛选">
            {customerFilterOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                className={customerFilter === option.key ? "active" : undefined}
                aria-pressed={customerFilter === option.key}
                onClick={() => setCustomerFilter(option.key)}
              >
                <span>{option.label}</span>
                <em>{option.count}</em>
              </button>
            ))}
          </div>
          <div className="customer-list">
            {filteredCustomers.map((customer) => {
              const cardCount = data.memberCards.filter((card) => card.customerId === customer.id && card.status === "正常").length;
              const recordCount = data.customerServiceRecords.filter((record) => record.customerId === customer.id).length;
              const hasFollow = customerHasPendingFollowUp(customer.id);
              return (
                <button
                  type="button"
                  key={customer.id}
                  className={selectedCustomer?.id === customer.id ? "customer-list-card active" : "customer-list-card"}
                  onClick={() => {
                    setSelectedCustomerId(customer.id);
                    setCustomerDetailTab("overview");
                  }}
                >
                  <span className="customer-avatar">{customer.name.trim().slice(0, 1) || "客"}</span>
                  <span className="customer-list-main">
                    <strong>{customer.name}</strong>
                    <small>{customer.phone} · 最近 {shortDate(customer.lastVisit)}</small>
                    <span className="customer-mini-tags">
                      <i>{customer.level || "普通会员"}</i>
                      {cardCount > 0 && <i>{cardCount} 张卡</i>}
                      {hasFollow && <i>待跟进</i>}
                      {recordCount > 0 && <i>{recordCount} 次服务</i>}
                    </span>
                  </span>
                </button>
              );
            })}
            {filteredCustomers.length === 0 && (
              <div className="customer-empty-state">
                <strong>没有找到客户</strong>
                <span>换个关键词，或检查客户是否已在收银建档。</span>
              </div>
            )}
          </div>
        </aside>

        <section className="customer-detail-panel">
          {showEmptyCustomerDetail ? (
            <div className="customer-detail-empty">
              <UsersRound size={34} />
              <strong>暂无客户档案</strong>
              <span>客户在收银流程建档后，可以在这里查看项目卡、服务记录和跟进。</span>
            </div>
          ) : (
            <>
              <div className="customer-profile-head">
                <span className="customer-profile-avatar">{customerInitial}</span>
                <div className="customer-profile-copy">
                  <span>{selectedCustomer.level || "普通会员"}</span>
                  <div className="customer-profile-title-row">
                    <strong>{selectedCustomer.name}</strong>
                    <button type="button" className="customer-edit-profile-button" onClick={() => openCustomerEdit(selectedCustomer)}>
                      <Pencil size={15} />
                      编辑资料
                    </button>
                  </div>
                  <small>{selectedCustomer.phone} · 来源 {selectedCustomer.source || "门店建档"} · 最近到店 {shortDate(selectedCustomer.lastVisit)}</small>
                  <div className="customer-profile-tags">
                    {(selectedCustomer.tags.length ? selectedCustomer.tags : ["门店客户"]).slice(0, 4).map((tag) => <i key={tag}>{tag}</i>)}
                  </div>
                </div>
                <div className="customer-profile-actions">
                  <button type="button" onClick={() => openCustomerModule("followup")}>
                    <MessageCircle size={16} />
                    新增跟进
                  </button>
                  <button type="button" onClick={renewSelectedCustomer}>
                    <CreditCard size={16} />
                    续费
                  </button>
                </div>
              </div>

              <div className="customer-asset-grid">
                <div>
                  <span>项目次数明细</span>
                  <strong>{selectedCardTimesSummary}</strong>
                  <small>{selectedCustomerActiveCards.length} 张有效卡 · 总剩 {selectedRemainingTimes} 次</small>
                </div>
                <div>
                  <span>储值余额</span>
                  <strong>{money(selectedCardBalance)}</strong>
                  <small>可用于卡扣/储值消费</small>
                </div>
                <div>
                  <span>最近消费</span>
                  <strong>{latestOrder ? money(latestOrder.paidAmount) : "-"}</strong>
                  <small>{latestOrder ? shortDate(latestOrder.createdAt) : "暂无订单"}</small>
                </div>
                <div>
                  <span>下次跟进</span>
                  <strong>{nextFollowUp ? shortDate(nextFollowUp.dueAt) : "-"}</strong>
                  <small>{nextFollowUp ? nextFollowUp.note : "暂无待跟进"}</small>
                </div>
              </div>

              <div className="customer-detail-tabs" aria-label="客户详情标签">
                {customerDetailTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.key}
                    className={customerDetailTab === tab.key ? "active" : undefined}
                    aria-pressed={customerDetailTab === tab.key}
                    onClick={() => setCustomerDetailTab(tab.key)}
                  >
                    <span>{tab.label}</span>
                    <em>{tab.count}</em>
                  </button>
                ))}
              </div>

              {customerDetailTab === "overview" && (
                <div className="customer-overview-grid">
                  <section className="customer-info-card">
                    <div className="customer-section-title">
                      <strong>项目卡</strong>
                    </div>
                    <div className="customer-card-stack">
                      {selectedCustomerCards.slice(0, 3).map((card) => (
                        <article key={card.id}>
                          <div>
                            <strong>{card.name}</strong>
                            <span>{card.type} · {memberCardProjectScopeText(card, data.services)}</span>
                          </div>
                          <em>{memberCardTimesText(card, data.services)}</em>
                        </article>
                      ))}
                      {selectedCustomerCards.length === 0 && <p className="customer-soft-empty">暂无项目卡</p>}
                    </div>
                  </section>
                  <section className="customer-info-card">
                    <div className="customer-section-title">
                      <strong>最近服务</strong>
                      <button type="button" onClick={() => setCustomerDetailTab("records")}>查看</button>
                    </div>
                    <div className="customer-timeline">
                      {selectedCustomerRecords.slice(0, 3).map((record) => (
                        <article key={record.id}>
                          <time>{shortDate(record.createdAt)}</time>
                          <div>
                            <strong>{nameOf(data.services, record.serviceId)}</strong>
                            <span>{nameOf(data.staff, record.staffId)} · {record.customerFeedback || record.nextCareAdvice || "已完成服务"}</span>
                          </div>
                        </article>
                      ))}
                      {selectedCustomerRecords.length === 0 && <p className="customer-soft-empty">暂无服务记录</p>}
                    </div>
                  </section>
                  <section className="customer-info-card customer-advice-card">
                    <div className="customer-section-title">
                      <strong>{selectedCustomer.note ? "客户备注" : "下次建议"}</strong>
                    </div>
                    <p>{selectedCustomer.note || lastServiceRecord?.nextCareAdvice || nextFollowUp?.note || "暂无护理建议，可在跟进计划中补充客户状态和下次建议。"}</p>
                  </section>
                </div>
              )}

              {customerDetailTab === "cards" && (
                <div className="customer-table-panel">
                  <DataTable
                    columns={["卡名", "类型", "余额", "次数", "适用项目", "有效期", "状态"]}
                    rows={selectedCustomerCards.map((card) => [
                      card.name,
                      card.type,
                      money(card.balance),
                      memberCardTimesText(card, data.services),
                      memberCardProjectScopeText(card, data.services),
                      shortDate(card.expiresAt),
                      <Badge key={`${card.id}-status`} text={card.status} tone={card.status === "正常" ? "ok" : "warn"} />,
                    ])}
                  />
                  {selectedCustomerCards.length === 0 && <p className="customer-soft-empty">当前客户暂无项目卡</p>}
                </div>
              )}

              {customerDetailTab === "orders" && (
                <div className="customer-table-panel">
                  <DataTable
                    columns={["时间", "单号", "项目/商品", "服务人员", "原价", "实收", "支付", "卡扣", "状态"]}
                    rows={selectedCustomerOrders.map((order) => [
                      shortDate(order.createdAt),
                      order.orderNo,
                      order.serviceName || serviceProductSummary(order) || nameOf(data.services, order.serviceId) || "未关联项目",
                      nameOf(data.staff, order.staffId),
                      money(order.totalAmount),
                      money(order.paidAmount),
                      order.payMethod,
                      cardConsumptionSummary(order) || "-",
                      <Badge key={`${order.id}-status`} text={order.status} tone={order.status === "已退款" ? "warn" : "ok"} />,
                    ])}
                  />
                  {selectedCustomerOrders.length === 0 && <p className="customer-soft-empty">当前客户暂无消费记录</p>}
                  {selectedCustomerRefunds.length > 0 && (
                    <>
                      <div className="divider" />
                      <PanelTitle icon={<RefreshCw size={18} />} title="退款记录" action={`${selectedCustomerRefunds.length} 笔`} />
                      <DataTable
                        columns={["时间", "订单", "退款金额", "原因", "状态"]}
                        rows={selectedCustomerRefunds.map((refund) => [
                          shortDate(refund.createdAt),
                          selectedCustomerOrders.find((order) => order.id === refund.orderId)?.orderNo ?? refund.orderId,
                          money(refund.amount),
                          refund.reason,
                          "已退款",
                        ])}
                      />
                    </>
                  )}
                </div>
              )}

              {customerDetailTab === "records" && (
                <div className="customer-table-panel">
                  <DataTable
                    columns={["时间", "项目", "服务人员", "皮肤情况", "护理步骤", "客户反馈", "下次建议"]}
                    rows={selectedCustomerRecords.map((record) => [
                      shortDate(record.createdAt),
                      nameOf(data.services, record.serviceId),
                      nameOf(data.staff, record.staffId),
                      record.skinCondition,
                      record.careSteps || "-",
                      record.customerFeedback || "-",
                      record.nextCareAdvice || "-",
                    ])}
                  />
                  {selectedCustomerRecords.length === 0 && <p className="customer-soft-empty">当前客户暂无服务记录</p>}
                </div>
              )}

              {customerDetailTab === "signatures" && (
                <div className="customer-table-panel">
                  <DataTable
                    columns={["服务项目", "状态", "签名人", "签名时间", "操作"]}
                    rows={selectedCustomerSignatures.map((signature) => {
                      const context = signatureRecordContext(data, signature);
                      return [
                        context.serviceName,
                        <Badge key={`${signature.id}-status`} text={signature.status} tone={signature.status === "已签名" ? "ok" : "warn"} />,
                        signature.signerName ?? "-",
                        signature.signedAt ? shortDate(signature.signedAt) : "-",
                        <span className="signature-record-actions" key={`${signature.id}-actions`}>
                          {signature.status === "待签名" && <a href={signatureUrl(signature.token)} target="_blank" rel="noreferrer">签名页</a>}
                          <button type="button" onClick={() => setSelectedSignatureId(signature.id)}>详情</button>
                        </span>,
                      ];
                    })}
                  />
                  {selectedSignature && <SignatureRecordDetail data={data} signature={selectedSignature} />}
                  {selectedCustomerSignatures.length === 0 && <p className="customer-soft-empty">当前客户暂无签名记录</p>}
                </div>
              )}

              {customerDetailTab === "followups" && (
                <div className="customer-table-panel">
                  <DataTable
                    columns={["计划时间", "负责人", "方式", "状态", "跟进内容", "操作"]}
                    rows={selectedCustomerFollowUps.map((followUp) => [
                      shortDate(followUp.dueAt),
                      nameOf(data.staff, followUp.staffId),
                      followUp.method,
                      <Badge key={`${followUp.id}-status`} text={followUp.status} tone={followUp.status === "已完成" ? "ok" : "warn"} />,
                      followUp.note,
                      <span className="customer-followup-actions" key={`${followUp.id}-actions`}>
                        <button type="button" disabled={mutationPending} onClick={() => openFollowUpEdit(followUp)}>编辑</button>
                        {followUp.status === "待跟进" ? (
                          <button type="button" disabled={mutationPending} onClick={() => void runMutation(() => actions.completeFollowUp(followUp.id))}>
                            {mutationPending ? "处理中..." : "完成"}
                          </button>
                        ) : <span>已完成</span>}
                      </span>,
                    ])}
                  />
                  {selectedCustomerFollowUps.length === 0 && <p className="customer-soft-empty">当前客户暂无跟进计划</p>}
                </div>
              )}
            </>
          )}
        </section>
      </section>
      <Modal
        open={customerEditOpen && Boolean(selectedCustomer)}
        title="编辑客户资料"
        subtitle="姓名、手机号、来源、标签、生日和备注"
        size="large"
        onClose={() => setCustomerEditOpen(false)}
      >
        <form className="form customer-edit-form" onSubmit={saveCustomerEdit}>
          <label>客户姓名<input value={editCustomerName} onChange={(event) => setEditCustomerName(event.target.value)} autoComplete="name" required /></label>
          <label>手机号<input type="tel" inputMode="numeric" maxLength={11} value={editCustomerPhone} onChange={(event) => setEditCustomerPhone(normalizeMobilePhoneDraft(event.target.value))} autoComplete="tel" required /></label>
          <label>会员等级<input value={editCustomerLevel} onChange={(event) => setEditCustomerLevel(event.target.value)} placeholder="普通会员" /></label>
          <label>生日<input type="text" inputMode="numeric" autoComplete="bday" placeholder="1998-06-12" maxLength={10} value={editCustomerBirthday} onChange={(event) => setEditCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} onBlur={(event) => setEditCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} /></label>
          <label>来源<input value={editCustomerSource} onChange={(event) => setEditCustomerSource(event.target.value)} placeholder="门店登记 / 开卡登记 / 老客转介绍" /></label>
          <label>标签<input value={editCustomerTags} onChange={(event) => setEditCustomerTags(event.target.value)} placeholder="多个标签用逗号分隔" /></label>
          <label className="span-2">客户备注<textarea value={editCustomerNote} onChange={(event) => setEditCustomerNote(event.target.value)} placeholder="客户皮肤状态、偏好、禁忌、沟通注意事项等" /></label>
          <label className="span-2">修改说明<textarea value={editCustomerReason} onChange={(event) => setEditCustomerReason(event.target.value)} placeholder="例如：手机号录入错误，已核对客户本人。普通小改可简写。" /></label>
          <p className="form-note span-2">保存后会记录修改人、时间、改动字段和修改说明。</p>
          <div className="form-submit-row span-2">
            <button type="button" onClick={() => setCustomerEditOpen(false)}>取消</button>
            <SubmitStatusButton idleText="保存修改" busyText="保存中..." disabled={!editCustomerName.trim() || editCustomerPhone.length !== 11} />
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(editingFollowUpId)}
        title="编辑跟进内容"
        subtitle="只修改当前这条跟进记录"
        size="medium"
        onClose={() => setEditingFollowUpId("")}
      >
        <form className="form customer-edit-form" onSubmit={saveFollowUpEdit}>
          <Select label="负责人" value={editFollowUpStaffId} onChange={setEditFollowUpStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增人员" }]} />
          <Select label="跟进方式" value={editFollowUpMethod} onChange={(value) => setEditFollowUpMethod(value as "电话" | "微信" | "到店")} options={["微信", "电话", "到店"].map((item) => ({ value: item, label: item }))} />
          <DateTimeInput label="计划跟进时间" value={editFollowUpDueAt} onChange={setEditFollowUpDueAt} />
          <label>跟进内容<textarea value={editFollowUpNote} onChange={(event) => setEditFollowUpNote(event.target.value)} /></label>
          <label className="span-2">修改说明<textarea value={editFollowUpReason} onChange={(event) => setEditFollowUpReason(event.target.value)} placeholder="例如：客户改约，跟进时间顺延。" /></label>
          <p className="form-note span-2">保存后会记录修改人、时间、改动字段和修改说明。</p>
          <div className="form-submit-row span-2">
            <button type="button" onClick={() => setEditingFollowUpId("")}>取消</button>
            <SubmitStatusButton idleText="保存修改" busyText="保存中..." disabled={!editFollowUpDueAt || !editFollowUpNote.trim()} />
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "客户档案"}
        subtitle={activeModuleSubtitle}
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
          <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
          <label>手机号<input type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(event) => setPhone(normalizeMobilePhoneDraft(event.target.value))} required /></label>
          <SubmitStatusButton idleText="保存客户" busyText="保存中..." />
        </form>
        </>
        )}
        {activeModule === "cards" && (
        <>
        <PanelTitle icon={<CreditCard size={18} />} title="开卡" action="储值 / 次数 / 套餐 / 折扣" />
        <form className="form" onSubmit={openCard}>
          <Select label="客户登记" value={cardCustomerMode} onChange={(value) => changeCardCustomerMode(value as CardCustomerMode)} options={[{ value: "new", label: "新客户登记" }, { value: "existing", label: "已有客户" }]} />
          {cardCustomerMode === "existing" ? (
            <Select
              label="客户"
              value={customerId}
              onChange={setCustomerId}
              options={data.customers.map(customerOptionOf)}
              searchable
            />
          ) : (
            <>
              <label>客户姓名<input ref={customerCardNameInputRef} defaultValue={cardCustomerName} onInput={(event) => updateCardCustomerName(event.currentTarget.value)} onBlur={(event) => updateCardCustomerName(event.currentTarget.value)} onCompositionEnd={(event) => updateCardCustomerName(event.currentTarget.value)} autoComplete="name" /></label>
              <label>客户手机号<input ref={customerCardPhoneInputRef} type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} defaultValue={cardCustomerPhone} onInput={(event) => updateCardCustomerPhone(event.currentTarget.value, event.currentTarget)} onBlur={(event) => updateCardCustomerPhone(event.currentTarget.value, event.currentTarget)} /></label>
              <label>客户生日（选填）<input type="text" inputMode="numeric" autoComplete="bday" placeholder="1998-06-12" maxLength={10} value={cardCustomerBirthday} onChange={(event) => setCardCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} onBlur={(event) => setCardCustomerBirthday(formatBirthdayDraft(event.currentTarget.value))} /></label>
              <label>客户备注（选填）<input value={cardCustomerNote} onChange={(event) => setCardCustomerNote(event.target.value)} placeholder="如护理偏好、禁忌、沟通注意事项" /></label>
            </>
          )}
          <Select label="卡类型" value={cardType} onChange={(value) => setCardType(value as CardType)} options={["储值卡", "次数卡", "套餐卡", "折扣卡"].map((item) => ({ value: item, label: item }))} />
          {cardType !== "储值卡" && (
            <label>卡名称<input ref={customerCardCardNameInputRef} defaultValue={cardName} onInput={(event) => updateCardName(event.currentTarget.value)} onBlur={(event) => updateCardName(event.currentTarget.value)} onCompositionEnd={(event) => updateCardName(event.currentTarget.value)} placeholder="如面部护理十次卡" /></label>
          )}
          {cardType === "储值卡" && (
            <label>充值到账余额<input type="number" min={0} value={cardAmount} onChange={(event) => setCardAmount(parseEditableNumber(event.target.value))} /></label>
          )}
          {cardType === "折扣卡" && (
            <label>会员折扣<input type="number" min={1} max={9.9} step={0.1} value={cardDiscountRate} onChange={(event) => setCardDiscountRate(parseEditableNumber(event.target.value))} /></label>
          )}
          {(cardType === "次数卡" || cardType === "套餐卡") && (
            <fieldset className="card-entitlement-group">
              <legend>项目权益明细</legend>
              {data.services.length === 0 ? (
                <span>暂无可选项目</span>
              ) : (
                data.services.map((service) => {
                  const selected = cardServiceIds.includes(service.id);
                  return (
                    <div key={service.id} className={selected ? "card-entitlement-row selected" : "card-entitlement-row"}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => updateCardServiceIds(selected ? cardServiceIds.filter((id) => id !== service.id) : [...cardServiceIds, service.id])}
                        />
                        <span>{service.name}</span>
                      </label>
                      {selected && (
                        <label className="card-entitlement-times">
                          <span>次数</span>
                          <input
                            type="number"
                            min={1}
                            value={cardServiceTimes[service.id] ?? service.defaultTimes ?? 1}
                            onChange={(event) => updateCardServiceTimes(service.id, parseEditableNumber(event.target.value))}
                          />
                        </label>
                      )}
                    </div>
                  );
                })
              )}
            </fieldset>
          )}
          <label>实收金额<input type="number" min={0} value={cardPaidAmount} onChange={(event) => setCardPaidAmount(parseEditableNumber(event.target.value))} /></label>
          <Select label="支付方式" value={cardPayMethod} onChange={(value) => setCardPayMethod(value as CashPayMethod)} options={cashPayMethodOptions} />
          <label>有效期至<input type="date" value={cardExpiresAt} onChange={(event) => setCardExpiresAt(event.target.value)} /></label>
          <label>备注<input value={cardNote} onChange={(event) => setCardNote(event.target.value)} placeholder={cardType === "折扣卡" ? "如生日月权益、全店项目折扣" : cardType === "储值卡" ? "如充值赠送、全店通用说明" : "如活动价、赠送说明"} /></label>
          {cardFormMessage && (
            <p className={cardFormMessage.type === "success" ? "form-success" : "form-error"}>
              {cardFormMessage.text}
            </p>
          )}
          <SubmitStatusButton idleText="保存开卡" busyText="保存中..." />
        </form>
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="项目卡操作" action="充值/加次/冻结/延期" />
        <form className="form" onSubmit={rechargeCard}>
          <Select label="项目卡" value={operationCardId} onChange={setOperationCardId} options={data.memberCards.map((card) => ({ value: card.id, label: `${nameOf(data.customers, card.customerId)} · ${card.name}` }))} />
          <label>充值金额<input type="number" value={rechargeAmount} onChange={(event) => setRechargeAmount(parseEditableNumber(event.target.value))} /></label>
          <label>增加次数<input type="number" value={rechargeTimes} onChange={(event) => setRechargeTimes(parseEditableNumber(event.target.value))} /></label>
          <label>实收金额<input type="number" value={rechargePaidAmount} onChange={(event) => setRechargePaidAmount(parseEditableNumber(event.target.value))} /></label>
          <Select label="支付方式" value={rechargePayMethod} onChange={(value) => setRechargePayMethod(value as CashPayMethod)} options={cashPayMethodOptions} />
          <SubmitStatusButton idleText="保存调整" busyText="保存中..." />
        </form>
        <div className="inline-actions">
          <button disabled={mutationPending} onClick={() => void runMutation(() => actions.updateMemberCardStatus(operationCardId, "冻结", "门店冻结"))}>{mutationPending ? "处理中..." : "冻结"}</button>
          <button disabled={mutationPending} onClick={() => void runMutation(() => actions.updateMemberCardStatus(operationCardId, "正常", "门店解冻"))}>{mutationPending ? "处理中..." : "解冻"}</button>
        </div>
        <div className="inline-form compact">
          <label>延期至<input type="date" value={extendTo} onChange={(event) => setExtendTo(event.target.value)} /></label>
          <button disabled={mutationPending} onClick={() => void runMutation(() => actions.extendMemberCard(operationCardId, extendTo, "客户延期"))}>{mutationPending ? "处理中..." : "延期"}</button>
        </div>
        <div className="inline-form compact">
          <Select label="转给客户" value={transferToCustomerId} onChange={setTransferToCustomerId} options={data.customers.map(customerOptionOf)} />
          <button disabled={mutationPending} onClick={() => void runMutation(() => actions.transferMemberCard(operationCardId, transferToCustomerId, "客户转卡"))}>{mutationPending ? "处理中..." : "转卡"}</button>
        </div>
        </>
        )}
        {activeModule === "followup" && (
        <>
        <PanelTitle icon={<MessageCircle size={18} />} title="新增跟进计划" action="客户关怀任务" />
        <form className="form" onSubmit={addCustomerFollowUp}>
          <label>客户<input value={nameOf(data.customers, followUpCustomerId)} readOnly /></label>
          <Select label="负责人" value={followUpStaffId} onChange={setFollowUpStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先到人员账号新增人员" }]} />
          <Select label="跟进类型" value={followUpType} onChange={(value) => setFollowUpType(value as CustomerFollowUpType)} options={customerFollowUpTypeOptions} />
          <Select label="跟进方式" value={followUpMethod} onChange={(value) => setFollowUpMethod(value as "电话" | "微信" | "到店")} options={["微信", "电话", "到店"].map((item) => ({ value: item, label: item }))} />
          <DateTimeInput label="计划跟进时间" value={followUpDueAt} onChange={setFollowUpDueAt} />
          <label>跟进内容<textarea value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} placeholder="例如：提醒客户 7 天后复查皮肤状态，确认下次护理时间。" /></label>
          <SubmitStatusButton idleText="保存跟进" busyText="保存中..." disabled={!followUpCustomerId || !followUpStaffId || !followUpDueAt || !followUpNote.trim()} />
        </form>
        </>
        )}
        {activeModule === "signature" && (
        <>
        <PanelTitle icon={<LockKeyhole size={18} />} title="服务确认签名" action={`${data.customerSignatures?.length ?? 0} 份`} />
        <form className="form" onSubmit={createSignature}>
          <Select label="客户" value={signatureCustomerId} onChange={(value) => { setSignatureCustomerId(value); setSignatureRecordId(""); setSignatureOrderId(""); }} options={data.customers.map(customerOptionOf)} />
          <Select label="关联档案" value={signatureRecordId} onChange={setSignatureRecordId} options={signatureRecordOptions} />
          <Select label="关联订单" value={signatureOrderId} onChange={setSignatureOrderId} options={signatureOrderOptions} />
          <label>签名标题<input value={signatureTitle} onChange={(event) => setSignatureTitle(event.target.value)} /></label>
          <label>确认内容<textarea value={signatureContent} onChange={(event) => setSignatureContent(event.target.value)} /></label>
          <label>有效期（天）<input type="number" min={1} value={signatureValidDays} onChange={(event) => setSignatureValidDays(Number(event.target.value))} /></label>
          <SubmitStatusButton idleText="生成现场签名页" busyText="生成中..." disabled={!signatureCustomerId || (!signatureRecordId && !signatureOrderId)} />
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
              .map((card) => `${card.name}(${memberCardTimesText(card, data.services)})`)
              .join("，") || "未开卡",
            `${data.customerServiceRecords.filter((record) => record.customerId === customer.id).length} 条`,
            `${data.customerSignatures.filter((signature) => signature.customerId === customer.id).length} 份`,
          ])}
        />
        </section>
        )}
        {activeModule === "cards" && (
        <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="会员卡列表" action="余额/次数/权益/退卡" />
        <DataTable
          columns={["客户", "会员卡", "类型", "余额", "剩余次数", "权益", "适用项目", "到期", "状态", "操作"]}
          rows={data.memberCards.map((card) => [
            nameOf(data.customers, card.customerId),
            card.name,
            card.type,
            money(card.balance),
            memberCardTimesText(card, data.services),
            card.benefitText ?? (card.discountRate ? `${Number((card.discountRate * 10).toFixed(1))} 折` : "-"),
            memberCardProjectScopeText(card, data.services),
            shortDate(card.expiresAt),
            <Badge key={`${card.id}-status`} text={card.status} tone={card.status === "已退卡" ? "warn" : "ok"} />,
            card.status === "正常" ? "客户退费办理" : "已处理",
          ])}
        />
        <div className="divider" />
        <PanelTitle icon={<CreditCard size={18} />} title="项目卡流水" action="开卡/核销/退款" />
        <DataTable
          columns={["卡项", "类型", "实收", "支付", "金额变动", "次数变动", "余额", "剩余次数", "备注", "时间"]}
          rows={data.memberCardTransactions.map((transaction) => [
            nameOf(data.memberCards, transaction.memberCardId),
            transaction.type,
            transaction.paidAmount ? money(transaction.paidAmount) : "-",
            transaction.payMethod ?? "-",
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
        {activeModule === "signature" && (
        <section className="panel sg">
        <PanelTitle icon={<LockKeyhole size={18} />} title="服务签名记录" action={`${data.customerSignatures?.length ?? 0} 份`} />
        <DataTable
          columns={["客户", "服务项目", "状态", "签名人", "签名时间", "关联记录", "操作"]}
          rows={(data.customerSignatures ?? []).map((signature) => {
            const context = signatureRecordContext(data, signature);
            return [
              context.customerName,
              context.serviceName,
              <Badge key={`${signature.id}-status`} text={signature.status} tone={signature.status === "已签名" ? "ok" : "warn"} />,
              signature.signerName ?? "-",
              signature.signedAt ? shortDate(signature.signedAt) : "-",
              context.orderNo !== "-" ? context.orderNo : signature.serviceRecordId ? "服务档案" : "未关联",
              <span className="signature-record-actions" key={`${signature.id}-actions`}>
                {signature.status === "待签名" && (
                  <a href={signatureUrl(signature.token)} target="_blank" rel="noreferrer">
                    打开签名页
                  </a>
                )}
                <button type="button" onClick={() => setSelectedSignatureId(signature.id)}>
                  查看详情
                </button>
              </span>,
            ];
          })}
        />
        {selectedSignature && <SignatureRecordDetail data={data} signature={selectedSignature} />}
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
  initialModule,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  initialModule?: CatalogModuleKey;
  onReturnManagement?: () => void;
}) {
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState(398);
  const [serviceDuration, setServiceDuration] = useState(60);
  const [serviceDefaultTimes, setServiceDefaultTimes] = useState(10);
  const [serviceConsumables, setServiceConsumables] = useState<ServiceConsumable[]>([]);
  const [recipeServiceId, setRecipeServiceId] = useState(data.services[0]?.id ?? "");
  const [productName, setProductName] = useState("");
  const [productStock, setProductStock] = useState(10);
  const [showServiceCreate, setShowServiceCreate] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState("");
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceCategory, setEditServiceCategory] = useState("");
  const [editServiceSubcategory, setEditServiceSubcategory] = useState("");
  const [editServicePrice, setEditServicePrice] = useState<EditableNumber>(0);
  const [editServiceDuration, setEditServiceDuration] = useState<EditableNumber>(60);
  const [editServiceDefaultTimes, setEditServiceDefaultTimes] = useState<EditableNumber>(1);
  const [editServiceStatus, setEditServiceStatus] = useState<"启用" | "停用">("启用");
  const [editServiceConsumables, setEditServiceConsumables] = useState<ServiceConsumable[]>([]);
  const [editServiceReason, setEditServiceReason] = useState("");
  const [activeModule, setActiveModule] = useState<CatalogModuleKey | undefined>(fromManagement ? initialModule ?? "serviceList" : undefined);

  const resetServiceForm = () => {
    setServiceName("");
    setServiceDefaultTimes(10);
    setServiceConsumables([]);
    setShowServiceCreate(false);
  };

  const defaultServiceConsumableForProduct = (productId: string, products = data.products): ServiceConsumable => {
    const product = products.find((item) => item.id === productId);
    return {
      productId,
      quantity: product && productServiceStockDeductible(product) ? 1 : 0,
    };
  };

  const addServiceConsumable = (productId: string) => {
    setServiceConsumables((items) => mergeUsedProducts([...items, defaultServiceConsumableForProduct(productId)], data.products));
  };

  const updateServiceConsumableQuantity = (productId: string, quantity: number) => {
    setServiceConsumables((items) => mergeUsedProducts(items.map((item) => (item.productId === productId ? { ...item, quantity } : item)), data.products));
  };

  const removeServiceConsumable = (productId: string) => {
    setServiceConsumables((items) => items.filter((item) => item.productId !== productId));
  };

  const createServiceConsumable = ({ name, category, subcategory }: { name: string; category: string; subcategory: string }) => {
    void runMutation(async () => {
      const nextData = await actions.addProduct({ name, stock: 0, type: "sale", category, subcategory, unit: "件" });
      const product = findCreatedProduct(nextData.products, name, category, subcategory);
      if (product) {
        setServiceConsumables((items) => mergeUsedProducts([...items, defaultServiceConsumableForProduct(product.id, nextData.products)], nextData.products));
      }
      return nextData;
    });
  };

  const addService = (event: FormEvent) => {
    event.preventDefault();
    const consumables = mergeUsedProducts(serviceConsumables, data.products);
    void runMutation(() =>
      actions.addService({
        name: serviceName,
        price: servicePrice,
        category: "自定义项目",
        duration: serviceDuration,
        defaultTimes: serviceDefaultTimes,
        consumables,
      }),
    ).then(resetServiceForm);
  };

  const selectedRecipeService = data.services.find((service) => service.id === recipeServiceId);
  const recipeConsumables = serviceConsumablesOf(selectedRecipeService);
  const addRecipeConsumable = (event: FormEvent) => {
    event.preventDefault();
  };

  const addRecipeProduct = (productId: string) => {
    if (!recipeServiceId) return;
    const nextConsumables = mergeUsedProducts([...recipeConsumables, defaultServiceConsumableForProduct(productId)], data.products);
    void runMutation(() => actions.updateServiceConsumables(recipeServiceId, nextConsumables));
  };

  const updateRecipeConsumableQuantity = (productId: string, quantity: number) => {
    const nextConsumables = mergeUsedProducts(recipeConsumables.map((item) => (item.productId === productId ? { ...item, quantity } : item)), data.products);
    void runMutation(() => actions.updateServiceConsumables(recipeServiceId, nextConsumables));
  };

  const createRecipeProduct = ({ name, category, subcategory }: { name: string; category: string; subcategory: string }) => {
    if (!recipeServiceId) return;
    void runMutation(async () => {
      const nextData = await actions.addProduct({ name, stock: 0, type: "sale", category, subcategory, unit: "件" });
      const product = findCreatedProduct(nextData.products, name, category, subcategory);
      if (!product) return nextData;
      const nextService = nextData.services.find((service) => service.id === recipeServiceId);
      const nextConsumables = mergeUsedProducts([...serviceConsumablesOf(nextService), defaultServiceConsumableForProduct(product.id, nextData.products)], nextData.products);
      return actions.updateServiceConsumables(recipeServiceId, nextConsumables);
    });
  };

  const removeRecipeConsumable = (productId: string) => {
    const nextConsumables = recipeConsumables.filter((item) => item.productId !== productId);
    void runMutation(() => actions.updateServiceConsumables(recipeServiceId, nextConsumables));
  };

  const openServiceEdit = (service: Service) => {
    setEditingServiceId(service.id);
    setEditServiceName(service.name);
    setEditServiceCategory(service.category);
    setEditServiceSubcategory(service.subcategory ?? "");
    setEditServicePrice(service.price);
    setEditServiceDuration(service.duration);
    setEditServiceDefaultTimes(service.defaultTimes ?? 1);
    setEditServiceStatus(service.status ?? "启用");
    setEditServiceConsumables(serviceConsumablesOf(service));
    setEditServiceReason("");
  };

  const saveServiceEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingServiceId) return;
    void runMutation(() => actions.updateService(editingServiceId, {
      name: editServiceName,
      category: editServiceCategory,
      subcategory: editServiceSubcategory,
      price: editableNumberValue(editServicePrice),
      duration: editableNumberValue(editServiceDuration),
      defaultTimes: editableNumberValue(editServiceDefaultTimes),
      consumables: mergeUsedProducts(editServiceConsumables, data.products),
      status: editServiceStatus,
      reason: editServiceReason.trim() || undefined,
    })).then(() => setEditingServiceId(""));
  };

  const addEditServiceConsumable = (productId: string) => {
    setEditServiceConsumables((items) => mergeUsedProducts([...items, defaultServiceConsumableForProduct(productId)], data.products));
  };

  const updateEditServiceConsumableQuantity = (productId: string, quantity: number) => {
    setEditServiceConsumables((items) => mergeUsedProducts(items.map((item) => (item.productId === productId ? { ...item, quantity } : item)), data.products));
  };

  const removeEditServiceConsumable = (productId: string) => {
    setEditServiceConsumables((items) => items.filter((item) => item.productId !== productId));
  };

  const createEditServiceConsumable = ({ name, category, subcategory }: { name: string; category: string; subcategory: string }) => {
    void runMutation(async () => {
      const nextData = await actions.addProduct({ name, stock: 0, type: "sale", category, subcategory, unit: "件" });
      const product = findCreatedProduct(nextData.products, name, category, subcategory);
      if (product) {
        setEditServiceConsumables((items) => mergeUsedProducts([...items, defaultServiceConsumableForProduct(product.id, nextData.products)], nextData.products));
      }
      return nextData;
    });
  };

  const addProduct = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addProduct({ name: productName, stock: productStock, type: "sale", unit: "件" }));
    setProductName("");
  };
  const catalogModules: Array<FeatureModule<CatalogModuleKey>> = [
    { key: "service", title: "新增项目", desc: "服务名称、价格、时长和次数", icon: Sparkles, tone: "violet", meta: "服务目录" },
    { key: "recipe", title: "商品耗材", desc: "配置服务使用商品", icon: PackagePlus, tone: "jade", meta: "使用商品" },
    { key: "product", title: "新增商品", desc: "新增商品和初始库存", icon: Boxes, tone: "teal", meta: "库存资料" },
    { key: "serviceList", title: "项目目录", desc: "查看服务项目、价格和时长", icon: ClipboardList, tone: "rose", meta: `${data.services.length} 个` },
    { key: "productList", title: "商品列表", desc: "查看商品库存和库存预警", icon: Boxes, tone: "amber", meta: `${data.products.length} 个` },
    { key: "formulaList", title: "使用商品总览", desc: "查看项目对应使用商品", icon: PackagePlus, tone: "plum", meta: "商品耗材" },
  ];
  const catalogOverviewModules = catalogModules.filter((item) => item.key !== "recipe" && item.key !== "formulaList");
  const activeModuleTitle = activeModule ? catalogModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  useEffect(() => {
    if (fromManagement) setActiveModule(initialModule ?? "serviceList");
  }, [fromManagement, initialModule]);

  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  const serviceProductPicker = (
    <ProductUsagePicker
      products={data.products}
      selected={serviceConsumables}
      onAdd={addServiceConsumable}
      onCreate={createServiceConsumable}
      onRemove={removeServiceConsumable}
      onQuantityChange={updateServiceConsumableQuantity}
    />
  );

  return (
    <div className="page-stack module-hub catalog-module-page">
      <PageHero
        icon={<Sparkles size={15} />}
        eyebrow="项目商品"
        title="项目商品"
        stats={[
          { label: "服务项目", value: `${data.services.length} 个`, hint: "可用于预约/开单", icon: <Sparkles size={18} /> },
          { label: "商品资料", value: `${data.products.length} 个`, hint: "库存资料", icon: <Boxes size={18} /> },
          { label: "低库存", value: `${data.products.filter((item) => item.stock <= item.warningStock).length} 项`, hint: "需补货", icon: <PackagePlus size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={catalogOverviewModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "项目商品"}
        subtitle="项目商品"
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
          <label>可用次数<input type="number" min={1} value={serviceDefaultTimes} onChange={(event) => setServiceDefaultTimes(Number(event.target.value))} /></label>
          {serviceProductPicker}
          <div className="form-submit-row">
            <SubmitStatusButton idleText="保存项目" busyText="保存中..." />
          </div>
        </form>
        </section>
        )}
        {activeModule === "recipe" && (
        <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="商品耗材" action="使用商品" />
        <form className="form" onSubmit={addRecipeConsumable}>
          <Select label="服务项目" value={recipeServiceId} onChange={setRecipeServiceId} options={data.services.map(optionOf)} />
          <ProductUsagePicker
            products={data.products}
            selected={recipeConsumables}
            onAdd={addRecipeProduct}
            onCreate={createRecipeProduct}
            onRemove={removeRecipeConsumable}
            onQuantityChange={updateRecipeConsumableQuantity}
          />
        </form>
        </section>
        )}
        {activeModule === "product" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="新增商品" action="库存资料" />
        <form className="form" onSubmit={addProduct}>
          <label>名称<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
          <label>初始库存<input type="number" value={productStock} onChange={(event) => setProductStock(Number(event.target.value))} /></label>
          <div className="form-submit-row">
            <SubmitStatusButton idleText="保存商品" busyText="保存中..." />
          </div>
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
            </div>
            <form className="form catalog-inline-form" onSubmit={addService}>
              <label>项目名称<input value={serviceName} onChange={(event) => setServiceName(event.target.value)} required /></label>
              <label>标准价格<input type="number" value={servicePrice} onChange={(event) => setServicePrice(Number(event.target.value))} /></label>
              <label>服务时长<input type="number" value={serviceDuration} onChange={(event) => setServiceDuration(Number(event.target.value))} /></label>
              <label>可用次数<input type="number" min={1} value={serviceDefaultTimes} onChange={(event) => setServiceDefaultTimes(Number(event.target.value))} /></label>
              {serviceProductPicker}
              <div className="form-submit-row">
                <SubmitStatusButton idleText="保存项目" busyText="保存中..." />
              </div>
            </form>
          </div>
          )}
          <DataTable
            columns={["项目", "分类", "价格", "时长", "可用次数", "使用商品", "操作"]}
            rows={data.services.map((item) => [
              item.name,
              [item.category, item.subcategory].filter(Boolean).join(" / "),
              money(item.price),
              `${item.duration} 分钟`,
              `${item.defaultTimes ?? 1} 次`,
              serviceFormulaSummary(item, data.products),
              <button key={`${item.id}-edit`} type="button" className="catalog-edit-button" onClick={() => openServiceEdit(item)}>
                <Pencil size={14} />
                编辑项目
              </button>,
            ])}
          />
        </section>
        )}
        {activeModule === "productList" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="商品列表" action="库存资料" />
        <DataTable columns={["商品", "大类", "小类", "库存", "预警", "项目扣减"]} rows={data.products.map((item) => [item.name, item.category ?? "面护类", item.subcategory ?? "-", formatProductStockWithServiceUnits(item, item.stock), `${item.warningStock}${item.unit}`, productServiceDeductionLabel(item)])} />
        </section>
        )}
        {activeModule === "formulaList" && (
        <section className="panel">
        <PanelTitle icon={<PackagePlus size={18} />} title="使用商品总览" action="商品耗材" />
        <DataTable
          columns={["项目", "分类", "使用商品"]}
          rows={data.services.map((item) => [item.name, item.category, serviceFormulaSummary(item, data.products)])}
        />
        </section>
        )}
      </div>
      </Modal>
      <Modal
        open={Boolean(editingServiceId)}
        title="编辑项目"
        subtitle="项目基础资料和绑定耗材"
        size="large"
        onClose={() => setEditingServiceId("")}
      >
        <form className="form catalog-edit-form" onSubmit={saveServiceEdit}>
          <div className="catalog-edit-grid">
            <label>项目名称<input value={editServiceName} onChange={(event) => setEditServiceName(event.target.value)} required /></label>
            <label>大类<input value={editServiceCategory} onChange={(event) => setEditServiceCategory(event.target.value)} required /></label>
            <label>小类<input value={editServiceSubcategory} onChange={(event) => setEditServiceSubcategory(event.target.value)} /></label>
            <label>价格<input type="number" min={0} value={editServicePrice} onChange={(event) => setEditServicePrice(parseEditableNumber(event.target.value))} /></label>
            <label>时长（分钟）<input type="number" min={1} value={editServiceDuration} onChange={(event) => setEditServiceDuration(parseEditableNumber(event.target.value))} /></label>
            <label>可服务次数<input type="number" min={1} value={editServiceDefaultTimes} onChange={(event) => setEditServiceDefaultTimes(parseEditableNumber(event.target.value))} /></label>
            <Select
              label="状态"
              value={editServiceStatus}
              onChange={(value) => setEditServiceStatus(value as "启用" | "停用")}
              options={[
                { value: "启用", label: "启用" },
                { value: "停用", label: "停用" },
              ]}
            />
          </div>
          <ProductUsagePicker
            products={data.products}
            selected={editServiceConsumables}
            onAdd={addEditServiceConsumable}
            onCreate={createEditServiceConsumable}
            onRemove={removeEditServiceConsumable}
            onQuantityChange={updateEditServiceConsumableQuantity}
          />
          <label>修改说明<textarea value={editServiceReason} onChange={(event) => setEditServiceReason(event.target.value)} placeholder="例如：项目价格录错，修正为当前价格" /></label>
          <p className="catalog-edit-note">保存后只影响以后开单/开卡；历史订单会保留当时的项目名称和金额。</p>
          <div className="form-submit-row">
            <button type="button" onClick={() => setEditingServiceId("")}>取消</button>
            <SubmitStatusButton idleText="保存修改" busyText="保存中..." disabled={!editServiceName.trim()} />
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ProductUsagePicker({
  products,
  selected,
  onAdd,
  onCreate,
  onRemove,
  onQuantityChange,
}: {
  products: Product[];
  selected: ServiceConsumable[];
  onAdd: (productId: string) => void;
  onCreate: (input: { name: string; category: string; subcategory: string }) => void;
  onRemove: (productId: string) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
}) {
  const [category, setCategory] = useState("全部");
  const [subcategory, setSubcategory] = useState("全部");
  const [query, setQuery] = useState("");
  const usableProducts = products.filter(productServiceStockDeductible);
  const usableSelected = selected.filter((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? productServiceStockDeductible(product) : false;
  });
  const selectedIds = new Set(usableSelected.map((item) => item.productId));
  const categories = Array.from(new Set([
    ...inventoryCategoryNames(usableProducts, {}),
    ...usableProducts.map((product) => product.category).filter((item): item is string => Boolean(item)),
  ]));
  const subcategories = Array.from(new Set([
    ...inventorySubcategoryNames(usableProducts, category, {}),
    ...usableProducts
      .filter((product) => category === "全部" || (product.category ?? "面护类") === category)
      .map((product) => product.subcategory)
      .filter((item): item is string => Boolean(item)),
  ]));
  const normalizedQuery = normalizeProductName(query);
  const scopedProducts = usableProducts
    .filter((product) => !selectedIds.has(product.id))
    .filter((product) => category === "全部" || (product.category ?? "面护类") === category)
    .filter((product) => subcategory === "全部" || (product.subcategory ?? "") === subcategory);
  const matchingProducts = scopedProducts
    .filter((product) => !normalizedQuery || normalizeProductName(product.name).includes(normalizedQuery))
    .slice(0, 8);
  const exactProduct = scopedProducts.find((product) => normalizeProductName(product.name) === normalizedQuery);
  const createCategory = category === "全部" ? "面护类" : category;
  const createSubcategory = subcategory === "全部" ? "" : subcategory;
  const canCreate = query.trim().length > 0 && !exactProduct && productServiceStockDeductible({
    name: query.trim(),
    category: createCategory,
    subcategory: createSubcategory,
    unit: "件",
  });

  const addProduct = (productId: string) => {
    onAdd(productId);
    setQuery("");
  };

  const createProduct = () => {
    const name = query.trim();
    if (!name) return;
    onCreate({ name, category: createCategory, subcategory: createSubcategory });
    setQuery("");
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (exactProduct && !selectedIds.has(exactProduct.id)) {
      addProduct(exactProduct.id);
      return;
    }
    if (canCreate) createProduct();
  };

  return (
    <div className="catalog-product-picker">
      <div className="catalog-product-filter-row">
        <Select
          label="大类"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setSubcategory("全部");
          }}
          options={["全部", ...categories].map((item) => ({ value: item, label: item }))}
        />
        <Select
          label="小类"
          value={subcategory}
          onChange={setSubcategory}
          options={["全部", ...subcategories].map((item) => ({ value: item, label: item }))}
        />
        <label className="catalog-product-search">
          使用商品
          <input value={query} {...searchInputSync(setQuery)} onKeyDown={handleSearchKeyDown} />
        </label>
      </div>
      <div className="catalog-product-results">
        {matchingProducts.map((product) => (
          <button className="catalog-product-result" key={product.id} type="button" onClick={() => addProduct(product.id)}>
            <strong>{product.name}</strong>
            <span>{product.subcategory ? `${product.category ?? "面护类"} / ${product.subcategory} · ${productServiceDeductionLabel(product)}` : `${product.category ?? "面护类"} · ${productServiceDeductionLabel(product)}`}</span>
          </button>
        ))}
        {canCreate && (
          <button className="catalog-product-result create" type="button" onClick={createProduct}>
            <strong>新增“{query.trim()}”</strong>
            <span>{createSubcategory ? `${createCategory} / ${createSubcategory}` : createCategory}</span>
          </button>
        )}
      </div>
      {usableSelected.length > 0 && (
        <div className="catalog-product-tags">
          {usableSelected.map((item) => {
            const product = products.find((candidate) => candidate.id === item.productId);
            const tracked = product ? productServiceStockDeductible(product) : false;
            return (
              <span className="catalog-product-usage-chip" key={item.productId}>
                <strong>{serviceConsumableDisplay(item, products)}</strong>
                <small>{serviceConsumableModeText(item, products)}</small>
                {tracked && product && (
                  <label>
                    每次
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={item.quantity}
                      onChange={(event) => onQuantityChange(item.productId, numberFromInput(event.target.value, 0))}
                    />
                    <em>{productServiceUnit(product)}</em>
                  </label>
                )}
                <button type="button" onClick={() => onRemove(item.productId)}>×</button>
              </span>
            );
          })}
        </div>
      )}
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
  const mutationPending = useMutationPending();
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [lossProductId, setLossProductId] = useState(data.products[0]?.id ?? "");
  const [lossQuantity, setLossQuantity] = useState(1);
  const [lossReason, setLossReason] = useState(inventoryLossReasonOptions[0]);
  const [lossNote, setLossNote] = useState("");
  const [lossSaveMessage, setLossSaveMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState<InventoryLog["type"]>("入库");
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [manualRestockProductId, setManualRestockProductId] = useState(data.products[0]?.id ?? "");
  const [manualRestockQuantity, setManualRestockQuantity] = useState(1);
  const [manualRestockExpiryAt, setManualRestockExpiryAt] = useState(addMonthsInputValue(data.products[0]?.shelfLifeMonths ?? 24));
  const [manualRestockSupplierName, setManualRestockSupplierName] = useState("");
  const [manualRestockUnitCost, setManualRestockUnitCost] = useState("");
  const [manualRestockNote, setManualRestockNote] = useState("");
  const [manualRestockMessage, setManualRestockMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const [inventoryIntakeMode, setInventoryIntakeMode] = useState<"new" | "restock">("new");
  const [stocktakeProductId, setStocktakeProductId] = useState(data.products[0]?.id ?? "");
  const [actualStock, setActualStock] = useState(data.products[0]?.stock ?? 0);
  const [inventoryCategoryPresets, setInventoryCategoryPresets] = useState<Record<string, string[]>>(INVENTORY_CATEGORY_PRESETS);
  const [newInventoryProductName, setNewInventoryProductName] = useState("");
  const [newInventoryProductCategory, setNewInventoryProductCategory] = useState("面护类");
  const [newInventoryProductSubcategory, setNewInventoryProductSubcategory] = useState("膏霜");
  const [newInventoryCategoryName, setNewInventoryCategoryName] = useState("");
  const [showInventoryCategoryManager, setShowInventoryCategoryManager] = useState(false);
  const newInventoryProductUnit = "件";
  const initialInventoryServiceDraft = { name: "", category: "面护类", subcategory: "膏霜", unit: "件" };
  const [newInventoryServiceUnitsPerStockUnit, setNewInventoryServiceUnitsPerStockUnit] = useState(String(productServiceUnitsPerStockUnit(initialInventoryServiceDraft)));
  const [newInventoryProductPrice, setNewInventoryProductPrice] = useState("");
  const [newInventoryProductStock, setNewInventoryProductStock] = useState("");
  const [newInventorySupplierName, setNewInventorySupplierName] = useState("");
  const [newInventoryUnitCost, setNewInventoryUnitCost] = useState("");
  const [newInventoryWarningStock, setNewInventoryWarningStock] = useState("5");
  const [newInventoryShelfLifeMonths, setNewInventoryShelfLifeMonths] = useState("3");
  const [newInventoryExpiryAt, setNewInventoryExpiryAt] = useState(addMonthsInputValue(3));
  const [inventoryProductSaveMessage, setInventoryProductSaveMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const [inventoryCategoryMessage, setInventoryCategoryMessage] = useState<{ type: "success" | "error"; text: string } | undefined>();
  const [inventoryExportMessage, setInventoryExportMessage] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [editProductName, setEditProductName] = useState("");
  const [editProductCategory, setEditProductCategory] = useState("");
  const [editProductSubcategory, setEditProductSubcategory] = useState("");
  const [editProductUnit, setEditProductUnit] = useState("件");
  const [editProductPrice, setEditProductPrice] = useState<EditableNumber>(0);
  const [editProductWarningStock, setEditProductWarningStock] = useState<EditableNumber>(0);
  const [editProductShelfLifeMonths, setEditProductShelfLifeMonths] = useState<EditableNumber>(0);
  const [editProductStatus, setEditProductStatus] = useState<"启用" | "停用">("启用");
  const [editProductReason, setEditProductReason] = useState("");
  const [stockExpiryAt, setStockExpiryAt] = useState(addMonthsInputValue(data.products[0]?.shelfLifeMonths ?? 24));
  const [activeModule, setActiveModule] = useState<InventoryModuleKey>(initialModule ?? "stockIn");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("全部");
  const [inventorySubcategoryFilter, setInventorySubcategoryFilter] = useState("全部");
  const inventoryCategoryNamesForForm = inventoryCategoryNames(data.products, inventoryCategoryPresets);
  const inventoryCategoryOptions = inventoryCategoryNamesForForm.map((category) => ({ value: category, label: category }));
  const inventorySubcategoryNamesForForm = inventorySubcategoryNames(data.products, newInventoryProductCategory, inventoryCategoryPresets);
  const inventorySubcategoryOptionsForForm = inventorySubcategoryNamesForForm.length
    ? inventorySubcategoryNamesForForm.map((subcategory) => ({ value: subcategory, label: subcategory }))
    : [{ value: "", label: "暂无小类", disabled: true }];

  const defaultExpiryForProduct = (nextProductId: string) => {
    const product = data.products.find((item) => item.id === nextProductId);
    return addMonthsInputValue(product?.shelfLifeMonths ?? 24);
  };
  const lookupText = (value: string) => value.trim().toLowerCase();
  const findPurchaseSupplierByName = (name: string) => data.suppliers.find((item) => lookupText(item.name) === lookupText(name));
  const findPurchaseProductByName = (name: string) => data.products.find((item) => lookupText(item.name) === lookupText(name));

  const inventoryProductServiceDraft = (input: { name?: string; category?: string; subcategory?: string; unit?: string }) => ({
    name: input.name ?? newInventoryProductName,
    category: input.category ?? newInventoryProductCategory,
    subcategory: input.subcategory ?? newInventoryProductSubcategory,
    unit: input.unit ?? newInventoryProductUnit,
  });

  const syncInventoryProductServiceDefaults = (input: { name?: string; category?: string; subcategory?: string; unit?: string }) => {
    const draft = inventoryProductServiceDraft(input);
    setNewInventoryServiceUnitsPerStockUnit(String(productServiceUnitsPerStockUnit(draft)));
  };

  const openInventoryCategoryManager = () => {
    setInventoryCategoryMessage(undefined);
    setNewInventoryCategoryName("");
    setShowInventoryCategoryManager(true);
  };

  const closeInventoryCategoryManager = () => {
    setShowInventoryCategoryManager(false);
    setInventoryCategoryMessage(undefined);
  };

  const changeStock = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.adjustInventory({ productId, type, quantity, expiryAt: type === "入库" ? stockExpiryAt : undefined }));
  };

  const recordProductLoss = (event: FormEvent) => {
    event.preventDefault();
    const product = data.products.find((item) => item.id === lossProductId);
    setLossSaveMessage(undefined);
    if (!product) {
      setLossSaveMessage({ type: "error", text: "请选择商品" });
      return;
    }
    if (lossQuantity <= 0) {
      setLossSaveMessage({ type: "error", text: "请输入损耗数量" });
      return;
    }
    if (lossQuantity > product.stock) {
      setLossSaveMessage({ type: "error", text: "损耗数量不能超过当前库存" });
      return;
    }
    const note = [lossReason, lossNote.trim()].filter(Boolean).join(" - ");
    void runMutation(() => actions.adjustInventory({ productId: lossProductId, type: "报损", quantity: lossQuantity, note }))
      .then(() => {
        setLossQuantity(1);
        setLossReason(inventoryLossReasonOptions[0]);
        setLossNote("");
        setLossSaveMessage({ type: "success", text: "商品损耗已记录" });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "商品损耗保存失败";
        setLossSaveMessage({ type: "error", text: message });
      });
  };

  const addInventoryProduct = (event: FormEvent) => {
    event.preventDefault();
    const price = numberFromInput(newInventoryProductPrice, 0);
    const stock = numberFromInput(newInventoryProductStock, 0);
    const warningStock = numberFromInput(newInventoryWarningStock, 0);
    const shelfLifeMonths = optionalNumberFromInput(newInventoryShelfLifeMonths);
    const supplierLabel = newInventorySupplierName.trim();
    const unitCostValue = optionalNumberFromInput(newInventoryUnitCost);
    const serviceUnitsPerStockUnit = normalizeProductServiceUnitsPerStockUnit(optionalNumberFromInput(newInventoryServiceUnitsPerStockUnit));
    setInventoryProductSaveMessage(undefined);
    if (findPurchaseProductByName(newInventoryProductName)) {
      setInventoryProductSaveMessage({ type: "error", text: "商品已存在，请切换到补商品入库。" });
      return;
    }
    if (!newInventoryProductSubcategory.trim()) {
      setInventoryProductSaveMessage({ type: "error", text: "请选择小类" });
      return;
    }
    if (supplierLabel && stock <= 0) {
      setInventoryProductSaveMessage({ type: "error", text: "有供应商来货时，请填写初始库存数量。" });
      return;
    }
    const mutation = supplierLabel
      ? () => actions.receivePurchaseOrder({
          supplierName: supplierLabel,
          supplierContact: "采购联系人",
          productName: newInventoryProductName,
          productPrice: price,
          productCategory: newInventoryProductCategory.trim() || "面护类",
          productSubcategory: newInventoryProductSubcategory.trim(),
          productUnit: newInventoryProductUnit,
          warningStock,
          shelfLifeMonths,
          serviceStockDeductible: true,
          serviceUnit: productServiceUnit(inventoryProductServiceDraft({})),
          serviceUnitsPerStockUnit,
          quantity: stock,
          unitCost: unitCostValue ?? 0,
          expiryAt: newInventoryExpiryAt || undefined,
        })
      : () => actions.addProduct({
          name: newInventoryProductName,
          stock,
          type: "sale",
          category: newInventoryProductCategory.trim() || "面护类",
          subcategory: newInventoryProductSubcategory.trim(),
          unit: newInventoryProductUnit,
          price,
          cost: unitCostValue,
          warningStock,
          shelfLifeMonths,
          expiryAt: newInventoryExpiryAt || undefined,
          serviceStockDeductible: true,
          serviceUnit: productServiceUnit(inventoryProductServiceDraft({})),
          serviceUnitsPerStockUnit,
        });
    void runMutation(mutation)
      .then(() => {
        setNewInventoryProductName("");
        setNewInventoryProductCategory("面护类");
        setNewInventoryProductSubcategory("膏霜");
        setNewInventoryServiceUnitsPerStockUnit(String(productServiceUnitsPerStockUnit(initialInventoryServiceDraft)));
        setNewInventoryProductPrice("");
        setNewInventoryProductStock("");
        setNewInventorySupplierName("");
        setNewInventoryUnitCost("");
        setNewInventoryWarningStock("5");
        setNewInventoryShelfLifeMonths("3");
        setNewInventoryExpiryAt(addMonthsInputValue(3));
        setInventoryProductSaveMessage({ type: "success", text: supplierLabel ? "商品已保存，供应商来货已同步入库。" : "商品已保存，首批库存已同步入库。" });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "商品保存失败，请检查后再试。";
        setInventoryProductSaveMessage({ type: "error", text: message });
      });
  };

  const openProductEdit = (product: Product) => {
    setEditingProductId(product.id);
    setEditProductName(product.name);
    setEditProductCategory(product.category ?? "面护类");
    setEditProductSubcategory(product.subcategory ?? "");
    setEditProductUnit(product.unit || "件");
    setEditProductPrice(product.price);
    setEditProductWarningStock(product.warningStock);
    setEditProductShelfLifeMonths(product.shelfLifeMonths ?? "");
    setEditProductStatus(product.status ?? "启用");
    setEditProductReason("");
  };

  const saveProductEdit = (event: FormEvent) => {
    event.preventDefault();
    const product = data.products.find((item) => item.id === editingProductId);
    if (!product) return;
    const productDraft = {
      ...product,
      name: editProductName,
      category: editProductCategory,
      subcategory: editProductSubcategory,
      unit: editProductUnit,
    };
    void runMutation(() => actions.updateProduct(editingProductId, {
      name: editProductName,
      category: editProductCategory,
      subcategory: editProductSubcategory,
      unit: editProductUnit,
      price: editableNumberValue(editProductPrice),
      warningStock: editableNumberValue(editProductWarningStock),
      shelfLifeMonths: editProductShelfLifeMonths === "" ? undefined : editableNumberValue(editProductShelfLifeMonths),
      serviceStockDeductible: productServiceStockDeductible(product),
      serviceUnit: productServiceStockDeductible(product) ? productServiceUnit(productDraft) : undefined,
      serviceUnitsPerStockUnit: productServiceStockDeductible(product) ? productServiceUnitsPerStockUnit(product) : undefined,
      status: editProductStatus,
      reason: editProductReason.trim() || undefined,
    })).then(() => setEditingProductId(""));
  };

  const addInventoryCategory = () => {
    const category = newInventoryCategoryName.trim();
    setInventoryCategoryMessage(undefined);
    if (!category) {
      setInventoryCategoryMessage({ type: "error", text: "请输入大类名称" });
      return;
    }
    if (inventoryCategoryNamesForForm.includes(category)) {
      setInventoryCategoryMessage({ type: "error", text: "大类已存在，请输入新的大类" });
      return;
    }
    setInventoryCategoryPresets((current) => (
      current[category] ? current : { ...current, [category]: [] }
    ));
    setNewInventoryProductCategory(category);
    setNewInventoryProductSubcategory("");
    setNewInventoryCategoryName("");
    setInventoryCategoryMessage({ type: "success", text: "大类已加入，可在新增商品里填写小类。" });
  };

  const chooseManualRestockProduct = (nextProductId: string) => {
    setManualRestockProductId(nextProductId);
    setManualRestockExpiryAt(defaultExpiryForProduct(nextProductId));
    setManualRestockMessage(undefined);
  };

  const openManualRestockProduct = (product: Product) => {
    chooseManualRestockProduct(product.id);
    setManualRestockQuantity(1);
    setManualRestockSupplierName("");
    setManualRestockUnitCost("");
    setManualRestockNote("");
    setInventoryIntakeMode("restock");
    setActiveModule("stockIn");
  };

  const submitManualRestock = (event: FormEvent) => {
    event.preventDefault();
    const product = data.products.find((item) => item.id === manualRestockProductId);
    setManualRestockMessage(undefined);
    if (!product) {
      setManualRestockMessage({ type: "error", text: "请选择补货商品" });
      return;
    }
    if (!Number.isFinite(manualRestockQuantity) || manualRestockQuantity <= 0) {
      setManualRestockMessage({ type: "error", text: "请输入入库数量" });
      return;
    }
    const supplierLabel = manualRestockSupplierName.trim();
    const unitCostValue = optionalNumberFromInput(manualRestockUnitCost);
    void runMutation(() => supplierLabel
      ? actions.receivePurchaseOrder({
          supplierId: findPurchaseSupplierByName(supplierLabel)?.id,
          supplierName: supplierLabel,
          supplierContact: "采购联系人",
          productId: product.id,
          productName: product.name,
          quantity: manualRestockQuantity,
          unitCost: unitCostValue ?? 0,
          expiryAt: manualRestockExpiryAt || undefined,
        })
      : actions.adjustInventory({
          productId: product.id,
          type: "入库",
          quantity: manualRestockQuantity,
          expiryAt: manualRestockExpiryAt || undefined,
          note: manualRestockNote.trim() || "手动补货入库",
        }))
      .then(() => {
        setManualRestockQuantity(1);
        setManualRestockSupplierName("");
        setManualRestockUnitCost("");
        setManualRestockNote("");
        setManualRestockMessage({ type: "success", text: supplierLabel ? "供应商补货入库已保存，库存和批次已更新。" : "补货入库已保存，库存和批次已更新。" });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "补货入库失败，请检查后再试。";
        setManualRestockMessage({ type: "error", text: message });
      });
  };

  const createStocktake = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createStocktake({ productId: stocktakeProductId, actualStock, reason: "门店盘点" }));
  };

  const lowStockItems = data.products.filter((item) => item.stock <= item.warningStock);
  const lowStock = lowStockItems.length;
  const stockValue = data.products.reduce((sum, item) => sum + item.stock, 0);
  const selectedLossProduct = data.products.find((item) => item.id === lossProductId);
  const selectedManualRestockProduct = data.products.find((item) => item.id === manualRestockProductId);
  const recentLossLogs = data.inventoryLogs.filter((log) => log.type === "报损").slice(0, 8);

  useEffect(() => {
    if (type === "入库") setStockExpiryAt(defaultExpiryForProduct(productId));
  }, [productId, type]);

  useEffect(() => {
    if (!lossProductId && data.products[0]) setLossProductId(data.products[0].id);
  }, [data.products, lossProductId]);

  useEffect(() => {
    if (!manualRestockProductId && data.products[0]) chooseManualRestockProduct(data.products[0].id);
  }, [data.products, manualRestockProductId]);

  useEffect(() => {
    setActiveModule(initialModule ?? "stockIn");
    if ((initialModule ?? "stockIn") === "stockIn") setInventoryIntakeMode("new");
  }, [initialModule]);

  useEffect(() => {
    setInventorySubcategoryFilter("全部");
  }, [inventoryCategoryFilter]);

  const restockLowInventory = () => {
    if (lowStockItems.length === 0) return;
    void runMutation(() => actions.restockLowInventory(supplierId || undefined));
  };
  const inventoryCategoryTabs = ["全部", ...inventoryCategoryNamesForForm];
  const categoryFilteredProducts = inventoryCategoryFilter === "全部"
    ? data.products
    : data.products.filter((item) => (item.category ?? "面护类") === inventoryCategoryFilter);
  const inventoryPresetSubcategoryTabs = inventoryCategoryFilter === "全部"
    ? []
    : inventorySubcategoryNames(data.products, inventoryCategoryFilter, inventoryCategoryPresets);
  const inventorySubcategoryTabs = [
    "全部",
    ...Array.from(new Set([
      ...inventoryPresetSubcategoryTabs,
      ...categoryFilteredProducts.map((item) => item.subcategory).filter((subcategory): subcategory is string => Boolean(subcategory)),
    ])),
  ];
  const filteredInventoryProducts = inventorySubcategoryFilter === "全部"
    ? categoryFilteredProducts
    : categoryFilteredProducts.filter((item) => item.subcategory === inventorySubcategoryFilter);
  const filteredLowStock = filteredInventoryProducts.filter((item) => item.stock <= item.warningStock).length;
  const filteredExpiryRisk = filteredInventoryProducts.filter((item) => Boolean(productExpiryStatus(item))).length;
  const productInitialStockLogs = new Map(
    data.inventoryLogs
      .filter((log) => log.note === "新增物品首批入库")
      .map((log) => [log.productId, log]),
  );
  const productInitialStockBatches = new Map(
    data.inventoryBatches
      .filter((batch) => batch.source === "首批入库")
      .map((batch) => [batch.productId, batch]),
  );
  const productLatestInboundLogs = new Map<string, InventoryLog>();
  data.inventoryLogs
    .filter((log) => log.delta > 0)
    .sort((current, next) => next.createdAt.localeCompare(current.createdAt))
    .forEach((log) => {
      if (!productLatestInboundLogs.has(log.productId)) productLatestInboundLogs.set(log.productId, log);
    });
  const productLatestBatches = new Map<string, AppData["inventoryBatches"][number]>();
  data.inventoryBatches
    .slice()
    .sort((current, next) => next.createdAt.localeCompare(current.createdAt))
    .forEach((batch) => {
      if (!productLatestBatches.has(batch.productId)) productLatestBatches.set(batch.productId, batch);
    });
  const allIntakeHistoryProducts = data.products
    .map((product) => ({
      product,
      log: productInitialStockLogs.get(product.id),
      batch: productInitialStockBatches.get(product.id),
    }))
    .sort((current, next) => (next.log?.createdAt ?? next.batch?.createdAt ?? "").localeCompare(current.log?.createdAt ?? current.batch?.createdAt ?? ""));
  const intakeHistoryProducts = allIntakeHistoryProducts.slice(0, 3);
  const inventoryProductUsage = (item: Product) => {
    const logs = data.inventoryLogs.filter((log) => log.productId === item.id);
    const inbound = logs.filter((log) => log.delta > 0).reduce((sum, log) => sum + log.delta, 0);
    const used = logs.filter((log) => log.delta < 0).reduce((sum, log) => sum + Math.abs(log.delta), 0);
    const total = Math.max(inbound, item.stock + used);
    const usagePercent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    return { inbound, used, total, usagePercent };
  };
  const exportInventoryCsv = () => {
      const columns = ["商品名称", "大类", "小类", "总数", "已使用", "剩余", "项目扣减", "使用占比", "预警库存", "保质期", "到期日期", "剩余天数", "首批入库时间", "最近入库时间", "最近批次来源", "状态"];
    const rows = data.products.map((item) => {
      const usage = inventoryProductUsage(item);
      const initialLog = productInitialStockLogs.get(item.id);
      const initialBatch = productInitialStockBatches.get(item.id);
      const latestInboundLog = productLatestInboundLogs.get(item.id);
      const latestBatch = productLatestBatches.get(item.id);
      const status = [
        productExpiryStatus(item)?.text,
        item.stock <= item.warningStock ? "需补货" : undefined,
      ].filter(Boolean).join(" / ") || "正常";
      return [
        item.name,
        item.category ?? "面护类",
        item.subcategory ?? "",
          formatProductStockWithServiceUnits(item, usage.total),
          formatProductStockWithServiceUnits(item, usage.used),
          formatProductStockWithServiceUnits(item, item.stock),
          productServiceDeductionLabel(item),
          `${usage.usagePercent}%`,
        `${item.warningStock}${item.unit}`,
        productShelfLifeText(item),
        productExpiryText(item),
        productExpiryDaysText(item),
        initialLog?.createdAt ? shortDate(initialLog.createdAt) : initialBatch?.createdAt ? shortDate(initialBatch.createdAt) : "未记录",
        latestInboundLog?.createdAt ? shortDate(latestInboundLog.createdAt) : "未记录",
        latestBatch?.source ?? "-",
        status,
      ];
    });
    downloadCsvFile("yich-inventory.csv", columns, rows);
    setInventoryExportMessage("库存已导出");
  };
  const inventoryModules: Array<FeatureModule<InventoryModuleKey>> = [
    { key: "stockIn", title: "商品入库", desc: "新增商品和已有商品补货", icon: PackagePlus, tone: "teal", meta: "入库" },
    { key: "loss", title: "商品损耗", desc: "损耗登记和库存扣减", icon: PackageMinus, tone: "rose", meta: "报损" },
    { key: "list", title: "库存列表", desc: "库存状态、预警和到期查看", icon: Boxes, tone: "rose", meta: `${lowStock} 项低库存` },
    { key: "stocktake", title: "库存盘点", desc: "账实差异和盘点记录", icon: ClipboardList, tone: "violet", meta: `${data.stocktakes.length} 条` },
    { key: "batches", title: "库存批次", desc: "入库批次、成本和效期", icon: Boxes, tone: "teal", meta: `${data.inventoryBatches.length} 批` },
    { key: "logs", title: "库存流水", desc: "出入库、采购和盘点历史", icon: ClipboardList, tone: "plum", meta: `${data.inventoryLogs.length} 条` },
  ];
  const activeModuleTitle = activeModule ? inventoryModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const editingProduct = data.products.find((item) => item.id === editingProductId);
  const closeModule = () => {
    setShowInventoryCategoryManager(false);
    if (onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(initialModule ?? "stockIn");
  };

  return (
    <div className="page-stack module-hub inventory-module-page">
      <PageHero
        icon={<Boxes size={15} />}
        eyebrow="库存管理"
        title="库存管理"
        stats={[
          { label: "库存品项", value: `${data.products.length} 个`, hint: `合计库存 ${stockValue}`, icon: <Boxes size={18} /> },
          { label: "低库存", value: `${lowStock} 项`, hint: "低于预警值 - 已增强提醒", icon: <PackagePlus size={18} /> },
          { label: "库存批次", value: `${data.inventoryBatches.length} 批`, hint: "成本和效期追踪", icon: <ClipboardList size={18} /> },
        ]}
      />
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "库存管理"}
        subtitle="库存预警、出入库流水和采购记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack inventory-modal-detail">
        {activeModule === "loss" && (
        <section className="panel">
        <PanelTitle icon={<PackageMinus size={18} />} title="商品损耗" action="损耗登记" />
        <form className="form inventory-loss-form" onSubmit={recordProductLoss}>
          <Select label="商品" value={lossProductId} onChange={setLossProductId} options={data.products.map(optionOf)} />
          <Select label="损耗原因" value={lossReason} onChange={setLossReason} options={inventoryLossReasonOptions.map((item) => ({ value: item, label: item }))} />
          <label>损耗数量<input type="number" min={1} max={selectedLossProduct?.stock ?? undefined} value={lossQuantity} onChange={(event) => setLossQuantity(Number(event.target.value))} /></label>
          <label>备注<input value={lossNote} onChange={(event) => setLossNote(event.target.value)} /></label>
          <div className="inventory-loss-current">
            <span>当前库存</span>
            <strong>{selectedLossProduct ? `${selectedLossProduct.stock}${selectedLossProduct.unit}` : "-"}</strong>
          </div>
          <SubmitStatusButton idleText="保存损耗" busyText="保存中..." />
        </form>
        {lossSaveMessage && (
          <p className={lossSaveMessage.type === "success" ? "form-success" : "form-error"}>
            {lossSaveMessage.text}
          </p>
        )}
        <div className="divider" />
        <PanelTitle icon={<ClipboardList size={18} />} title="损耗记录" action={`${recentLossLogs.length} 条`} />
        <DataTable
          columns={["商品", "损耗", "结余", "原因", "时间"]}
          rows={recentLossLogs.map((log) => [
            nameOf(data.products, log.productId),
            Math.abs(log.delta),
            log.stockAfter,
            log.note,
            shortDate(log.createdAt),
          ])}
        />
        </section>
        )}
        {activeModule === "adjust" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="库存操作" action="入库/报损/盘点" />
        <form className="form" onSubmit={changeStock}>
          <Select label="物品" value={productId} onChange={setProductId} options={data.products.map(optionOf)} />
          <Select label="操作类型" value={type} onChange={(value) => setType(value as InventoryLog["type"])} options={["入库", "报损", "盘点调整"].map((item) => ({ value: item, label: item }))} />
          <label>数量<input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          {type === "入库" && <label>到期日期<input type="date" value={stockExpiryAt} onChange={(event) => setStockExpiryAt(event.target.value)} /></label>}
          <SubmitStatusButton idleText="保存库存流水" busyText="保存中..." />
        </form>
        </section>
        )}
                {activeModule === "stocktake" && (
                <section className="panel">
                <PanelTitle icon={<ClipboardList size={18} />} title="库存盘点" action="调整账实差异" />
                <form className="form" onSubmit={createStocktake}>
                  <Select label="物品" value={stocktakeProductId} onChange={setStocktakeProductId} options={data.products.map(optionOf)} />
          <label>实盘库存<input type="number" value={actualStock} onChange={(event) => setActualStock(Number(event.target.value))} /></label>
          <SubmitStatusButton idleText="提交盘点" busyText="提交中..." />
                </form>
                </section>
                )}
                {activeModule === "stockIn" && (
                <section className="panel">
                <PanelTitle icon={<PackagePlus size={18} />} title="商品入库" action="新增 / 补货" />
                <div className="inventory-intake-mode-switch" role="tablist" aria-label="商品入库模式">
                  <button
                    type="button"
                    className={inventoryIntakeMode === "new" ? "active" : ""}
                    aria-selected={inventoryIntakeMode === "new"}
                    onClick={() => setInventoryIntakeMode("new")}
                  >
                    新增商品
                  </button>
                  <button
                    type="button"
                    className={inventoryIntakeMode === "restock" ? "active" : ""}
                    aria-selected={inventoryIntakeMode === "restock"}
                    onClick={() => setInventoryIntakeMode("restock")}
                  >
                    补商品
                  </button>
                </div>
                {inventoryIntakeMode === "restock" && (
                <div className="catalog-inline-control inventory-inline-control inventory-restock-control">
                  <div className="inventory-inline-header">
                    <div className="inventory-inline-title">
                      <strong>已有商品补货</strong>
                      <span>给同一个商品增加库存；可填写供应商和采购价，销售价只展示不修改</span>
                    </div>
                  </div>
                  <form className="form catalog-inline-form inventory-restock-form" onSubmit={submitManualRestock}>
                    <div className="inventory-product-form-row inventory-product-form-main">
                      <Select
                        label="补货商品"
                        value={manualRestockProductId}
                        onChange={chooseManualRestockProduct}
                        options={data.products.map(optionOf)}
                      />
                      <div className="inventory-restock-current">
                        <span>当前库存</span>
                        <strong>{selectedManualRestockProduct ? formatProductStockWithServiceUnits(selectedManualRestockProduct, selectedManualRestockProduct.stock) : "-"}</strong>
                        <small>{selectedManualRestockProduct ? `固定销售价 ${selectedManualRestockProduct.price > 0 ? money(selectedManualRestockProduct.price) : "未设置"}` : "请选择商品"}</small>
                      </div>
                    </div>
                    <div className="inventory-product-form-row inventory-product-form-stock">
                      <label>入库数量<input type="number" min={0.001} step="0.001" value={manualRestockQuantity} onChange={(event) => setManualRestockQuantity(Number(event.target.value))} /></label>
                      <label>供应商名称<input list="inventory-restock-supplier-options" value={manualRestockSupplierName} onChange={(event) => setManualRestockSupplierName(event.target.value)} placeholder="可选" /></label>
                      <datalist id="inventory-restock-supplier-options">
                        {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                      </datalist>
                      <label>采购单价（可选）<input type="number" min={0} step="0.01" value={manualRestockUnitCost} onChange={(event) => setManualRestockUnitCost(event.target.value)} placeholder="成本价，可后补" /></label>
                      <label>到期日期<input type="date" value={manualRestockExpiryAt} onChange={(event) => setManualRestockExpiryAt(event.target.value)} /></label>
                      <label>备注<input value={manualRestockNote} onChange={(event) => setManualRestockNote(event.target.value)} placeholder="线下补货 / 老板自采" /></label>
                      <div className="form-submit-row">
                        <SubmitStatusButton idleText="保存补货入库" busyText="保存中..." disabled={!manualRestockProductId} />
                      </div>
                    </div>
                  </form>
                  {manualRestockMessage && (
                    <p className={manualRestockMessage.type === "success" ? "form-success" : "form-error"}>
                      {manualRestockMessage.text}
                    </p>
                  )}
                </div>
                )}
                {inventoryIntakeMode === "new" && (
                <div className="catalog-inline-control inventory-inline-control">
                  <div className="inventory-inline-header">
                    <div className="inventory-inline-title">
                      <strong>新增商品</strong>
                      <span>录入分类、销售价、库存；有供应商时同步生成采购记录</span>
                    </div>
                    <button className="inventory-category-manage-button" type="button" onClick={openInventoryCategoryManager}>
                      <Settings size={16} />
                      管理分类
                    </button>
                  </div>
                  <form className="form catalog-inline-form inventory-product-form" onSubmit={addInventoryProduct}>
                    <div className="inventory-product-form-row inventory-product-form-main">
                      <label>物品名称<input value={newInventoryProductName} onChange={(event) => {
                        const nextName = event.target.value;
                        setNewInventoryProductName(nextName);
                        syncInventoryProductServiceDefaults({ name: nextName });
                      }} required /></label>
                      <Select
                        label="大类"
                        value={newInventoryProductCategory}
                        onChange={(value) => {
                          const nextSubcategories = inventorySubcategoryNames(data.products, value, inventoryCategoryPresets);
                          const nextSubcategory = nextSubcategories[0] ?? "";
                          setNewInventoryProductCategory(value);
                          setNewInventoryProductSubcategory(nextSubcategory);
                          syncInventoryProductServiceDefaults({ category: value, subcategory: nextSubcategory });
                        }}
                        options={inventoryCategoryOptions}
                      />
                      <Select
                        label="小类"
                        value={inventorySubcategoryNamesForForm.includes(newInventoryProductSubcategory) ? newInventoryProductSubcategory : ""}
                        onChange={(value) => {
                          setNewInventoryProductSubcategory(value);
                          syncInventoryProductServiceDefaults({ subcategory: value });
                        }}
                        options={inventorySubcategoryOptionsForForm}
                        disabled={inventorySubcategoryNamesForForm.length === 0}
                      />
                    </div>
                    <div className="inventory-product-form-row inventory-product-form-stock">
                      <label>销售价格<input type="number" min={0} step="0.01" value={newInventoryProductPrice} onChange={(event) => setNewInventoryProductPrice(event.target.value)} placeholder="卖给客户的价格" /></label>
                      <label>初始库存<input type="number" min={0} value={newInventoryProductStock} onChange={(event) => setNewInventoryProductStock(event.target.value)} /></label>
                      <label>供应商名称<input list="inventory-new-supplier-options" value={newInventorySupplierName} onChange={(event) => setNewInventorySupplierName(event.target.value)} placeholder="可选" /></label>
                      <datalist id="inventory-new-supplier-options">
                        {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                      </datalist>
                      <label>采购单价（可选）<input type="number" min={0} step="0.01" value={newInventoryUnitCost} onChange={(event) => setNewInventoryUnitCost(event.target.value)} placeholder="成本价，可后补" /></label>
                      <label>预警库存<input type="number" min={0} value={newInventoryWarningStock} onChange={(event) => setNewInventoryWarningStock(event.target.value)} /></label>
                      <label>保质期(月)<input type="number" min={0} value={newInventoryShelfLifeMonths} onChange={(event) => {
                        const nextValue = event.target.value;
                        setNewInventoryShelfLifeMonths(nextValue);
                        const months = optionalNumberFromInput(nextValue);
                        setNewInventoryExpiryAt(months === undefined ? "" : addMonthsInputValue(months));
                      }} /></label>
                      <label>首批到期<input type="date" value={newInventoryExpiryAt} onChange={(event) => setNewInventoryExpiryAt(event.target.value)} /></label>
                      <div className="inventory-deduction-fixed">
                        <span>项目扣减</span>
                        <strong>扣库存</strong>
                      </div>
                      <label>{`每${newInventoryProductUnit || "件"}数量`}<input type="number" min={1} value={newInventoryServiceUnitsPerStockUnit} onChange={(event) => setNewInventoryServiceUnitsPerStockUnit(event.target.value)} /></label>
                      <div className="form-submit-row">
                        <SubmitStatusButton idleText="保存商品" busyText="保存中..." />
                      </div>
                    </div>
                  </form>
                  {inventoryProductSaveMessage && (
                    <p className={inventoryProductSaveMessage.type === "success" ? "form-success" : "form-error"}>
                      {inventoryProductSaveMessage.text}
                    </p>
                  )}
                  <div className="inventory-intake-history">
                    {intakeHistoryProducts.length > 0 ? (
                      <div className="inventory-intake-records">
                        {intakeHistoryProducts.map(({ product, log, batch }) => (
                          <div className="inventory-intake-record" key={product.id}>
                            <div className="inventory-intake-record-main">
                              <strong>{product.name}</strong>
                              <span>{`${product.category ?? "面护类"}${product.subcategory ? ` / ${product.subcategory}` : ""}`}</span>
                              <span>{`入库时间：${log?.createdAt ? shortDate(log.createdAt) : batch?.createdAt ? shortDate(batch.createdAt) : "未记录"}`}</span>
                              <span>{batch ? `批次：${batch.source} · 到期 ${productExpiryText(product)}` : "批次：未记录"}</span>
                            </div>
                              <span><small>售价</small>{product.price > 0 ? money(product.price) : "未设置"}</span>
                              <span><small>首批</small>{formatProductStockWithServiceUnits(product, log ? log.delta : product.stock)}</span>
                              <span><small>当前</small>{formatProductStockWithServiceUnits(product, product.stock)}</span>
                              <Badge text={productServiceStockDeductible(product) ? "扣库存" : "不计项目"} tone={productServiceStockDeductible(product) ? "ok" : undefined} />
                              <Badge text={product.stock <= product.warningStock ? "需补货" : "已入库"} tone={product.stock <= product.warningStock ? "warn" : "ok"} />
                              <button type="button" className="inventory-intake-edit-button" onClick={() => openManualRestockProduct(product)}>
                                补货
                              </button>
                              <button type="button" className="inventory-intake-edit-button" onClick={() => openProductEdit(product)}>
                                编辑
                              </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty">暂无新增商品</p>
                    )}
                    <div className="inventory-intake-actions">
                      <button type="button" onClick={() => setActiveModule("list")}>查看全部库存</button>
                    </div>
                  </div>
                </div>
                )}
                {lowStock > 0 && (
                  <div className="inventory-warning-row">
                    <strong>库存预警已触发</strong>：{lowStock} 个商品低于安全库存。
                    <button type="button" disabled={mutationPending} onClick={restockLowInventory}>{mutationPending ? "入库中..." : "一键补货入库"}</button>
                  </div>
                )}
                </section>
                )}
                {activeModule === "list" && (
                <section className="panel">
                <PanelTitle
                  icon={<Boxes size={18} />}
                  title="库存列表"
                  action={<button type="button" onClick={exportInventoryCsv}>导出所有库存</button>}
                />
                {inventoryExportMessage && <p className="form-success">{inventoryExportMessage}</p>}
                {lowStock > 0 && (
                  <div className="inventory-warning-row">
                    <strong>库存预警已触发</strong>：{lowStock} 个商品低于安全库存。
                  </div>
                )}
                <div className="inventory-filter-stack">
                  <div className="inventory-filter-row">
                    <span>大类</span>
                    <div>
                      {inventoryCategoryTabs.map((category) => (
                        <button
                          type="button"
                          key={category}
                          className={inventoryCategoryFilter === category ? "active" : ""}
                          onClick={() => setInventoryCategoryFilter(category)}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="inventory-filter-row">
                    <span>小类</span>
                    <div>
                      {inventorySubcategoryTabs.map((subcategory) => (
                        <button
                          type="button"
                          key={subcategory}
                          className={inventorySubcategoryFilter === subcategory ? "active" : ""}
                          onClick={() => setInventorySubcategoryFilter(subcategory)}
                        >
                          {subcategory}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="inventory-summary-strip" aria-label="库存概览">
                  <div>
                    <span>当前品项</span>
                    <strong>{filteredInventoryProducts.length} 个</strong>
                  </div>
                  <div>
                    <span>低库存</span>
                    <strong>{filteredLowStock} 项</strong>
                  </div>
                  <div>
                    <span>临期/过期</span>
                    <strong>{filteredExpiryRisk} 项</strong>
                  </div>
                </div>
                {filteredInventoryProducts.length > 0 ? (
                  <div className="inventory-product-card-grid">
                    {filteredInventoryProducts.map((item) => {
                      const expiryStatus = productExpiryStatus(item);
                      const stockStatus = item.stock <= item.warningStock ? { text: "需补货", tone: "warn" as const } : undefined;
                      const usage = inventoryProductUsage(item);
                      const latestInboundLog = productLatestInboundLogs.get(item.id);
                      const latestBatch = productLatestBatches.get(item.id);
                      return (
                        <article
                          key={item.id}
                          className="inventory-product-card"
                        >
                          <span className="inventory-product-card-head">
                            <span>
                              <strong>{item.name}</strong>
                              <small>{[item.category ?? "面护类", item.subcategory].filter(Boolean).join(" / ")}</small>
                            </span>
                            <span className="inventory-product-card-actions">
                              <button type="button" className="inventory-product-restock-button" onClick={() => openManualRestockProduct(item)}>
                                <PackagePlus size={14} />
                                补货
                              </button>
                              <button type="button" className="inventory-product-edit-button" onClick={() => openProductEdit(item)}>
                                <Pencil size={14} />
                                编辑商品
                              </button>
                            </span>
                          </span>
                                  <span className="inventory-product-card-metrics">
                                    <span>
                                      <small>总数</small>
                                        <strong>{formatProductStockWithServiceUnits(item, usage.total)}</strong>
                                      </span>
                                      <span>
                                        <small>已使用</small>
                                        <strong>{formatProductStockWithServiceUnits(item, usage.used)}</strong>
                                      </span>
                                      <span>
                                        <small>剩余</small>
                                        <strong>{formatProductStockWithServiceUnits(item, item.stock)}</strong>
                                      </span>
                            <span>
                              <small>售价</small>
                              <strong>{item.price > 0 ? money(item.price) : "未设置"}</strong>
                            </span>
                            <span>
                              <small>使用占比</small>
                              <strong>{usage.usagePercent}%</strong>
                            </span>
                            <span>
                              <small>预警</small>
                              <strong>{item.warningStock}{item.unit}</strong>
                            </span>
                            <span>
                              <small>保质期</small>
                              <strong>{productShelfLifeText(item)}</strong>
                            </span>
                            <span>
                              <small>剩余天数</small>
                              <strong>{productExpiryDaysText(item)}</strong>
                            </span>
                            <span>
                              <small>到期</small>
                              <strong>{productExpiryText(item)}</strong>
                            </span>
                            <span>
                              <small>最近入库</small>
                              <strong>{latestInboundLog?.createdAt ? shortDate(latestInboundLog.createdAt) : "未记录"}</strong>
                            </span>
                            <span>
                              <small>批次来源</small>
                              <strong>{latestBatch?.source ?? "-"}</strong>
                            </span>
                          </span>
                          <span className="inventory-product-card-foot">
                            <span className="inventory-status-stack">
                              {expiryStatus && <Badge text={expiryStatus.text} tone={expiryStatus.tone} />}
                              {stockStatus && <Badge text={stockStatus.text} tone={stockStatus.tone} />}
                              {!expiryStatus && !stockStatus && <Badge text="正常" tone="ok" />}
                            </span>
                          </span>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="inventory-empty-state">
                    <strong>当前分类暂无商品</strong>
                    <span>可以回到商品入库新增商品，或切换其他分类查看。</span>
                  </div>
                )}
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
        {activeModule === "batches" && (
        <section className="panel">
        <PanelTitle icon={<Boxes size={18} />} title="库存批次" action="先进先出" />
        <DataTable
          columns={["商品", "来源", "入库数", "剩余数", "单位成本", "到期", "供应商", "时间"]}
          rows={data.inventoryBatches
            .slice()
            .sort((current, next) => next.createdAt.localeCompare(current.createdAt))
            .map((batch) => [
              nameOf(data.products, batch.productId),
              batch.source,
              batch.quantityIn,
              batch.remainingQuantity,
              money(batch.unitCost),
              batch.expiryAt ? shortDate(batch.expiryAt) : "-",
              batch.supplierId ? nameOf(data.suppliers, batch.supplierId) : "-",
              shortDate(batch.createdAt),
            ])}
        />
        </section>
        )}
      </div>
      </Modal>
      <Modal
        open={showInventoryCategoryManager}
        title="新增分类"
        subtitle="商品大类"
        className="inventory-category-modal"
        onClose={closeInventoryCategoryManager}
      >
        <section className="inventory-category-manager">
          <div className="inventory-category-manager-forms">
            <div className="inventory-category-manager-form">
              <label>新增大类<input value={newInventoryCategoryName} onChange={(event) => setNewInventoryCategoryName(event.target.value)} placeholder="例如 身体类" /></label>
              <button type="button" onClick={addInventoryCategory}>添加大类</button>
            </div>
          </div>
          {inventoryCategoryMessage && (
            <p className={inventoryCategoryMessage.type === "success" ? "form-success" : "form-error"}>
              {inventoryCategoryMessage.text}
            </p>
          )}
        </section>
      </Modal>
      <Modal
        open={Boolean(editingProductId)}
        title="编辑商品"
        subtitle="商品基础资料"
        size="large"
        onClose={() => setEditingProductId("")}
      >
        <form className="form catalog-edit-form inventory-product-edit-form" onSubmit={saveProductEdit}>
          <div className="catalog-edit-grid">
            <label>商品名称<input value={editProductName} onChange={(event) => setEditProductName(event.target.value)} required /></label>
            <label>大类<input value={editProductCategory} onChange={(event) => setEditProductCategory(event.target.value)} required /></label>
            <label>小类<input value={editProductSubcategory} onChange={(event) => setEditProductSubcategory(event.target.value)} /></label>
            <label>单位<input value={editProductUnit} onChange={(event) => setEditProductUnit(event.target.value)} required /></label>
            <label>销售价格<input type="number" min={0} step="0.01" value={editProductPrice} onChange={(event) => setEditProductPrice(parseEditableNumber(event.target.value))} placeholder="卖给客户的价格" /></label>
            <label>预警库存<input type="number" min={0} value={editProductWarningStock} onChange={(event) => setEditProductWarningStock(parseEditableNumber(event.target.value))} /></label>
            <label>保质期（月）<input type="number" min={0} value={editProductShelfLifeMonths} onChange={(event) => setEditProductShelfLifeMonths(parseEditableNumber(event.target.value))} /></label>
            <Select
              label="状态"
              value={editProductStatus}
              onChange={(value) => setEditProductStatus(value as "启用" | "停用")}
              options={[
                { value: "启用", label: "启用" },
                { value: "停用", label: "停用" },
              ]}
            />
          </div>
          <div className="catalog-edit-readonly">
            <span>当前库存</span>
            <strong>{editingProduct ? formatProductStockWithServiceUnits(editingProduct, editingProduct.stock) : "-"}</strong>
            <small>库存数量不能在这里直接修改，请通过入库、损耗或盘点调整。</small>
          </div>
          <label>修改说明<textarea value={editProductReason} onChange={(event) => setEditProductReason(event.target.value)} placeholder="例如：录入时分类选错，修正为当前分类" /></label>
          <div className="form-submit-row">
            <button type="button" onClick={() => setEditingProductId("")}>取消</button>
            <SubmitStatusButton idleText="保存修改" busyText="保存中..." disabled={!editProductName.trim() || !editProductUnit.trim()} />
          </div>
        </form>
      </Modal>
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
      {item.metric && <em>{item.metric}</em>}
    </button>
  );
}


function appointmentTone(appointment: Appointment): "ok" | "warn" | undefined {
  if (appointment.status === "已到店" || appointment.status === "已完成") return "ok";
  if (appointment.status === "已取消" || appointment.status === "爽约") return "warn";
  return undefined;
}

function normalizeProductName(value: string) {
  return value.trim().toLowerCase();
}

function findCreatedProduct(products: Product[], name: string, category: string, subcategory: string) {
  const normalizedName = normalizeProductName(name);
  return products.find((product) =>
    normalizeProductName(product.name) === normalizedName &&
    (product.category ?? "面护类") === category &&
    (product.subcategory ?? "") === subcategory,
  ) ?? products.find((product) => normalizeProductName(product.name) === normalizedName);
}

export function serviceConsumablesOf(service?: Service): ServiceConsumable[] {
  const consumables = service?.consumables?.filter((item) => item.productId) ?? [];
  if (consumables.length > 0) return consumables;
  if (service?.consumableProductId) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
  return [];
}

function mergeUsedProducts(consumables: ServiceConsumable[], products?: Product[]) {
  const merged: ServiceConsumable[] = [];
  const seen = new Set<string>();
  consumables.forEach((item) => {
    if (!item.productId || seen.has(item.productId)) return;
    const product = products?.find((candidate) => candidate.id === item.productId);
    if (product && !productServiceStockDeductible(product)) return;
    seen.add(item.productId);
    merged.push({ productId: item.productId, quantity: Math.max(0, roundDisplayQuantity(item.quantity)) });
  });
  return merged;
}

function roundDisplayQuantity(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
}

function serviceConsumableDisplay(item: ServiceConsumable, products: Product[]) {
  return nameOf(products, item.productId);
}

function serviceConsumableModeText(item: ServiceConsumable, products: Product[]) {
  const product = products.find((candidate) => candidate.id === item.productId);
  if (!product) return "未配置";
  if (!productServiceStockDeductible(product)) return "不计项目";
  if (item.quantity <= 0) return `待填用量 · ${productServicePackageText(product)}`;
  return `每次${formatStockQuantity(item.quantity)}${productServiceUnit(product)} · 折${formatStockQuantity(serviceStockQuantityForProduct(product, item.quantity))}${product.unit}`;
}

export function serviceFormulaSummary(service: Service, products: Product[]) {
  const consumables = serviceConsumablesOf(service).filter((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? productServiceStockDeductible(product) : false;
  });
  if (consumables.length === 0) return "未配置";
  return consumables.map((item) => `${serviceConsumableDisplay(item, products)}（${serviceConsumableModeText(item, products)}）`).join(" / ");
}

export function signatureRecordContext(data: AppData, signature: CustomerSignature) {
  const serviceRecord = signature.serviceRecordId
    ? data.customerServiceRecords.find((record) => record.id === signature.serviceRecordId)
    : undefined;
  const orderId = signature.orderId ?? serviceRecord?.orderId;
  const order = orderId ? data.orders.find((item) => item.id === orderId) : undefined;
  const serviceId = serviceRecord?.serviceId ?? order?.serviceId;
  const staffId = serviceRecord?.staffId ?? order?.staffId;
  const productLines = [
    ...(order?.productItems ?? []).map((item) => `${item.productName ?? nameOf(data.products, item.productId)} x${item.quantity}`),
    ...(order?.giftProductItems ?? []).map((item) => `赠品 ${item.productName ?? nameOf(data.products, item.productId)} x${item.quantity}`),
  ];
  return {
    customerName: nameOf(data.customers, signature.customerId),
    order,
    orderNo: order?.orderNo ?? "-",
    serviceName: serviceRecord?.serviceId
      ? nameOf(data.services, serviceRecord.serviceId)
      : order?.serviceName || (serviceId ? nameOf(data.services, serviceId) : productLines.join(" + ") || "收银"),
    serviceRecord,
    staffName: staffId ? nameOf(data.staff, staffId) : "-",
  };
}

function signatureServiceQuantityRows(data: AppData, order: Order) {
  const serviceIds = (order.serviceIds?.length ? order.serviceIds : [order.serviceId]).filter(Boolean);
  const rows = new Map<string, { serviceId: string; name: string; quantity: number }>();
  serviceIds.forEach((serviceId) => {
    const current = rows.get(serviceId);
    rows.set(serviceId, {
      serviceId,
      name: nameOf(data.services, serviceId),
      quantity: (current?.quantity ?? 0) + 1,
    });
  });
  return Array.from(rows.values());
}

function signatureMemberCardSupportsService(card: AppData["memberCards"][number], serviceId: string) {
  if (card.type === "储值卡") return true;
  if (!serviceId) return false;
  if (card.serviceEntitlements?.length) return card.serviceEntitlements.some((item) => item.serviceId === serviceId);
  if (card.serviceIds?.length) return card.serviceIds.includes(serviceId);
  if (card.serviceId && card.serviceId !== serviceId) return false;
  return true;
}

function signatureMemberCardRemainingForService(card: AppData["memberCards"][number], serviceId: string) {
  if (card.type === "储值卡") return Number.POSITIVE_INFINITY;
  if (card.serviceEntitlements?.length) {
    return card.serviceEntitlements.find((item) => item.serviceId === serviceId)?.remainingTimes ?? 0;
  }
  return signatureMemberCardSupportsService(card, serviceId) ? card.remainingTimes : 0;
}

function signatureCardCanDebitOrder(data: AppData, card: AppData["memberCards"][number], order: Order) {
  if (card.customerId !== order.customerId || card.status !== "正常") return false;
  if (card.type === "储值卡") return card.balance >= order.paidAmount;
  if (card.type === "折扣卡") return false;
  return signatureServiceQuantityRows(data, order).every((row) =>
    signatureMemberCardSupportsService(card, row.serviceId)
    && signatureMemberCardRemainingForService(card, row.serviceId) >= row.quantity,
  );
}

function signatureCardPriority(card: AppData["memberCards"][number], serviceId: string) {
  const serviceSpecific = card.serviceId === serviceId || Boolean(card.serviceIds?.includes(serviceId));
  const typePriority = card.type === "次数卡" ? 0 : card.type === "套餐卡" ? 1 : card.type === "储值卡" ? 2 : 3;
  return (serviceSpecific ? 0 : 10) + typePriority;
}

function uiDebitCardPriority(card: AppData["memberCards"][number], serviceId: string) {
  const serviceSpecific = card.serviceEntitlements?.some((item) => item.serviceId === serviceId)
    || card.serviceId === serviceId
    || Boolean(card.serviceIds?.includes(serviceId));
  const typePriority = card.type === "次数卡" ? 0 : card.type === "套餐卡" ? 1 : 2;
  const expiresAt = card.expiresAt ? +new Date(card.expiresAt) : Number.POSITIVE_INFINITY;
  return { serviceSpecific, typePriority, expiresAt };
}

function compareUiDebitCardPriority(left: AppData["memberCards"][number], right: AppData["memberCards"][number], serviceId: string) {
  const a = uiDebitCardPriority(left, serviceId);
  const b = uiDebitCardPriority(right, serviceId);
  if (a.serviceSpecific !== b.serviceSpecific) return a.serviceSpecific ? -1 : 1;
  if (a.typePriority !== b.typePriority) return a.typePriority - b.typePriority;
  if (a.expiresAt !== b.expiresAt) return a.expiresAt - b.expiresAt;
  return signatureMemberCardRemainingForService(left, serviceId) - signatureMemberCardRemainingForService(right, serviceId);
}

function buildUiMemberCardDebitPlan(cards: AppData["memberCards"], serviceIds: string[], services: AppData["services"]) {
  const projectCards = cards.filter((card) => card.status === "正常" && card.type !== "储值卡" && card.type !== "折扣卡");
  const allocatedTotalByCard = new Map<string, number>();
  const allocatedByCardService = new Map<string, number>();
  const lines = new Map<string, {
    card: AppData["memberCards"][number];
    service: Service;
    quantity: number;
    beforeText: string;
    afterText: string;
  }>();
  serviceIds.filter(Boolean).forEach((serviceId) => {
    const service = services.find((item) => item.id === serviceId);
    if (!service) return;
    const selectedCard = projectCards
      .filter((card) => signatureMemberCardSupportsService(card, serviceId))
      .filter((card) => {
        const entitlement = card.serviceEntitlements?.find((item) => item.serviceId === serviceId);
        if (card.serviceEntitlements?.length) {
          return (entitlement?.remainingTimes ?? 0) - (allocatedByCardService.get(`${card.id}:${serviceId}`) ?? 0) > 0;
        }
        return card.remainingTimes - (allocatedTotalByCard.get(card.id) ?? 0) > 0;
      })
      .sort((left, right) => compareUiDebitCardPriority(left, right, serviceId))[0];
    if (!selectedCard) return;
    allocatedTotalByCard.set(selectedCard.id, (allocatedTotalByCard.get(selectedCard.id) ?? 0) + 1);
    allocatedByCardService.set(`${selectedCard.id}:${serviceId}`, (allocatedByCardService.get(`${selectedCard.id}:${serviceId}`) ?? 0) + 1);
    const key = `${selectedCard.id}:${serviceId}`;
    const current = lines.get(key);
    const quantity = (current?.quantity ?? 0) + 1;
    const entitlement = selectedCard.serviceEntitlements?.find((item) => item.serviceId === serviceId);
    const beforeRemaining = signatureMemberCardRemainingForService(selectedCard, serviceId);
    const allocatedForService = allocatedByCardService.get(`${selectedCard.id}:${serviceId}`) ?? 0;
    const afterRemaining = selectedCard.serviceEntitlements?.length
      ? Math.max(0, beforeRemaining - allocatedForService)
      : Math.max(0, selectedCard.remainingTimes - (allocatedTotalByCard.get(selectedCard.id) ?? 0));
    lines.set(key, {
      card: selectedCard,
      service,
      quantity,
      beforeText: entitlement ? `剩 ${beforeRemaining}/${entitlement.totalTimes} 次` : `剩 ${beforeRemaining} 次`,
      afterText: entitlement ? `扣后 ${afterRemaining}/${entitlement.totalTimes} 次` : `扣后 ${afterRemaining} 次`,
    });
  });
  return Array.from(lines.values());
}

function signatureOrderDebitCard(data: AppData, order: Order) {
  const explicitCard = order.cardId
    ? data.memberCards.find((card) => card.id === order.cardId)
    : undefined;
  if (explicitCard && (signatureCardCanDebitOrder(data, explicitCard, order) || order.payMethod === "会员卡")) return explicitCard;
  const firstServiceId = signatureServiceQuantityRows(data, order)[0]?.serviceId ?? order.serviceId;
  return data.memberCards
    .filter((card) => signatureCardCanDebitOrder(data, card, order))
    .sort((a, b) => signatureCardPriority(a, firstServiceId) - signatureCardPriority(b, firstServiceId))[0];
}

function signatureMemberCardUsageRows(data: AppData, order: Order) {
  const alreadyDebited = data.memberCardTransactions.some((transaction) => transaction.orderId === order.id && transaction.type === "消费");
  const orderServiceIds = (order.serviceIds?.length ? order.serviceIds : [order.serviceId]).filter(Boolean);
  const projectPlan = buildUiMemberCardDebitPlan(
    data.memberCards.filter((card) => card.customerId === order.customerId),
    orderServiceIds,
    data.services,
  );
  if (projectPlan.length > 0) {
    const plannedRows = projectPlan.map((line) => {
      const currentRemaining = signatureMemberCardRemainingForService(line.card, line.service.id);
      const entitlement = line.card.serviceEntitlements?.find((item) => item.serviceId === line.service.id);
      const beforeTimes = alreadyDebited ? currentRemaining + line.quantity : currentRemaining;
      const afterTimes = alreadyDebited ? currentRemaining : Math.max(0, currentRemaining - line.quantity);
      const formatTimes = (value: number) => entitlement ? `${value}/${entitlement.totalTimes}次` : `${value}次`;
      return {
        key: `${order.id}:${line.card.id}:${line.service.id}`,
        cardName: line.card.name,
        serviceName: line.service.name,
        usedText: `${line.quantity}次`,
        beforeText: formatTimes(beforeTimes),
        afterText: formatTimes(afterTimes),
        statusText: alreadyDebited ? "已扣" : "待扣",
        blocked: false,
      };
    });
    const blockedRows = signatureServiceQuantityRows(data, order)
      .map((row) => {
        const covered = projectPlan
          .filter((line) => line.service.id === row.serviceId)
          .reduce((sum, line) => sum + line.quantity, 0);
        if (covered >= row.quantity) return undefined;
        const available = data.memberCards
          .filter((card) => card.customerId === order.customerId && signatureMemberCardSupportsService(card, row.serviceId))
          .reduce((sum, card) => sum + signatureMemberCardRemainingForService(card, row.serviceId), 0);
        return {
          key: `${order.id}:shortfall:${row.serviceId}`,
          cardName: "客户项目次数",
          serviceName: row.name,
          usedText: `${row.quantity}次`,
          beforeText: `${available}次`,
          afterText: `${available}次`,
          statusText: "不足",
          blocked: true,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    return [...plannedRows, ...blockedRows];
  }
  const card = signatureOrderDebitCard(data, order)
    ?? data.memberCards
      .filter((item) =>
        item.customerId === order.customerId
        && item.status === "正常"
        && item.type !== "储值卡"
        && item.type !== "折扣卡"
        && signatureServiceQuantityRows(data, order).some((row) => signatureMemberCardSupportsService(item, row.serviceId)),
      )
      .sort((a, b) => signatureCardPriority(a, signatureServiceQuantityRows(data, order)[0]?.serviceId ?? order.serviceId) - signatureCardPriority(b, signatureServiceQuantityRows(data, order)[0]?.serviceId ?? order.serviceId))[0];
  if (!card) return [];
  if (card.type === "储值卡") {
    const afterBalance = alreadyDebited ? card.balance : Math.max(0, card.balance - order.paidAmount);
    const beforeBalance = alreadyDebited ? card.balance + order.paidAmount : card.balance;
    const blocked = !alreadyDebited && card.balance < order.paidAmount;
    return [{
      key: `${order.id}:${card.id}:balance`,
      cardName: card.name,
      serviceName: "储值余额",
      usedText: money(order.paidAmount),
      beforeText: money(beforeBalance),
      afterText: blocked ? money(card.balance) : money(afterBalance),
      statusText: alreadyDebited ? "已扣" : blocked ? "不足" : "待扣",
      blocked,
    }];
  }
  return signatureServiceQuantityRows(data, order).map((row) => {
    const entitlement = card.serviceEntitlements?.find((item) => item.serviceId === row.serviceId);
    const currentRemaining = signatureMemberCardRemainingForService(card, row.serviceId);
    const supports = signatureMemberCardSupportsService(card, row.serviceId);
    const blocked = !alreadyDebited && (!supports || currentRemaining < row.quantity);
    const afterTimes = alreadyDebited || blocked ? currentRemaining : Math.max(0, currentRemaining - row.quantity);
    const beforeTimes = alreadyDebited ? currentRemaining + row.quantity : currentRemaining;
    const formatTimes = (value: number) => entitlement ? `${value}/${entitlement.totalTimes}次` : `${value}次`;
    return {
      key: `${order.id}:${card.id}:${row.serviceId}`,
      cardName: card.name,
      serviceName: row.name,
      usedText: `${row.quantity}次`,
      beforeText: formatTimes(beforeTimes),
      afterText: formatTimes(afterTimes),
      statusText: alreadyDebited ? "已扣" : blocked ? "不足" : "待扣",
      blocked,
    };
  });
}

function customerSignatureIsExpired(signature: CustomerSignature, nowMs = Date.now()) {
  return signature.status === "待签名"
    && Boolean(signature.expiresAt)
    && +new Date(signature.expiresAt ?? "") <= nowMs;
}

function signatureRecordCanCompleteCheckout(context: ReturnType<typeof signatureRecordContext>) {
  return Boolean(context.order || context.serviceRecord?.serviceId);
}

export function SignatureRecordDetail({ data, signature }: { data: AppData; signature: CustomerSignature }) {
  const context = signatureRecordContext(data, signature);
  const signedAt = signature.signedAt ? shortDate(signature.signedAt) : "-";
  const cardUsageRows = context.order ? signatureMemberCardUsageRows(data, context.order) : [];
  const serviceUsageRows = context.order ? signatureServiceQuantityRows(data, context.order) : [];
  return (
    <section className="signature-record-detail">
      <div className="signature-record-meta">
        <span><small>客户</small>{context.customerName}</span>
        <span><small>收银内容</small>{context.serviceName}</span>
        <span><small>服务人员</small>{context.staffName}</span>
        <span><small>订单编号</small>{context.orderNo}</span>
        <span><small>签名状态</small>{signature.status}</span>
        <span><small>签名时间</small>{signedAt}</span>
      </div>
      <div className="signature-record-content">
        <div>
          <strong>确认内容</strong>
          <p>{signature.content}</p>
          {cardUsageRows.length > 0 && (
            <div className="signature-card-usage">
              <strong>会员卡扣次</strong>
              {cardUsageRows.map((row) => (
                <p key={row.key}>
                  {row.cardName} · {row.serviceName}：本次用 {row.usedText}，扣前 {row.beforeText}，扣后剩 {row.afterText}（{row.statusText}）。
                </p>
              ))}
            </div>
          )}
          {cardUsageRows.length === 0 && serviceUsageRows.length > 0 && (
            <div className="signature-card-usage">
              <strong>本次服务</strong>
              {serviceUsageRows.map((row) => (
                <p key={`${row.serviceId}:service`}>
                  {row.name}：本次服务 {row.quantity} 次。
                </p>
              ))}
            </div>
          )}
          {context.serviceRecord && (
            <p>
              护理步骤：{context.serviceRecord.careSteps || "未记录"}；使用产品：{context.serviceRecord.productsUsed || "未记录"}
            </p>
          )}
        </div>
        <div className="signature-record-image-panel">
          <strong>客户签名</strong>
          {signature.signatureText?.startsWith("data:image/") ? (
            <img className="signature-record-image" src={signature.signatureText} alt="客户签名" />
          ) : (
            <span>{signature.signatureText || "未签名"}</span>
          )}
        </div>
      </div>
    </section>
  );
}

export function optionOf(item: { id: string; name: string }) {
  return { value: item.id, label: item.name };
}

export function customerOptionOf(customer: AppData["customers"][number]) {
  return { value: customer.id, label: customerDisplayLabel(customer) };
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

export function memberCardProjectScopeText(card: AppData["memberCards"][number], services: AppData["services"]) {
  if (card.serviceEntitlements?.length) {
    return card.serviceEntitlements.map((item) => nameOf(services, item.serviceId)).join(" / ");
  }
  if (card.serviceIds?.length) return card.serviceIds.map((id) => nameOf(services, id)).join(" / ");
  return card.serviceId ? nameOf(services, card.serviceId) : "通用";
}

export function memberCardPurchasedServiceIds(card: AppData["memberCards"][number]) {
  if (card.serviceEntitlements?.length) return card.serviceEntitlements.map((item) => item.serviceId).filter(Boolean);
  if (card.serviceIds?.length) return card.serviceIds.filter(Boolean);
  return card.serviceId ? [card.serviceId] : [];
}

export function memberCardTimesText(card: AppData["memberCards"][number], services: AppData["services"], focusedServiceId?: string) {
  if (card.type === "储值卡") return money(card.balance);
  if (card.serviceEntitlements?.length) {
    const entitlements = focusedServiceId
      ? card.serviceEntitlements.filter((item) => item.serviceId === focusedServiceId)
      : card.serviceEntitlements;
    if (entitlements.length === 0 && focusedServiceId) return `${nameOf(services, focusedServiceId)} 0次`;
    return entitlements
      .map((item) => `${nameOf(services, item.serviceId)} ${item.remainingTimes}/${item.totalTimes}次`)
      .join("；");
  }
  if (focusedServiceId) return `${nameOf(services, focusedServiceId)} ${card.remainingTimes}次`;
  return `${memberCardProjectScopeText(card, services)} ${card.remainingTimes}次`;
}

export function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
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
