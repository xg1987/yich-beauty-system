import type { UserSession } from "../domain/auth";
import type { AppData, Appointment, CustomerSignature, DataCleanupReport, InventoryLog, OnlineStorefront, Order, Service, ServiceConsumable, StoreProfile, TagDefinition, TagScope, UserRole } from "../domain/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type PublicCustomerSignaturePayload = {
  signature: Pick<CustomerSignature, "id" | "token" | "title" | "content" | "status" | "createdAt" | "expiresAt" | "signerName" | "signatureText" | "signedAt">;
  customer?: { id: string; name: string; phone: string };
  order?: { id: string; orderNo: string; paidAmount: number; payMethod: Order["payMethod"]; createdAt: string; serviceName: string };
  serviceRecord?: {
    id: string;
    skinCondition: string;
    careSteps: string;
    afterNote: string;
    nextCareAdvice: string;
    createdAt: string;
    serviceName: string;
    staffName: string;
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(getToken: () => string | undefined) {
  return {
    login: (account: string, password: string) =>
      request<UserSession>("/api/auth/login", {
        method: "POST",
        body: { account, password },
      }),
    registerStore: (body: { storeName: string; ownerName: string; phone: string; address?: string; account: string; password: string }) =>
      request<UserSession>("/api/auth/register-store", { method: "POST", body }),
    joinInvite: (body: { inviteCode: string; name: string; password: string }) =>
      request<UserSession>("/api/auth/join-invite", { method: "POST", body }),
    fetchPublicStore: (shareCode: string) =>
      request<{ store?: StoreProfile; storefront: OnlineStorefront; services: Service[] }>(`/api/public/store/${encodeURIComponent(shareCode)}`),
    createPublicBookingRequest: (body: { shareCode: string; customerName: string; phone: string; serviceId: string; preferredAt: string; note?: string }) =>
      request<{ ok: boolean }>("/api/public/online-booking-requests", { method: "POST", body }),
    fetchPublicCustomerSignature: (token: string) =>
      request<PublicCustomerSignaturePayload>(`/api/public/customer-signatures/${encodeURIComponent(token)}`),
    signPublicCustomerSignature: (token: string, body: { signerName: string; signatureText: string }) =>
      request<PublicCustomerSignaturePayload>(`/api/public/customer-signatures/${encodeURIComponent(token)}/sign`, { method: "POST", body }),
    fetchData: () => request<AppData>("/api/data", { token: getToken() }),
    fetchDataQuality: () => request<DataCleanupReport>("/api/data-quality", { token: getToken() }),
    cleanupFormalData: (confirm: string) =>
      request<AppData>("/api/data-quality/cleanup", { method: "POST", body: { confirm }, token: getToken() }),
    markNotificationRead: (notificationId: string) =>
      request<AppData>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH", token: getToken() }),
    markAllNotificationsRead: () =>
      request<AppData>("/api/notifications/read-all", { method: "POST", token: getToken() }),
    updateStoreProfile: (body: { name: string; phone: string; address: string; businessHours: string }) =>
      request<AppData>("/api/store-profile", { method: "PATCH", body, token: getToken() }),
    addStaff: (body: { name: string; phone: string; role: string; baseSalary?: number; commissionRate?: number }) =>
      request<AppData>("/api/staff", { method: "POST", body, token: getToken() }),
    updateStaff: (staffId: string, body: { name?: string; phone?: string; role?: string; status?: "active" | "inactive"; baseSalary?: number; commissionRate?: number }) =>
      request<AppData>(`/api/staff/${encodeURIComponent(staffId)}`, { method: "PATCH", body, token: getToken() }),
    createStaffInvite: (body: { staffId: string; account: string; role: UserRole; validDays?: number }) =>
      request<AppData>("/api/staff-invites", { method: "POST", body, token: getToken() }),
    revokeStaffInvite: (inviteId: string) =>
      request<AppData>(`/api/staff-invites/${encodeURIComponent(inviteId)}`, { method: "PATCH", token: getToken() }),
    updateOnlineStorefront: (body: { shareCode: string; status?: "启用" | "停用"; headline: string; description: string; enabledServiceIds: string[] }) =>
      request<AppData>("/api/online-storefront", { method: "POST", body, token: getToken() }),
    convertOnlineBookingRequest: (requestId: string, staffId: string) =>
      request<AppData>(`/api/online-booking-requests/${encodeURIComponent(requestId)}/convert`, {
        method: "POST",
        body: { staffId },
        token: getToken(),
      }),
    checkout: (body: {
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
    }) => request<AppData>("/api/checkout", { method: "POST", body, token: getToken() }),
    refundOrder: (orderId: string, reason: string, amount?: number, approvalId?: string) =>
      request<AppData>(`/api/orders/${encodeURIComponent(orderId)}/refund`, {
        method: "POST",
        body: { reason, amount, approvalId },
        token: getToken(),
      }),
    adjustInventory: (body: { productId: string; type: InventoryLog["type"]; quantity: number; note?: string }) =>
      request<AppData>("/api/inventory/adjust", { method: "POST", body, token: getToken() }),
    addAppointment: (body: { customerId: string; staffId: string; serviceId: string; startAt: string; note: string }) =>
      request<AppData>("/api/appointments", { method: "POST", body, token: getToken() }),
    addStaffUnavailableSlot: (body: { staffId: string; startAt: string; endAt: string; reason: string }) =>
      request<AppData>("/api/staff-unavailable-slots", { method: "POST", body, token: getToken() }),
    addStaffShift: (body: { staffId: string; startAt: string; endAt: string; note: string }) =>
      request<AppData>("/api/staff-shifts", { method: "POST", body, token: getToken() }),
    updateAppointmentStatus: (id: string, status: Appointment["status"], reason?: string) =>
      request<AppData>(`/api/appointments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status, reason },
        token: getToken(),
      }),
    rescheduleAppointment: (id: string, body: { staffId?: string; serviceId?: string; startAt: string; note?: string }) =>
      request<AppData>(`/api/appointments/${encodeURIComponent(id)}/reschedule`, {
        method: "POST",
        body,
        token: getToken(),
      }),
    addCustomer: (body: { name: string; phone: string }) =>
      request<AppData>("/api/customers", { method: "POST", body, token: getToken() }),
    updateCustomer: (customerId: string, body: { name?: string; phone?: string; level?: string; source?: string; tags?: string[] }) =>
      request<AppData>(`/api/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", body, token: getToken() }),
    createTag: (body: { name: string; scope: TagScope; color?: string }) =>
      request<AppData>("/api/tags", { method: "POST", body, token: getToken() }),
    updateTag: (tagId: string, body: { name?: string; color?: string; status?: TagDefinition["status"] }) =>
      request<AppData>(`/api/tags/${encodeURIComponent(tagId)}`, { method: "PATCH", body, token: getToken() }),
    openMemberCard: (body: {
      customerId: string;
      name: string;
      type?: "储值卡" | "次数卡" | "套餐卡";
      balance: number;
      remainingTimes: number;
      serviceId?: string;
      serviceIds?: string[];
    }) =>
      request<AppData>("/api/member-cards", { method: "POST", body, token: getToken() }),
    createDistributor: (body: { type: "客户" | "员工"; customerId?: string; staffId?: string; name?: string; phone?: string; rate: number }) =>
      request<AppData>("/api/distributors", { method: "POST", body, token: getToken() }),
    bindReferralRelation: (body: { distributorId: string; customerId: string; source?: "手工绑定" | "邀请码" }) =>
      request<AppData>("/api/referral-relations", { method: "POST", body, token: getToken() }),
    settleDistributionCommissions: () => request<AppData>("/api/distribution-commissions/settle", { method: "POST", token: getToken() }),
    refundMemberCard: (memberCardId: string, reason: string) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/refund`, {
        method: "POST",
        body: { reason },
        token: getToken(),
      }),
    rechargeMemberCard: (memberCardId: string, body: { amount?: number; giftAmount?: number; times?: number; giftTimes?: number; note?: string }) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/recharge`, {
        method: "POST",
        body,
        token: getToken(),
      }),
    updateMemberCardStatus: (memberCardId: string, status: "正常" | "冻结", reason: string) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/status`, {
        method: "PATCH",
        body: { status, reason },
        token: getToken(),
      }),
    extendMemberCard: (memberCardId: string, expiresAt: string, reason: string) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/extend`, {
        method: "PATCH",
        body: { expiresAt, reason },
        token: getToken(),
      }),
    transferMemberCard: (memberCardId: string, toCustomerId: string, reason: string) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/transfer`, {
        method: "POST",
        body: { toCustomerId, reason },
        token: getToken(),
      }),
    createApproval: (body: { type: "改价折扣" | "订单退款"; targetId: string; amount: number; reason: string }) =>
      request<AppData>("/api/approvals", { method: "POST", body, token: getToken() }),
    decideApproval: (approvalId: string, approved: boolean) =>
      request<AppData>(`/api/approvals/${encodeURIComponent(approvalId)}`, {
        method: "PATCH",
        body: { approved },
        token: getToken(),
      }),
    addServiceRecord: (body: {
      customerId: string;
      staffId: string;
      serviceId: string;
      orderId?: string;
      skinCondition?: string;
      beforeNote?: string;
      careSteps?: string;
      productsUsed?: string;
      afterNote?: string;
      customerFeedback?: string;
      nextCareAdvice?: string;
      nextFollowUpAt?: string;
    }) => request<AppData>("/api/service-records", { method: "POST", body, token: getToken() }),
    createCustomerSignature: (body: { customerId: string; serviceRecordId?: string; orderId?: string; title?: string; content?: string; validDays?: number }) =>
      request<AppData>("/api/customer-signatures", { method: "POST", body, token: getToken() }),
    addFollowUp: (body: { customerId: string; staffId: string; dueAt: string; method: "电话" | "微信" | "到店"; note: string }) =>
      request<AppData>("/api/follow-ups", { method: "POST", body, token: getToken() }),
    completeFollowUp: (followUpId: string) =>
      request<AppData>(`/api/follow-ups/${encodeURIComponent(followUpId)}`, { method: "PATCH", token: getToken() }),
    addService: (body: { name: string; price: number; category?: string; duration?: number; consumables?: ServiceConsumable[]; consumableProductId?: string; consumableQty?: number }) =>
      request<AppData>("/api/services", { method: "POST", body, token: getToken() }),
    updateServiceConsumables: (serviceId: string, consumables: ServiceConsumable[]) =>
      request<AppData>(`/api/services/${encodeURIComponent(serviceId)}/consumables`, {
        method: "PATCH",
        body: { consumables },
        token: getToken(),
      }),
    addProduct: (body: { name: string; stock: number; type?: "sale" | "consumable"; unit?: string }) =>
      request<AppData>("/api/products", { method: "POST", body, token: getToken() }),
    addSupplier: (body: { name: string; phone?: string; contact?: string }) =>
      request<AppData>("/api/suppliers", { method: "POST", body, token: getToken() }),
    receivePurchaseOrder: (body: { supplierId: string; productId: string; quantity: number; unitCost: number }) =>
      request<AppData>("/api/purchase-orders", { method: "POST", body, token: getToken() }),
    createStocktake: (body: { productId: string; actualStock: number; reason: string }) =>
      request<AppData>("/api/stocktakes", { method: "POST", body, token: getToken() }),
    settleCommissions: () => request<AppData>("/api/commissions/settle", { method: "POST", token: getToken() }),
    createDailyClose: (businessDate: string) =>
      request<AppData>("/api/daily-close", {
        method: "POST",
        body: { businessDate },
        token: getToken(),
      }),
    reverseDailyClose: (businessDate: string) =>
      request<AppData>("/api/daily-close/reverse", {
        method: "POST",
        body: { businessDate },
        token: getToken(),
      }),
  };
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? parseJson<T | { error: string }>(text) : undefined;
  if (!response.ok) {
    throw new Error(isErrorPayload(payload) ? payload.error : `HTTP ${response.status}`);
  }
  if (payload === undefined) {
    throw new Error("服务暂时不可用，请稍后重试");
  }
  return payload as T;
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string";
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("服务返回异常，请稍后重试");
  }
}
