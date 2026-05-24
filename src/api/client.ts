import type { UserSession } from "../domain/auth";
import type { AppData, Appointment, InventoryLog, Order, UserRole } from "../domain/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

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
    fetchData: () => request<AppData>("/api/data", { token: getToken() }),
    addStaff: (body: { name: string; phone: string; role: string; baseSalary?: number; commissionRate?: number }) =>
      request<AppData>("/api/staff", { method: "POST", body, token: getToken() }),
    updateStaff: (staffId: string, body: { name?: string; phone?: string; role?: string; status?: "active" | "inactive"; baseSalary?: number; commissionRate?: number }) =>
      request<AppData>(`/api/staff/${encodeURIComponent(staffId)}`, { method: "PATCH", body, token: getToken() }),
    createStaffInvite: (body: { staffId: string; account: string; role: UserRole }) =>
      request<AppData>("/api/staff-invites", { method: "POST", body, token: getToken() }),
    checkout: (body: {
      customerId: string;
      staffId: string;
      collaboratorStaffIds?: string[];
      serviceId: string;
      productId?: string;
      discountAmount?: number;
      adjustmentReason?: string;
      approvalId?: string;
      couponId?: string;
      activityId?: string;
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
    updateAppointmentStatus: (id: string, status: Appointment["status"]) =>
      request<AppData>(`/api/appointments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status },
        token: getToken(),
      }),
    addCustomer: (body: { name: string; phone: string }) =>
      request<AppData>("/api/customers", { method: "POST", body, token: getToken() }),
    updateCustomer: (customerId: string, body: { name?: string; phone?: string; level?: string; source?: string; tags?: string[] }) =>
      request<AppData>(`/api/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", body, token: getToken() }),
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
    createCouponTemplate: (body: { name: string; amount: number; minSpend: number; serviceId?: string; validDays: number }) =>
      request<AppData>("/api/coupon-templates", { method: "POST", body, token: getToken() }),
    issueCustomerCoupon: (body: { templateId: string; customerId: string }) =>
      request<AppData>("/api/customer-coupons", { method: "POST", body, token: getToken() }),
    createMarketingActivity: (body: {
      name: string;
      type: "拼团" | "秒杀";
      serviceId: string;
      activityPrice: number;
      groupSize?: number;
      quota: number;
      startsAt: string;
      endsAt: string;
    }) => request<AppData>("/api/marketing-activities", { method: "POST", body, token: getToken() }),
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
      afterNote?: string;
      nextFollowUpAt?: string;
    }) => request<AppData>("/api/service-records", { method: "POST", body, token: getToken() }),
    addFollowUp: (body: { customerId: string; staffId: string; dueAt: string; method: "电话" | "微信" | "到店"; note: string }) =>
      request<AppData>("/api/follow-ups", { method: "POST", body, token: getToken() }),
    completeFollowUp: (followUpId: string) =>
      request<AppData>(`/api/follow-ups/${encodeURIComponent(followUpId)}`, { method: "PATCH", token: getToken() }),
    addService: (body: { name: string; price: number; category?: string; duration?: number; consumableProductId?: string; consumableQty?: number }) =>
      request<AppData>("/api/services", { method: "POST", body, token: getToken() }),
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
