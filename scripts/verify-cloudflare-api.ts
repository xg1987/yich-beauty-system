import assert from "node:assert/strict";
import type { AppData } from "../src/domain/types";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8788";
const allowPersistentWrite = process.env.ALLOW_PERSISTENT_CLOUDFLARE_VERIFY === "1";
const isRemotePagesTarget = /^https:\/\/.+\.pages\.dev\/?$/.test(baseUrl);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const today = new Date().toISOString().slice(0, 10);

if (isRemotePagesTarget && !allowPersistentWrite) {
  throw new Error("线上验证会写入正式 D1 数据。请改用本地 wrangler pages dev，或明确设置 ALLOW_PERSISTENT_CLOUDFLARE_VERIFY=1。");
}

const health = await request<{ ok: boolean; runtime?: string }>(baseUrl, "/api/health");
assert.equal(health.ok, true, "health check should pass");
assert.equal(health.runtime, "cloudflare-d1", "Cloudflare API should report D1 runtime");

await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

const ownerSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/register-store", {
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
  body: { businessDate: today },
});

const initialData = await request<AppData>(baseUrl, "/api/data", { token: ownerSession.token });
assert.ok(initialData.authUsers.every((user) => user.password === ""), "D1 API should not expose passwords");

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
  body: { name: `验证零售商品 ${runId}`, type: "sale", unit: "盒", price: 199, cost: 92, stock: 24, warningStock: 8 },
});
const productId = afterProduct.products[0].id;

