import type { UserSession } from "../domain/auth";
import type { AppData, Appointment, InventoryLog, Order } from "../domain/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(getToken: () => string | undefined) {
  return {
    login: (account: string, password: string) =>
      request<UserSession>("/api/auth/login", {
        method: "POST",
        body: { account, password },
      }),
    fetchData: () => request<AppData>("/api/data", { token: getToken() }),
    resetData: () => request<AppData>("/api/reset", { method: "POST", token: getToken() }),
    checkout: (body: {
      customerId: string;
      staffId: string;
      collaboratorStaffIds?: string[];
      serviceId: string;
      productId?: string;
      payMethod: Order["payMethod"];
      cardId?: string;
    }) => request<AppData>("/api/checkout", { method: "POST", body, token: getToken() }),
    refundOrder: (orderId: string, reason: string, amount?: number) =>
      request<AppData>(`/api/orders/${encodeURIComponent(orderId)}/refund`, {
        method: "POST",
        body: { reason, amount },
        token: getToken(),
      }),
    adjustInventory: (body: { productId: string; type: InventoryLog["type"]; quantity: number; note?: string }) =>
      request<AppData>("/api/inventory/adjust", { method: "POST", body, token: getToken() }),
    addAppointment: (body: { customerId: string; staffId: string; serviceId: string; startAt: string; note: string }) =>
      request<AppData>("/api/appointments", { method: "POST", body, token: getToken() }),
    addStaffUnavailableSlot: (body: { staffId: string; startAt: string; endAt: string; reason: string }) =>
      request<AppData>("/api/staff-unavailable-slots", { method: "POST", body, token: getToken() }),
    updateAppointmentStatus: (id: string, status: Appointment["status"]) =>
      request<AppData>(`/api/appointments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status },
        token: getToken(),
      }),
    addCustomer: (body: { name: string; phone: string }) =>
      request<AppData>("/api/customers", { method: "POST", body, token: getToken() }),
    openMemberCard: (body: { customerId: string; name: string; balance: number; remainingTimes: number }) =>
      request<AppData>("/api/member-cards", { method: "POST", body, token: getToken() }),
    openProjectMemberCard: (body: { customerId: string; name: string; balance: number; remainingTimes: number; serviceId?: string }) =>
      request<AppData>("/api/member-cards", { method: "POST", body, token: getToken() }),
    refundMemberCard: (memberCardId: string, reason: string) =>
      request<AppData>(`/api/member-cards/${encodeURIComponent(memberCardId)}/refund`, {
        method: "POST",
        body: { reason },
        token: getToken(),
      }),
    addService: (body: { name: string; price: number; category?: string; duration?: number }) =>
      request<AppData>("/api/services", { method: "POST", body, token: getToken() }),
    addProduct: (body: { name: string; stock: number; type?: "sale" | "consumable"; unit?: string }) =>
      request<AppData>("/api/products", { method: "POST", body, token: getToken() }),
    settleCommissions: () => request<AppData>("/api/commissions/settle", { method: "POST", token: getToken() }),
    createDailyClose: (businessDate: string) =>
      request<AppData>("/api/daily-close", {
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

  const payload = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(isErrorPayload(payload) ? payload.error : `HTTP ${response.status}`);
  }
  return payload as T;
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string";
}
