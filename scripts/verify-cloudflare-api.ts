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

const afterShift = await request<AppData>(baseUrl, "/api/staff-shifts", {
  method: "POST",
  token: session.token,
  body: {
    staffId: "s3",
    startAt: "2026-05-28T02:00:00.000Z",
    endAt: "2026-05-28T03:00:00.000Z",
    note: "Cloudflare 早班",
  },
});
assert.equal(afterShift.staffShifts[0].note, "Cloudflare 早班", "D1 should persist staff shift");

const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: session.token,
  body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "Cloudflare 活动价" },
});
const discountApprovalId = afterApprovalRequest.approvalRequests[0].id;
const afterApprovalDecision = await request<AppData>(baseUrl, `/api/approvals/${discountApprovalId}`, {
  method: "PATCH",
  token: session.token,
  body: { approved: true },
});
assert.equal(afterApprovalDecision.approvalRequests[0].status, "已通过", "D1 should approve requests");

const afterDiscountCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: session.token,
  body: {
    customerId: "c1",
    staffId: "s2",
    serviceId: "v1",
    payMethod: "微信",
    discountAmount: 50,
    adjustmentReason: "Cloudflare 活动价",
    approvalId: discountApprovalId,
  },
});
assert.equal(afterDiscountCheckout.orders[0].paidAmount, 348, "approved discount should persist in D1");

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
assert.equal(afterCheckout.orders.length, 2, "checkout should create order in D1");
assert.equal(afterCheckout.orders[0].totalAmount, 597, "checkout should calculate total");
const splitCommissions = afterCheckout.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
assert.equal(splitCommissions.length, 2, "checkout should split commissions in D1");
assert.equal(splitCommissions.reduce((sum, item) => sum + item.amount, 0), 72, "split commissions should preserve total");

const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
  method: "POST",
  token: session.token,
  body: { reason: "Cloudflare 部分退款", amount: 100 },
});
const partialRefundOrder = afterPartialRefund.orders.find((item) => item.id === afterCheckout.orders[0].id);
assert.ok(partialRefundOrder, "partial refund order should still exist");
assert.equal(partialRefundOrder.status, "部分退款", "partial refund should persist order status");
assert.equal(partialRefundOrder.paidAmount, 497, "partial refund should reduce paid amount");

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

const afterOpenCard = await request<AppData>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: session.token,
  body: { customerId: "c2", name: "Cloudflare 储值卡", balance: 500, remainingTimes: 0 },
});
const cloudflareCardId = afterOpenCard.memberCards[0].id;
const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${cloudflareCardId}/recharge`, {
  method: "POST",
  token: session.token,
  body: { amount: 100, note: "Cloudflare 充值" },
});
assert.equal(afterRecharge.memberCards.find((item) => item.id === cloudflareCardId)?.balance, 600, "D1 should persist recharge");
const afterFreeze = await request<AppData>(baseUrl, `/api/member-cards/${cloudflareCardId}/status`, {
  method: "PATCH",
  token: session.token,
  body: { status: "冻结", reason: "Cloudflare 冻结" },
});
assert.equal(afterFreeze.memberCards.find((item) => item.id === cloudflareCardId)?.status, "冻结", "D1 should persist card status");
const afterExtend = await request<AppData>(baseUrl, `/api/member-cards/${cloudflareCardId}/extend`, {
  method: "PATCH",
  token: session.token,
  body: { expiresAt: "2028-12-31", reason: "Cloudflare 延期" },
});
assert.equal(afterExtend.memberCards.find((item) => item.id === cloudflareCardId)?.expiresAt, "2028-12-31", "D1 should persist card extension");

const afterServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
  method: "POST",
  token: session.token,
  body: {
    customerId: "c1",
    staffId: "s2",
    serviceId: "v1",
    skinCondition: "敏感偏干",
    afterNote: "Cloudflare 服务后",
    nextFollowUpAt: "2026-05-29T10:00:00.000Z",
  },
});
assert.equal(afterServiceRecord.customerServiceRecords.length, 1, "D1 should persist service record");
const afterFollowUpDone = await request<AppData>(baseUrl, `/api/follow-ups/${afterServiceRecord.customerFollowUps[0].id}`, {
  method: "PATCH",
  token: session.token,
});
assert.equal(afterFollowUpDone.customerFollowUps[0].status, "已完成", "D1 should complete follow-up");

const afterSupplier = await request<AppData>(baseUrl, "/api/suppliers", {
  method: "POST",
  token: session.token,
  body: { name: "Cloudflare 供应商", phone: "13800000000", contact: "王经理" },
});
const supplierId = afterSupplier.suppliers[0].id;
const afterPurchase = await request<AppData>(baseUrl, "/api/purchase-orders", {
  method: "POST",
  token: session.token,
  body: { supplierId, productId: "p1", quantity: 3, unitCost: 60 },
});
assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "D1 should persist purchase inbound log");
const afterStocktake = await request<AppData>(baseUrl, "/api/stocktakes", {
  method: "POST",
  token: session.token,
  body: { productId: "p1", actualStock: 20, reason: "Cloudflare 盘点" },
});
assert.equal(afterStocktake.stocktakes[0].actualStock, 20, "D1 should persist stocktake");

const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
  method: "POST",
  token: session.token,
  body: { businessDate: new Date().toISOString().slice(0, 10) },
});
assert.equal(afterDailyClose.dailyCloses.length, 1, "daily close should persist in D1");
const afterReverseClose = await request<AppData>(baseUrl, "/api/daily-close/reverse", {
  method: "POST",
  token: session.token,
  body: { businessDate: new Date().toISOString().slice(0, 10) },
});
assert.equal(afterReverseClose.dailyCloses[0].status, "已反结", "reverse close should persist in D1");

const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: "therapist@demo.local", password: "yich-demo" },
});
const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
assert.ok(therapistData.orders.every((item) => item.staffId === "s2"), "therapist should only see own orders");
assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

const afterResetEnd = await request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token });
assert.equal(afterResetEnd.orders.length, 0, "reset should clean D1 test data");

console.log(`Cloudflare Workers + D1 API 验证通过：P1 业务链路已覆盖 ${baseUrl}`);

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
