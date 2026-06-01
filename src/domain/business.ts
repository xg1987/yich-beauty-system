import type {
  AppData,
  ApprovalRequest,
  Appointment,
  CustomerFollowUp,
  CustomerSignature,
  CustomerServiceRecord,
  DataQualityIssue,
  DataQualityReport,
  DataCleanupReport,
  Commission,
  CommissionSettlement,
  DailyClose,
  DistributionCommission,
  Distributor,
  InventoryLog,
  MemberCardTransaction,
  OnlineBookingRequest,
  OnlineStorefront,
  OperationLog,
  Order,
  PurchaseOrder,
  ReferralRelation,
  Refund,
  Service,
  ServiceConsumable,
  Staff,
  StaffInvite,
  StaffShift,
  StaffUnavailableSlot,
  StoreOwnerInvite,
  SystemNotification,
  Stocktake,
  Supplier,
  TagDefinition,
  TagScope,
  UserRole,
  ViewKey,
} from "./types";
import { makeId, nowIso } from "./utils";

type IdFactory = (prefix: string) => string;

export const DEFAULT_OWNER_INVITE_CODE = "YC8M6P";

export type RegisterStoreInput = {
  storeName: string;
  ownerName: string;
  phone: string;
  address?: string;
  account: string;
  password: string;
};

export type StoreProfileInput = {
  name: string;
  phone: string;
  address: string;
  businessHours: string;
};

