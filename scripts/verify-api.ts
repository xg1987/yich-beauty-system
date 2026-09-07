import assert from "node:assert/strict";
import { verifyRetailAppointmentIsolation } from "./verify-retail-appointment-isolation";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApiServer } from "../server/api";
import { BeautyDatabase } from "../server/database";
import pkg from "../package.json" with { type: "json" };
import { defaultSystemConfigs, platformInviteCodeForUser } from "../src/domain/business";
import { testFixtureData } from "../src/domain/testFixture";
import { emptyAppData, POS_REMOTE_PAGING_CAPABILITY, type AppDataPatch, type AppDataSlice } from "../src/domain/dataSlices";
import type { CashierFlowDetailResult, CashierFlowPageResult, PosContextResult } from "../src/domain/cashierFlow";
import type { AppData, WorkerUsageSnapshot } from "../src/domain/types";

verifyAppointmentCheckoutIntegrityMigration();

const tempDir = mkdtempSync(join(tmpdir(), "beauty-api-"));
const database = new BeautyDatabase(join(tempDir, "test.sqlite"));
database.replaceData(testFixtureData);
const server = createApiServer(database);
const futureDate = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
const futureIso = (daysFromNow: number, time: string) => `${futureDate(daysFromNow)}T${time}:00.000Z`;

