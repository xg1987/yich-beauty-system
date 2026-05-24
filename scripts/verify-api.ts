import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApiServer } from "../server/api";
import { BeautyDatabase } from "../server/database";
import { testFixtureData } from "../src/domain/testFixture";
import type { AppData } from "../src/domain/types";

const tempDir = mkdtempSync(join(tmpdir(), "beauty-api-"));
const database = new BeautyDatabase(join(tempDir, "test.sqlite"));
database.replaceData(testFixtureData);
const server = createApiServer(database);

try {
  const baseUrl = await listen(server);

  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert.equal(health.ok, true, "health check should pass");

  await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

  const session = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "manager@test.local", password: "test-password" },
  });
  assert.equal(session.user.roleName, "店长", "login API should return role session");

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
  assert.ok(initialData.authUsers.every((user) => user.password === ""), "API data should not expose passwords");

  const publicStore = await request<{ storefront: { shareCode: string }; services: Array<{ id: string }> }>(baseUrl, "/api/public/store/yich-demo");
  assert.equal(publicStore.storefront.shareCode, "yich-demo", "public store API should expose enabled storefront");
  assert.ok(publicStore.services.some((service) => service.id === "v1"), "public store API should expose enabled services");

  await request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
    method: "POST",
    body: {
      shareCode: "yich-demo",
      customerName: "API 线上客户",
      phone: "13700000008",
      serviceId: "v1",
      preferredAt: "2026-05-30T02:00:00.000Z",
      note: "线上预约申请",
    },
  });
  const afterPublicRequest = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(afterPublicRequest.onlineBookingRequests[0].status, "待处理", "public booking request should be visible to manager");
  assert.equal(afterPublicRequest.notifications[0].targetType, "onlineBookingRequest", "public booking should create a notification");
  assert.equal(afterPublicRequest.notifications[0].view, "appointments", "public booking notification should route to appointments");
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
      description: "API 共享店铺",
      enabledServiceIds: ["v1", "v2"],
    },
  });
  assert.equal(afterOnlineStorefront.onlineStorefronts[0].shareCode, "api-online-store", "online storefront API should update share code");

  const afterServiceWithConsumable = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: { name: "API 耗材绑定护理", category: "皮肤管理", price: 398, duration: 60, consumableProductId: "p1", consumableQty: 2 },
  });
  assert.equal(afterServiceWithConsumable.services[0].consumableProductId, "p1", "service API should persist consumable product");
  assert.equal(afterServiceWithConsumable.services[0].consumableQty, 2, "service API should persist consumable quantity");
  const afterServiceRecipe = await request<AppData>(baseUrl, `/api/services/${afterServiceWithConsumable.services[0].id}/consumables`, {
    method: "PATCH",
    token: session.token,
    body: { consumables: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 0.5 }] },
  });
  assert.deepEqual(afterServiceRecipe.services[0].consumables, [
    { productId: "p1", quantity: 2 },
    { productId: "p2", quantity: 0.5 },
  ], "service recipe API should persist multiple consumables");

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
    body: { name: "API 新美容师", phone: "13900000001", role: "美容师", baseSalary: 6000, commissionRate: 0.1 },
  });
  const apiStaffId = afterStaff.staff[0].id;
  assert.equal(afterStaff.staff[0].name, "API 新美容师", "staff API should create staff");
  const afterStaffUpdate = await request<AppData>(baseUrl, `/api/staff/${apiStaffId}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "inactive", baseSalary: 6200 },
  });
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.status, "inactive", "staff API should disable staff");

  const afterInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
    method: "POST",
    token: session.token,
    body: { staffId: apiStaffId, account: "api-staff@test.local", role: "therapist", validDays: 3 },
  });
  assert.equal(afterInvite.staffInvites[0].status, "待加入", "staff invite API should create invite");
  assert.ok(afterInvite.staffInvites[0].expiresAt, "staff invite API should persist expiry");
  const joinedSession = await request<{ token: string; user: { account: string; roleName: string } }>(baseUrl, "/api/auth/join-invite", {
    method: "POST",
    body: { inviteCode: afterInvite.staffInvites[0].inviteCode, name: "API 新美容师", password: "secret" },
  });
  assert.equal(joinedSession.user.account, "api-staff@test.local", "join invite API should login invited staff");

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

  const afterCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "李女士", phone: "13600000004" },
  });
  assert.equal(afterCustomer.customers[0].name, "李女士", "customer API should create a customer");
  const afterCustomerTags = await request<AppData>(baseUrl, `/api/customers/${afterCustomer.customers[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { level: "VIP", source: "转介绍", tags: ["敏感肌", "高消费"] },
  });
  assert.equal(afterCustomerTags.customers[0].level, "VIP", "customer API should update member level");
  assert.deepEqual(afterCustomerTags.customers[0].tags, ["敏感肌", "高消费"], "customer API should update tags");
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
  const appointmentId = afterAppointment.appointments[0].id;
  assert.equal(afterAppointment.notifications[0].targetId, appointmentId, "appointment API should create a target notification");
  const afterNotificationRead = await request<AppData>(baseUrl, `/api/notifications/${afterAppointment.notifications[0].id}/read`, {
    method: "PATCH",
    token: session.token,
  });
  assert.ok(afterNotificationRead.notifications.find((item) => item.id === afterAppointment.notifications[0].id)?.readByUserIds.includes("u_manager"), "notification API should mark one item read");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: "已完成" },
      }),
    /不能从待确认改为已完成/,
    "appointment API should reject invalid status transitions",
  );
  const afterConfirm = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已确认" },
  });
  assert.equal(afterConfirm.appointments.find((item) => item.id === appointmentId)?.status, "已确认", "appointment API should confirm");
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
      startAt: "2026-05-25T05:00:00.000Z",
      note: "API 改约测试",
    },
  });
  const secondAppointmentId = afterSecondAppointment.appointments[0].id;
  const afterReschedule = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}/reschedule`, {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      serviceId: "v2",
      startAt: "2026-05-25T06:00:00.000Z",
      note: "API 已改约",
    },
  });
  assert.equal(afterReschedule.appointments[0].serviceId, "v2", "appointment API should reschedule service");
  assert.ok(afterReschedule.appointments[0].rescheduledAt, "appointment API should stamp reschedule time");
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
  assert.equal(afterCancel.appointments[0].cancelReason, "客户临时取消", "appointment API should keep cancel reason");

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

  const afterShift = await request<AppData>(baseUrl, "/api/staff-shifts", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: "2026-05-28T02:00:00.000Z",
      endAt: "2026-05-28T03:00:00.000Z",
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
          startAt: "2026-05-28T04:00:00.000Z",
          note: "班次外预约",
        },
      }),
    /不在员工班次内/,
    "appointment API should reject time outside shift",
  );

  const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
    method: "POST",
    token: session.token,
    body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "API 活动价" },
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

  const afterCouponTemplate = await request<AppData>(baseUrl, "/api/coupon-templates", {
    method: "POST",
    token: session.token,
    body: { name: "API 新客券", amount: 50, minSpend: 300, serviceId: "v1", validDays: 20 },
  });
  assert.equal(afterCouponTemplate.couponTemplates[0].name, "API 新客券", "coupon template API should create template");
  const afterIssueCoupon = await request<AppData>(baseUrl, "/api/customer-coupons", {
    method: "POST",
    token: session.token,
    body: { templateId: afterCouponTemplate.couponTemplates[0].id, customerId: "c2" },
  });
  const apiCouponId = afterIssueCoupon.customerCoupons[0].id;
  const afterCouponCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      couponId: apiCouponId,
    },
  });
  assert.equal(afterCouponCheckout.orders[0].paidAmount, 348, "coupon checkout should reduce paid amount");
  assert.equal(afterCouponCheckout.customerCoupons.find((item) => item.id === apiCouponId)?.status, "已使用", "coupon checkout should mark coupon used");

  const afterMarketingActivity = await request<AppData>(baseUrl, "/api/marketing-activities", {
    method: "POST",
    token: session.token,
    body: {
      name: "API 小气泡秒杀",
      type: "秒杀",
      serviceId: "v1",
      activityPrice: 298,
      quota: 10,
      startsAt: "2026-05-23T00:00:00.000Z",
      endsAt: "2026-05-25T00:00:00.000Z",
    },
  });
  const apiActivityId = afterMarketingActivity.marketingActivities[0].id;
  const afterActivityCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      activityId: apiActivityId,
    },
  });
  assert.equal(afterActivityCheckout.orders[0].paidAmount, 298, "activity checkout should apply activity price");
  assert.equal(afterActivityCheckout.marketingActivities.find((item) => item.id === apiActivityId)?.soldCount, 1, "activity checkout should consume quota");
  assert.equal(afterActivityCheckout.activityParticipants[0].status, "已核销", "activity checkout should create participant");

  const afterDistributor = await request<AppData>(baseUrl, "/api/distributors", {
    method: "POST",
    token: session.token,
    body: { type: "客户", customerId: afterCustomer.customers[0].id, rate: 0.07 },
  });
  const apiDistributorId = afterDistributor.distributors[0].id;
  assert.equal(afterDistributor.distributors[0].status, "启用", "distributor API should create active distributor");
  const afterReferral = await request<AppData>(baseUrl, "/api/referral-relations", {
    method: "POST",
    token: session.token,
    body: { distributorId: apiDistributorId, customerId: "c3" },
  });
  assert.equal(afterReferral.referralRelations[0].distributorId, apiDistributorId, "referral API should bind customer to distributor");
  const afterDistributionCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c3",
      staffId: "s2",
      serviceId: "v2",
      payMethod: "微信",
    },
  });
  assert.equal(afterDistributionCheckout.orders[0].distributorId, apiDistributorId, "checkout should apply referral distributor");
  assert.equal(afterDistributionCheckout.distributionCommissions[0].amount, 19, "checkout should create distribution commission");

  const afterDiscountCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "API 活动价",
      approvalId: discountApprovalId,
    },
  });
  assert.equal(afterDiscountCheckout.orders[0].paidAmount, 348, "approved discount checkout should reduce paid amount");
  assert.equal(afterDiscountCheckout.orders[0].discountAmount, 50, "discount checkout should persist adjustment");

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
  assert.equal(afterCheckout.orders.length, 5, "checkout API should create another order");
  assert.equal(afterCheckout.orders[0].totalAmount, 597, "checkout API should calculate total");
  assert.equal(afterCheckout.products.find((item) => item.id === "p1")?.stock, 14, "checkout API should consume service stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p4")?.stock, 23, "checkout API should consume retail stock");
  const checkoutCommissions = afterCheckout.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
  assert.equal(checkoutCommissions.length, 2, "checkout API should create service and sales commissions");
  assert.equal(checkoutCommissions.find((item) => item.type === "服务提成")?.amount, 48, "checkout API should create service commission");
  assert.equal(checkoutCommissions.find((item) => item.type === "销售提成")?.amount, 24, "checkout API should create sales commission");
  assert.equal(checkoutCommissions[0].rate, 0.12, "checkout API should persist staff commission rate");
  assert.equal(afterCheckout.operationLogs[0].action, "开单收银", "checkout API should write operation log");

  const afterRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 测试退款" },
  });
  const refundedOrder = afterRefund.orders.find((item) => item.id === afterCheckout.orders[0].id);
  assert.ok(refundedOrder, "refunded order should still exist");
  assert.equal(refundedOrder.status, "已退款", "refund API should update order status");
  assert.equal(afterRefund.refunds[0].amount, 597, "refund API should write refund record");
  assert.equal(afterRefund.products.find((item) => item.id === "p1")?.stock, 15, "refund API should restore service stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p4")?.stock, 24, "refund API should restore retail stock");
  assert.ok(afterRefund.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id).every((item) => item.status === "已冲销"), "refund API should reverse commission");
  assert.ok(afterRefund.distributionCommissions.some((item) => item.status === "待结算"), "unrelated distribution commission should remain pending");

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

  const afterOpenCard = await request<AppData>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { customerId: "c2", name: "API 储值卡", balance: 500, remainingTimes: 0 },
  });
  const apiCardId = afterOpenCard.memberCards[0].id;
  const afterOpenPackageCard = await request<AppData>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { customerId: "c2", name: "API 套餐卡", type: "套餐卡", balance: 0, remainingTimes: 5, serviceIds: ["v1", "v2"] },
  });
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
  const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/recharge`, {
    method: "POST",
    token: session.token,
    body: { amount: 100, note: "API 充值" },
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
  assert.equal(afterInventory.products.find((item) => item.id === "p1")?.stock, 14, "inventory API should increase stock");
  assert.equal(afterInventory.inventoryLogs[0].note, "API 入库", "inventory API should persist note");

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
      nextFollowUpAt: "2026-05-29T10:00:00.000Z",
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
    body: { supplierId, productId: "p1", quantity: 3, unitCost: 60 },
  });
  assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "purchase API should create inbound inventory log");
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

  const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "therapist@test.local", password: "test-password" },
  });
  const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.ok(therapistData.appointments.every((item) => item.staffId === "s2"), "therapist should only see own appointments");
  assert.ok(therapistData.orders.every((item) => item.staffId === "s2"), "therapist should only see own orders");
  assert.ok(therapistData.staffUnavailableSlots.every((item) => item.staffId === "s2"), "therapist should only see own unavailable slots");
  assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

  const persistedData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(persistedData.orders.length, 10, "API data should persist across requests");
  assert.equal(persistedData.refunds.length, 2, "API data should persist refunds");
  assert.ok(persistedData.distributionCommissions.length >= 1, "API data should persist distribution commissions");
  assert.ok(persistedData.operationLogs.length >= 4, "API data should persist operation logs");

  const afterArrivedAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-05-25T08:00:00.000Z",
      note: "API 预约收银",
    },
  });
  const checkoutAppointmentId = afterArrivedAppointment.appointments[0].id;
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
      serviceId: "v1",
      appointmentId: checkoutAppointmentId,
      payMethod: "微信",
    },
  });
  assert.equal(afterAppointmentCheckout.orders[0].appointmentId, checkoutAppointmentId, "checkout API should link arrived appointment");
  assert.equal(afterAppointmentCheckout.appointments.find((item) => item.id === checkoutAppointmentId)?.status, "已完成", "checkout API should complete appointment");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v2",
          appointmentId: checkoutAppointmentId,
          payMethod: "微信",
        },
      }),
    /只有已到店预约可以直接收银|收银信息与预约不一致/,
    "checkout API should reject invalid appointment checkout",
  );

  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token }),
    /Not found/,
    "formal API should not expose a reset endpoint",
  );

  console.log("API/SQLite 验证通过：健康检查、注册/邀请、登录鉴权、人员管理、权限、客户、预约/班次、审批改价、开单、退款、卡项、档案跟进、进销存、日结反结、数据范围、持久化、正式接口边界。");
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
