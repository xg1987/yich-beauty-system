import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApiServer } from "../server/api";
import { BeautyDatabase } from "../server/database";
import type { AppData } from "../src/domain/types";

const tempDir = mkdtempSync(join(tmpdir(), "beauty-api-"));
const database = new BeautyDatabase(join(tempDir, "test.sqlite"));
const server = createApiServer(database);

try {
  const baseUrl = await listen(server);

  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert.equal(health.ok, true, "health check should pass");

  await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

  const session = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "admin@demo.local", password: "yich-demo" },
  });
  assert.equal(session.user.roleName, "店长", "login API should return role session");

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
  assert.equal(initialData.customers.length, 3, "database should seed demo customers");
  assert.equal(initialData.orders.length, 0, "seed should start without orders");

  const afterCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "李女士", phone: "13600000004" },
  });
  assert.equal(afterCustomer.customers[0].name, "李女士", "customer API should create a customer");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: "2026-05-25T02:00:00.000Z",
          note: "冲突预约",
        },
      }),
    /已有预约/,
    "appointment API should reject staff time conflicts",
  );

  const afterAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-05-25T02:00:00.000Z",
      note: "API 预约",
    },
  });
  assert.equal(afterAppointment.appointments[0].status, "待确认", "appointment API should create pending appointment");

  const afterUnavailableSlot = await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: "2026-05-26T02:00:00.000Z",
      endAt: "2026-05-26T03:00:00.000Z",
      reason: "API 员工培训",
    },
  });
  assert.equal(afterUnavailableSlot.staffUnavailableSlots[0].reason, "API 员工培训", "unavailable slot API should create staff block");
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
    "appointment API should reject unavailable staff slots",
  );

  const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
  });
  assert.equal(afterCheckout.orders.length, 1, "checkout API should create order");
  assert.equal(afterCheckout.orders[0].totalAmount, 597, "checkout API should calculate total");
  assert.equal(afterCheckout.products.find((item) => item.id === "p1")?.stock, 17, "checkout API should consume service stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p4")?.stock, 23, "checkout API should consume retail stock");
  assert.equal(afterCheckout.commissions[0].amount, 72, "checkout API should create commission");
  assert.equal(afterCheckout.operationLogs[0].action, "开单收银", "checkout API should write operation log");

  const afterRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 测试退款" },
  });
  assert.equal(afterRefund.orders[0].status, "已退款", "refund API should update order status");
  assert.equal(afterRefund.refunds[0].amount, 597, "refund API should write refund record");
  assert.equal(afterRefund.products.find((item) => item.id === "p1")?.stock, 18, "refund API should restore service stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p4")?.stock, 24, "refund API should restore retail stock");
  assert.equal(afterRefund.commissions[0].status, "已冲销", "refund API should reverse commission");

  const afterPartialCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${afterPartialCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 部分退款", amount: 100 },
  });
  const partialRefundOrder = afterPartialRefund.orders.find((item) => item.id === afterPartialCheckout.orders[0].id);
  assert.ok(partialRefundOrder, "partial refund order should still exist");
  assert.equal(partialRefundOrder.status, "部分退款", "partial refund API should keep partial status");
  assert.equal(partialRefundOrder.paidAmount, 298, "partial refund API should reduce paid amount");

  const afterSplitCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      collaboratorStaffIds: ["s1"],
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const splitCommissions = afterSplitCheckout.commissions.filter((item) => item.orderId === afterSplitCheckout.orders[0].id);
  assert.equal(splitCommissions.length, 2, "checkout API should create collaborator commissions");
  assert.equal(splitCommissions.reduce((sum, item) => sum + item.amount, 0), 48, "split commission API should preserve total amount");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c3",
          staffId: "s1",
          serviceId: "v2",
          payMethod: "会员卡",
          cardId: "m2",
        },
      }),
    /不可用于当前项目/,
    "project-bound times card should reject unmatched service through API",
  );

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
  assert.equal(afterCardCheckout.memberCards.find((item) => item.id === "m1")?.balance, 2202, "member card API should deduct balance");
  assert.equal(afterCardCheckout.memberCardTransactions[0].type, "消费", "member card API should write transaction");

  const afterCardRefund = await request<AppData>(baseUrl, "/api/member-cards/m1/refund", {
    method: "POST",
    token: session.token,
    body: { reason: "API 退卡" },
  });
  assert.equal(afterCardRefund.memberCards.find((item) => item.id === "m1")?.status, "已退卡", "member card refund API should close card");
  assert.equal(afterCardRefund.memberCardTransactions[0].type, "退卡", "member card refund API should write transaction");

  const afterInventory = await request<AppData>(baseUrl, "/api/inventory/adjust", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", type: "入库", quantity: 2, note: "API 入库" },
  });
  assert.equal(afterInventory.products.find((item) => item.id === "p1")?.stock, 17, "inventory API should increase stock");
  assert.equal(afterInventory.inventoryLogs[0].note, "API 入库", "inventory API should persist note");

  const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
    method: "POST",
    token: session.token,
    body: { businessDate: new Date().toISOString().slice(0, 10) },
  });
  assert.equal(afterDailyClose.dailyCloses.length, 1, "daily close API should create daily close record");
  assert.ok(afterDailyClose.dailyCloses[0].revenue >= 398, "daily close should summarize revenue");

  const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "therapist@demo.local", password: "yich-demo" },
  });
  const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.ok(therapistData.appointments.every((item) => item.staffId === "s2"), "therapist should only see own appointments");
  assert.ok(therapistData.orders.every((item) => item.staffId === "s2"), "therapist should only see own orders");
  assert.ok(therapistData.staffUnavailableSlots.every((item) => item.staffId === "s2"), "therapist should only see own unavailable slots");
  assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

  const persistedData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(persistedData.orders.length, 4, "API data should persist across requests");
  assert.equal(persistedData.refunds.length, 2, "API data should persist refunds");
  assert.ok(persistedData.operationLogs.length >= 4, "API data should persist operation logs");

  const afterReset = await request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token });
  assert.equal(afterReset.orders.length, 0, "reset API should clear generated orders");

  console.log("API/SQLite 验证通过：健康检查、登录鉴权、权限拦截、客户、预约冲突、不可预约时段、开单、提成拆分、全额退款、部分退款、退卡、项目次数卡、库存、日结、数据范围、流水、日志、持久化、重置。");
} finally {
  await close(server);
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
}

function listen(server: Server) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法获取测试 API 地址"));
        return;
      }
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

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
