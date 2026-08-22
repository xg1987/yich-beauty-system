import assert from "node:assert/strict";
import { emptyAppData, type AppDataPatch } from "../src/domain/dataSlices";
import type { CashierFlowDetailResult } from "../src/domain/cashierFlow";
import type { AppData } from "../src/domain/types";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8788";
const allowPersistentWrite = process.env.ALLOW_PERSISTENT_CLOUDFLARE_VERIFY === "1";
const isLocalTarget = isLocalApiTarget(baseUrl);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const scheduleDayOffset = 10000 + (Date.now() % 100000);
const roomName = "护理房 1";
const closeBusinessDate = futureDay(1000 + (Date.now() % 100000));

if (!isLocalTarget && !allowPersistentWrite) {
  throw new Error("Cloudflare API 验证会写入目标 D1 数据。请改用本地 wrangler pages dev，或明确设置 ALLOW_PERSISTENT_CLOUDFLARE_VERIFY=1。");
}

const health = await request<{ ok: boolean; runtime?: string; schema?: { ok: boolean; missingTables?: string[] } }>(baseUrl, "/api/health");
assertCloudflareSchemaReady(health);
assert.equal(health.ok, true, "health check should pass");
assert.equal(health.runtime, "cloudflare-d1", "Cloudflare API should report D1 runtime");

await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

for (let attempt = 0; attempt < 5; attempt += 1) {
  await assert.rejects(
    () => request(baseUrl, "/api/auth/login", { method: "POST", body: { account: `rate-limit-${runId}@test.local`, password: "wrong-password" } }),
    /账号或密码不正确/,
    "D1 invalid login should not disclose whether the account exists",
  );
}
await assert.rejects(
  () => request(baseUrl, "/api/auth/login", { method: "POST", body: { account: `rate-limit-${runId}@test.local`, password: "wrong-password" } }),
  /登录尝试过多/,
  "D1 should throttle the sixth invalid login in fifteen minutes",
);

const ownerSession = await request<{ token: string; user: { id: string; roleName: string } }>(baseUrl, "/api/auth/register-store", {
  method: "POST",
  body: {
    storeName: `Cloudflare 正式验证门店 ${runId}`,
    ownerName: "Cloudflare 店主",
    phone: "13900000000",
    address: "Cloudflare 地址",
    account: `cf-owner-${runId}@test.local`,
    password: "secret",
  },
});
assert.equal(ownerSession.user.roleName, "老板", "D1 should register store and login owner");

await assert.rejects(
  () => request<AppData>(baseUrl, "/api/reset", { method: "POST", token: ownerSession.token }),
  /Not found/,
  "formal Cloudflare API should not expose a reset endpoint",
);

await requestIfAvailable(baseUrl, "/api/daily-close/reverse", {
  method: "POST",
  token: ownerSession.token,
  body: { businessDate: closeBusinessDate },
});

const initialData = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.ok(initialData.authUsers.every((user) => user.password === ""), "D1 API should not expose passwords");
await request<AppData>(baseUrl, "/api/store-profile", {
  method: "PATCH",
  token: ownerSession.token,
  body: {
    name: initialData.storeProfiles[0]?.name ?? `Cloudflare 正式验证门店 ${runId}`,
    phone: initialData.storeProfiles[0]?.phone ?? "13900000000",
    address: initialData.storeProfiles[0]?.address ?? "Cloudflare 地址",
    businessHours: initialData.storeProfiles[0]?.businessHours ?? "10:00 - 21:00",
    roomNames: [roomName],
    maintenanceRoomNames: [],
  },
});

const afterCustomer = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证客户 ${runId}`, phone: "13600000001" },
});
const customerId = afterCustomer.customers[0].id;

const afterSecondCustomer = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证转卡客户 ${runId}`, phone: "13600000002" },
});
const secondCustomerId = afterSecondCustomer.customers[0].id;

const afterTag = await request<AppData>(baseUrl, "/api/tags", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证标签 ${runId}`, scope: "客户", color: "#6d28d9" },
});
assert.equal(afterTag.tagDefinitions[0].name, `验证标签 ${runId}`, "D1 should persist tag definition");

const afterProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证零售商品 ${runId}`, type: "sale", category: "面护类", subcategory: "面膜", unit: "盒", price: 199, cost: 92, stock: 24, warningStock: 8, shelfLifeMonths: 18, expiryAt: futureDay(180), serviceStockDeductible: true, serviceUnit: "片", serviceUnitsPerStockUnit: 10 },
});
const productId = afterProduct.products[0].id;
assert.equal(afterProduct.products[0].category, "面护类", "D1 should persist product category");
assert.equal(afterProduct.products[0].serviceUnit, "片", "D1 should persist service unit");
assert.equal(afterProduct.products[0].serviceUnitsPerStockUnit, 10, "D1 should persist package quantity");
assert.equal(afterProduct.inventoryLogs[0].expiryAt, futureDay(180), "D1 should persist initial stock expiry log");

const afterConsumableProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证护理套盒 ${runId}`, type: "consumable", category: "养生类", subcategory: "套盒", unit: "套", price: 88, cost: 36, stock: 12, warningStock: 4, shelfLifeMonths: 12, expiryAt: futureDay(120), serviceStockDeductible: true, serviceUnit: "套", serviceUnitsPerStockUnit: 1 },
});
const consumableProductId = afterConsumableProduct.products[0].id;
assert.equal(afterConsumableProduct.products[0].serviceStockDeductible, true, "D1 should preserve explicit stock deduction configuration");
assert.equal(afterConsumableProduct.products[0].serviceStockReviewStatus, "confirmed", "D1 should persist explicit stock-rule confirmation");

const afterNoDeductionProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: {
    name: `验证非扣减耗材 ${runId}`,
    type: "consumable",
    category: "养生类",
    subcategory: "套盒",
    unit: "套",
    price: 0,
    cost: 0,
    stock: 0,
    warningStock: 0,
    serviceStockDeductible: false,
  },
});
const noDeductionProductId = afterNoDeductionProduct.products[0].id;
assert.equal(afterNoDeductionProduct.products[0].serviceStockDeductible, false, "D1 should preserve explicit no-deduction for every product type");

await assert.rejects(() => request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证未选择规则商品 ${runId}`, type: "consumable", category: "养生类", subcategory: "套盒", unit: "套", price: 0, cost: 0, stock: 0, warningStock: 0 },
}), /选择.*扣库存.*不扣库存/, "D1 should reject new products without an explicit stock rule");

const afterNoDeductionService = await request<AppData>(baseUrl, "/api/services", {
  method: "POST",
  token: ownerSession.token,
  body: {
    name: `验证非扣减关联项目 ${runId}`,
    category: "身体管理",
    price: 198,
    duration: 60,
    consumables: [{ productId: noDeductionProductId, quantity: 1 }],
  },
});
const noDeductionServiceId = afterNoDeductionService.services[0].id;
assert.deepEqual(
  afterNoDeductionService.services[0].consumables,
  [{ productId: noDeductionProductId, quantity: 1 }],
  "D1 should preserve service-product links independently from stock deduction",
);
assert.equal(
  afterNoDeductionService.products.find((product) => product.id === noDeductionProductId)?.serviceStockDeductible,
  false,
  "D1 read-back should keep no-deduction after another persisted mutation",
);

const afterService = await request<AppData>(baseUrl, "/api/services", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证护理项目 ${runId}`, category: "皮肤管理", price: 398, duration: 60 },
});
const serviceId = afterService.services[0].id;

const afterServiceRecipe = await request<AppData>(baseUrl, `/api/services/${serviceId}/consumables`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { consumables: [{ productId: consumableProductId, quantity: 1 }] },
});
assert.deepEqual(
  afterServiceRecipe.services.find((service) => service.id === serviceId)?.consumables,
  [{ productId: consumableProductId, quantity: 1 }],
  "D1 should persist service consumable recipe",
);

const afterTherapistStaff = await request<AppData>(baseUrl, "/api/staff", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证员工 ${runId}`, phone: "13900000001", role: "员工", baseSalary: 6000, commissionRate: 0.1 },
});
const therapistStaffId = afterTherapistStaff.staff[0].id;

