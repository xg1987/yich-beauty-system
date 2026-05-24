import assert from "node:assert/strict";
import {
  addCustomerServiceRecord,
  addSupplier,
  adjustInventory,
  checkoutOrder,
  createAppointment,
  createApprovalRequest,
  createDailyClose,
  createStaffShift,
  createStaffUnavailableSlot,
  createStocktake,
  completeCustomerFollowUp,
  decideApprovalRequest,
  extendMemberCard,
  receivePurchaseOrder,
  rechargeMemberCard,
  refundMemberCard,
  refundOrder,
  reportSummary,
  reverseDailyClose,
  transferMemberCard,
  updateMemberCardStatus,
} from "../src/domain/business";
import { seedData } from "../src/domain/seed";
import type { AppData } from "../src/domain/types";

const cloneSeed = (): AppData => structuredClone(seedData);
const fixedNow = () => "2026-05-24T01:00:00.000Z";
let idIndex = 0;
const testId = (prefix: string) => `${prefix}_test_${++idIndex}`;

function productStock(data: AppData, productId: string) {
  const product = data.products.find((item) => item.id === productId);
  assert.ok(product, `missing product ${productId}`);
  return product.stock;
}

function card(data: AppData, cardId: string) {
  const result = data.memberCards.find((item) => item.id === cardId);
  assert.ok(result, `missing card ${cardId}`);
  return result;
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(data.orders.length, 1, "checkout should create one order");
  assert.equal(data.orders[0].totalAmount, 597, "order total should include service and retail product");
  assert.equal(productStock(data, "p1"), 17, "service consumable stock should decrease");
  assert.equal(productStock(data, "p4"), 23, "retail product stock should decrease");
  assert.equal(data.inventoryLogs.length, 2, "service and retail stock changes should both log");
  assert.equal(data.commissions[0].amount, 72, "commission should be 12 percent rounded");
  assert.equal(data.operationLogs.length, 0, "pure business checkout should not require operation log");

  const summary = reportSummary(data);
  assert.equal(summary.revenue, 597, "report revenue should match paid amount");
  assert.equal(summary.serviceCount, 1, "report service count should track paid orders");
  assert.equal(summary.commission, 72, "report commission should aggregate commission records");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      collaboratorStaffIds: ["s1"],
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );

  const commissions = data.commissions.filter((item) => item.orderId === data.orders[0].id);
  assert.equal(commissions.length, 2, "collaborative checkout should create split commissions");
  assert.deepEqual(
    commissions.map((item) => item.staffId).sort(),
    ["s1", "s2"],
    "split commission should include primary and collaborator staff",
  );
  assert.equal(commissions.reduce((sum, item) => sum + item.amount, 0), 48, "split commissions should preserve total commission");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(data, "m1").balance, 2202, "stored-value card should deduct service price");
  assert.equal(productStock(data, "p1"), 17, "member-card checkout should still consume stock");
  assert.equal(data.memberCardTransactions[0].type, "消费", "member card checkout should write card transaction");
  assert.equal(data.memberCardTransactions[0].amountDelta, -398, "stored-value transaction should record amount delta");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c3",
      staffId: "s1",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m2",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(data, "m2").remainingTimes, 5, "times card should deduct one use");
  assert.equal(data.memberCardTransactions[0].timesDelta, -1, "times card transaction should record times delta");
}