function verifyAppointmentCheckoutIntegrityMigration() {
  const migrationDb = new DatabaseSync(":memory:");
  migrationDb.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      storeId TEXT,
      appointmentId TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      storeId TEXT,
      status TEXT NOT NULL,
      completedAt TEXT,
      canceledAt TEXT,
      cancelReason TEXT,
      noShowAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE customerSignatures (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    INSERT INTO appointments VALUES
      ('appt_signed', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_pending', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_canceled', 'store1', '已取消', NULL, '2026-01-01T09:30:00.000Z', '旧版收银后误取消', NULL, '2026-01-01T09:30:00.000Z'),
      ('appt_no_show', 'store1', '爽约', NULL, NULL, NULL, '2026-01-01T09:40:00.000Z', '2026-01-01T09:40:00.000Z'),
      ('appt_refunded', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_duplicate', NULL, '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z');

    INSERT INTO orders VALUES
      ('order_signed', 'store1', 'appt_signed', '已支付', '2026-01-01T10:00:00.000Z'),
      ('order_pending', 'store1', 'appt_pending', '已支付', '2026-01-01T10:10:00.000Z'),
      ('order_canceled', 'store1', 'appt_canceled', '已支付', '2026-01-01T10:20:00.000Z'),
      ('order_no_show', 'store1', 'appt_no_show', '已支付', '2026-01-01T10:30:00.000Z'),
      ('order_refunded', 'store1', 'appt_refunded', '已退款', '2026-01-01T10:40:00.000Z'),
      ('order_duplicate_first', NULL, 'appt_duplicate', '已支付', '2026-01-01T11:00:00.000Z'),
      ('order_duplicate_second', '', 'appt_duplicate', '已支付', '2026-01-01T11:01:00.000Z');

    INSERT INTO customerSignatures VALUES
      ('signature_signed', '{"orderId":"order_signed","title":"服务完成确认签名","status":"已签名","signedAt":"2026-01-01T12:00:00.000Z"}'),
      ('signature_pending', '{"orderId":"order_pending","title":"服务完成确认签名","status":"待签名"}'),
      ('signature_malformed', '{not-valid-json');
  `);
  migrationDb.exec(readFileSync(new URL("../migrations/0051_appointment_checkout_integrity.sql", import.meta.url), "utf8"));

  const appointment = (id: string) => ({ ...migrationDb.prepare(
    "SELECT status, completedAt, canceledAt, cancelReason, noShowAt FROM appointments WHERE id = ?",
  ).get(id) }) as { status: string; completedAt?: string; canceledAt?: string; cancelReason?: string; noShowAt?: string };
  assert.deepEqual(
    appointment("appt_signed"),
    { status: "已完成", completedAt: "2026-01-01T12:00:00.000Z", canceledAt: null, cancelReason: null, noShowAt: null },
    "migration should prefer the signed service-completion timestamp",
  );
  assert.equal(appointment("appt_pending").status, "已完成", "pending signatures should no longer leave paid appointments in the cashier queue");
  assert.equal(appointment("appt_pending").completedAt, "2026-01-01T10:10:00.000Z", "pending signatures should fall back to order time");
  assert.deepEqual(
    appointment("appt_canceled"),
    { status: "已完成", completedAt: "2026-01-01T10:20:00.000Z", canceledAt: null, cancelReason: null, noShowAt: null },
    "migration should repair legacy canceled appointments with an active paid order",
  );
  assert.deepEqual(
    appointment("appt_no_show"),
    { status: "已完成", completedAt: "2026-01-01T10:30:00.000Z", canceledAt: null, cancelReason: null, noShowAt: null },
    "migration should repair legacy no-show appointments with an active paid order",
  );
  assert.equal(appointment("appt_refunded").status, "已到店", "refunded orders should not complete an appointment");
  assert.equal(
    (migrationDb.prepare("SELECT appointmentId FROM orders WHERE id = 'order_duplicate_second'").get() as { appointmentId: string | null }).appointmentId,
    null,
    "migration should detach only the later duplicate link",
  );
  assert.equal(
    (migrationDb.prepare("SELECT retainedOrderId FROM orderAppointmentConflictAudit WHERE detachedOrderId = 'order_duplicate_second'").get() as { retainedOrderId: string }).retainedOrderId,
    "order_duplicate_first",
    "migration should audit the preserved order link before detaching it",
  );
  assert.equal(
    (migrationDb.prepare("SELECT json_extract(payload_json, '$.status') AS status FROM customerSignatures WHERE id = 'signature_pending'").get() as { status: string }).status,
    "待签名",
    "migration must retain pending signatures for later signing",
  );

  migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_constraint_first", "store1", "appt_constraint", "已支付", "2026-01-02T10:00:00.000Z");
  assert.throws(
    () => migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_constraint_second", "store1", "appt_constraint", "已支付", "2026-01-02T10:01:00.000Z"),
    /UNIQUE constraint failed/,
    "same-store active orders must not reuse an appointment",
  );
  migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_refunded_duplicate", "store1", "appt_constraint", "已退款", "2026-01-02T10:02:00.000Z");
  migrationDb.prepare("UPDATE orders SET status = '已退款' WHERE id = 'order_constraint_first'").run();
  migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_reopened", "store1", "appt_constraint", "已支付", "2026-01-02T10:03:00.000Z");
  migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_null_store_first", null, "appt_null_constraint", "已支付", "2026-01-02T11:00:00.000Z");
  assert.throws(
    () => migrationDb.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run("order_blank_store_second", "", "appt_null_constraint", "已支付", "2026-01-02T11:01:00.000Z"),
    /UNIQUE constraint failed/,
    "NULL and blank legacy stores must share the same uniqueness bucket",
  );
  migrationDb.close();
}

try {
  const baseUrl = await listen(server);

  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert.equal(health.ok, true, "health check should pass");
  const autoVersionHealth = await request<{ version?: string }>(baseUrl, "/api/health?clientVersion=0.1.0");
  assert.equal(autoVersionHealth.version, pkg.version, "old clients should receive update versions automatically");
  const currentVersionHealth = await request<{ version?: string }>(baseUrl, `/api/health?clientVersion=${pkg.version}`);
  assert.equal(currentVersionHealth.version, undefined, "current clients should not receive update versions automatically");
  const manualVersionHealth = await request<{ version?: string }>(baseUrl, "/api/health?clientVersion=0.1.0&manualUpdateCheck=1");
  assert.ok(manualVersionHealth.version, "manual settings update check should expose the current version");

  await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      () => request(baseUrl, "/api/auth/login", { method: "POST", body: { account: "rate-limit@test.local", password: "wrong-password" } }),
      /账号或密码不正确/,
      "invalid login should not disclose whether the account exists",
    );
  }
  await assert.rejects(
    () => request(baseUrl, "/api/auth/login", { method: "POST", body: { account: "rate-limit@test.local", password: "wrong-password" } }),
    /登录尝试过多/,
    "sixth invalid login in fifteen minutes should be throttled",
  );

  const session = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "manager@test.local", password: "test-password" },
  });
  assert.equal(session.user.roleName, "主管", "login API should return role session");

  const frontdeskSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "frontdesk@test.local", password: "test-password" },
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
  assert.equal(initialData.customers.length, 3, "test fixture should seed customers");
  assert.equal(initialData.orders.length, 0, "seed should start without orders");
  for (const config of defaultSystemConfigs()) {
    assert.ok(initialData.systemConfigs.some((item) => item.key === config.key), `API data should include normalized system config ${config.key}`);
  }
  assert.ok(initialData.authUsers.every((user) => user.password === ""), "API data should not expose passwords");
  const crossStoreData = database.readData();
  database.replaceData({
    ...crossStoreData,
    storeProfiles: [{ id: "store2", name: "隔离验证分店", phone: "13900002000", address: "隔离验证地址", businessHours: "10:00-22:00", createdAt: new Date().toISOString() }, ...crossStoreData.storeProfiles],
    authUsers: [
      { id: "u_store2_owner", storeId: "store2", name: "隔离店长", account: "store2-owner@test.local", password: "test-password", role: "owner", roleName: "老板", status: "active", createdAt: new Date().toISOString() },
      ...crossStoreData.authUsers,
    ],
    staff: [
      { id: "s_store2", storeId: "store2", name: "隔离员工", phone: "13900002001", role: "员工", status: "active", accountId: "u_store2_owner", hiredAt: "2026-01-01" },
      ...crossStoreData.staff,
    ],
    customers: [
      { id: "c_store2", storeId: "store2", name: "隔离客户", phone: "13900002002", level: "普通会员", points: 0, source: "隔离验证", tags: ["隔离"], lastVisit: new Date().toISOString() },
      ...crossStoreData.customers,
    ],
    orders: [
      { id: "o_store2", storeId: "store2", orderNo: "SO-STORE2", customerId: "c_store2", staffId: "s_store2", serviceId: "v1", totalAmount: 88, paidAmount: 88, discountAmount: 0, payMethod: "微信", status: "已支付", createdAt: new Date().toISOString() },
      ...crossStoreData.orders,
    ],
    operationLogs: [
      { id: "log_store2", storeId: "store2", userId: "u_store2_owner", action: "隔离验证", targetType: "customer", targetId: "c_store2", summary: "隔离验证日志", createdAt: new Date().toISOString() },
      ...crossStoreData.operationLogs,
    ],
    memberCardTransactions: [
      {
        id: "legacy_empty_store_card_income",
        storeId: "",
        memberCardId: "m1",
        type: "充值",
        amountDelta: 100,
        timesDelta: 0,
        balanceAfter: 2_700,
        remainingTimesAfter: 0,
        paidAmount: 100,
        payMethod: "现金",
        note: "旧数据空门店字段兼容验证",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      ...crossStoreData.memberCardTransactions,
    ],
    customerSignatures: [
      { id: "signature_store2", storeId: "store2", token: "signature-store2-token", customerId: "c_store2", orderId: "o_store2", title: "隔离签名", content: "另一门店签名", status: "待签名", requestedBy: "u_store2_owner", createdAt: new Date().toISOString() },
      ...crossStoreData.customerSignatures,
    ],
  });
  const scopedCustomerSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=customers", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "customers" },
  });
  assert.ok(scopedCustomerSlice.data.customers?.every((customer) => customer.storeId === "store1"), "store-scoped data slice should only return the current store customers");
  assert.ok(!scopedCustomerSlice.data.customers?.some((customer) => customer.id === "c_store2"), "store-scoped data slice should not leak another store customer");
  assert.ok(!scopedCustomerSlice.data.orders?.some((order) => order.id === "o_store2"), "store-scoped data slice should not leak another store order");
  assert.ok(scopedCustomerSlice.data.storeProfiles?.every((store) => store.id === "store1"), "store-scoped data slice should only include current store profile");
  const storeScopedMutation = await request<AppDataSlice>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "customers" },
    body: { name: "门店写入隔离客户", phone: "13900003001" },
  });
  assert.ok(
    storeScopedMutation.data.customers?.some((customer) => customer.name === "门店写入隔离客户" && customer.storeId === "store1"),
    "store-scoped mutation should return the current store change",
  );
  const afterStoreScopedMutation = database.readData();
  assert.ok(afterStoreScopedMutation.customers.some((customer) => customer.id === "c_store2"), "store-scoped mutation should preserve another store customer");
  assert.ok(afterStoreScopedMutation.orders.some((order) => order.id === "o_store2"), "store-scoped mutation should preserve another store order");
  assert.ok(
    afterStoreScopedMutation.customers.some((customer) => customer.name === "门店写入隔离客户" && customer.storeId === "store1"),
    "store-scoped mutation should persist the current store customer",
  );
  const legacyPosSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=pos", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "pos" },
  });
  assert.ok(legacyPosSlice.data.orders, "already-open legacy POS clients should keep receiving orders during a rolling release");
  assert.ok(legacyPosSlice.data.memberCardTransactions, "legacy POS clients should keep receiving member card transactions");
  assert.ok(legacyPosSlice.data.customerSignatures, "legacy POS clients should keep receiving signature rows");
  assert.ok(legacyPosSlice.data.customerServiceRecords, "legacy POS clients should keep receiving service records");
  const posSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=pos", {
    token: session.token,
    headers: {
      "X-App-Data-Mode": "slice",
      "X-App-Data-View": "pos",
      "X-Yich-Capabilities": POS_REMOTE_PAGING_CAPABILITY,
    },
  });
  assert.equal(posSlice.kind, "app-data-slice", "data slice API should return slice marker");
  assert.equal(posSlice.view, "pos", "data slice API should echo requested view");
  assert.equal("orders" in posSlice.data, false, "POS slice should load historical orders through the paged cashier API");
  assert.equal("memberCardTransactions" in posSlice.data, false, "POS slice should not transfer all member card transactions");
  assert.equal("customerSignatures" in posSlice.data, false, "POS slice should load only the selected signature context");
  assert.equal("customerServiceRecords" in posSlice.data, false, "POS slice should not transfer every service record");
  assert.ok(posSlice.data.products, "POS slice should include products");
  assert.equal("storeOwnerApplications" in posSlice.data, false, "POS slice should omit unrelated platform application data");
  assert.ok(JSON.stringify(posSlice).length < JSON.stringify(initialData).length, "view slice should be smaller than full AppData");
  const posDayStart = new Date();
  posDayStart.setHours(0, 0, 0, 0);
  const posDayEnd = new Date(posDayStart);
  posDayEnd.setHours(24, 0, 0, 0);
  const posContext = await request<PosContextResult>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: session.token });
  assert.equal(posContext.cashierFlowTotal, 1, "POS context should include resolvable empty-store legacy rows and exclude another store's rows");
  const emptyCashierPage = await request<CashierFlowPageResult>(baseUrl, "/api/pos/cashier-flow?page=1&pageSize=50", { token: session.token });
  assert.deepEqual(
    emptyCashierPage.items.map((item) => item.id),
    ["legacy_empty_store_card_income"],
    "cashier page should recover an empty-store legacy transaction through its card/customer without leaking another store",
  );
  await assert.rejects(
    () => request<CashierFlowDetailResult>(baseUrl, "/api/pos/cashier-flow/order/o_store2", { token: session.token }),
    /不存在/,
    "cashier detail should not expose another store's order",
  );
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/customer-signatures/signature_store2/sign", { method: "POST", token: session.token, body: { signerName: "越权", signatureText: "data:image/jpeg;base64,AA==" } }),
    /不存在/,
    "signature save should reject another store's signature id",
  );
  const dashboardSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=dashboard", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "dashboard" },
  });
  assert.ok(dashboardSlice.data.memberCardTransactions, "dashboard slice should include member-card cash and reversal transactions");
  const appointmentSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=appointments", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "appointments" },
  });
  assert.ok(appointmentSlice.data.customerSignatures, "appointments slice should include service signatures for workflow columns");
  const customerMutationSlice = await request<AppDataSlice>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "customers" },
    body: { name: "分片验证客户", phone: "13900000001" },
  });
  assert.equal(customerMutationSlice.kind, "app-data-slice", "mutation with slice header should return AppData slice");
  assert.equal(customerMutationSlice.view, "customers", "mutation slice should use active view");
  assert.ok(customerMutationSlice.data.customers?.some((customer) => customer.name === "分片验证客户"), "mutation slice should include updated customers");
  assert.equal("purchaseOrders" in customerMutationSlice.data, false, "customer mutation slice should omit inventory purchase orders");
  const settingsAppointmentSlice = await request<AppDataPatch>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "settings" },
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(44, "02:00"),
      endAt: futureIso(44, "03:00"),
      roomName: "护理房 1",
      note: "管理中心预约分片验证",
    },
  });
  assert.equal(settingsAppointmentSlice.kind, "app-data-patch", "settings appointment mutation should return a lightweight patch");
  assert.equal(settingsAppointmentSlice.view, "settings", "settings mutation slice should use management-center view");
  assert.equal(settingsAppointmentSlice.upserts.appointments?.[0]?.status, "已确认", "manual appointments should enter waiting-arrival column after saving");
  assert.equal(settingsAppointmentSlice.upserts.appointments?.length, 1, "appointment mutation should return only the changed appointment");
  assert.equal("customerSignatures" in settingsAppointmentSlice.upserts, false, "appointment mutation should not return historical signatures");
  assert.equal("memberCards" in settingsAppointmentSlice.upserts, false, "appointment mutation should not return historical cards");

  const adminSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "admin@test.local", password: "test-password" },
  });
  assert.equal(adminSession.user.roleName, "系统管理员", "admin login should return platform admin session");
  await assert.rejects(
    () =>
      request<{ session: { user: { name: string; avatarUrl?: string } }; data: AppData }>(baseUrl, "/api/account-profile", {
        method: "PATCH",
        token: adminSession.token,
        body: { name: "API 管理员", avatarUrl: "data:image/png;base64,AA==" },
      }),
    /头像文件过大/,
    "account profile API should reject inline avatar blobs",
  );
  const avatarForm = new FormData();
  avatarForm.set("avatar", new Blob([Buffer.from("avatar-test")], { type: "image/png" }), "avatar.png");
  const uploadedAvatar = await requestForm<{ avatarUrl: string; key: string; size: number }>(baseUrl, "/api/account-avatar", {
    method: "POST",
    token: adminSession.token,
    body: avatarForm,
  });
  assert.match(uploadedAvatar.avatarUrl, /^\/api\/assets\/avatars\/u_superadmin\//, "account avatar API should return asset URL");
  const usageAfterAvatar = await request<{ objectCount: number; totalBytes: number; prefixes: Array<{ prefix: string; objectCount: number; bytes: number }> }>(
    baseUrl,
    "/api/usage/r2",
    { token: adminSession.token },
  );
  assert.ok(usageAfterAvatar.objectCount > 0, "R2 usage API should include uploaded avatar objects");
  assert.ok(usageAfterAvatar.totalBytes >= uploadedAvatar.size, "R2 usage API should include uploaded avatar bytes");
  assert.ok(usageAfterAvatar.prefixes.some((item) => item.prefix === "avatars/" && item.objectCount > 0), "R2 usage API should group avatars under avatars/");
  const workerUsage = await request<WorkerUsageSnapshot>(baseUrl, "/api/usage/worker", { token: adminSession.token });
  assert.equal(workerUsage.source, "cloudflare-graphql", "worker usage API should use Cloudflare Metrics source");
  assert.equal(typeof workerUsage.requests, "number", "worker usage API should return request count");
  assert.equal(typeof workerUsage.errors, "number", "worker usage API should return error count");
  assert.equal(workerUsage.windowHours, 24, "worker usage API should report the 24 hour metrics window");
  const afterAccountProfile = await request<{ session: { user: { name: string; avatarUrl?: string } }; data: AppData }>(baseUrl, "/api/account-profile", {
    method: "PATCH",
    token: adminSession.token,
    body: { name: "API 管理员", avatarUrl: uploadedAvatar.avatarUrl },
  });
  assert.equal(afterAccountProfile.session.user.name, "API 管理员", "account profile API should update session name");
  assert.equal(afterAccountProfile.session.user.avatarUrl, uploadedAvatar.avatarUrl, "account profile API should update session avatar");
  assert.equal(afterAccountProfile.data.authUsers.find((user) => user.id === "u_superadmin")?.name, "API 管理员", "account profile API should persist user name");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/auth-users/u_superadmin/status", {
        method: "PATCH",
        token: adminSession.token,
        body: { status: "disabled" },
      }),
    /不能停用当前登录账号/,
    "admin should not disable current account",
  );
  const afterDisableFrontdesk = await request<AppData>(baseUrl, "/api/auth-users/u_frontdesk/status", {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "disabled" },
  });
  assert.equal(afterDisableFrontdesk.authUsers.find((user) => user.id === "u_frontdesk")?.status, "disabled", "admin should disable account");
  assert.equal(afterDisableFrontdesk.operationLogs[0].action, "停用账号", "account status API should write operation log");
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "frontdesk@test.local", password: "test-password" },
      }),
    /账号或密码不正确/,
    "disabled account should not login",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/system-configs/invite_default_days", {
        method: "PATCH",
        token: session.token,
        body: { value: "10" },
      }),
    /只有平台 Admin/,
    "manager should not update platform system config",
  );
  const afterSystemConfig = await request<AppData>(baseUrl, "/api/system-configs/invite_default_days", {
    method: "PATCH",
    token: adminSession.token,
    body: { value: "10" },
  });
  assert.equal(
    afterSystemConfig.systemConfigs.find((item) => item.key === "invite_default_days")?.value,
    "10",
    "admin should update system config",
  );
  assert.equal(afterSystemConfig.operationLogs[0].action, "更新系统配置", "system config API should write operation log");
  const ownerInviteWithDefaultDays = await request<AppData>(baseUrl, "/api/store-owner-invites", {
    method: "POST",
    token: adminSession.token,
    body: {
      storeName: "API 配置有效期门店",
      ownerName: "配置有效期老板",
      phone: "13900007777",
      account: "api-configured-owner@test.local",
    },
  });
  const ownerInvite = ownerInviteWithDefaultDays.storeOwnerInvites[0];
  assert.ok(ownerInvite.expiresAt, "store owner invite API should persist expiry");
  assert.equal(
    Math.round((+new Date(ownerInvite.expiresAt ?? "") - +new Date(ownerInvite.createdAt)) / 86400000),
    10,
    "store owner invite API should use configured default days",
  );
  const afterAdminCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: adminSession.token,
    body: { name: "Admin 代建客户", phone: "13600000000" },
  });
  assert.ok(afterAdminCustomer.customers.some((customer) => customer.name === "Admin 代建客户"), "admin should operate customer business with permission template");
  assert.equal(afterAdminCustomer.operationLogs[0].action, "新增客户", "admin business writes should be audited");

  database.replaceData({
    ...database.readData(),
    authUsers: [
      {
        id: "u_legacy_phone_admin",
        name: "后台Admin",
        account: "13827445244",
        password: "legacy-admin-password",
        role: "owner",
        roleName: "老板",
        status: "active",
        createdAt: new Date().toISOString(),
      },
      ...database.readData().authUsers,
    ],
  });
  const phoneAdminSession = await request<{ token: string; user: { role: string; roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "13827445244", password: "legacy-admin-password" },
  });
  // Account-string based elevation was removed (it was a privilege-escalation
  // hole): a phone account whose stored role is "owner" must stay owner and must
  // NOT be auto-promoted to platform superadmin.
  assert.equal(phoneAdminSession.user.role, "owner", "phone account must NOT be auto-elevated to superadmin");
  assert.equal(phoneAdminSession.user.roleName, "老板", "phone account keeps its stored owner role name");

  await assert.rejects(
    () =>
      request<{ status: string }>(baseUrl, "/api/auth/join-invite", {
        method: "POST",
        body: {
          inviteCode: "YC8M6P",
          name: "固定码老板",
          storeName: "固定码门店",
          phone: "13900001000",
          address: "固定码地址",
          account: "fixed-invited-owner@test.local",
          password: "secret",
        },
      }),
    /邀请不存在或已失效/,
    "fixed owner invite code should not submit an application",
  );

  const platformAdmin = testFixtureData.authUsers.find((user) => user.role === "superadmin");
  assert.ok(platformAdmin, "test fixture should include a platform admin");
  const invitedOwnerResult = await request<{ status: string; message: string; applicationId?: string }>(baseUrl, "/api/auth/join-invite", {
    method: "POST",
    body: {
      inviteCode: platformInviteCodeForUser(platformAdmin, testFixtureData.authUsers),
      name: "API 老板",
      storeName: "API 邀请门店",
      phone: "13900001111",
      address: "API 邀请地址",
      account: "api-invited-owner@test.local",
      password: "secret",
    },
  });
  assert.equal(invitedOwnerResult.status, "pending_approval", "owner invite should wait for approval");
  assert.ok(invitedOwnerResult.applicationId, "owner invite should return application id");
  const dataAfterOwnerApplication = await request<AppData>(baseUrl, "/api/data", { token: adminSession.token });
  assert.ok(
    dataAfterOwnerApplication.storeOwnerApplications.some((application) => application.id === invitedOwnerResult.applicationId && application.status === "待审批"),
    "owner invite should create a pending application record",
  );
  assert.ok(
    dataAfterOwnerApplication.notifications.some(
      (notification) =>
        notification.targetId === invitedOwnerResult.applicationId &&
        notification.targetType === "storeOwnerApplication" &&
        notification.view === "permissions" &&
        notification.audienceRoles.includes("superadmin"),
    ),
    "owner invite should notify admin about pending store application",
  );
  assert.ok(
    dataAfterOwnerApplication.authUsers.every((user) => user.account !== "api-invited-owner@test.local"),
    "owner invite should not create owner account before approval",
  );

  const afterStoreProfile = await request<AppData>(baseUrl, "/api/store-profile", {
    method: "PATCH",
    token: session.token,
    body: {
      name: "API 皮肤管理中心",
      phone: "13900000002",
      address: "API 新地址",
      businessHours: "09:30 - 22:00",
      roomNames: ["护理房 1", "护理房 2", "API 护理房 1", "API 护理房 2"],
      maintenanceRoomNames: ["API 护理房 2"],
    },
  });
  assert.equal(afterStoreProfile.storeProfiles[0].name, "API 皮肤管理中心", "store profile API should update store name");
  assert.equal(afterStoreProfile.storeProfiles[0].businessHours, "09:30 - 22:00", "store profile API should update business hours");
  assert.deepEqual(afterStoreProfile.storeProfiles[0].roomNames, ["护理房 1", "护理房 2", "API 护理房 1", "API 护理房 2"], "store profile API should update room names");
  assert.deepEqual(afterStoreProfile.storeProfiles[0].maintenanceRoomNames, ["API 护理房 2"], "store profile API should update specified maintenance rooms");
  const afterStoreDisabled = await request<AppData>(baseUrl, `/api/stores/${afterStoreProfile.storeProfiles[0].id}/status`, {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "disabled" },
  });
  assert.equal(afterStoreDisabled.storeProfiles.find((store) => store.id === afterStoreProfile.storeProfiles[0].id)?.status, "disabled", "admin should disable store");
  assert.equal(afterStoreDisabled.operationLogs[0].action, "停用门店", "store status API should write operation log");
  await assert.rejects(
    () => request<{ storefront: { shareCode: string } }>(baseUrl, "/api/public/store/yich-store"),
    /线上店铺不存在或已停用/,
    "disabled store should hide public storefront",
  );
  const afterStoreEnabled = await request<AppData>(baseUrl, `/api/stores/${afterStoreProfile.storeProfiles[0].id}/status`, {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "active" },
  });
  assert.equal(afterStoreEnabled.storeProfiles.find((store) => store.id === afterStoreProfile.storeProfiles[0].id)?.status, "active", "admin should re-enable store");

  const publicStore = await request<{ storefront: { shareCode: string }; services: Array<{ id: string }> }>(baseUrl, "/api/public/store/yich-store");
  assert.equal(publicStore.storefront.shareCode, "yich-store", "public store API should expose enabled storefront");
  assert.ok(publicStore.services.some((service) => service.id === "v1"), "public store API should expose enabled services");

  for (const staffId of ["s1", "s2", "s3"]) {
    await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
      method: "POST",
      token: session.token,
      body: {
        staffId,
        startAt: futureIso(45, "02:00"),
        endAt: futureIso(45, "03:00"),
        reason: "API 线上预约占用校验",
      },
    });
  }
  await assert.rejects(
    () =>
      request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
        method: "POST",
        body: {
          shareCode: "yich-store",
          customerName: "API 冲突客户",
          phone: "13700000018",
          serviceId: "v1",
          preferredAt: futureIso(45, "02:15"),
        },
      }),
    /暂无可预约服务人员/,
    "public booking API should reject a time with no available staff",
  );

  await request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
    method: "POST",
    body: {
      shareCode: "yich-store",
      customerName: "API 线上客户",
      phone: "13700000008",
      serviceId: "v1",
      preferredAt: futureIso(30, "02:00"),
      note: "线上预约申请",
    },
  });
  const afterPublicRequest = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(afterPublicRequest.onlineBookingRequests[0].status, "待处理", "public booking request should be visible to manager");
  const onlineBookingNotification = afterPublicRequest.notifications.find((notification) => notification.targetType === "onlineBookingRequest");
  assert.ok(onlineBookingNotification, "public booking should create a notification");
  assert.equal(onlineBookingNotification.view, "appointments", "public booking notification should route to appointments");
  const afterPublicConvert = await request<AppData>(baseUrl, `/api/online-booking-requests/${afterPublicRequest.onlineBookingRequests[0].id}/convert`, {
    method: "POST",
    token: session.token,
    body: { staffId: "s3" },
  });
  assert.equal(afterPublicConvert.onlineBookingRequests[0].status, "已转预约", "online booking request API should convert to appointment");
  assert.equal(afterPublicConvert.customers[0].source, "线上预约", "converted online request should create customer source");

  const afterOnlineStorefront = await request<AppData>(baseUrl, "/api/online-storefront", {
    method: "POST",
    token: session.token,
    body: {
      shareCode: "api-online-store",
      status: "启用",
      headline: "API 线上门店",
      description: "API 线上预约",
      enabledServiceIds: ["v1", "v2"],
    },
  });
  assert.equal(afterOnlineStorefront.onlineStorefronts[0].shareCode, "api-online-store", "online storefront API should update share code");

  const afterServiceWithConsumable = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: { name: "API 耗材绑定护理", category: "皮肤管理", price: 398, duration: 60, consumableProductId: "p4", consumableQty: 2 },
  });
  const serviceRecipeId = afterServiceWithConsumable.services[0].id;
  assert.equal(afterServiceWithConsumable.services[0].consumableProductId, "p4", "service API should persist consumable product");
  assert.equal(afterServiceWithConsumable.services[0].consumableQty, 2, "service API should persist consumable quantity");
  const afterServiceRecipe = await request<AppData>(baseUrl, `/api/services/${serviceRecipeId}/consumables`, {
    method: "PATCH",
    token: session.token,
    body: { consumables: [{ productId: "p4", quantity: 2 }, { productId: "p3", quantity: 1 }] },
  });
  assert.deepEqual(afterServiceRecipe.services[0].consumables, [
    { productId: "p4", quantity: 2 },
    { productId: "p3", quantity: 1 },
  ], "service recipe API should persist multiple consumables");
  const afterServiceWithProductsOnly = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: { name: "API 使用商品护理", category: "皮肤管理", price: 298, duration: 45, defaultTimes: 10, consumables: [{ productId: "p4", quantity: 0 }, { productId: "p3", quantity: 0 }] },
  });
  assert.deepEqual(afterServiceWithProductsOnly.services[0].consumables, [
    { productId: "p4", quantity: 0 },
    { productId: "p3", quantity: 0 },
  ], "service API should persist product-only usage configuration");

  const registeredSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/register-store", {
    method: "POST",
    body: {
      storeName: "API 测试门店",
      ownerName: "API 老板",
      phone: "13900000000",
      address: "API 地址",
      account: "api-boss@test.local",
      password: "secret",
    },
  });
  assert.equal(registeredSession.user.roleName, "老板", "register store API should login owner");

  const afterStaff = await request<AppData>(baseUrl, "/api/staff", {
    method: "POST",
    token: session.token,
    body: { name: "API 新员工", phone: "13900000001", role: "员工", baseSalary: 6000, commissionRate: 0.1 },
  });
  const apiStaffId = afterStaff.staff[0].id;
  assert.equal(afterStaff.staff[0].name, "API 新员工", "staff API should create staff");
  const afterStaffUpdate = await request<AppData>(baseUrl, `/api/staff/${apiStaffId}`, {
    method: "PATCH",
    token: session.token,
    body: { name: "API 主管", phone: "13900000009", role: "主管", status: "inactive", baseSalary: 6200, commissionRate: 0.18 },
  });
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.status, "inactive", "staff API should disable staff");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.name, "API 主管", "staff API should update staff name");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.role, "主管", "staff API should update staff role");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.commissionRate, 0.18, "staff API should update commission rate");

  const afterInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
    method: "POST",
    token: session.token,
    body: { staffId: apiStaffId, account: "api-staff@test.local", role: "therapist", validDays: 3 },
  });
  assert.equal(afterInvite.staffInvites[0].status, "待加入", "staff invite API should create invite");
  assert.ok(afterInvite.staffInvites[0].expiresAt, "staff invite API should persist expiry");
  const joinedStaffResult = await request<{ status: string; message: string }>(baseUrl, "/api/auth/join-invite", {
    method: "POST",
    body: { inviteCode: afterInvite.staffInvites[0].inviteCode, name: "API 新员工", password: "secret" },
  });
  assert.equal(joinedStaffResult.status, "pending_approval", "join invite API should wait for staff approval");
  assert.match(joinedStaffResult.message, /店长审核/, "join invite API should explain staff approval");
  const dataAfterStaffJoin = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const joinedStaffUser = dataAfterStaffJoin.authUsers.find((user) => user.account === "api-staff@test.local");
  assert.ok(joinedStaffUser, "staff invite join should create a pending auth user");
  assert.equal(joinedStaffUser.status, "pending", "joined staff user should wait for manager approval");
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "api-staff@test.local", password: "wrong-secret" },
      }),
    /账号或密码不正确/,
    "pending staff login with wrong password should keep generic credential error",
  );
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "api-staff@test.local", password: "secret" },
      }),
    /等待店长审批/,
    "pending staff login should explain approval status",
  );
  const afterApproveStaffUser = await request<AppData>(baseUrl, `/api/auth-users/${joinedStaffUser.id}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "active" },
  });
  assert.equal(afterApproveStaffUser.authUsers.find((user) => user.id === joinedStaffUser.id)?.status, "active", "manager should approve own-store staff account");
  const afterStaffPasswordReset = await request<AppData>(baseUrl, `/api/auth-users/${joinedStaffUser.id}/password`, {
    method: "PATCH",
    token: session.token,
    body: { password: "new-secret" },
  });
  assert.equal(afterStaffPasswordReset.operationLogs[0].action, "重置账号密码", "staff password reset should write operation log");
  const approvedStaffSession = await request<{ token: string; user: { role: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "api-staff@test.local", password: "new-secret" },
  });
  assert.equal(approvedStaffSession.user.role, "therapist", "approved staff should login with reset password");

  const afterRevocableStaff = await request<AppData>(baseUrl, "/api/staff", {
    method: "POST",
    token: session.token,
    body: { name: "API 待作废员工", phone: "13900000008", role: "前台", baseSalary: 5000, commissionRate: 0.05 },
  });
  const afterRevocableInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
    method: "POST",
    token: session.token,
    body: { staffId: afterRevocableStaff.staff[0].id, account: "api-revoke-staff@test.local", role: "frontdesk", validDays: 7 },
  });
  const afterInviteRevoked = await request<AppData>(baseUrl, `/api/staff-invites/${afterRevocableInvite.staffInvites[0].id}`, {
    method: "PATCH",
    token: session.token,
  });
  assert.equal(afterInviteRevoked.staffInvites.find((item) => item.id === afterRevocableInvite.staffInvites[0].id)?.status, "已作废", "staff invite API should revoke pending invite");
  const afterDeleteRevocableStaff = await request<AppData>(baseUrl, `/api/staff/${afterRevocableStaff.staff[0].id}`, {
    method: "DELETE",
    token: session.token,
  });
  assert.equal(afterDeleteRevocableStaff.staff.some((item) => item.id === afterRevocableStaff.staff[0].id), false, "staff API should delete staff without business records");
  assert.equal(afterDeleteRevocableStaff.operationLogs[0].action, "删除员工", "staff delete API should write operation log");

  const afterCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "李女士", phone: "13600000004" },
  });
  assert.equal(afterCustomer.customers[0].name, "李女士", "customer API should create a customer");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/customers", {
        method: "POST",
        token: session.token,
        body: { name: "超长手机号客户", phone: "136000000041" },
      }),
    /手机号必须为 11 位数字/,
    "customer API should reject overlong phone on create",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/customers/${afterCustomer.customers[0].id}`, {
        method: "PATCH",
        token: session.token,
        body: { phone: "136000000041", reason: "API 校验超长手机号" },
      }),
    /手机号必须为 11 位数字/,
    "customer API should reject overlong phone on update",
  );
  const afterCustomerTags = await request<AppData>(baseUrl, `/api/customers/${afterCustomer.customers[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { level: "VIP", source: "转介绍", tags: ["敏感肌", "高消费"], birthday: "1990-05-20", note: "API 客户备注", reason: "API 修正客户资料" },
  });
  assert.equal(afterCustomerTags.customers[0].level, "VIP", "customer API should update member level");
  assert.equal(afterCustomerTags.customers[0].birthday, "1990-05-20", "customer API should update birthday");
  assert.equal(afterCustomerTags.customers[0].note, "API 客户备注", "customer API should update profile note");
  assert.deepEqual(afterCustomerTags.customers[0].tags, ["敏感肌", "高消费"], "customer API should update tags");
  assert.equal(afterCustomerTags.operationLogs[0].action, "更新客户资料", "customer update should write operation log");
  assert.match(afterCustomerTags.operationLogs[0].summary, /API 修正客户资料/, "customer update log should include edit reason");
  const afterTag = await request<AppData>(baseUrl, "/api/tags", {
    method: "POST",
    token: session.token,
    body: { name: "API 熟客", scope: "客户", color: "#db2777" },
  });
  assert.equal(afterTag.tagDefinitions[0].name, "API 熟客", "tag API should create tag definition");
  const afterTagStatus = await request<AppData>(baseUrl, `/api/tags/${afterTag.tagDefinitions[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "停用" },
  });
  assert.equal(afterTagStatus.tagDefinitions[0].status, "停用", "tag API should update tag status");
  const conflictStartAt = initialData.appointments.find((appointment) => appointment.staffId === "s2")?.startAt;
  assert.ok(conflictStartAt, "test fixture should include existing therapist appointment");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: conflictStartAt,
          roomName: "护理房 1",
          note: "冲突预约",
        },
      }),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /已有预约/);
      assert.match(message, /小雅/);
      assert.match(message, /周女士/);
      assert.match(message, /小气泡深层清洁/);
      assert.match(message, /护理房 1/);
      return true;
    },
    "appointment API should reject staff time conflicts",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "",
          serviceIds: [],
          startAt: futureIso(35, "02:00"),
          endAt: futureIso(36, "02:00"),
          roomName: "护理房 1",
          note: "跨天异常预约",
        },
      }),
    /必须在同一天/,
    "appointment API should reject cross-day appointment creation",
  );

  const afterAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(31, "02:00"),
      endAt: futureIso(31, "03:30"),
      roomName: "护理房 1",
      note: "API 预约",
    },
  });
  assert.equal(afterAppointment.appointments[0].status, "已确认", "appointment API should create confirmed appointment");
  assert.equal(afterAppointment.appointments[0].endAt, futureIso(31, "03:30"), "appointment API should persist explicit end time");
  const appointmentId = afterAppointment.appointments[0].id;
  assert.equal(afterAppointment.notifications[0].targetId, appointmentId, "appointment API should create a target notification");
  const afterNotificationRead = await request<AppData>(baseUrl, `/api/notifications/${afterAppointment.notifications[0].id}/read`, {
    method: "PATCH",
    token: session.token,
  });
  assert.ok(afterNotificationRead.notifications.find((item) => item.id === afterAppointment.notifications[0].id)?.readByUserIds.includes("u_manager"), "notification API should mark one item read");
  const afterNotificationArchive = await request<AppData>(baseUrl, `/api/notifications/${afterAppointment.notifications[0].id}/archive`, {
    method: "PATCH",
    token: session.token,
  });
  assert.ok(
    afterNotificationArchive.notifications.find((item) => item.id === afterAppointment.notifications[0].id)?.archivedByUserIds?.includes("u_manager"),
    "notification API should archive one item for current user",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: "已完成" },
      }),
    /不能从已确认改为已完成/,
    "appointment API should reject invalid status transitions",
  );
  const afterArrive = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  assert.ok(afterArrive.appointments.find((item) => item.id === appointmentId)?.arrivedAt, "appointment API should stamp arrival");
  const afterComplete = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已完成" },
  });
  assert.ok(afterComplete.appointments.find((item) => item.id === appointmentId)?.completedAt, "appointment API should stamp completion");

  const afterSecondAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(32, "05:00"),
      endAt: futureIso(32, "06:00"),
      roomName: "护理房 1",
      note: "API 改约测试",
    },
  });
  const secondAppointmentId = afterSecondAppointment.appointments[0].id;
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}/reschedule`, {
        method: "POST",
        token: session.token,
        body: {
          staffId: "s3",
          serviceId: "v2",
          startAt: futureIso(35, "02:00"),
          endAt: futureIso(36, "02:00"),
          roomName: "护理房 2",
          note: "跨天异常改约",
        },
      }),
    /必须在同一天/,
    "appointment API should reject cross-day rescheduling",
  );
  const afterReschedule = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}/reschedule`, {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      serviceId: "v2",
      startAt: futureIso(32, "06:00"),
      endAt: futureIso(32, "07:00"),
      roomName: "护理房 2",
      note: "API 已改约",
    },
  });
  const rescheduledAppointment = afterReschedule.appointments.find((item) => item.id === secondAppointmentId);
  assert.equal(rescheduledAppointment?.serviceId, "v2", "appointment API should reschedule service");
  assert.equal(rescheduledAppointment?.endAt, futureIso(32, "07:00"), "appointment API should reschedule end time");
  assert.ok(rescheduledAppointment?.rescheduledAt, "appointment API should stamp reschedule time");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: "已取消" },
      }),
    /必须填写原因/,
    "appointment API should require cancel reason",
  );
  const afterCancel = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已取消", reason: "客户临时取消" },
  });
  assert.equal(afterCancel.appointments.find((item) => item.id === secondAppointmentId)?.cancelReason, "客户临时取消", "appointment API should keep cancel reason");

  const afterUnavailableSlot = await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: futureIso(33, "02:00"),
      endAt: futureIso(33, "03:00"),
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
          startAt: futureIso(33, "02:15"),
          roomName: "护理房 1",
          note: "不可预约冲突",
        },
      }),
    /不可预约/,
    "appointment API should reject unavailable staff slots",
  );

  const afterShift = await request<AppData>(baseUrl, "/api/staff-shifts", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: futureIso(34, "02:00"),
      endAt: futureIso(34, "03:00"),
      note: "API 早班",
    },
  });
  assert.equal(afterShift.staffShifts[0].note, "API 早班", "staff shift API should create shift");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: futureIso(34, "04:00"),
          roomName: "护理房 1",
          note: "班次外预约",
        },
      }),
    /不在服务人员班次内/,
    "appointment API should reject time outside shift",
  );

  const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
    method: "POST",
    token: session.token,
    body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "API 会员维护价" },
  });
  const discountApprovalId = afterApprovalRequest.approvalRequests[0].id;
  assert.equal(afterApprovalRequest.notifications[0].targetId, discountApprovalId, "approval request should create notification");
  assert.ok(afterApprovalRequest.notifications[0].audienceRoles.includes("finance"), "approval notification should include finance");
  const afterApprovalDecision = await request<AppData>(baseUrl, `/api/approvals/${discountApprovalId}`, {
    method: "PATCH",
    token: session.token,
    body: { approved: true },
  });
  assert.equal(afterApprovalDecision.approvalRequests[0].status, "已通过", "approval API should approve request");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/distributors", {
        method: "POST",
        token: session.token,
        body: { type: "客户", customerId: afterCustomer.customers[0].id, rate: 0.07 },
      }),
    /Not found/,
    "base API should not expose distributor creation",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/referral-relations", {
        method: "POST",
        token: session.token,
        body: { distributorId: "disabled", customerId: "c3" },
      }),
    /Not found/,
    "base API should not expose referral binding",
  );

  const afterDiscountCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "API 会员维护价",
      approvalId: discountApprovalId,
    },
  });
  assert.equal(afterDiscountCheckout.orders[0].paidAmount, 348, "approved discount checkout should reduce paid amount");
  assert.equal(afterDiscountCheckout.orders[0].discountAmount, 50, "discount checkout should persist adjustment");

  const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: "api-checkout-multi-1",
      customerId: "c1",
      staffId: "s2",
      serviceId: serviceRecipeId,
      productItems: [{ productId: "p4", quantity: 2 }],
      giftProductItems: [{ productId: "p2", quantity: 2 }],
      payMethod: "微信",
    },
  });
  assert.equal(afterCheckout.orders.length, 2, "checkout API should create another order");
  assert.equal(afterCheckout.orders[0].totalAmount, 796, "checkout API should calculate multi-product total");
  assert.deepEqual(afterCheckout.orders[0].productItems?.map((item) => [item.productId, item.quantity]), [["p4", 2]], "checkout API should persist sale item lines");
  assert.equal(afterCheckout.orders[0].giftProductId, "p2", "checkout API should persist gift product");
  assert.deepEqual(afterCheckout.orders[0].giftProductItems?.map((item) => [item.productId, item.quantity]), [["p2", 2]], "checkout API should persist gift item lines");
  assert.equal(afterCheckout.products.find((item) => item.id === "p1")?.stock, 18, "checkout API should not consume liquid service product stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p3")?.stock, 8, "checkout API should consume configured package service stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p2")?.stock, 10, "checkout API should consume gift stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p4")?.stock, 21.8, "checkout API should consume retail stock and configured service stock with package conversion");
  const checkoutCommissions = afterCheckout.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
  assert.equal(checkoutCommissions.length, 2, "checkout API should create service and sales commissions");
  assert.equal(checkoutCommissions.find((item) => item.type === "服务提成")?.amount, 48, "checkout API should create service commission");
  assert.equal(checkoutCommissions.find((item) => item.type === "销售提成")?.amount, 48, "checkout API should create sales commission");
  assert.equal(checkoutCommissions[0].rate, 0.12, "checkout API should persist staff commission rate");
  assert.equal(afterCheckout.operationLogs[0].action, "开单收银", "checkout API should write operation log");
  const catalogSnapshotOrderId = afterCheckout.orders[0].id;
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/approvals", {
      method: "POST",
      token: session.token,
      body: { type: "订单退款", targetId: catalogSnapshotOrderId, amount: afterCheckout.orders[0].paidAmount, reason: "API 误单退款审批" },
    }),
    /订单撤销无需审批，请返回收银流水直接撤销/,
    "Node API must reject new refund approvals and direct the cashier back to the order",
  );
  const refundApprovalId = "approval_store1_historical_refund";
  const approvalIsolationData = database.readData();
  database.replaceData({
    ...approvalIsolationData,
    approvalRequests: [
      {
        id: refundApprovalId,
        storeId: "store1",
        type: "订单退款",
        targetId: catalogSnapshotOrderId,
        requestedBy: "u_manager",
        amount: afterCheckout.orders[0].paidAmount,
        reason: "历史退款审批记录",
        status: "已通过",
        approvedBy: "u_manager",
        approvedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "approval_store2_same_order",
        storeId: "store2",
        type: "订单退款",
        targetId: catalogSnapshotOrderId,
        requestedBy: "u_store2",
        amount: afterCheckout.orders[0].paidAmount,
        reason: "其他门店同目标隔离验证",
        status: "已通过",
        approvedBy: "u_store2",
        approvedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      ...approvalIsolationData.approvalRequests,
    ],
  });
  const productSnapshotName = afterCheckout.products.find((item) => item.id === "p4")?.name;
  const checkoutCustomerPoints = afterCheckout.customers.find((item) => item.id === "c1")?.points ?? 0;
  assert.equal(afterCheckout.orders[0].serviceName, "API 耗材绑定护理", "checkout API should snapshot service name");
  assert.equal(afterCheckout.orders[0].servicePrice, 398, "checkout API should snapshot service price");
  assert.equal(afterCheckout.orders[0].productItems?.[0]?.productName, productSnapshotName, "checkout API should snapshot sold product name");
  const afterServiceCatalogEdit = await request<AppData>(baseUrl, `/api/services/${serviceRecipeId}`, {
    method: "PATCH",
    token: session.token,
    body: {
      name: "API 编辑后项目",
      category: "身体管理",
      subcategory: "经络",
      price: 498,
      duration: 75,
      defaultTimes: 6,
      consumables: [{ productId: "p4", quantity: 1 }],
      status: "停用",
      reason: "API 验证项目资料修正",
    },
  });
  const editedService = afterServiceCatalogEdit.services.find((item) => item.id === serviceRecipeId);
  assert.equal(editedService?.name, "API 编辑后项目", "service catalog edit should update service name");
  assert.equal(editedService?.subcategory, "经络", "service catalog edit should update subcategory");
  assert.equal(editedService?.price, 498, "service catalog edit should update future price");
  assert.equal(editedService?.status, "停用", "service catalog edit should update status");
  assert.equal(editedService?.consumables?.[0]?.quantity, 1, "service catalog edit should update bound consumables");
  assert.equal(afterServiceCatalogEdit.operationLogs[0].action, "编辑服务项目", "service catalog edit should write operation log");
  const snapshotAfterServiceEdit = afterServiceCatalogEdit.orders.find((item) => item.id === catalogSnapshotOrderId);
  assert.equal(snapshotAfterServiceEdit?.serviceName, "API 耗材绑定护理", "service catalog edit should keep historical order service name");
  assert.equal(snapshotAfterServiceEdit?.servicePrice, 398, "service catalog edit should keep historical order service price");
  const afterProductCatalogEdit = await request<AppData>(baseUrl, "/api/products/p4", {
    method: "PATCH",
    token: session.token,
    body: {
      name: "API 编辑后商品",
      category: "身体管理",
      subcategory: "耗材",
      unit: "瓶",
      price: 168,
      cost: 66,
      warningStock: 12,
      shelfLifeMonths: 9,
      status: "停用",
      reason: "API 验证商品资料修正",
    },
  });
  const editedProduct = afterProductCatalogEdit.products.find((item) => item.id === "p4");
  assert.equal(editedProduct?.name, "API 编辑后商品", "product catalog edit should update product name");
  assert.equal(editedProduct?.subcategory, "耗材", "product catalog edit should update product subcategory");
  assert.equal(editedProduct?.unit, "瓶", "product catalog edit should update product unit");
  assert.equal(editedProduct?.stock, 21.8, "product catalog edit should not directly change current stock");
  assert.equal(editedProduct?.status, "停用", "product catalog edit should update product status");
  assert.equal(afterProductCatalogEdit.operationLogs[0].action, "编辑商品资料", "product catalog edit should write operation log");
  const snapshotAfterProductEdit = afterProductCatalogEdit.orders.find((item) => item.id === catalogSnapshotOrderId);
  assert.equal(snapshotAfterProductEdit?.productItems?.[0]?.productName, productSnapshotName, "product catalog edit should keep historical order product name");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          checkoutRequestId: "api-checkout-multi-1",
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          productItems: [{ productId: "p4", quantity: 1 }],
          payMethod: "微信",
        },
      }),
    /重复提交/,
    "checkout API should reject duplicate request ids even when order details differ",
  );

  const afterRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 测试退款" },
  });
  const refundedOrder = afterRefund.orders.find((item) => item.id === afterCheckout.orders[0].id);
  assert.ok(refundedOrder, "refunded order should still exist");
  assert.equal(refundedOrder.status, "已退款", "refund API should update order status");
  assert.equal(afterRefund.refunds[0].amount, 796, "refund API should write refund record");
  assert.equal(afterRefund.products.find((item) => item.id === "p1")?.stock, 18, "refund API should keep liquid service product stock untouched");
  assert.equal(afterRefund.products.find((item) => item.id === "p3")?.stock, 9, "refund API should restore this order's package service stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p2")?.stock, 12, "refund API should restore gift stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p4")?.stock, 24, "refund API should restore retail stock");
  assert.equal(
    afterRefund.customers.find((item) => item.id === "c1")?.points,
    checkoutCustomerPoints - Math.floor(796 / 10),
    "full refund API should persist the one-time checkout-points reversal",
  );
  const refundedOrderCommissions = afterRefund.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
  const originalCommissionIds = new Set(checkoutCommissions.map((commission) => commission.id));
  assert.deepEqual(
    refundedOrderCommissions.filter((commission) => originalCommissionIds.has(commission.id)),
    checkoutCommissions,
    "refund API should preserve original commission audit records",
  );
  const refundCommissionAdjustments = refundedOrderCommissions.filter((commission) => commission.id.startsWith(`cmr_${afterRefund.refunds[0].id}_`));
  assert.equal(refundCommissionAdjustments.length, checkoutCommissions.length, "refund API should create one adjustment per original commission");
  assert.ok(refundCommissionAdjustments.every((commission) => commission.status === "待结算" && commission.amount < 0), "refund API should persist negative pending commission adjustments");
  assert.equal(refundedOrderCommissions.reduce((sum, commission) => sum + commission.amount, 0), 0, "full refund API should offset commission exactly");
  const persistedRefundData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.deepEqual(
    persistedRefundData.commissions.filter((commission) => commission.orderId === afterCheckout.orders[0].id).sort((left, right) => left.id.localeCompare(right.id)),
    [...refundedOrderCommissions].sort((left, right) => left.id.localeCompare(right.id)),
    "refund and negative commission adjustments should commit in the same API transaction",
  );
  assert.equal(afterRefund.distributionCommissions.length, 0, "base API should not expose distribution commissions");

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
  assert.equal(
    afterPartialRefund.customers.find((item) => item.id === "c1")?.points,
    afterPartialCheckout.customers.find((item) => item.id === "c1")?.points,
    "partial refund API must not remove checkout points",
  );
  const partialOrderFlowDetail = await request<CashierFlowDetailResult>(
    baseUrl,
    `/api/pos/cashier-flow/order/${encodeURIComponent(afterPartialCheckout.orders[0].id)}`,
    { token: session.token },
  );
  assert.deepEqual(
    partialOrderFlowDetail.data.refunds.map((refund) => refund.orderId),
    [afterPartialCheckout.orders[0].id],
    "cashier detail should return only refunds linked to the selected order",
  );

  const legacyCommissionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: { customerId: "c1", staffId: "s2", serviceId: "v1", payMethod: "微信" },
  });
  const legacyCommissionOrder = legacyCommissionCheckout.orders[0];
  const originalLegacyCommissions = legacyCommissionCheckout.commissions.filter((commission) =>
    commission.orderId === legacyCommissionOrder.id);
  const originalLegacyCommissionTotal = originalLegacyCommissions.reduce(
    (sum, commission) => sum + Math.round(commission.baseAmount * commission.rate),
    0,
  );
  await request<AppData>(baseUrl, "/api/commissions/settle", {
    method: "POST",
    token: session.token,
    body: {},
  });
  const legacyPartialRefund = await request<AppData>(baseUrl, `/api/orders/${legacyCommissionOrder.id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "模拟旧版已结算后部分退款", amount: 100 },
  });
  const legacySnapshot = database.readData();
  const legacySettlementId = legacySnapshot.commissions.find((commission) =>
    commission.orderId === legacyCommissionOrder.id && !commission.id.startsWith("cmr_"))?.settlementId;
  assert.ok(legacySettlementId, "legacy commission fixture should retain exact settlement membership");
  database.replaceData({
    ...legacySnapshot,
    refunds: legacySnapshot.refunds.map((refund) => refund.orderId === legacyCommissionOrder.id
      ? { ...refund, createdAt: "2026-05-25T01:00:00.000Z" }
      : refund),
    commissions: legacySnapshot.commissions
      .filter((commission) => !(commission.orderId === legacyCommissionOrder.id && commission.id.startsWith("cmr_")))
      .map((commission) => commission.orderId === legacyCommissionOrder.id
        ? {
            ...commission,
            amount: Math.round(
              Math.round(commission.baseAmount * commission.rate)
                * (legacyCommissionOrder.paidAmount - 100)
                / legacyCommissionOrder.paidAmount,
            ),
            status: "已结算" as const,
            settledAt: "2026-05-24T02:00:00.000Z",
          }
        : commission),
    commissionSettlements: legacySnapshot.commissionSettlements.map((settlement) =>
      settlement.id === legacySettlementId
        ? { ...settlement, createdAt: "2026-05-24T02:00:00.000Z" }
        : settlement),
  });
  assert.ok(
    legacyPartialRefund.commissions.some((commission) => commission.orderId === legacyCommissionOrder.id && commission.id.startsWith("cmr_")),
    "the fixture should remove a real new-model adjustment to emulate the legacy gap",
  );
  const recoveredLegacyRefund = await request<AppData>(baseUrl, `/api/orders/${legacyCommissionOrder.id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "升级后退完剩余金额" },
  });
  const recoveredLegacyAdjustments = recoveredLegacyRefund.commissions.filter((commission) =>
    commission.orderId === legacyCommissionOrder.id && commission.id.startsWith("cmr_"));
  assert.equal(
    recoveredLegacyAdjustments.reduce((sum, commission) => sum + commission.amount, 0),
    -originalLegacyCommissionTotal,
    "Node refund API should atomically fill the entire missing settled legacy reversal",
  );
  const persistedLegacyRecovery = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.deepEqual(
    persistedLegacyRecovery.commissions
      .filter((commission) => commission.orderId === legacyCommissionOrder.id)
      .sort((left, right) => left.id.localeCompare(right.id)),
    recoveredLegacyRefund.commissions
      .filter((commission) => commission.orderId === legacyCommissionOrder.id)
      .sort((left, right) => left.id.localeCompare(right.id)),
    "legacy commission recovery and the final refund must persist in the same Node transaction",
  );

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

  const openCardRequestId = `verify-open-card-${Date.now()}`;
  const afterOpenCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { openCardRequestId, customerId: "c2", type: "储值卡", balance: 500, remainingTimes: 0, paidAmount: 500, payMethod: "微信", expiresAt: "2027-12-31" },
  }));
  const apiCardId = afterOpenCard.memberCards[0].id;
  assert.equal(afterOpenCard.memberCards[0].name, "储值卡", "open stored-value card API should default card name");
  assert.equal(afterOpenCard.memberCardTransactions[0].paidAmount, 500, "open card API should persist paid amount");
  assert.equal(afterOpenCard.memberCardTransactions[0].payMethod, "微信", "open card API should persist payment method");
  assert.equal(afterOpenCard.memberCardTransactions[0].staffId, "s1", "open card API should persist current staff");
  assert.equal(afterOpenCard.customerSignatures[0].title, "开卡确认签名", "open card API should create a customer confirmation signature");
  assert.equal(afterOpenCard.customerSignatures[0].status, "待签名", "open card API signature should wait for customer signing");
  assert.equal(afterOpenCard.customerSignatures.some((signature) => Boolean(signature.signatureText)), false, "open card API response should not include signature images");
  const cashierPage = await request<CashierFlowPageResult>(baseUrl, "/api/pos/cashier-flow?page=1&pageSize=2", { token: session.token });
  assert.equal(cashierPage.items.length, 2, "cashier API should apply database page size before returning rows");
  assert.ok(cashierPage.totalCount >= cashierPage.items.length, "cashier API should return a matching total count");
  assert.ok(cashierPage.items.every((item) => !("order" in item) && !("transaction" in item)), "cashier list should not expose full source objects");
  const openCardFlowDetail = await request<CashierFlowDetailResult>(
    baseUrl,
    `/api/pos/cashier-flow/memberCard/${encodeURIComponent(afterOpenCard.memberCardTransactions[0].id)}`,
    { token: session.token },
  );
  assert.equal(openCardFlowDetail.record.kind, "memberCard", "cashier detail should resolve the requested source kind");
  assert.equal(openCardFlowDetail.data.memberCardTransactions[0]?.id, afterOpenCard.memberCardTransactions[0].id, "cashier detail should return only the requested source context");
  assert.ok(openCardFlowDetail.data.customerSignatures.every((signature) => !signature.signatureText), "cashier detail should strip signature images");
  const approvedOrderFlowDetail = await request<CashierFlowDetailResult>(
    baseUrl,
    `/api/pos/cashier-flow/order/${encodeURIComponent(catalogSnapshotOrderId)}`,
    { token: session.token },
  );
  assert.deepEqual(
    approvedOrderFlowDetail.data.approvalRequests.map((approval) => approval.id),
    [refundApprovalId],
    "cashier detail should return only same-store refund approvals for the selected order",
  );
  assert.equal(approvedOrderFlowDetail.data.approvalRequests[0]?.status, "已通过", "cashier detail should expose the approved refund request id for recovery");
  const refreshedPosContext = await request<PosContextResult>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: session.token });
  assert.equal(refreshedPosContext.cashierFlowTotal, cashierPage.totalCount, "POS summary and paged flow should share the same count predicate");
  const repeatedOpenCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { openCardRequestId, customerId: "c2", type: "储值卡", balance: 999, remainingTimes: 0, paidAmount: 999, payMethod: "现金", expiresAt: "2028-12-31" },
  }));
  assert.equal(repeatedOpenCard.memberCards[0].id, apiCardId, "duplicate open card request id should return the original card");
  const legacyOpenCardResponse = await request<AppData>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { customerId: "c2", type: "储值卡", balance: 200, remainingTimes: 0, paidAmount: 200, payMethod: "微信", expiresAt: "2027-12-31" },
  });
  assert.ok(legacyOpenCardResponse.memberCards.some((card) => card.balance === 200), "legacy client should continue receiving full AppData after opening a card");
  const afterOpenNewCustomerCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-open-new-customer-${Date.now()}`,
      customerName: "API 开卡新客",
      customerPhone: "13600000999",
      customerBirthday: "1995-09-09",
      customerNote: "API 开卡登记客户备注",
      type: "储值卡",
      balance: 300,
      remainingTimes: 0,
      paidAmount: 300,
      payMethod: "现金",
      expiresAt: "2027-12-31",
    },
  }));
  const openCardCustomer = afterOpenNewCustomerCard.customers.find((customer) => customer.phone === "13600000999");
  assert.equal(openCardCustomer?.birthday, "1995-09-09", "open card API should persist new customer birthday");
  assert.equal(openCardCustomer?.note, "API 开卡登记客户备注", "open card API should persist new customer note");
  const afterOpenVoidCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-open-void-${Date.now()}`,
      customerId: "c2",
      name: "API 错录套餐卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 3, remainingTimes: 3 },
        { serviceId: "v2", totalTimes: 2, remainingTimes: 2 },
      ],
      paidAmount: 1000,
      payMethod: "微信",
      expiresAt: "2027-12-31",
    },
  }));
  const voidCardId = afterOpenVoidCard.memberCards[0].id;
  const afterOpenVoidPosContext = await request<PosContextResult>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: session.token });
  await assert.rejects(
    () => request<AppData>(baseUrl, `/api/member-cards/${voidCardId}/void`, {
      method: "POST",
      token: frontdeskSession.token,
      body: { reason: "前台尝试作废", confirm: "确认作废" },
    }),
    /只有门店老板或店长/,
    "frontdesk should not void a member card opening",
  );
  const afterVoidCard = await request<AppData>(baseUrl, `/api/member-cards/${voidCardId}/void`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 重复开卡录入", confirm: "确认作废" },
  });
  const voidedCard = afterVoidCard.memberCards.find((card) => card.id === voidCardId);
  assert.equal(voidedCard?.status, "已作废", "manager should void an unused erroneous opening");
  assert.equal(voidedCard?.remainingTimes, 0, "void API should clear card times");
  assert.ok(voidedCard?.serviceEntitlements?.every((item) => item.remainingTimes === 0), "void API should clear project entitlement balances");
  assert.equal(afterVoidCard.memberCardTransactions[0].type, "作废", "void API should persist reversal transaction");
  assert.equal(afterVoidCard.memberCardTransactions[0].paidAmount, 1000, "void API should reverse recorded opening cash");
  assert.equal(afterVoidCard.operationLogs[0].action, "开卡错录作废", "void API should persist audit log");
  const afterVoidPosContext = await request<PosContextResult>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: session.token });
  assert.equal(afterVoidPosContext.todayPaid, afterOpenVoidPosContext.todayPaid - 1000, "POS context should subtract voided opening cash from today's paid total");
  const afterOpenPackageCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { openCardRequestId: `verify-open-package-${Date.now()}`, customerId: "c2", name: "API 套餐卡", type: "套餐卡", balance: 0, remainingTimes: 5, serviceIds: ["v1", "v2"], paidAmount: 1200, payMethod: "支付宝", expiresAt: "2027-12-31" },
  }));
  const packageCard = afterOpenPackageCard.memberCards[0];
  assert.equal(packageCard.type, "套餐卡", "package card API should persist package type");
  assert.deepEqual(packageCard.serviceIds, ["v1", "v2"], "package card API should persist multiple services");
  const afterPackageCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceId: "v2",
      payMethod: "会员卡",
      cardId: packageCard.id,
    },
  });
  assert.equal(afterPackageCheckout.memberCards.find((item) => item.id === packageCard.id)?.remainingTimes, 4, "package card should be usable by any selected package service");
  const afterMultiPackageCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceIds: ["v1", "v2"],
      payMethod: "会员卡",
      cardId: packageCard.id,
    },
  });
  assert.deepEqual(afterMultiPackageCheckout.orders[0].serviceIds, ["v1", "v2"], "checkout API should return all selected service ids");
  assert.equal(afterMultiPackageCheckout.memberCardTransactions[0].timesDelta, -2, "checkout API should debit every selected package service");
  const afterMultiPackageReload = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const reloadedMultiPackageOrder = afterMultiPackageReload.orders.find((order) => order.id === afterMultiPackageCheckout.orders[0].id);
  assert.deepEqual(reloadedMultiPackageOrder?.serviceIds, ["v1", "v2"], "checkout API should persist order service ids through database reload");
  const afterOpenMultiServiceCardA = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-multi-service-card-a-${Date.now()}`,
      customerName: "API 多项目分别选卡客户",
      customerPhone: "13600000991",
      name: "API 多项目第一张卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 4, remainingTimes: 4 },
        { serviceId: "v2", totalTimes: 4, remainingTimes: 4 },
      ],
      paidAmount: 1800,
      payMethod: "微信",
      expiresAt: "2027-12-31",
    },
  }));
  const multiServiceCardA = afterOpenMultiServiceCardA.memberCards[0];
  const multiServiceCardCustomerId = multiServiceCardA.customerId;
  const afterOpenMultiServiceCardB = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-multi-service-card-b-${Date.now()}`,
      customerId: multiServiceCardCustomerId,
      name: "API 多项目第二张卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 4, remainingTimes: 4 },
        { serviceId: "v2", totalTimes: 4, remainingTimes: 4 },
      ],
      paidAmount: 1800,
      payMethod: "微信",
      expiresAt: "2027-12-31",
    },
  }));
  const multiServiceCardB = afterOpenMultiServiceCardB.memberCards[0];
  const perServiceCardCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: multiServiceCardCustomerId,
      staffId: "s2",
      serviceIds: ["v1", "v2"],
      serviceCardSelections: [
        { serviceId: "v1", cardId: multiServiceCardA.id },
        { serviceId: "v2", cardId: multiServiceCardB.id },
      ],
      payMethod: "微信",
    },
  });
  assert.deepEqual(
    perServiceCardCheckout.orders[0].serviceCardSelections,
    [{ serviceId: "v1", cardId: multiServiceCardA.id }, { serviceId: "v2", cardId: multiServiceCardB.id }],
    "checkout API should accept and return one selected card per service",
  );
  const perServiceSignature = perServiceCardCheckout.customerSignatures.find((signature) => signature.orderId === perServiceCardCheckout.orders[0].id);
  assert.ok(perServiceSignature, "multi-service checkout should create a pending signature");
  const signedPerServiceCheckout = await request<AppData>(baseUrl, `/api/customer-signatures/${perServiceSignature!.id}/sign`, {
    method: "POST",
    token: session.token,
    body: { signerName: "API 多项目分别选卡", signatureText: "data:image/png;base64,api-per-service-card" },
  });
  assert.deepEqual(
    signedPerServiceCheckout.memberCards.find((card) => card.id === multiServiceCardA.id)?.serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
    [["v1", 3], ["v2", 4]],
    "API signature should debit v1 only from the card selected for v1",
  );
  assert.deepEqual(
    signedPerServiceCheckout.memberCards.find((card) => card.id === multiServiceCardB.id)?.serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
    [["v1", 4], ["v2", 3]],
    "API signature should debit v2 only from the card selected for v2",
  );
  const reloadedPerServiceCheckout = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.deepEqual(
    reloadedPerServiceCheckout.orders.find((order) => order.id === perServiceCardCheckout.orders[0].id)?.serviceCardSelections,
    perServiceCardCheckout.orders[0].serviceCardSelections,
    "service-specific card choices should survive database reload",
  );
  const sameServiceMultiCardCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: multiServiceCardCustomerId,
      staffId: "s2",
      serviceIds: ["v1", "v1", "v1"],
      serviceCardSelections: [
        { serviceId: "v1", cardId: multiServiceCardA.id, quantity: 2 },
        { serviceId: "v1", cardId: multiServiceCardB.id, quantity: 1 },
      ],
      payMethod: "微信",
    },
  });
  assert.deepEqual(
    sameServiceMultiCardCheckout.orders[0].serviceCardSelections,
    [
      { serviceId: "v1", cardId: multiServiceCardA.id, quantity: 2 },
      { serviceId: "v1", cardId: multiServiceCardB.id, quantity: 1 },
    ],
    "checkout API should preserve multiple selected cards for the same service",
  );
  const sameServiceMultiCardSignature = sameServiceMultiCardCheckout.customerSignatures.find(
    (signature) => signature.orderId === sameServiceMultiCardCheckout.orders[0].id,
  );
  assert.ok(sameServiceMultiCardSignature, "same-service multi-card checkout should create a pending signature");
  const signedSameServiceMultiCard = await request<AppData>(
    baseUrl,
    `/api/customer-signatures/${sameServiceMultiCardSignature!.id}/sign`,
    {
      method: "POST",
      token: session.token,
      body: { signerName: "API 同项目多卡", signatureText: "data:image/png;base64,api-same-service-multi-card" },
    },
  );
  assert.equal(
    signedSameServiceMultiCard.memberCards.find((card) => card.id === multiServiceCardA.id)?.serviceEntitlements?.find((item) => item.serviceId === "v1")?.remainingTimes,
    1,
    "same-service multi-card API signature should debit the selected two uses from the first card",
  );
  assert.equal(
    signedSameServiceMultiCard.memberCards.find((card) => card.id === multiServiceCardB.id)?.serviceEntitlements?.find((item) => item.serviceId === "v1")?.remainingTimes,
    3,
    "same-service multi-card API signature should debit the second selected card",
  );
  const reloadedSameServiceMultiCard = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.deepEqual(
    reloadedSameServiceMultiCard.orders.find((order) => order.id === sameServiceMultiCardCheckout.orders[0].id)?.serviceCardSelections,
    sameServiceMultiCardCheckout.orders[0].serviceCardSelections,
    "same-service multi-card selections should survive database reload",
  );
  const afterOpenLimitedPackageCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-open-limited-package-${Date.now()}`,
      customerId: "c2",
      name: "API 独立套餐卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 5, remainingTimes: 5 },
        { serviceId: "v2", totalTimes: 1, remainingTimes: 1 },
      ],
      paidAmount: 1200,
      payMethod: "支付宝",
      expiresAt: "2027-12-31",
    },
  }));
  const limitedPackageCard = afterOpenLimitedPackageCard.memberCards[0];
  const afterCrossCardPackageCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceIds: ["v2", "v2"],
      payMethod: "会员卡",
      cardId: limitedPackageCard.id,
    },
  });
  assert.equal(
    afterCrossCardPackageCheckout.memberCards.find((item) => item.id === limitedPackageCard.id)?.serviceEntitlements?.find((item) => item.serviceId === "v2")?.remainingTimes,
    0,
    "checkout API should debit the preferred package card first",
  );
  assert.equal(
    afterCrossCardPackageCheckout.memberCards.find((item) => item.id === packageCard.id)?.remainingTimes,
    1,
    "checkout API should continue debiting another eligible package card for duplicate services",
  );
  assert.equal(
    afterCrossCardPackageCheckout.memberCardTransactions.filter((item) => item.orderId === afterCrossCardPackageCheckout.orders[0].id && item.type === "消费").length,
    2,
    "checkout API should write one transaction per debited package card",
  );
  const afterOpenInsufficientPackageCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: {
      openCardRequestId: `verify-open-insufficient-package-${Date.now()}`,
      customerName: "API 套餐不足客户",
      customerPhone: "13600000888",
      name: "API 不足套餐卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v2", totalTimes: 1, remainingTimes: 1 },
      ],
      paidAmount: 300,
      payMethod: "微信",
      expiresAt: "2027-12-31",
    },
  }));
  const insufficientCustomerId = afterOpenInsufficientPackageCard.customers.find((customer) => customer.phone === "13600000888")?.id;
  assert.ok(insufficientCustomerId, "open package card API should create insufficient test customer");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: insufficientCustomerId,
          staffId: "s2",
          serviceIds: ["v2", "v2"],
          payMethod: "会员卡",
          cardId: afterOpenInsufficientPackageCard.memberCards[0].id,
        },
      }),
    /肩颈舒缓 SPA剩余次数不足/,
    "checkout API should reject package card checkout when the customer has no eligible balance left",
  );
  const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/recharge`, {
    method: "POST",
    token: session.token,
    body: { amount: 100, paidAmount: 100, payMethod: "微信", note: "API 充值" },
  });
  assert.equal(afterRecharge.memberCards.find((item) => item.id === apiCardId)?.balance, 600, "recharge API should increase balance");
  const afterFreeze = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "冻结", reason: "API 冻结" },
  });
  assert.equal(afterFreeze.memberCards.find((item) => item.id === apiCardId)?.status, "冻结", "status API should freeze card");
  const afterUnfreeze = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "正常", reason: "API 解冻" },
  });
  assert.equal(afterUnfreeze.memberCards.find((item) => item.id === apiCardId)?.status, "正常", "status API should unfreeze card");
  const afterExtend = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/extend`, {
    method: "PATCH",
    token: session.token,
    body: { expiresAt: "2028-12-31", reason: "API 延期" },
  });
  assert.equal(afterExtend.memberCards.find((item) => item.id === apiCardId)?.expiresAt, "2028-12-31", "extend API should update expiry");
  const afterTransfer = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/transfer`, {
    method: "POST",
    token: session.token,
    body: { toCustomerId: "c3", reason: "API 转卡" },
  });
  assert.equal(afterTransfer.memberCards.find((item) => item.id === apiCardId)?.customerId, "c3", "transfer API should update card owner");

  const refundSignatureData = await request<AppData>(baseUrl, "/api/customer-signatures", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      title: "会员卡退费确认签名",
      content: "本人确认办理尊享储值卡退费，实退金额¥100，退款方式银行卡，退费后会员卡关闭。",
      validDays: 1,
    },
  });
  const refundSignature = refundSignatureData.customerSignatures[0];
  await request<AppData>(baseUrl, `/api/customer-signatures/${refundSignature.id}/sign`, {
    method: "POST",
    token: session.token,
    body: { signerName: "周女士", signatureText: "data:image/png;base64,refund-api" },
  });
  const afterCardRefund = await request<AppData>(baseUrl, "/api/member-cards/m1/refund", {
    method: "POST",
    token: session.token,
    body: { reason: "API 退卡", refundAmount: 100, payMethod: "银行卡", signatureId: refundSignature.id },
  });
  assert.equal(afterCardRefund.memberCards.find((item) => item.id === "m1")?.status, "已退卡", "member card refund API should close card");
  assert.equal(afterCardRefund.memberCardTransactions[0].type, "退卡", "member card refund API should write transaction");
  assert.equal(afterCardRefund.memberCardTransactions[0].paidAmount, 100, "member card refund API should persist actual refund amount");
  assert.equal(afterCardRefund.memberCardTransactions[0].payMethod, "银行卡", "member card refund API should persist refund payment method");

  const afterInventory = await request<AppData>(baseUrl, "/api/inventory/adjust", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", type: "入库", quantity: 2, note: "API 入库", expiryAt: "2027-08-01" },
  });
  assert.equal(afterInventory.products.find((item) => item.id === "p1")?.stock, 20, "inventory API should increase liquid product stock without service deduction");
  assert.equal(afterInventory.inventoryLogs[0].note, "API 入库", "inventory API should persist note");
  assert.equal(afterInventory.inventoryLogs[0].expiryAt, "2027-08-01", "inventory API should persist expiry date");

  const afterRecordCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const afterServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: afterRecordCheckout.orders[0].id,
      skinCondition: "敏感偏干",
      beforeNote: "API 服务前",
      careSteps: "API 清洁、导入、修护",
      productsUsed: "API 清洁精华液",
      afterNote: "API 服务后",
      customerFeedback: "API 体验舒适",
      nextCareAdvice: "API 加强保湿防晒",
      nextFollowUpAt: futureIso(35, "10:00"),
    },
  });
  assert.equal(afterServiceRecord.customerServiceRecords.length, 1, "service record API should create record");
  assert.equal(afterServiceRecord.customerServiceRecords[0].orderId, afterRecordCheckout.orders[0].id, "service record API should link order");
  assert.equal(afterServiceRecord.customerServiceRecords[0].careSteps, "API 清洁、导入、修护", "service record API should persist care steps");
  assert.equal(afterServiceRecord.customerServiceRecords[0].productsUsed, "API 清洁精华液", "service record API should persist products used");
  assert.equal(afterServiceRecord.customerServiceRecords[0].customerFeedback, "API 体验舒适", "service record API should persist customer feedback");
  assert.equal(afterServiceRecord.customerServiceRecords[0].nextCareAdvice, "API 加强保湿防晒", "service record API should persist next care advice");
  assert.match(afterServiceRecord.customerFollowUps[0].note, /API 加强保湿防晒/, "service record API follow-up should use next care advice");
  assert.equal(afterServiceRecord.notifications[0].targetId, afterServiceRecord.customerFollowUps[0].id, "service record should create follow-up notification");
  const afterFollowUpEdit = await request<AppData>(baseUrl, `/api/follow-ups/${afterServiceRecord.customerFollowUps[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { method: "电话", note: "API 修改后的跟进内容", reason: "API 修正跟进内容" },
  });
  assert.equal(afterFollowUpEdit.customerFollowUps[0].method, "电话", "follow-up API should update method");
  assert.equal(afterFollowUpEdit.customerFollowUps[0].note, "API 修改后的跟进内容", "follow-up API should update note");
  assert.equal(afterFollowUpEdit.operationLogs[0].action, "编辑客户跟进", "follow-up update should write operation log");
  assert.match(afterFollowUpEdit.operationLogs[0].summary, /API 修正跟进内容/, "follow-up update log should include edit reason");
  const afterSignature = await request<AppData>(baseUrl, "/api/customer-signatures", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      serviceRecordId: afterServiceRecord.customerServiceRecords[0].id,
      orderId: afterRecordCheckout.orders[0].id,
      title: "API 客户服务确认",
      content: "API 确认内容",
      validDays: 3,
    },
  });
  assert.equal(afterSignature.customerSignatures[0].status, "待签名", "customer signature API should create pending signature");
  const signatureToken = afterSignature.customerSignatures[0].token;
  const publicSignature = await request<{ signature: { status: string }; customer: { phone: string } }>(baseUrl, `/api/public/customer-signatures/${signatureToken}`);
  assert.equal(publicSignature.signature.status, "待签名", "public signature API should expose pending signature");
  assert.match(publicSignature.customer.phone, /\*\*\*\*/, "public signature API should mask phone");
  const signedSignature = await request<{ signature: { status: string; signerName: string; signatureText?: string } }>(baseUrl, `/api/public/customer-signatures/${signatureToken}/sign`, {
    method: "POST",
    body: { signerName: "周女士", signatureText: "data:image/png;base64,api123" },
  });
  assert.equal(signedSignature.signature.status, "已签名", "public signature API should sign signature");
  assert.equal(signedSignature.signature.signerName, "周女士", "public signature API should persist signer");
  assert.match(signedSignature.signature.signatureText ?? "", /^data:image\/png;base64,/, "public signature API should persist handwritten image data");
  const afterAllNotificationsRead = await request<AppData>(baseUrl, "/api/notifications/read-all", {
    method: "POST",
    token: session.token,
  });
  assert.ok(afterAllNotificationsRead.notifications.every((item) => item.readByUserIds.includes("u_manager")), "notification API should mark visible notifications read");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/service-records", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          orderId: afterRecordCheckout.orders[0].id,
          skinCondition: "敏感偏干",
          beforeNote: "API 重复建档",
          afterNote: "API 服务后",
        },
      }),
    /已生成服务记录/,
    "service record API should reject duplicate order record",
  );
  const afterCardServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: afterCardCheckout.orders[0].id,
      skinCondition: "会员卡到店服务",
      beforeNote: "API 会员卡服务前",
      afterNote: "API 会员卡服务后",
    },
  });
  assert.equal(afterCardServiceRecord.customerServiceRecords[0].memberCardTransactionId, afterCardCheckout.memberCardTransactions[0].id, "service record API should link member-card consumption");
  assert.match(afterCardServiceRecord.customerServiceRecords[0].productsUsed, /清洁精华液/, "service record API should derive used products");
  const followUpId = afterServiceRecord.customerFollowUps[0].id;
  const afterFollowUpDone = await request<AppData>(baseUrl, `/api/follow-ups/${followUpId}`, {
    method: "PATCH",
    token: session.token,
  });
  assert.equal(afterFollowUpDone.customerFollowUps[0].status, "已完成", "follow-up API should complete follow-up");

  const afterSupplier = await request<AppData>(baseUrl, "/api/suppliers", {
    method: "POST",
    token: session.token,
    body: { name: "API 供应商", phone: "13800000000", contact: "王经理" },
  });
  const supplierId = afterSupplier.suppliers[0].id;
  const afterPurchase = await request<AppData>(baseUrl, "/api/purchase-orders", {
    method: "POST",
    token: session.token,
    body: { supplierId, productId: "p1", quantity: 3, unitCost: 60, expiryAt: "2028-01-31" },
  });
  assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "purchase API should create inbound inventory log");
  assert.equal(afterPurchase.inventoryLogs[0].expiryAt, "2028-01-31", "purchase API should persist expiry date");
  const afterSupplierNewProductPurchase = await request<AppData>(baseUrl, "/api/purchase-orders", {
    method: "POST",
    token: session.token,
    body: {
      supplierName: "API 新供应商",
      productName: "API 采购新面霜",
      productPrice: 188,
      productCategory: "面护类",
      productSubcategory: "膏霜",
      serviceStockDeductible: false,
      quantity: 6,
      unitCost: 52,
      expiryAt: "2028-03-31",
    },
  });
  const apiPurchaseProduct = afterSupplierNewProductPurchase.products.find((product) => product.name === "API 采购新面霜");
  assert.ok(apiPurchaseProduct, "purchase API should create a missing product when productName is new");
  assert.equal(apiPurchaseProduct.stock, 6, "purchase API new product stock should equal purchase quantity");
  assert.equal(apiPurchaseProduct.price, 188, "purchase API new product should persist sales price");
  assert.equal(apiPurchaseProduct.cost, 52, "purchase API new product should persist purchase cost");
  assert.equal(afterSupplierNewProductPurchase.purchaseOrders[0].quantity, 6, "purchase API order quantity should match inbound quantity");
  assert.equal(afterSupplierNewProductPurchase.inventoryBatches[0].quantityIn, 6, "purchase API batch quantity should match inbound quantity");
  assert.equal(afterSupplierNewProductPurchase.inventoryLogs[0].delta, 6, "purchase API log delta should match inbound quantity");
  const afterManualRestock = await request<AppData>(baseUrl, "/api/inventory/adjust", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", type: "入库", quantity: 2, unitCost: 51, note: "API 手动补货", expiryAt: "2028-02-29" },
  });
  assert.equal(afterManualRestock.inventoryLogs[0].note, "API 手动补货", "manual restock API should create inbound inventory log");
  assert.equal(afterManualRestock.inventoryBatches[0].source, "手动入库", "manual restock API should create manual inbound batch");
  assert.equal(afterManualRestock.inventoryBatches[0].unitCost, 51, "manual restock API should persist this inbound unit cost");
  assert.equal(afterManualRestock.products.find((product) => product.id === "p1")?.cost, 51, "manual restock API should update current product cost");
  const afterLowStockProduct = await request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: { name: "API 低库存面膜", type: "consumable", category: "面护类", subcategory: "面膜", stock: 1, warningStock: 5, unit: "盒", price: 30, cost: 12, shelfLifeMonths: 18, expiryAt: "2027-11-30", serviceStockDeductible: true, serviceUnit: "片", serviceUnitsPerStockUnit: 20 },
  });
  const lowStockProductId = afterLowStockProduct.products[0].id;
  assert.equal(afterLowStockProduct.products[0].category, "面护类", "product API should persist category");
  assert.equal(afterLowStockProduct.products[0].subcategory, "面膜", "product API should persist subcategory");
  assert.equal(afterLowStockProduct.products[0].expiryAt, "2027-11-30", "product API should persist first-batch expiry");
  assert.equal(afterLowStockProduct.products[0].serviceStockDeductible, true, "product API should preserve explicit stock deduction configuration");
  assert.equal(afterLowStockProduct.products[0].serviceStockReviewStatus, "confirmed", "explicit product deduction should be marked confirmed");
  assert.equal(afterLowStockProduct.products[0].serviceUnit, "片", "product API should persist service unit");
  assert.equal(afterLowStockProduct.products[0].serviceUnitsPerStockUnit, 20, "product API should persist package quantity");
  assert.equal(afterLowStockProduct.inventoryLogs[0].expiryAt, "2027-11-30", "product API should create first-batch inventory log with expiry");
  const afterNoDeductionProduct = await request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: {
      name: "API 非扣减耗材套盒",
      type: "consumable",
      category: "身体管理",
      subcategory: "套盒",
      stock: 0,
      warningStock: 0,
      unit: "套",
      price: 0,
      serviceStockDeductible: false,
    },
  });
  const noDeductionProduct = afterNoDeductionProduct.products.find((product) => product.name === "API 非扣减耗材套盒");
  assert.ok(noDeductionProduct, "product API should create the no-deduction product");
  assert.equal(noDeductionProduct.serviceStockDeductible, false, "product API should preserve explicit no-deduction for a non-liquid product");
  assert.equal(noDeductionProduct.serviceStockReviewStatus, "confirmed", "explicit no-deduction should be marked confirmed");
  const afterNoDeductionProductEdit = await request<AppData>(baseUrl, `/api/products/${noDeductionProduct.id}`, {
    method: "PATCH",
    token: session.token,
    body: { serviceStockDeductible: false, reason: "API 验证不扣库存配置" },
  });
  assert.equal(
    afterNoDeductionProductEdit.products.find((product) => product.id === noDeductionProduct.id)?.serviceStockDeductible,
    false,
    "product edit API should keep explicit no-deduction instead of recalculating it from the name",
  );
  const persistedNoDeductionData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(
    persistedNoDeductionData.products.find((product) => product.id === noDeductionProduct.id)?.serviceStockDeductible,
    false,
    "SQLite read-back should preserve the explicit no-deduction setting",
  );
  await assert.rejects(() => request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: { name: "API 未选择规则商品", type: "consumable", category: "身体管理", subcategory: "套盒", stock: 0, warningStock: 0, unit: "套", price: 0 },
  }), /选择.*扣库存.*不扣库存/, "product API should reject new products without an explicit stock rule");
  const afterNoDeductionService = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: {
      name: "API 非扣减耗材关联项目",
      category: "身体管理",
      price: 198,
      duration: 60,
      defaultTimes: 1,
      consumables: [{ productId: noDeductionProduct.id, quantity: 1 }],
    },
  });
  assert.deepEqual(
    afterNoDeductionService.services.find((service) => service.name === "API 非扣减耗材关联项目")?.consumables,
    [{ productId: noDeductionProduct.id, quantity: 1 }],
    "service API should preserve product links independently from inventory deduction",
  );
  const noDeductionService = afterNoDeductionService.services.find((service) => service.name === "API 非扣减耗材关联项目");
  assert.ok(noDeductionService, "service API should return the created no-deduction service");
  const afterNoDeductionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: "api-no-deduction-checkout",
      customerId: "c1",
      staffId: "s2",
      serviceId: noDeductionService.id,
      payMethod: "微信",
    },
  });
  assert.deepEqual(afterNoDeductionCheckout.orders[0].serviceConsumables, [], "API checkout should snapshot an empty service deduction list");
  assert.equal(
    afterNoDeductionCheckout.products.find((product) => product.id === noDeductionProduct.id)?.stock,
    0,
    "API no-deduction checkout should leave zero stock unchanged",
  );
  const persistedNoDeductionCheckout = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.deepEqual(
    persistedNoDeductionCheckout.orders.find((order) => order.id === afterNoDeductionCheckout.orders[0].id)?.serviceConsumables,
    [],
    "SQLite read-back should preserve an empty service deduction snapshot",
  );
  const afterRestock = await request<AppData>(baseUrl, "/api/inventory/restock-low", {
    method: "POST",
    token: session.token,
    body: { supplierId },
  });
  assert.ok(afterRestock.purchaseOrders.some((order) => order.productId === lowStockProductId), "restock API should create purchase order for low stock product");
  assert.ok((afterRestock.products.find((product) => product.id === lowStockProductId)?.stock ?? 0) > 5, "restock API should replenish stock above warning line");
  assert.equal(afterRestock.operationLogs[0].action, "一键补货", "restock API should write operation log");
  const afterStocktake = await request<AppData>(baseUrl, "/api/stocktakes", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", actualStock: 20, reason: "API 盘点" },
  });
  assert.equal(afterStocktake.stocktakes[0].actualStock, 20, "stocktake API should create stocktake record");

  const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
    method: "POST",
    token: session.token,
    body: { businessDate: new Date().toISOString().slice(0, 10) },
  });
  assert.equal(afterDailyClose.dailyCloses.length, 1, "daily close API should create daily close record");
  assert.ok(afterDailyClose.dailyCloses[0].revenue >= 398, "daily close should summarize revenue");
  const afterCommissionSettlement = await request<AppData>(baseUrl, "/api/commissions/settle", {
    method: "POST",
    token: session.token,
  });
  assert.equal(afterCommissionSettlement.commissionSettlements[0].type, "员工提成", "commission settle API should create settlement batch");
  assert.ok(afterCommissionSettlement.commissions.every((item) => item.status !== "待结算"), "commission settle API should settle pending commissions");
  assert.ok(afterCommissionSettlement.commissions.some((item) => item.settlementId === afterCommissionSettlement.commissionSettlements[0].id), "commission settle API should stamp settlement id");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/inventory/adjust", {
        method: "POST",
        token: session.token,
        body: { productId: "p1", type: "入库", quantity: 1 },
      }),
    /已日结锁账/,
    "daily close should lock same-day inventory API",
  );
  const afterReverseClose = await request<AppData>(baseUrl, "/api/daily-close/reverse", {
    method: "POST",
    token: session.token,
    body: { businessDate: new Date().toISOString().slice(0, 10) },
  });
  assert.equal(afterReverseClose.dailyCloses[0].status, "已反结", "reverse close API should unlock business day");
  const afterOtherStaffCustomerOrder = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: "api-therapist-customer-resource",
      customerId: "c3",
      staffId: "s3",
      serviceId: "v1",
      payMethod: "现金",
    },
  });
  const otherStaffCustomerOrderId = afterOtherStaffCustomerOrder.orders[0].id;

  const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "therapist@test.local", password: "test-password" },
  });
  const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.ok(therapistData.customers.some((item) => item.id === "c3"), "therapist should see same-store customers handled by other staff");
  assert.ok(therapistData.customerServiceRecords.every((item) => item.storeId === "store1"), "therapist should receive same-store customer service records");
  assert.ok(therapistData.appointments.some((item) => item.staffId !== "s2"), "therapist should see all same-store appointments");
  assert.ok(therapistData.orders.some((item) => item.id === otherStaffCustomerOrderId && item.staffId === "s3"), "therapist should see same-store customer orders handled by other staff");
  assert.ok(therapistData.staffUnavailableSlots.every((item) => item.staffId === "s2"), "therapist should only see own unavailable slots");
  assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");
  await request<AppData>(baseUrl, "/api/ai-usage-permissions", {
    method: "PATCH",
    token: session.token,
    body: {
      permissions: {
        owner: { copy: true, image: true, video: true },
        staff: { copy: false, image: false, video: false },
      },
    },
  });
  const restrictedTherapistAiData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.equal(
    restrictedTherapistAiData.storeProfiles[0]?.aiUsagePermissions?.staff.copy,
    false,
    "therapist should receive updated staff AI copy permission",
  );
  await assert.rejects(
    () =>
      request(baseUrl, "/api/marketing-ai/generate", {
        method: "POST",
        token: therapistSession.token,
        body: {
          kind: "copy",
          storeName: "祝融｜坤锋美学门店",
          productName: "舒缓精华",
          serviceName: "舒缓护理",
          audience: "老客",
          channel: "朋友圈",
        },
      }),
    /当前门店未开放 AI 文案权限/,
    "therapist should not generate marketing copy after staff AI copy permission is closed",
  );
  await request<AppData>(baseUrl, "/api/operational-permissions", {
    method: "PATCH",
    token: session.token,
    body: { permissions: { staffCanViewAllAppointments: false } },
  });
  const restrictedTherapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.ok(restrictedTherapistData.appointments.every((item) => item.staffId === "s2"), "therapist should only see own appointments after shared appointment permission is closed");

  const persistedData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(persistedData.orders.length, 14, "API data should persist across requests, including multi-project and same-project multi-card selections plus legacy commission recovery fixtures");
  assert.equal(persistedData.refunds.length, 4, "API data should persist refunds, including both legacy recovery stages");
  assert.equal(persistedData.distributionCommissions.length, 0, "base API should not expose distribution commissions");
  assert.ok(persistedData.operationLogs.length >= 4, "API data should persist operation logs");

  const afterSuperadminLockCustomerA = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "系统管理员并发客户甲", phone: "13600009001" },
  });
  const superadminLockCustomerAId = afterSuperadminLockCustomerA.customers[0].id;
  const afterSuperadminLockCustomerB = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "系统管理员并发客户乙", phone: "13600009002" },
  });
  const superadminLockCustomerBId = afterSuperadminLockCustomerB.customers[0].id;

  const afterSuperadminLockProduct = await request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: {
      name: "系统管理员并发库存验证",
      type: "sale",
      category: "面护类",
      subcategory: "面膜",
      unit: "盒",
      price: 20,
      cost: 10,
      stock: 1,
      warningStock: 1,
      serviceStockDeductible: false,
    },
  });
  const superadminLockProductId = afterSuperadminLockProduct.products[0].id;
  const superadminConcurrentCheckoutResults = await Promise.allSettled([
    request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: adminSession.token,
      body: {
        checkoutRequestId: `node-superadmin-last-stock-a-${Date.now()}`,
        customerId: superadminLockCustomerAId,
        staffId: "s2",
        productItems: [{ productId: superadminLockProductId, quantity: 1 }],
        payMethod: "微信",
      },
    }),
    request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: adminSession.token,
      body: {
        checkoutRequestId: `node-superadmin-last-stock-b-${Date.now()}`,
        customerId: superadminLockCustomerBId,
        staffId: "s2",
        productItems: [{ productId: superadminLockProductId, quantity: 1 }],
        payMethod: "微信",
      },
    }),
  ]);
  assert.equal(
    superadminConcurrentCheckoutResults.filter((result) => result.status === "fulfilled").length,
    1,
    "superadmin checkouts must share the target store lock when selling the last stock unit",
  );
  const rejectedSuperadminCheckout = superadminConcurrentCheckoutResults.find((result) => result.status === "rejected");
  assert.match(
    rejectedSuperadminCheckout?.status === "rejected" ? String(rejectedSuperadminCheckout.reason) : "",
    /库存不足|当前仅剩/,
    "the second superadmin checkout must observe the committed inventory deduction",
  );
  const afterSuperadminConcurrentCheckout = await request<AppData>(baseUrl, "/api/data", { token: adminSession.token });
  assert.equal(
    afterSuperadminConcurrentCheckout.products.find((product) => product.id === superadminLockProductId)?.stock,
    0,
    "superadmin concurrency must never make inventory negative",
  );
  assert.equal(
    afterSuperadminConcurrentCheckout.orders.filter((order) =>
      order.productItems?.some((item) => item.productId === superadminLockProductId),
    ).length,
    1,
    "superadmin concurrency must persist exactly one order for the last stock unit",
  );
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: adminSession.token,
      body: {
        checkoutRequestId: `node-superadmin-mixed-store-${Date.now()}`,
        customerId: "c_store2",
        staffId: "s2",
        productItems: [{ productId: superadminLockProductId, quantity: 1 }],
        payMethod: "微信",
      },
    }),
    /混合多个门店/,
    "superadmin business mutations must reject mixed-store targets instead of running without a lock",
  );
  const beforeSuperadminSettlement = database.readData();
  const store1SuperadminOrderId = beforeSuperadminSettlement.orders.find((order) =>
    order.productItems?.some((item) => item.productId === superadminLockProductId),
  )?.id;
  assert.ok(store1SuperadminOrderId, "superadmin stock verification should have persisted its store-one order");
  database.replaceData({
    ...beforeSuperadminSettlement,
    commissions: [
      {
        id: "commission_superadmin_store1",
        storeId: "store1",
        staffId: "s2",
        orderId: store1SuperadminOrderId,
        type: "销售提成" as const,
        baseAmount: 20,
        rate: 0.1,
        amount: 2,
        status: "待结算" as const,
        createdAt: new Date().toISOString(),
      },
      {
        id: "commission_superadmin_store2",
        storeId: "store2",
        staffId: "s_store2",
        orderId: "o_store2",
        type: "销售提成" as const,
        baseAmount: 88,
        rate: 0.1,
        amount: 8.8,
        status: "待结算" as const,
        createdAt: new Date().toISOString(),
      },
      ...beforeSuperadminSettlement.commissions,
    ],
  });
  const superadminSettlementConcurrency = await Promise.allSettled([
    request<AppData>(baseUrl, "/api/commissions/settle", {
      method: "POST",
      token: adminSession.token,
    }),
    request<AppData>(baseUrl, "/api/inventory/adjust", {
      method: "POST",
      token: session.token,
      body: { productId: superadminLockProductId, type: "入库", quantity: 1 },
    }),
  ]);
  assert.equal(
    superadminSettlementConcurrency.filter((result) => result.status === "fulfilled").length,
    2,
    "superadmin all-store settlement must serialize with ordinary store mutations without rejecting either operation",
  );
  const afterSuperadminSettlement = await request<AppData>(baseUrl, "/api/data", { token: adminSession.token });
  assert.equal(
    afterSuperadminSettlement.products.find((product) => product.id === superadminLockProductId)?.stock,
    1,
    "ordinary store inventory writes must survive a concurrent superadmin all-store settlement",
  );
  assert.ok(
    ["commission_superadmin_store1", "commission_superadmin_store2"].every((commissionId) =>
      afterSuperadminSettlement.commissions.find((commission) => commission.id === commissionId)?.status === "已结算",
    ),
    "superadmin settlement must retain its historical all-store contract while holding each store lock",
  );
  const afterReorderedServiceCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "多项目防重复客户", phone: "13600009003" },
  });
  const reorderedServiceCustomerId = afterReorderedServiceCustomer.customers[0].id;
  const afterReorderedServiceProduct = await request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: {
      name: "多项目防重复库存",
      type: "sale",
      category: "面护类",
      subcategory: "面膜",
      unit: "盒",
      price: 20,
      cost: 10,
      stock: 2,
      warningStock: 1,
      serviceStockDeductible: false,
    },
  });
  const reorderedServiceProductId = afterReorderedServiceProduct.products[0].id;
  await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: `node-service-order-a-${Date.now()}`,
      customerId: reorderedServiceCustomerId,
      staffId: "s2",
      serviceIds: ["v1", "v2"],
      productItems: [{ productId: reorderedServiceProductId, quantity: 1 }],
      payMethod: "微信",
    },
  });
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: session.token,
      body: {
        checkoutRequestId: `node-service-order-b-${Date.now()}`,
        customerId: reorderedServiceCustomerId,
        staffId: "s2",
        serviceIds: ["v2", "v1"],
        productItems: [{ productId: reorderedServiceProductId, quantity: 1 }],
        payMethod: "微信",
      },
    }),
    /重复提交/,
    "Node API should treat reordered service ids as the same recent checkout",
  );
  const afterReorderedServiceRetry = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(afterReorderedServiceRetry.products.find((product) => product.id === reorderedServiceProductId)?.stock, 1, "reordered service retry must deduct retail stock only once");
  assert.equal(
    afterReorderedServiceRetry.orders.filter((order) => order.productItems?.some((item) => item.productId === reorderedServiceProductId)).length,
    1,
    "reordered service retry must persist only one order",
  );

  const afterArrivedAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      serviceIds: ["v1", "v2"],
      startAt: futureIso(36, "08:00"),
      endAt: futureIso(36, "09:00"),
      roomName: "护理房 1",
      note: "API 预约收银",
    },
  });
  const checkoutAppointmentId = afterArrivedAppointment.appointments[0].id;
  assert.deepEqual(afterArrivedAppointment.appointments[0].serviceIds, ["v1", "v2"], "appointment API should persist multiple services");
  await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(checkoutAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  const afterAppointmentCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v2",
      appointmentId: checkoutAppointmentId,
      payMethod: "微信",
    },
  });
  assert.equal(afterAppointmentCheckout.orders[0].appointmentId, checkoutAppointmentId, "checkout API should link arrived appointment");
  assert.equal(afterAppointmentCheckout.orders[0].serviceId, "v2", "checkout API should allow one of appointment services");
  assert.equal(afterAppointmentCheckout.appointments.find((item) => item.id === checkoutAppointmentId)?.status, "已完成", "checkout API should remove a paid appointment from the cashier queue immediately");
  assert.equal(afterAppointmentCheckout.customerSignatures[0].orderId, afterAppointmentCheckout.orders[0].id, "checkout API should create pending signature after service checkout");
  assert.equal(afterAppointmentCheckout.customerSignatures[0].status, "待签名", "checkout API signature should start pending");
  const persistedAppointmentCheckout = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.ok(persistedAppointmentCheckout.orders.some((order) => order.id === afterAppointmentCheckout.orders[0].id), "checkout transaction should persist the order");
  assert.ok(
    persistedAppointmentCheckout.customerSignatures.some((signature) => signature.orderId === afterAppointmentCheckout.orders[0].id && signature.status === "待签名"),
    "the same checkout transaction should persist and return its pending signature",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v3",
          appointmentId: checkoutAppointmentId,
          payMethod: "微信",
        },
      }),
    /只有已到店预约可以直接收银|收银信息与预约不一致|已生成收银单/,
    "checkout API should reject invalid appointment checkout",
  );
  const signedAppointmentCheckout = await request<AppData>(baseUrl, `/api/customer-signatures/${afterAppointmentCheckout.customerSignatures[0].id}/sign`, {
    method: "POST",
    token: session.token,
    body: { signerName: "周女士", signatureText: "data:image/png;base64,appointment-api" },
  });
  assert.equal(signedAppointmentCheckout.appointments.find((item) => item.id === checkoutAppointmentId)?.status, "已完成", "service signature API should complete appointment");

  const reopenAppointmentStart = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const afterReopenAppointmentCreate = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s3",
      serviceId: "v2",
      startAt: reopenAppointmentStart,
      roomName: "护理房 1",
      note: "API 预约去重与退款重开",
    },
  });
  const reopenAppointmentId = afterReopenAppointmentCreate.appointments[0].id;
  await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(reopenAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  const firstReopenCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: `node-appointment-first-${Date.now()}`,
      customerId: "c2",
      staffId: "s3",
      serviceId: "v2",
      appointmentId: reopenAppointmentId,
      payMethod: "微信",
    },
  });
  const firstReopenOrderId = firstReopenCheckout.orders[0].id;
  const firstPendingSignatureId = firstReopenCheckout.customerSignatures.find(
    (signature) => signature.orderId === firstReopenOrderId && signature.status === "待签名",
  )?.id;
  assert.ok(firstPendingSignatureId, "appointment checkout should create a pending signature before refund");
  const legacyCancelGuardData = database.readData();
  database.replaceData({
    ...legacyCancelGuardData,
    appointments: legacyCancelGuardData.appointments.map((appointment) =>
      appointment.id === reopenAppointmentId
        ? { ...appointment, status: "已到店" as const, completedAt: undefined }
        : appointment,
    ),
  });
  await assert.rejects(
    () => request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(reopenAppointmentId)}`, {
      method: "PATCH",
      token: session.token,
      body: { status: "已取消", reason: "不应允许取消已收银预约" },
    }),
    /已有有效收银单/,
    "appointment API must read orders and reject canceling a legacy arrived appointment with an active order",
  );
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: session.token,
      body: {
        checkoutRequestId: `node-appointment-explicit-duplicate-${Date.now()}`,
        customerId: "c2",
        staffId: "s3",
        serviceId: "v2",
        appointmentId: reopenAppointmentId,
        payMethod: "微信",
      },
    }),
    /已生成收银单|只有已到店预约可以直接收银/,
    "same appointment id should not be checked out twice",
  );
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: session.token,
      body: {
        checkoutRequestId: `node-appointment-implicit-duplicate-${Date.now()}`,
        customerId: "c2",
        staffId: "s3",
        serviceId: "v2",
        payMethod: "微信",
      },
    }),
    /匹配到的预约已生成收银单|检测到刚刚已生成相同订单/,
    "omitting appointmentId must not bypass a checked-out appointment",
  );
  const afterFullAppointmentRefund = await request<AppData>(baseUrl, `/api/orders/${firstReopenOrderId}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 误单全额退款" },
  });
  assert.equal(afterFullAppointmentRefund.appointments.find((item) => item.id === reopenAppointmentId)?.status, "已到店", "full refund should restore the appointment for a corrected checkout");
  assert.equal(afterFullAppointmentRefund.customerSignatures.find((item) => item.id === firstPendingSignatureId)?.status, "已作废", "full refund should void the old pending service signature");
  const reopenedCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: `node-appointment-reopened-${Date.now()}`,
      customerId: "c2",
      staffId: "s3",
      serviceId: "v2",
      appointmentId: reopenAppointmentId,
      payMethod: "微信",
    },
  });
  assert.notEqual(reopenedCheckout.orders[0].id, firstReopenOrderId, "refund should allow a new corrected order");
  assert.equal(reopenedCheckout.orders[0].appointmentId, reopenAppointmentId, "corrected order should restore the unique appointment link");
  await verifyRetailAppointmentIsolation(
    (path, options = {}) => request<AppData>(baseUrl, path, { ...options, token: session.token }),
    { customerId: "c2", staffId: "s3", appointmentId: reopenAppointmentId, productId: "p4" },
  );

  const concurrentCreateStartAt = futureIso(45, "08:00");
  const concurrentCreateResults = await Promise.allSettled([
    request<AppData>(baseUrl, "/api/appointments", {
      method: "POST",
      token: session.token,
      body: {
        customerId: "c1",
        staffId: "s3",
        serviceId: "v2",
        startAt: concurrentCreateStartAt,
        roomName: "护理房 1",
        note: "Node 并发新建预约 A",
      },
    }),
    request<AppData>(baseUrl, "/api/appointments", {
      method: "POST",
      token: session.token,
      body: {
        customerId: "c2",
        staffId: "s3",
        serviceId: "v2",
        startAt: concurrentCreateStartAt,
        roomName: "护理房 1",
        note: "Node 并发新建预约 B",
      },
    }),
  ]);
  assert.equal(concurrentCreateResults.filter((result) => result.status === "fulfilled").length, 1, "concurrent appointment creation should share the store lock");
  const rejectedConcurrentCreate = concurrentCreateResults.find((result) => result.status === "rejected");
  assert.match(
    rejectedConcurrentCreate?.status === "rejected" ? String(rejectedConcurrentCreate.reason) : "",
    /时间冲突|已有预约|房间.*占用/,
    "the concurrent appointment loser should observe the first committed appointment",
  );
  const afterConcurrentCreate = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(
    afterConcurrentCreate.appointments.filter((appointment) => appointment.staffId === "s3" && appointment.startAt === concurrentCreateStartAt).length,
    1,
    "concurrent appointment creation must persist exactly one overlapping appointment",
  );

  const concurrentAppointmentCreate = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c3",
      staffId: "s3",
      serviceId: "v2",
      startAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      roomName: "护理房 1",
      note: "API 收银与取消并发一致性",
    },
  });
  const concurrentAppointmentId = concurrentAppointmentCreate.appointments[0].id;
  await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(concurrentAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  const concurrentAppointmentResults = await Promise.allSettled([
    request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: session.token,
      body: {
        checkoutRequestId: `node-appointment-concurrent-checkout-${Date.now()}`,
        customerId: "c3",
        staffId: "s3",
        serviceId: "v2",
        appointmentId: concurrentAppointmentId,
        payMethod: "微信",
      },
    }),
    request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(concurrentAppointmentId)}`, {
      method: "PATCH",
      token: session.token,
      body: { status: "已取消", reason: "API 并发取消验证" },
    }),
  ]);
  assert.equal(concurrentAppointmentResults.filter((result) => result.status === "fulfilled").length, 1, "checkout and cancellation should serialize to one successful outcome");
  const rejectedConcurrentAppointmentResult = concurrentAppointmentResults.find((result) => result.status === "rejected");
  assert.match(
    rejectedConcurrentAppointmentResult?.status === "rejected" ? String(rejectedConcurrentAppointmentResult.reason) : "",
    /已有有效收银单|只有已到店预约可以直接收银/,
    "concurrent loser should observe the serialized appointment/order state",
  );
  const afterConcurrentAppointmentMutation = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const concurrentActiveOrder = afterConcurrentAppointmentMutation.orders.find(
    (order) => order.appointmentId === concurrentAppointmentId && order.status !== "已退款",
  );
  const concurrentAppointment = afterConcurrentAppointmentMutation.appointments.find((item) => item.id === concurrentAppointmentId);
  assert.ok(
    concurrentActiveOrder
      ? concurrentAppointment?.status === "已完成"
      : concurrentAppointment?.status === "已取消",
    "concurrent checkout/cancel must never leave an active order on a canceled appointment",
  );

  const beforeSignatureRefundRace = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const raceCardId = "m2";
  const raceCardTimesBefore = beforeSignatureRefundRace.memberCards.find((card) => card.id === raceCardId)?.remainingTimes;
  assert.ok(typeof raceCardTimesBefore === "number" && raceCardTimesBefore > 0, "signature/refund race fixture needs a usable project card");
  const signatureRefundRaceAppointmentData = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c3",
      staffId: "s1",
      serviceId: "v1",
      startAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      roomName: "护理房 2",
      note: "公开签名与退款并发原子性",
    },
  });
  const signatureRefundRaceAppointmentId = signatureRefundRaceAppointmentData.appointments[0].id;
  await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(signatureRefundRaceAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  const signatureRefundRaceCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: `node-signature-refund-race-${Date.now()}`,
      customerId: "c3",
      staffId: "s1",
      serviceId: "v1",
      appointmentId: signatureRefundRaceAppointmentId,
      cardId: raceCardId,
      payMethod: "会员卡",
    },
  });
  const signatureRefundRaceOrder = signatureRefundRaceCheckout.orders[0];
  const signatureRefundRaceSignature = signatureRefundRaceCheckout.customerSignatures.find((signature) =>
    signature.orderId === signatureRefundRaceOrder.id,
  );
  assert.ok(signatureRefundRaceSignature, "checkout should create a pending signature for the signature/refund race");
  assert.equal(
    signatureRefundRaceCheckout.memberCards.find((card) => card.id === raceCardId)?.remainingTimes,
    raceCardTimesBefore - 1,
    "race checkout should debit the project card once before signing/refunding",
  );
  const signatureRefundRaceResults = await Promise.allSettled([
    request<{ signature: { status: string } }>(
      baseUrl,
      `/api/public/customer-signatures/${encodeURIComponent(signatureRefundRaceSignature.token)}/sign`,
      {
        method: "POST",
        body: { signerName: "并发签名客户", signatureText: "data:image/png;base64,node-signature-refund-race" },
      },
    ),
    request<AppData>(baseUrl, `/api/orders/${encodeURIComponent(signatureRefundRaceOrder.id)}/refund`, {
      method: "POST",
      token: session.token,
      body: { reason: "Node 签名并发全额退款" },
    }),
  ]);
  assert.ok(signatureRefundRaceResults.some((result) => result.status === "fulfilled"), "signature/refund race must complete one serialized outcome");
  const afterSignatureRefundRace = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const finalRaceOrder = afterSignatureRefundRace.orders.find((order) => order.id === signatureRefundRaceOrder.id);
  const finalRaceSignature = afterSignatureRefundRace.customerSignatures.find((signature) => signature.id === signatureRefundRaceSignature.id);
  const finalRaceCard = afterSignatureRefundRace.memberCards.find((card) => card.id === raceCardId);
  const finalRaceAppointment = afterSignatureRefundRace.appointments.find((appointment) => appointment.id === signatureRefundRaceAppointmentId);
  const finalRaceRefunds = afterSignatureRefundRace.refunds.filter((refund) => refund.orderId === signatureRefundRaceOrder.id);
  const signedOutcome = finalRaceOrder?.status === "已支付"
    && finalRaceSignature?.status === "已签名"
    && finalRaceCard?.remainingTimes === raceCardTimesBefore - 1
    && finalRaceAppointment?.status === "已完成"
    && finalRaceRefunds.length === 0;
  const refundedOutcome = finalRaceOrder?.status === "已退款"
    && finalRaceSignature?.status === "已作废"
    && finalRaceCard?.remainingTimes === raceCardTimesBefore
    && finalRaceAppointment?.status === "已到店"
    && finalRaceRefunds.length === 1;
  assert.ok(signedOutcome !== refundedOutcome && (signedOutcome || refundedOutcome), "signature/refund concurrency must finish in exactly one coherent paid-or-refunded state");
  if (refundedOutcome) {
    assert.equal(finalRaceSignature?.status, "已作废", "a refunded order's signature must never be revived after the refund commits");
    assert.equal(
      afterSignatureRefundRace.memberCardTransactions.filter((transaction) => transaction.orderId === signatureRefundRaceOrder.id && transaction.type === "退款").length,
      1,
      "signature/refund concurrency must restore the project card exactly once",
    );
  }

  const directLargeRefundCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: `node-split-refund-${Date.now()}`,
      customerId: "c1",
      staffId: "s2",
      serviceIds: ["v1", "v3"],
      payMethod: "微信",
    },
  });
  const splitApprovalOrder = directLargeRefundCheckout.orders[0];
  const pointsAfterSplitCheckout = directLargeRefundCheckout.customers.find((customer) => customer.id === "c1")?.points ?? 0;
  assert.ok(splitApprovalOrder.paidAmount > 1000, "API direct-refund fixture should exceed 1000");
  const firstSplitRefund = await request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "Node 首笔 900", amount: 900 },
  });
  assert.equal(firstSplitRefund.customers.find((customer) => customer.id === "c1")?.points, pointsAfterSplitCheckout, "first partial API refund should preserve points");
  const afterSplitFullRefund = await request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "Node 录入错误直接退完", amount: splitApprovalOrder.paidAmount - 900 },
  });
  assert.equal(afterSplitFullRefund.orders.find((order) => order.id === splitApprovalOrder.id)?.status, "已退款", "Node cumulative refund above 1000 should finish directly without approval");
  assert.equal(
    afterSplitFullRefund.customers.find((customer) => customer.id === "c1")?.points,
    pointsAfterSplitCheckout - Math.floor(splitApprovalOrder.paidAmount / 10),
    "Node full cumulative refund should atomically persist the one-time points reversal",
  );

  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token }),
    /Not found/,
    "formal API should not expose a reset endpoint",
  );

  const dataQuality = await request<{ issueCount: number; removalCounts: Array<{ scope: string; count: number }> }>(baseUrl, "/api/data-quality", { token: session.token });
  assert.ok(dataQuality.issueCount > 0, "data quality API should preview fixture cleanup issues");
  assert.ok(dataQuality.removalCounts.length > 0, "data quality API should include cleanup removal counts");
  await request<{ ok: boolean }>(baseUrl, "/api/auth/logout", { method: "POST", token: session.token });
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/data", { token: session.token }),
    /请先登录/,
    "logout should revoke the server session immediately",
  );
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/data-quality/cleanup", { method: "POST", token: registeredSession.token, body: { confirm: "错误确认" } }),
    /确认短语不正确/,
    "data cleanup API should require exact confirmation phrase",
  );
  const afterFormalCleanup = await request<AppData>(baseUrl, "/api/data-quality/cleanup", {
    method: "POST",
    token: registeredSession.token,
    body: { confirm: "清理非正式数据" },
  });
  assert.ok(afterFormalCleanup.staff.every((staff) => !staff.name.includes("验证")), "data cleanup API should remove verification staff");
  assert.ok(afterFormalCleanup.authUsers.every((user) => !user.account.includes("@test.local")), "data cleanup API should remove test accounts");

  console.log("API/SQLite 验证通过：健康检查、注册/邀请、登录鉴权、人员管理、权限、客户、预约/班次、审批改价、开单、退款、卡项、档案跟进、客户签名、进销存、日结反结、数据范围、持久化、正式接口边界。");
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

function memberCardPatchData(patch: AppDataPatch): AppData {
  return {
    ...emptyAppData(),
    ...patch.upserts,
  };
}

async function request<T>(baseUrl: string, path: string, options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(isErrorPayload(data) ? data.error : `HTTP ${response.status}`);
  }
  return data as T;
}

async function requestForm<T>(baseUrl: string, path: string, options: { method?: string; body: FormData; token?: string }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body,
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