export type StaffInput = {
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

export type RevokeStaffInviteInput = {
  inviteId: string;
  revokedBy: string;
};

export type AccountProfileInput = {
  userId: string;
  name: string;
  avatarUrl?: string;
};

export type CheckoutInput = {
  customerId: string;
  staffId: string;
  collaboratorStaffIds?: string[];
  serviceId: string;
  productId?: string;
  discountAmount?: number;
  adjustmentReason?: string;
  approvalId?: string;
  distributorId?: string;
  appointmentId?: string;
  payMethod: Order["payMethod"];
  cardId?: string;
};

export type DistributorInput = {
  type: Distributor["type"];
  customerId?: string;
  staffId?: string;
  name?: string;
  phone?: string;
  rate: number;
};

export type ReferralRelationInput = {
  distributorId: string;
  customerId: string;
  source?: ReferralRelation["source"];
};

export type InventoryAdjustmentInput = {
  productId: string;
  type: InventoryLog["type"];
  quantity: number;
  note?: string;
};

export type ApprovalRequestInput = {
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
  orderId: string;
  reason: string;
  userId: string;
  amount?: number;
  approvalId?: string;
};

export type RefundMemberCardInput = {
  memberCardId: string;
  reason: string;
  userId: string;
};

export type OperationLogInput = {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
};

export type NotificationInput = {
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

export type NotificationReadAllInput = {
  userId: string;
  role: UserRole;
  staffId?: string;
};

export type AppointmentInput = {
  customerId: string;
  staffId: string;
  serviceId: string;
  startAt: string;
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
  startAt: string;
  note?: string;
};

export type DailyCloseInput = {
  businessDate: string;
  userId: string;
};

export type StaffUnavailableSlotInput = {
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
  userId: string;
};

export type StaffShiftInput = {
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
  note?: string;
  userId: string;
};

export type MemberCardStatusInput = {
  memberCardId: string;
  status: "正常" | "冻结";
  reason: string;
  userId: string;
};

export type MemberCardExtendInput = {
  memberCardId: string;
  expiresAt: string;
  reason: string;
  userId: string;
};

export type MemberCardTransferInput = {
  memberCardId: string;
  toCustomerId: string;
  reason: string;
  userId: string;
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
};

export type SupplierInput = {
  name: string;
  phone: string;
  contact: string;
};

export type PurchaseOrderInput = {
  supplierId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  userId: string;
};

export type StocktakeInput = {
  productId: string;
  actualStock: number;
  reason: string;
  userId: string;
};

export type TagDefinitionInput = {
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

export function calculateOrderTotal(data: AppData, serviceId: string, productId?: string) {
  const selectedService = data.services.find((item) => item.id === serviceId);
  const selectedProduct = data.products.find((item) => item.id === productId);
  return (selectedService?.price ?? 0) + (selectedProduct?.price ?? 0);
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

function serviceConsumables(service: Service): ServiceConsumable[] {
  const consumables = service.consumables?.filter((item) => item.productId && item.quantity > 0) ?? [];
  if (consumables.length > 0) return consumables;
  if (service.consumableProductId && (service.consumableQty ?? 0) > 0) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
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
): Commission | undefined {
  if (baseAmount <= 0 || rate <= 0) return undefined;
  return {
    id: idFactory("cm"),
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

export function registerStore(
  data: AppData,
  input: RegisterStoreInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  if (data.authUsers.some((user) => user.account === input.account)) {
    throw new Error("登录账号已存在");
  }

  const staffId = idFactory("s");
  const ownerUserId = idFactory("u");
  return {
    ...data,
    storeProfiles: [
      {
        id: data.storeProfiles[0]?.id ?? idFactory("store"),
        name: input.storeName,
        phone: input.phone,
        address: input.address ?? "",
        businessHours: "10:00 - 21:00",
        createdAt,
      },
    ],
    staff: [
      {
        id: staffId,
        name: input.ownerName,
        phone: input.phone,
        role: "老板",
        status: "active",
        accountId: ownerUserId,
        hiredAt: createdAt.slice(0, 10),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: ownerUserId,
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
        userId: ownerUserId,
        action: "注册门店",
        targetType: "store",
        targetId: data.storeProfiles[0]?.id ?? "store",
        summary: `${input.storeName} 完成门店注册`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function updateStoreProfile(data: AppData, input: StoreProfileInput): AppData {
  const current = data.storeProfiles[0];
  if (!current) throw new Error("请先完成门店注册");
  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  const businessHours = input.businessHours.trim();
  if (!name) throw new Error("请输入门店名称");
  if (!phone) throw new Error("请输入门店电话");
  if (!businessHours) throw new Error("请输入营业时间");

  return {
    ...data,
    storeProfiles: [
      {
        ...current,
        name,
        phone,
        address,
        businessHours,
      },
      ...data.storeProfiles.slice(1),
    ],
  };
}

export function formalDataAudit(data: AppData): DataQualityReport {
  const issues: DataQualityIssue[] = [];
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
  const store = data.storeProfiles[0];
  if (!store) throw new Error("请先完成门店注册");
  if (!/^[a-zA-Z0-9-]{4,32}$/.test(input.shareCode)) throw new Error("分享码只能包含字母、数字和短横线，长度 4-32 位");
  if (input.enabledServiceIds.length === 0) throw new Error("至少选择一个线上展示项目");
  const enabledServiceIds = Array.from(new Set(input.enabledServiceIds));
  if (!enabledServiceIds.every((serviceId) => data.services.some((service) => service.id === serviceId))) {
    throw new Error("线上项目不存在");
  }

  const current = data.onlineStorefronts[0];
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
    onlineStorefronts: [storefront],
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
  if (!storefront.enabledServiceIds.includes(input.serviceId)) throw new Error("该项目暂未开放线上预约");
  if (+new Date(input.preferredAt) <= +new Date(createdAt)) throw new Error("预约意向时间必须晚于当前时间");

  const request: OnlineBookingRequest = {
    id: idFactory("obr"),
    storefrontId: storefront.id,
    customerName: input.customerName.trim(),
    phone: input.phone.trim(),
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
  const phone = input.phone.trim();
  const role = input.role.trim();
  if (!name) throw new Error("请输入员工姓名");
  if (!phone) throw new Error("请输入员工手机号");
  if (!role) throw new Error("请选择员工岗位");
  if ((input.baseSalary ?? 0) < 0) throw new Error("底薪不能小于 0");
  if ((input.commissionRate ?? 0) < 0) throw new Error("提成比例不能小于 0");
  const staff: Staff = {
    id: idFactory("s"),
    name,
    phone,
    role,
    status: "active",
    hiredAt: createdAt.slice(0, 10),
    baseSalary: input.baseSalary ?? 0,
    commissionRate: input.commissionRate ?? 0,
  };
  return { ...data, staff: [staff, ...data.staff] };
}

export function updateStaffMember(data: AppData, input: StaffUpdateInput): AppData {
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  const name = input.name?.trim();
  const phone = input.phone?.trim();
  const role = input.role?.trim();
  if (input.name !== undefined && !name) throw new Error("请输入员工姓名");
  if (input.phone !== undefined && !phone) throw new Error("请输入员工手机号");
  if (input.role !== undefined && !role) throw new Error("请选择员工岗位");
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

export function createStaffInvite(
  data: AppData,
  input: StaffInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const validDays = input.validDays ?? 7;
  const account = input.account.trim();
  const staff = data.staff.find((item) => item.id === input.staffId);
  if (!staff) throw new Error("员工不存在");
  if (!account) throw new Error("请输入员工登录账号");
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
    staffId: staff.id,
    account,
    role: input.role,
    status: "待加入",
    inviteCode: idFactory("join"),
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
  const validDays = input.validDays ?? 7;
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
    inviteCode: idFactory("boss"),
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
  return {
    ...data,
    authUsers: [
      {
        id: userId,
        name: input.name.trim() || staff.name,
        account: invite.account,
        password: input.password,
        role: invite.role,
        roleName: roleNameOf(invite.role),
        staffId: staff.id,
        status: "active",
        createdAt,
      },
      ...data.authUsers,
    ],
    staff: data.staff.map((item) => (item.id === staff.id ? { ...item, name: input.name.trim() || item.name, accountId: userId } : item)),
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
  const isFixedInvite = inviteCode === DEFAULT_OWNER_INVITE_CODE;
  if (!invite && !isFixedInvite) throw new Error("邀请不存在或已失效");
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
  const storeId = idFactory("store");
  const staffId = idFactory("s");
  const userId = idFactory("u");
  return {
    ...data,
    storeProfiles: [
      {
        id: storeId,
        name: storeName,
        phone,
        address,
        businessHours: "10:00 - 21:00",
        createdAt,
      },
      ...data.storeProfiles,
    ],
    staff: [
      {
        id: staffId,
        name: ownerName,
        phone,
        role: "老板",
        status: "active",
        accountId: userId,
        hiredAt: createdAt.slice(0, 10),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: userId,
        name: ownerName,
        account,
        password: input.password,
        role: "owner",
        roleName: roleNameOf("owner"),
        staffId,
        status: "active",
        createdAt,
      },
      ...data.authUsers,
    ],
    storeOwnerInvites: (data.storeOwnerInvites ?? []).map((item) =>
      item.id === invite?.id ? { ...item, status: "已加入", joinedAt: createdAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId,
        action: "老板邀请码注册",
        targetType: "store",
        targetId: storeId,
        summary: `${storeName} 通过系统邀请码开通老板账号`,
        createdAt,
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
  if (inviteCode === DEFAULT_OWNER_INVITE_CODE || (data.storeOwnerInvites ?? []).some((item) => item.inviteCode.trim().toUpperCase() === inviteCode && item.status === "待加入")) {
    return joinStoreOwnerInvite(data, input, options);
  }
  return joinStaffInvite(data, input, options);
}

export function accountForInvite(data: AppData, inviteCode: string, fallbackAccount?: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return (normalizedInviteCode === DEFAULT_OWNER_INVITE_CODE ? fallbackAccount : undefined)
    ?? (data.storeOwnerInvites ?? []).find((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode)?.account
    ?? data.staffInvites.find((item) => item.inviteCode === inviteCode.trim())?.account;
}

export function createDistributor(
  data: AppData,
  input: DistributorInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  if (input.rate <= 0 || input.rate > 0.5) throw new Error("分销比例必须在 0 到 50% 之间");

  const customer = input.customerId ? data.customers.find((item) => item.id === input.customerId) : undefined;
  const staff = input.staffId ? data.staff.find((item) => item.id === input.staffId) : undefined;
  if (input.type === "客户" && !customer) throw new Error("客户分销员不存在");
  if (input.type === "员工" && !staff) throw new Error("员工分销员不存在");
  if (input.type === "客户" && data.distributors.some((item) => item.customerId === input.customerId && item.status === "启用")) {
    throw new Error("该客户已是启用分销员");
  }
  if (input.type === "员工" && data.distributors.some((item) => item.staffId === input.staffId && item.status === "启用")) {
    throw new Error("该员工已是启用分销员");
  }

  const baseName = customer?.name ?? staff?.name ?? input.name;
  const basePhone = customer?.phone ?? staff?.phone ?? input.phone;
  if (!baseName || !basePhone) throw new Error("分销员姓名和手机号不能为空");

  const distributor: Distributor = {
    id: idFactory("ds"),
    type: input.type,
    customerId: customer?.id,
    staffId: staff?.id,
    name: baseName,
    phone: basePhone,
    rate: input.rate,
    status: "启用",
    inviteCode: idFactory("share"),
    createdAt,
  };
  return {
    ...data,
    distributors: [distributor, ...data.distributors],
  };
}

export function bindReferralRelation(
  data: AppData,
  input: ReferralRelationInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const distributor = data.distributors.find((item) => item.id === input.distributorId && item.status === "启用");
  if (!distributor) throw new Error("分销员不存在或已停用");
  if (!data.customers.some((item) => item.id === input.customerId)) throw new Error("客户不存在");
  if (distributor.customerId === input.customerId) throw new Error("分销员不能绑定自己为客户");
  if (data.referralRelations.some((item) => item.customerId === input.customerId && item.status === "有效")) {
    throw new Error("该客户已有有效分销归属");
  }

  const relation: ReferralRelation = {
    id: idFactory("rr"),
    distributorId: distributor.id,
    customerId: input.customerId,
    source: input.source ?? "手工绑定",
    status: "有效",
    createdAt,
  };
  return {
    ...data,
    referralRelations: [relation, ...data.referralRelations],
  };
}

export function checkoutOrder(
  data: AppData,
  input: CheckoutInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const selectedService = data.services.find((item) => item.id === input.serviceId);

  if (!selectedService) {
    throw new Error("服务项目不存在");
  }

  assertBusinessDateOpen(data, currentTime().slice(0, 10));
  const appointment = input.appointmentId ? data.appointments.find((item) => item.id === input.appointmentId) : undefined;
  if (input.appointmentId && !appointment) {
    throw new Error("预约不存在");
  }
  if (appointment) {
    if (appointment.status !== "已到店") {
      throw new Error("只有已到店预约可以直接收银");
    }
    if (appointment.customerId !== input.customerId || appointment.staffId !== input.staffId || appointment.serviceId !== input.serviceId) {
      throw new Error("收银信息与预约不一致");
    }
    if (data.orders.some((order) => order.appointmentId === appointment.id && order.status !== "已退款")) {
      throw new Error("该预约已完成收银");
    }
  }

  const selectedCard = input.payMethod === "会员卡"
    ? data.memberCards.find((item) => item.id === input.cardId && item.customerId === input.customerId)
    : undefined;
  if (input.payMethod === "会员卡") {
    if (!selectedCard || selectedCard.status !== "正常") {
      throw new Error("请选择有效会员卡");
    }
    if (selectedCard.type !== "储值卡" && selectedCard.remainingTimes <= 0) {
      throw new Error("会员卡次数不足");
    }
    if (selectedCard.type !== "储值卡" && selectedCard.serviceId && selectedCard.serviceId !== input.serviceId) {
      throw new Error("该次数卡不可用于当前项目");
    }
    if (selectedCard.type !== "储值卡" && selectedCard.serviceIds?.length && !selectedCard.serviceIds.includes(input.serviceId)) {
      throw new Error("该套餐卡不可用于当前项目");
    }
  }

  const total = calculateOrderTotal(data, input.serviceId, input.productId);
  const discountAmount = input.discountAmount ?? 0;
  if (discountAmount < 0) {
    throw new Error("折扣金额无效");
  }
  if (discountAmount > 0 && !hasApprovedRequest(data, input.approvalId, "改价折扣", discountAmount)) {
    throw new Error("改价折扣需要审批通过");
  }
  const orderId = idFactory("o");
  const totalDiscount = discountAmount;
  if (totalDiscount >= total) {
    throw new Error("优惠金额无效");
  }
  const paidAmount = total - totalDiscount;
  const createdAt = currentTime();
  if (selectedCard?.type === "储值卡" && selectedCard.balance < paidAmount) {
    throw new Error("会员卡余额不足");
  }
  const existingReferral = data.referralRelations.find((item) => item.customerId === input.customerId && item.status === "有效");
  const selectedDistributor = input.distributorId
    ? data.distributors.find((item) => item.id === input.distributorId)
    : existingReferral
      ? data.distributors.find((item) => item.id === existingReferral.distributorId)
      : undefined;
  if (input.distributorId && !selectedDistributor) throw new Error("分销员不存在");
  if (selectedDistributor && selectedDistributor.status !== "启用") {
    throw new Error("分销员已停用");
  }
  if (selectedDistributor?.customerId === input.customerId) {
    throw new Error("分销员不能给自己产生分销佣金");
  }
  const order: Order = {
    id: orderId,
    orderNo: `SO${Date.now().toString().slice(-8)}`,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    productId: input.productId,
    cardId: input.payMethod === "会员卡" ? input.cardId : undefined,
    totalAmount: total,
    paidAmount,
    discountAmount: totalDiscount,
    adjustmentReason: input.adjustmentReason,
    approvalId: input.approvalId,
    distributorId: selectedDistributor?.id,
    appointmentId: appointment?.id,
    payMethod: input.payMethod,
    status: "已支付",
    createdAt,
  };

  const serviceConsumption = serviceConsumables(selectedService);
  const consumptionByProduct = new Map<string, number>();
  for (const item of serviceConsumption) {
    consumptionByProduct.set(item.productId, (consumptionByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  if (input.productId) consumptionByProduct.set(input.productId, (consumptionByProduct.get(input.productId) ?? 0) + 1);
  for (const [productId, quantity] of consumptionByProduct) {
    const product = data.products.find((item) => item.id === productId);
    if (!product) throw new Error("耗材或商品不存在");
    if (product.stock < quantity) throw new Error(`${product.name} 库存不足`);
  }

  const products = data.products.map((product) => {
    let delta = 0;
    delta -= consumptionByProduct.get(product.id) ?? 0;
    return delta ? { ...product, stock: product.stock + delta } : product;
  });

  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];
  const changedProducts = products.filter((product) => data.products.find((old) => old.id === product.id)?.stock !== product.stock);
  changedProducts.forEach((product) => {
    const previousProduct = data.products.find((item) => item.id === product.id);
    if (!previousProduct) return;
    inventoryLogs.unshift({
      id: idFactory("il"),
      productId: product.id,
      type: product.id === input.productId ? "销售出库" : "服务消耗",
      delta: product.stock - previousProduct.stock,
      stockAfter: product.stock,
      note: order.orderNo,
      createdAt,
    });
  });

  const memberCards = data.memberCards.map((card) => {
    if (input.payMethod !== "会员卡" || card.id !== input.cardId) return card;
    if (card.type === "储值卡") return { ...card, balance: Math.max(0, card.balance - paidAmount) };
    return { ...card, remainingTimes: Math.max(0, card.remainingTimes - 1) };
  });

  const selectedCardAfterCheckout = memberCards.find((card) => card.id === input.cardId);
  const memberCardTransactions: MemberCardTransaction[] =
    input.payMethod === "会员卡" && selectedCardAfterCheckout
      ? [
          {
            id: idFactory("mt"),
            memberCardId: selectedCardAfterCheckout.id,
            orderId,
            type: "消费",
            amountDelta: selectedCardAfterCheckout.type === "储值卡" ? -paidAmount : 0,
            timesDelta: selectedCardAfterCheckout.type === "储值卡" ? 0 : -1,
            balanceAfter: selectedCardAfterCheckout.balance,
            remainingTimesAfter: selectedCardAfterCheckout.remainingTimes,
            note: order.orderNo,
            createdAt,
          },
          ...data.memberCardTransactions,
        ]
      : data.memberCardTransactions;
  const selectedProduct = input.productId ? data.products.find((item) => item.id === input.productId) : undefined;
  const productCommissionBase = selectedProduct ? Math.round(paidAmount * (selectedProduct.price / total)) : 0;
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
  );
  const commissions: Commission[] = salesCommission ? [salesCommission, ...serviceCommissions] : serviceCommissions;
  const shouldCreateReferralRelation =
    selectedDistributor && !existingReferral && !data.referralRelations.some((item) => item.customerId === input.customerId && item.status === "有效");
  const referralRelations = shouldCreateReferralRelation
    ? [
        {
          id: idFactory("rr"),
          distributorId: selectedDistributor.id,
          customerId: input.customerId,
          source: "手工绑定" as const,
          status: "有效" as const,
          createdAt,
        },
        ...data.referralRelations,
      ]
    : data.referralRelations;
  const distributionCommission: DistributionCommission | undefined = selectedDistributor
    ? {
        id: idFactory("dc"),
        distributorId: selectedDistributor.id,
        customerId: input.customerId,
        orderId,
        baseAmount: paidAmount,
        rate: selectedDistributor.rate,
        amount: Math.round(paidAmount * selectedDistributor.rate),
        status: "待结算",
        createdAt,
      }
    : undefined;

  return {
    ...data,
    products,
    memberCards,
    inventoryLogs,
    orders: [order, ...data.orders],
    memberCardTransactions,
    referralRelations,
    customers: data.customers.map((customer) => (customer.id === input.customerId ? { ...customer, lastVisit: createdAt } : customer)),
    appointments: appointment
      ? data.appointments.map((item) =>
          item.id === appointment.id ? { ...item, status: "已完成", completedAt: createdAt, updatedAt: createdAt } : item,
        )
      : data.appointments,
    commissions: [...commissions, ...data.commissions],
    distributionCommissions: distributionCommission ? [distributionCommission, ...data.distributionCommissions] : data.distributionCommissions,
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

  assertBusinessDateOpen(data, order.createdAt.slice(0, 10));

  const refundAmount = input.amount ?? order.paidAmount;
  if (refundAmount <= 0 || refundAmount > order.paidAmount) {
    throw new Error("退款金额无效");
  }

  const isFullRefund = refundAmount === order.paidAmount;
  if (refundAmount > 1000 && !hasApprovedRequest(data, input.approvalId, "订单退款", refundAmount)) {
    throw new Error("大额退款需要审批通过");
  }

  const service = data.services.find((item) => item.id === order.serviceId);
  const refund: Refund = {
    id: idFactory("rf"),
    orderId: order.id,
    amount: refundAmount,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };

  let products = data.products;
  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];

  const restoreProduct = (productId: string | undefined, quantity: number) => {
    if (!productId || quantity <= 0) return;
    products = products.map((product) => {
      if (product.id !== productId) return product;
      const stockAfter = product.stock + quantity;
      inventoryLogs.unshift({
        id: idFactory("il"),
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

  if (isFullRefund) {
    if (service) {
      serviceConsumables(service).forEach((item) => restoreProduct(item.productId, item.quantity));
    }
    restoreProduct(order.productId, order.productId ? 1 : 0);
  }

  let memberCards = data.memberCards;
  let memberCardTransactions = data.memberCardTransactions;
  if (order.payMethod === "会员卡" && order.cardId) {
    memberCards = data.memberCards.map((card) => {
      if (card.id !== order.cardId) return card;
      if (card.type !== "储值卡" && !isFullRefund) {
        throw new Error("次数卡订单只支持全额退款");
      }
      const nextCard =
        card.type === "储值卡"
          ? { ...card, balance: card.balance + refundAmount }
          : { ...card, remainingTimes: card.remainingTimes + 1 };

      memberCardTransactions = [
        {
          id: idFactory("mt"),
          memberCardId: card.id,
          orderId: order.id,
          type: "退款",
          amountDelta: card.type === "储值卡" ? refundAmount : 0,
          timesDelta: card.type === "储值卡" ? 0 : 1,
          balanceAfter: nextCard.balance,
          remainingTimesAfter: nextCard.remainingTimes,
          note: `${order.orderNo} 退款`,
          createdAt,
        },
        ...memberCardTransactions,
      ];
      return nextCard;
    });
  }

  return {
    ...data,
    products,
    memberCards,
    memberCardTransactions,
    inventoryLogs,
    refunds: [refund, ...data.refunds],
    orders: data.orders.map((item) =>
      item.id === order.id
        ? {
            ...item,
            paidAmount: item.paidAmount - refundAmount,
            status: isFullRefund ? "已退款" : "部分退款",
          }
        : item,
    ),
    commissions: data.commissions.map((item) =>
      item.orderId === order.id
        ? {
            ...item,
            amount: isFullRefund ? item.amount : Math.round(item.amount * ((order.paidAmount - refundAmount) / order.paidAmount)),
            status: isFullRefund ? "已冲销" : item.status,
          }
        : item,
    ),
    distributionCommissions: data.distributionCommissions.map((item) =>
      item.orderId === order.id
        ? {
            ...item,
            amount: isFullRefund ? item.amount : Math.round(item.amount * ((order.paidAmount - refundAmount) / order.paidAmount)),
            status: isFullRefund ? "已冲销" : item.status,
          }
        : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "订单退款",
        targetType: "order",
        targetId: order.id,
        summary: `${order.orderNo} ${isFullRefund ? "全额退款" : "部分退款"} ${refund.amount} 元：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
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

  if (card.status === "已退卡") {
    throw new Error("会员卡已退卡");
  }

  const amountDelta = -card.balance;
  const timesDelta = -card.remainingTimes;

  return {
    ...data,
    memberCards: data.memberCards.map((item) =>
      item.id === card.id ? { ...item, balance: 0, remainingTimes: 0, status: "已退卡" } : item,
    ),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "退卡",
        amountDelta,
        timesDelta,
        balanceAfter: 0,
        remainingTimesAfter: 0,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "会员退卡",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 退卡：余额 ${card.balance}，次数 ${card.remainingTimes}，原因：${input.reason}`,
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
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const request: ApprovalRequest = {
    id: idFactory("ap"),
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
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可充值");

  const amountDelta = (input.amount ?? 0) + (input.giftAmount ?? 0);
  const timesDelta = (input.times ?? 0) + (input.giftTimes ?? 0);
  if (amountDelta <= 0 && timesDelta <= 0) throw new Error("充值金额或次数无效");

  const nextCard = {
    ...card,
    balance: card.balance + amountDelta,
    remainingTimes: card.remainingTimes + timesDelta,
  };

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? nextCard : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "充值",
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
        summary: `${card.name} 充值 ${amountDelta} 元 / ${timesDelta} 次`,
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
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可操作");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, status: input.status } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
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
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可延期");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, expiresAt: input.expiresAt } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
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
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可转卡");
  if (!data.customers.some((customer) => customer.id === input.toCustomerId)) throw new Error("转入客户不存在");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, customerId: input.toCustomerId } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
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
    title: input.title,
    desc: input.desc,
    view: input.view,
    targetType: input.targetType,
    targetId: input.targetId,
    audienceRoles: input.audienceRoles,
    staffId: input.staffId,
    readByUserIds: [],
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
  validateAppointmentSchedule(data, {
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    startAt: input.startAt,
  });

  return {
    ...data,
    appointments: [
      {
        id: idFactory("a"),
        customerId: input.customerId,
        staffId: input.staffId,
        serviceId: input.serviceId,
        startAt: input.startAt,
        status: "待确认",
        note: input.note ?? "",
        updatedAt: (options.now ?? nowIso)(),
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
  const nextServiceId = input.serviceId ?? appointment.serviceId;
  validateAppointmentSchedule(data, {
    customerId: appointment.customerId,
    staffId: nextStaffId,
    serviceId: nextServiceId,
    startAt: input.startAt,
    excludeAppointmentId: appointment.id,
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
        startAt: input.startAt,
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

function validateAppointmentSchedule(
  data: AppData,
  input: {
    customerId: string;
    staffId: string;
    serviceId: string;
    startAt: string;
    excludeAppointmentId?: string;
  },
) {
  if (!data.customers.some((item) => item.id === input.customerId)) {
    throw new Error("客户不存在");
  }
  if (!data.staff.some((item) => item.id === input.staffId && item.status === "active")) {
    throw new Error("服务员工不存在或已停用");
  }
  const selectedService = data.services.find((item) => item.id === input.serviceId);
  if (!selectedService) {
    throw new Error("服务项目不存在");
  }

  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new Error("预约时间不正确");
  const endAt = new Date(startAt.getTime() + selectedService.duration * 60 * 1000);

  const hasAppointmentConflict = data.appointments.some((appointment) => {
    if (appointment.id === input.excludeAppointmentId) return false;
    if (appointment.staffId !== input.staffId) return false;
    if (["已完成", "已取消", "爽约"].includes(appointment.status)) return false;
    const service = data.services.find((item) => item.id === appointment.serviceId);
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + (service?.duration ?? 60) * 60 * 1000);
    return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
  });

  if (hasAppointmentConflict) {
    throw new Error("该员工在此时间段已有预约");
  }

  const hasUnavailableConflict = data.staffUnavailableSlots.some((slot) => {
    if (slot.staffId !== input.staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt));
  });

  if (hasUnavailableConflict) {
    throw new Error("该员工在此时间段不可预约");
  }

  const shiftsForDay = data.staffShifts.filter(
    (shift) => shift.staffId === input.staffId && shift.startAt.slice(0, 10) === input.startAt.slice(0, 10),
  );
  const insideShift =
    shiftsForDay.length === 0 ||
    shiftsForDay.some((shift) => startAt >= new Date(shift.startAt) && endAt <= new Date(shift.endAt));
  if (!insideShift) {
    throw new Error("预约时间不在员工班次内");
  }
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
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  if (!(startAt < endAt)) throw new Error("班次结束时间必须晚于开始时间");
  const hasShiftConflict = data.staffShifts.some(
    (shift) => shift.staffId === input.staffId && hasTimeOverlap(startAt, endAt, new Date(shift.startAt), new Date(shift.endAt)),
  );
  if (hasShiftConflict) throw new Error("员工班次冲突");
  const shift: StaffShift = {
    id: idFactory("ss"),
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

  if (!data.staff.some((staff) => staff.id === input.staffId)) {
    throw new Error("员工不存在");
  }

  if (!(startAt < endAt)) {
    throw new Error("不可预约结束时间必须晚于开始时间");
  }

  const hasAppointmentConflict = data.appointments.some((appointment) => {
    if (appointment.staffId !== input.staffId) return false;
    if (["已取消", "爽约"].includes(appointment.status)) return false;
    const service = data.services.find((item) => item.id === appointment.serviceId);
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + (service?.duration ?? 60) * 60 * 1000);
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

  if (data.dailyCloses.some((item) => item.businessDate === input.businessDate && item.status === "已锁定")) {
    throw new Error("该营业日已日结");
  }

  const orders = data.orders.filter((order) => order.createdAt.slice(0, 10) === input.businessDate);
  const refunds = data.refunds.filter((refund) => refund.createdAt.slice(0, 10) === input.businessDate);
  const commissions = data.commissions.filter((commission) => commission.createdAt.slice(0, 10) === input.businessDate);

  const amountByMethod = (method: Order["payMethod"]) =>
    orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + order.paidAmount, 0);

  const dailyClose: DailyClose = {
    id: idFactory("dc"),
    businessDate: input.businessDate,
    revenue: orders.reduce((sum, order) => sum + order.paidAmount, 0),
    refundAmount: refunds.reduce((sum, refund) => sum + refund.amount, 0),
    orderCount: orders.filter((order) => order.status !== "已退款").length,
    cashAmount: amountByMethod("现金"),
    wechatAmount: amountByMethod("微信"),
    alipayAmount: amountByMethod("支付宝"),
    cardAmount: amountByMethod("银行卡"),
    memberCardAmount: amountByMethod("会员卡"),
    commissionAmount: commissions.filter((commission) => commission.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0),
    createdBy: input.userId,
    createdAt,
    status: "已锁定",
  };
  const reversedClose = data.dailyCloses.find((item) => item.businessDate === input.businessDate && item.status === "已反结");
  const nextDailyCloses = reversedClose
    ? data.dailyCloses.map((item) => (item.id === reversedClose.id ? { ...dailyClose, id: item.id } : item))
    : [dailyClose, ...data.dailyCloses];

  return {
    ...data,
    dailyCloses: nextDailyCloses,
    operationLogs: [
      {
        id: idFactory("op"),
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
  const close = data.dailyCloses.find((item) => item.businessDate === input.businessDate && item.status === "已锁定");
  if (!close) throw new Error("可反结日结不存在");
  return {
    ...data,
    dailyCloses: data.dailyCloses.map((item) =>
      item.id === close.id ? { ...item, status: "已反结", reversedBy: input.userId, reversedAt: createdAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
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

export function adjustInventory(
  data: AppData,
  input: InventoryAdjustmentInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  assertBusinessDateOpen(data, currentTime().slice(0, 10));
  const direction = input.type === "入库" ? 1 : -1;
  let stockAfter = 0;
  const products = data.products.map((product) => {
    if (product.id !== input.productId) return product;
    stockAfter = Math.max(0, product.stock + input.quantity * direction);
    return { ...product, stock: stockAfter };
  });

  if (!data.products.some((product) => product.id === input.productId)) {
    throw new Error("商品或耗材不存在");
  }

  return {
    ...data,
    products,
    inventoryLogs: [
      {
        id: idFactory("il"),
        productId: input.productId,
        type: input.type,
        delta: input.quantity * direction,
        stockAfter,
        note: input.note ?? "手动调整",
        createdAt: currentTime(),
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
  const supplier: Supplier = { id: idFactory("sp"), name: input.name, phone: input.phone, contact: input.contact, status: "active" };
  return { ...data, suppliers: [supplier, ...data.suppliers] };
}

export function receivePurchaseOrder(
  data: AppData,
  input: PurchaseOrderInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  assertBusinessDateOpen(data, createdAt.slice(0, 10));
  if (!data.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("供应商不存在");
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品或耗材不存在");
  const stockAfter = product.stock + input.quantity;
  const purchaseOrder: PurchaseOrder = {
    id: idFactory("po"),
    supplierId: input.supplierId,
    productId: input.productId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    status: "已入库",
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    products: data.products.map((item) => (item.id === product.id ? { ...item, stock: stockAfter, cost: input.unitCost } : item)),
    purchaseOrders: [purchaseOrder, ...data.purchaseOrders],
    inventoryLogs: [
      {
        id: idFactory("il"),
        productId: product.id,
        type: "采购入库",
        delta: input.quantity,
        stockAfter,
        note: purchaseOrder.id,
        createdAt,
      },
      ...data.inventoryLogs,
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
  assertBusinessDateOpen(data, createdAt.slice(0, 10));
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品或耗材不存在");
  const delta = input.actualStock - product.stock;
  const stocktake: Stocktake = {
    id: idFactory("st"),
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
    stocktakes: [stocktake, ...data.stocktakes],
    inventoryLogs: [
      {
        id: idFactory("il"),
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
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  const service = data.services.find((item) => item.id === input.serviceId);
  if (!service) throw new Error("服务项目不存在");
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
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    orderId: input.orderId,
    memberCardTransactionId,
    skinCondition: input.skinCondition,
    beforeNote: input.beforeNote,
    careSteps: input.careSteps ?? `完成${service.name}服务`,
    productsUsed: input.productsUsed ?? serviceConsumables(service)
      .map((item) => {
        const product = data.products.find((productItem) => productItem.id === item.productId);
        return product ? `${product.name} x${item.quantity}${product.unit}` : "";
      })
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
  options: { now?: () => string } = {},
): AppData {
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
  return {
    ...data,
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
  const pending = data.commissions.filter((item) => item.status === "待结算");
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
      item.status === "待结算" ? { ...item, status: "已结算", settledAt: createdAt, settlementId } : item,
    ),
    commissionSettlements: [settlement, ...data.commissionSettlements],
  };
}

export function settleDistributionCommissions(
  data: AppData,
  input: SettleCommissionInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const pending = data.distributionCommissions.filter((item) => item.status === "待结算");
  if (!pending.length) throw new Error("暂无待结算分销佣金");
  const settlementId = idFactory("cs");
  const settlement: CommissionSettlement = {
    id: settlementId,
    type: "分销佣金",
    commissionIds: pending.map((item) => item.id),
    amount: pending.reduce((sum, item) => sum + item.amount, 0),
    count: pending.length,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    distributionCommissions: data.distributionCommissions.map((item) =>
      item.status === "待结算" ? { ...item, status: "已结算", settledAt: createdAt, settlementId } : item,
    ),
    commissionSettlements: [settlement, ...data.commissionSettlements],
  };
}

export function reportSummary(data: AppData) {
  const revenue = data.orders.reduce((sum, item) => sum + item.paidAmount, 0);
  const refundAmount = data.refunds.reduce((sum, item) => sum + item.amount, 0);
  const cardBalance = data.memberCards.reduce((sum, item) => sum + item.balance, 0);
  const commission = data.commissions.filter((item) => item.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0);
  const distributionCommission = data.distributionCommissions.filter((item) => item.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0);
  const serviceCount = data.orders.filter((item) => item.status !== "已退款").length;

  return {
    revenue,
    refundAmount,
    cardBalance,
    commission,
    distributionCommission,
    serviceCount,
    averageOrderValue: serviceCount ? revenue / serviceCount : 0,
    lowStockCount: data.products.filter((item) => item.stock <= item.warningStock).length,
  };
}

function hasApprovedRequest(data: AppData, approvalId: string | undefined, type: ApprovalRequest["type"], amount: number) {
  if (!approvalId) return false;
  return data.approvalRequests.some((item) => item.id === approvalId && item.type === type && item.status === "已通过" && item.amount >= amount);
}

function assertBusinessDateOpen(data: AppData, businessDate: string) {
  if (data.dailyCloses.some((item) => item.businessDate === businessDate && item.status === "已锁定")) {
    throw new Error("该营业日已日结锁账");
  }
}

function roleNameOf(role: UserRole) {
  const names: Record<UserRole, string> = {
    superadmin: "系统管理员",
    owner: "老板",
    manager: "主管",
    frontdesk: "前台",
    therapist: "员工",
    finance: "财务",
  };
  return names[role];
}