const publicShareCode = `cf-${runId}`;
const afterOnlineStorefront = await request<AppData>(baseUrl, "/api/online-storefront", {
  method: "POST",
  token: ownerSession.token,
  body: {
    shareCode: publicShareCode,
    status: "启用",
    headline: "Cloudflare 线上门店",
    description: "Cloudflare 线上预约验证",
    enabledServiceIds: [serviceId],
  },
});
assert.equal(afterOnlineStorefront.onlineStorefronts[0].shareCode, publicShareCode, "D1 should persist online storefront");
const cloudflarePublicStore = await request<{ storefront: { shareCode: string }; services: Array<{ id: string }> }>(baseUrl, `/api/public/store/${publicShareCode}`);
assert.equal(cloudflarePublicStore.storefront.shareCode, publicShareCode, "Cloudflare public store should be readable without login");
assert.equal(cloudflarePublicStore.services[0].id, serviceId, "Cloudflare public store should expose configured service");
await request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
  method: "POST",
  body: {
    shareCode: publicShareCode,
    customerName: `线上预约客户 ${runId}`,
    phone: "13700000001",
    serviceId,
    preferredAt: `${futureDay(scheduleDayOffset + 10)}T02:00:00.000Z`,
    note: "Cloudflare 线上预约申请",
  },
});
const afterOnlineRequest = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
const onlineRequest = afterOnlineRequest.onlineBookingRequests.find((item) => item.customerName === `线上预约客户 ${runId}`);
assert.ok(onlineRequest, "D1 should persist public online booking request");
assert.equal(onlineRequest.status, "待处理", "D1 should persist public online booking request as pending");
const afterOnlineConvert = await request<AppData>(baseUrl, `/api/online-booking-requests/${onlineRequest.id}/convert`, {
  method: "POST",
  token: ownerSession.token,
  body: { staffId: therapistStaffId },
});
assert.equal(afterOnlineConvert.onlineBookingRequests.find((item) => item.id === onlineRequest.id)?.status, "已转预约", "D1 should convert online request into appointment");

const afterFrontdeskStaff = await request<AppData>(baseUrl, "/api/staff", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证前台 ${runId}`, phone: "13900000002", role: "前台", baseSalary: 5000, commissionRate: 0.04 },
});
const frontdeskStaffId = afterFrontdeskStaff.staff[0].id;

const afterTherapistInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
  method: "POST",
  token: ownerSession.token,
  body: { staffId: therapistStaffId, account: `cf-therapist-${runId}@test.local`, role: "therapist", validDays: 3 },
});
assert.ok(afterTherapistInvite.staffInvites[0].expiresAt, "D1 should persist staff invite expiry");
const therapistJoinResult = await request<{ status: string; message: string }>(baseUrl, "/api/auth/join-invite", {
  method: "POST",
  body: { inviteCode: afterTherapistInvite.staffInvites[0].inviteCode, name: `验证员工 ${runId}`, password: "secret" },
});
assert.equal(therapistJoinResult.status, "pending_approval", "D1 should keep therapist invite join pending for owner approval");
assert.match(therapistJoinResult.message, /店长审核/, "D1 should explain staff approval after invite join");
const dataAfterTherapistJoin = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
const therapistUser = dataAfterTherapistJoin.authUsers.find((user) => user.account === `cf-therapist-${runId}@test.local`);
assert.ok(therapistUser, "D1 should create pending therapist auth user");
assert.equal(therapistUser.status, "pending", "D1 therapist user should wait for approval");
await assert.rejects(
  () =>
    request<{ token: string }>(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { account: `cf-therapist-${runId}@test.local`, password: "wrong-secret" },
    }),
  /账号或密码不正确/,
  "D1 pending therapist login with wrong password should keep generic credential error",
);
await assert.rejects(
  () =>
    request<{ token: string }>(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { account: `cf-therapist-${runId}@test.local`, password: "secret" },
    }),
  /等待店长审批/,
  "D1 pending therapist login should explain approval status",
);
const afterTherapistApproval = await request<AppData>(baseUrl, `/api/auth-users/${therapistUser.id}/status`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "active" },
});
assert.equal(afterTherapistApproval.authUsers.find((user) => user.id === therapistUser.id)?.status, "active", "D1 owner should approve therapist account");
const afterTherapistPasswordReset = await request<AppData>(baseUrl, `/api/auth-users/${therapistUser.id}/password`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { password: "new-secret" },
});
assert.equal(afterTherapistPasswordReset.operationLogs[0].action, "重置账号密码", "D1 should reset staff password through owner account management");
const therapistSession = await request<{ token: string; user: { account: string } }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: `cf-therapist-${runId}@test.local`, password: "new-secret" },
});
assert.equal(therapistSession.user.account, `cf-therapist-${runId}@test.local`, "D1 approved therapist should login with reset password");

const afterFrontdeskInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
  method: "POST",
  token: ownerSession.token,
  body: { staffId: frontdeskStaffId, account: `cf-frontdesk-${runId}@test.local`, role: "frontdesk", validDays: 7 },
});
const frontdeskJoinResult = await request<{ status: string; message: string }>(baseUrl, "/api/auth/join-invite", {
  method: "POST",
  body: { inviteCode: afterFrontdeskInvite.staffInvites[0].inviteCode, name: `验证前台 ${runId}`, password: "secret" },
});
assert.equal(frontdeskJoinResult.status, "pending_approval", "D1 should keep frontdesk invite join pending for owner approval");
const dataAfterFrontdeskJoin = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
const frontdeskUser = dataAfterFrontdeskJoin.authUsers.find((user) => user.account === `cf-frontdesk-${runId}@test.local`);
assert.ok(frontdeskUser, "D1 should create pending frontdesk auth user");
await request<AppData>(baseUrl, `/api/auth-users/${frontdeskUser.id}/status`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "active" },
});
const frontdeskSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: `cf-frontdesk-${runId}@test.local`, password: "secret" },
});

const afterRevocableStaff = await request<AppData>(baseUrl, "/api/staff", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证待作废员工 ${runId}`, phone: "13900000008", role: "前台", baseSalary: 5000, commissionRate: 0.04 },
});
const afterRevocableInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
  method: "POST",
  token: ownerSession.token,
  body: { staffId: afterRevocableStaff.staff[0].id, account: `cf-revoke-${runId}@test.local`, role: "frontdesk", validDays: 7 },
});
const afterInviteRevoked = await request<AppData>(baseUrl, `/api/staff-invites/${afterRevocableInvite.staffInvites[0].id}`, {
  method: "PATCH",
  token: ownerSession.token,
});
assert.equal(afterInviteRevoked.staffInvites.find((item) => item.id === afterRevocableInvite.staffInvites[0].id)?.status, "已作废", "D1 should revoke pending staff invite");
const afterDeleteRevocableStaff = await request<AppData>(baseUrl, `/api/staff/${afterRevocableStaff.staff[0].id}`, {
  method: "DELETE",
  token: ownerSession.token,
});
assert.equal(afterDeleteRevocableStaff.staff.some((item) => item.id === afterRevocableStaff.staff[0].id), false, "D1 should delete staff without business records");
assert.equal(afterDeleteRevocableStaff.operationLogs[0].action, "删除员工", "D1 staff delete should write operation log");
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/inventory/adjust", {
      method: "POST",
      token: frontdeskSession.token,
      body: { productId, type: "入库", quantity: 1, expiryAt: futureDay(220) },
    }),
  /无权/,
  "frontdesk should not adjust inventory",
);

const unavailableDay = futureDay(scheduleDayOffset);
const afterUnavailableSlot = await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
  method: "POST",
  token: ownerSession.token,
  body: {
    staffId: therapistStaffId,
    startAt: `${unavailableDay}T02:00:00.000Z`,
    endAt: `${unavailableDay}T03:00:00.000Z`,
    reason: "Cloudflare 员工培训",
  },
});
assert.equal(afterUnavailableSlot.staffUnavailableSlots[0].staffId, therapistStaffId, "D1 should persist unavailable slot");
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/appointments", {
      method: "POST",
      token: ownerSession.token,
      body: {
        customerId,
        staffId: therapistStaffId,
        serviceId,
        startAt: `${unavailableDay}T02:15:00.000Z`,
        roomName,
        note: "不可预约冲突",
      },
    }),
  /不可预约/,
  "Cloudflare appointment API should reject unavailable staff slots",
);

const shiftDay = futureDay(scheduleDayOffset + 1);
const afterShift = await request<AppData>(baseUrl, "/api/staff-shifts", {
  method: "POST",
  token: ownerSession.token,
  body: {
    staffId: therapistStaffId,
    startAt: `${shiftDay}T02:00:00.000Z`,
    endAt: `${shiftDay}T04:00:00.000Z`,
    note: "Cloudflare 早班",
  },
});
assert.equal(afterShift.staffShifts[0].staffId, therapistStaffId, "D1 should persist staff shift");
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/appointments", {
      method: "POST",
      token: ownerSession.token,
      body: { customerId, staffId: therapistStaffId, serviceId, startAt: `${shiftDay}T05:00:00.000Z`, roomName, note: "班次外预约" },
    }),
  /不在服务人员班次内/,
  "Cloudflare appointment API should reject time outside shift",
);

