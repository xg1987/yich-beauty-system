import type {
  AppData,
  ApprovalRequest,
  Appointment,
  AuthUser,
  CustomerFollowUp,
  CustomerSignature,
  CustomerServiceRecord,
  DataQualityIssue,
  DataQualityReport,
  DataCleanupReport,
  Commission,
  CommissionSettlement,
  CashPayMethod,
  Customer,
  DailyClose,
  InventoryBatch,
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  MarketingAiRecord,
  OnlineBookingRequest,
  OnlineStorefront,
  OperationLog,
  Order,
  OrderProductItem,
  Product,
  PurchaseOrder,
  Refund,
  Service,
  ServiceCardSelection,
  ServiceConsumable,
  Staff,
  StaffInvite,
  StaffShift,
  StaffUnavailableSlot,
  SystemConfig,
  SystemConfigKey,
  StoreAiUsagePermissions,
  StoreOperationalPermissions,
  StoreProfile,
  StoreOwnerApplication,
  StoreOwnerInvite,
  SystemNotification,
  Stocktake,
  Supplier,
  TagDefinition,
  TagScope,
  UserRole,
  ViewKey,
} from "./types";
import { effectiveRoleForUser, serializeRolePermissionTemplates } from "./auth";
import { accountAiCredits, defaultAiBillingConfig, normalizeAiBillingConfig, roundAiCreditAmount, serializeAiBillingConfig } from "./aiBilling";
import { appointmentEndAt, appointmentServiceIds, assignAppointmentRooms } from "./appointments";
import { optionalMobilePhone, requireMobilePhone } from "./phone";
import { formatStockQuantity, legacyProductServiceStockDeductible, legacyServiceStockQuantityForProduct, normalizeProductServiceFields, normalizeProductServiceUnitsPerStockUnit, productServiceStockDeductible, productServiceStockReviewStatus, productServiceUnit, productServiceUnitsPerStockUnit, requireConfirmedProductStockRule, roundStockQuantity, serviceStockQuantityForProduct } from "./products";
import { businessDateOf, makeId, money, nowIso } from "./utils";

type IdFactory = (prefix: string) => string;

const PLATFORM_INVITE_PREFIX = "YC";
const PLATFORM_INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_INVITE_VALID_DAYS = 7;
const DUPLICATE_CHECKOUT_WINDOW_MS = 30_000;
const STAFF_BUSINESS_ROLES = new Set(["店长", "主管", "员工", "前台"]);
const LEGACY_DEFAULT_ROOM_NAMES = ["护理房 1", "护理房 2", "VIP护理房", "仪器房", "身心护理房", "备用房"];
const LEGACY_DEFAULT_ROOM_NAME_SET = new Set(LEGACY_DEFAULT_ROOM_NAMES);
const CASH_PAY_METHODS = new Set<CashPayMethod>(["现金", "微信", "支付宝", "银行卡"]);
export const DEFAULT_STORE_AI_USAGE_PERMISSIONS: StoreAiUsagePermissions = {
  owner: { copy: true, image: true, video: true },
  staff: { copy: true, image: true, video: false },
};
export const DEFAULT_STORE_OPERATIONAL_PERMISSIONS: StoreOperationalPermissions = {
  staffCanViewAllAppointments: true,
};
export const MARKETING_AI_PENDING_TIMEOUT_MS = 10 * 60 * 1000;

const MARKETING_AI_PENDING_TIMEOUT_MESSAGE = "后台生成任务超过10分钟仍未拿到视频任务编号，可能提交阶段被服务重启、供应商超时或网络中断终止，无法继续刷新。请重新生成。";

function normalizeCashPayMethod(payMethod: CashPayMethod | undefined): CashPayMethod {
  return payMethod && CASH_PAY_METHODS.has(payMethod) ? payMethod : "微信";
}

function trimText(value: string | undefined) {
  return value?.trim() ?? "";
}

function positiveNumber(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isMarketingAiRecordPending(record: Pick<MarketingAiRecord, "status">) {
  return record.status === "生成中";
}

export function isStaleMarketingAiRecord(record: Pick<MarketingAiRecord, "status" | "createdAt">, now = new Date()) {
  if (!isMarketingAiRecordPending(record)) return false;
  const createdAt = new Date(record.createdAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  return now.getTime() - createdAt.getTime() >= MARKETING_AI_PENDING_TIMEOUT_MS;
}

export function expireStaleMarketingAiRecords(data: AppData, now = new Date()): AppData {
  let changed = false;
  const marketingAiRecords = data.marketingAiRecords.map((record) => {
    if (!isStaleMarketingAiRecord(record, now)) return record;
    changed = true;
    const elapsedMs = Math.max(0, now.getTime() - new Date(record.createdAt).getTime());
    return {
      ...record,
      status: "生成失败",
      text: MARKETING_AI_PENDING_TIMEOUT_MESSAGE,
      errorMessage: MARKETING_AI_PENDING_TIMEOUT_MESSAGE,
      elapsedMs,
    };
  });
  return changed ? { ...data, marketingAiRecords } : data;
}

function isBusinessStaff(staff: Staff) {
  return staff.role !== "老板";
}

export function defaultStoreId(data: AppData) {
  return data.storeProfiles[0]?.id;
}

function itemStoreId<T extends { storeId?: string }>(item: T | undefined, fallbackStoreId?: string) {
  return item?.storeId ?? fallbackStoreId;
}

export function storeIdForUser(data: AppData, user: Pick<AuthUser, "id" | "role" | "staffId" | "storeId">) {
  if (user.role === "superadmin") return undefined;
  if (user.storeId) return user.storeId;
  if (user.staffId) {
    const staff = data.staff.find((item) => item.id === user.staffId);
    if (staff?.storeId) return staff.storeId;
  }
  return undefined;
}

function storeIdForStaff(data: AppData, staffId: string, fallbackStoreId?: string) {
  return itemStoreId(data.staff.find((item) => item.id === staffId), fallbackStoreId);
}

function storeIdForCustomer(data: AppData, customerId: string, fallbackStoreId?: string) {
  return itemStoreId(data.customers.find((item) => item.id === customerId), fallbackStoreId);
}

function storeIdForAppointment(data: AppData, appointment: Pick<Appointment, "storeId" | "staffId" | "customerId">, fallbackStoreId?: string) {
  return appointment.storeId ?? storeIdForStaff(data, appointment.staffId, storeIdForCustomer(data, appointment.customerId, fallbackStoreId));
}

function storeIdForProduct(data: AppData, productId: string, fallbackStoreId?: string) {
  return itemStoreId(data.products.find((item) => item.id === productId), fallbackStoreId);
}

function storeIdForMemberCard(data: AppData, cardId: string, fallbackStoreId?: string) {
  const card = data.memberCards.find((item) => item.id === cardId);
  return card?.storeId ?? storeIdForCustomer(data, card?.customerId ?? "", fallbackStoreId);
}

function scopedStoreId(data: AppData, explicitStoreId?: string) {
  return explicitStoreId ?? defaultStoreId(data);
}

function storeProfileOf(data: AppData, storeId?: string) {
  return storeId ? data.storeProfiles.find((store) => store.id === storeId) : data.storeProfiles[0];
}

export function normalizeStoreScopedData(data: AppData): AppData {
  const withStore = <T extends { storeId?: string }>(item: T, storeId?: string): T => ({
    ...item,
    storeId: item.storeId ?? storeId,
  });
  const staff = data.staff.map((item) => withStore(item));
  const authUsers = data.authUsers.map((item) =>
    item.role === "superadmin"
      ? item
      : withStore(item, staff.find((staffItem) => staffItem.id === item.staffId)?.storeId),
  );
  const customers = data.customers.map((item) => withStore(item));
  const services = data.services.map((item) => withStore(item));
  const products = data.products.map((item) => normalizeProductServiceFields(withStore(item)));
  const memberCards = data.memberCards.map((item) => withStore(item, storeIdForCustomer({ ...data, customers } as AppData, item.customerId)));
  const orders = data.orders.map((item) => withStore(item, storeIdForStaff({ ...data, staff } as AppData, item.staffId)));
  const appointments = data.appointments.map((item) => withStore(item, storeIdForAppointment({ ...data, staff, customers } as AppData, item)));
  const inventoryBatches = data.inventoryBatches ?? [];
  return {
    ...data,
    staff,
    authUsers,
    staffInvites: data.staffInvites.map((item) => withStore(item, storeIdForStaff({ ...data, staff } as AppData, item.staffId))),
    customers,
    tagDefinitions: data.tagDefinitions.map((item) => withStore(item)),
    services,
    products,
    inventoryBatches: inventoryBatches.map((item) => withStore(item, storeIdForProduct({ ...data, products } as AppData, item.productId))),
    appointments,
    onlineBookingRequests: data.onlineBookingRequests.map((item) =>
      withStore(item, data.onlineStorefronts.find((storefront) => storefront.id === item.storefrontId)?.storeId),
    ),
    staffUnavailableSlots: data.staffUnavailableSlots.map((item) => withStore(item, storeIdForStaff({ ...data, staff } as AppData, item.staffId))),
    staffShifts: data.staffShifts.map((item) => withStore(item, storeIdForStaff({ ...data, staff } as AppData, item.staffId))),
    memberCards,
    orders,
    refunds: data.refunds.map((item) => withStore(item, orders.find((order) => order.id === item.orderId)?.storeId)),
    inventoryLogs: data.inventoryLogs.map((item) => withStore(item, storeIdForProduct({ ...data, products } as AppData, item.productId))),
    memberCardTransactions: data.memberCardTransactions.map((item) => withStore(item, storeIdForMemberCard({ ...data, customers, memberCards } as AppData, item.memberCardId))),
    operationLogs: data.operationLogs.map((item) => withStore(item, authUsers.find((user) => user.id === item.userId)?.storeId)),
    notifications: data.notifications.map((item) => withStore(item, item.staffId ? storeIdForStaff({ ...data, staff } as AppData, item.staffId) : item.storeId)),
    dailyCloses: data.dailyCloses.map((item) => withStore(item)),
    approvalRequests: data.approvalRequests.map((item) => withStore(item)),
    customerServiceRecords: data.customerServiceRecords.map((item) => withStore(item, storeIdForCustomer({ ...data, customers } as AppData, item.customerId))),
    customerSignatures: data.customerSignatures.map((item) => withStore(item, storeIdForCustomer({ ...data, customers } as AppData, item.customerId))),
    customerFollowUps: data.customerFollowUps.map((item) => withStore(item, storeIdForCustomer({ ...data, customers } as AppData, item.customerId))),
    suppliers: data.suppliers.map((item) => withStore(item)),
    purchaseOrders: data.purchaseOrders.map((item) => withStore(item, storeIdForProduct({ ...data, products } as AppData, item.productId))),
    stocktakes: data.stocktakes.map((item) => withStore(item, storeIdForProduct({ ...data, products } as AppData, item.productId))),
  };
}

export function scopeDataToStore(data: AppData, storeId: string | undefined): AppData {
  if (!storeId) return normalizeStoreScopedData(data);
  const normalized = normalizeStoreScopedData(data);
  const belongsToStore = (item: { storeId?: string }) => item.storeId === storeId;
  const visibleStaff = normalized.staff.filter(belongsToStore);
  const visibleStaffIds = new Set(visibleStaff.map((item) => item.id));
  const visibleCustomers = normalized.customers.filter(belongsToStore);
  const visibleCustomerIds = new Set(visibleCustomers.map((item) => item.id));
  const visibleOrders = normalized.orders.filter(belongsToStore);
  const visibleOrderIds = new Set(visibleOrders.map((item) => item.id));
  const visibleCards = normalized.memberCards.filter(belongsToStore);
  const visibleCardIds = new Set(visibleCards.map((item) => item.id));
  const visibleDistributors = normalized.distributors.filter((item) =>
    (item.customerId && visibleCustomerIds.has(item.customerId)) || (item.staffId && visibleStaffIds.has(item.staffId)),
  );
  const visibleDistributorIds = new Set(visibleDistributors.map((item) => item.id));
  const visibleCommissions = normalized.commissions.filter((item) => visibleStaffIds.has(item.staffId) || visibleOrderIds.has(item.orderId));
  const visibleCommissionIds = new Set(visibleCommissions.map((item) => item.id));
  return {
    ...normalized,
    storeProfiles: normalized.storeProfiles.filter((item) => item.id === storeId),
    onlineStorefronts: normalized.onlineStorefronts.filter((item) => item.storeId === storeId),
    authUsers: normalized.authUsers.filter((item) => item.role === "superadmin" || item.storeId === storeId),
    storeOwnerInvites: [],
    storeOwnerApplications: normalized.storeOwnerApplications.filter((item) => item.storeId === storeId),
    staffInvites: normalized.staffInvites.filter(belongsToStore),
    staff: visibleStaff,
    customers: visibleCustomers,
    tagDefinitions: normalized.tagDefinitions.filter(belongsToStore),
    services: normalized.services.filter(belongsToStore),
    products: normalized.products.filter(belongsToStore),
    inventoryBatches: normalized.inventoryBatches.filter(belongsToStore),
    appointments: normalized.appointments.filter(belongsToStore),
    onlineBookingRequests: normalized.onlineBookingRequests.filter(belongsToStore),
    staffUnavailableSlots: normalized.staffUnavailableSlots.filter(belongsToStore),
    staffShifts: normalized.staffShifts.filter(belongsToStore),
    memberCards: visibleCards,
    orders: visibleOrders,
    refunds: normalized.refunds.filter((item) => item.storeId === storeId || visibleOrderIds.has(item.orderId)),
    commissions: visibleCommissions,
    distributors: visibleDistributors,
    referralRelations: normalized.referralRelations.filter((item) => visibleDistributorIds.has(item.distributorId) && visibleCustomerIds.has(item.customerId)),
    distributionCommissions: normalized.distributionCommissions.filter((item) =>
      visibleDistributorIds.has(item.distributorId) || visibleCustomerIds.has(item.customerId) || visibleOrderIds.has(item.orderId),
    ),
    commissionSettlements: normalized.commissionSettlements.filter((item) => item.commissionIds.some((commissionId) => visibleCommissionIds.has(commissionId))),
    inventoryLogs: normalized.inventoryLogs.filter(belongsToStore),
    memberCardTransactions: normalized.memberCardTransactions.filter((item) => item.storeId === storeId || visibleCardIds.has(item.memberCardId)),
    operationLogs: normalized.operationLogs.filter((item) => item.storeId === storeId || item.userId === "system"),
    notifications: normalized.notifications.filter((item) => !item.storeId || item.storeId === storeId),
    dailyCloses: normalized.dailyCloses.filter(belongsToStore),
    approvalRequests: normalized.approvalRequests.filter(belongsToStore),
    customerServiceRecords: normalized.customerServiceRecords.filter(belongsToStore),
    customerSignatures: normalized.customerSignatures.filter(belongsToStore),
    customerFollowUps: normalized.customerFollowUps.filter(belongsToStore),
    suppliers: normalized.suppliers.filter(belongsToStore),
    purchaseOrders: normalized.purchaseOrders.filter(belongsToStore),
    stocktakes: normalized.stocktakes.filter(belongsToStore),
  };
}

function assertActiveStaff(staff: Staff | undefined, message = "员工不存在或已停用") {
  if (!staff || staff.status !== "active") throw new Error(message);
}

function assertBusinessStaff(staff: Staff | undefined, message = "服务人员不存在或已停用") {
  if (!staff || staff.status !== "active" || !isBusinessStaff(staff)) throw new Error(message);
}

export function defaultSystemConfigs(options: { now?: () => string } = {}): SystemConfig[] {
  const updatedAt = (options.now ?? nowIso)();
  return [
    {
      id: "cfg_invite_default_days",
      key: "invite_default_days",
      value: `${DEFAULT_INVITE_VALID_DAYS}`,
      description: "员工和门店老板邀请码默认有效期",
      updatedAt,
    },
    {
      id: "cfg_allow_registration",
      key: "allow_registration",
      value: "true",
      description: "是否开放门店注册入口",
      updatedAt,
    },
    {
      id: "cfg_maintenance_mode",
      key: "maintenance_mode",
      value: "false",
      description: "是否启用系统维护模式",
      updatedAt,
    },
    {
      id: "cfg_system_announcement",
      key: "system_announcement",
      value: "",
      description: "平台公告内容",
      updatedAt,
    },
    {
      id: "cfg_role_permissions",
      key: "role_permissions",
      value: serializeRolePermissionTemplates({}),
      description: "角色权限模板",
      updatedAt,
    },
    {
      id: "cfg_ai_generation_config",
      key: "ai_generation_config",
      value: "",
      description: "AI 文案、图片和视频模型配置",
      updatedAt,
    },
    {
      id: "cfg_ai_billing_config",
      key: "ai_billing_config",
      value: serializeAiBillingConfig(defaultAiBillingConfig()),
      description: "AI 免费次数和充值门店配置",
      updatedAt,
    },
  ];
}

export function normalizeSystemConfigs(configs?: SystemConfig[], options: { now?: () => string } = {}) {
  const defaults = defaultSystemConfigs(options);
  const currentConfigs = configs ?? [];
  return defaults.map((defaultConfig) => {
    const currentConfig = currentConfigs.find((item) => item.key === defaultConfig.key);
    return currentConfig ? { ...defaultConfig, ...currentConfig, id: defaultConfig.id } : defaultConfig;
  });
}

export function systemConfigValue(data: AppData, key: SystemConfigKey) {
  return normalizeSystemConfigs(data.systemConfigs).find((item) => item.key === key)?.value ?? "";
}

export function sanitizeSystemConfigsForRole(configs: SystemConfig[], role: UserRole) {
  const normalizedConfigs = normalizeSystemConfigs(configs);
  if (role === "superadmin") return normalizedConfigs;
  return normalizedConfigs.map((config) => {
    if (config.key !== "ai_generation_config" || !config.value) return config;
    try {
      const parsed = JSON.parse(config.value) as {
        copy?: { apiKey?: string };
        image?: { apiKey?: string };
        video?: { providers?: Array<{ apiKey?: string }> };
      };
      return {
        ...config,
        value: JSON.stringify({
          ...parsed,
          copy: parsed.copy ? { ...parsed.copy, apiKey: "" } : parsed.copy,
          image: parsed.image ? { ...parsed.image, apiKey: "" } : parsed.image,
          video: parsed.video ? {
            ...parsed.video,
            providers: Array.isArray(parsed.video.providers)
              ? parsed.video.providers.map((provider) => ({ ...provider, apiKey: "" }))
              : parsed.video.providers,
          } : parsed.video,
        }),
      };
    } catch {
      return { ...config, value: "" };
    }
  });
}

export function inviteDefaultDays(data: AppData) {
  const parsedDays = Number(systemConfigValue(data, "invite_default_days"));
  return Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 90 ? parsedDays : DEFAULT_INVITE_VALID_DAYS;
}

export function updateSystemConfig(
  data: AppData,
  input: { key: SystemConfigKey; value: string; updatedBy: string },
  options: { now?: () => string } = {},
): AppData {
  const configs = normalizeSystemConfigs(data.systemConfigs, options);
  const nextValue = validateSystemConfigValue(input.key, input.value);
  const targetConfig = configs.find((item) => item.key === input.key);
  if (!targetConfig) throw new Error("系统配置不存在");
  const updatedAt = (options.now ?? nowIso)();
  return {
    ...data,
    systemConfigs: configs.map((config) =>
      config.key === input.key
        ? { ...config, value: nextValue, updatedAt, updatedBy: input.updatedBy }
        : config,
    ),
  };
}

function validateSystemConfigValue(key: SystemConfigKey, value: string) {
  const trimmedValue = value.trim();
  if (key === "invite_default_days") {
    const validDays = Number(trimmedValue);
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 90) {
      throw new Error("邀请码默认有效期必须是 1 到 90 天的整数");
    }
    return `${validDays}`;
  }
  if (key === "allow_registration" || key === "maintenance_mode") {
    if (trimmedValue !== "true" && trimmedValue !== "false") {
      throw new Error("开关配置只能是 true 或 false");
    }
    return trimmedValue;
  }
  if (key === "role_permissions") {
    try {
      return serializeRolePermissionTemplates(JSON.parse(trimmedValue));
    } catch {
      throw new Error("角色权限模板格式不正确");
    }
  }
  if (key === "ai_generation_config") {
    if (!trimmedValue) return "";
    if (trimmedValue.length > 20000) throw new Error("AI 配置内容过大");
    try {
      JSON.parse(trimmedValue);
      return trimmedValue;
    } catch {
      throw new Error("AI 配置格式不正确");
    }
  }
  if (key === "ai_billing_config") {
    if (!trimmedValue) return serializeAiBillingConfig(defaultAiBillingConfig());
    if (trimmedValue.length > 5000) throw new Error("AI 计费配置内容过大");
    try {
      return serializeAiBillingConfig(normalizeAiBillingConfig(JSON.parse(trimmedValue)));
    } catch {
      throw new Error("AI 计费配置格式不正确");
    }
  }
  if (trimmedValue.length > 200) {
    throw new Error("系统公告不能超过 200 个字");
  }
  return trimmedValue;
}

function stableInviteNumber(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function encodeInviteSuffix(value: number) {
  const base = PLATFORM_INVITE_ALPHABET.length;
  let nextValue = value;
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix = PLATFORM_INVITE_ALPHABET[nextValue % base] + suffix;
    nextValue = Math.floor(nextValue / base);
  }
  return suffix;
}

function platformInviteCandidateForUser(user: Pick<AuthUser, "id" | "account">, salt = 0) {
  const source = `${user.id}:${user.account}:${salt}`.toLowerCase();
  return `${PLATFORM_INVITE_PREFIX}${encodeInviteSuffix(stableInviteNumber(source))}`;
}

function storeStaffInviteCandidateForUser(user: Pick<AuthUser, "id" | "account">, salt = 0) {
  const source = `staff:${user.id}:${user.account}:${salt}`.toLowerCase();
  return `YG${encodeInviteSuffix(stableInviteNumber(source))}`;
}

function sameInviteUser(left: Pick<AuthUser, "id" | "account">, right: Pick<AuthUser, "id" | "account">) {
  return left.id === right.id && left.account === right.account;
}

export function platformInviteCodeForUser(
  user: Pick<AuthUser, "id" | "account">,
  users?: Array<Pick<AuthUser, "id" | "account">>,
) {
  if (!users?.length) return platformInviteCandidateForUser(user);
  const usedCodes = new Set<string>();
  const orderedUsers = [...users].sort((left, right) => `${left.id}:${left.account}`.localeCompare(`${right.id}:${right.account}`));
  for (const item of orderedUsers) {
    for (let salt = 0; salt < 50; salt += 1) {
      const candidate = platformInviteCandidateForUser(item, salt);
      if (usedCodes.has(candidate)) continue;
      usedCodes.add(candidate);
      if (sameInviteUser(item, user)) return candidate;
      break;
    }
  }
  return platformInviteCandidateForUser(user);
}

export function platformInviteCodeForPlatformAdmin(
  user: Pick<AuthUser, "id" | "account" | "role">,
  users?: Array<Pick<AuthUser, "id" | "account">>,
) {
  if (effectiveRoleForUser(user) !== "superadmin") return undefined;
  return platformInviteCodeForUser(user, users);
}

export function storeStaffInviteCodeForStoreUser(
  user: Pick<AuthUser, "id" | "account" | "role">,
  users?: Array<Pick<AuthUser, "id" | "account" | "role">>,
) {
  const role = effectiveRoleForUser(user);
  if (role !== "owner" && role !== "manager") return undefined;
  if (!users?.length) return storeStaffInviteCandidateForUser(user);
  const usedCodes = new Set<string>();
  const orderedUsers = [...users]
    .filter((item) => {
      const itemRole = effectiveRoleForUser(item);
      return itemRole === "owner" || itemRole === "manager";
    })
    .sort((left, right) => `${left.id}:${left.account}`.localeCompare(`${right.id}:${right.account}`));
  for (const item of orderedUsers) {
    for (let salt = 0; salt < 50; salt += 1) {
      const candidate = storeStaffInviteCandidateForUser(item, salt);
      if (usedCodes.has(candidate)) continue;
      usedCodes.add(candidate);
      if (sameInviteUser(item, user)) return candidate;
      break;
    }
  }
  return storeStaffInviteCandidateForUser(user);
}

export function storeStaffInviteIssuerId(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const issuer = data.authUsers.find((user) => {
    if (user.status !== "active") return false;
    const role = effectiveRoleForUser(user);
    if (role !== "owner" && role !== "manager") return false;
    return storeStaffInviteCodeForStoreUser(user, data.authUsers) === normalizedInviteCode;
  });
  return issuer?.id;
}

export function isPlatformInviteCodeFormat(inviteCode: string) {
  return new RegExp(`^${PLATFORM_INVITE_PREFIX}[${PLATFORM_INVITE_ALPHABET}]{4}$`).test(inviteCode.trim().toUpperCase());
}

export function isStoreOwnerInviteCodeFormat(inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return isPlatformInviteCodeFormat(inviteCode) || normalizedInviteCode.startsWith("BOSS_");
}

export function platformInviteIssuerId(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const issuer = data.authUsers.find((user) => {
    return user.status === "active"
      && effectiveRoleForUser(user) === "superadmin"
      && platformInviteCodeForUser(user, data.authUsers) === normalizedInviteCode;
  });
  return issuer?.id;
}

function normalizedInviteCode(value: string) {
  return value.trim().toUpperCase();
}

function reservedInviteCodes(data: AppData) {
  const codes = new Set<string>();
  data.staffInvites.forEach((invite) => codes.add(normalizedInviteCode(invite.inviteCode)));
  (data.storeOwnerInvites ?? []).forEach((invite) => codes.add(normalizedInviteCode(invite.inviteCode)));
  data.authUsers
    .filter((user) => effectiveRoleForUser(user) === "superadmin")
    .forEach((user) => codes.add(normalizedInviteCode(platformInviteCodeForUser(user, data.authUsers))));
  data.authUsers
    .filter((user) => {
      const role = effectiveRoleForUser(user);
      return role === "owner" || role === "manager";
    })
    .forEach((user) => {
      const code = storeStaffInviteCodeForStoreUser(user, data.authUsers);
      if (code) codes.add(normalizedInviteCode(code));
    });
  return codes;
}

function createUniqueInviteCode(data: AppData, prefix: string, idFactory: IdFactory) {
  const reservedCodes = reservedInviteCodes(data);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = idFactory(prefix);
    if (!reservedCodes.has(normalizedInviteCode(candidate))) return candidate;
  }
  throw new Error("邀请码生成失败，请重试");
}

export type RegisterStoreInput = {
  storeName: string;
  ownerName: string;
  phone: string;
  address?: string;
  account: string;
  password: string;
};

export type StoreProfileInput = {
  storeId?: string;
  name: string;
  phone: string;
  address: string;
  businessHours: string;
  roomNames?: string[];
  maintenanceRoomNames?: string[];
  maintenanceRoomCount?: number;
};

export type StoreAiUsagePermissionsInput = {
  storeId?: string;
  permissions: unknown;
};

export type StoreOperationalPermissionsInput = {
  storeId?: string;
  permissions: unknown;
};

export type AuthUserAiCreditsInput = {
  userId: string;
  credits: number;
  operatedBy: string;
};

export type StoreStatusInput = {
  storeId: string;
  status: NonNullable<StoreProfile["status"]>;
  userId: string;
};

export type StaffInput = {
  storeId?: string;
  name: string;
  phone: string;
  role: string;
  baseSalary?: number;
  commissionRate?: number;
};

export type StaffUpdateInput = Partial<StaffInput> & {
  staffId: string;
  status?: Staff["status"];
};

export type OnlineStorefrontInput = {
  storeId?: string;
  shareCode: string;
  status?: OnlineStorefront["status"];
  headline: string;
  description: string;
  enabledServiceIds: string[];
};

export type OnlineBookingRequestInput = {
  shareCode: string;
  customerName: string;
  phone: string;
  serviceId: string;
  preferredAt: string;
  note?: string;
};

export type ConvertOnlineBookingInput = {
  requestId: string;
  staffId: string;
  userId: string;
};

export type StaffInviteInput = {
  staffId: string;
  account: string;
  role: UserRole;
  createdBy: string;
  validDays?: number;
};

export type StoreOwnerInviteInput = {
  storeName: string;
  ownerName: string;
  phone: string;
  address?: string;
  account: string;
  createdBy: string;
  validDays?: number;
};

export type JoinInviteInput = {
  inviteCode: string;
  name: string;
  password: string;
  storeName?: string;
  phone?: string;
  address?: string;
  account?: string;
};

export type DecideStoreOwnerApplicationInput = {
  applicationId: string;
  userId: string;
  approved: boolean;
  rejectReason?: string;
};

export type RevokeStaffInviteInput = {
  inviteId: string;
  revokedBy: string;
};

export type AccountProfileInput = {
  userId: string;
  name: string;
  avatarUrl?: string;
};

export type AuthUserStatusInput = {
  userId: string;
  status: AuthUser["status"];
  operatedBy: string;
};

export type AuthUserPasswordResetInput = {
  userId: string;
  password: string;
  operatedBy: string;
};

export type DeleteStaffInput = {
  staffId: string;
  operatedBy: string;
};

export type CheckoutInput = {
  storeId?: string;
  customerId?: string;
  guestName?: string;
  guestPhone?: string;
  staffId: string;
  collaboratorStaffIds?: string[];
  serviceId?: string;
  serviceIds?: string[];
  serviceCardSelections?: ServiceCardSelection[];
  productId?: string;
  giftProductId?: string;
  productItems?: CheckoutProductItemInput[];
  giftProductItems?: CheckoutProductItemInput[];
  discountAmount?: number;
  adjustmentReason?: string;
  approvalId?: string;
  appointmentId?: string;
  payMethod: Order["payMethod"];
  cardId?: string;
  requestedBy?: string;
};

export type CheckoutProductItemInput = {
  productId: string;
  quantity: number;
};

export type InventoryAdjustmentInput = {
  storeId?: string;
  productId: string;
  type: InventoryLog["type"];
  quantity: number;
  unitCost?: number;
  note?: string;
  expiryAt?: string;
};

export type ApprovalRequestInput = {
  storeId?: string;
  type: ApprovalRequest["type"];
  targetId: string;
  requestedBy: string;
  amount: number;
  reason: string;
};