const afterService = await request<AppData>(baseUrl, "/api/services", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证护理项目 ${runId}`, category: "皮肤管理", price: 398, duration: 60 },
});
const serviceId = afterService.services[0].id;

const afterServiceRecipe = await request<AppData>(baseUrl, `/api/services/${serviceId}/consumables`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { consumables: [{ productId: "p1", quantity: 1 }] },
});
assert.deepEqual(afterServiceRecipe.services[0].consumables, [{ productId: "p1", quantity: 1 }], "D1 should persist service consumable recipe");

const afterTherapistStaff = await request<AppData>(baseUrl, "/api/staff", {
  method: "POST",
  token: ownerSession.token,
  body: { name: `验证美容师 ${runId}`, phone: "13900000001", role: "美容师", baseSalary: 6000, commissionRate: 0.1 },
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
    description: "Cloudflare 共享店铺验证",
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
    preferredAt: `${futureDay(22)}T02:00:00.000Z`,
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
const therapistSession = await request<{ token: string; user: { account: string } }>(baseUrl, "/api/auth/join-invite", {
  method: "POST",
  body: { inviteCode: afterTherapistInvite.staffInvites[0].inviteCode, name: `验证美容师 ${runId}`, password: "secret" },
});
assert.equal(therapistSession.user.account, `cf-therapist-${runId}@test.local`, "D1 should join therapist invite");

const afterFrontdeskInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
  method: "POST",
  token: ownerSession.token,
  body: { staffId: frontdeskStaffId, account: `cf-frontdesk-${runId}@test.local`, role: "frontdesk", validDays: 7 },
});
const frontdeskSession = await request<{ token: string }>(baseUrl, "/api/auth/join-invite", {
  method: "POST",
  body: { inviteCode: afterFrontdeskInvite.staffInvites[0].inviteCode, name: `验证前台 ${runId}`, password: "secret" },
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
await assert.rejects(
  () =>
    request<AppData>(baseUrl, "/api/inventory/adjust", {
      method: "POST",
      token: frontdeskSession.token,
      body: { productId, type: "入库", quantity: 1 },
    }),
  /无权/,
  "frontdesk should not adjust inventory",
);

const unavailableDay = futureDay(20);
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
        note: "不可预约冲突",
      },
    }),
  /不可预约/,
  "Cloudflare appointment API should reject unavailable staff slots",
);

const shiftDay = futureDay(21);
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
      body: { customerId, staffId: therapistStaffId, serviceId, startAt: `${shiftDay}T05:00:00.000Z`, note: "班次外预约" },
    }),
  /不在员工班次内/,
  "Cloudflare appointment API should reject time outside shift",
);

const afterAppointment = await request<AppData>(baseUrl, "/api/appointments", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, staffId: therapistStaffId, serviceId, startAt: `${shiftDay}T02:00:00.000Z`, note: "Cloudflare 正常预约" },
});
assert.equal(afterAppointment.appointments[0].staffId, therapistStaffId, "D1 should create appointment inside shift");

const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "Cloudflare 活动价" },
});
const discountApprovalId = afterApprovalRequest.approvalRequests[0].id;
const afterApprovalDecision = await request<AppData>(baseUrl, `/api/approvals/${discountApprovalId}`, {
  method: "PATCH",
  token: ownerSession.token,
  body: { approved: true },
});
assert.equal(afterApprovalDecision.approvalRequests[0].status, "已通过", "D1 should approve requests");

const afterCouponTemplate = await request<AppData>(baseUrl, "/api/coupon-templates", {
  method: "POST",
  token: ownerSession.token,
  body: { name: "Cloudflare 新客券", amount: 50, minSpend: 300, serviceId, validDays: 20 },
});
const afterIssueCoupon = await request<AppData>(baseUrl, "/api/customer-coupons", {
  method: "POST",
  token: ownerSession.token,
  body: { templateId: afterCouponTemplate.couponTemplates[0].id, customerId },
});
const cloudflareCouponId = afterIssueCoupon.customerCoupons[0].id;
const afterCouponCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, staffId: therapistStaffId, serviceId, payMethod: "微信", couponId: cloudflareCouponId },
});
assert.equal(afterCouponCheckout.orders[0].paidAmount, 348, "D1 should persist coupon checkout discount");
assert.equal(afterCouponCheckout.customerCoupons.find((item) => item.id === cloudflareCouponId)?.status, "已使用", "D1 should mark coupon used");

const afterMarketingActivity = await request<AppData>(baseUrl, "/api/marketing-activities", {
  method: "POST",
  token: ownerSession.token,
  body: {
    name: "Cloudflare 小气泡秒杀",
    type: "秒杀",
    serviceId,
    activityPrice: 298,
    quota: 10,
    startsAt: `${today}T00:00:00.000Z`,
    endsAt: `${futureDay(2)}T00:00:00.000Z`,
  },
});
const cloudflareActivityId = afterMarketingActivity.marketingActivities[0].id;
const afterActivityCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, staffId: therapistStaffId, serviceId, payMethod: "微信", activityId: cloudflareActivityId },
});
assert.equal(afterActivityCheckout.orders[0].paidAmount, 298, "D1 should persist activity checkout price");
assert.equal(afterActivityCheckout.marketingActivities.find((item) => item.id === cloudflareActivityId)?.soldCount, 1, "D1 should consume activity quota");

const afterDistributor = await request<AppData>(baseUrl, "/api/distributors", {
  method: "POST",
  token: ownerSession.token,
  body: { type: "客户", customerId, rate: 0.07 },
});
const distributorId = afterDistributor.distributors[0].id;
assert.equal(afterDistributor.distributors[0].status, "启用", "D1 should create active distributor");
const afterReferral = await request<AppData>(baseUrl, "/api/referral-relations", {
  method: "POST",
  token: ownerSession.token,
  body: { distributorId, customerId: secondCustomerId },
});
assert.equal(afterReferral.referralRelations[0].customerId, secondCustomerId, "D1 should bind referral relation");
const afterDistributionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId: secondCustomerId, staffId: therapistStaffId, serviceId, payMethod: "微信" },
});
assert.equal(afterDistributionCheckout.orders[0].distributorId, distributorId, "D1 checkout should apply referral distributor");
assert.equal(afterDistributionCheckout.distributionCommissions[0].amount, 28, "D1 should create distribution commission");
const afterDistributionSettle = await request<AppData>(baseUrl, "/api/distribution-commissions/settle", {
  method: "POST",
  token: ownerSession.token,
});
assert.equal(afterDistributionSettle.distributionCommissions[0].status, "已结算", "D1 should settle distribution commission");
assert.equal(afterDistributionSettle.commissionSettlements[0].type, "分销佣金", "D1 should create distribution settlement batch");

const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
  method: "POST",
  token: ownerSession.token,
  body: {
    customerId,
    staffId: therapistStaffId,
    serviceId,
    productId,
    payMethod: "微信",
    discountAmount: 50,
    adjustmentReason: "Cloudflare 活动价",
    approvalId: discountApprovalId,
  },
});
const orderId = afterCheckout.orders[0].id;
assert.equal(afterCheckout.orders[0].paidAmount, 547, "approved checkout should persist in D1");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId), "checkout should create commission in D1");
assert.equal(afterCheckout.commissions.find((item) => item.orderId === orderId)?.rate, 0.1, "D1 should persist staff commission rate");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId && item.type === "服务提成"), "D1 should create service commission");
assert.ok(afterCheckout.commissions.some((item) => item.orderId === orderId && item.type === "销售提成"), "D1 should create sales commission");

const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${orderId}/refund`, {
  method: "POST",
  token: ownerSession.token,
  body: { reason: "Cloudflare 部分退款", amount: 100 },
});
assert.equal(afterPartialRefund.orders.find((item) => item.id === orderId)?.status, "部分退款", "partial refund should persist order status");