{
  const blocked = createStaffUnavailableSlot(
    cloneSeed(),
    {
      staffId: "s3",
      startAt: "2026-05-26T02:00:00.000Z",
      endAt: "2026-05-26T03:00:00.000Z",
      reason: "员工培训",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(blocked.staffUnavailableSlots[0].reason, "员工培训", "unavailable slot should be recorded");
  assert.equal(blocked.operationLogs[0].action, "锁定员工时间", "unavailable slot should write operation log");

  assert.throws(
    () =>
      createAppointment(
        blocked,
        {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-05-26T02:15:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不可预约/,
    "appointment creation should reject unavailable staff slot",
  );
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "客户取消",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(refunded.orders[0].status, "已退款", "refund should update order status");
  assert.equal(refunded.refunds[0].amount, 597, "refund should preserve refund amount");
  assert.equal(productStock(refunded, "p1"), 18, "refund should restore service consumable stock");
  assert.equal(productStock(refunded, "p4"), 24, "refund should restore retail product stock");
  assert.equal(refunded.commissions[0].status, "已冲销", "refund should reverse commission");
  assert.equal(refunded.operationLogs[0].action, "订单退款", "refund should write operation log");

  const summary = reportSummary(refunded);
  assert.equal(summary.revenue, 0, "refunded order should not count as revenue");
  assert.equal(summary.refundAmount, 597, "report should include refund amount");
  assert.equal(summary.commission, 0, "reversed commission should not count in report");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "会员卡退款",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(refunded, "m1").balance, 2600, "member-card refund should restore balance");
  assert.equal(refunded.memberCardTransactions[0].type, "退款", "member-card refund should write refund transaction");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "部分退款",
      userId: "u_manager",
      amount: 100,
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(refunded.orders[0].status, "部分退款", "partial refund should keep order open");
  assert.equal(refunded.orders[0].paidAmount, 497, "partial refund should reduce paid amount");
  assert.equal(productStock(refunded, "p1"), 17, "partial refund should not restore service stock");
  assert.equal(productStock(refunded, "p4"), 23, "partial refund should not restore retail stock");
  assert.ok(refunded.commissions[0].amount < checkedOut.commissions[0].amount, "partial refund should reduce commission");
}

{
  const refundedCard = refundMemberCard(
    cloneSeed(),
    {
      memberCardId: "m1",
      reason: "客户退卡",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(refundedCard, "m1").status, "已退卡", "member card refund should close card");
  assert.equal(card(refundedCard, "m1").balance, 0, "member card refund should clear balance");
  assert.equal(refundedCard.memberCardTransactions[0].type, "退卡", "member card refund should write card transaction");
  assert.equal(refundedCard.operationLogs[0].action, "会员退卡", "member card refund should write operation log");
}

{
  assert.throws(
    () =>
      checkoutOrder(
        cloneSeed(),
        {
          customerId: "c3",
          staffId: "s1",
          serviceId: "v2",
          payMethod: "会员卡",
          cardId: "m2",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不可用于当前项目/,
    "project-bound times card should reject unmatched service",
  );
}

{
  assert.throws(
    () =>
      createAppointment(
        cloneSeed(),
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: "2026-05-25T02:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /已有预约/,
    "appointment creation should reject staff schedule conflict",
  );

  const data = createAppointment(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-05-25T02:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(data.appointments[0].staffId, "s3", "non-conflicting appointment should be created");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: () => "2026-05-24T01:00:00.000Z" },
  );
  const closed = createDailyClose(
    checkedOut,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(closed.dailyCloses[0].revenue, 398, "daily close should summarize revenue");
  assert.equal(closed.dailyCloses[0].orderCount, 1, "daily close should count paid orders");
  assert.equal(closed.operationLogs[0].action, "财务日结", "daily close should write operation log");
}

{
  const lowBalanceData = cloneSeed();
  lowBalanceData.memberCards = lowBalanceData.memberCards.map((item) =>
    item.id === "m1" ? { ...item, balance: 1 } : item,
  );

  assert.throws(
    () =>
      checkoutOrder(
        lowBalanceData,
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          payMethod: "会员卡",
          cardId: "m1",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /余额不足/,
    "stored-value card should reject insufficient balance",
  );
}

{
  const data = adjustInventory(
    cloneSeed(),
    { productId: "p1", type: "入库", quantity: 4, note: "采购入库" },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(productStock(data, "p1"), 22, "inbound stock should increase inventory");
  assert.equal(data.inventoryLogs[0].delta, 4, "inbound adjustment should log positive delta");
  assert.equal(data.inventoryLogs[0].note, "采购入库", "inventory note should be preserved");
}

{
  assert.throws(
    () =>
      checkoutOrder(
        cloneSeed(),
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          payMethod: "微信",
          discountAmount: 50,
          adjustmentReason: "活动价",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /需要审批/,
    "discount checkout should require approved request",
  );

  const requested = createApprovalRequest(
    cloneSeed(),
    { type: "改价折扣", targetId: "manual", requestedBy: "u_frontdesk", amount: 50, reason: "活动价" },
    { idFactory: testId, now: fixedNow },
  );
  const approved = decideApprovalRequest(
    requested,
    { approvalId: requested.approvalRequests[0].id, userId: "u_manager", approved: true },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    approved,
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "活动价",
      approvalId: approved.approvalRequests[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].paidAmount, 348, "approved discount should reduce paid amount");
  assert.equal(checkedOut.orders[0].discountAmount, 50, "order should persist discount amount");
}

{
  const recharged = rechargeMemberCard(
    cloneSeed(),
    { memberCardId: "m1", amount: 100, times: 0, note: "测试充值", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(recharged, "m1").balance, 2700, "member card recharge should increase balance");

  const frozen = updateMemberCardStatus(
    recharged,
    { memberCardId: "m1", status: "冻结", reason: "风控冻结", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(frozen, "m1").status, "冻结", "member card should be frozen");

  const extended = extendMemberCard(
    frozen,
    { memberCardId: "m1", expiresAt: "2028-12-31", reason: "延期", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(extended, "m1").expiresAt, "2028-12-31", "member card should extend expiry");

  const transferred = transferMemberCard(
    extended,
    { memberCardId: "m1", toCustomerId: "c2", reason: "客户转卡", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(transferred, "m1").customerId, "c2", "member card should transfer owner");
}

{
  const shifted = createStaffShift(
    cloneSeed(),
    {
      staffId: "s3",
      startAt: "2026-05-28T02:00:00.000Z",
      endAt: "2026-05-28T03:00:00.000Z",
      note: "早班",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      createAppointment(
        shifted,
        {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-05-28T04:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不在员工班次内/,
    "appointment should reject time outside staff shift",
  );
}

{
  const withRecord = addCustomerServiceRecord(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      skinCondition: "敏感偏干",
      beforeNote: "轻微泛红",
      afterNote: "补水修护",
      nextFollowUpAt: "2026-05-26T10:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withRecord.customerServiceRecords.length, 1, "service record should be created");
  assert.equal(withRecord.customerFollowUps[0].status, "待跟进", "service record should create follow-up");

  const completed = completeCustomerFollowUp(
    withRecord,
    { followUpId: withRecord.customerFollowUps[0].id },
    { now: fixedNow },
  );
  assert.equal(completed.customerFollowUps[0].status, "已完成", "follow-up should be completed");
}

{
  const withSupplier = addSupplier(cloneSeed(), { name: "测试供应商", phone: "13800000000", contact: "王经理" }, { idFactory: testId });
  const purchased = receivePurchaseOrder(
    withSupplier,
    { supplierId: withSupplier.suppliers[0].id, productId: "p1", quantity: 3, unitCost: 60, userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(purchased, "p1"), 21, "purchase order should increase stock");
  assert.equal(purchased.inventoryLogs[0].type, "采购入库", "purchase order should log inbound stock");

  const counted = createStocktake(
    purchased,
    { productId: "p1", actualStock: 19, reason: "盘点差异", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(counted, "p1"), 19, "stocktake should update actual stock");
  assert.equal(counted.stocktakes[0].delta, -2, "stocktake should preserve stock delta");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    { customerId: "c1", staffId: "s2", serviceId: "v1", payMethod: "微信" },
    { idFactory: testId, now: fixedNow },
  );
  const closed = createDailyClose(
    checkedOut,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      adjustInventory(
        closed,
        { productId: "p1", type: "入库", quantity: 1 },
        { idFactory: testId, now: fixedNow },
      ),
    /已日结锁账/,
    "daily close should lock same-day inventory changes",
  );
  const reversed = reverseDailyClose(
    closed,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(reversed.dailyCloses[0].status, "已反结", "reverse daily close should unlock business date");
  const adjusted = adjustInventory(
    reversed,
    { productId: "p1", type: "入库", quantity: 1 },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(adjusted, "p1"), 18, "inventory changes should be allowed after reverse close");
}

console.log("业务规则验证通过：P1 开单、审批、卡项、预约/班次、服务档案、回访、进销存、日结锁账/反结、退款、提成、报表。");
