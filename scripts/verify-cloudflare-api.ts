import assert from "node:assert/strict";
import type { AppData } from "../src/domain/types";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8788";

const health = await request<{ ok: boolean; runtime?: string }>(baseUrl, "/api/health");
assert.equal(health.ok, true, "health check should pass");
assert.equal(health.runtime, "cloudflare-d1", "Cloudflare API should report D1 runtime");

await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

const session = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: "admin@demo.local", password: "yich-demo" },
});
assert.equal(session.user.roleName, "店长", "login API should return role session");

const afterResetStart = await request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token });
assert.equal(afterResetStart.orders.length, 0, "reset should prepare deterministic D1 test state");

const frontdeskSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: "frontdesk@demo.local", password: "yich-demo" },
});
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/inventory/adjust", {
      method: "POST",
      token: frontdeskSession.token,
      body: { productId: "p1", type: "入库", quantity: 1 },
    }),
  /无权/,
  "frontdesk should not adjust inventory",
);

const initialData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
assert.equal(initialData.customers.length, 3, "D1 should seed demo customers");

const afterUnavailableSlot = await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
  method: "POST",
  token: session.token,
  body: {
    staffId: "s3",
    startAt: "2026-05-26T02:00:00.000Z",
    endAt: "2026-05-26T03:00:00.000Z",
    reason: "Cloudflare 员工培训",
  },
});
assert.equal(afterUnavailableSlot.staffUnavailableSlots[0].reason, "Cloudflare 员工培训", "D1 should persist unavailable slot");

await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/appointments", {
      method: "POST",
      token: session.token,
      body: {
        customerId: "c1",
        staffId: "s3",
        serviceId: "v1",
        startAt: "2026-05-26T02:15:00.000Z",
        note: "不可预约冲突",
      },
    }),
  /不可预约/,
  "Cloudflare appointment API should reject unavailable staff slots",
);

const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: session.token,
  body: {
    customerId: "c1",
    staffId: "s2",
    collaboratorStaffIds: ["s1"],
    serviceId: "v1",
    productId: "p4",
    payMethod: "微信",
  },
});
assert.equal(afterCheckout.orders.length, 1, "checkout should create order in D1");
assert.equal(afterCheckout.orders[0].totalAmount, 597, "checkout should calculate total");
const splitCommissions = afterCheckout.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
assert.equal(splitCommissions.length, 2, "checkout should split commissions in D1");
assert.equal(splitCommissions.reduce((sum, item) => sum + item.amount, 0), 72, "split commissions should preserve total");

const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
  method: "POST",
  token: session.token,
  body: { reason: "Cloudflare 部分退款", amount: 100 },
});
assert.equal(afterPartialRefund.orders[0].status, "部分退款", "partial refund should persist order status");
assert.equal(afterPartialRefund.orders[0].paidAmount, 497, "partial refund should reduce paid amount");

const afterCardCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: session.token,
  body: {
    customerId: "c1",
    staffId: "s2",
    serviceId: "v1",
    payMethod: "会员卡",
    cardId: "m1",
  },
});
assert.equal(afterCardCheckout.memberCardTransactions[0].type, "消费", "member card checkout should persist transaction");

const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
  method: "POST",
  token: session.token,
  body: { businessDate: new Date().toISOString().slice(0, 10) },
});
assert.equal(afterDailyClose.dailyCloses.length, 1, "daily close should persist in D1");

const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: "therapist@demo.local", password: "yich-demo" },
});
const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
assert.ok(therapistData.orders.every((item) => item.staffId === "s2"), "therapist should only see own orders");
assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

const afterResetEnd = await request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token });
assert.equal(afterResetEnd.orders.length, 0, "reset should clean D1 test data");

console.log(`Cloudflare Workers + D1 API 验证通过：${baseUrl}`);

async function request<T>(baseUrl: string, path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(isErrorPayload(data) ? data.error : `HTTP ${response.status}`);
  }
  return data as T;
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string";
}