const afterAppointment = await request<AppData>(baseUrl, "/api/appointments", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, staffId: therapistStaffId, serviceId, startAt: `${shiftDay}T02:00:00.000Z`, roomName, note: "Cloudflare 正常预约" },
});
assert.equal(afterAppointment.appointments[0].staffId, therapistStaffId, "D1 should create appointment inside shift");
const appointmentId = afterAppointment.appointments[0].id;
await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "已确认" },
});
const afterAppointmentArrive = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "已到店" },
});
assert.equal(afterAppointmentArrive.appointments.find((item) => item.id === appointmentId)?.status, "已到店", "D1 should mark appointment arrived before checkout");

const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "Cloudflare 会员维护价" },
});
const discountApprovalId = afterApprovalRequest.approvalRequests[0].id;
const afterApprovalDecision = await request<AppData>(baseUrl, `/api/approvals/${discountApprovalId}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { approved: true },
});
assert.equal(afterApprovalDecision.approvalRequests[0].status, "已通过", "D1 should approve requests");

await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/distributors", {
      method: "POST",
      token: ownerSession.token,
      body: { type: "客户", customerId, rate: 0.07 },
    }),
  /Not found/,
  "D1 base API should not expose distributor creation",
);
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/referral-relations", {
      method: "POST",
      token: ownerSession.token,
      body: { distributorId: "disabled", customerId: secondCustomerId },
    }),
  /Not found/,
  "D1 base API should not expose referral binding",
);
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/distribution-commissions/settle", {
      method: "POST",
      token: ownerSession.token,
    }),
  /Not found/,
  "D1 base API should not expose distribution settlement",
);

const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-checkout-${runId}`,
    customerId,
    staffId: therapistStaffId,
    serviceId,
    appointmentId,
    productItems: [{ productId, quantity: 2 }],
    giftProductItems: [{ productId: consumableProductId, quantity: 1 }],
    payMethod: "微信",
    discountAmount: 50,
    adjustmentReason: "Cloudflare 会员维护价",
    approvalId: discountApprovalId,
  },
});
const orderId = afterCheckout.orders[0].id;
assert.equal(afterCheckout.orders[0].paidAmount, 746, "approved checkout should persist multi-product total in D1");
assert.deepEqual(afterCheckout.orders[0].productItems?.map((item) => [item.productId, item.quantity]), [[productId, 2]], "D1 checkout should persist sale item lines");
assert.deepEqual(afterCheckout.orders[0].giftProductItems?.map((item) => [item.productId, item.quantity]), [[consumableProductId, 1]], "D1 checkout should persist gift item lines");
assert.equal(afterCheckout.appointments.find((item) => item.id === appointmentId)?.status, "已完成", "D1 appointment checkout should leave the cashier queue immediately");
assert.equal(afterCheckout.customerSignatures[0].orderId, orderId, "D1 checkout should create pending service signature");
const persistedCheckoutData = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.ok(persistedCheckoutData.orders.some((order) => order.id === orderId), "D1 checkout batch should persist the order");
assert.ok(
  persistedCheckoutData.customerSignatures.some((signature) => signature.orderId === orderId && signature.status === "待签名"),
  "D1 checkout response and the same atomic batch should include the pending signature",
);
const afterRefundApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "订单退款", targetId: orderId, amount: afterCheckout.orders[0].paidAmount, reason: "Cloudflare 误单退款审批" },
});
const refundApprovalId = afterRefundApprovalRequest.approvalRequests[0].id;
await request<AppData>(baseUrl, `/api/approvals/${refundApprovalId}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { approved: true },
});
const otherStoreOwner = await request<{ token: string }>(baseUrl, "/api/auth/register-store", {
  method: "POST",
  body: {
    storeName: `Cloudflare 隔离验证门店 ${runId}`,
    ownerName: "Cloudflare 隔离店主",
    phone: "13700000000",
    address: "Cloudflare 隔离地址",
    account: `cf-other-owner-${runId}@test.local`,
    password: "secret",
  },
});
const otherStoreData = await request<AppData>(baseUrl, "/api/data", { token: otherStoreOwner.token });
const otherStoreStaffId = otherStoreData.staff[0]?.id;
assert.ok(otherStoreStaffId, "D1 isolated store registration should create an owner staff record");
await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: otherStoreOwner.token,
  body: { type: "订单退款", targetId: orderId, amount: afterCheckout.orders[0].paidAmount, reason: "其他门店同目标隔离验证" },
});
const approvedOrderFlowDetail = await request<CashierFlowDetailResult>(
  baseUrl,
  `/api/pos/cashier-flow/order/${encodeURIComponent(orderId)}`,
  { token: ownerSession.token },
);
assert.deepEqual(
  approvedOrderFlowDetail.data.approvalRequests.map((approval) => approval.id),
  [refundApprovalId],
  "D1 cashier detail should isolate refund approvals by both store and order",
);
assert.equal(approvedOrderFlowDetail.data.approvalRequests[0]?.status, "已通过", "D1 cashier detail should expose an approved refund request id");
const afterCheckoutSignature = await request<AppData>(baseUrl, `/api/customer-signatures/${afterCheckout.customerSignatures[0].id}/sign`, {
  method: "POST",
  token: ownerSession.token,
  body: { signerName: "Cloudflare 验证客户", signatureText: "data:image/png;base64,cf-service-signature" },
});
assert.equal(afterCheckoutSignature.appointments.find((item) => item.id === appointmentId)?.status, "已完成", "D1 service signature should complete appointment");
assert.equal(afterCheckout.products.find((item) => item.id === productId)?.stock, 22, "D1 checkout should consume retail stock");
assert.equal(afterCheckout.products.find((item) => item.id === consumableProductId)?.stock, 10, "D1 checkout should consume service recipe stock and direct gift stock");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId), "checkout should create commission in D1");
assert.equal(afterCheckout.commissions.find((item) => item.orderId === orderId)?.rate, 0.1, "D1 should persist staff commission rate");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId && item.type === "服务提成"), "D1 should create service commission");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId && item.type === "销售提成"), "D1 should create sales commission");
const duplicateAppointmentStart = new Date(Date.now() + 60 * 1000).toISOString();
const afterDuplicateAppointmentCreate = await request<AppData>(baseUrl, "/api/appointments", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId,
    staffId: therapistStaffId,
    serviceId: noDeductionServiceId,
    startAt: duplicateAppointmentStart,
    roomName,
    note: "Cloudflare 预约去重与退款重开",
  },
});
const duplicateAppointmentId = afterDuplicateAppointmentCreate.appointments[0].id;
await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(duplicateAppointmentId)}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "已到店" },
});
const firstDuplicateCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-appointment-first-${runId}`,
    customerId,
    staffId: therapistStaffId,
    serviceId: noDeductionServiceId,
    appointmentId: duplicateAppointmentId,
    payMethod: "微信",
  },
});
const firstDuplicateOrderId = firstDuplicateCheckout.orders[0].id;
const pointsAfterDuplicateCheckout = firstDuplicateCheckout.customers.find((customer) => customer.id === customerId)?.points ?? 0;
const firstDuplicateSignatureId = firstDuplicateCheckout.customerSignatures.find(
  (signature) => signature.orderId === firstDuplicateOrderId && signature.status === "待签名",
)?.id;
assert.ok(firstDuplicateSignatureId, "D1 linked appointment checkout should create a pending signature");
assert.equal(firstDuplicateCheckout.appointments.find((item) => item.id === duplicateAppointmentId)?.status, "已完成", "D1 linked checkout should immediately leave the cashier queue");
await assert.rejects(
  () => request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(duplicateAppointmentId)}`, {
    method: "PATCH",
    token: ownerSession.token,
    body: { status: "已取消", reason: "不应允许取消已收银预约" },
  }),
  /已有有效收银单|预约状态不能从已完成改为已取消/,
  "D1 appointment API must reject canceling an appointment with an active order",
);
await assert.rejects(
  () => request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: {
      checkoutRequestId: `cf-appointment-explicit-duplicate-${runId}`,
      customerId,
      staffId: therapistStaffId,
      serviceId: noDeductionServiceId,
      appointmentId: duplicateAppointmentId,
      payMethod: "微信",
    },
  }),
  /已生成收银单|只有已到店预约可以直接收银/,
  "D1 should reject a second checkout with the same appointment id",
);
await assert.rejects(
  () => request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: {
      checkoutRequestId: `cf-appointment-implicit-duplicate-${runId}`,
      customerId,
      staffId: therapistStaffId,
      serviceId: noDeductionServiceId,
      payMethod: "微信",
    },
  }),
  /匹配到的预约已生成收银单|检测到刚刚已生成相同订单/,
  "D1 should reject linked-to-unlinked checkout bypass",
);
const afterDuplicateRefund = await request<AppData>(baseUrl, `/api/orders/${firstDuplicateOrderId}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 误单全额退款" },
});
assert.equal(afterDuplicateRefund.appointments.find((item) => item.id === duplicateAppointmentId)?.status, "已到店", "D1 full refund should restore the appointment");
assert.equal(afterDuplicateRefund.customerSignatures.find((item) => item.id === firstDuplicateSignatureId)?.status, "已作废", "D1 full refund should void the old pending signature");
assert.equal(
  afterDuplicateRefund.customers.find((customer) => customer.id === customerId)?.points,
  pointsAfterDuplicateCheckout - Math.floor(firstDuplicateCheckout.orders[0].paidAmount / 10),
  "D1 full refund batch should persist the one-time checkout-points reversal",
);
const refundedOrderFlowDetail = await request<CashierFlowDetailResult>(
  baseUrl,
  `/api/pos/cashier-flow/order/${encodeURIComponent(firstDuplicateOrderId)}`,
  { token: ownerSession.token },
);
assert.deepEqual(
  refundedOrderFlowDetail.data.refunds.map((refund) => refund.orderId),
  [firstDuplicateOrderId],
  "D1 cashier detail should return only refunds for the selected order",
);
const reopenedDuplicateCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-appointment-reopened-${runId}`,
    customerId,
    staffId: therapistStaffId,
    serviceId: noDeductionServiceId,
    appointmentId: duplicateAppointmentId,
    payMethod: "微信",
  },
});
assert.notEqual(reopenedDuplicateCheckout.orders[0].id, firstDuplicateOrderId, "D1 refund should allow a corrected new order");
assert.equal(reopenedDuplicateCheckout.orders[0].appointmentId, duplicateAppointmentId, "D1 corrected order should retain the appointment link");
const concurrentCreateStartAt = `${futureDay(scheduleDayOffset + 2)}T02:00:00.000Z`;
const concurrentCreateResults = await Promise.allSettled([
  request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: ownerSession.token,
    body: {
      customerId,
      staffId: therapistStaffId,
      serviceId: noDeductionServiceId,
      startAt: concurrentCreateStartAt,
      roomName,
      note: "Cloudflare 并发新建预约 A",
    },
  }),
  request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: ownerSession.token,
    body: {
      customerId: secondCustomerId,
      staffId: therapistStaffId,
      serviceId: noDeductionServiceId,
      startAt: concurrentCreateStartAt,
      roomName,
      note: "Cloudflare 并发新建预约 B",
    },
  }),
]);
assert.equal(concurrentCreateResults.filter((result) => result.status === "fulfilled").length, 1, "D1 concurrent appointment creation should share one store lock");
const rejectedConcurrentCreate = concurrentCreateResults.find((result) => result.status === "rejected");
assert.match(
  rejectedConcurrentCreate?.status === "rejected" ? String(rejectedConcurrentCreate.reason) : "",
  /时间冲突|已有预约|房间.*占用/,
  "D1 concurrent appointment loser should observe the first committed appointment",
);
const afterConcurrentCreate = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.equal(
  afterConcurrentCreate.appointments.filter((appointment) => appointment.staffId === therapistStaffId && appointment.startAt === concurrentCreateStartAt).length,
  1,
  "D1 concurrent appointment creation must persist exactly one overlapping appointment",
);
const concurrentCustomerData = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `Cloudflare 并发预约客户 ${runId}`, phone: "13600000000" },
});
const concurrentCustomerId = concurrentCustomerData.customers[0].id;
const concurrentAppointmentData = await request<AppData>(baseUrl, "/api/appointments", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId: concurrentCustomerId,
    staffId: therapistStaffId,
    serviceId: noDeductionServiceId,
    startAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    roomName,
    note: "Cloudflare 收银与取消并发一致性",
  },
});
const concurrentAppointmentId = concurrentAppointmentData.appointments[0].id;
await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(concurrentAppointmentId)}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "已到店" },
});
const concurrentAppointmentResults = await Promise.allSettled([
  request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: {
      checkoutRequestId: `cf-appointment-concurrent-checkout-${runId}`,
      customerId: concurrentCustomerId,
      staffId: therapistStaffId,
      serviceId: noDeductionServiceId,
      appointmentId: concurrentAppointmentId,
      payMethod: "微信",
    },
  }),
  request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(concurrentAppointmentId)}`, {
    method: "PATCH",
    token: ownerSession.token,
    body: { status: "已取消", reason: "Cloudflare 并发取消验证" },
  }),
]);
assert.equal(concurrentAppointmentResults.filter((result) => result.status === "fulfilled").length, 1, "D1 checkout and cancellation should share one store mutation lock");
const rejectedConcurrentAppointmentResult = concurrentAppointmentResults.find((result) => result.status === "rejected");
assert.match(
  rejectedConcurrentAppointmentResult?.status === "rejected" ? String(rejectedConcurrentAppointmentResult.reason) : "",
  /已有有效收银单|只有已到店预约可以直接收银/,
  "D1 concurrent loser should be rejected by the post-lock appointment/order state",
);
const afterConcurrentAppointmentMutation = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
const concurrentActiveOrder = afterConcurrentAppointmentMutation.orders.find(
  (order) => order.appointmentId === concurrentAppointmentId && order.status !== "已退款",
);
const concurrentAppointment = afterConcurrentAppointmentMutation.appointments.find((item) => item.id === concurrentAppointmentId);
assert.ok(
  concurrentActiveOrder
    ? concurrentAppointment?.status === "已完成"
    : concurrentAppointment?.status === "已取消",
  "D1 concurrent checkout/cancel must never leave an active order on a canceled appointment",
);
const splitApprovalCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-split-refund-${runId}`,
    customerId,
    staffId: therapistStaffId,
    serviceId,
    productItems: [{ productId, quantity: 4 }],
    payMethod: "微信",
  },
});
const splitApprovalOrder = splitApprovalCheckout.orders[0];
const splitOriginalCommissions = splitApprovalCheckout.commissions.filter((commission) => commission.orderId === splitApprovalOrder.id);
const pointsAfterSplitCheckout = splitApprovalCheckout.customers.find((customer) => customer.id === customerId)?.points ?? 0;
assert.ok(splitApprovalOrder.paidAmount > 1000, "D1 split-refund fixture should exceed the approval threshold");
const firstSplitRefund = await request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 首笔 900", amount: 900 },
});
assert.equal(firstSplitRefund.customers.find((customer) => customer.id === customerId)?.points, pointsAfterSplitCheckout, "D1 partial refund should preserve points");
assert.deepEqual(
  firstSplitRefund.commissions.filter((commission) => splitOriginalCommissions.some((original) => original.id === commission.id)).sort((left, right) => left.id.localeCompare(right.id)),
  [...splitOriginalCommissions].sort((left, right) => left.id.localeCompare(right.id)),
  "D1 partial refund should preserve original commission audit records",
);
assert.equal(
  firstSplitRefund.commissions.filter((commission) => commission.orderId === splitApprovalOrder.id && commission.id.startsWith(`cmr_${firstSplitRefund.refunds[0].id}_`)).length,
  splitOriginalCommissions.length,
  "D1 partial refund should create one negative adjustment per original commission",
);
await assert.rejects(
  () => request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
    method: "POST",
    token: ownerSession.token,
    body: { reason: "Cloudflare 第二笔不得绕过", amount: splitApprovalOrder.paidAmount - 900 },
  }),
  /大额退款需要审批通过/,
  "D1 API must reject split refunds once the cumulative amount exceeds 1000",
);
const underfundedRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "订单退款", targetId: splitApprovalOrder.id, amount: splitApprovalOrder.paidAmount - 1, reason: "Cloudflare 不足额度" },
});
const underfundedApprovalId = underfundedRequest.approvalRequests[0].id;
await request<AppData>(baseUrl, `/api/approvals/${underfundedApprovalId}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { approved: true },
});
await assert.rejects(
  () => request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
    method: "POST",
    token: ownerSession.token,
    body: { reason: "Cloudflare 不足额度不得使用", amount: splitApprovalOrder.paidAmount - 900, approvalId: underfundedApprovalId },
  }),
  /大额退款需要审批通过/,
  "D1 refund approval must cover the full original payment",
);
const fullApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "订单退款", targetId: splitApprovalOrder.id, amount: splitApprovalOrder.paidAmount, reason: "Cloudflare 完整退款额度" },
});
const fullApprovalId = fullApprovalRequest.approvalRequests[0].id;
await request<AppData>(baseUrl, `/api/approvals/${fullApprovalId}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { approved: true },
});
const afterSplitFullRefund = await request<AppData>(baseUrl, `/api/orders/${splitApprovalOrder.id}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 审批后退完", amount: splitApprovalOrder.paidAmount - 900, approvalId: fullApprovalId },
});
assert.equal(afterSplitFullRefund.orders.find((order) => order.id === splitApprovalOrder.id)?.status, "已退款", "D1 approved cumulative refund should finish the order");
assert.equal(
  afterSplitFullRefund.customers.find((customer) => customer.id === customerId)?.points,
  pointsAfterSplitCheckout - Math.floor(splitApprovalOrder.paidAmount / 10),
  "D1 cumulative final refund should atomically persist the one-time points reversal",
);
const splitRefundCommissions = afterSplitFullRefund.commissions.filter((commission) => commission.orderId === splitApprovalOrder.id);
const splitNegativeCommissions = splitRefundCommissions.filter((commission) => commission.id.startsWith("cmr_"));
assert.deepEqual(
  splitRefundCommissions.filter((commission) => splitOriginalCommissions.some((original) => original.id === commission.id)).sort((left, right) => left.id.localeCompare(right.id)),
  [...splitOriginalCommissions].sort((left, right) => left.id.localeCompare(right.id)),
  "D1 cumulative refund should never rewrite original commission records",
);
assert.equal(
  splitNegativeCommissions.reduce((sum, commission) => sum + commission.amount, 0),
  -splitOriginalCommissions.reduce((sum, commission) => sum + commission.amount, 0),
  "D1 split refunds should reverse commission exactly without cumulative over-refund",
);
assert.equal(new Set(splitNegativeCommissions.map((commission) => commission.id)).size, splitNegativeCommissions.length, "D1 refund adjustment ids should remain unique");
const persistedSplitRefund = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.deepEqual(
  persistedSplitRefund.commissions.filter((commission) => commission.orderId === splitApprovalOrder.id).sort((left, right) => left.id.localeCompare(right.id)),
  [...splitRefundCommissions].sort((left, right) => left.id.localeCompare(right.id)),
  "D1 refund and negative commission adjustments should persist atomically",
);
const afterNoDeductionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-no-deduction-checkout-${runId}`,
    customerId: secondCustomerId,
    staffId: therapistStaffId,
    serviceId: noDeductionServiceId,
    payMethod: "微信",
  },
});
assert.equal(afterNoDeductionCheckout.orders[0].status, "已支付", "D1 should allow no-deduction service checkout at zero stock");
assert.deepEqual(afterNoDeductionCheckout.orders[0].serviceConsumables, [], "D1 checkout should snapshot an empty service deduction list");

const afterConcurrentProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `并发库存验证 ${runId}`, type: "sale", category: "面护类", subcategory: "面膜", unit: "盒", price: 20, cost: 10, stock: 1, warningStock: 1, serviceStockDeductible: false },
});
const concurrentProductId = afterConcurrentProduct.products[0].id;
const concurrentResults = await Promise.allSettled([
  request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: { checkoutRequestId: `concurrent-a-${runId}`, customerId, staffId: therapistStaffId, serviceId: noDeductionServiceId, productItems: [{ productId: concurrentProductId, quantity: 1 }], payMethod: "微信" },
  }),
  request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: { checkoutRequestId: `concurrent-b-${runId}`, customerId: secondCustomerId, staffId: therapistStaffId, serviceId: noDeductionServiceId, productItems: [{ productId: concurrentProductId, quantity: 1 }], payMethod: "微信" },
  }),
]);
assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1, "D1 store mutation lock should allow only one simultaneous sale of the last stock unit");
const afterConcurrentCheckout = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.equal(afterConcurrentCheckout.products.find((product) => product.id === concurrentProductId)?.stock, 0, "concurrent checkout must never make stock negative");
assert.equal(afterConcurrentCheckout.orders.filter((order) => order.productItems?.some((item) => item.productId === concurrentProductId)).length, 1, "concurrent checkout must persist only one order for the last stock unit");

const superadminSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
  method: "POST",
  body: { account: "admin@yich.local", password: "admin123456" },
});
assert.equal(superadminSession.user.roleName, "系统管理员", "D1 seed should expose the platform superadmin for lock verification");
const afterSuperadminLockCustomerA = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `系统管理员并发客户甲 ${runId}`, phone: "13600009001" },
});
const superadminLockCustomerAId = afterSuperadminLockCustomerA.customers[0].id;
const afterSuperadminLockCustomerB = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `系统管理员并发客户乙 ${runId}`, phone: "13600009002" },
});
const superadminLockCustomerBId = afterSuperadminLockCustomerB.customers[0].id;
const afterSuperadminLockProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: {
    name: `系统管理员并发库存验证 ${runId}`,
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
    token: superadminSession.token,
    body: {
      checkoutRequestId: `cf-superadmin-last-stock-a-${runId}`,
      customerId: superadminLockCustomerAId,
      staffId: therapistStaffId,
      productItems: [{ productId: superadminLockProductId, quantity: 1 }],
      payMethod: "微信",
    },
  }),
  request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: superadminSession.token,
    body: {
      checkoutRequestId: `cf-superadmin-last-stock-b-${runId}`,
      customerId: superadminLockCustomerBId,
      staffId: therapistStaffId,
      productItems: [{ productId: superadminLockProductId, quantity: 1 }],
      payMethod: "微信",
    },
  }),
]);
assert.equal(
  superadminConcurrentCheckoutResults.filter((result) => result.status === "fulfilled").length,
  1,
  "D1 superadmin checkouts must share the resolved target-store lock",
);
const rejectedSuperadminCheckout = superadminConcurrentCheckoutResults.find((result) => result.status === "rejected");
assert.match(
  rejectedSuperadminCheckout?.status === "rejected" ? String(rejectedSuperadminCheckout.reason) : "",
  /库存不足|当前仅剩/,
  "D1 second superadmin checkout must observe the committed inventory deduction",
);
const afterSuperadminConcurrentCheckout = await request<AppData>(baseUrl, "/api/data", { token: superadminSession.token });
assert.equal(
  afterSuperadminConcurrentCheckout.products.find((product) => product.id === superadminLockProductId)?.stock,
  0,
  "D1 superadmin concurrency must never make stock negative",
);
assert.equal(
  afterSuperadminConcurrentCheckout.orders.filter((order) =>
    order.productItems?.some((item) => item.productId === superadminLockProductId),
  ).length,
  1,
  "D1 superadmin concurrency must persist exactly one order for the last stock unit",
);
await assert.rejects(
  () => request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: superadminSession.token,
    body: {
      checkoutRequestId: `cf-superadmin-mixed-store-${runId}`,
      customerId,
      staffId: otherStoreStaffId,
      productItems: [{ productId: superadminLockProductId, quantity: 1 }],
      payMethod: "微信",
    },
  }),
  /混合多个门店/,
  "D1 superadmin business mutations must reject cross-store targets instead of bypassing the store lock",
);
const afterOtherStoreCommissionStaff = await request<AppData>(baseUrl, "/api/staff", {
  method: "POST",
  token: otherStoreOwner.token,
  body: {
    name: `隔离店提成员工 ${runId}`,
    phone: "13700009001",
    role: "员工",
    baseSalary: 0,
    commissionRate: 0.1,
  },
});
const otherStoreCommissionStaffId = afterOtherStoreCommissionStaff.staff[0].id;
const afterOtherStoreCommissionCustomer = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: otherStoreOwner.token,
  body: { name: `隔离店提成客户 ${runId}`, phone: "13700009002" },
});
const otherStoreCommissionCustomerId = afterOtherStoreCommissionCustomer.customers[0].id;
const afterOtherStoreCommissionProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: otherStoreOwner.token,
  body: {
    name: `隔离店提成商品 ${runId}`,
    type: "sale",
    category: "面护类",
    subcategory: "面膜",
    unit: "盒",
    price: 30,
    cost: 10,
    stock: 1,
    warningStock: 1,
    serviceStockDeductible: false,
  },
});
const otherStoreCommissionProductId = afterOtherStoreCommissionProduct.products[0].id;
const afterOtherStoreCommissionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: otherStoreOwner.token,
  body: {
    checkoutRequestId: `cf-other-store-commission-${runId}`,
    customerId: otherStoreCommissionCustomerId,
    staffId: otherStoreCommissionStaffId,
    productItems: [{ productId: otherStoreCommissionProductId, quantity: 1 }],
    payMethod: "微信",
  },
});
const otherStorePendingCommissionId = afterOtherStoreCommissionCheckout.commissions.find((commission) =>
  commission.orderId === afterOtherStoreCommissionCheckout.orders[0].id,
)?.id;
assert.ok(otherStorePendingCommissionId, "D1 second store checkout should create a pending commission for all-store settlement verification");
const superadminSettlementConcurrency = await Promise.allSettled([
  request<AppData>(baseUrl, "/api/commissions/settle", {
    method: "POST",
    token: superadminSession.token,
  }),
  request<AppData>(baseUrl, "/api/inventory/adjust", {
    method: "POST",
    token: ownerSession.token,
    body: { productId: superadminLockProductId, type: "入库", quantity: 1 },
  }),
]);
assert.equal(
  superadminSettlementConcurrency.filter((result) => result.status === "fulfilled").length,
  2,
  "D1 superadmin all-store settlement must serialize with ordinary store writes without rejecting either operation",
);
const afterSuperadminSettlement = await request<AppData>(baseUrl, "/api/data", { token: superadminSession.token });
assert.equal(
  afterSuperadminSettlement.products.find((product) => product.id === superadminLockProductId)?.stock,
  1,
  "D1 ordinary store inventory writes must survive a concurrent superadmin all-store settlement",
);
assert.equal(
  afterSuperadminSettlement.commissions.find((commission) => commission.id === otherStorePendingCommissionId)?.status,
  "已结算",
  "D1 superadmin settlement must preserve its historical all-store contract while locking every store",
);
const afterReorderedServiceCustomer = await request<AppData>(baseUrl, "/api/customers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `多项目防重复客户 ${runId}`, phone: "13600009003" },
});
const reorderedServiceCustomerId = afterReorderedServiceCustomer.customers[0].id;
const afterReorderedServiceProduct = await request<AppData>(baseUrl, "/api/products", {
  method: "POST",
  token: ownerSession.token,
  body: {
    name: `多项目防重复库存 ${runId}`,
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
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-service-order-a-${runId}`,
    customerId: reorderedServiceCustomerId,
    staffId: therapistStaffId,
    serviceIds: [serviceId, noDeductionServiceId],
    productItems: [{ productId: reorderedServiceProductId, quantity: 1 }],
    payMethod: "微信",
  },
});
await assert.rejects(
  () => request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: ownerSession.token,
    body: {
      checkoutRequestId: `cf-service-order-b-${runId}`,
      customerId: reorderedServiceCustomerId,
      staffId: therapistStaffId,
      serviceIds: [noDeductionServiceId, serviceId],
      productItems: [{ productId: reorderedServiceProductId, quantity: 1 }],
      payMethod: "微信",
    },
  }),
  /重复提交/,
  "D1 API should treat reordered service ids as the same recent checkout",
);
const afterReorderedServiceRetry = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.equal(afterReorderedServiceRetry.products.find((product) => product.id === reorderedServiceProductId)?.stock, 1, "D1 reordered service retry must deduct retail stock only once");
assert.equal(
  afterReorderedServiceRetry.orders.filter((order) => order.productItems?.some((item) => item.productId === reorderedServiceProductId)).length,
  1,
  "D1 reordered service retry must persist only one order",
);
assert.equal(
  afterNoDeductionCheckout.products.find((product) => product.id === noDeductionProductId)?.stock,
  0,
  "D1 no-deduction service checkout should keep zero stock unchanged",
);
assert.equal(
  afterNoDeductionCheckout.inventoryLogs.filter((log) => log.productId === noDeductionProductId && log.type === "服务消耗").length,
  0,
  "D1 no-deduction service checkout should not create service inventory logs",
);
const persistedNoDeductionCheckout = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.deepEqual(
  persistedNoDeductionCheckout.orders.find((order) => order.id === afterNoDeductionCheckout.orders[0].id)?.serviceConsumables,
  [],
  "D1 read-back should preserve an empty service deduction snapshot",
);
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/checkout", {
      method: "POST",
      token: ownerSession.token,
      body: {
        checkoutRequestId: `cf-checkout-${runId}`,
        customerId: secondCustomerId,
        staffId: therapistStaffId,
        productItems: [{ productId, quantity: 1 }],
        payMethod: "微信",
      },
    }),
  /重复提交/,
  "D1 checkout should reject duplicate request ids even when order details differ",
);