export type ApprovalDecisionInput = {
  approvalId: string;
  userId: string;
  approved: boolean;
};

export type RefundInput = {
  storeId?: string;
  orderId: string;
  reason: string;
  userId: string;
  amount?: number;
  approvalId?: string;
};

export type RefundMemberCardInput = {
  memberCardId: string;
  reason: string;
  refundAmount?: number;
  payMethod?: CashPayMethod;
  signatureId: string;
  userId: string;
  staffId?: string;
};

export type VoidMemberCardOpeningInput = {
  memberCardId: string;
  reason: string;
  userId: string;
  staffId?: string;
};

export type OpenMemberCardInput = {
  storeId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerBirthday?: string;
  customerNote?: string;
  name?: string;
  type?: MemberCard["type"];
  balance?: number;
  remainingTimes?: number;
  discountRate?: number;
  benefitText?: string;
  serviceId?: string;
  serviceIds?: string[];
  serviceEntitlements?: MemberCard["serviceEntitlements"];
  paidAmount?: number;
  payMethod?: CashPayMethod;
  expiresAt?: string;
  note?: string;
  userId: string;
  staffId?: string;
};

export type OperationLogInput = {
  storeId?: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
};

export type NotificationInput = {
  storeId?: string;
  title: string;
  desc: string;
  view: ViewKey;
  targetType: string;
  targetId: string;
  audienceRoles: UserRole[];
  staffId?: string;
};

export type NotificationReadInput = {
  notificationId: string;
  userId: string;
};

export type NotificationArchiveInput = {
  notificationId: string;
  userId: string;
};

export type NotificationReadAllInput = {
  userId: string;
  role: UserRole;
  staffId?: string;
};

export type AppointmentInput = {
  storeId?: string;
  customerId: string;
  staffId: string;
  serviceId?: string;
  serviceIds?: string[];
  startAt: string;
  endAt?: string;
  roomName?: string;
  note?: string;
};

export type AppointmentStatusInput = {
  appointmentId: string;
  status: Appointment["status"];
  reason?: string;
};

export type AppointmentRescheduleInput = {
  appointmentId: string;
  staffId?: string;
  serviceId?: string;
  serviceIds?: string[];
  startAt: string;
  endAt?: string;
  roomName?: string;
  note?: string;
};

export type DailyCloseInput = {
  storeId?: string;
  businessDate: string;
  userId: string;
};

export type StaffUnavailableSlotInput = {
  storeId?: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
  userId: string;
};

export type StaffShiftInput = {
  storeId?: string;
  staffId: string;
  startAt: string;
  endAt: string;
  note: string;
  userId: string;
};

export type MemberCardRechargeInput = {
  memberCardId: string;
  amount: number;
  giftAmount?: number;
  times?: number;
  giftTimes?: number;
  paidAmount?: number;
  payMethod?: CashPayMethod;
  note?: string;
  userId: string;
  staffId?: string;
};

export type MemberCardStatusInput = {
  memberCardId: string;
  status: "正常" | "冻结";
  reason: string;
  userId: string;
  staffId?: string;
};

export type MemberCardExtendInput = {
  memberCardId: string;
  expiresAt: string;
  reason: string;
  userId: string;
  staffId?: string;
};

export type MemberCardTransferInput = {
  memberCardId: string;
  toCustomerId: string;
  reason: string;
  userId: string;
  staffId?: string;
};

export type CustomerServiceRecordInput = {
  customerId: string;
  staffId: string;
  serviceId: string;
  orderId?: string;
  skinCondition: string;
  beforeNote: string;
  careSteps?: string;
  productsUsed?: string;
  afterNote: string;
  customerFeedback?: string;
  nextCareAdvice?: string;
  nextFollowUpAt?: string;
};

export type CustomerSignatureInput = {
  customerId: string;
  serviceRecordId?: string;
  orderId?: string;
  title?: string;
  content?: string;
  requestedBy: string;
  validDays?: number;
};

export type CustomerSignatureSubmitInput = {
  token: string;
  signerName: string;
  signatureText: string;
};

export type CustomerFollowUpInput = {
  customerId: string;
  staffId: string;
  dueAt: string;
  method: CustomerFollowUp["method"];
  note: string;
};

export type CompleteFollowUpInput = {
  followUpId: string;
};

export type SettleCommissionInput = {
  userId: string;
  storeId?: string;
};

export type SupplierInput = {
  storeId?: string;
  name: string;
  phone: string;
  contact: string;
};

export type PurchaseOrderInput = {
  storeId?: string;
  supplierId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  expiryAt?: string;
  userId: string;
};

export type SupplierPurchaseInput = {
  storeId?: string;
  supplierId?: string;
  supplierName?: string;
  supplierPhone?: string;
  supplierContact?: string;
  productId?: string;
  productName?: string;
  productPrice?: number;
  productCategory?: string;
  productSubcategory?: string;
  productUnit?: string;
  warningStock?: number;
  shelfLifeMonths?: number;
  serviceStockDeductible?: boolean;
  serviceStockReviewStatus?: Product["serviceStockReviewStatus"];
  serviceStockReviewedAt?: string;
  serviceStockReviewedBy?: string;
  serviceUnit?: string;
  serviceUnitsPerStockUnit?: number;
  quantity: number;
  unitCost: number;
  expiryAt?: string;
  userId: string;
};

export type RestockLowInventoryInput = {
  storeId?: string;
  supplierId?: string;
  userId: string;
};

export type StocktakeInput = {
  storeId?: string;
  productId: string;
  actualStock: number;
  reason: string;
  userId: string;
};

export type TagDefinitionInput = {
  storeId?: string;
  name: string;
  scope: TagScope;
  color?: string;
};

export type TagDefinitionUpdateInput = {
  tagId: string;
  name?: string;
  color?: string;
  status?: TagDefinition["status"];
};

export type UpdateServiceCatalogInput = {
  serviceId: string;
  name?: string;
  category?: string;
  subcategory?: string;
  price?: number;
  duration?: number;
  defaultTimes?: number;
  consumables?: ServiceConsumable[];
  status?: Service["status"];
};

export type UpdateProductCatalogInput = {
  productId: string;
  name?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  price?: number;
  cost?: number;
  warningStock?: number;
  shelfLifeMonths?: number;
  serviceStockDeductible?: boolean;
  serviceStockReviewStatus?: Product["serviceStockReviewStatus"];
  serviceStockReviewedAt?: string;
  serviceStockReviewedBy?: string;
  serviceUnit?: string;
  serviceUnitsPerStockUnit?: number;
  status?: Product["status"];
};

function freezeOrderCatalogSnapshots(data: AppData): AppData {
  return {
    ...data,
    orders: data.orders.map((order) => {
      const service = order.serviceId ? data.services.find((item) => item.id === order.serviceId) : undefined;
      const snapshotProductItems = (items: OrderProductItem[] | undefined) => items?.map((item) => ({
        ...item,
        productName: item.productName ?? data.products.find((product) => product.id === item.productId)?.name,
      }));
      return {
        ...order,
        serviceName: order.serviceName ?? service?.name,
        servicePrice: order.servicePrice ?? service?.price,
        serviceConsumables: order.serviceConsumables
          ?? (order.serviceId || order.serviceIds?.length ? legacyOrderServiceInventoryConsumables(data, order) : undefined),
        productItems: snapshotProductItems(order.productItems),
        giftProductItems: snapshotProductItems(order.giftProductItems),
      };
    }),
  };
}

export function calculateOrderTotal(data: AppData, serviceId?: string, productId?: string, productItems?: CheckoutProductItemInput[], serviceIds?: string[]) {
  const selectedServiceIds = normalizeCheckoutServiceIds(serviceId, serviceIds);
  const serviceTotal = selectedServiceIds.reduce((sum, id) => sum + (data.services.find((item) => item.id === id)?.price ?? 0), 0);
  const productTotal = productItems?.length
    ? productItems.reduce((sum, item) => {
        const product = data.products.find((candidate) => candidate.id === item.productId);
        const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 0;
        return sum + (product?.price ?? 0) * quantity;
      }, 0)
    : (data.products.find((item) => item.id === productId)?.price ?? 0);
  return serviceTotal + productTotal;
}

function normalizeCheckoutProductItems(
  data: AppData,
  items: CheckoutProductItemInput[] | undefined,
  options: { gift?: boolean } = {},
): OrderProductItem[] {
  const merged = new Map<string, number>();
  for (const item of items ?? []) {
    if (!item.productId) continue;
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 0;
    if (quantity <= 0) continue;
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + quantity);
  }

  return Array.from(merged, ([productId, quantity]) => {
    const product = data.products.find((item) => item.id === productId);
    if (!product) throw new Error(options.gift ? "赠品不存在" : "商品不存在");
    const unitPrice = options.gift ? 0 : product.price;
    return {
      productId,
      quantity,
      unitPrice,
      amount: unitPrice * quantity,
    };
  });
}

function withProductNameSnapshots(data: AppData, items: OrderProductItem[]) {
  return items.map((item) => ({
    ...item,
    productName: item.productName ?? data.products.find((product) => product.id === item.productId)?.name,
  }));
}

export function createTagDefinition(
  data: AppData,
  input: TagDefinitionInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const name = normalizeTagName(input.name);
  if (!name) throw new Error("请输入标签名称");
  if (!["客户", "项目", "员工"].includes(input.scope)) throw new Error("标签分类不正确");
  if (data.tagDefinitions.some((tag) => tag.scope === input.scope && tag.name === name)) {
    throw new Error("同分类下标签已存在");
  }
  const tag: TagDefinition = {
    id: (options.idFactory ?? makeId)("tag"),
    storeId: scopedStoreId(data, input.storeId),
    name,
    scope: input.scope,
    color: normalizeTagColor(input.color),
    status: "启用",
    createdAt: (options.now ?? nowIso)(),
  };
  return { ...data, tagDefinitions: [tag, ...data.tagDefinitions] };
}

export function updateTagDefinition(data: AppData, input: TagDefinitionUpdateInput): AppData {
  const target = data.tagDefinitions.find((tag) => tag.id === input.tagId);
  if (!target) throw new Error("标签不存在");
  const nextName = input.name === undefined ? target.name : normalizeTagName(input.name);
  if (!nextName) throw new Error("请输入标签名称");
  if (
    data.tagDefinitions.some(
      (tag) => tag.id !== target.id && tag.scope === target.scope && tag.name === nextName,
    )
  ) {
    throw new Error("同分类下标签已存在");
  }

  return {
    ...data,
    tagDefinitions: data.tagDefinitions.map((tag) =>
      tag.id === target.id
        ? {
            ...tag,
            name: nextName,
            color: input.color === undefined ? tag.color : normalizeTagColor(input.color),
            status: normalizeTagStatus(input.status) ?? tag.status,
          }
        : tag,
    ),
    customers:
      nextName === target.name
        ? data.customers
        : data.customers.map((customer) => ({
            ...customer,
            tags: customer.tags.map((tagName) => (tagName === target.name ? nextName : tagName)),
          })),
  };
}

function normalizeCatalogStatus(status: "启用" | "停用" | undefined) {
  return status === "启用" || status === "停用" ? status : undefined;
}

export function updateServiceCatalog(data: AppData, input: UpdateServiceCatalogInput): AppData {
  const target = data.services.find((service) => service.id === input.serviceId);
  if (!target) throw new Error("服务项目不存在");
  const consumables = input.consumables === undefined
    ? target.consumables ?? []
    : input.consumables.filter((item) => {
        const product = data.products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new Error("商品不存在");
        return true;
      });
  const nextName = input.name === undefined ? target.name : trimText(input.name);
  if (!nextName) throw new Error("请填写项目名称");
  const nextPrice = positiveNumber(input.price, target.price);
  const nextDuration = Math.max(1, Math.round(positiveNumber(input.duration, target.duration)));
  const nextDefaultTimes = Math.max(1, Math.round(positiveNumber(input.defaultTimes, target.defaultTimes ?? 1)));
  const frozenData = freezeOrderCatalogSnapshots(data);
  return {
    ...frozenData,
    services: frozenData.services.map((service) =>
      service.id === input.serviceId
        ? {
            ...service,
            name: nextName,
            category: input.category === undefined ? service.category : trimText(input.category) || service.category,
            subcategory: input.subcategory === undefined ? service.subcategory : trimText(input.subcategory) || undefined,
            price: nextPrice,
            duration: nextDuration,
            defaultTimes: nextDefaultTimes,
            consumables,
            consumableProductId: consumables[0]?.productId,
            consumableQty: consumables[0]?.quantity,
            status: normalizeCatalogStatus(input.status) ?? service.status ?? "启用",
          }
        : service,
    ),
  };
}

export function updateProductCatalog(data: AppData, input: UpdateProductCatalogInput): AppData {
  const target = data.products.find((product) => product.id === input.productId);
  if (!target) throw new Error("商品不存在");
  const nextName = input.name === undefined ? target.name : trimText(input.name);
  if (!nextName) throw new Error("请填写商品名称");
  const nextPrice = Math.max(0, positiveNumber(input.price, target.price));
  const nextCost = Math.max(0, positiveNumber(input.cost, target.cost));
  const nextWarningStock = Math.max(0, positiveNumber(input.warningStock, target.warningStock));
  const explicitStockRule = input.serviceStockDeductible === undefined ? undefined : requireConfirmedProductStockRule({
    serviceStockDeductible: input.serviceStockDeductible,
    serviceUnit: input.serviceUnit,
    serviceUnitsPerStockUnit: input.serviceUnitsPerStockUnit,
  });
  const preservePendingStockFields = explicitStockRule === undefined && productServiceStockReviewStatus(target) !== "confirmed";
  const serviceStockDeductible = explicitStockRule?.serviceStockDeductible
    ?? (preservePendingStockFields ? target.serviceStockDeductible : productServiceStockDeductible(target));
  const serviceUnitsPerStockUnit = explicitStockRule?.serviceUnitsPerStockUnit
    ?? (preservePendingStockFields
      ? target.serviceUnitsPerStockUnit
      : serviceStockDeductible ? productServiceUnitsPerStockUnit(target) : undefined);
  const serviceUsesPerUnit = explicitStockRule
    ? serviceUnitsPerStockUnit
    : preservePendingStockFields ? target.serviceUsesPerUnit : serviceUnitsPerStockUnit;
  const serviceUnit = explicitStockRule?.serviceUnit
    ?? (preservePendingStockFields ? target.serviceUnit : serviceStockDeductible ? target.serviceUnit : undefined);
  const frozenData = freezeOrderCatalogSnapshots(data);
  return {
    ...frozenData,
    products: frozenData.products.map((product) =>
      product.id === input.productId
        ? {
            ...product,
            name: nextName,
            category: input.category === undefined ? product.category : trimText(input.category) || undefined,
            subcategory: input.subcategory === undefined ? product.subcategory : trimText(input.subcategory) || undefined,
            unit: input.unit === undefined ? product.unit : trimText(input.unit) || product.unit,
            price: nextPrice,
            cost: nextCost,
            warningStock: nextWarningStock,
            shelfLifeMonths: input.shelfLifeMonths === undefined ? product.shelfLifeMonths : Math.max(0, positiveNumber(input.shelfLifeMonths, 0)) || undefined,
            serviceStockDeductible,
            serviceStockReviewStatus: input.serviceStockReviewStatus ?? product.serviceStockReviewStatus,
            serviceStockReviewedAt: input.serviceStockReviewedAt ?? product.serviceStockReviewedAt,
            serviceStockReviewedBy: input.serviceStockReviewedBy ?? product.serviceStockReviewedBy,
            serviceUnit,
            serviceUnitsPerStockUnit,
            serviceUsesPerUnit,
            status: normalizeCatalogStatus(input.status) ?? product.status ?? "启用",
          }
        : product,
    ),
  };
}

function serviceUsedProducts(service: Service): ServiceConsumable[] {
  const consumables = service.consumables?.filter((item) => item.productId) ?? [];
  if (consumables.length > 0) return consumables;
  if (service.consumableProductId) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
  return [];
}