const afterOpenCard = await request<AppData>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, name: "Cloudflare 储值卡", balance: 500, remainingTimes: 0 },
});
const cardId = afterOpenCard.memberCards[0].id;
const afterOpenPackageCard = await request<AppData>(baseUrl, "/api/member-cards", {
  method: "POST",
  token: ownerSession.token,
  body: { customerId, name: "Cloudflare 套餐卡", type: "套餐卡", balance: 0, remainingTimes: 5, serviceIds: [serviceId] },
});
assert.equal(afterOpenPackageCard.memberCards[0].type, "套餐卡", "D1 should persist package card type");
assert.deepEqual(afterOpenPackageCard.memberCards[0].serviceIds, [serviceId], "D1 should persist package card services");
const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${cardId}/recharge`, {
  method: "POST",
  token: ownerSession.token,
  body: { amount: 100, note: "Cloudflare 充值" },
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
  body: { supplierId, productId, quantity: 3, unitCost: 60 },
});
assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "D1 should persist purchase inbound log");
const afterStocktake = await request<AppData>(baseUrl, "/api/stocktakes", {
  method: "POST",
  token: ownerSession.token,
  body: { productId, actualStock: 20, reason: "Cloudflare 盘点" },
});
assert.equal(afterStocktake.stocktakes[0].actualStock, 20, "D1 should persist stocktake");

const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
  method: "POST",
  token: ownerSession.token,
  body: { businessDate: today },
});
assert.equal(afterDailyClose.dailyCloses[0].status, "已锁定", "daily close should persist in D1");
const afterReverseClose = await request<AppData>(baseUrl, "/api/daily-close/reverse", {
  method: "POST",
  token: ownerSession.token,
  body: { businessDate: today },
});
assert.equal(afterReverseClose.dailyCloses[0].status, "已反结", "reverse close should persist in D1");

const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
assert.ok(therapistData.orders.every((item) => item.staffId === therapistStaffId), "therapist should only see own orders");
assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

console.log(`Cloudflare Workers + D1 API 验证通过：正式注册、邀请、权限、业务链路与无重置接口边界已覆盖 ${baseUrl}`);

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
    throw new Error(isErrorPayload(data) ? data.error : `HTTP ${response.status}`);
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

function futureDay(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