const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${orderId}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 部分退款", amount: 100 },
});
assert.equal(afterPartialRefund.orders.find((item) => item.id === orderId)?.status, "部分退款", "partial refund should persist order status");

const openCardRequestId = `cf-open-card-${runId}`;
const afterOpenCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: { openCardRequestId, customerId, name: "Cloudflare 储值卡", balance: 500, remainingTimes: 0, paidAmount: 500, payMethod: "微信", expiresAt: "2027-12-31" },
}));
const cardId = afterOpenCard.memberCards[0].id;
assert.ok(afterOpenCard.memberCardTransactions[0].staffId, "D1 open card should persist current staff");
const repeatedOpenCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: { openCardRequestId, customerId, name: "不应重复创建", balance: 999, remainingTimes: 0, paidAmount: 999, payMethod: "现金", expiresAt: "2028-12-31" },
}));
assert.equal(repeatedOpenCard.memberCards[0].id, cardId, "D1 duplicate open card request id should return original result");
const afterOpenPackageCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: { openCardRequestId: `cf-open-package-${runId}`, customerId, name: "Cloudflare 套餐卡", type: "套餐卡", balance: 0, remainingTimes: 5, serviceIds: [serviceId], paidAmount: 1200, payMethod: "支付宝", expiresAt: "2027-12-31" },
}));
assert.equal(afterOpenPackageCard.memberCards[0].type, "套餐卡", "D1 should persist package card type");
assert.deepEqual(afterOpenPackageCard.memberCards[0].serviceIds, [serviceId], "D1 should persist package card services");
const afterOpenPerServiceCardA = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: {
    openCardRequestId: `cf-per-service-card-a-${runId}`,
    customerName: `Cloudflare 多项目分别选卡客户 ${runId}`,
    customerPhone: "13600000992",
    name: "Cloudflare 多项目第一张卡",
    type: "套餐卡",
    serviceEntitlements: [
      { serviceId, totalTimes: 4, remainingTimes: 4 },
      { serviceId: noDeductionServiceId, totalTimes: 4, remainingTimes: 4 },
    ],
    paidAmount: 1800,
    payMethod: "微信",
    expiresAt: "2027-12-31",
  },
}));
const perServiceCardA = afterOpenPerServiceCardA.memberCards[0];
const perServiceCardCustomerId = perServiceCardA.customerId;
const afterOpenPerServiceCardB = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: {
    openCardRequestId: `cf-per-service-card-b-${runId}`,
    customerId: perServiceCardCustomerId,
    name: "Cloudflare 多项目第二张卡",
    type: "套餐卡",
    serviceEntitlements: [
      { serviceId, totalTimes: 4, remainingTimes: 4 },
      { serviceId: noDeductionServiceId, totalTimes: 4, remainingTimes: 4 },
    ],
    paidAmount: 1800,
    payMethod: "微信",
    expiresAt: "2027-12-31",
  },
}));
const perServiceCardB = afterOpenPerServiceCardB.memberCards[0];
const perServiceCardCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-per-service-checkout-${runId}`,
    customerId: perServiceCardCustomerId,
    staffId: therapistStaffId,
    serviceIds: [serviceId, noDeductionServiceId],
    serviceCardSelections: [
      { serviceId, cardId: perServiceCardA.id },
      { serviceId: noDeductionServiceId, cardId: perServiceCardB.id },
    ],
    payMethod: "微信",
  },
});
assert.deepEqual(
  perServiceCardCheckout.orders[0].serviceCardSelections,
  [{ serviceId, cardId: perServiceCardA.id }, { serviceId: noDeductionServiceId, cardId: perServiceCardB.id }],
  "D1 checkout should persist one selected card per service",
);
const perServiceCardSignature = perServiceCardCheckout.customerSignatures.find(
  (signature) => signature.orderId === perServiceCardCheckout.orders[0].id,
);
assert.ok(perServiceCardSignature, "D1 per-service card checkout should create a signature");
const signedPerServiceCardCheckout = await request<AppData>(baseUrl, `/api/customer-signatures/${perServiceCardSignature!.id}/sign`, {
  method: "POST",
  token: ownerSession.token,
  body: { signerName: "Cloudflare 多项目分别选卡", signatureText: "data:image/png;base64,cf-per-service-card" },
});
assert.deepEqual(
  signedPerServiceCardCheckout.memberCards.find((card) => card.id === perServiceCardA.id)?.serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
  [[serviceId, 3], [noDeductionServiceId, 4]],
  "D1 signature should debit the first service only from its selected card",
);
assert.deepEqual(
  signedPerServiceCardCheckout.memberCards.find((card) => card.id === perServiceCardB.id)?.serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
  [[serviceId, 4], [noDeductionServiceId, 3]],
  "D1 signature should debit the second service only from its selected card",
);
const reloadedPerServiceCardData = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.deepEqual(
  reloadedPerServiceCardData.orders.find((order) => order.id === perServiceCardCheckout.orders[0].id)?.serviceCardSelections,
  perServiceCardCheckout.orders[0].serviceCardSelections,
  "D1 order card selections should survive a database reload",
);
const racePackageCardId = afterOpenPackageCard.memberCards[0].id;
const racePackageCardTimesBefore = afterOpenPackageCard.memberCards[0].remainingTimes;
const raceRoomName = `签名并发房 ${runId}`;
await request<AppData>(baseUrl, "/api/store-profile", {
  method: "PATCH",
  token: ownerSession.token,
  body: {
    name: initialData.storeProfiles[0]?.name ?? `Cloudflare 正式验证门店 ${runId}`,
    phone: initialData.storeProfiles[0]?.phone ?? "13900000000",
    address: initialData.storeProfiles[0]?.address ?? "Cloudflare 地址",
    businessHours: initialData.storeProfiles[0]?.businessHours ?? "10:00 - 21:00",
    roomNames: [roomName, raceRoomName],
    maintenanceRoomNames: [],
  },
});
const signatureRaceStaffId = therapistStaffId;
const signatureRefundRaceAppointmentData = await request<AppData>(baseUrl, "/api/appointments", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId,
    staffId: signatureRaceStaffId,
    serviceId,
    startAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    roomName: raceRoomName,
    note: "D1 公开签名与退款并发原子性",
  },
});
const signatureRefundRaceAppointmentId = signatureRefundRaceAppointmentData.appointments[0].id;
await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(signatureRefundRaceAppointmentId)}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "已到店" },
});
const signatureRefundRaceCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    checkoutRequestId: `cf-signature-refund-race-${runId}`,
    customerId,
    staffId: signatureRaceStaffId,
    serviceId,
    appointmentId: signatureRefundRaceAppointmentId,
    cardId: racePackageCardId,
    payMethod: "会员卡",
  },
});
const signatureRefundRaceOrder = signatureRefundRaceCheckout.orders[0];
const signatureRefundRaceSignature = signatureRefundRaceCheckout.customerSignatures.find((signature) =>
  signature.orderId === signatureRefundRaceOrder.id,
);
assert.ok(signatureRefundRaceSignature, "D1 checkout should create a pending signature for the signature/refund race");
assert.equal(
  signatureRefundRaceCheckout.memberCards.find((card) => card.id === racePackageCardId)?.remainingTimes,
  racePackageCardTimesBefore - 1,
  "D1 race checkout should debit the package card once",
);
const signatureRefundRaceResults = await Promise.allSettled([
  request<{ signature: { status: string } }>(
    baseUrl,
    `/api/public/customer-signatures/${encodeURIComponent(signatureRefundRaceSignature.token)}/sign`,
    {
      method: "POST",
      body: { signerName: "D1 并发签名客户", signatureText: "data:image/png;base64,cf-signature-refund-race" },
    },
  ),
  request<AppData>(baseUrl, `/api/orders/${encodeURIComponent(signatureRefundRaceOrder.id)}/refund`, {
    method: "POST",
    token: ownerSession.token,
    body: { reason: "D1 签名并发全额退款" },
  }),
]);
assert.ok(signatureRefundRaceResults.some((result) => result.status === "fulfilled"), "D1 signature/refund race must complete one serialized outcome");
const afterSignatureRefundRace = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
const finalRaceOrder = afterSignatureRefundRace.orders.find((order) => order.id === signatureRefundRaceOrder.id);
const finalRaceSignature = afterSignatureRefundRace.customerSignatures.find((signature) => signature.id === signatureRefundRaceSignature.id);
const finalRaceCard = afterSignatureRefundRace.memberCards.find((card) => card.id === racePackageCardId);
const finalRaceAppointment = afterSignatureRefundRace.appointments.find((appointment) => appointment.id === signatureRefundRaceAppointmentId);
const finalRaceRefunds = afterSignatureRefundRace.refunds.filter((refund) => refund.orderId === signatureRefundRaceOrder.id);
const signedOutcome = finalRaceOrder?.status === "已支付"
  && finalRaceSignature?.status === "已签名"
  && finalRaceCard?.remainingTimes === racePackageCardTimesBefore - 1
  && finalRaceAppointment?.status === "已完成"
  && finalRaceRefunds.length === 0;
const refundedOutcome = finalRaceOrder?.status === "已退款"
  && finalRaceSignature?.status === "已作废"
  && finalRaceCard?.remainingTimes === racePackageCardTimesBefore
  && finalRaceAppointment?.status === "已到店"
  && finalRaceRefunds.length === 1;
assert.ok(signedOutcome !== refundedOutcome && (signedOutcome || refundedOutcome), "D1 signature/refund concurrency must finish in exactly one coherent paid-or-refunded state");
if (refundedOutcome) {
  assert.equal(finalRaceSignature?.status, "已作废", "D1 refunded signature must never revive after the refund commits");
  assert.equal(
    afterSignatureRefundRace.memberCardTransactions.filter((transaction) => transaction.orderId === signatureRefundRaceOrder.id && transaction.type === "退款").length,
    1,
    "D1 signature/refund concurrency must restore the package card exactly once",
  );
}
const afterOpenVoidCard = memberCardPatchData(await request<AppDataPatch>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: {
    openCardRequestId: `cf-open-void-${runId}`,
    customerId,
    name: "Cloudflare 错录套餐卡",
    type: "套餐卡",
    serviceEntitlements: [{ serviceId, totalTimes: 4, remainingTimes: 4 }],
    paidAmount: 800,
    payMethod: "微信",
    expiresAt: "2027-12-31",
  },
}));
const voidCardId = afterOpenVoidCard.memberCards[0].id;
const posDayStart = new Date();
posDayStart.setHours(0, 0, 0, 0);
const posDayEnd = new Date(posDayStart);
posDayEnd.setHours(24, 0, 0, 0);
const afterOpenVoidPosContext = await request<{ todayPaid: number }>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: ownerSession.token });
await assert.rejects(
  () => request<AppData>(baseUrl, `/api/member-cards/${voidCardId}/void`, {
    method: "POST",
    token: frontdeskSession.token,
    body: { reason: "前台尝试作废", confirm: "确认作废" },
  }),
  /只有门店老板或店长/,
  "D1 frontdesk should not void a member card opening",
);
const afterVoidCard = await request<AppData>(baseUrl, `/api/member-cards/${voidCardId}/void`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 重复开卡", confirm: "确认作废" },
});
assert.equal(afterVoidCard.memberCards.find((item) => item.id === voidCardId)?.status, "已作废", "D1 should persist voided card status");
assert.ok(afterVoidCard.memberCards.find((item) => item.id === voidCardId)?.serviceEntitlements?.every((item) => item.remainingTimes === 0), "D1 should clear voided entitlements");
assert.equal(afterVoidCard.memberCardTransactions[0].type, "作废", "D1 should persist void reversal transaction");
const afterVoidPosContext = await request<{ todayPaid: number }>(baseUrl, `/api/pos/context?dayStart=${encodeURIComponent(posDayStart.toISOString())}&dayEnd=${encodeURIComponent(posDayEnd.toISOString())}`, { token: ownerSession.token });
assert.equal(afterVoidPosContext.todayPaid, afterOpenVoidPosContext.todayPaid - 800, "D1 POS context should subtract voided opening cash from today's paid total");
const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/recharge`, {
  method: "POST",
  token: ownerSession.token,
  body: { amount: 100, paidAmount: 100, payMethod: "微信", note: "Cloudflare 充值" },
});
assert.equal(afterRecharge.memberCards.find((item) => item.id === cardId)?.balance, 600, "D1 should persist recharge");
const afterFreeze = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/status`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { status: "冻结", reason: "Cloudflare 冻结" },
});
assert.equal(afterFreeze.memberCards.find((item) => item.id === cardId)?.status, "冻结", "D1 should persist card status");
const afterExtend = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/extend`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { expiresAt: "2028-12-31", reason: "Cloudflare 延期" },
});
assert.equal(afterExtend.memberCards.find((item) => item.id === cardId)?.expiresAt, "2028-12-31", "D1 should persist card extension");
const afterTransfer = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/transfer`, {
  method: "POST",
  token: ownerSession.token,
  body: { toCustomerId: secondCustomerId, reason: "Cloudflare 转卡" },
});
assert.equal(afterTransfer.memberCards.find((item) => item.id === cardId)?.customerId, secondCustomerId, "D1 should persist card transfer");
const refundSignatureData = await request<AppData>(baseUrl, "/api/customer-signatures", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId: secondCustomerId,
    title: "会员卡退费确认签名",
    content: "本人确认办理Cloudflare 储值卡退费，实退金额¥100，退款方式银行卡，退费后会员卡关闭。",
    validDays: 1,
  },
});
const refundSignature = refundSignatureData.customerSignatures[0];
await request<AppData>(baseUrl, `/api/customer-signatures/${refundSignature.id}/sign`, {
  method: "POST",
  token: ownerSession.token,
  body: { signerName: `验证转卡客户 ${runId}`, signatureText: "data:image/png;base64,cf-refund" },
});
const afterCardRefund = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 退卡", refundAmount: 100, payMethod: "银行卡", signatureId: refundSignature.id },
});
assert.equal(afterCardRefund.memberCards.find((item) => item.id === cardId)?.status, "已退卡", "D1 should close refunded card");
assert.equal(afterCardRefund.memberCardTransactions[0].paidAmount, 100, "D1 should persist member card actual refund amount");
assert.equal(afterCardRefund.memberCardTransactions[0].payMethod, "银行卡", "D1 should persist member card refund method");

const afterServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId,
    staffId: therapistStaffId,
    serviceId,
    orderId,
    skinCondition: "敏感偏干",
    beforeNote: "Cloudflare 服务前",
    careSteps: "Cloudflare 清洁、导入、修护",
    productsUsed: "Cloudflare 清洁精华液",
    afterNote: "Cloudflare 服务后",
    customerFeedback: "Cloudflare 体验舒适",
    nextCareAdvice: "Cloudflare 加强保湿防晒",
    nextFollowUpAt: `${futureDay(22)}T10:00:00.000Z`,
  },
});
assert.equal(afterServiceRecord.customerServiceRecords[0].staffId, therapistStaffId, "D1 should persist service record");
assert.equal(afterServiceRecord.customerServiceRecords[0].orderId, orderId, "D1 should persist service record order link");
assert.equal(afterServiceRecord.customerServiceRecords[0].careSteps, "Cloudflare 清洁、导入、修护", "D1 should persist service record care steps");
assert.equal(afterServiceRecord.customerServiceRecords[0].productsUsed, "Cloudflare 清洁精华液", "D1 should persist service record products used");
assert.equal(afterServiceRecord.customerServiceRecords[0].customerFeedback, "Cloudflare 体验舒适", "D1 should persist service record feedback");
assert.equal(afterServiceRecord.customerServiceRecords[0].nextCareAdvice, "Cloudflare 加强保湿防晒", "D1 should persist service record next advice");
assert.match(afterServiceRecord.customerFollowUps[0].note, /Cloudflare 加强保湿防晒/, "D1 service record follow-up should use next care advice");
const afterSignature = await request<AppData>(baseUrl, "/api/customer-signatures", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId,
    serviceRecordId: afterServiceRecord.customerServiceRecords[0].id,
    orderId,
    title: "Cloudflare 客户确认",
    content: "Cloudflare 确认内容",
    validDays: 3,
  },
});
assert.equal(afterSignature.customerSignatures[0].status, "待签名", "D1 should create customer signature");
const publicSignature = await request<{ signature: { status: string }; customer: { phone: string } }>(baseUrl, `/api/public/customer-signatures/${afterSignature.customerSignatures[0].token}`);
assert.equal(publicSignature.signature.status, "待签名", "D1 public signature should be readable");
assert.match(publicSignature.customer.phone, /\*\*\*\*/, "D1 public signature should mask phone");
const signedSignature = await request<{ signature: { status: string; signerName: string } }>(baseUrl, `/api/public/customer-signatures/${afterSignature.customerSignatures[0].token}/sign`, {
  method: "POST",
  body: { signerName: "验证客户", signatureText: "验证客户确认" },
});
assert.equal(signedSignature.signature.status, "已签名", "D1 public signature should be signable");
assert.equal(signedSignature.signature.signerName, "验证客户", "D1 public signature should persist signer");
const afterFollowUpDone = await request<AppData>(baseUrl, `/api/follow-ups/${afterServiceRecord.customerFollowUps[0].id}`, {
  method: "PATCH",
  token: ownerSession.token,
});
assert.equal(afterFollowUpDone.customerFollowUps[0].status, "已完成", "D1 should complete follow-up");

const afterSupplier = await request<AppData>(baseUrl, "/api/suppliers", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `Cloudflare 供应商 ${runId}`, phone: "13800000000", contact: "王经理" },
});
const supplierId = afterSupplier.suppliers[0].id;
const afterPurchase = await request<AppData>(baseUrl, "/api/purchase-orders", {
  method: "POST",
  token: ownerSession.token,
  body: { supplierId, productId, quantity: 3, unitCost: 60, expiryAt: futureDay(240) },
});
assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "D1 should persist purchase inbound log");
assert.equal(afterPurchase.inventoryLogs[0].expiryAt, futureDay(240), "D1 should persist purchase inbound expiry");
const afterStocktake = await request<AppData>(baseUrl, "/api/stocktakes", {
  method: "POST",
  token: ownerSession.token,
  body: { productId, actualStock: 20, reason: "Cloudflare 盘点" },
});
assert.equal(afterStocktake.stocktakes[0].actualStock, 20, "D1 should persist stocktake");

const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
  method: "POST",
  token: ownerSession.token,
  body: { businessDate: closeBusinessDate },
});
assert.equal(afterDailyClose.dailyCloses[0].status, "已锁定", "daily close should persist in D1");
const afterReverseClose = await request<AppData>(baseUrl, "/api/daily-close/reverse", {
  method: "POST",
  token: ownerSession.token,
  body: { businessDate: closeBusinessDate },
});
assert.equal(afterReverseClose.dailyCloses[0].status, "已反结", "reverse close should persist in D1");

const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
assert.ok(therapistData.customers.some((item) => item.id === secondCustomerId), "therapist should see same-store customers without own service history");
assert.ok(therapistData.orders.every((item) => item.staffId === therapistStaffId), "therapist should only see own orders");
assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");
await request<{ ok: boolean }>(baseUrl, "/api/auth/logout", { method: "POST", token: therapistSession.token });
await assert.rejects(
  () => request<AppData>(baseUrl, "/api/data", { token: therapistSession.token }),
  /请先登录/,
  "D1 logout should revoke the bearer token immediately",
);

console.log(`Cloudflare Workers + D1 API 验证通过：正式注册、邀请、权限、业务链路与无重置接口边界已覆盖 ${baseUrl}`);

function memberCardPatchData(patch: AppDataPatch): AppData {
  return {
    ...emptyAppData(),
    ...patch.upserts,
  };
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
  const text = await response.text();
  const data = text ? parseJson<T | { error: string }>(text) : undefined;
  if (!response.ok) {
    throw new Error(formatVerifyError(isErrorPayload(data) ? data.error : `HTTP ${response.status}`));
  }
  if (data === undefined) {
    throw new Error("服务暂时不可用");
  }
  return data as T;
}

async function requestIfAvailable(baseUrl: string, path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  try {
    return await request<AppData>(baseUrl, path, options);
  } catch {
    return undefined;
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("服务返回异常");
  }
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string";
}

function formatVerifyError(message: string) {
  if (/D1_ERROR:.*no such table|no such table:/i.test(message)) {
    const migrateCommand = isLocalTarget ? "npm run d1:migrate:local" : "npm run d1:migrate:remote";
    return [
      "Cloudflare D1 表结构未迁移到当前版本，验证已停止。",
      `原始错误：${message}`,
      `请先运行：${migrateCommand}`,
      "迁移完成后重新启动 wrangler pages dev，再运行 npm run verify:cloudflare-api。",
    ].join("\n");
  }
  return message;
}

function assertCloudflareSchemaReady(health: { schema?: { ok: boolean; missingTables?: string[] } }) {
  if (!health.schema || health.schema.ok) return;
  const missingTables = health.schema.missingTables ?? [];
  const migrateCommand = isLocalTarget ? "npm run d1:migrate:local" : "npm run d1:migrate:remote";
  throw new Error([
    "Cloudflare D1 表结构未迁移到当前版本，已停止验证，避免写入半旧结构。",
    `缺失表：${missingTables.length ? missingTables.join(", ") : "未知"}`,
    `请先运行：${migrateCommand}`,
    "迁移完成后重新启动 wrangler pages dev，再运行 npm run verify:cloudflare-api。",
  ].join("\n"));
}

function isLocalApiTarget(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function futureDay(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