function serviceInventoryConsumables(data: AppData, service: Service): ServiceConsumable[] {
  const merged = new Map<string, number>();
  serviceUsedProducts(service).forEach((item) => {
    const product = data.products.find((candidate) => candidate.id === item.productId);
    if (!product || !productServiceStockDeductible(product)) return;
    const quantity = item.quantity > 0 ? serviceStockQuantityForProduct(product, item.quantity) : 0;
    if (quantity <= 0) return;
    merged.set(item.productId, roundStockQuantity((merged.get(item.productId) ?? 0) + quantity));
  });
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

function legacyServiceInventoryConsumables(data: AppData, service: Service): ServiceConsumable[] {
  const merged = new Map<string, number>();
  serviceUsedProducts(service).forEach((item) => {
    const product = data.products.find((candidate) => candidate.id === item.productId);
    if (!product || !legacyProductServiceStockDeductible(product)) return;
    const quantity = item.quantity > 0 ? legacyServiceStockQuantityForProduct(product, item.quantity) : 0;
    if (quantity <= 0) return;
    merged.set(item.productId, roundStockQuantity((merged.get(item.productId) ?? 0) + quantity));
  });
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

function legacyOrderServiceInventoryConsumables(data: AppData, order: Pick<Order, "serviceId" | "serviceIds">): ServiceConsumable[] {
  const serviceIds = order.serviceIds?.length ? order.serviceIds : order.serviceId ? [order.serviceId] : [];
  return serviceIds.flatMap((serviceId) => {
    const service = data.services.find((item) => item.id === serviceId);
    return service ? legacyServiceInventoryConsumables(data, service) : [];
  });
}

function serviceUsedProductIds(service: Service): string[] {
  const productIds = serviceUsedProducts(service).map((item) => item.productId).filter(Boolean);
  if (productIds.length > 0) return Array.from(new Set(productIds));
  return [];
}

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTagColor(value?: string) {
  const fallback = "#6d28d9";
  if (!value) return fallback;
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function normalizeTagStatus(value?: TagDefinition["status"]) {
  if (value === undefined) return undefined;
  if (value === "启用" || value === "停用") return value;
  throw new Error("标签状态不正确");
}

function staffCommissionRate(data: AppData, staffId: string) {
  return data.staff.find((staff) => staff.id === staffId)?.commissionRate ?? 0;
}

function commissionRecord(
  idFactory: IdFactory,
  staffId: string,
  orderId: string,
  type: Commission["type"],
  baseAmount: number,
  createdAt: string,
  rate: number,
  storeId?: string,
): Commission | undefined {
  if (baseAmount <= 0 || rate <= 0) return undefined;
  return {
    id: idFactory("cm"),
    storeId,
    staffId,
    orderId,
    type,
    baseAmount,
    rate,
    amount: Math.round(baseAmount * rate),
    status: "待结算",
    createdAt,
  };
}

function productItemsSignature(items: OrderProductItem[]) {
  return items
    .map((item) => `${item.productId}:${item.quantity}:${item.unitPrice}:${item.amount}`)
    .sort()
    .join("|");
}

function existingOrderItemsSignature(order: Order, gift = false) {
  const items = gift ? order.giftProductItems : order.productItems;
  if (items?.length) return productItemsSignature(items);
  const productId = gift ? order.giftProductId : order.productId;
  return productId ? `${productId}:1` : "";
}

function serviceIdsSignature(serviceId?: string, serviceIds?: string[]) {
  return normalizeCheckoutServiceIds(serviceId, serviceIds)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function isRecentDuplicateOrder(
  order: Order,
  draft: {
    appointmentId?: string;
    cardId?: string;
    customerId: string;
    createdAt: string;
    discountAmount: number;
    giftProductItems: OrderProductItem[];
    guestName: string;
    guestPhone: string;
    paidAmount: number;
    payMethod: Order["payMethod"];
    productItems: OrderProductItem[];
    serviceId: string;
    serviceIds?: string[];
    staffId: string;
    totalAmount: number;
  },
) {
  if (order.status === "已退款") return false;
  const currentTime = Date.parse(draft.createdAt);
  const orderTime = Date.parse(order.createdAt);
  if (!Number.isFinite(currentTime) || !Number.isFinite(orderTime)) return false;
  const ageMs = currentTime - orderTime;
  if (ageMs < 0 || ageMs > DUPLICATE_CHECKOUT_WINDOW_MS) return false;
  return (
    (order.customerId ?? "") === draft.customerId
    && (order.guestName ?? "").trim() === draft.guestName
    && (order.guestPhone ?? "").trim() === draft.guestPhone
    && order.staffId === draft.staffId
    && serviceIdsSignature(order.serviceId, order.serviceIds) === serviceIdsSignature(draft.serviceId, draft.serviceIds)
    && (
      !order.appointmentId
      || !draft.appointmentId
      || order.appointmentId === draft.appointmentId
    )
    && (order.cardId ?? "") === (draft.cardId ?? "")
    && order.payMethod === draft.payMethod
    && order.totalAmount === draft.totalAmount
    && order.paidAmount === draft.paidAmount
    && order.discountAmount === draft.discountAmount
    && productItemsSignature(draft.productItems) === existingOrderItemsSignature(order)
    && productItemsSignature(draft.giftProductItems) === existingOrderItemsSignature(order, true)
  );
}

export function registerStore(
  data: AppData,
  input: RegisterStoreInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  // Reject the internal platform namespace so self-registration cannot mint an
  // account that impersonates platform staff (e.g. "*@yich.local").
  if (input.account.trim().toLowerCase().endsWith("@yich.local")) {
    throw new Error("该登录账号为系统保留，请更换");
  }
  if (data.authUsers.some((user) => user.account === input.account)) {
    throw new Error("登录账号已存在");
  }

  const staffId = idFactory("s");
  const ownerUserId = idFactory("u");
  const existingStoreIds = new Set(data.storeProfiles.map((store) => store.id));
  let storeId = idFactory("store");
  while (existingStoreIds.has(storeId)) {
    storeId = idFactory("store");
  }
  return {
    ...data,
    storeProfiles: [
      {
        id: storeId,
        name: input.storeName,
        phone: input.phone,
        address: input.address ?? "",
        businessHours: "10:00 - 21:00",
        roomNames: [],
        maintenanceRoomNames: [],
        maintenanceRoomCount: 0,
        status: "active",
        createdAt,
      },
      ...data.storeProfiles,
    ],
    staff: [
      {
        id: staffId,
        storeId,
        name: input.ownerName,
        phone: input.phone,
        role: "老板",
        status: "active",
        accountId: ownerUserId,
        hiredAt: businessDateOf(createdAt),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: ownerUserId,
        storeId,
        name: input.ownerName,
        account: input.account,
        password: input.password,
        role: "owner",
        roleName: roleNameOf("owner"),
        staffId,
        status: "active",
        createdAt,
      },
      ...data.authUsers,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: ownerUserId,
        action: "注册门店",
        targetType: "store",
        targetId: storeId,
        summary: `${input.storeName} 完成门店注册`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function updateStoreStatus(
  data: AppData,
  input: StoreStatusInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const updatedAt = (options.now ?? nowIso)();
  const store = data.storeProfiles.find((item) => item.id === input.storeId);
  if (!store) throw new Error("门店不存在");
  if (input.status !== "active" && input.status !== "disabled") throw new Error("门店状态不正确");
  return {
    ...data,
    storeProfiles: data.storeProfiles.map((item) => item.id === store.id ? { ...item, status: input.status } : item),
    operationLogs: [
      {
        id: idFactory("op"),
        storeId: store.id,
        userId: input.userId,
        action: input.status === "active" ? "启用门店" : "停用门店",
        targetType: "store",
        targetId: store.id,
        summary: `${input.status === "active" ? "启用" : "停用"}门店 ${store.name}`,
        createdAt: updatedAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function updateStoreProfile(data: AppData, input: StoreProfileInput): AppData {
  const current = input.storeId ? data.storeProfiles.find((store) => store.id === input.storeId) : data.storeProfiles[0];
  if (!current) throw new Error("请先完成门店注册");
  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  const businessHours = input.businessHours.trim();
  const roomNames = (input.roomNames ?? current.roomNames ?? [])
    .map((roomName) => roomName.trim())
    .filter(Boolean)
    .slice(0, 20);
  const maintenanceRoomCount = Number.isFinite(input.maintenanceRoomCount)
    ? Math.max(0, Math.min(roomNames.length, Math.trunc(input.maintenanceRoomCount ?? 0)))
    : current.maintenanceRoomCount ?? 0;
  const maintenanceRoomNames = normalizeMaintenanceRoomNames(
    roomNames,
    input.maintenanceRoomNames ?? current.maintenanceRoomNames ?? maintenanceRoomCount,
  );
  if (!name) throw new Error("请输入门店名称");
  if (!phone) throw new Error("请输入门店电话");
  if (!businessHours) throw new Error("请输入营业时间");
  if (roomNames.length === 0) throw new Error("请至少设置 1 间房间");

  return {
    ...data,
    storeProfiles: data.storeProfiles.map((store) =>
      store.id === current.id
        ? {
            ...store,
            name,
            phone,
            address,
            businessHours,
            roomNames,
            roomNamesConfiguredAt: nowIso(),
            maintenanceRoomNames,
            maintenanceRoomCount: maintenanceRoomNames.length,
          }
        : store,
    ),
  };
}

export function normalizeStoreAiUsagePermissions(input: unknown): StoreAiUsagePermissions {
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

export function updateStoreAiUsagePermissions(data: AppData, input: StoreAiUsagePermissionsInput): AppData {
  const current = input.storeId ? data.storeProfiles.find((store) => store.id === input.storeId) : data.storeProfiles[0];
  if (!current) throw new Error("请先完成门店注册");
  const aiUsagePermissions = normalizeStoreAiUsagePermissions(input.permissions);
  return {
    ...data,
    storeProfiles: data.storeProfiles.map((store) => store.id === current.id ? { ...store, aiUsagePermissions } : store),
  };
}

export function normalizeStoreOperationalPermissions(input: unknown): StoreOperationalPermissions {
  const source = input && typeof input === "object" ? input as Partial<StoreOperationalPermissions> : {};
  return {
    staffCanViewAllAppointments: typeof source.staffCanViewAllAppointments === "boolean"
      ? source.staffCanViewAllAppointments
      : DEFAULT_STORE_OPERATIONAL_PERMISSIONS.staffCanViewAllAppointments,
  };
}

export function storeStaffCanViewAllAppointments(data: AppData, storeId?: string) {
  const store = storeId ? data.storeProfiles.find((item) => item.id === storeId) : data.storeProfiles[0];
  return normalizeStoreOperationalPermissions(store?.operationalPermissions).staffCanViewAllAppointments;
}

export function updateStoreOperationalPermissions(data: AppData, input: StoreOperationalPermissionsInput): AppData {
  const current = input.storeId ? data.storeProfiles.find((store) => store.id === input.storeId) : data.storeProfiles[0];
  if (!current) throw new Error("请先完成门店注册");
  const operationalPermissions = normalizeStoreOperationalPermissions(input.permissions);
  return {
    ...data,
    storeProfiles: data.storeProfiles.map((store) => store.id === current.id ? { ...store, operationalPermissions } : store),
  };
}

export function formalDataAudit(data: AppData): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const inspectStoreOwnership = (scope: string, item: { id: string; storeId?: string }, name: string) => {
    if (item.storeId) return;
    issues.push({
      id: item.id,
      scope,
      name: name || item.id,
      detail: "未绑定门店，已从所有门店业务视图隔离",
      reason: "需要平台管理员确认真实门店归属",
    });
  };
  const inspect = (scope: string, id: string, name: string, fields: string[], detail: string) => {
    const hit = fields.map((field) => suspiciousReason(field)).find(Boolean);
    if (!hit) return;
    issues.push({
      id,
      scope,
      name: name || id,
      detail,
      reason: hit,
    });
  };

  data.staff.forEach((staff) => inspect("员工", staff.id, staff.name, [staff.name, staff.phone, staff.role], `岗位 ${staff.role}`));
  data.authUsers.forEach((user) => inspect("账号", user.id, user.name, [user.name, user.account], `账号 ${user.account}`));
  data.customers.forEach((customer) => inspect("客户", customer.id, customer.name, [customer.name, customer.phone, customer.source, ...customer.tags], `来源 ${customer.source}`));
  data.services.forEach((service) => inspect("项目", service.id, service.name, [service.name, service.category], `分类 ${service.category}`));
  data.products.forEach((product) => inspect("商品", product.id, product.name, [product.name, product.type], `库存 ${product.stock}${product.unit}`));
  data.tagDefinitions.forEach((tag) => inspect("标签", tag.id, tag.name, [tag.name], `范围 ${tag.scope}`));
  data.onlineStorefronts.forEach((storefront) =>
    inspect("线上店铺", storefront.id, storefront.headline, [storefront.shareCode, storefront.headline, storefront.description], `分享码 ${storefront.shareCode}`),
  );
  data.staff.forEach((item) => inspectStoreOwnership("员工", item, item.name));
  data.customers.forEach((item) => inspectStoreOwnership("客户", item, item.name));
  data.services.forEach((item) => inspectStoreOwnership("项目", item, item.name));
  data.products.forEach((item) => inspectStoreOwnership("商品", item, item.name));
  data.orders.forEach((item) => inspectStoreOwnership("订单", item, item.orderNo));
  data.memberCards.forEach((item) => inspectStoreOwnership("会员卡", item, item.name));
  data.suppliers.forEach((item) => inspectStoreOwnership("供应商", item, item.name));
  data.purchaseOrders.forEach((item) => inspectStoreOwnership("采购单", item, item.id));
  data.inventoryLogs.forEach((item) => inspectStoreOwnership("库存流水", item, item.id));
  data.dailyCloses.forEach((item) => inspectStoreOwnership("日结", item, item.businessDate));

  return {
    issueCount: issues.length,
    issues: issues.slice(0, 50),
  };
}

export function previewFormalDataCleanup(data: AppData): DataCleanupReport {
  const dirty = collectDirtyIds(data);
  return {
    ...formalDataAudit(data),
    removalCounts: cleanupRemovalCounts(dirty),
  };
}

export function cleanupFormalData(data: AppData): { data: AppData; report: DataCleanupReport } {
  const dirty = collectDirtyIds(data);
  const cleanedData: AppData = {
    ...data,
    authUsers: data.authUsers.filter((item) => !dirty.authUserIds.has(item.id)),
    staff: data.staff.filter((item) => !dirty.staffIds.has(item.id)),
    staffInvites: data.staffInvites.filter((item) => !dirty.staffInviteIds.has(item.id)),
    customers: data.customers.filter((item) => !dirty.customerIds.has(item.id)),
    tagDefinitions: data.tagDefinitions.filter((item) => !dirty.tagIds.has(item.id)),
    services: data.services.filter((item) => !dirty.serviceIds.has(item.id)),
    products: data.products.filter((item) => !dirty.productIds.has(item.id)),
    onlineStorefronts: data.onlineStorefronts.filter((item) => !dirty.onlineStorefrontIds.has(item.id)),
    onlineBookingRequests: data.onlineBookingRequests.filter((item) => !dirty.onlineBookingRequestIds.has(item.id)),
    appointments: data.appointments.filter((item) => !dirty.appointmentIds.has(item.id)),
    staffUnavailableSlots: data.staffUnavailableSlots.filter((item) => !dirty.staffUnavailableSlotIds.has(item.id)),
    staffShifts: data.staffShifts.filter((item) => !dirty.staffShiftIds.has(item.id)),
    memberCards: data.memberCards.filter((item) => !dirty.memberCardIds.has(item.id)),
    distributors: data.distributors.filter((item) => !dirty.distributorIds.has(item.id)),
    referralRelations: data.referralRelations.filter((item) => !dirty.referralRelationIds.has(item.id)),
    orders: data.orders.filter((item) => !dirty.orderIds.has(item.id)),
    refunds: data.refunds.filter((item) => !dirty.refundIds.has(item.id)),
    commissions: data.commissions.filter((item) => !dirty.commissionIds.has(item.id)),
    distributionCommissions: data.distributionCommissions.filter((item) => !dirty.distributionCommissionIds.has(item.id)),
    commissionSettlements: data.commissionSettlements.filter((item) => !dirty.commissionSettlementIds.has(item.id)),
    inventoryLogs: data.inventoryLogs.filter((item) => !dirty.inventoryLogIds.has(item.id)),
    memberCardTransactions: data.memberCardTransactions.filter((item) => !dirty.memberCardTransactionIds.has(item.id)),
    operationLogs: data.operationLogs.filter((item) => !dirty.operationLogIds.has(item.id)),
    notifications: data.notifications.filter((item) => !dirty.notificationIds.has(item.id)),
    dailyCloses: data.dailyCloses.filter((item) => !dirty.dailyCloseIds.has(item.id)),
    approvalRequests: data.approvalRequests.filter((item) => !dirty.approvalRequestIds.has(item.id)),
    customerServiceRecords: data.customerServiceRecords.filter((item) => !dirty.customerServiceRecordIds.has(item.id)),
    customerFollowUps: data.customerFollowUps.filter((item) => !dirty.customerFollowUpIds.has(item.id)),
    suppliers: data.suppliers.filter((item) => !dirty.supplierIds.has(item.id)),
    purchaseOrders: data.purchaseOrders.filter((item) => !dirty.purchaseOrderIds.has(item.id)),
    stocktakes: data.stocktakes.filter((item) => !dirty.stocktakeIds.has(item.id)),
  };

  return {
    data: cleanedData,
    report: {
      ...formalDataAudit(cleanedData),
      removalCounts: cleanupRemovalCounts(dirty),
    },
  };
}

function suspiciousReason(value: string) {
  const normalized = value.toLowerCase();
  if (value.includes("验证")) return "包含验证数据字样";
  if (value.includes("测试")) return "包含测试数据字样";
  if (normalized.includes("demo")) return "包含 demo 字样";
  if (normalized.includes("sample")) return "包含 sample 字样";
  if (normalized.includes("@test.local")) return "使用测试账号域名";
  if (normalized.includes("cloudflare")) return "包含线上验证脚本字样";
  return "";
}

function collectDirtyIds(data: AppData) {
  const dirty = {
    authUserIds: new Set<string>(),
    staffIds: new Set<string>(),
    staffInviteIds: new Set<string>(),
    customerIds: new Set<string>(),
    tagIds: new Set<string>(),
    serviceIds: new Set<string>(),
    productIds: new Set<string>(),
    onlineStorefrontIds: new Set<string>(),
    onlineBookingRequestIds: new Set<string>(),
    appointmentIds: new Set<string>(),
    staffUnavailableSlotIds: new Set<string>(),
    staffShiftIds: new Set<string>(),
    memberCardIds: new Set<string>(),
    distributorIds: new Set<string>(),
    referralRelationIds: new Set<string>(),
    orderIds: new Set<string>(),
    refundIds: new Set<string>(),
    commissionIds: new Set<string>(),
    distributionCommissionIds: new Set<string>(),
    commissionSettlementIds: new Set<string>(),
    inventoryLogIds: new Set<string>(),
    memberCardTransactionIds: new Set<string>(),
    operationLogIds: new Set<string>(),
    notificationIds: new Set<string>(),
    dailyCloseIds: new Set<string>(),
    approvalRequestIds: new Set<string>(),
    customerServiceRecordIds: new Set<string>(),
    customerFollowUpIds: new Set<string>(),
    supplierIds: new Set<string>(),
    purchaseOrderIds: new Set<string>(),
    stocktakeIds: new Set<string>(),
  };

  data.authUsers.forEach((item) => {
    if (hasSuspiciousField(item.name, item.account)) dirty.authUserIds.add(item.id);
  });
  data.staff.forEach((item) => {
    if (hasSuspiciousField(item.name, item.phone, item.role) || (item.accountId && dirty.authUserIds.has(item.accountId))) dirty.staffIds.add(item.id);
  });
  data.customers.forEach((item) => {
    if (hasSuspiciousField(item.name, item.phone, item.source, ...item.tags)) dirty.customerIds.add(item.id);
  });
  data.tagDefinitions.forEach((item) => {
    if (hasSuspiciousField(item.name)) dirty.tagIds.add(item.id);
  });
  data.products.forEach((item) => {
    if (hasSuspiciousField(item.name, item.type)) dirty.productIds.add(item.id);
  });
  data.services.forEach((item) => {
    if (
      hasSuspiciousField(item.name, item.category) ||
      (item.consumableProductId && dirty.productIds.has(item.consumableProductId)) ||
      item.consumables?.some((consumable) => dirty.productIds.has(consumable.productId))
    ) {
      dirty.serviceIds.add(item.id);
    }
  });
  data.onlineStorefronts.forEach((item) => {
    if (hasSuspiciousField(item.shareCode, item.headline, item.description) || item.enabledServiceIds.some((serviceId) => dirty.serviceIds.has(serviceId))) {
      dirty.onlineStorefrontIds.add(item.id);
    }
  });

  let changed = true;
  while (changed) {
    const before = dirtySize(dirty);
    data.staffInvites.forEach((item) => {
      if (dirty.staffIds.has(item.staffId) || dirty.authUserIds.has(item.createdBy) || hasSuspiciousField(item.account, item.inviteCode)) dirty.staffInviteIds.add(item.id);
    });
    data.appointments.forEach((item) => {
      if (dirty.customerIds.has(item.customerId) || dirty.staffIds.has(item.staffId) || dirty.serviceIds.has(item.serviceId) || hasSuspiciousField(item.note)) {
        dirty.appointmentIds.add(item.id);
      }
    });
    data.onlineBookingRequests.forEach((item) => {
      if (
        dirty.onlineStorefrontIds.has(item.storefrontId) ||
        dirty.serviceIds.has(item.serviceId) ||
        (item.appointmentId && dirty.appointmentIds.has(item.appointmentId)) ||
        hasSuspiciousField(item.customerName, item.phone, item.note)
      ) {
        dirty.onlineBookingRequestIds.add(item.id);
      }
    });
    data.staffUnavailableSlots.forEach((item) => {
      if (dirty.staffIds.has(item.staffId) || dirty.authUserIds.has(item.createdBy) || hasSuspiciousField(item.reason)) dirty.staffUnavailableSlotIds.add(item.id);
    });
    data.staffShifts.forEach((item) => {
      if (dirty.staffIds.has(item.staffId) || dirty.authUserIds.has(item.createdBy) || hasSuspiciousField(item.note)) dirty.staffShiftIds.add(item.id);
    });
    data.memberCards.forEach((item) => {
      if (dirty.customerIds.has(item.customerId) || (item.serviceId && dirty.serviceIds.has(item.serviceId)) || item.serviceIds?.some((serviceId) => dirty.serviceIds.has(serviceId)) || hasSuspiciousField(item.name)) {
        dirty.memberCardIds.add(item.id);
      }
    });
    data.distributors.forEach((item) => {
      if ((item.customerId && dirty.customerIds.has(item.customerId)) || (item.staffId && dirty.staffIds.has(item.staffId)) || hasSuspiciousField(item.name, item.phone, item.inviteCode)) {
        dirty.distributorIds.add(item.id);
      }
    });
    data.referralRelations.forEach((item) => {
      if (dirty.distributorIds.has(item.distributorId) || dirty.customerIds.has(item.customerId)) dirty.referralRelationIds.add(item.id);
    });
    data.orders.forEach((item) => {
      if (
        dirty.customerIds.has(item.customerId) ||
        dirty.staffIds.has(item.staffId) ||
        dirty.serviceIds.has(item.serviceId) ||
        (item.productId && dirty.productIds.has(item.productId)) ||
        (item.cardId && dirty.memberCardIds.has(item.cardId)) ||
        (item.distributorId && dirty.distributorIds.has(item.distributorId)) ||
        (item.appointmentId && dirty.appointmentIds.has(item.appointmentId)) ||
        hasSuspiciousField(item.orderNo, item.adjustmentReason ?? "")
      ) {
        dirty.orderIds.add(item.id);
      }
    });
    data.refunds.forEach((item) => {
      if (dirty.orderIds.has(item.orderId) || dirty.authUserIds.has(item.createdBy) || hasSuspiciousField(item.reason)) dirty.refundIds.add(item.id);
    });
    data.commissions.forEach((item) => {
      if (dirty.staffIds.has(item.staffId) || dirty.orderIds.has(item.orderId) || (item.settlementId && dirty.commissionSettlementIds.has(item.settlementId))) dirty.commissionIds.add(item.id);
    });
    data.distributionCommissions.forEach((item) => {
      if (dirty.distributorIds.has(item.distributorId) || dirty.customerIds.has(item.customerId) || dirty.orderIds.has(item.orderId) || (item.settlementId && dirty.commissionSettlementIds.has(item.settlementId))) {
        dirty.distributionCommissionIds.add(item.id);
      }
    });
    data.commissionSettlements.forEach((item) => {
      if (dirty.authUserIds.has(item.createdBy) || item.commissionIds.some((commissionId) => dirty.commissionIds.has(commissionId) || dirty.distributionCommissionIds.has(commissionId))) {
        dirty.commissionSettlementIds.add(item.id);
      }
    });
    data.inventoryLogs.forEach((item) => {
      if (dirty.productIds.has(item.productId) || hasSuspiciousField(item.note)) dirty.inventoryLogIds.add(item.id);
    });
    data.memberCardTransactions.forEach((item) => {
      if (dirty.memberCardIds.has(item.memberCardId) || (item.orderId && dirty.orderIds.has(item.orderId)) || hasSuspiciousField(item.note)) dirty.memberCardTransactionIds.add(item.id);
    });
    data.approvalRequests.forEach((item) => {
      if (dirty.authUserIds.has(item.requestedBy) || (item.approvedBy && dirty.authUserIds.has(item.approvedBy)) || dirty.orderIds.has(item.targetId) || hasSuspiciousField(item.reason)) dirty.approvalRequestIds.add(item.id);
    });
    data.customerServiceRecords.forEach((item) => {
      if (
        dirty.customerIds.has(item.customerId) ||
        dirty.staffIds.has(item.staffId) ||
        dirty.serviceIds.has(item.serviceId) ||
        (item.orderId && dirty.orderIds.has(item.orderId)) ||
        (item.memberCardTransactionId && dirty.memberCardTransactionIds.has(item.memberCardTransactionId)) ||
        hasSuspiciousField(item.skinCondition, item.beforeNote, item.careSteps, item.productsUsed, item.afterNote, item.customerFeedback, item.nextCareAdvice)
      ) {
        dirty.customerServiceRecordIds.add(item.id);
      }
    });
    data.customerFollowUps.forEach((item) => {
      if (dirty.customerIds.has(item.customerId) || dirty.staffIds.has(item.staffId) || hasSuspiciousField(item.note)) dirty.customerFollowUpIds.add(item.id);
    });
    data.suppliers.forEach((item) => {
      if (hasSuspiciousField(item.name, item.phone, item.contact)) dirty.supplierIds.add(item.id);
    });
    data.purchaseOrders.forEach((item) => {
      if (dirty.supplierIds.has(item.supplierId) || dirty.productIds.has(item.productId) || dirty.authUserIds.has(item.createdBy)) dirty.purchaseOrderIds.add(item.id);
    });
    data.stocktakes.forEach((item) => {
      if (dirty.productIds.has(item.productId) || dirty.authUserIds.has(item.createdBy) || hasSuspiciousField(item.reason)) dirty.stocktakeIds.add(item.id);
    });
    data.operationLogs.forEach((item) => {
      if (dirty.authUserIds.has(item.userId) || dirtyTarget(item.targetId, dirty) || hasSuspiciousField(item.action, item.summary, item.targetType)) dirty.operationLogIds.add(item.id);
    });
    data.notifications.forEach((item) => {
      if ((item.staffId && dirty.staffIds.has(item.staffId)) || dirtyTarget(item.targetId, dirty) || hasSuspiciousField(item.title, item.desc, item.targetType)) dirty.notificationIds.add(item.id);
    });
    data.dailyCloses.forEach((item) => {
      if (dirty.authUserIds.has(item.createdBy) || (item.reversedBy && dirty.authUserIds.has(item.reversedBy))) dirty.dailyCloseIds.add(item.id);
    });
    changed = dirtySize(dirty) !== before;
  }

  return dirty;
}

function cleanupRemovalCounts(dirty: ReturnType<typeof collectDirtyIds>) {
  return [
    { scope: "账号", count: dirty.authUserIds.size },
    { scope: "员工", count: dirty.staffIds.size },
    { scope: "客户", count: dirty.customerIds.size },
    { scope: "项目", count: dirty.serviceIds.size },
    { scope: "商品", count: dirty.productIds.size },
    { scope: "预约", count: dirty.appointmentIds.size + dirty.onlineBookingRequestIds.size },
    { scope: "订单与流水", count: dirty.orderIds.size + dirty.refundIds.size + dirty.memberCardTransactionIds.size + dirty.inventoryLogIds.size },
    { scope: "提成与结算", count: dirty.commissionIds.size + dirty.distributionCommissionIds.size + dirty.commissionSettlementIds.size },
    { scope: "其他关联记录", count: dirtySize(dirty) - dirty.authUserIds.size - dirty.staffIds.size - dirty.customerIds.size - dirty.serviceIds.size - dirty.productIds.size - dirty.appointmentIds.size - dirty.onlineBookingRequestIds.size - dirty.orderIds.size - dirty.refundIds.size - dirty.memberCardTransactionIds.size - dirty.inventoryLogIds.size - dirty.commissionIds.size - dirty.distributionCommissionIds.size - dirty.commissionSettlementIds.size },
  ].filter((item) => item.count > 0);
}

function hasSuspiciousField(...values: string[]) {
  return values.some((value) => Boolean(suspiciousReason(value)));
}

function dirtySize(dirty: Record<string, Set<string>>) {
  return Object.values(dirty).reduce((sum, set) => sum + set.size, 0);
}

function dirtyTarget(targetId: string, dirty: ReturnType<typeof collectDirtyIds>) {
  return Object.values(dirty).some((set) => set.has(targetId));
}

export function upsertOnlineStorefront(
  data: AppData,
  input: OnlineStorefrontInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const updatedAt = (options.now ?? nowIso)();
  const store = input.storeId ? data.storeProfiles.find((item) => item.id === input.storeId) : data.storeProfiles[0];
  if (!store) throw new Error("请先完成门店注册");
  if (!/^[a-zA-Z0-9-]{4,32}$/.test(input.shareCode)) throw new Error("分享码只能包含字母、数字和短横线，长度 4-32 位");
  if (input.enabledServiceIds.length === 0) throw new Error("至少选择一个线上展示项目");
  const enabledServiceIds = Array.from(new Set(input.enabledServiceIds));
  if (!enabledServiceIds.every((serviceId) => data.services.some((service) => service.id === serviceId))) {
    throw new Error("线上项目不存在");
  }

  const current = data.onlineStorefronts.find((item) => item.storeId === store.id)
    ?? (data.storeProfiles.length === 1 ? data.onlineStorefronts[0] : undefined);
  const storefront: OnlineStorefront = {
    id: current?.id ?? idFactory("os"),
    storeId: store.id,
    shareCode: input.shareCode,
    status: input.status ?? current?.status ?? "启用",
    headline: input.headline,
    description: input.description,
    enabledServiceIds,
    createdAt: current?.createdAt ?? updatedAt,
    updatedAt,
  };
  return {
    ...data,
    onlineStorefronts: current
      ? data.onlineStorefronts.map((item) => (item.id === current.id ? storefront : item))
      : [storefront, ...data.onlineStorefronts],
  };
}

export function createOnlineBookingRequest(
  data: AppData,
  input: OnlineBookingRequestInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const storefront = data.onlineStorefronts.find((item) => item.shareCode === input.shareCode && item.status === "启用");
  if (!storefront) throw new Error("线上店铺不存在或已停用");
  if (!input.customerName.trim()) throw new Error("请输入姓名");
  if (!input.phone.trim()) throw new Error("请输入手机号");
  const phone = requireMobilePhone(input.phone);
  if (!storefront.enabledServiceIds.includes(input.serviceId)) throw new Error("该项目暂未开放线上预约");
  if (+new Date(input.preferredAt) <= +new Date(createdAt)) throw new Error("预约意向时间必须晚于当前时间");
  if (availableStaffForOnlineBooking(data, input.serviceId, input.preferredAt, storefront.storeId).length === 0) {
    throw new Error("该时间暂无可预约服务人员，请选择其他时间");
  }

  const request: OnlineBookingRequest = {
    id: idFactory("obr"),
    storeId: storefront.storeId,
    storefrontId: storefront.id,
    customerName: input.customerName.trim(),
    phone,
    serviceId: input.serviceId,
    preferredAt: input.preferredAt,
    note: input.note ?? "",
    status: "待处理",
    createdAt,
  };
  return {
    ...data,
    onlineBookingRequests: [request, ...data.onlineBookingRequests],
  };
}

export function availableStaffForOnlineBooking(data: AppData, serviceId: string, preferredAt: string, storeId?: string) {
  const selectedService = data.services.find((item) => item.id === serviceId);
  if (!selectedService) return [];
  const startAt = new Date(preferredAt);
  if (Number.isNaN(startAt.getTime())) return [];
  const endAt = new Date(startAt.getTime() + selectedService.duration * 60 * 1000);
  const scopedStoreId = storeId ?? selectedService.storeId;

  return data.staff.filter((staff) => {
    if (scopedStoreId && staff.storeId !== scopedStoreId) return false;
    if (!isBusinessStaff(staff)) return false;
    if (staff.status !== "active") return false;
    const hasAppointmentConflict = data.appointments.some((appointment) => {
      if (appointment.staffId !== staff.id) return false;
      if (["已完成", "已取消", "爽约"].includes(appointment.status)) return false;
      const appointmentStart = new Date(appointment.startAt);
      const appointmentEnd = appointmentEndAt(appointment, data.services);
      return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
    });
    if (hasAppointmentConflict) return false;

    const hasUnavailableConflict = data.staffUnavailableSlots.some((slot) =>
      slot.staffId === staff.id && hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt)),
    );
    if (hasUnavailableConflict) return false;

    const shiftsForDay = data.staffShifts.filter((shift) => shift.staffId === staff.id && businessDateOf(shift.startAt) === businessDateOf(preferredAt));
    return shiftsForDay.length === 0 || shiftsForDay.some((shift) => startAt >= new Date(shift.startAt) && endAt <= new Date(shift.endAt));
  });
}

export function convertOnlineBookingRequest(
  data: AppData,
  input: ConvertOnlineBookingInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const handledAt = (options.now ?? nowIso)();
  const request = data.onlineBookingRequests.find((item) => item.id === input.requestId);
  if (!request) throw new Error("线上预约申请不存在");
  if (request.status !== "待处理") throw new Error("该线上预约申请已处理");

  let nextData = data;
  let customer = nextData.customers.find((item) => item.phone === request.phone);
  if (!customer) {
    customer = {
      id: idFactory("c"),
      storeId: request.storeId ?? data.onlineStorefronts.find((item) => item.id === request.storefrontId)?.storeId,
      name: request.customerName,
      phone: request.phone,
      level: "普通会员",
      source: "线上预约",
      tags: ["线上预约"],
      lastVisit: handledAt,
    };
    nextData = {
      ...nextData,
      customers: [customer, ...nextData.customers],
    };
  }

  nextData = createAppointment(
    nextData,
    {
      customerId: customer.id,
      storeId: request.storeId,
      staffId: input.staffId,
      serviceId: request.serviceId,
      startAt: request.preferredAt,
      note: request.note ? `线上预约：${request.note}` : "线上预约",
    },
    { idFactory, now: () => handledAt },
  );
  const appointmentId = nextData.appointments[0].id;

  return {
    ...nextData,
    onlineBookingRequests: nextData.onlineBookingRequests.map((item) =>
      item.id === request.id ? { ...item, status: "已转预约", appointmentId, handledAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "线上预约转预约",
        targetType: "onlineBookingRequest",
        targetId: request.id,
        summary: `${request.customerName} 线上预约已转为门店预约`,
        createdAt: handledAt,
      },
      ...nextData.operationLogs,
    ],
  };
}

export function addStaffMember(
  data: AppData,
  input: StaffInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const name = input.name.trim();
  if (!input.phone.trim()) throw new Error("请输入员工手机号");
  const phone = requireMobilePhone(input.phone, "员工手机号必须为 11 位数字");
  const role = input.role.trim();
  if (!name) throw new Error("请输入员工姓名");
  if (!role) throw new Error("请选择员工岗位");
  if (!STAFF_BUSINESS_ROLES.has(role)) throw new Error("员工岗位只能选择店长、员工或前台");
  if ((input.baseSalary ?? 0) < 0) throw new Error("底薪不能小于 0");
  if ((input.commissionRate ?? 0) < 0) throw new Error("提成比例不能小于 0");
  const staff: Staff = {
    id: idFactory("s"),
    storeId: scopedStoreId(data, input.storeId),
    name,
    phone,
    role,
    status: "active",
    hiredAt: businessDateOf(createdAt),
    baseSalary: input.baseSalary ?? 0,
    commissionRate: input.commissionRate ?? 0,
  };
  return { ...data, staff: [staff, ...data.staff] };
}

export function updateStaffMember(data: AppData, input: StaffUpdateInput): AppData {
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  const name = input.name?.trim();
  if (input.phone !== undefined && !input.phone.trim()) throw new Error("请输入员工手机号");
  const phone = input.phone === undefined ? undefined : requireMobilePhone(input.phone, "员工手机号必须为 11 位数字");
  const role = input.role?.trim();
  if (input.name !== undefined && !name) throw new Error("请输入员工姓名");
  if (input.role !== undefined && !role) throw new Error("请选择员工岗位");
  if (role && !STAFF_BUSINESS_ROLES.has(role)) throw new Error("员工岗位只能选择店长、员工或前台");
  if (input.baseSalary !== undefined && input.baseSalary < 0) throw new Error("底薪不能小于 0");
  if (input.commissionRate !== undefined && input.commissionRate < 0) throw new Error("提成比例不能小于 0");
  return {
    ...data,
    staff: data.staff.map((staff) =>
      staff.id === input.staffId
        ? {
            ...staff,
            name: name ?? staff.name,
            phone: phone ?? staff.phone,
            role: role ?? staff.role,
            status: input.status ?? staff.status,
            baseSalary: input.baseSalary ?? staff.baseSalary,
            commissionRate: input.commissionRate ?? staff.commissionRate,
          }
        : staff,
    ),
  };
}

const MAX_ACCOUNT_ASSET_URL_LENGTH = 500;

export function updateAccountProfile(data: AppData, input: AccountProfileInput): AppData {
  const user = data.authUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("账号不存在");
  const name = input.name.trim();
  const avatarUrl = input.avatarUrl?.trim();
  if (!name) throw new Error("请输入姓名");
  if (avatarUrl?.startsWith("data:image/")) throw new Error("头像文件过大，请重新上传头像");
  if (avatarUrl && !avatarUrl.startsWith("/api/assets/")) throw new Error("头像格式不正确");
  if (avatarUrl && avatarUrl.length > MAX_ACCOUNT_ASSET_URL_LENGTH) throw new Error("头像地址不正确");
  return {
    ...data,
    authUsers: data.authUsers.map((item) =>
      item.id === input.userId
        ? {
            ...item,
            name,
            avatarUrl: avatarUrl || undefined,
          }
        : item,
    ),
    staff: user.staffId
      ? data.staff.map((staff) => (staff.id === user.staffId ? { ...staff, name } : staff))
      : data.staff,
  };
}

export function updateAuthUserStatus(data: AppData, input: AuthUserStatusInput): AppData {
  const user = data.authUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("账号不存在");
  if (input.status !== "active" && input.status !== "disabled" && input.status !== "pending") throw new Error("账号状态不正确");
  if (user.id === input.operatedBy && input.status === "disabled") throw new Error("不能停用当前登录账号");
  const activeSuperadminCount = data.authUsers.filter((item) => effectiveRoleForUser(item) === "superadmin" && item.status === "active").length;
  if (effectiveRoleForUser(user) === "superadmin" && user.status === "active" && input.status === "disabled" && activeSuperadminCount <= 1) {
    throw new Error("至少保留一个启用的系统管理员");
  }
  return {
    ...data,
    authUsers: data.authUsers.map((item) => item.id === user.id ? { ...item, status: input.status } : item),
    operationLogs: [
      {
        id: makeId("op"),
        userId: input.operatedBy,
        action: input.status === "active" ? "启用账号" : input.status === "pending" ? "账号待审核" : "停用账号",
        targetType: "authUser",
        targetId: user.id,
        summary: `${input.status === "active" ? "启用" : input.status === "pending" ? "待审核" : "停用"}账号 ${user.account}`,
        createdAt: nowIso(),
      },
      ...data.operationLogs,
    ],
  };
}

export function resetAuthUserPassword(data: AppData, input: AuthUserPasswordResetInput): AppData {
  const user = data.authUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("账号不存在");
  if (!input.password) throw new Error("请输入新密码");
  return {
    ...data,
    authUsers: data.authUsers.map((item) => (item.id === user.id ? { ...item, password: input.password } : item)),
    operationLogs: [
      {
        id: makeId("op"),
        userId: input.operatedBy,
        action: "重置账号密码",
        targetType: "authUser",
        targetId: user.id,
        summary: `重置账号 ${user.account} 的密码`,
        createdAt: nowIso(),
      },
      ...data.operationLogs,
    ],
  };
}

export function updateAuthUserAiCredits(data: AppData, input: AuthUserAiCreditsInput): AppData {
  const user = data.authUsers.find((item) => item.id === input.userId);
  if (!user) throw new Error("账号不存在");
  const credits = roundAiCreditAmount(Number(input.credits));
  if (!Number.isFinite(Number(input.credits)) || Number(input.credits) < 0 || credits > 99999) throw new Error("AI 积分必须是 0 到 99999");
  return {
    ...data,
    authUsers: data.authUsers.map((item) => item.id === user.id ? { ...item, aiCredits: credits } : item),
    operationLogs: [
      {
        id: makeId("op"),
        userId: input.operatedBy,
        action: "调整AI积分",
        targetType: "authUser",
        targetId: user.id,
        summary: `调整账号 ${user.account} 的 AI 积分为 ${credits}`,
        createdAt: nowIso(),
      },
      ...data.operationLogs,
    ],
  };
}

export function consumeAuthUserAiCredit(data: AppData, userId: string, amount = 1): AppData {
  const user = data.authUsers.find((item) => item.id === userId);
  const credits = accountAiCredits(user?.aiCredits);
  const charge = roundAiCreditAmount(amount);
  if (!user || credits <= 0 || charge <= 0) return data;
  return {
    ...data,
    authUsers: data.authUsers.map((item) => item.id === user.id ? { ...item, aiCredits: roundAiCreditAmount(Math.max(0, credits - charge)) } : item),
  };
}

export function deleteStaffMember(data: AppData, input: DeleteStaffInput): AppData {
  const staff = data.staff.find((item) => item.id === input.staffId);
  if (!staff) throw new Error("员工不存在");
  const linkedUserIds = new Set(data.authUsers.filter((user) => user.staffId === staff.id || staff.accountId === user.id).map((user) => user.id));
  const hasBusinessRecords =
    data.appointments.some((item) => item.staffId === staff.id) ||
    data.orders.some((item) => item.staffId === staff.id) ||
    data.commissions.some((item) => item.staffId === staff.id) ||
    data.staffShifts.some((item) => item.staffId === staff.id) ||
    data.staffUnavailableSlots.some((item) => item.staffId === staff.id) ||
    data.customerServiceRecords.some((item) => item.staffId === staff.id) ||
    data.customerFollowUps.some((item) => item.staffId === staff.id);
  if (hasBusinessRecords) throw new Error("该员工已有预约、订单或提成记录，不能删除，请停用账号和员工档案");
  return {
    ...data,
    staff: data.staff.filter((item) => item.id !== staff.id),
    authUsers: data.authUsers.filter((item) => !linkedUserIds.has(item.id)),
    staffInvites: data.staffInvites.filter((item) => item.staffId !== staff.id),
    operationLogs: [
      {
        id: makeId("op"),
        userId: input.operatedBy,
        action: "删除员工",
        targetType: "staff",
        targetId: staff.id,
        summary: `删除员工 ${staff.name}`,
        createdAt: nowIso(),
      },
      ...data.operationLogs,
    ],
  };
}

export function createStaffInvite(
  data: AppData,
  input: StaffInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const validDays = input.validDays ?? inviteDefaultDays(data);
  const account = input.account.trim();
  const staff = data.staff.find((item) => item.id === input.staffId);
  if (!staff) throw new Error("员工不存在");
  if (!isBusinessStaff(staff)) throw new Error("老板账号不走员工邀请码");
  if (!account) throw new Error("请输入登录账号");
  if (validDays <= 0) throw new Error("邀请码有效期必须大于 0 天");
  if (!["manager", "frontdesk", "therapist", "finance"].includes(input.role)) throw new Error("账号角色不正确");
  if (staff.accountId || data.authUsers.some((user) => user.staffId === staff.id)) throw new Error("该员工已开通账号");
  if (data.authUsers.some((user) => user.account === account)) throw new Error("登录账号已存在");
  const hasActiveInvite = data.staffInvites.some((invite) => {
    if (invite.status !== "待加入") return false;
    if (invite.expiresAt && +new Date(invite.expiresAt) <= +new Date(createdAt)) return false;
    return invite.account === account || invite.staffId === staff.id;
  });
  if (hasActiveInvite) throw new Error("该员工或账号已有待加入邀请");
  const invite: StaffInvite = {
    id: idFactory("si"),
    storeId: staff.storeId ?? scopedStoreId(data),
    staffId: staff.id,
    account,
    role: input.role,
    status: "待加入",
    inviteCode: createUniqueInviteCode(data, "join", idFactory),
    createdBy: input.createdBy,
    createdAt,
    expiresAt: new Date(+new Date(createdAt) + validDays * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    ...data,
    staffInvites: [invite, ...data.staffInvites],
  };
}

export function createStoreOwnerInvite(
  data: AppData,
  input: StoreOwnerInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const validDays = input.validDays ?? inviteDefaultDays(data);
  const storeName = input.storeName.trim();
  const ownerName = input.ownerName.trim();
  const phone = input.phone.trim();
  const account = input.account.trim();
  if (!storeName) throw new Error("请输入门店名称");
  if (!ownerName) throw new Error("请输入老板姓名");
  if (!phone) throw new Error("请输入联系电话");
  if (!account) throw new Error("请输入老板登录账号");
  if (validDays <= 0) throw new Error("邀请码有效期必须大于 0 天");
  if (data.authUsers.some((user) => user.account === account)) throw new Error("登录账号已存在");
  const hasActiveInvite = (data.storeOwnerInvites ?? []).some((invite) => {
    if (invite.status !== "待加入") return false;
    if (invite.expiresAt && +new Date(invite.expiresAt) <= +new Date(createdAt)) return false;
    return invite.account === account || invite.storeName === storeName;
  });
  if (hasActiveInvite) throw new Error("该门店或账号已有待加入邀请");
  const invite: StoreOwnerInvite = {
    id: idFactory("oi"),
    storeName,
    ownerName,
    phone,
    address: input.address?.trim() || undefined,
    account,
    status: "待加入",
    inviteCode: createUniqueInviteCode(data, "boss", idFactory),
    createdBy: input.createdBy,
    createdAt,
    expiresAt: new Date(+new Date(createdAt) + validDays * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    ...data,
    storeOwnerInvites: [invite, ...(data.storeOwnerInvites ?? [])],
  };
}

export function revokeStaffInvite(
  data: AppData,
  input: RevokeStaffInviteInput,
  options: { now?: () => string } = {},
): AppData {
  const revokedAt = (options.now ?? nowIso)();
  const invite = data.staffInvites.find((item) => item.id === input.inviteId);
  if (!invite) throw new Error("邀请不存在");
  if (invite.status !== "待加入") throw new Error("只能作废待加入邀请");
  return {
    ...data,
    staffInvites: data.staffInvites.map((item) =>
      item.id === invite.id ? { ...item, status: "已作废", revokedAt, revokedBy: input.revokedBy } : item,
    ),
  };
}

export function joinStaffInvite(
  data: AppData,
  input: JoinInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const inviteCode = input.inviteCode.trim();
  const invite = data.staffInvites.find((item) => item.inviteCode === inviteCode && item.status === "待加入");
  if (!invite) throw new Error("邀请不存在或已失效");
  if (invite.expiresAt && +new Date(invite.expiresAt) <= +new Date(createdAt)) throw new Error("邀请码已过期");
  const staff = data.staff.find((item) => item.id === invite.staffId);
  if (!staff) throw new Error("员工不存在");
  if (!input.name.trim()) throw new Error("请输入姓名");
  if (!input.password) throw new Error("请输入密码");
  if (staff.accountId || data.authUsers.some((user) => user.staffId === staff.id)) throw new Error("该员工已开通账号");
  if (data.authUsers.some((user) => user.account === invite.account)) throw new Error("登录账号已存在");
  const userId = idFactory("u");
  const storeId = scopedStoreId(data, staff.storeId);
  return {
    ...data,
    authUsers: [
      {
        id: userId,
        storeId,
        name: input.name.trim() || staff.name,
        account: invite.account,
        password: input.password,
        role: invite.role,
        roleName: roleNameOf(invite.role),
        staffId: staff.id,
        status: "pending",
        createdAt,
      },
      ...data.authUsers,
    ],
    staff: data.staff.map((item) => (item.id === staff.id ? { ...item, storeId, name: input.name.trim() || item.name, accountId: userId } : item)),
    staffInvites: data.staffInvites.map((item) =>
      item.id === invite.id ? { ...item, status: "已加入", joinedAt: createdAt } : item,
    ),
  };
}

export function joinStoreOwnerInvite(
  data: AppData,
  input: JoinInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const inviteCode = input.inviteCode.trim().toUpperCase();
  const invite = (data.storeOwnerInvites ?? []).find((item) => item.inviteCode.trim().toUpperCase() === inviteCode && item.status === "待加入");
  const inviteIssuerId = invite?.createdBy ?? platformInviteIssuerId(data, inviteCode);
  if (!invite && !inviteIssuerId) throw new Error("邀请不存在或已失效");
  if (invite?.expiresAt && +new Date(invite.expiresAt) <= +new Date(createdAt)) throw new Error("邀请码已过期");
  const ownerName = input.name.trim() || invite?.ownerName || "";
  const storeName = (input.storeName ?? invite?.storeName ?? "").trim();
  const phone = (input.phone ?? invite?.phone ?? "").trim();
  const account = (input.account ?? invite?.account ?? "").trim();
  const address = (input.address ?? invite?.address ?? "").trim();
  if (!ownerName) throw new Error("请输入姓名");
  if (!storeName) throw new Error("请输入门店名称");
  if (!phone) throw new Error("请输入联系电话");
  if (!account) throw new Error("请输入老板登录账号");
  if (!input.password) throw new Error("请输入密码");
  if (data.authUsers.some((user) => user.account === account)) throw new Error("登录账号已存在");
  const hasPendingApplication = (data.storeOwnerApplications ?? []).some((application) => {
    if (application.status !== "待审批") return false;
    return application.account === account || application.phone === phone || application.storeName === storeName;
  });
  if (hasPendingApplication) throw new Error("该门店、手机号或账号已有待审批申请");
  const application: StoreOwnerApplication = {
    id: idFactory("soa"),
    inviteId: invite?.id,
    inviteIssuerId,
    inviteCode,
    storeName,
    ownerName,
    phone,
    address: address || undefined,
    account,
    password: input.password,
    status: "待审批",
    createdAt,
  };
  const nextData: AppData = {
    ...data,
    storeOwnerApplications: [application, ...(data.storeOwnerApplications ?? [])],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: "system",
        action: "门店申请提交",
        targetType: "storeOwnerApplication",
        targetId: application.id,
        summary: `${storeName} 提交门店开通申请`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
  return addSystemNotification(
    nextData,
    {
      title: "新的门店申请",
      desc: `${storeName} · ${ownerName} 提交开通申请`,
      view: "permissions",
      targetType: "storeOwnerApplication",
      targetId: application.id,
      audienceRoles: ["superadmin"],
    },
    { idFactory, now: () => createdAt },
  );
}

export function joinStoreStaffInvite(
  data: AppData,
  input: JoinInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const inviteCode = input.inviteCode.trim().toUpperCase();
  const issuerId = storeStaffInviteIssuerId(data, inviteCode);
  if (!issuerId) throw new Error("邀请不存在或已失效");
  const name = input.name.trim();
  const account = (input.account ?? "").trim();
  if (!name) throw new Error("请输入姓名");
  if (!account) throw new Error("请输入登录账号");
  if (!input.password) throw new Error("请输入密码");
  if (data.authUsers.some((user) => user.account === account)) throw new Error("登录账号已存在");
  const staffId = idFactory("s");
  const userId = idFactory("u");
  const storeId = storeIdForUser(data, data.authUsers.find((user) => user.id === issuerId) ?? { id: issuerId, role: "owner" as UserRole });
  return {
    ...data,
    staff: [
      {
        id: staffId,
        storeId,
        name,
        phone: account,
        role: "员工",
        status: "active",
        accountId: userId,
        hiredAt: businessDateOf(createdAt),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: userId,
        storeId,
        name,
        account,
        password: input.password,
        role: "therapist",
        roleName: roleNameOf("therapist"),
        staffId,
        status: "pending",
        createdAt,
      },
      ...data.authUsers,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId,
        action: "员工加入门店",
        targetType: "staff",
        targetId: staffId,
        summary: `${name} 通过门店员工邀请码加入`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function isStoreStaffInviteCode(data: AppData, inviteCode: string) {
  return Boolean(storeStaffInviteIssuerId(data, inviteCode));
}

export function decideStoreOwnerApplication(
  data: AppData,
  input: DecideStoreOwnerApplicationInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const decidedAt = (options.now ?? nowIso)();
  const application = (data.storeOwnerApplications ?? []).find((item) => item.id === input.applicationId);
  if (!application) throw new Error("门店申请不存在");
  if (application.status !== "待审批") throw new Error("该门店申请已处理");

  if (!input.approved) {
    return {
      ...data,
      storeOwnerApplications: (data.storeOwnerApplications ?? []).map((item) =>
        item.id === application.id
          ? { ...item, status: "已拒绝", decidedAt, decidedBy: input.userId, rejectReason: input.rejectReason?.trim() || "未通过" }
          : item,
      ),
      operationLogs: [
        {
          id: idFactory("op"),
          userId: input.userId,
          action: "门店申请拒绝",
          targetType: "storeOwnerApplication",
          targetId: application.id,
          summary: `${application.storeName} 门店开通申请未通过`,
          createdAt: decidedAt,
        },
        ...data.operationLogs,
      ],
    };
  }

  if (data.authUsers.some((user) => user.account === application.account)) throw new Error("登录账号已存在");
  if (data.storeProfiles.some((store) => store.phone === application.phone || store.name === application.storeName)) {
    throw new Error("该门店或手机号已开通");
  }
  const storeId = idFactory("store");
  const staffId = idFactory("s");
  const userId = idFactory("u");
  return {
    ...data,
    storeProfiles: [
      {
        id: storeId,
        name: application.storeName,
        phone: application.phone,
        address: application.address ?? "",
        businessHours: "10:00 - 21:00",
        roomNames: [],
        maintenanceRoomNames: [],
        maintenanceRoomCount: 0,
        status: "active",
        createdAt: decidedAt,
      },
      ...data.storeProfiles,
    ],
    staff: [
      {
        id: staffId,
        storeId,
        name: application.ownerName,
        phone: application.phone,
        role: "老板",
        status: "active",
        accountId: userId,
        hiredAt: decidedAt.slice(0, 10),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: userId,
        storeId,
        name: application.ownerName,
        account: application.account,
        password: application.password,
        role: "owner",
        roleName: roleNameOf("owner"),
        staffId,
        status: "active",
        createdAt: decidedAt,
      },
      ...data.authUsers,
    ],
    storeOwnerApplications: (data.storeOwnerApplications ?? []).map((item) =>
      item.id === application.id
        ? { ...item, status: "已通过", decidedAt, decidedBy: input.userId, storeId, staffId, userId }
        : item,
    ),
    storeOwnerInvites: (data.storeOwnerInvites ?? []).map((item) =>
      item.id === application.inviteId ? { ...item, status: "已加入", joinedAt: decidedAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "门店申请审批通过",
        targetType: "store",
        targetId: storeId,
        summary: `${application.storeName} 开通负责人账号`,
        createdAt: decidedAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function joinInviteByCode(
  data: AppData,
  input: JoinInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const inviteCode = input.inviteCode.trim().toUpperCase();
  if (
    platformInviteIssuerId(data, inviteCode)
    || (data.storeOwnerInvites ?? []).some((item) => item.inviteCode.trim().toUpperCase() === inviteCode && item.status === "待加入")
  ) {
    return joinStoreOwnerInvite(data, input, options);
  }
  if (isStoreStaffInviteCode(data, inviteCode)) {
    return joinStoreStaffInvite(data, input, options);
  }
  return joinStaffInvite(data, input, options);
}

export function accountForInvite(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return (data.storeOwnerInvites ?? []).find((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode)?.account
    ?? data.staffInvites.find((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode)?.account;
}

function normalizeCheckoutServiceIds(serviceId?: string, serviceIds?: string[]) {
  const rawIds = serviceIds?.length ? serviceIds : serviceId ? [serviceId] : [];
  return rawIds.map((id) => id.trim()).filter(Boolean);
}

function summarizeServiceQuantityLines(services: Service[]) {
  const counts = new Map<string, { name: string; quantity: number }>();
  services.forEach((service) => {
    const current = counts.get(service.id);
    counts.set(service.id, {
      name: service.name,
      quantity: (current?.quantity ?? 0) + 1,
    });
  });
  return Array.from(counts.values()).map((item) =>
    item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name,
  );
}

function serviceQuantityCounts(serviceIds: string[]) {
  const counts = new Map<string, number>();
  serviceIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return counts;
}

function memberCardRemainingForService(card: MemberCard, serviceId: string) {
  if (card.type === "储值卡") return Number.POSITIVE_INFINITY;
  if (card.serviceEntitlements?.length) {
    return memberCardServiceEntitlement(card, serviceId)?.remainingTimes ?? 0;
  }
  return memberCardSupportsService(card, serviceId) ? card.remainingTimes : 0;
}

function assertMemberCardServiceQuantityAvailable(card: MemberCard, serviceIds: string[], services: Service[]) {
  if (card.type === "储值卡") return;
  if (card.remainingTimes < serviceIds.length) throw new Error("会员卡次数不足");
  for (const [serviceId, requiredQuantity] of serviceQuantityCounts(serviceIds)) {
    if (!memberCardSupportsService(card, serviceId)) throw new Error("该次数卡不可用于当前项目");
    if (memberCardRemainingForService(card, serviceId) < requiredQuantity) {
      const serviceName = services.find((service) => service.id === serviceId)?.name ?? "当前项目";
      throw new Error(`${serviceName}剩余次数不足`);
    }
  }
}

export type MemberCardDebitPlanLine = {
  cardId: string;
  serviceId: string;
  quantity: number;
};

const memberCardDebitServiceNotePrefix = "扣卡项目:";

function memberCardDebitServiceNote(lines: MemberCardDebitPlanLine[]) {
  const serviceIds = lines.flatMap((line) => Array.from({ length: line.quantity }, () => line.serviceId));
  return `${memberCardDebitServiceNotePrefix}${serviceIds.join(",")}`;
}

function memberCardDebitPriority(card: MemberCard, serviceId: string) {
  const entitlement = memberCardServiceEntitlement(card, serviceId);
  const serviceSpecific = Boolean(entitlement) || card.serviceId === serviceId || Boolean(card.serviceIds?.includes(serviceId));
  const typePriority = card.type === "次数卡" ? 0 : card.type === "套餐卡" ? 1 : 2;
  const expiresAt = card.expiresAt ? +new Date(card.expiresAt) : Number.POSITIVE_INFINITY;
  return { serviceSpecific, typePriority, expiresAt };
}

function compareMemberCardDebitPriority(left: MemberCard, right: MemberCard, serviceId: string) {
  const a = memberCardDebitPriority(left, serviceId);
  const b = memberCardDebitPriority(right, serviceId);
  if (a.serviceSpecific !== b.serviceSpecific) return a.serviceSpecific ? -1 : 1;
  if (a.typePriority !== b.typePriority) return a.typePriority - b.typePriority;
  if (a.expiresAt !== b.expiresAt) return a.expiresAt - b.expiresAt;
  return memberCardRemainingForService(left, serviceId) - memberCardRemainingForService(right, serviceId);
}

type MemberCardDebitCapacityPool = {
  key: string;
  card: MemberCard;
  capacity: number;
  serviceId?: string;
};

type MemberCardDebitFlowEdge = {
  to: number;
  reverseIndex: number;
  capacity: number;
  initialCapacity: number;
};

function memberCardDebitPoolFlexibility(pool: MemberCardDebitCapacityPool) {
  if (pool.serviceId) return 1;
  const scopedServiceCount = new Set([...(pool.card.serviceIds ?? []), pool.card.serviceId ?? ""].filter(Boolean)).size;
  return scopedServiceCount > 0 ? scopedServiceCount : Number.MAX_SAFE_INTEGER;
}

function addMemberCardDebitFlowEdge(
  graph: MemberCardDebitFlowEdge[][],
  from: number,
  to: number,
  capacity: number,
) {
  const forward: MemberCardDebitFlowEdge = {
    to,
    reverseIndex: graph[to].length,
    capacity,
    initialCapacity: capacity,
  };
  const reverse: MemberCardDebitFlowEdge = {
    to: from,
    reverseIndex: graph[from].length,
    capacity: 0,
    initialCapacity: 0,
  };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function normalizeServiceCardSelections(selections: ServiceCardSelection[] | undefined) {
  const byServiceId = new Map<string, string>();
  (selections ?? []).forEach((selection) => {
    const serviceId = selection.serviceId?.trim();
    const cardId = selection.cardId?.trim();
    if (serviceId && cardId) byServiceId.set(serviceId, cardId);
  });
  return Array.from(byServiceId, ([serviceId, cardId]) => ({ serviceId, cardId }));
}

export function buildMemberCardDebitPlan(
  data: AppData,
  customerId: string,
  serviceIds: string[],
  preferredCardId?: string,
  serviceCardSelections?: ServiceCardSelection[],
): MemberCardDebitPlanLine[] {
  const selectedServiceIds = serviceIds.filter(Boolean);
  if (!customerId || selectedServiceIds.length === 0) return [];
  const preferredCardIdByServiceId = new Map(
    normalizeServiceCardSelections(serviceCardSelections).map((selection) => [selection.serviceId, selection.cardId]),
  );
  const cards = data.memberCards.filter((card) =>
    card.customerId === customerId
    && card.status === "正常"
    && card.type !== "储值卡"
    && card.type !== "折扣卡",
  );
  const requirements = serviceQuantityCounts(selectedServiceIds);
  const requiredServiceIds = Array.from(requirements.keys());
  const pools: MemberCardDebitCapacityPool[] = cards.flatMap((card) => {
    const entitlements = normalizeMemberCardServiceEntitlements(card.serviceEntitlements);
    if (entitlements.length > 0) {
      return entitlements
        .filter((entitlement) => entitlement.remainingTimes > 0 && requirements.has(entitlement.serviceId))
        .map((entitlement) => ({
          key: `${card.id}:${entitlement.serviceId}`,
          card,
          capacity: entitlement.remainingTimes,
          serviceId: entitlement.serviceId,
        }));
    }
    const capacity = Math.max(0, Math.floor(card.remainingTimes));
    return capacity > 0 && requiredServiceIds.some((serviceId) => memberCardSupportsService(card, serviceId))
      ? [{ key: card.id, card, capacity }]
      : [];
  });

  const sourceNode = 0;
  const serviceNodeOffset = 1;
  const poolNodeOffset = serviceNodeOffset + requiredServiceIds.length;
  const sinkNode = poolNodeOffset + pools.length;
  const graph: MemberCardDebitFlowEdge[][] = Array.from({ length: sinkNode + 1 }, () => []);
  const servicePoolEdges = new Map<string, Array<{ pool: MemberCardDebitCapacityPool; edge: MemberCardDebitFlowEdge }>>();

  requiredServiceIds.forEach((serviceId, serviceIndex) => {
    const serviceNode = serviceNodeOffset + serviceIndex;
    addMemberCardDebitFlowEdge(graph, sourceNode, serviceNode, requirements.get(serviceId) ?? 0);
    const eligiblePools = pools
      .map((pool, poolIndex) => ({ pool, poolIndex }))
      .filter(({ pool }) => pool.serviceId ? pool.serviceId === serviceId : memberCardSupportsService(pool.card, serviceId))
      .sort((left, right) => {
        const servicePreferredCardId = preferredCardIdByServiceId.get(serviceId) ?? preferredCardId;
        if (servicePreferredCardId) {
          if (left.pool.card.id === servicePreferredCardId && right.pool.card.id !== servicePreferredCardId) return -1;
          if (right.pool.card.id === servicePreferredCardId && left.pool.card.id !== servicePreferredCardId) return 1;
        }
        return memberCardDebitPoolFlexibility(left.pool) - memberCardDebitPoolFlexibility(right.pool)
          || compareMemberCardDebitPriority(left.pool.card, right.pool.card, serviceId)
          || left.pool.key.localeCompare(right.pool.key);
      });
    const edges = eligiblePools.map(({ pool, poolIndex }) => ({
      pool,
      edge: addMemberCardDebitFlowEdge(graph, serviceNode, poolNodeOffset + poolIndex, pool.capacity),
    }));
    servicePoolEdges.set(serviceId, edges);
  });
  pools.forEach((pool, poolIndex) => {
    addMemberCardDebitFlowEdge(graph, poolNodeOffset + poolIndex, sinkNode, pool.capacity);
  });

  const levels = new Array<number>(graph.length).fill(-1);
  const cursors = new Array<number>(graph.length).fill(0);
  const buildLevels = () => {
    levels.fill(-1);
    levels[sourceNode] = 0;
    const queue = [sourceNode];
    for (let index = 0; index < queue.length; index += 1) {
      const node = queue[index];
      graph[node].forEach((edge) => {
        if (edge.capacity <= 0 || levels[edge.to] >= 0) return;
        levels[edge.to] = levels[node] + 1;
        queue.push(edge.to);
      });
    }
    return levels[sinkNode] >= 0;
  };
  const pushFlow = (node: number, available: number): number => {
    if (node === sinkNode) return available;
    for (; cursors[node] < graph[node].length; cursors[node] += 1) {
      const edge = graph[node][cursors[node]];
      if (edge.capacity <= 0 || levels[edge.to] !== levels[node] + 1) continue;
      const pushed = pushFlow(edge.to, Math.min(available, edge.capacity));
      if (pushed <= 0) continue;
      edge.capacity -= pushed;
      graph[edge.to][edge.reverseIndex].capacity += pushed;
      return pushed;
    }
    return 0;
  };
  while (buildLevels()) {
    cursors.fill(0);
    while (pushFlow(sourceNode, Number.MAX_SAFE_INTEGER) > 0) {
      // Continue until this level graph cannot carry more project-card uses.
    }
  }

  return requiredServiceIds.flatMap((serviceId) =>
    (servicePoolEdges.get(serviceId) ?? []).flatMap(({ pool, edge }) => {
      const quantity = edge.initialCapacity - edge.capacity;
      return quantity > 0 ? [{ cardId: pool.card.id, serviceId, quantity }] : [];
    }),
  );
}

export function memberCardDebitPlanCoversServices(plan: MemberCardDebitPlanLine[], serviceIds: string[]) {
  const required = serviceQuantityCounts(serviceIds.filter(Boolean));
  const available = new Map<string, number>();
  plan.forEach((line) => available.set(line.serviceId, (available.get(line.serviceId) ?? 0) + line.quantity));
  return Array.from(required).every(([serviceId, quantity]) => (available.get(serviceId) ?? 0) >= quantity);
}

function projectCardsForServices(data: AppData, customerId: string, serviceIds: string[]) {
  const ids = serviceIds.filter(Boolean);
  return data.memberCards.filter((card) =>
    card.customerId === customerId
    && card.status === "正常"
    && card.type !== "储值卡"
    && card.type !== "折扣卡"
    && ids.some((serviceId) => memberCardCanUseForService(card, serviceId)),
  );
}

export function memberCardDebitPlanShortfalls(data: AppData, customerId: string, serviceIds: string[], plan: MemberCardDebitPlanLine[]) {
  const allocated = new Map<string, number>();
  plan.forEach((line) => allocated.set(line.serviceId, (allocated.get(line.serviceId) ?? 0) + line.quantity));
  return Array.from(serviceQuantityCounts(serviceIds.filter(Boolean)))
    .map(([serviceId, quantity]) => {
      const covered = allocated.get(serviceId) ?? 0;
      if (covered >= quantity) return "";
      const available = data.memberCards
        .filter((card) =>
          card.customerId === customerId
          && card.status === "正常"
          && card.type !== "储值卡"
          && card.type !== "折扣卡"
          && memberCardSupportsService(card, serviceId),
        )
        .reduce((sum, card) => sum + memberCardRemainingForService(card, serviceId), 0);
      const serviceName = data.services.find((service) => service.id === serviceId)?.name ?? "当前项目";
      return available >= quantity
        ? `${serviceName}与其他项目共用卡内次数，可分配${covered}次，本次需要${quantity}次`
        : `${serviceName}剩余次数不足；${serviceName}剩余${available}次，本次需要${quantity}次`;
    })
    .filter(Boolean);
}

export function checkoutOrder(
  data: AppData,
  input: CheckoutInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  let customerId = input.customerId ?? "";
  const guestName = (input.guestName ?? "").trim();
  const guestPhone = optionalMobilePhone(input.guestPhone, "客户电话必须为 11 位数字");
  const selectedServiceIds = normalizeCheckoutServiceIds(input.serviceId, input.serviceIds);
  const missingServiceId = selectedServiceIds.find((id) => !data.services.some((item) => item.id === id));
  if (missingServiceId) throw new Error("服务项目不存在");
  const selectedServices = selectedServiceIds
    .map((id) => data.services.find((item) => item.id === id))
    .filter((service): service is Service => Boolean(service));
  const selectedService = selectedServices[0];
  const serviceId = selectedService?.id ?? "";
  let selectedCustomer = customerId ? data.customers.find((item) => item.id === customerId) : undefined;
  const rawProductItems = input.productItems?.length
    ? input.productItems
    : input.productId
      ? [{ productId: input.productId, quantity: 1 }]
      : [];
  const rawGiftProductItems = input.giftProductItems?.length
    ? input.giftProductItems
    : input.giftProductId
      ? [{ productId: input.giftProductId, quantity: 1 }]
      : [];
  const productItems = normalizeCheckoutProductItems(data, rawProductItems);
  const giftProductItems = normalizeCheckoutProductItems(data, rawGiftProductItems, { gift: true });
  const selectedStaff = data.staff.find((item) => item.id === input.staffId);
  const productOnlyCheckout = Boolean(productItems.length > 0 && selectedServices.length === 0);
  assertActiveStaff(selectedStaff, productOnlyCheckout ? "收银人员不存在或已停用" : "服务人员不存在或已停用");
  const storeId = scopedStoreId(data, input.storeId ?? selectedStaff?.storeId ?? selectedCustomer?.storeId ?? selectedService?.storeId);
  (input.collaboratorStaffIds ?? []).forEach((staffId) => {
    const collaborator = data.staff.find((item) => item.id === staffId);
    assertActiveStaff(collaborator, "协作人员不存在或已停用");
  });

  if (customerId && !selectedCustomer) {
    throw new Error("客户不存在");
  }
  if (giftProductItems.length > 0 && productItems.length === 0) {
    throw new Error("赠品只能随商品开单");
  }
  if (selectedServices.length === 0 && productItems.length === 0) {
    throw new Error("请选择服务项目或商品");
  }
  const createdAt = currentTime();
  let createdCheckoutCustomer: Customer | undefined;
  if (!customerId) {
    if (!guestName) throw new Error("请填写客户姓名，收银完成后需要客户签名");
    const requiredGuestPhone = requireMobilePhone(input.guestPhone, "请填写 11 位客户手机号，收银完成后需要客户签名");
    const existingGuestCustomer = data.customers.find((customer) =>
      customer.phone === requiredGuestPhone && (customer.storeId ?? storeId) === storeId,
    );
    if (existingGuestCustomer) {
      customerId = existingGuestCustomer.id;
      selectedCustomer = existingGuestCustomer;
    } else {
      createdCheckoutCustomer = {
        id: idFactory("c"),
        storeId,
        name: guestName,
        phone: requiredGuestPhone,
        level: "普通会员",
        source: "收银新客",
        tags: ["新客"],
        lastVisit: createdAt,
      };
      customerId = createdCheckoutCustomer.id;
      selectedCustomer = createdCheckoutCustomer;
    }
  }
  const zeroPriceProductNames = productItems
    .filter((item) => item.unitPrice <= 0)
    .map((item) => data.products.find((product) => product.id === item.productId)?.name ?? "未命名商品");
  if (zeroPriceProductNames.length > 0) {
    throw new Error(`商品 ${zeroPriceProductNames.join("、")} 的售价为 0，请先到商品资料填写售价`);
  }

  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const explicitAppointment = input.appointmentId ? data.appointments.find((item) => item.id === input.appointmentId) : undefined;
  if (input.appointmentId && !explicitAppointment) {
    throw new Error("预约不存在");
  }
  const implicitAppointmentMatches = input.appointmentId ? [] : data.appointments
    .filter((item) => {
      if (item.status !== "已到店" && item.status !== "已完成") return false;
      if ((item.storeId ?? storeId) !== storeId) return false;
      if (item.customerId !== customerId || item.staffId !== input.staffId) return false;
      if (businessDateOf(item.startAt) !== businessDateOf(createdAt)) return false;
      if (!selectedServiceIds.every((id) => appointmentAllowsService(item, id))) return false;
      const appointmentStart = +new Date(item.startAt);
      const appointmentEnd = +appointmentEndAt(item, data.services);
      const checkoutTime = +new Date(createdAt);
      return Number.isFinite(checkoutTime) && checkoutTime >= appointmentStart - 30 * 60 * 1000 && checkoutTime <= appointmentEnd + 4 * 60 * 60 * 1000;
    })
    .sort((left, right) =>
      Math.abs(+new Date(createdAt) - +appointmentEndAt(left, data.services)) -
      Math.abs(+new Date(createdAt) - +appointmentEndAt(right, data.services)),
    );
  const alreadyCheckedOutImplicitAppointment = implicitAppointmentMatches.find((item) =>
    data.orders.some((order) => order.appointmentId === item.id && order.status !== "已退款"),
  );
  if (alreadyCheckedOutImplicitAppointment) {
    throw new Error("匹配到的预约已生成收银单，请勿重复开单");
  }
  const inferredAppointment = implicitAppointmentMatches.find((item) => item.status === "已到店");
  const appointment = explicitAppointment ?? inferredAppointment;
  if (appointment) {
    if (appointment.status !== "已到店") {
      throw new Error("只有已到店预约可以直接收银");
    }
    if (appointment.customerId !== customerId || appointment.staffId !== input.staffId || !selectedServiceIds.every((id) => appointmentAllowsService(appointment, id))) {
      throw new Error("收银信息与预约不一致");
    }
    if (data.orders.some((order) => order.appointmentId === appointment.id && order.status !== "已退款")) {
      throw new Error("该预约已生成收银单，请完成客户签名");
    }
  }

  const serviceCardSelections = normalizeServiceCardSelections(input.serviceCardSelections);
  serviceCardSelections.forEach((selection) => {
    if (!selectedServiceIds.includes(selection.serviceId)) {
      throw new Error("扣卡来源包含未选择的服务项目");
    }
    const selectedProjectCard = data.memberCards.find((card) => card.id === selection.cardId && card.customerId === customerId);
    if (
      !selectedProjectCard
      || selectedProjectCard.status !== "正常"
      || selectedProjectCard.type === "储值卡"
      || selectedProjectCard.type === "折扣卡"
      || !memberCardSupportsService(selectedProjectCard, selection.serviceId)
    ) {
      throw new Error("请选择当前项目可用的扣卡来源");
    }
  });
  const selectedCard = input.cardId
    ? data.memberCards.find((item) => item.id === input.cardId && item.customerId === customerId)
    : undefined;
  const serviceDebitPlan = selectedServiceIds.length
    ? buildMemberCardDebitPlan(data, customerId, selectedServiceIds, input.cardId, serviceCardSelections)
    : [];
  const serviceDebitPlanCoversOrder = memberCardDebitPlanCoversServices(serviceDebitPlan, selectedServiceIds);
  const relevantProjectCards = selectedServiceIds.length ? projectCardsForServices(data, customerId, selectedServiceIds) : [];
  if (input.payMethod === "会员卡") {
    if (!customerId) {
      throw new Error("新客不能使用会员卡支付");
    }
    if (selectedServices.length > 0 && relevantProjectCards.length > 0) {
      if (!serviceDebitPlanCoversOrder) {
        const shortfalls = memberCardDebitPlanShortfalls(data, customerId, selectedServiceIds, serviceDebitPlan);
        throw new Error(shortfalls.length ? `会员卡项目次数不足：${shortfalls.join("；")}` : "会员卡项目次数不足");
      }
    } else if (!selectedCard || selectedCard.status !== "正常") {
      throw new Error("请选择有效会员卡");
    } else if (selectedServices.length === 0 && selectedCard.type !== "储值卡") {
      throw new Error("次数卡或套餐卡只能用于服务项目");
    } else {
      assertMemberCardServiceQuantityAvailable(selectedCard, selectedServiceIds, data.services);
    }
  }

  const productSubtotal = productItems.reduce((sum, item) => sum + item.amount, 0);
  const serviceSubtotal = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const total = serviceSubtotal + productSubtotal;
  const discountAmount = input.discountAmount ?? 0;
  if (discountAmount < 0) {
    throw new Error("折扣金额无效");
  }
  const orderId = idFactory("o");
  const totalDiscount = discountAmount;
  if (totalDiscount >= total) {
    throw new Error("优惠金额无效");
  }
  const paidAmount = total - totalDiscount;
  if (input.payMethod !== "会员卡" && input.cardId) {
    if (!customerId) {
      throw new Error("新客不能选择扣卡来源");
    }
    if (!selectedCard || selectedCard.status !== "正常") {
      throw new Error("请选择有效会员卡");
    }
    if (selectedServices.length === 0) {
      throw new Error("扣卡来源只能用于服务项目");
    }
    if (selectedCard.type === "折扣卡") {
      throw new Error("折扣卡不能作为扣卡来源");
    }
    if (selectedCard.type === "储值卡" && selectedCard.balance < paidAmount) {
      throw new Error("会员卡余额不足");
    }
    assertMemberCardServiceQuantityAvailable(selectedCard, selectedServiceIds, data.services);
  }
  if (selectedCard?.type === "储值卡" && selectedCard.balance < paidAmount) {
    throw new Error("会员卡余额不足");
  }
  if (
    data.orders.some((order) =>
      isRecentDuplicateOrder(order, {
        appointmentId: appointment?.id,
        cardId: serviceDebitPlan[0]?.cardId ?? input.cardId,
        customerId,
        createdAt,
        discountAmount: totalDiscount,
        giftProductItems,
        guestName,
        guestPhone,
        paidAmount,
        payMethod: input.payMethod,
        productItems,
        serviceId,
        serviceIds: selectedServiceIds,
        staffId: input.staffId,
        totalAmount: total,
      }),
    )
  ) {
    throw new Error("检测到刚刚已生成相同订单，请勿重复提交");
  }
  const serviceConsumption = selectedServices.flatMap((service) => serviceInventoryConsumables(data, service));
  const serviceQuantityLines = summarizeServiceQuantityLines(selectedServices);
  const serviceNameSnapshot = serviceQuantityLines.join("、") || undefined;
  const orderCardId = serviceDebitPlan[0]?.cardId ?? input.cardId;
  const order: Order = {
    id: orderId,
    storeId,
    orderNo: `SO${Date.now().toString().slice(-8)}`,
    customerId,
    guestName: customerId ? undefined : guestName,
    guestPhone: customerId ? undefined : guestPhone,
    staffId: input.staffId,
    serviceId,
    serviceIds: selectedServiceIds.length ? selectedServiceIds : undefined,
    serviceName: serviceNameSnapshot,
    servicePrice: selectedServices.length ? serviceSubtotal : undefined,
    serviceConsumables: serviceConsumption,
    serviceCardSelections: serviceCardSelections.length ? serviceCardSelections : undefined,
    productId: productItems[0]?.productId,
    giftProductId: giftProductItems[0]?.productId,
    productItems: productItems.length ? withProductNameSnapshots(data, productItems) : undefined,
    giftProductItems: giftProductItems.length ? withProductNameSnapshots(data, giftProductItems) : undefined,
    cardId: orderCardId,
    totalAmount: total,
    paidAmount,
    discountAmount: totalDiscount,
    adjustmentReason: input.adjustmentReason,
    approvalId: input.approvalId,
    appointmentId: appointment?.id,
    payMethod: input.payMethod,
    status: "已支付",
    createdAt,
  };

  const serviceConsumptionByProduct = new Map<string, number>();
  const soldProductByProduct = new Map<string, number>();
  const giftProductByProduct = new Map<string, number>();
  const consumptionByProduct = new Map<string, number>();
  for (const item of serviceConsumption) {
    serviceConsumptionByProduct.set(item.productId, (serviceConsumptionByProduct.get(item.productId) ?? 0) + item.quantity);
    consumptionByProduct.set(item.productId, (consumptionByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const item of productItems) {
    soldProductByProduct.set(item.productId, (soldProductByProduct.get(item.productId) ?? 0) + item.quantity);
    consumptionByProduct.set(item.productId, (consumptionByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const item of giftProductItems) {
    giftProductByProduct.set(item.productId, (giftProductByProduct.get(item.productId) ?? 0) + item.quantity);
    consumptionByProduct.set(item.productId, (consumptionByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of consumptionByProduct) {
    const product = data.products.find((item) => item.id === productId);
    if (!product) throw new Error("商品不存在");
    if (product.stock < quantity) {
      const includesDirectProduct = (soldProductByProduct.get(productId) ?? 0) + (giftProductByProduct.get(productId) ?? 0) > 0;
      const nextStep = includesDirectProduct
        ? "请先补货，或减少本单销售/赠送数量。"
        : "如该商品不参与项目扣减，请在商品资料中设为“不扣库存”。";
      throw new Error(
        `${product.name} 库存不足：本单需 ${formatStockQuantity(quantity)}${product.unit || "件"}，当前 ${formatStockQuantity(product.stock)}${product.unit || "件"}。${nextStep}`,
      );
    }
  }

  const products = data.products.map((product) => {
    let delta = 0;
    delta -= consumptionByProduct.get(product.id) ?? 0;
    return delta ? { ...product, stock: roundStockQuantity(product.stock + delta) } : product;
  });
  let inventoryBatches = data.inventoryBatches ?? [];
  for (const [productId, quantity] of consumptionByProduct) {
    inventoryBatches = consumeInventoryBatches(inventoryBatches, productId, quantity);
  }

  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];
  const changedProducts = products.filter((product) => data.products.find((old) => old.id === product.id)?.stock !== product.stock);
  changedProducts.forEach((product) => {
    const previousProduct = data.products.find((item) => item.id === product.id);
    if (!previousProduct) return;
    inventoryLogs.unshift({
      id: idFactory("il"),
      storeId: product.storeId ?? storeId,
      productId: product.id,
      type: soldProductByProduct.has(product.id)
        ? "销售出库"
        : giftProductByProduct.has(product.id)
          ? "赠品出库"
          : "服务消耗",
      delta: roundStockQuantity(product.stock - previousProduct.stock),
      stockAfter: product.stock,
      note: [
        order.orderNo,
        serviceConsumptionByProduct.has(product.id) ? `服务消耗 ${serviceConsumptionByProduct.get(product.id)}` : "",
        soldProductByProduct.has(product.id) ? `销售 ${soldProductByProduct.get(product.id)}` : "",
        giftProductByProduct.has(product.id) ? `赠品 ${giftProductByProduct.get(product.id)}` : "",
      ].filter(Boolean).join(" · "),
      createdAt,
    });
  });

  const serviceDebitPlanByCard = new Map<string, string[]>();
  serviceDebitPlan.forEach((line) => {
    const ids = serviceDebitPlanByCard.get(line.cardId) ?? [];
    for (let index = 0; index < line.quantity; index += 1) ids.push(line.serviceId);
    serviceDebitPlanByCard.set(line.cardId, ids);
  });
  const shouldDebitProjectCardsNow = input.payMethod === "会员卡" && serviceDebitPlanCoversOrder && serviceDebitPlan.length > 0;
  const memberCards = data.memberCards.map((card) => {
    const projectServiceIds = serviceDebitPlanByCard.get(card.id) ?? [];
    if (shouldDebitProjectCardsNow && projectServiceIds.length > 0) {
      return projectServiceIds.reduce((nextCard, id) => updateMemberCardServiceTimes(nextCard, id, -1), card);
    }
    if (input.payMethod !== "会员卡" || card.id !== input.cardId || shouldDebitProjectCardsNow) return card;
    if (card.type === "储值卡") return { ...card, balance: Math.max(0, card.balance - paidAmount) };
    return selectedServiceIds.reduce((nextCard, id) => updateMemberCardServiceTimes(nextCard, id, -1), card);
  });

  const selectedCardAfterCheckout = memberCards.find((card) => card.id === input.cardId);
  const projectDebitTransactions: MemberCardTransaction[] = shouldDebitProjectCardsNow
    ? Array.from(serviceDebitPlan.reduce((groups, line) => {
        const lines = groups.get(line.cardId) ?? [];
        lines.push(line);
        groups.set(line.cardId, lines);
        return groups;
      }, new Map<string, MemberCardDebitPlanLine[]>()).entries()).flatMap<MemberCardTransaction>(([cardIdForTransaction, lines]) => {
        const debitedCard = memberCards.find((card) => card.id === cardIdForTransaction);
        if (!debitedCard) return [];
        const timesDelta = -lines.reduce((sum, line) => sum + line.quantity, 0);
        const serviceNote = lines
          .map((line) => `${data.services.find((service) => service.id === line.serviceId)?.name ?? "项目"} x${line.quantity}`)
          .join("、");
        return [{
          id: idFactory("mt"),
          storeId,
          memberCardId: debitedCard.id,
          orderId,
          staffId: input.staffId,
          type: "消费" as const,
          amountDelta: 0,
          timesDelta,
          balanceAfter: debitedCard.balance,
          remainingTimesAfter: debitedCard.remainingTimes,
          note: `${order.orderNo} · ${serviceNote} · ${memberCardDebitServiceNote(lines)}`,
          createdAt,
        }];
      })
    : [];
  const memberCardTransactions: MemberCardTransaction[] =
    projectDebitTransactions.length
      ? [...projectDebitTransactions, ...data.memberCardTransactions]
      : input.payMethod === "会员卡" && selectedCardAfterCheckout
      ? [
          {
            id: idFactory("mt"),
            storeId,
            memberCardId: selectedCardAfterCheckout.id,
            orderId,
            staffId: input.staffId,
            type: "消费",
            amountDelta: selectedCardAfterCheckout.type === "储值卡" ? -paidAmount : 0,
            timesDelta: selectedCardAfterCheckout.type === "储值卡" ? 0 : -selectedServiceIds.length,
            balanceAfter: selectedCardAfterCheckout.balance,
            remainingTimesAfter: selectedCardAfterCheckout.remainingTimes,
            note: order.orderNo,
            createdAt,
          },
          ...data.memberCardTransactions,
        ]
      : data.memberCardTransactions;
  const productCommissionBase = productSubtotal > 0 ? Math.round(paidAmount * (productSubtotal / total)) : 0;
  const serviceCommissionBase = Math.round(paidAmount) - productCommissionBase;
  const commissionStaffIds = uniqueIds([input.staffId, ...(input.collaboratorStaffIds ?? [])]);
  const serviceCommissionBaseAmounts = splitAmount(serviceCommissionBase, commissionStaffIds.length);
  const serviceCommissions = commissionStaffIds
    .map((staffId, index) =>
      commissionRecord(
        idFactory,
        staffId,
        orderId,
        "服务提成",
        serviceCommissionBaseAmounts[index],
        createdAt,
        staffCommissionRate(data, staffId),
        storeId,
      ),
    )
    .filter((item): item is Commission => Boolean(item));
  const salesCommission = commissionRecord(
    idFactory,
    input.staffId,
    orderId,
    "销售提成",
    productCommissionBase,
    createdAt,
    staffCommissionRate(data, input.staffId),
    storeId,
  );
  const commissions: Commission[] = salesCommission ? [salesCommission, ...serviceCommissions] : serviceCommissions;
  const signatureItems = [
    ...serviceQuantityLines,
    ...(order.productItems ?? []).map((item) => `${item.productName ?? "商品"} x${item.quantity}`),
    ...(order.giftProductItems ?? []).map((item) => `赠品 ${item.productName ?? "商品"} x${item.quantity}`),
  ].filter(Boolean);
  const checkoutSignature: CustomerSignature = {
    id: idFactory("sig"),
    storeId,
    token: idFactory("sign"),
    customerId,
    orderId,
    title: selectedService ? "服务完成确认签名" : "收银确认签名",
    content: `${selectedCustomer?.name ?? "客户"} 确认本次收银内容、支付金额和服务结果无误。内容：${signatureItems.join(" + ") || "收银"}，金额：${money(paidAmount)}，支付方式：${input.payMethod}。`,
    status: "待签名",
    requestedBy: input.requestedBy ?? input.staffId,
    createdAt,
    expiresAt: new Date(+new Date(createdAt) + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const checkoutCustomers = createdCheckoutCustomer ? [createdCheckoutCustomer, ...data.customers] : data.customers;
  return {
    ...data,
    products,
    inventoryBatches,
    memberCards,
    inventoryLogs,
    orders: [order, ...data.orders],
    memberCardTransactions,
    customers: checkoutCustomers.map((customer) => (customer.id === customerId ? { ...customer, lastVisit: createdAt, points: Math.max(0, (customer.points ?? 0) + Math.floor(paidAmount / 10)) } : customer)),
    appointments: appointment
      ? data.appointments.map((item) =>
          item.id === appointment.id
            ? { ...item, status: "已完成" as const, completedAt: createdAt, updatedAt: createdAt }
            : item,
        )
      : data.appointments,
    customerSignatures: [checkoutSignature, ...(data.customerSignatures ?? [])],
    commissions: [...commissions, ...data.commissions],
  };
}

export function refundOrder(
  data: AppData,
  input: RefundInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const order = data.orders.find((item) => item.id === input.orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.status === "已退款") {
    throw new Error("订单已退款");
  }

  if (input.storeId && order.storeId && input.storeId !== order.storeId) {
    throw new Error("订单不属于当前门店");
  }
  const storeId = scopedStoreId(data, order.storeId ?? input.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const { historicalRefundAmount, originalPaidAmount, remainingRefundAmount } = orderRefundAmounts(data, order);
  const refundAmount = roundMoneyValue(input.amount ?? remainingRefundAmount);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > remainingRefundAmount) {
    throw new Error("退款金额无效");
  }

  const cumulativeRefundAmount = roundMoneyValue(historicalRefundAmount + refundAmount);
  const isFinalRefund = cumulativeRefundAmount >= originalPaidAmount;
  const refundServiceConsumables = order.serviceConsumables ?? legacyOrderServiceInventoryConsumables(data, order);
  const refund: Refund = {
    id: idFactory("rf"),
    storeId,
    orderId: order.id,
    amount: refundAmount,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };

  const existingCommissionIds = new Set(data.commissions.map((item) => item.id));
  const refundCommissionAdjustments = data.commissions
    .filter((item) => item.orderId === order.id && isOriginalCommission(item))
    .map((item): Commission | undefined => {
      const adjustmentId = `cmr_${refund.id}_${item.id}`;
      if (existingCommissionIds.has(adjustmentId)) return undefined;
      const adjustment = commissionRefundAdjustmentToCreate(
        data,
        item,
        originalPaidAmount,
        historicalRefundAmount,
        cumulativeRefundAmount,
      );
      if (adjustment.amount <= 0) return undefined;
      return {
        id: adjustmentId,
        storeId: item.storeId ?? storeId,
        staffId: item.staffId,
        orderId: item.orderId,
        type: item.type,
        baseAmount: -adjustment.baseAmount,
        rate: item.rate,
        amount: -adjustment.amount,
        status: "待结算",
        createdAt,
      };
    })
    .filter((item): item is Commission => Boolean(item));

  let products = data.products;
  let inventoryBatches = data.inventoryBatches ?? [];
  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];

  const restoreProduct = (productId: string | undefined, quantity: number) => {
    if (!productId || quantity <= 0) return;
    products = products.map((product) => {
      if (product.id !== productId) return product;
      const stockAfter = product.stock + quantity;
      const batch = inventoryBatchRecord(idFactory, {
        storeId: product.storeId ?? storeId,
        productId,
        source: "退款回滚",
        quantity,
        unitCost: product.cost,
        createdAt,
        expiryAt: product.expiryAt,
      });
      if (batch) inventoryBatches = [batch, ...inventoryBatches];
      inventoryLogs.unshift({
        id: idFactory("il"),
        storeId: product.storeId ?? storeId,
        productId,
        type: "退款回滚",
        delta: quantity,
        stockAfter,
        note: order.orderNo,
        createdAt,
      });
      return { ...product, stock: stockAfter };
    });
  };

  if (isFinalRefund) {
    refundServiceConsumables.forEach((item) => restoreProduct(item.productId, item.quantity));
    if (order.productItems?.length) {
      order.productItems.forEach((item) => restoreProduct(item.productId, item.quantity));
    } else {
      restoreProduct(order.productId, order.productId ? 1 : 0);
    }
    if (order.giftProductItems?.length) {
      order.giftProductItems.forEach((item) => restoreProduct(item.productId, item.quantity));
    } else {
      restoreProduct(order.giftProductId, order.giftProductId ? 1 : 0);
    }
  }

  let memberCards = data.memberCards;
  let memberCardTransactions = data.memberCardTransactions;
  if (order.payMethod === "会员卡") {
    const consumptionTransactions = data.memberCardTransactions.filter(
      (transaction) => transaction.orderId === order.id && transaction.type === "消费",
    );
    const priorRefundTransactions = data.memberCardTransactions.filter(
      (transaction) => transaction.orderId === order.id && transaction.type === "退款",
    );
    const legacyCard = !consumptionTransactions.length && order.cardId
      ? data.memberCards.find((card) => card.id === order.cardId)
      : undefined;
    const transactionsToRefund: MemberCardTransaction[] = consumptionTransactions.length
      ? consumptionTransactions
      : legacyCard
        ? [
            {
              id: "",
              storeId,
              memberCardId: legacyCard.id,
              orderId: order.id,
              staffId: order.staffId,
              type: "消费",
              amountDelta: legacyCard.type === "储值卡" ? -originalPaidAmount : 0,
              timesDelta: legacyCard.type === "储值卡"
                ? 0
                : -(order.serviceIds?.length ? order.serviceIds.length : order.serviceId ? 1 : 0),
              balanceAfter: legacyCard.balance,
              remainingTimesAfter: legacyCard.remainingTimes,
              note: order.orderNo,
              createdAt: order.createdAt,
            },
          ]
        : [];

    if (transactionsToRefund.some((transaction) => transaction.timesDelta < 0) && !isFinalRefund) {
      throw new Error("次数卡订单只支持全额退款");
    }

    const refundTransactions: MemberCardTransaction[] = [];
    let remainingStoredValueRefund = refundAmount;
    let hasStoredValueConsumption = false;
    memberCards = data.memberCards.map((card) => {
      const cardConsumptionTransactions = transactionsToRefund.filter((transaction) => transaction.memberCardId === card.id);
      if (!cardConsumptionTransactions.length) return card;

      if (card.type === "储值卡") {
        hasStoredValueConsumption = true;
        const consumedAmount = roundMoneyValue(
          cardConsumptionTransactions.reduce((sum, transaction) => sum + Math.max(0, -transaction.amountDelta), 0),
        );
        const alreadyRefundedAmount = roundMoneyValue(
          priorRefundTransactions
            .filter((transaction) => transaction.memberCardId === card.id)
            .reduce((sum, transaction) => sum + Math.max(0, transaction.amountDelta), 0),
        );
        const refundableAmount = roundMoneyValue(Math.max(0, consumedAmount - alreadyRefundedAmount));
        const amountDelta = roundMoneyValue(Math.min(refundableAmount, remainingStoredValueRefund));
        if (amountDelta <= 0) return card;

        remainingStoredValueRefund = roundMoneyValue(remainingStoredValueRefund - amountDelta);
        const nextCard = { ...card, balance: roundMoneyValue(card.balance + amountDelta) };
        refundTransactions.push({
          id: idFactory("mt"),
          storeId,
          memberCardId: card.id,
          orderId: order.id,
          staffId: order.staffId,
          type: "退款",
          amountDelta,
          timesDelta: 0,
          balanceAfter: nextCard.balance,
          remainingTimesAfter: nextCard.remainingTimes,
          note: `${order.orderNo} 退款`,
          createdAt,
        });
        return nextCard;
      }

      let nextCard = card;
      cardConsumptionTransactions.forEach((transaction) => {
        const refundedServiceIds = memberCardTransactionServiceIds(data, order, transaction, card);
        nextCard = refundedServiceIds.reduce((currentCard, serviceId) => updateMemberCardServiceTimes(currentCard, serviceId, 1), nextCard);
        refundTransactions.push({
          id: idFactory("mt"),
          storeId,
          memberCardId: card.id,
          orderId: order.id,
          staffId: order.staffId,
          type: "退款",
          amountDelta: 0,
          timesDelta: refundedServiceIds.length,
          balanceAfter: nextCard.balance,
          remainingTimesAfter: nextCard.remainingTimes,
          note: `${order.orderNo} 退款`,
          createdAt,
        });
      });
      return nextCard;
    });
    if (hasStoredValueConsumption && remainingStoredValueRefund > 0) {
      throw new Error("会员卡可退余额不足，请核对历史退款流水");
    }
    memberCardTransactions = [...refundTransactions, ...memberCardTransactions];
  }

  return {
    ...data,
    products,
    inventoryBatches,
    memberCards,
    memberCardTransactions,
    customers: isFinalRefund && order.customerId
      ? data.customers.map((customer) =>
          customer.id === order.customerId
            ? { ...customer, points: Math.max(0, (customer.points ?? 0) - Math.floor(originalPaidAmount / 10)) }
            : customer,
        )
      : data.customers,
    inventoryLogs,
    refunds: [refund, ...data.refunds],
    orders: data.orders.map((item) =>
      item.id === order.id
        ? {
            ...item,
            paidAmount: roundMoneyValue(Math.max(0, originalPaidAmount - cumulativeRefundAmount)),
            status: isFinalRefund ? "已退款" : "部分退款",
          }
        : item,
    ),
    appointments: isFinalRefund && order.appointmentId
      ? data.appointments.map((appointment) =>
          appointment.id === order.appointmentId && appointment.status === "已完成"
            ? { ...appointment, status: "已到店" as const, completedAt: undefined, updatedAt: createdAt }
            : appointment,
        )
      : data.appointments,
    customerSignatures: isFinalRefund
      ? (data.customerSignatures ?? []).map((signature) =>
          signature.orderId === order.id && signature.status !== "已作废"
            ? { ...signature, status: "已作废" as const }
            : signature,
        )
      : data.customerSignatures,
    commissions: [...refundCommissionAdjustments, ...data.commissions],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "订单退款",
        targetType: "order",
        targetId: order.id,
        summary: `${order.orderNo} ${isFinalRefund ? "全额退款" : "部分退款"} ${refund.amount} 元：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function orderRefundAmounts(
  data: Pick<AppData, "refunds">,
  order: Pick<Order, "id" | "paidAmount">,
) {
  const historicalRefundAmount = roundMoneyValue(
    data.refunds
      .filter((item) => item.orderId === order.id)
      .reduce((sum, item) => sum + Math.max(0, item.amount), 0),
  );
  const originalPaidAmount = roundMoneyValue(Math.max(0, order.paidAmount) + historicalRefundAmount);
  return {
    historicalRefundAmount,
    originalPaidAmount,
    remainingRefundAmount: roundMoneyValue(Math.max(0, originalPaidAmount - historicalRefundAmount)),
  };
}

function isOriginalCommission(commission: Commission) {
  return commission.baseAmount >= 0 && commission.amount >= 0 && !commission.id.startsWith("cmr_");
}

export function originalCommissionAmount(commission: Commission) {
  if (commission.rate > 0 && commission.baseAmount > 0) {
    return Math.max(0, Math.round(commission.baseAmount * commission.rate));
  }
  return Math.max(0, commission.amount);
}

function commissionRefundAdjustment(
  commission: Commission,
  originalPaidAmount: number,
  refundedBefore: number,
  refundedAfter: number,
) {
  if (originalPaidAmount <= 0) return { amount: 0, baseAmount: 0 };
  const remainingBefore = Math.max(0, originalPaidAmount - Math.min(originalPaidAmount, refundedBefore));
  const remainingAfter = Math.max(0, originalPaidAmount - Math.min(originalPaidAmount, refundedAfter));
  const originalAmount = originalCommissionAmount(commission);
  const commissionBefore = Math.round(originalAmount * (remainingBefore / originalPaidAmount));
  const commissionAfter = Math.round(originalAmount * (remainingAfter / originalPaidAmount));
  const baseBefore = roundMoneyValue(Math.max(0, commission.baseAmount) * (remainingBefore / originalPaidAmount));
  const baseAfter = roundMoneyValue(Math.max(0, commission.baseAmount) * (remainingAfter / originalPaidAmount));
  return {
    amount: Math.max(0, commissionBefore - commissionAfter),
    baseAmount: roundMoneyValue(Math.max(0, baseBefore - baseAfter)),
  };
}

function commissionAdjustmentMatchesOriginal(adjustment: Commission, original: Commission) {
  return adjustment.orderId === original.orderId
    && adjustment.amount < 0
    && adjustment.id.startsWith("cmr_")
    && adjustment.id.endsWith(`_${original.id}`);
}

function commissionSettlementTime(data: Pick<AppData, "commissionSettlements">, commission: Commission) {
  if (commission.status === "待结算") return undefined;
  const settlement = data.commissionSettlements.find((candidate) =>
    candidate.id === commission.settlementId && candidate.commissionIds.includes(commission.id));
  if (!settlement) return undefined;
  const value = commission.settledAt ?? settlement.createdAt;
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function refundHasOwnCommissionAdjustment(
  data: Pick<AppData, "commissions">,
  commission: Commission,
  refund: Refund,
) {
  const refundPrefix = `cmr_${refund.id}_`;
  return data.commissions.some((adjustment) =>
    commissionAdjustmentMatchesOriginal(adjustment, commission)
      && adjustment.id.startsWith(refundPrefix));
}

function commissionRemainingAfterRefund(
  commission: Commission,
  originalPaidAmount: number,
  refundedAmount: number,
) {
  if (originalPaidAmount <= 0) return { amount: 0, baseAmount: 0 };
  const remainingRatio = Math.max(
    0,
    originalPaidAmount - Math.min(originalPaidAmount, Math.max(0, refundedAmount)),
  ) / originalPaidAmount;
  return {
    amount: Math.round(originalCommissionAmount(commission) * remainingRatio),
    baseAmount: roundMoneyValue(Math.max(0, commission.baseAmount) * remainingRatio),
  };
}

function commissionRefundAdjustmentToCreate(
  data: Pick<AppData, "commissions" | "commissionSettlements" | "refunds">,
  commission: Commission,
  originalPaidAmount: number,
  refundedBefore: number,
  refundedAfter: number,
) {
  const settledAt = commissionSettlementTime(data, commission);
  if (!settledAt) {
    return commissionRefundAdjustment(commission, originalPaidAmount, refundedBefore, refundedAfter);
  }

  // Legacy releases rewrote the positive commission row on refund. When the
  // commission had already been settled, continuing the refund using only the
  // latest interval left the earlier paid amount unreversed. Rebuild the
  // cumulative target from the amount actually earned at settlement, then
  // subtract every existing negative adjustment. Refunds that happened before
  // settlement without their own cmr_ row were already reflected in the
  // positive amount paid by the legacy settlement and must not be reversed a
  // second time.
  const hasAmbiguousLegacyRefundBeforeSettlement = data.refunds.some((refund) =>
    refund.orderId === commission.orderId
      && refund.amount > 0
      && Date.parse(refund.createdAt) <= Date.parse(settledAt)
      && !refundHasOwnCommissionAdjustment(data, commission, refund));
  if (hasAmbiguousLegacyRefundBeforeSettlement) {
    // Old releases rounded each partial refund in sequence. Without an audit
    // row for those pre-settlement refunds, reconstructing the exact amount
    // paid can be off by one yuan. Keep the ordinary interval adjustment for
    // this ambiguous history rather than risk an automatic over-reversal.
    return commissionRefundAdjustment(commission, originalPaidAmount, refundedBefore, refundedAfter);
  }
  const atSettlement = commissionRemainingAfterRefund(
    commission,
    originalPaidAmount,
    0,
  );
  const afterCumulativeRefund = commissionRemainingAfterRefund(
    commission,
    originalPaidAmount,
    refundedAfter,
  );
  const cumulativeTarget = {
    amount: Math.max(0, atSettlement.amount - afterCumulativeRefund.amount),
    baseAmount: roundMoneyValue(Math.max(0, atSettlement.baseAmount - afterCumulativeRefund.baseAmount)),
  };
  const existingAdjustments = data.commissions.filter((adjustment) =>
    commissionAdjustmentMatchesOriginal(adjustment, commission));
  const alreadyReversed = {
    amount: existingAdjustments.reduce((sum, adjustment) => sum + Math.max(0, -adjustment.amount), 0),
    baseAmount: roundMoneyValue(
      existingAdjustments.reduce((sum, adjustment) => sum + Math.max(0, -adjustment.baseAmount), 0),
    ),
  };
  return {
    amount: Math.max(0, cumulativeTarget.amount - alreadyReversed.amount),
    baseAmount: roundMoneyValue(Math.max(0, cumulativeTarget.baseAmount - alreadyReversed.baseAmount)),
  };
}

export function commissionAccrualByStaff(
  periodData: Pick<AppData, "commissions" | "refunds">,
  referenceData: Pick<AppData, "commissions" | "orders" | "refunds">,
) {
  const result = new Map<string, number>();
  const add = (staffId: string, amount: number) => {
    if (!amount) return;
    result.set(staffId, (result.get(staffId) ?? 0) + amount);
  };

  periodData.commissions
    .filter(isOriginalCommission)
    .forEach((commission) => add(commission.staffId, originalCommissionAmount(commission)));

  const visibleRefundIds = new Set(periodData.refunds.map((refund) => refund.id));
  const commissionsByOrder = new Map<string, Commission[]>();
  referenceData.commissions.filter(isOriginalCommission).forEach((commission) => {
    const commissions = commissionsByOrder.get(commission.orderId) ?? [];
    commissions.push(commission);
    commissionsByOrder.set(commission.orderId, commissions);
  });
  const refundsByOrder = new Map<string, Refund[]>();
  referenceData.refunds.forEach((refund) => {
    const refunds = refundsByOrder.get(refund.orderId) ?? [];
    refunds.push(refund);
    refundsByOrder.set(refund.orderId, refunds);
  });
  const orderById = new Map(referenceData.orders.map((order) => [order.id, order]));
  refundsByOrder.forEach((refunds, orderId) => {
    const order = orderById.get(orderId);
    if (!order) return;
    const sortedRefunds = [...refunds].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const originalPaidAmount = roundMoneyValue(
      Math.max(0, order.paidAmount) + sortedRefunds.reduce((sum, refund) => sum + Math.max(0, refund.amount), 0),
    );
    let refundedBefore = 0;
    sortedRefunds.forEach((refund) => {
      const refundedAfter = roundMoneyValue(Math.min(originalPaidAmount, refundedBefore + Math.max(0, refund.amount)));
      if (visibleRefundIds.has(refund.id)) {
        (commissionsByOrder.get(orderId) ?? []).forEach((commission) => {
          const adjustment = commissionRefundAdjustment(commission, originalPaidAmount, refundedBefore, refundedAfter);
          add(commission.staffId, -adjustment.amount);
        });
      }
      refundedBefore = refundedAfter;
    });
  });

  return result;
}

export function commissionAccrualAmount(
  periodData: Pick<AppData, "commissions" | "refunds">,
  referenceData: Pick<AppData, "commissions" | "orders" | "refunds">,
) {
  return Array.from(commissionAccrualByStaff(periodData, referenceData).values())
    .reduce((sum, amount) => sum + amount, 0);
}

export function openMemberCard(
  data: AppData,
  input: OpenMemberCardInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const serviceEntitlements = normalizeMemberCardServiceEntitlements(input.serviceEntitlements);
  const serviceIds = Array.from(new Set([
    input.serviceId,
    ...(input.serviceIds ?? []),
    ...serviceEntitlements.map((item) => item.serviceId),
  ].map((id) => trimText(id)).filter(Boolean)));
  const remainingTimes = serviceEntitlements.length
    ? memberCardEntitlementRemainingTimes(serviceEntitlements)
    : positiveNumber(input.remainingTimes);
  const requestedType = input.type;
  const cardType = requestedType === "套餐卡" || requestedType === "次数卡" || requestedType === "储值卡" || requestedType === "折扣卡"
    ? requestedType
    : remainingTimes > 0 && serviceIds.length > 1
      ? "套餐卡"
      : remainingTimes > 0
        ? "次数卡"
        : "储值卡";
  const cardName = trimText(input.name) || (cardType === "储值卡" ? "储值卡" : cardType === "折扣卡" ? "会员折扣卡" : "");
  if (!cardName) throw new Error("请填写卡名称");
  const balance = cardType === "储值卡" ? positiveNumber(input.balance) : 0;
  const paidAmount = positiveNumber(input.paidAmount, cardType === "储值卡" ? balance : 0);
  const payMethod = normalizeCashPayMethod(input.payMethod);
  const expiresAt = trimText(input.expiresAt) || "2027-12-31";
  const discountRate = cardType === "折扣卡" ? positiveNumber(input.discountRate, 0.9) : undefined;

  if (paidAmount <= 0) throw new Error("开卡需要填写实收金额");
  if (cardType === "储值卡" && balance <= 0) throw new Error("储值卡需要填写到账余额");
  if ((cardType === "次数卡" || cardType === "套餐卡") && remainingTimes <= 0) throw new Error("次数卡和套餐卡需要填写可用次数");
  if ((cardType === "次数卡" || cardType === "套餐卡") && serviceIds.length === 0) throw new Error("请选择可用项目");
  if (cardType === "折扣卡" && (!discountRate || discountRate <= 0 || discountRate >= 1)) throw new Error("折扣卡折扣必须在 1 折到 9.9 折之间");

  let customerId = input.customerId;
  let customers = data.customers;
  const existingCustomer = customerId ? data.customers.find((customer) => customer.id === customerId) : undefined;
  const storeId = scopedStoreId(data, input.storeId ?? existingCustomer?.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  if (!existingCustomer) {
    const customerName = trimText(input.customerName);
    const rawCustomerPhone = trimText(input.customerPhone);
    if (!customerName || !rawCustomerPhone) throw new Error("开卡需要登记客户姓名和手机号");
    const customerPhone = requireMobilePhone(input.customerPhone, "客户手机号必须为 11 位数字");
    const customerBirthday = trimText(input.customerBirthday);
    const customerNote = trimText(input.customerNote);
    const matchedCustomer = data.customers.find((customer) => customer.phone === customerPhone);
    if (matchedCustomer) {
      customerId = matchedCustomer.id;
    } else {
      customerId = idFactory("c");
      const customer: Customer = {
        id: customerId,
        storeId,
        name: customerName,
        phone: customerPhone,
        level: "普通会员",
        source: "开卡登记",
        tags: ["新客", "会员"],
        birthday: customerBirthday || undefined,
        note: customerNote || undefined,
        lastVisit: createdAt,
      };
      customers = [customer, ...customers];
    }
  }

  if (!customerId) throw new Error("开卡客户不存在");
  const pointsEarned = Math.floor(paidAmount / 10);
  const taggedCustomers = customers.map((customer) =>
    customer.id === customerId
      ? { ...customer, storeId: customer.storeId ?? storeId, tags: Array.from(new Set([...(customer.tags ?? []), "会员"])), points: Math.max(0, (customer.points ?? 0) + pointsEarned), lastVisit: createdAt }
      : customer,
  );
  const cardId = idFactory("m");
  const signatureId = idFactory("sig");
  const noteText = [cardName, trimText(input.note)].filter(Boolean).join("：");
  const entitlementText = cardType === "储值卡"
    ? `到账余额：${money(balance)}`
    : cardType === "折扣卡"
      ? `折扣权益：${Number(((discountRate ?? 1) * 10).toFixed(1))} 折`
      : `可用项目：${serviceIds.map((id) => data.services.find((service) => service.id === id)?.name ?? "项目").join("、") || "未指定"}；总次数：${remainingTimes} 次`;

  return {
    ...data,
    customers: taggedCustomers,
    memberCards: [
      {
        id: cardId,
        storeId,
        customerId,
        name: cardName,
        type: cardType,
        balance,
        remainingTimes,
        discountRate,
        pointsEarned,
        benefitText: trimText(input.benefitText) || (cardType === "折扣卡" ? `${Number(((discountRate ?? 1) * 10).toFixed(1))} 折权益` : undefined),
        expiresAt,
        status: "正常",
        serviceId: cardType === "次数卡" || cardType === "套餐卡" ? serviceIds[0] : undefined,
        serviceIds: cardType === "次数卡" || cardType === "套餐卡" ? serviceIds : undefined,
        serviceEntitlements: (cardType === "次数卡" || cardType === "套餐卡") && serviceEntitlements.length
          ? serviceEntitlements
          : undefined,
      },
      ...data.memberCards,
    ],
    customerSignatures: [
      {
        id: signatureId,
        storeId,
        token: idFactory("sign"),
        customerId,
        title: "开卡确认签名",
        content: `${taggedCustomers.find((customer) => customer.id === customerId)?.name ?? "客户"} 确认本次开卡内容、支付金额和会员权益无误。卡名称：${cardName}，卡类型：${cardType}，实收：${money(paidAmount)}，支付方式：${payMethod}，${entitlementText}，有效期至：${expiresAt}。`,
        status: "待签名",
        requestedBy: input.userId,
        createdAt,
        expiresAt: new Date(+new Date(createdAt) + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      ...(data.customerSignatures ?? []),
    ],
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: cardId,
        staffId: trimText(input.staffId) || undefined,
        type: "开卡",
        paidAmount,
        payMethod,
        amountDelta: balance,
        timesDelta: remainingTimes,
        balanceAfter: balance,
        remainingTimesAfter: remainingTimes,
        note: noteText,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "开卡",
        targetType: "memberCard",
        targetId: cardId,
        summary: `${cardName} 实收 ${paidAmount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function memberCardCashIn(transaction: MemberCardTransaction) {
  if (transaction.type !== "开卡" && transaction.type !== "充值") return 0;
  if (typeof transaction.paidAmount === "number" && Number.isFinite(transaction.paidAmount)) {
    return Math.max(0, transaction.paidAmount);
  }
  return Math.max(0, transaction.amountDelta);
}

export function memberCardCashRefund(transaction: MemberCardTransaction) {
  if (transaction.type !== "退卡" && transaction.type !== "退款" && transaction.type !== "作废") return 0;
  if (typeof transaction.paidAmount === "number" && Number.isFinite(transaction.paidAmount)) {
    return Math.max(0, transaction.paidAmount);
  }
  return Math.max(0, -transaction.amountDelta);
}

export type MemberCardVoidEligibility = {
  eligible: boolean;
  reason: string;
  openingTransaction?: MemberCardTransaction;
};

export function memberCardIsClosed(card: MemberCard) {
  return card.status === "已退卡" || card.status === "已作废";
}

export function memberCardVoidEligibility(card: MemberCard, transactions: MemberCardTransaction[]): MemberCardVoidEligibility {
  if (memberCardIsClosed(card)) {
    return { eligible: false, reason: card.status === "已作废" ? "该卡已经作废" : "该卡已经退卡" };
  }
  const cardTransactions = transactions.filter((transaction) => transaction.memberCardId === card.id);
  const openingTransactions = cardTransactions.filter((transaction) => transaction.type === "开卡");
  if (openingTransactions.length !== 1) {
    return { eligible: false, reason: openingTransactions.length ? "存在多条开卡流水，需要人工核查" : "缺少开卡流水，请走正式退卡流程" };
  }
  const openingTransaction = openingTransactions[0];
  const blockingTransaction = cardTransactions.find((transaction) =>
    transaction.type !== "开卡" && transaction.type !== "冻结" && transaction.type !== "解冻",
  );
  if (blockingTransaction) {
    return { eligible: false, reason: `已有${blockingTransaction.type}流水，不能按错录作废`, openingTransaction };
  }
  if (card.balance !== openingTransaction.balanceAfter || card.remainingTimes !== openingTransaction.remainingTimesAfter) {
    return { eligible: false, reason: "当前余额或次数已经变化，请走正式退卡流程", openingTransaction };
  }
  if (card.serviceEntitlements?.length) {
    const entitlementRemaining = memberCardEntitlementRemainingTimes(card.serviceEntitlements);
    if (entitlementRemaining !== card.remainingTimes) {
      return { eligible: false, reason: "分项目次数与卡总次数不一致，需要人工核查", openingTransaction };
    }
  }
  return { eligible: true, reason: "未发生消费、充值、调整或转卡，可按错录作废", openingTransaction };
}

export function voidMemberCardOpening(
  data: AppData,
  input: VoidMemberCardOpeningInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card) throw new Error("会员卡不存在");
  const reason = trimText(input.reason);
  if (reason.length < 4) throw new Error("请填写至少4个字的错录原因");
  const eligibility = memberCardVoidEligibility(card, data.memberCardTransactions);
  if (!eligibility.eligible || !eligibility.openingTransaction) throw new Error(eligibility.reason);

  const openingTransaction = eligibility.openingTransaction;
  const reversedPaidAmount = memberCardCashIn(openingTransaction);
  const reversedPoints = Math.max(0, card.pointsEarned ?? Math.floor(reversedPaidAmount / 10));
  const customer = data.customers.find((item) => item.id === card.customerId);
  if (!customer) throw new Error("开卡客户不存在，不能直接作废");
  if ((customer.points ?? 0) < reversedPoints) {
    throw new Error("该卡赠送积分已被使用，请先核对积分后走正式退卡流程");
  }
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));
  const voidedCard: MemberCard = {
    ...card,
    balance: 0,
    remainingTimes: 0,
    status: "已作废",
    serviceEntitlements: card.serviceEntitlements?.map((entitlement) => ({ ...entitlement, remainingTimes: 0 })),
  };

  return {
    ...data,
    customers: reversedPoints > 0
      ? data.customers.map((customer) => customer.id === card.customerId
        ? { ...customer, points: Math.max(0, (customer.points ?? 0) - reversedPoints) }
        : customer)
      : data.customers,
    memberCards: data.memberCards.map((item) => item.id === card.id ? voidedCard : item),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: "作废",
        paidAmount: reversedPaidAmount > 0 ? reversedPaidAmount : undefined,
        payMethod: reversedPaidAmount > 0 ? openingTransaction.payMethod : undefined,
        amountDelta: -card.balance,
        timesDelta: -card.remainingTimes,
        balanceAfter: 0,
        remainingTimesAfter: 0,
        note: `错录开卡作废：${reason} · 原开卡流水 ${openingTransaction.id}`,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "开卡错录作废",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 错录作废：冲销实收 ${reversedPaidAmount} 元、次数 ${card.remainingTimes} 次、积分 ${reversedPoints}，原因：${reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export type MemberCardRefundQuote = {
  paidAmount: number;
  purchasedTimes: number;
  usedTimes: number;
  remainingTimes: number;
  unitDeduction: number;
  usedDeduction: number;
  refundableAmount: number;
};

function roundMoneyValue(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateMemberCardRefundQuote(card: MemberCard, transactions: MemberCardTransaction[]): MemberCardRefundQuote {
  const cardTransactions = transactions.filter((transaction) => transaction.memberCardId === card.id);
  const paidAmount = roundMoneyValue(cardTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0));
  const purchasedTimes = cardTransactions.reduce((sum, transaction) => sum + Math.max(0, transaction.timesDelta), 0);
  const remainingTimes = Math.max(0, card.remainingTimes);
  const usedTimes = Math.max(0, purchasedTimes - remainingTimes);
  const unitDeduction = purchasedTimes > 0 ? roundMoneyValue(paidAmount / purchasedTimes) : 0;
  const usedDeduction = roundMoneyValue(Math.min(paidAmount, usedTimes * unitDeduction));
  const timeBasedRefund = Math.max(0, paidAmount - usedDeduction);
  const refundableAmount = purchasedTimes > 0 ? roundMoneyValue(timeBasedRefund) : roundMoneyValue(Math.max(0, card.balance));

  return {
    paidAmount,
    purchasedTimes,
    usedTimes,
    remainingTimes,
    unitDeduction,
    usedDeduction,
    refundableAmount,
  };
}

export function refundMemberCard(
  data: AppData,
  input: RefundMemberCardInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);

  if (!card) {
    throw new Error("会员卡不存在");
  }

  if (memberCardIsClosed(card)) {
    throw new Error(card.status === "已作废" ? "会员卡已作废" : "会员卡已退卡");
  }

  const refundQuote = calculateMemberCardRefundQuote(card, data.memberCardTransactions);
  const refundAmount = positiveNumber(input.refundAmount, card.balance);
  if (refundQuote.purchasedTimes > 0 && refundAmount > refundQuote.refundableAmount) {
    throw new Error(`实退金额不能大于扣除已用次数后的可退金额 ${refundQuote.refundableAmount} 元`);
  }
  if (card.balance > 0 && refundAmount > card.balance) {
    throw new Error("实退金额不能大于当前余额");
  }
  const payMethod = refundAmount > 0 ? normalizeCashPayMethod(input.payMethod) : undefined;
  const signature = data.customerSignatures.find((item) => item.id === input.signatureId);
  if (!signature) {
    throw new Error("请先生成客户退费签名");
  }
  if (signature.customerId !== card.customerId) {
    throw new Error("退费签名不属于当前客户");
  }
  if (
    signature.title !== "会员卡退费确认签名"
    || !signature.content.includes(card.name)
    || !signature.content.includes(money(refundAmount))
    || Boolean(payMethod && !signature.content.includes(`退款方式${payMethod}`))
  ) {
    throw new Error("退费签名不属于当前会员卡");
  }
  if (signature.status !== "已签名") {
    throw new Error("请先完成客户退费签名");
  }
  if (signature.expiresAt && +new Date(signature.expiresAt) <= +new Date(createdAt)) {
    throw new Error("退费签名已过期");
  }

  const amountDelta = -card.balance;
  const timesDelta = -card.remainingTimes;
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));

  return {
    ...data,
    memberCards: data.memberCards.map((item) =>
      item.id === card.id ? {
        ...item,
        balance: 0,
        remainingTimes: 0,
        status: "已退卡",
        serviceEntitlements: item.serviceEntitlements?.map((entitlement) => ({ ...entitlement, remainingTimes: 0 })),
      } : item,
    ),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: "退卡",
        amountDelta,
        timesDelta,
        balanceAfter: 0,
        remainingTimesAfter: 0,
        paidAmount: refundAmount > 0 ? refundAmount : undefined,
        payMethod,
        note: `${input.reason} · 签名 ${signature.id}`,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "会员退卡",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 退卡：余额 ${card.balance}，次数 ${card.remainingTimes}，实退 ${refundAmount} 元，原因：${input.reason}，签名：${signature.id}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function createApprovalRequest(
  data: AppData,
  input: ApprovalRequestInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  if (input.type === "订单退款") {
    throw new Error("订单撤销无需审批，请返回收银流水直接撤销");
  }
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const storeId = scopedStoreId(data, input.storeId);
  const request: ApprovalRequest = {
    id: idFactory("ap"),
    storeId,
    type: input.type,
    targetId: input.targetId,
    requestedBy: input.requestedBy,
    amount: input.amount,
    reason: input.reason,
    status: "待审批",
    createdAt,
  };
  return {
    ...data,
    approvalRequests: [request, ...data.approvalRequests],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.requestedBy,
        action: "提交审批",
        targetType: "approvalRequest",
        targetId: request.id,
        summary: `${input.type} ${input.amount} 元：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function decideApprovalRequest(
  data: AppData,
  input: ApprovalDecisionInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const request = data.approvalRequests.find((item) => item.id === input.approvalId);
  if (!request) throw new Error("审批单不存在");
  if (request.status !== "待审批") throw new Error("审批单已处理");

  return {
    ...data,
    approvalRequests: data.approvalRequests.map((item) =>
      item.id === input.approvalId
        ? { ...item, status: input.approved ? "已通过" : "已拒绝", approvedBy: input.userId, approvedAt: createdAt }
        : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        storeId: request.storeId,
        userId: input.userId,
        action: input.approved ? "审批通过" : "审批拒绝",
        targetType: "approvalRequest",
        targetId: input.approvalId,
        summary: `${request.type} ${request.amount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function rechargeMemberCard(
  data: AppData,
  input: MemberCardRechargeInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || memberCardIsClosed(card)) throw new Error("会员卡不存在或不可充值");
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);

  const amountDelta = (input.amount ?? 0) + (input.giftAmount ?? 0);
  const timesDelta = (input.times ?? 0) + (input.giftTimes ?? 0);
  if (amountDelta <= 0 && timesDelta <= 0) throw new Error("充值金额或次数无效");
  const paidAmount = positiveNumber(input.paidAmount, amountDelta);
  const payMethod = paidAmount > 0 ? normalizeCashPayMethod(input.payMethod) : undefined;

  const nextCard = {
    ...card,
    balance: card.balance + amountDelta,
    remainingTimes: card.remainingTimes + timesDelta,
  };
  const pointsEarned = Math.floor(paidAmount / 10);

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? nextCard : item)),
    customers: pointsEarned > 0
      ? data.customers.map((customer) => (customer.id === card.customerId ? { ...customer, points: Math.max(0, (customer.points ?? 0) + pointsEarned), lastVisit: createdAt } : customer))
      : data.customers,
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: "充值",
        paidAmount: paidAmount > 0 ? paidAmount : undefined,
        payMethod,
        amountDelta,
        timesDelta,
        balanceAfter: nextCard.balance,
        remainingTimesAfter: nextCard.remainingTimes,
        note: input.note ?? "会员卡充值",
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "会员卡充值",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 充值 ${amountDelta} 元 / ${timesDelta} 次，实收 ${paidAmount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function updateMemberCardStatus(
  data: AppData,
  input: MemberCardStatusInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || memberCardIsClosed(card)) throw new Error("会员卡不存在或不可操作");
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, status: input.status } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: input.status === "冻结" ? "冻结" : "解冻",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
  };
}

export function extendMemberCard(
  data: AppData,
  input: MemberCardExtendInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || memberCardIsClosed(card)) throw new Error("会员卡不存在或不可延期");
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, expiresAt: input.expiresAt } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: "延期",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: `${input.reason}，延期至 ${input.expiresAt}`,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
  };
}

export function transferMemberCard(
  data: AppData,
  input: MemberCardTransferInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || memberCardIsClosed(card)) throw new Error("会员卡不存在或不可转卡");
  if (!data.customers.some((customer) => customer.id === input.toCustomerId)) throw new Error("转入客户不存在");
  const storeId = scopedStoreId(data, card.storeId ?? storeIdForCustomer(data, card.customerId));

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, customerId: input.toCustomerId } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        storeId,
        memberCardId: card.id,
        staffId: trimText(input.staffId) || undefined,
        type: "转卡",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "会员转卡",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 转给 ${input.toCustomerId}：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function addOperationLog(
  data: AppData,
  input: OperationLogInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const operationLog: OperationLog = {
    id: idFactory("op"),
    storeId: scopedStoreId(data, input.storeId ?? data.authUsers.find((user) => user.id === input.userId)?.storeId),
    userId: input.userId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    createdAt: currentTime(),
  };

  return {
    ...data,
    operationLogs: [operationLog, ...data.operationLogs],
  };
}

export function addSystemNotification(
  data: AppData,
  input: NotificationInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const notification: SystemNotification = {
    id: idFactory("ntf"),
    storeId: input.storeId ?? (input.staffId ? storeIdForStaff(data, input.staffId) : undefined),
    title: input.title,
    desc: input.desc,
    view: input.view,
    targetType: input.targetType,
    targetId: input.targetId,
    audienceRoles: input.audienceRoles,
    staffId: input.staffId,
    readByUserIds: [],
    archivedByUserIds: [],
    createdAt: currentTime(),
  };

  return {
    ...data,
    notifications: [notification, ...(data.notifications ?? [])],
  };
}

export function markNotificationRead(data: AppData, input: NotificationReadInput): AppData {
  return {
    ...data,
    notifications: (data.notifications ?? []).map((notification) =>
      notification.id === input.notificationId && !notification.readByUserIds.includes(input.userId)
        ? { ...notification, readByUserIds: [input.userId, ...notification.readByUserIds] }
        : notification,
    ),
  };
}

export function archiveNotification(data: AppData, input: NotificationArchiveInput): AppData {
  return {
    ...data,
    notifications: (data.notifications ?? []).map((notification) =>
      notification.id === input.notificationId && !(notification.archivedByUserIds ?? []).includes(input.userId)
        ? { ...notification, archivedByUserIds: [input.userId, ...(notification.archivedByUserIds ?? [])] }
        : notification,
    ),
  };
}

export function markAllVisibleNotificationsRead(data: AppData, input: NotificationReadAllInput): AppData {
  return {
    ...data,
    notifications: (data.notifications ?? []).map((notification) =>
      notificationVisibleTo(notification, input.role, input.staffId) && !notification.readByUserIds.includes(input.userId)
        ? { ...notification, readByUserIds: [input.userId, ...notification.readByUserIds] }
        : notification,
    ),
  };
}

function notificationVisibleTo(notification: SystemNotification, role: UserRole, staffId?: string) {
  if (!notification.audienceRoles.includes(role)) return false;
  if (role === "therapist" && notification.staffId) return notification.staffId === staffId;
  return true;
}

export function createAppointment(
  data: AppData,
  input: AppointmentInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = (options.now ?? nowIso)();
  const serviceIds = normalizeAppointmentServiceIds(data, input.serviceId, input.serviceIds, { allowEmpty: true });
  if (!data.customers.some((item) => item.id === input.customerId)) {
    throw new Error("客户不存在");
  }
  assertBusinessStaff(data.staff.find((item) => item.id === input.staffId));
  const storeId = scopedStoreId(data, input.storeId ?? storeIdForStaff(data, input.staffId) ?? storeIdForCustomer(data, input.customerId));
  const endAt = resolveAppointmentEndAt(data, serviceIds[0], input.startAt, input.endAt, serviceIds).toISOString();
  const roomName = resolveAppointmentRoomName(data, { ...input, storeId, serviceId: serviceIds[0], serviceIds, endAt });
  validateAppointmentSchedule(data, {
    storeId,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: serviceIds[0],
    serviceIds,
    startAt: input.startAt,
    endAt,
    roomName,
    minStartAt: currentTime,
  });

  return {
    ...data,
    appointments: [
      {
        id: idFactory("a"),
        storeId,
        customerId: input.customerId,
        staffId: input.staffId,
        serviceId: serviceIds[0] ?? "",
        serviceIds,
        startAt: input.startAt,
        endAt,
        roomName,
        status: "已确认",
        note: input.note ?? "",
        updatedAt: currentTime,
      },
      ...data.appointments,
    ],
  };
}

export function updateAppointmentStatus(
  data: AppData,
  input: AppointmentStatusInput,
  options: { now?: () => string } = {},
): AppData {
  const appointment = data.appointments.find((item) => item.id === input.appointmentId);
  if (!appointment) throw new Error("预约不存在");

  const nextStatus = input.status;
  if (!isAppointmentStatus(nextStatus)) throw new Error("预约状态不正确");
  if (appointment.status === nextStatus) return data;

  const allowedTransitions: Record<Appointment["status"], Appointment["status"][]> = {
    待确认: ["已确认", "已到店", "已取消", "爽约"],
    已确认: ["已到店", "已取消", "爽约"],
    已到店: ["已完成", "已取消"],
    已完成: [],
    已取消: [],
    爽约: [],
  };

  if (!allowedTransitions[appointment.status].includes(nextStatus)) {
    throw new Error(`预约状态不能从${appointment.status}改为${nextStatus}`);
  }

  if (
    nextStatus === "已取消"
    && data.orders.some((order) => order.appointmentId === appointment.id && order.status !== "已退款")
  ) {
    throw new Error("该预约已有有效收银单，不能取消；如需处理请先退款");
  }

  const currentTime = (options.now ?? nowIso)();
  const reason = input.reason?.trim();
  if (nextStatus === "已取消" && !reason) {
    throw new Error("取消预约必须填写原因");
  }

  return {
    ...data,
    appointments: data.appointments.map((item) => {
      if (item.id !== input.appointmentId) return item;
      return {
        ...item,
        status: nextStatus,
        arrivedAt: nextStatus === "已到店" ? currentTime : item.arrivedAt,
        completedAt: nextStatus === "已完成" ? currentTime : item.completedAt,
        canceledAt: nextStatus === "已取消" ? currentTime : item.canceledAt,
        cancelReason: nextStatus === "已取消" ? reason : item.cancelReason,
        noShowAt: nextStatus === "爽约" ? currentTime : item.noShowAt,
        updatedAt: currentTime,
      };
    }),
  };
}

export function rescheduleAppointment(
  data: AppData,
  input: AppointmentRescheduleInput,
  options: { now?: () => string } = {},
): AppData {
  const appointment = data.appointments.find((item) => item.id === input.appointmentId);
  if (!appointment) throw new Error("预约不存在");
  if (["已到店", "已完成", "已取消", "爽约"].includes(appointment.status)) {
    throw new Error("当前预约状态不能改约");
  }

  const nextStaffId = input.staffId ?? appointment.staffId;
  const nextServiceIds = input.serviceIds
    ? normalizeAppointmentServiceIds(data, input.serviceId ?? input.serviceIds[0] ?? appointment.serviceId, input.serviceIds, { allowEmpty: true })
    : input.serviceId
      ? normalizeAppointmentServiceIds(data, input.serviceId, [input.serviceId], { allowEmpty: true })
      : normalizeAppointmentServiceIds(data, appointment.serviceId, appointment.serviceIds, { allowEmpty: true });
  const nextServiceId = nextServiceIds[0] ?? "";
  const nextEndAt = resolveAppointmentEndAt(data, nextServiceId, input.startAt, input.endAt, nextServiceIds).toISOString();
  const storeId = scopedStoreId(data, appointment.storeId ?? storeIdForStaff(data, nextStaffId) ?? storeIdForCustomer(data, appointment.customerId));
  const nextRoomName = input.roomName?.trim() || appointment.roomName || resolveAppointmentRoomName(data, {
    storeId,
    customerId: appointment.customerId,
    staffId: nextStaffId,
    serviceId: nextServiceId,
    serviceIds: nextServiceIds,
    startAt: input.startAt,
    endAt: nextEndAt,
  });
  validateAppointmentSchedule(data, {
    storeId,
    customerId: appointment.customerId,
    staffId: nextStaffId,
    serviceId: nextServiceId,
    serviceIds: nextServiceIds,
    startAt: input.startAt,
    endAt: nextEndAt,
    roomName: nextRoomName,
    excludeAppointmentId: appointment.id,
    minStartAt: (options.now ?? nowIso)(),
  });

  const currentTime = (options.now ?? nowIso)();
  return {
    ...data,
    appointments: data.appointments.map((item) => {
      if (item.id !== appointment.id) return item;
      return {
        ...item,
        staffId: nextStaffId,
        serviceId: nextServiceId,
        serviceIds: nextServiceIds,
        startAt: input.startAt,
        endAt: nextEndAt,
        roomName: nextRoomName,
        note: input.note ?? item.note,
        status: item.status === "待确认" ? "待确认" : "已确认",
        rescheduledAt: currentTime,
        updatedAt: currentTime,
      };
    }),
  };
}

function isAppointmentStatus(status: string): status is Appointment["status"] {
  return ["待确认", "已确认", "已到店", "已完成", "已取消", "爽约"].includes(status);
}

function roomNamesOf(data: AppData, storeId?: string) {
  const storeProfile = storeProfileOf(data, storeId);
  const names = Array.from(new Set(storeProfile?.roomNames?.map((roomName) => roomName.trim()).filter(Boolean) ?? []));
  if (storeProfile?.roomNamesConfiguredAt) return names;
  return names.filter((roomName) => !LEGACY_DEFAULT_ROOM_NAME_SET.has(roomName));
}

function maintenanceRoomNamesOf(data: AppData, roomNames: string[], storeId?: string) {
  const storeProfile = storeProfileOf(data, storeId);
  return normalizeMaintenanceRoomNames(roomNames, storeProfile?.maintenanceRoomNames ?? storeProfile?.maintenanceRoomCount ?? 0);
}

function normalizeMaintenanceRoomNames(roomNames: string[], maintenanceRooms: number | string[]) {
  if (Array.isArray(maintenanceRooms)) {
    return Array.from(new Set(maintenanceRooms.map((roomName) => roomName.trim()).filter((roomName) => roomNames.includes(roomName))));
  }
  const maintenanceRoomCount = Math.max(0, Math.min(roomNames.length, Math.trunc(maintenanceRooms)));
  return roomNames.slice(Math.max(0, roomNames.length - maintenanceRoomCount));
}

function isActiveAppointmentForRoom(appointment: Appointment) {
  return !["已完成", "已取消", "爽约"].includes(appointment.status);
}

function normalizeAppointmentServiceIds(data: AppData, serviceId?: string, serviceIds?: string[], options: { allowEmpty?: boolean } = {}) {
  const ids = Array.from(new Set([...(serviceIds ?? []), serviceId ?? ""].map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) {
    if (options.allowEmpty) return [];
    throw new Error("请选择服务项目");
  }
  const missingServiceId = ids.find((id) => !data.services.some((service) => service.id === id));
  if (missingServiceId) throw new Error("服务项目不存在");
  return ids;
}

function appointmentAllowsService(appointment: Pick<Appointment, "serviceId" | "serviceIds">, serviceId: string) {
  const serviceIds = appointmentServiceIds(appointment);
  if (serviceIds.length === 0) return true;
  return serviceIds.includes(serviceId);
}

function resolveAppointmentEndAt(data: AppData, serviceId: string | undefined, startAtInput: string, endAtInput?: string, serviceIds?: string[]) {
  const selectedServiceIds = normalizeAppointmentServiceIds(data, serviceId, serviceIds, { allowEmpty: true });
  const startAt = new Date(startAtInput);
  if (Number.isNaN(startAt.getTime())) throw new Error("预约开始时间不正确");
  const explicitEndAt = endAtInput ? new Date(endAtInput) : undefined;
  if (endAtInput && (!explicitEndAt || Number.isNaN(explicitEndAt.getTime()))) throw new Error("预约结束时间不正确");
  const durationMinutes = selectedServiceIds.length ? selectedServiceIds.reduce((sum, id) => {
    const service = data.services.find((item) => item.id === id);
    return sum + (service?.duration && service.duration > 0 ? service.duration : 60);
  }, 0) : 60;
  const endAt = explicitEndAt ?? new Date(startAt.getTime() + durationMinutes * 60 * 1000);
  if (!(startAt < endAt)) throw new Error("预约结束时间必须晚于开始时间");
  return endAt;
}

function resolveAppointmentRoomName(data: AppData, input: AppointmentInput) {
  const storeId = scopedStoreId(data, input.storeId ?? storeIdForStaff(data, input.staffId) ?? storeIdForCustomer(data, input.customerId));
  const roomNames = roomNamesOf(data, storeId);
  if (roomNames.length === 0) throw new Error("请先到房间设置配置预约房间");
  const maintenanceRoomNames = maintenanceRoomNamesOf(data, roomNames, storeId);
  const availableRoomNames = roomNames.filter((roomName) => !maintenanceRoomNames.includes(roomName));
  const requestedRoomName = input.roomName?.trim();
  if (requestedRoomName) return requestedRoomName;

  const startAt = new Date(input.startAt);
  const endAt = resolveAppointmentEndAt(data, input.serviceId, input.startAt, input.endAt, input.serviceIds);
  const overlappingRoomNames = new Set(assignAppointmentRooms(
    data.appointments
      .filter(isActiveAppointmentForRoom)
      .filter((appointment) => storeIdForAppointment(data, appointment, storeId) === storeId)
      .filter((appointment) => {
        const appointmentStart = new Date(appointment.startAt);
        const appointmentEnd = appointmentEndAt(appointment, data.services);
        return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
      }),
    roomNames,
    maintenanceRoomNames,
  ).map((assignment) => assignment.roomName));
  return availableRoomNames.find((roomName) =>
    !overlappingRoomNames.has(roomName),
  ) ?? availableRoomNames[0] ?? "";
}

function validateAppointmentSchedule(
  data: AppData,
  input: {
    storeId?: string;
    customerId: string;
    staffId: string;
    serviceId?: string;
    serviceIds?: string[];
    startAt: string;
    endAt?: string;
    roomName?: string;
    excludeAppointmentId?: string;
    minStartAt?: string;
  },
) {
  if (!data.customers.some((item) => item.id === input.customerId)) {
    throw new Error("客户不存在");
  }
  assertBusinessStaff(data.staff.find((item) => item.id === input.staffId));
  const serviceIds = normalizeAppointmentServiceIds(data, input.serviceId, input.serviceIds, { allowEmpty: true });

  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new Error("预约时间不正确");
  const endAt = resolveAppointmentEndAt(data, serviceIds[0], input.startAt, input.endAt, serviceIds);
  const minStartAt = input.minStartAt ? new Date(input.minStartAt) : new Date();
  if (!Number.isNaN(minStartAt.getTime()) && startAt < minStartAt) throw new Error("预约时间不能早于当前时间");
  const selectedRoomName = input.roomName?.trim();
  if (!selectedRoomName) throw new Error("请选择预约房间");
  const storeId = scopedStoreId(data, input.storeId ?? storeIdForStaff(data, input.staffId) ?? storeIdForCustomer(data, input.customerId));
  const roomNames = roomNamesOf(data, storeId);
  if (roomNames.length === 0) throw new Error("请先到房间设置配置预约房间");
  const maintenanceRoomNames = maintenanceRoomNamesOf(data, roomNames, storeId);
  if (!roomNames.includes(selectedRoomName)) throw new Error("预约房间不存在");
  if (maintenanceRoomNames.includes(selectedRoomName)) throw new Error("该房间维护中，不能预约");

  const appointmentConflict = data.appointments.find((appointment) => {
    if (appointment.id === input.excludeAppointmentId) return false;
    if (appointment.staffId !== input.staffId) return false;
    if (["已完成", "已取消", "爽约"].includes(appointment.status)) return false;
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = appointmentEndAt(appointment, data.services);
    return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
  });

  if (appointmentConflict) {
    throw new Error(`该服务人员在此时间段已有预约：${appointmentConflictSummary(data, appointmentConflict)}`);
  }

  const hasUnavailableConflict = data.staffUnavailableSlots.some((slot) => {
    if (slot.staffId !== input.staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt));
  });

  if (hasUnavailableConflict) {
    throw new Error("该服务人员在此时间段不可预约");
  }

  const hasRoomConflict = assignAppointmentRooms(
    data.appointments
      .filter((appointment) => appointment.id !== input.excludeAppointmentId)
      .filter(isActiveAppointmentForRoom)
      .filter((appointment) => storeIdForAppointment(data, appointment, storeId) === storeId)
      .filter((appointment) => {
        const appointmentStart = new Date(appointment.startAt);
        const appointmentEnd = appointmentEndAt(appointment, data.services);
        return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
      }),
    roomNames,
    maintenanceRoomNames,
  ).some((assignment) => assignment.roomName === selectedRoomName);

  if (hasRoomConflict) {
    throw new Error("该房间在此时间段已有预约");
  }

  const shiftsForDay = data.staffShifts.filter(
    (shift) => shift.staffId === input.staffId && businessDateOf(shift.startAt) === businessDateOf(input.startAt),
  );
  const insideShift =
    shiftsForDay.length === 0 ||
    shiftsForDay.some((shift) => startAt >= new Date(shift.startAt) && endAt <= new Date(shift.endAt));
  if (!insideShift) {
    throw new Error("预约时间不在服务人员班次内");
  }
}

function appointmentConflictSummary(data: AppData, appointment: Appointment) {
  const customerName = data.customers.find((customer) => customer.id === appointment.customerId)?.name ?? "该客户";
  const staffName = data.staff.find((staff) => staff.id === appointment.staffId)?.name ?? "该服务人员";
  const serviceNames =
    appointmentServiceIds(appointment)
      .map((serviceId) => data.services.find((service) => service.id === serviceId)?.name)
      .filter((name): name is string => Boolean(name))
      .join("、") || "到店确认项目";
  const roomName = appointment.roomName?.trim() || "未分配房间";
  return `${staffName} ${appointmentConflictTimeRange(appointment, data.services)} 已为 ${customerName} 预约 ${serviceNames}，房间：${roomName}`;
}

function appointmentConflictTimeRange(appointment: Appointment, services: Service[]) {
  const start = new Date(appointment.startAt);
  const end = appointmentEndAt(appointment, services);
  const dateTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(start);
  const endTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(end);
  return `${dateTime}-${endTime}`;
}

export function createStaffShift(
  data: AppData,
  input: StaffShiftInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  assertBusinessStaff(data.staff.find((staff) => staff.id === input.staffId), "服务人员不存在或已停用");
  if (!(startAt < endAt)) throw new Error("班次结束时间必须晚于开始时间");
  const hasShiftConflict = data.staffShifts.some(
    (shift) => shift.staffId === input.staffId && hasTimeOverlap(startAt, endAt, new Date(shift.startAt), new Date(shift.endAt)),
  );
  if (hasShiftConflict) throw new Error("服务人员班次冲突");
  const shift: StaffShift = {
    id: idFactory("ss"),
    storeId: scopedStoreId(data, input.storeId ?? storeIdForStaff(data, input.staffId)),
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    note: input.note,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    staffShifts: [shift, ...data.staffShifts],
  };
}

export function createStaffUnavailableSlot(
  data: AppData,
  input: StaffUnavailableSlotInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);

  assertBusinessStaff(data.staff.find((staff) => staff.id === input.staffId), "服务人员不存在或已停用");

  if (!(startAt < endAt)) {
    throw new Error("不可预约结束时间必须晚于开始时间");
  }

  const hasAppointmentConflict = data.appointments.some((appointment) => {
    if (appointment.staffId !== input.staffId) return false;
    if (["已取消", "爽约"].includes(appointment.status)) return false;
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = appointmentEndAt(appointment, data.services);
    return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
  });

  if (hasAppointmentConflict) {
    throw new Error("该时间段已有预约，不能锁定");
  }

  const hasSlotConflict = data.staffUnavailableSlots.some((slot) => {
    if (slot.staffId !== input.staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt));
  });

  if (hasSlotConflict) {
    throw new Error("该时间段已锁定");
  }

  const createdAt = currentTime();
  const slot: StaffUnavailableSlot = {
    id: idFactory("su"),
    storeId: scopedStoreId(data, input.storeId ?? storeIdForStaff(data, input.staffId)),
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };

  return {
    ...data,
    staffUnavailableSlots: [slot, ...data.staffUnavailableSlots],
    operationLogs: [
      {
        id: idFactory("op"),
        storeId: slot.storeId,
        userId: input.userId,
        action: "锁定员工时间",
        targetType: "staffUnavailableSlot",
        targetId: slot.id,
        summary: `${input.reason}：${input.startAt} 至 ${input.endAt}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function createDailyClose(
  data: AppData,
  input: DailyCloseInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const storeId = scopedStoreId(data, input.storeId);

  if (data.dailyCloses.some((item) => item.businessDate === input.businessDate && (item.storeId ?? defaultStoreId(data)) === storeId && item.status === "已锁定")) {
    throw new Error("该营业日已日结");
  }

  const orders = data.orders.filter((order) => businessDateOf(order.createdAt) === input.businessDate && (order.storeId ?? defaultStoreId(data)) === storeId);
  const orderById = new Map(data.orders.map((order) => [order.id, order]));
  const refunds = data.refunds.filter((refund) => {
    if (businessDateOf(refund.createdAt) !== input.businessDate) return false;
    const linkedOrder = orderById.get(refund.orderId);
    const refundStoreId = trimText(refund.storeId) || trimText(linkedOrder?.storeId) || defaultStoreId(data);
    return refundStoreId === storeId;
  });
  const commissions = data.commissions.filter((commission) => businessDateOf(commission.createdAt) === input.businessDate && (commission.storeId ?? defaultStoreId(data)) === storeId);
  const memberCardIncomeTransactions = data.memberCardTransactions.filter(
    (transaction) => businessDateOf(transaction.createdAt) === input.businessDate && (transaction.storeId ?? defaultStoreId(data)) === storeId && memberCardCashIn(transaction) > 0,
  );
  const memberCardRefundTransactions = data.memberCardTransactions.filter(
    (transaction) => businessDateOf(transaction.createdAt) === input.businessDate && (transaction.storeId ?? defaultStoreId(data)) === storeId && memberCardCashRefund(transaction) > 0,
  );

  const originalOrderAmount = (order: Order) => orderRefundAmounts(data, order).originalPaidAmount;
  const orderAmountByMethod = (method: Order["payMethod"]) =>
    orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + originalOrderAmount(order), 0);
  const memberCardIncomeByMethod = (method: CashPayMethod) =>
    memberCardIncomeTransactions
      .filter((transaction) => transaction.payMethod === method)
      .reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
  const cashRevenue = orders
    .filter((order) => order.payMethod !== "会员卡")
    .reduce((sum, order) => sum + originalOrderAmount(order), 0)
    + memberCardIncomeTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
  const cashOrderRefundAmount = refunds
    .filter((refund) => orderById.get(refund.orderId)?.payMethod !== "会员卡")
    .reduce((sum, refund) => sum + refund.amount, 0);
  const visibleRefundAmountByOrder = new Map<string, number>();
  refunds.forEach((refund) => {
    visibleRefundAmountByOrder.set(refund.orderId, (visibleRefundAmountByOrder.get(refund.orderId) ?? 0) + refund.amount);
  });

  const dailyClose: DailyClose = {
    id: idFactory("dc"),
    storeId,
    businessDate: input.businessDate,
    revenue: cashRevenue,
    refundAmount: cashOrderRefundAmount
      + memberCardRefundTransactions.reduce((sum, transaction) => sum + memberCardCashRefund(transaction), 0),
    orderCount: orders.filter((order) => (visibleRefundAmountByOrder.get(order.id) ?? 0) < originalOrderAmount(order)).length,
    cashAmount: orderAmountByMethod("现金") + memberCardIncomeByMethod("现金"),
    wechatAmount: orderAmountByMethod("微信") + memberCardIncomeByMethod("微信"),
    alipayAmount: orderAmountByMethod("支付宝") + memberCardIncomeByMethod("支付宝"),
    cardAmount: orderAmountByMethod("银行卡") + memberCardIncomeByMethod("银行卡"),
    memberCardAmount: orderAmountByMethod("会员卡"),
    commissionAmount: commissionAccrualAmount({ commissions, refunds }, data),
    createdBy: input.userId,
    createdAt,
    status: "已锁定",
  };
  const reversedClose = data.dailyCloses.find((item) => item.businessDate === input.businessDate && (item.storeId ?? defaultStoreId(data)) === storeId && item.status === "已反结");
  const nextDailyCloses = reversedClose
    ? data.dailyCloses.map((item) => (item.id === reversedClose.id ? { ...dailyClose, id: item.id } : item))
    : [dailyClose, ...data.dailyCloses];

  return {
    ...data,
    dailyCloses: nextDailyCloses,
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "财务日结",
        targetType: "dailyClose",
        targetId: reversedClose?.id ?? dailyClose.id,
        summary: `${input.businessDate} 日结：实收 ${dailyClose.revenue} 元，退款 ${dailyClose.refundAmount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function reverseDailyClose(
  data: AppData,
  input: DailyCloseInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const storeId = scopedStoreId(data, input.storeId);
  const close = data.dailyCloses.find((item) => item.businessDate === input.businessDate && (item.storeId ?? defaultStoreId(data)) === storeId && item.status === "已锁定");
  if (!close) throw new Error("可反结日结不存在");
  return {
    ...data,
    dailyCloses: data.dailyCloses.map((item) =>
      item.id === close.id ? { ...item, status: "已反结", reversedBy: input.userId, reversedAt: createdAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        storeId,
        userId: input.userId,
        action: "财务反结",
        targetType: "dailyClose",
        targetId: close.id,
        summary: `${input.businessDate} 反结`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

function hasTimeOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function splitAmount(amount: number, parts: number) {
  if (parts <= 0) return [];
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function addMonthsToIsoDate(dateIso: string, months: number) {
  const date = new Date(`${businessDateOf(dateIso)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(months) || months <= 0) return undefined;
  date.setUTCMonth(date.getUTCMonth() + Math.round(months));
  return date.toISOString().slice(0, 10);
}

function normalizeExpiryDate(value?: string) {
  const date = value?.trim();
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("到期日期无效");
  return parsed.toISOString().slice(0, 10);
}

function stockInExpiryAt(product: Product, createdAt: string, explicitExpiryAt?: string) {
  return normalizeExpiryDate(explicitExpiryAt) ?? addMonthsToIsoDate(createdAt, product.shelfLifeMonths ?? 0);
}

function earlierExpiryAt(current?: string, next?: string) {
  if (!next) return current;
  if (!current) return next;
  return next < current ? next : current;
}

function inventoryBatchRecord(
  idFactory: IdFactory,
  input: {
    storeId?: string;
    productId: string;
    source: InventoryBatch["source"];
    quantity: number;
    unitCost: number;
    createdAt: string;
    expiryAt?: string;
    supplierId?: string;
    purchaseOrderId?: string;
  },
): InventoryBatch | undefined {
  if (input.quantity <= 0) return undefined;
  return {
    id: idFactory("ib"),
    storeId: input.storeId,
    productId: input.productId,
    source: input.source,
    quantityIn: input.quantity,
    remainingQuantity: input.quantity,
    unitCost: input.unitCost,
    expiryAt: input.expiryAt,
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId,
    createdAt: input.createdAt,
  };
}

function consumeInventoryBatches(batches: InventoryBatch[] | undefined, productId: string, quantity: number) {
  if (!batches?.length || quantity <= 0) return batches ?? [];
  let remaining = quantity;
  const sortedIds = [...batches]
    .filter((batch) => batch.productId === productId && batch.remainingQuantity > 0)
    .sort((current, next) => (current.expiryAt ?? "9999-12-31").localeCompare(next.expiryAt ?? "9999-12-31") || current.createdAt.localeCompare(next.createdAt))
    .map((batch) => batch.id);
  const sortedIdSet = new Set(sortedIds);
  return batches.map((batch) => {
    if (!sortedIdSet.has(batch.id) || remaining <= 0) return batch;
    const consumed = Math.min(batch.remainingQuantity, remaining);
    remaining -= consumed;
    return { ...batch, remainingQuantity: Math.max(0, batch.remainingQuantity - consumed) };
  });
}

export function adjustInventory(
  data: AppData,
  input: InventoryAdjustmentInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const direction = input.type === "入库" ? 1 : -1;
  const targetProduct = data.products.find((product) => product.id === input.productId);
  if (!targetProduct) {
    throw new Error("商品不存在");
  }
  const storeId = scopedStoreId(data, input.storeId ?? targetProduct.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const expiryAt = input.type === "入库" ? stockInExpiryAt(targetProduct, createdAt, input.expiryAt) : undefined;
  const inboundUnitCost = input.type === "入库" && typeof input.unitCost === "number" && Number.isFinite(input.unitCost) && input.unitCost >= 0
    ? input.unitCost
    : targetProduct.cost;
  let stockAfter = 0;
  const products = data.products.map((product) => {
    if (product.id !== input.productId) return product;
    stockAfter = Math.max(0, product.stock + input.quantity * direction);
    return {
      ...product,
      stock: stockAfter,
      cost: input.type === "入库" ? inboundUnitCost : product.cost,
      expiryAt: earlierExpiryAt(product.expiryAt, expiryAt),
    };
  });
  const newBatch = input.type === "入库"
    ? inventoryBatchRecord(idFactory, {
        storeId,
        productId: input.productId,
        source: "手动入库",
        quantity: input.quantity,
        unitCost: inboundUnitCost,
        expiryAt,
        createdAt,
      })
    : undefined;

  return {
    ...data,
    products,
    inventoryBatches: newBatch
      ? [newBatch, ...(data.inventoryBatches ?? [])]
      : consumeInventoryBatches(data.inventoryBatches, input.productId, input.quantity),
    inventoryLogs: [
      {
        id: idFactory("il"),
        storeId,
        productId: input.productId,
        type: input.type,
        delta: input.quantity * direction,
        stockAfter,
        note: input.note ?? "手动调整",
        expiryAt,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function addSupplier(
  data: AppData,
  input: SupplierInput,
  options: { idFactory?: IdFactory } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const supplier: Supplier = { id: idFactory("sp"), storeId: scopedStoreId(data, input.storeId), name: input.name, phone: input.phone, contact: input.contact, status: "active" };
  return { ...data, suppliers: [supplier, ...data.suppliers] };
}

export function receivePurchaseOrder(
  data: AppData,
  input: PurchaseOrderInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  if (!data.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("供应商不存在");
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品不存在");
  const storeId = scopedStoreId(data, input.storeId ?? product.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const stockAfter = product.stock + input.quantity;
  const expiryAt = stockInExpiryAt(product, createdAt, input.expiryAt);
  const purchaseOrder: PurchaseOrder = {
    id: idFactory("po"),
    storeId,
    supplierId: input.supplierId,
    productId: input.productId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    expiryAt,
    status: "已入库",
    createdBy: input.userId,
    createdAt,
  };
  const batch = inventoryBatchRecord(idFactory, {
    storeId,
    productId: product.id,
    source: "采购入库",
    quantity: input.quantity,
    unitCost: input.unitCost,
    expiryAt,
    supplierId: input.supplierId,
    purchaseOrderId: purchaseOrder.id,
    createdAt,
  });
  return {
    ...data,
    products: data.products.map((item) => (item.id === product.id ? { ...item, stock: stockAfter, cost: input.unitCost, expiryAt: earlierExpiryAt(item.expiryAt, expiryAt) } : item)),
    inventoryBatches: batch ? [batch, ...(data.inventoryBatches ?? [])] : (data.inventoryBatches ?? []),
    purchaseOrders: [purchaseOrder, ...data.purchaseOrders],
    inventoryLogs: [
      {
        id: idFactory("il"),
        storeId,
        productId: product.id,
        type: "采购入库",
        delta: input.quantity,
        stockAfter,
        note: purchaseOrder.id,
        expiryAt,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function receiveSupplierPurchase(
  data: AppData,
  input: SupplierPurchaseInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const storeId = scopedStoreId(data, input.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const normalizedSupplierName = trimText(input.supplierName);
  const supplier = input.supplierId
    ? data.suppliers.find((item) => item.id === input.supplierId)
    : data.suppliers.find((item) => item.storeId === storeId && item.name.trim().toLowerCase() === normalizedSupplierName.toLowerCase());
  if (input.supplierId && !supplier) throw new Error("供应商不存在");
  if (!supplier && !normalizedSupplierName) throw new Error("请输入供应商名称");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("请输入入库数量");
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) throw new Error("采购单价不能为负数");

  const nextSupplier: Supplier | undefined = supplier ?? {
    id: idFactory("sp"),
    storeId,
    name: normalizedSupplierName,
    phone: input.supplierPhone ?? "",
    contact: input.supplierContact ?? "",
    status: "active",
  };
  const supplierId = nextSupplier.id;

  const normalizedProductName = trimText(input.productName);
  const existingProduct = input.productId
    ? data.products.find((item) => item.id === input.productId)
    : data.products.find((item) => item.storeId === storeId && item.name.trim().toLowerCase() === normalizedProductName.toLowerCase());
  if (input.productId && !existingProduct) throw new Error("商品不存在");
  if (!existingProduct && !normalizedProductName) throw new Error("请输入商品名称");
  if (!existingProduct && (!Number.isFinite(input.productPrice) || input.productPrice === undefined)) throw new Error("新商品请填写销售价");

  const productId = existingProduct?.id ?? idFactory("p");
  const category = input.productCategory?.trim() || existingProduct?.category || "面护类";
  const subcategory = input.productSubcategory?.trim() || existingProduct?.subcategory || "";
  const unit = input.productUnit?.trim() || existingProduct?.unit || "件";
  const newProductStockRule = existingProduct ? undefined : requireConfirmedProductStockRule({
    serviceStockDeductible: input.serviceStockDeductible,
    serviceUnit: input.serviceUnit,
    serviceUnitsPerStockUnit: input.serviceUnitsPerStockUnit,
  });
  const serviceStockDeductible = newProductStockRule?.serviceStockDeductible ?? productServiceStockDeductible(existingProduct!);
  const serviceUnitsPerStockUnit = newProductStockRule?.serviceUnitsPerStockUnit ?? (serviceStockDeductible ? productServiceUnitsPerStockUnit(existingProduct!) : undefined);
  const newProduct: Product | undefined = existingProduct ? undefined : {
    id: productId,
    storeId,
    name: normalizedProductName,
    type: "sale",
    category,
    subcategory,
    unit,
    price: input.productPrice ?? 0,
    cost: input.unitCost,
    stock: input.quantity,
    warningStock: input.warningStock ?? 5,
    shelfLifeMonths: input.shelfLifeMonths,
    expiryAt: input.expiryAt,
    serviceStockDeductible,
    serviceStockReviewStatus: "confirmed",
    serviceStockReviewedAt: createdAt,
    serviceStockReviewedBy: input.userId,
    serviceUnit: newProductStockRule?.serviceUnit,
    serviceUnitsPerStockUnit,
    serviceUsesPerUnit: serviceUnitsPerStockUnit,
  };
  const productForExpiry = existingProduct ?? newProduct;
  if (!productForExpiry) throw new Error("商品不存在");
  const stockAfter = existingProduct ? existingProduct.stock + input.quantity : input.quantity;
  const expiryAt = stockInExpiryAt(productForExpiry, createdAt, input.expiryAt);
  const purchaseOrder: PurchaseOrder = {
    id: idFactory("po"),
    storeId,
    supplierId,
    productId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    expiryAt,
    status: "已入库",
    createdBy: input.userId,
    createdAt,
  };
  const batch = inventoryBatchRecord(idFactory, {
    storeId,
    productId,
    source: "采购入库",
    quantity: input.quantity,
    unitCost: input.unitCost,
    expiryAt,
    supplierId,
    purchaseOrderId: purchaseOrder.id,
    createdAt,
  });

  return {
    ...data,
    suppliers: supplier ? data.suppliers : [nextSupplier!, ...data.suppliers],
    products: existingProduct
      ? data.products.map((item) => (item.id === existingProduct.id ? { ...item, stock: stockAfter, cost: input.unitCost, expiryAt: earlierExpiryAt(item.expiryAt, expiryAt) } : item))
      : [newProduct!, ...data.products],
    inventoryBatches: batch ? [batch, ...(data.inventoryBatches ?? [])] : (data.inventoryBatches ?? []),
    purchaseOrders: [purchaseOrder, ...data.purchaseOrders],
    inventoryLogs: [
      {
        id: idFactory("il"),
        storeId,
        productId,
        type: "采购入库",
        delta: input.quantity,
        stockAfter,
        note: purchaseOrder.id,
        expiryAt,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function restockLowInventory(
  data: AppData,
  input: RestockLowInventoryInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const storeId = scopedStoreId(data, input.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const lowStockProducts = data.products.filter((product) => product.stock <= product.warningStock && (!storeId || (product.storeId ?? defaultStoreId(data)) === storeId));
  if (lowStockProducts.length === 0) throw new Error("当前没有需要补货的商品");

  const existingSupplier = input.supplierId
    ? data.suppliers.find((supplier) => supplier.id === input.supplierId)
    : data.suppliers.find((supplier) => supplier.status === "active") ?? data.suppliers[0];
  if (input.supplierId && !existingSupplier) throw new Error("供应商不存在");

  const supplier: Supplier = existingSupplier ?? {
    id: idFactory("sp"),
    name: "默认供应商",
    phone: "",
    contact: "采购联系人",
    status: "active",
  };
  const purchaseOrders: PurchaseOrder[] = [];
  const inventoryBatches: InventoryBatch[] = [];
  const inventoryLogs: InventoryLog[] = [];
  const stockByProduct = new Map<string, number>();

  for (const product of lowStockProducts) {
    const quantity = Math.max(10, product.warningStock * 2 - product.stock);
      const stockAfter = roundStockQuantity(product.stock + quantity);
    const expiryAt = stockInExpiryAt(product, createdAt);
    const purchaseOrder: PurchaseOrder = {
      id: idFactory("po"),
      storeId,
      supplierId: supplier.id,
      productId: product.id,
      quantity,
      unitCost: product.cost,
      expiryAt,
      status: "已入库",
      createdBy: input.userId,
      createdAt,
    };
    purchaseOrders.push(purchaseOrder);
    const batch = inventoryBatchRecord(idFactory, {
      storeId,
      productId: product.id,
      source: "采购入库",
      quantity,
      unitCost: product.cost,
      expiryAt,
      supplierId: supplier.id,
      purchaseOrderId: purchaseOrder.id,
      createdAt,
    });
    if (batch) inventoryBatches.push(batch);
    inventoryLogs.push({
      id: idFactory("il"),
      storeId,
      productId: product.id,
      type: "采购入库",
      delta: quantity,
      stockAfter,
      note: purchaseOrder.id,
      expiryAt,
      createdAt,
    });
    stockByProduct.set(product.id, stockAfter);
  }

  return {
    ...data,
    suppliers: existingSupplier ? data.suppliers : [supplier, ...data.suppliers],
    products: data.products.map((product) => {
      if (!stockByProduct.has(product.id)) return product;
      const expiryAt = purchaseOrders.find((order) => order.productId === product.id)?.expiryAt;
      return { ...product, stock: stockByProduct.get(product.id) ?? product.stock, expiryAt: earlierExpiryAt(product.expiryAt, expiryAt) };
    }),
    inventoryBatches: [...inventoryBatches, ...(data.inventoryBatches ?? [])],
    purchaseOrders: [...purchaseOrders, ...data.purchaseOrders],
    inventoryLogs: [...inventoryLogs, ...data.inventoryLogs],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "一键补货",
        targetType: "inventory",
        targetId: "low-stock",
        summary: `低库存商品自动补货 ${purchaseOrders.length} 项`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function createStocktake(
  data: AppData,
  input: StocktakeInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品不存在");
  const storeId = scopedStoreId(data, input.storeId ?? product.storeId);
  assertBusinessDateOpen(data, businessDateOf(createdAt), storeId);
  const delta = input.actualStock - product.stock;
  const stocktake: Stocktake = {
    id: idFactory("st"),
    storeId,
    productId: product.id,
    systemStock: product.stock,
    actualStock: input.actualStock,
    delta,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    products: data.products.map((item) => (item.id === product.id ? { ...item, stock: input.actualStock } : item)),
    inventoryBatches: delta > 0
      ? [
          inventoryBatchRecord(idFactory, {
            storeId,
            productId: product.id,
            source: "盘点调整",
            quantity: delta,
            unitCost: product.cost,
            createdAt,
          }),
          ...(data.inventoryBatches ?? []),
        ].filter((item): item is InventoryBatch => Boolean(item))
      : consumeInventoryBatches(data.inventoryBatches, product.id, Math.abs(delta)),
    stocktakes: [stocktake, ...data.stocktakes],
    inventoryLogs: [
      {
        id: idFactory("il"),
        storeId,
        productId: product.id,
        type: "盘点调整",
        delta,
        stockAfter: input.actualStock,
        note: input.reason,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function addCustomerServiceRecord(
  data: AppData,
  input: CustomerServiceRecordInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  if (!data.customers.some((customer) => customer.id === input.customerId)) throw new Error("客户不存在");
  const staff = data.staff.find((item) => item.id === input.staffId);
  if (!staff) throw new Error("员工不存在");
  if (!isBusinessStaff(staff)) throw new Error("老板不能作为服务人员");
  const service = data.services.find((item) => item.id === input.serviceId);
  if (!service) throw new Error("服务项目不存在");
  const storeId = scopedStoreId(data, storeIdForCustomer(data, input.customerId) ?? staff.storeId ?? service.storeId);
  let memberCardTransactionId: string | undefined;
  if (input.orderId) {
    const order = data.orders.find((item) => item.id === input.orderId);
    if (!order) throw new Error("关联订单不存在");
    if (order.customerId !== input.customerId) throw new Error("关联订单不属于该客户");
    if (order.staffId !== input.staffId || order.serviceId !== input.serviceId) throw new Error("服务记录与关联订单不一致");
    if (order.status === "已退款") throw new Error("已全额退款订单不能生成服务记录");
    if (data.customerServiceRecords.some((record) => record.orderId === order.id)) throw new Error("该订单已生成服务记录");
    memberCardTransactionId = data.memberCardTransactions.find((transaction) => transaction.orderId === order.id && transaction.type === "消费")?.id;
  }
  const record: CustomerServiceRecord = {
    id: idFactory("sr"),
    storeId,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    orderId: input.orderId,
    memberCardTransactionId,
    skinCondition: input.skinCondition,
    beforeNote: input.beforeNote,
    careSteps: input.careSteps ?? `完成${service.name}服务`,
    productsUsed: input.productsUsed ?? serviceUsedProductIds(service)
      .map((productId) => data.products.find((productItem) => productItem.id === productId)?.name ?? "")
      .filter(Boolean)
      .join("、"),
    afterNote: input.afterNote,
    customerFeedback: input.customerFeedback ?? "",
    nextCareAdvice: input.nextCareAdvice ?? "",
    nextFollowUpAt: input.nextFollowUpAt,
    createdAt,
  };
  const followUp: CustomerFollowUp | undefined = input.nextFollowUpAt
    ? {
        id: idFactory("fu"),
        storeId,
        customerId: input.customerId,
        staffId: input.staffId,
        dueAt: input.nextFollowUpAt,
        method: "微信",
        note: `服务后回访：${input.nextCareAdvice || input.afterNote}`,
        status: "待跟进",
        createdAt,
      }
    : undefined;
  return {
    ...data,
    customerServiceRecords: [record, ...data.customerServiceRecords],
    customers: data.customers.map((customer) => (customer.id === input.customerId ? { ...customer, lastVisit: createdAt } : customer)),
    customerFollowUps: followUp ? [followUp, ...data.customerFollowUps] : data.customerFollowUps,
  };
}

export function createCustomerSignature(
  data: AppData,
  input: CustomerSignatureInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const validDays = input.validDays ?? 7;
  const customer = data.customers.find((item) => item.id === input.customerId);
  if (!customer) throw new Error("客户不存在");
  if (!input.requestedBy) throw new Error("签名发起人不存在");
  if (validDays <= 0) throw new Error("签名链接有效期必须大于 0 天");
  if (input.serviceRecordId && !data.customerServiceRecords.some((record) => record.id === input.serviceRecordId && record.customerId === customer.id)) {
    throw new Error("服务档案不存在或不属于该客户");
  }
  if (input.orderId && !data.orders.some((order) => order.id === input.orderId && order.customerId === customer.id)) {
    throw new Error("订单不存在或不属于该客户");
  }
  const signature: CustomerSignature = {
    id: idFactory("sig"),
    storeId: scopedStoreId(data, storeIdForCustomer(data, customer.id)),
    token: idFactory("sign"),
    customerId: customer.id,
    serviceRecordId: input.serviceRecordId,
    orderId: input.orderId,
    title: input.title?.trim() || "客户服务确认签名",
    content: input.content?.trim() || `${customer.name} 确认本次到店服务、消费记录和服务档案内容无误。`,
    status: "待签名",
    requestedBy: input.requestedBy,
    createdAt,
    expiresAt: new Date(+new Date(createdAt) + validDays * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    ...data,
    customerSignatures: [signature, ...(data.customerSignatures ?? [])],
  };
}

export function signCustomerSignature(
  data: AppData,
  input: CustomerSignatureSubmitInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const signedAt = (options.now ?? nowIso)();
  const token = input.token.trim();
  const signerName = input.signerName.trim();
  const signatureText = input.signatureText.trim();
  const signature = (data.customerSignatures ?? []).find((item) => item.token === token);
  if (!signature) throw new Error("签名链接不存在");
  if (signature.status !== "待签名") throw new Error("签名链接已失效");
  if (signature.expiresAt && +new Date(signature.expiresAt) <= +new Date(signedAt)) throw new Error("签名链接已过期");
  if (!signerName) throw new Error("请输入签名人姓名");
  if (!signatureText) throw new Error("请输入签名确认内容");
  if (signatureText.length > 120_000) throw new Error("签名图片过大，请清除后重新签名");
  const linkedOrder = signature.orderId ? data.orders.find((order) => order.id === signature.orderId) : undefined;
  const alreadyDebited = linkedOrder
    ? data.memberCardTransactions.some((transaction) => transaction.orderId === linkedOrder.id && transaction.type === "消费")
    : false;
  const linkedOrderServiceIds = linkedOrder
    ? linkedOrder.serviceIds?.length
      ? linkedOrder.serviceIds
      : linkedOrder.serviceId
        ? [linkedOrder.serviceId]
        : []
    : [];
  const signatureDebitPlan = linkedOrder && !alreadyDebited && linkedOrderServiceIds.length > 0
    ? buildMemberCardDebitPlan(
        data,
        linkedOrder.customerId,
        linkedOrderServiceIds,
        linkedOrder.cardId,
        linkedOrder.serviceCardSelections,
      )
    : [];
  const signatureDebitPlanCoversOrder = memberCardDebitPlanCoversServices(signatureDebitPlan, linkedOrderServiceIds);
  const debitCard = linkedOrder && !alreadyDebited && signatureDebitPlan.length === 0 ? selectSignatureDebitCard(data, linkedOrder) : undefined;
  if (linkedOrder && !alreadyDebited && linkedOrderServiceIds.length > 0 && !signatureDebitPlanCoversOrder && !debitCard) {
    const relevantProjectCards = projectCardsForServices(data, linkedOrder.customerId, linkedOrderServiceIds);
    if (relevantProjectCards.length > 0) {
      const shortfalls = memberCardDebitPlanShortfalls(data, linkedOrder.customerId, linkedOrderServiceIds, signatureDebitPlan);
      throw new Error(shortfalls.length ? `会员卡项目次数不足：${shortfalls.join("；")}` : "会员卡项目次数不足，不能完成签名扣卡");
    }
  }
  const signatureDebitPlanByCard = new Map<string, string[]>();
  signatureDebitPlan.forEach((line) => {
    const ids = signatureDebitPlanByCard.get(line.cardId) ?? [];
    for (let index = 0; index < line.quantity; index += 1) ids.push(line.serviceId);
    signatureDebitPlanByCard.set(line.cardId, ids);
  });
  const memberCards = signatureDebitPlanCoversOrder && signatureDebitPlan.length > 0
    ? data.memberCards.map((card) => {
        const projectServiceIds = signatureDebitPlanByCard.get(card.id) ?? [];
        return projectServiceIds.length
          ? projectServiceIds.reduce((nextCard, serviceId) => updateMemberCardServiceTimes(nextCard, serviceId, -1), card)
          : card;
      })
    : debitCard
      ? data.memberCards.map((card) => {
        if (card.id !== debitCard.id || !linkedOrder) return card;
        if (card.type === "储值卡") return { ...card, balance: Math.max(0, card.balance - linkedOrder.paidAmount) };
        return linkedOrderServiceIds.reduce((nextCard, serviceId) => updateMemberCardServiceTimes(nextCard, serviceId, -1), card);
      })
      : data.memberCards;
  const debitedCard = debitCard ? memberCards.find((card) => card.id === debitCard.id) : undefined;
  const signatureProjectTransactions: MemberCardTransaction[] = linkedOrder && signatureDebitPlanCoversOrder && signatureDebitPlan.length > 0
    ? Array.from(signatureDebitPlan.reduce((groups, line) => {
        const lines = groups.get(line.cardId) ?? [];
        lines.push(line);
        groups.set(line.cardId, lines);
        return groups;
      }, new Map<string, MemberCardDebitPlanLine[]>()).entries()).flatMap<MemberCardTransaction>(([cardIdForTransaction, lines]) => {
        const debitedProjectCard = memberCards.find((card) => card.id === cardIdForTransaction);
        if (!debitedProjectCard) return [];
        const timesDelta = -lines.reduce((sum, line) => sum + line.quantity, 0);
        const serviceNote = lines
          .map((line) => `${data.services.find((service) => service.id === line.serviceId)?.name ?? "项目"} x${line.quantity}`)
          .join("、");
        return [{
          id: idFactory("mt"),
          storeId: linkedOrder.storeId ?? debitedProjectCard.storeId,
          memberCardId: debitedProjectCard.id,
          orderId: linkedOrder.id,
          staffId: linkedOrder.staffId,
          type: "消费" as const,
          amountDelta: 0,
          timesDelta,
          balanceAfter: debitedProjectCard.balance,
          remainingTimesAfter: debitedProjectCard.remainingTimes,
          note: `${linkedOrder.orderNo} · 签名确认扣卡 · ${serviceNote} · ${memberCardDebitServiceNote(lines)}`,
          createdAt: signedAt,
        }];
      })
    : [];
  const memberCardTransactions: MemberCardTransaction[] =
    signatureProjectTransactions.length
      ? [
          ...signatureProjectTransactions,
          ...data.memberCardTransactions,
        ]
      : linkedOrder && debitedCard
      ? [
          {
            id: idFactory("mt"),
            storeId: linkedOrder.storeId ?? debitedCard.storeId,
            memberCardId: debitedCard.id,
            orderId: linkedOrder.id,
            staffId: linkedOrder.staffId,
            type: "消费",
            amountDelta: debitedCard.type === "储值卡" ? -linkedOrder.paidAmount : 0,
            timesDelta: debitedCard.type === "储值卡" ? 0 : -linkedOrderServiceIds.length,
            balanceAfter: debitedCard.balance,
            remainingTimesAfter: debitedCard.remainingTimes,
            note: `${linkedOrder.orderNo} · 签名确认扣卡`,
            createdAt: signedAt,
          },
          ...data.memberCardTransactions,
        ]
      : data.memberCardTransactions;
  const primaryDebitedCardId = signatureDebitPlan[0]?.cardId ?? debitCard?.id;
  const orders = primaryDebitedCardId && linkedOrder
    ? data.orders.map((order) =>
        order.id === linkedOrder.id ? { ...order, cardId: primaryDebitedCardId, payMethod: "会员卡" as const } : order,
      )
    : data.orders;
  const completesServiceAppointment = signature.title === "服务完成确认签名" && Boolean(linkedOrder?.appointmentId);
  const appointments = completesServiceAppointment && linkedOrder?.appointmentId
    ? data.appointments.map((appointment) =>
        appointment.id === linkedOrder.appointmentId && appointment.status !== "已完成"
          ? { ...appointment, status: "已完成" as const, completedAt: appointment.completedAt ?? signedAt, updatedAt: signedAt }
          : appointment,
      )
    : data.appointments;
  return {
    ...data,
    appointments,
    memberCards,
    memberCardTransactions,
    orders,
    customerSignatures: (data.customerSignatures ?? []).map((item) =>
      item.id === signature.id
        ? {
            ...item,
            status: "已签名",
            signerName,
            signatureText,
            signedAt,
          }
        : item,
    ),
  };
}

function memberCardEntitlementRemainingTimes(entitlements: NonNullable<MemberCard["serviceEntitlements"]>) {
  return entitlements.reduce((sum, item) => sum + Math.max(0, Math.floor(item.remainingTimes)), 0);
}

export function normalizeMemberCardServiceEntitlements(entitlements: MemberCard["serviceEntitlements"] | undefined) {
  if (!entitlements?.length) return [];
  const merged = new Map<string, NonNullable<MemberCard["serviceEntitlements"]>[number]>();
  for (const item of entitlements) {
    const serviceId = trimText(item.serviceId);
    const totalTimes = Math.max(0, Math.floor(positiveNumber(item.totalTimes)));
    if (!serviceId || totalTimes <= 0) continue;
    const remainingTimesInput = typeof item.remainingTimes === "number" && Number.isFinite(item.remainingTimes)
      ? item.remainingTimes
      : totalTimes;
    const remainingTimes = Math.min(totalTimes, Math.max(0, Math.floor(remainingTimesInput)));
    const previous = merged.get(serviceId);
    merged.set(serviceId, previous
      ? {
          serviceId,
          totalTimes: previous.totalTimes + totalTimes,
          remainingTimes: previous.remainingTimes + remainingTimes,
        }
      : { serviceId, totalTimes, remainingTimes });
  }
  return Array.from(merged.values());
}

export function memberCardServiceEntitlement(card: MemberCard, serviceId: string) {
  return normalizeMemberCardServiceEntitlements(card.serviceEntitlements)
    .find((item) => item.serviceId === serviceId);
}

function updateMemberCardServiceTimes(card: MemberCard, serviceId: string, delta: number) {
  if (!card.serviceEntitlements?.length) {
    return { ...card, remainingTimes: Math.max(0, card.remainingTimes + delta) };
  }
  const serviceEntitlements = normalizeMemberCardServiceEntitlements(card.serviceEntitlements).map((item) =>
    item.serviceId === serviceId
      ? {
          ...item,
          remainingTimes: Math.min(item.totalTimes, Math.max(0, item.remainingTimes + delta)),
        }
      : item,
  );
  return {
    ...card,
    remainingTimes: memberCardEntitlementRemainingTimes(serviceEntitlements),
    serviceEntitlements,
  };
}

function memberCardTransactionServiceIds(data: AppData, order: Order, transaction: MemberCardTransaction, card: MemberCard) {
  const debitCount = Math.max(0, Math.abs(Math.floor(transaction.timesDelta)));
  if (debitCount === 0) return [];
  const orderServiceIds = order.serviceIds?.length ? order.serviceIds : order.serviceId ? [order.serviceId] : [];
  const markerIndex = transaction.note.indexOf(memberCardDebitServiceNotePrefix);
  if (markerIndex >= 0) {
    const markerText = transaction.note.slice(markerIndex + memberCardDebitServiceNotePrefix.length).split("·")[0] ?? "";
    const markerServiceIds = markerText
      .split(",")
      .map((serviceId) => serviceId.trim())
      .filter((serviceId) => serviceId && memberCardSupportsService(card, serviceId));
    if (markerServiceIds.length) return markerServiceIds.slice(0, debitCount);
  }

  const serviceIdsFromNames = orderServiceIds.filter((serviceId) => {
    const serviceName = data.services.find((service) => service.id === serviceId)?.name;
    return Boolean(serviceName && transaction.note.includes(serviceName) && memberCardSupportsService(card, serviceId));
  });
  if (serviceIdsFromNames.length) return serviceIdsFromNames.slice(0, debitCount);

  return orderServiceIds
    .filter((serviceId) => memberCardSupportsService(card, serviceId))
    .slice(0, debitCount);
}

function memberCardCanUseForService(card: MemberCard, serviceId: string) {
  if (card.type === "储值卡") return true;
  if (card.type === "折扣卡") return false;
  if (!serviceId) return false;
  if (card.serviceEntitlements?.length) {
    const entitlement = memberCardServiceEntitlement(card, serviceId);
    return Boolean(entitlement && entitlement.remainingTimes > 0);
  }
  return card.remainingTimes > 0 && memberCardSupportsService(card, serviceId);
}

function memberCardSupportsService(card: MemberCard, serviceId: string) {
  if (card.type === "储值卡") return true;
  if (!serviceId) return false;
  if (card.serviceEntitlements?.length) return card.serviceEntitlements.some((item) => item.serviceId === serviceId);
  if (card.serviceIds?.length) return card.serviceIds.includes(serviceId);
  if (card.serviceId && card.serviceId !== serviceId) return false;
  return true;
}

function selectSignatureDebitCard(data: AppData, order: Order) {
  if (!order.customerId || !order.serviceId) return undefined;
  const orderServiceIds = order.serviceIds?.length ? order.serviceIds : [order.serviceId];
  const explicitCard = order.cardId
    ? data.memberCards.find((card) => card.id === order.cardId && canDebitCardForOrder(card, order))
    : undefined;
  if (explicitCard) return explicitCard;
  const cards = data.memberCards
    .filter((card) => canDebitCardForOrder(card, order))
    .sort((a, b) => signatureDebitCardPriority(a, orderServiceIds[0] ?? order.serviceId) - signatureDebitCardPriority(b, orderServiceIds[0] ?? order.serviceId));
  return cards[0];
}

function canDebitCardForOrder(card: MemberCard, order: Order) {
  if (card.customerId !== order.customerId || card.status !== "正常") return false;
  if (card.type === "储值卡") return card.balance >= order.paidAmount;
  if (card.type === "折扣卡") return false;
  const orderServiceIds = order.serviceIds?.length ? order.serviceIds : [order.serviceId];
  return Array.from(serviceQuantityCounts(orderServiceIds)).every(([serviceId, quantity]) =>
    memberCardSupportsService(card, serviceId) && memberCardRemainingForService(card, serviceId) >= quantity,
  );
}

function signatureDebitCardPriority(card: MemberCard, serviceId: string) {
  const serviceSpecific = card.serviceId === serviceId || Boolean(card.serviceIds?.includes(serviceId));
  const typePriority = card.type === "次数卡" ? 0 : card.type === "套餐卡" ? 1 : card.type === "储值卡" ? 2 : 3;
  return (serviceSpecific ? 0 : 10) + typePriority;
}

export function addCustomerFollowUp(
  data: AppData,
  input: CustomerFollowUpInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  return {
    ...data,
    customerFollowUps: [
      {
        id: idFactory("fu"),
        storeId: scopedStoreId(data, storeIdForCustomer(data, input.customerId) ?? storeIdForStaff(data, input.staffId)),
        customerId: input.customerId,
        staffId: input.staffId,
        dueAt: input.dueAt,
        method: input.method,
        note: input.note,
        status: "待跟进",
        createdAt,
      },
      ...data.customerFollowUps,
    ],
  };
}

export function completeCustomerFollowUp(
  data: AppData,
  input: CompleteFollowUpInput,
  options: { now?: () => string } = {},
): AppData {
  const completedAt = (options.now ?? nowIso)();
  return {
    ...data,
    customerFollowUps: data.customerFollowUps.map((item) =>
      item.id === input.followUpId ? { ...item, status: "已完成", completedAt } : item,
    ),
  };
}

export function settleCommissions(
  data: AppData,
  input: SettleCommissionInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  // Scope settlement to a single store when the caller is store-bound. A
  // superadmin has no storeId (undefined) and keeps the "settle all pending"
  // behaviour. Without this, a store settlement would sweep other stores'
  // pending commissions into one payout.
  const scopeStoreId = input.storeId;
  const isPending = (item: Commission) =>
    item.status === "待结算" && (scopeStoreId == null || (item.storeId ?? defaultStoreId(data)) === scopeStoreId);
  const pending = data.commissions.filter(isPending);
  if (!pending.length) throw new Error("暂无待结算提成");
  const settlementId = idFactory("cs");
  const settlement: CommissionSettlement = {
    id: settlementId,
    type: "员工提成",
    commissionIds: pending.map((item) => item.id),
    amount: pending.reduce((sum, item) => sum + item.amount, 0),
    count: pending.length,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    commissions: data.commissions.map((item) =>
      isPending(item) ? { ...item, status: "已结算", settledAt: createdAt, settlementId } : item,
    ),
    commissionSettlements: [settlement, ...data.commissionSettlements],
  };
}

export function cashFlowSummary(data: AppData, referenceData: AppData = data) {
  const referenceOrderById = new Map(referenceData.orders.map((order) => [order.id, order]));
  const referenceRefundAmountByOrder = new Map<string, number>();
  referenceData.refunds.forEach((refund) => {
    referenceRefundAmountByOrder.set(refund.orderId, (referenceRefundAmountByOrder.get(refund.orderId) ?? 0) + Math.max(0, refund.amount));
  });
  const originalPaidAmount = (order: Order) => roundMoneyValue(
    Math.max(0, order.paidAmount) + (referenceRefundAmountByOrder.get(order.id) ?? 0),
  );
  const visibleRefundAmountByOrder = new Map<string, number>();
  data.refunds.forEach((refund) => {
    visibleRefundAmountByOrder.set(refund.orderId, (visibleRefundAmountByOrder.get(refund.orderId) ?? 0) + Math.max(0, refund.amount));
  });
  const referenceRefundOrderIds = new Set(referenceRefundAmountByOrder.keys());
  const orderCashRevenue = data.orders
    .filter((item) => item.payMethod !== "会员卡")
    .reduce((sum, item) => sum + originalPaidAmount(item), 0);
  const revenue = orderCashRevenue + data.memberCardTransactions.reduce((sum, item) => sum + memberCardCashIn(item), 0);
  const refundAmount = data.refunds
    .filter((refund) => referenceOrderById.get(refund.orderId)?.payMethod !== "会员卡")
    .reduce((sum, item) => sum + item.amount, 0)
    + data.memberCardTransactions.reduce((sum, item) => sum + memberCardCashRefund(item), 0);
  const orderCount = data.orders.filter((order) => {
    const visibleRefundAmount = visibleRefundAmountByOrder.get(order.id) ?? 0;
    if (visibleRefundAmount > 0) return visibleRefundAmount < originalPaidAmount(order);
    if (referenceRefundOrderIds.has(order.id)) return true;
    return order.status !== "已退款";
  }).length;
  return { revenue, refundAmount, netRevenue: revenue - refundAmount, orderCount };
}

export function reportSummary(data: AppData, referenceData: AppData = data) {
  const cashFlow = cashFlowSummary(data, referenceData);
  const referenceRefundAmountByOrder = new Map<string, number>();
  referenceData.refunds.forEach((refund) => {
    referenceRefundAmountByOrder.set(refund.orderId, (referenceRefundAmountByOrder.get(refund.orderId) ?? 0) + Math.max(0, refund.amount));
  });
  const originalPaidAmount = (order: Order) => roundMoneyValue(
    Math.max(0, order.paidAmount) + (referenceRefundAmountByOrder.get(order.id) ?? 0),
  );
  const visibleRefundAmountByOrder = new Map<string, number>();
  data.refunds.forEach((refund) => {
    visibleRefundAmountByOrder.set(refund.orderId, (visibleRefundAmountByOrder.get(refund.orderId) ?? 0) + Math.max(0, refund.amount));
  });
  const referenceRefundOrderIds = new Set(referenceRefundAmountByOrder.keys());
  const cardBalance = data.memberCards.reduce((sum, item) => sum + item.balance, 0);
  const commission = commissionAccrualAmount(data, referenceData);
  const effectiveOrders = data.orders.filter((order) => {
    const visibleRefundAmount = visibleRefundAmountByOrder.get(order.id) ?? 0;
    if (visibleRefundAmount > 0) {
      return visibleRefundAmount < originalPaidAmount(order);
    }
    if (referenceRefundOrderIds.has(order.id)) return true;
    return order.status !== "已退款";
  });
  const serviceCount = effectiveOrders.length;
  const inventoryBatches = data.inventoryBatches ?? [];
  const inventoryCost = inventoryBatches.length
    ? inventoryBatches.reduce((sum, batch) => sum + batch.remainingQuantity * batch.unitCost, 0)
    : data.products.reduce((sum, product) => sum + product.stock * product.cost, 0);
  const orderProductCost = effectiveOrders.reduce((sum, order) => {
    const productItems = [
      ...(order.productItems ?? (order.productId ? [{ productId: order.productId, quantity: 1, unitPrice: 0, amount: 0 }] : [])),
      ...(order.giftProductItems ?? (order.giftProductId ? [{ productId: order.giftProductId, quantity: 1, unitPrice: 0, amount: 0 }] : [])),
    ];
    const directProductCost = productItems.reduce((itemSum, item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId);
      return itemSum + (product?.cost ?? 0) * item.quantity;
    }, 0);
    const serviceConsumables = order.serviceConsumables ?? legacyOrderServiceInventoryConsumables(data, order);
    const serviceCost = serviceConsumables.reduce((itemSum, item) => {
      const product = data.products.find((candidate) => candidate.id === item.productId);
      return itemSum + (product?.cost ?? 0) * item.quantity;
    }, 0);
    return sum + directProductCost + serviceCost;
  }, 0);
  const customerOrderCounts = new Map<string, number>();
  effectiveOrders.forEach((order) => {
    if (!order.customerId) return;
    customerOrderCounts.set(order.customerId, (customerOrderCounts.get(order.customerId) ?? 0) + 1);
  });
  const repeatCustomerCount = Array.from(customerOrderCounts.values()).filter((count) => count >= 2).length;
  const activeCustomerCount = customerOrderCounts.size;
  const expiringInventoryCount = inventoryBatches.filter((batch) => {
    if (!batch.expiryAt || batch.remainingQuantity <= 0) return false;
    const days = Math.ceil((Date.parse(`${batch.expiryAt}T00:00:00.000Z`) - Date.now()) / 86400000);
    return Number.isFinite(days) && days <= 30;
  }).length;

  return {
    revenue: cashFlow.revenue,
    refundAmount: cashFlow.refundAmount,
    netRevenue: cashFlow.netRevenue,
    cardBalance,
    commission,
    serviceCount,
    averageOrderValue: serviceCount ? cashFlow.revenue / serviceCount : 0,
    lowStockCount: data.products.filter((item) => item.stock <= item.warningStock).length,
    inventoryCost,
    orderProductCost,
    grossProfit: cashFlow.netRevenue - orderProductCost,
    grossMargin: cashFlow.revenue > 0 ? (cashFlow.netRevenue - orderProductCost) / cashFlow.revenue : 0,
    activeCustomerCount,
    repeatCustomerCount,
    repeatRate: activeCustomerCount ? repeatCustomerCount / activeCustomerCount : 0,
    expiringInventoryCount,
    totalMemberPoints: data.customers.reduce((sum, customer) => sum + (customer.points ?? 0), 0),
  };
}

function assertBusinessDateOpen(data: AppData, businessDate: string, storeId: string) {
  if (data.dailyCloses.some((item) =>
    item.businessDate === businessDate
    && item.status === "已锁定"
    && (item.storeId ?? defaultStoreId(data)) === storeId,
  )) {
    throw new Error("该营业日已日结锁账");
  }
}

function roleNameOf(role: UserRole) {
  const names: Record<UserRole, string> = {
    superadmin: "系统管理员",
    owner: "老板",
    manager: "店长",
    frontdesk: "前台",
    therapist: "服务人员",
    finance: "财务",
  };
  return names[role];
}
