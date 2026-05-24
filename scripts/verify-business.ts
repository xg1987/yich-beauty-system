import assert from "node:assert/strict";
import {
  adjustInventory,
  checkoutOrder,
  createAppointment,
  createDailyClose,
  createStaffUnavailableSlot,
  refundMemberCard,
  refundOrder,
  reportSummary,
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

console.log("业务规则验证通过：开单、扣库存、会员卡、项目次数卡、预约冲突、不可预约时段、日结、提成拆分、全额退款、部分退款、退卡、卡项流水、报表、库存调整。");
