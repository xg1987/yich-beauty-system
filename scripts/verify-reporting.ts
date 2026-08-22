import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  customerMonthlyTrend,
  customerPeriodReport,
  periodPaymentAmounts,
  periodServicePerformance,
  periodStaffPerformance,
  productUsageReport,
  reportableOrderOriginalPaidAmount,
  reportablePeriodData,
  reportOrderAuditAmounts,
  serviceDeliveryReport,
} from "../src/domain/reporting";
import { reportSummary } from "../src/domain/business";
import { testFixtureData } from "../src/domain/testFixture";
import type { AppData, Order } from "../src/domain/types";
import { buildBusinessWorkbook } from "../src/utils/exportBusinessWorkbook";

const julyStart = new Date("2026-07-01T00:00:00.000+08:00");
const augustStart = new Date("2026-08-01T00:00:00.000+08:00");
const now = new Date("2026-07-29T12:00:00.000+08:00");

function order(input: Partial<Order> & Pick<Order, "id" | "customerId" | "createdAt" | "paidAmount">): Order {
  return {
    storeId: "store1",
    orderNo: `SO-${input.id}`,
    staffId: "s2",
    serviceId: "v1",
    totalAmount: input.paidAmount,
    discountAmount: 0,
    payMethod: "微信",
    status: "已支付",
    ...input,
  };
}

const data: AppData = structuredClone(testFixtureData);
data.products = data.products.map((product) => {
  if (product.id === "p3") return { ...product, stock: 2 };
  if (product.id === "p4") return { ...product, stock: 1 };
  return product;
});
data.inventoryBatches = [{
  id: "batch_expiring",
  storeId: "store1",
  productId: "p2",
  source: "手动入库",
  quantityIn: 2,
  remainingQuantity: 2,
  unitCost: 80,
  expiryAt: "2026-08-10",
  createdAt: "2026-07-01T00:00:00.000Z",
}];
data.inventoryLogs = [{
  id: "loss_p3",
  storeId: "store1",
  productId: "p3",
  type: "报损",
  delta: -1,
  stockAfter: 2,
  note: "破损",
  createdAt: "2026-07-15T10:00:00.000+08:00",
}];
data.orders = [
  order({ id: "june_old", customerId: "c1", paidAmount: 398, createdAt: "2026-06-10T10:00:00.000+08:00" }),
  order({ id: "july_returning", customerId: "c1", paidAmount: 398, createdAt: "2026-07-05T10:00:00.000+08:00" }),
  order({ id: "july_new_service", customerId: "c2", serviceId: "v2", paidAmount: 268, createdAt: "2026-07-08T10:00:00.000+08:00" }),
  order({
    id: "july_new_product",
    customerId: "c2",
    serviceId: "",
    productId: "p4",
    productItems: [{ productId: "p4", productName: "家用补水面膜", quantity: 1, unitPrice: 199, amount: 199 }],
    paidAmount: 199,
    createdAt: "2026-07-20T10:00:00.000+08:00",
  }),
  order({ id: "july_refunded", customerId: "c3", paidAmount: 680, status: "已退款", createdAt: "2026-07-10T10:00:00.000+08:00" }),
];
data.memberCards.push({
  id: "delivery_package",
  storeId: "store1",
  customerId: "c2",
  name: "面护养生组合卡",
  type: "套餐卡",
  balance: 0,
  remainingTimes: 3,
  expiresAt: "2027-12-31",
  status: "正常",
  serviceId: "v1",
  serviceIds: ["v1", "v2"],
  serviceEntitlements: [
    { serviceId: "v1", totalTimes: 2, remainingTimes: 1 },
    { serviceId: "v2", totalTimes: 3, remainingTimes: 2 },
  ],
});

const customers = customerPeriodReport(data, julyStart, augustStart);
assert.equal(customers.activeCustomerCount, 2, "period customer report should deduplicate paying customers");
assert.equal(customers.newCustomerCount, 1, "customer first paid order in July should count as new");
assert.equal(customers.returningCustomerCount, 1, "customer with an earlier paid order should count as returning");
assert.equal(customers.returningRate, 0.5, "returning share should use active customers as denominator");
assert.equal(customers.visitCount, 3, "period visits should count valid paid orders");
assert.equal(customers.totalCustomerCount, 3, "customer total should preserve all store customer profiles");
assert.equal(customers.newCustomerRevenue, 467, "new customer revenue should include all valid period orders");
assert.equal(customers.returningCustomerRevenue, 398, "returning revenue should include the old customer's period order");
assert.deepEqual(customers.details.map((item) => item.customerType).sort(), ["新客", "老客"], "detail rows should expose new and returning customer types");

const trend = customerMonthlyTrend(data, now, 2);
assert.equal(trend[0].newCustomerCount, 1, "June should contain the first paying customer");
assert.equal(trend[1].activeCustomerCount, 2, "July trend should match period active customer count");
assert.equal(trend[1].returningCustomerCount, 1, "July trend should classify the historical customer as returning");
assert.equal(trend[1].cumulativePayingCustomerCount, 2, "cumulative paying customer count should exclude refunded-only customers");

const deliveries = serviceDeliveryReport(data, now);
assert.equal(deliveries.projectCount, 2, "delivery report should count distinct purchased service projects");
assert.equal(deliveries.cardCount, 2, "delivery report should exclude stored-value cards");
assert.equal(deliveries.customerCount, 2, "delivery report should deduplicate project-card customers");
assert.equal(deliveries.pendingCustomerCount, 2, "delivery report should count customers with remaining services");
assert.equal(deliveries.totalTimes, 15, "delivery report should total legacy and per-service purchased entitlements");
assert.equal(deliveries.deliveredTimes, 6, "delivery report should calculate delivered services");
assert.equal(deliveries.remainingTimes, 9, "delivery report should calculate outstanding services");
assert.equal(deliveries.projects.find((item) => item.serviceName === "小气泡深层清洁")?.remainingTimes, 7, "project summary should combine cards for the same service");
assert.equal(deliveries.details.find((item) => item.cardId === "m2")?.dataSource, "历史卡名称推算", "legacy card without opening history should expose its inference source");

const products = productUsageReport(data, julyStart, augustStart, now);
const p1 = products.find((item) => item.productId === "p1");
const p2 = products.find((item) => item.productId === "p2");
const p3 = products.find((item) => item.productId === "p3");
const p4 = products.find((item) => item.productId === "p4");
assert.ok(p1 && p2 && p3 && p4, "all store products should appear in the usage report");
assert.equal(p1.serviceUseCount, 1, "linked liquid product should still count project usage");
assert.equal(p1.serviceConsumedQuantity, 0, "untracked liquid product should not invent stock consumption");
assert.equal(p1.status, "需完善扣耗", "linked untracked liquid product should ask for usage configuration");
assert.equal(p2.status, "临期关注", "expiring inventory should receive a dedicated status");
assert.equal(p3.lossQuantity, 1, "period loss should contribute to product usage");
assert.equal(p3.status, "立即补货", "stock below warning should require immediate replenishment");
assert.equal(p4.soldQuantity, 1, "retail product sale should appear in product usage");
assert.equal(p4.status, "立即补货", "low retail stock should require immediate replenishment");
assert.ok(p4.suggestedPurchaseQuantity > 0, "replenishment row should calculate a purchase suggestion");
const pendingProducts = productUsageReport({ ...data, products: data.products.map((product) => product.id === "p1" ? { ...product, serviceStockReviewStatus: "pending" } : product) }, julyStart, augustStart, now);
assert.equal(pendingProducts.find((item) => item.productId === "p1")?.status, "待确认扣减规则", "reporting should surface pending historical product review before purchase advice");

const legacyPendingUsageData: AppData = {
  ...structuredClone(testFixtureData),
  products: structuredClone(testFixtureData.products).map((product) => (
    product.id === "p3" ? { ...product, serviceStockReviewStatus: "pending" as const } : product
  )),
  orders: [order({
    id: "legacy_service_without_snapshot",
    customerId: "c1",
    serviceId: "v3",
    paidAmount: 680,
    createdAt: "2026-07-12T10:00:00.000+08:00",
  })],
};
const legacyPendingUsage = productUsageReport(legacyPendingUsageData, julyStart, augustStart, now);
assert.equal(
  legacyPendingUsage.find((item) => item.productId === "p3")?.serviceConsumedQuantity,
  1,
  "historical order without a snapshot should keep legacy inferred service consumption after the product becomes pending",
);
const explicitPendingSnapshotUsage = productUsageReport({
  ...legacyPendingUsageData,
  orders: [{ ...legacyPendingUsageData.orders[0], serviceConsumables: [] }],
}, julyStart, augustStart, now);
assert.equal(
  explicitPendingSnapshotUsage.find((item) => item.productId === "p3")?.serviceConsumedQuantity,
  0,
  "explicit empty pending checkout snapshot should not be replaced by historical inference in reports",
);

const crossDayFinancialData: AppData = {
  ...structuredClone(testFixtureData),
  orders: [order({
    id: "cross_day_cash_order",
    customerId: "c1",
    paidAmount: 0,
    totalAmount: 100,
    status: "已退款",
    createdAt: "2026-07-20T10:00:00.000+08:00",
  })],
  refunds: [{
    id: "cross_day_cash_refund",
    storeId: "store1",
    orderId: "cross_day_cash_order",
    amount: 100,
    reason: "次日撤销",
    createdBy: "u_manager",
    createdAt: "2026-07-21T10:00:00.000+08:00",
  }],
  memberCardTransactions: [],
};
const saleDayFinancialSummary = reportSummary({ ...crossDayFinancialData, refunds: [] }, crossDayFinancialData);
const refundDayFinancialSummary = reportSummary({ ...crossDayFinancialData, orders: [] }, crossDayFinancialData);
assert.equal(saleDayFinancialSummary.revenue, 100, "sale-day reporting should reconstruct original cash revenue after a later refund");
assert.equal(saleDayFinancialSummary.refundAmount, 0, "later refund must not be backdated into the sale-day report");
assert.equal(saleDayFinancialSummary.serviceCount, 1, "later refund must not erase the historical sale-day order count");
assert.equal(refundDayFinancialSummary.revenue, 0, "refund-only day should not invent gross revenue");
assert.equal(refundDayFinancialSummary.refundAmount, 100, "refund should appear on its actual day");
assert.equal(refundDayFinancialSummary.netRevenue, -100, "refund-only day should expose one negative cash movement");

const memberCardServiceRefundData: AppData = {
  ...structuredClone(testFixtureData),
  orders: [order({
    id: "member_card_service_refund",
    customerId: "c1",
    paidAmount: 0,
    totalAmount: 398,
    payMethod: "会员卡",
    status: "已退款",
    createdAt: "2026-07-20T10:00:00.000+08:00",
  })],
  refunds: [{
    id: "member_card_service_refund_row",
    storeId: "store1",
    orderId: "member_card_service_refund",
    amount: 398,
    reason: "返还会员卡权益",
    createdBy: "u_manager",
    createdAt: "2026-07-20T11:00:00.000+08:00",
  }],
  memberCardTransactions: [],
};
assert.equal(reportSummary(memberCardServiceRefundData).revenue, 0, "member-card service redemption is not cash revenue");
assert.equal(reportSummary(memberCardServiceRefundData).refundAmount, 0, "member-card service refund is not a cash refund");

const rankingOrder = order({
  id: "period_ranking_mixed_order",
  customerId: "c1",
  staffId: "s2",
  serviceId: "v1",
  servicePrice: 80,
  productId: "p4",
  productItems: [{ productId: "p4", productName: "家用补水面膜", quantity: 1, unitPrice: 120, amount: 120 }],
  paidAmount: 0,
  totalAmount: 200,
  status: "已退款",
  createdAt: "2026-07-20T10:00:00.000+08:00",
});
const rankingRefund: AppData["refunds"][number] = {
  id: "period_ranking_refund",
  storeId: "store1",
  orderId: rankingOrder.id,
  amount: 200,
  reason: "次日全额退款",
  createdBy: "u_manager",
  createdAt: "2026-07-21T10:00:00.000+08:00",
};
const rankingCommissions: AppData["commissions"] = [
  {
    id: "ranking_commission_owner",
    storeId: "store1",
    staffId: "s2",
    orderId: rankingOrder.id,
    type: "服务提成",
    baseAmount: 80,
    rate: 0.1,
    amount: 8,
    status: "已结算",
    createdAt: rankingOrder.createdAt,
  },
  {
    id: "ranking_commission_collaborator",
    storeId: "store1",
    staffId: "s3",
    orderId: rankingOrder.id,
    type: "服务提成",
    baseAmount: 40,
    rate: 0.1,
    amount: 4,
    status: "已结算",
    createdAt: rankingOrder.createdAt,
  },
  {
    id: "cmr_period_ranking_refund_ranking_commission_owner",
    storeId: "store1",
    staffId: "s2",
    orderId: rankingOrder.id,
    type: "服务提成",
    baseAmount: -80,
    rate: 0.1,
    amount: -8,
    status: "待结算",
    createdAt: rankingRefund.createdAt,
  },
  {
    id: "cmr_period_ranking_refund_ranking_commission_collaborator",
    storeId: "store1",
    staffId: "s3",
    orderId: rankingOrder.id,
    type: "服务提成",
    baseAmount: -40,
    rate: 0.1,
    amount: -4,
    status: "待结算",
    createdAt: rankingRefund.createdAt,
  },
];
const rankingData: AppData = {
  ...structuredClone(testFixtureData),
  orders: [rankingOrder],
  refunds: [rankingRefund],
  commissions: rankingCommissions,
  memberCardTransactions: [],
};
const saleRankingData: AppData = {
  ...rankingData,
  refunds: [],
  commissions: rankingCommissions.filter((commission) => commission.createdAt === rankingOrder.createdAt),
};
const refundRankingData: AppData = {
  ...rankingData,
  orders: [],
  commissions: rankingCommissions.filter((commission) => commission.createdAt === rankingRefund.createdAt),
};
const saleStaffRanking = periodStaffPerformance(rankingData, saleRankingData);
const refundStaffRanking = periodStaffPerformance(rankingData, refundRankingData);
const samePeriodStaffRanking = periodStaffPerformance(rankingData, rankingData);
assert.equal(saleStaffRanking.find((item) => item.id === "s2")?.netAmount, 200, "sale-day staff ranking should retain original mixed-order revenue");
assert.equal(saleStaffRanking.find((item) => item.id === "s2")?.commission, 8, "sale-day staff ranking should retain original commission accrual");
assert.equal(refundStaffRanking.find((item) => item.id === "s2")?.netAmount, -200, "refund-day staff ranking should show the refund as a negative event");
assert.equal(refundStaffRanking.find((item) => item.id === "s2")?.commission, -8, "refund-day staff ranking should show the commission reversal");
assert.equal(refundStaffRanking.find((item) => item.id === "s3")?.commission, -4, "collaborator-only commission reversal should remain visible");
assert.equal(samePeriodStaffRanking.find((item) => item.id === "s2")?.netAmount, 0, "same-period sale and full refund should net to zero instead of negative");
assert.equal(samePeriodStaffRanking.find((item) => item.id === "s2")?.commission, 0, "same-period commission and reversal should net to zero");
const saleServiceRanking = periodServicePerformance(rankingData, saleRankingData);
const refundServiceRanking = periodServicePerformance(rankingData, refundRankingData);
const samePeriodServiceRanking = periodServicePerformance(rankingData, rankingData);
assert.equal(saleServiceRanking.find((item) => item.id === "v1")?.revenue, 80, "project ranking should attribute only the service portion of a mixed order");
assert.equal(refundServiceRanking.find((item) => item.id === "v1")?.revenue, -80, "refund-day project ranking should reverse only the service portion");
assert.equal(samePeriodServiceRanking.find((item) => item.id === "v1")?.revenue, 0, "same-period full refund should leave project revenue at zero, not negative");

const weightedServiceOrder = order({
  id: "weighted_repeated_services",
  customerId: "c1",
  staffId: "s2",
  serviceId: "v1",
  serviceIds: ["v1", "v2", "v1"],
  servicePrice: 400,
  paidAmount: 200,
  totalAmount: 400,
  status: "部分退款",
  createdAt: "2026-07-22T10:00:00.000+08:00",
});
const weightedServiceRefund: AppData["refunds"][number] = {
  id: "weighted_repeated_services_refund",
  storeId: "store1",
  orderId: weightedServiceOrder.id,
  amount: 200,
  reason: "多项目部分退款",
  createdBy: "u_manager",
  createdAt: "2026-07-23T10:00:00.000+08:00",
};
const weightedServiceData: AppData = {
  ...structuredClone(testFixtureData),
  services: structuredClone(testFixtureData.services).map((service) => {
    if (service.id === "v1") return { ...service, price: 100 };
    if (service.id === "v2") return { ...service, price: 300 };
    return service;
  }),
  orders: [weightedServiceOrder],
  refunds: [weightedServiceRefund],
  commissions: [],
  memberCardTransactions: [],
};
const weightedSaleRanking = periodServicePerformance(weightedServiceData, { ...weightedServiceData, refunds: [] });
const weightedRefundRanking = periodServicePerformance(weightedServiceData, { ...weightedServiceData, orders: [] });
const repeatedService = weightedSaleRanking.find((item) => item.id === "v1");
const premiumService = weightedSaleRanking.find((item) => item.id === "v2");
assert.equal(repeatedService?.count, 2, "repeated service ids should preserve quantity in project ranking");
assert.equal(repeatedService?.revenue, 160, "two repeated 100-price services should receive two weighted shares of the 400 service snapshot");
assert.equal(premiumService?.count, 1, "a distinct service should keep its own quantity");
assert.equal(premiumService?.revenue, 240, "the 300-price service should receive three fifths of the service snapshot instead of an equal share");
assert.equal(weightedRefundRanking.find((item) => item.id === "v1")?.revenue, -80, "refund should reverse repeated services by the same catalog-price weights");
assert.equal(weightedRefundRanking.find((item) => item.id === "v2")?.revenue, -120, "refund should reverse the higher-price service proportionally");

const legacyRefundWithoutEventOrder = order({
  id: "legacy_refunded_without_event",
  customerId: "c1",
  staffId: "s2",
  serviceId: "v1",
  serviceIds: ["v1"],
  servicePrice: 500,
  productId: "p4",
  productItems: [{ productId: "p4", productName: "历史商品", quantity: 1, unitPrice: 100, amount: 100 }],
  paidAmount: 500,
  totalAmount: 600,
  status: "已退款",
  createdAt: "2026-07-24T10:00:00.000+08:00",
});
const legacyRefundWithoutEventData: AppData = {
  ...structuredClone(testFixtureData),
  orders: [legacyRefundWithoutEventOrder],
  refunds: [],
  commissions: [{
    id: "legacy_refunded_without_event_commission",
    storeId: "store1",
    staffId: "s2",
    orderId: legacyRefundWithoutEventOrder.id,
    type: "服务提成",
    baseAmount: 500,
    rate: 0.1,
    amount: 50,
    status: "已冲销",
    createdAt: legacyRefundWithoutEventOrder.createdAt,
  }],
  memberCardTransactions: [],
};
const legacyReportableData = reportablePeriodData(legacyRefundWithoutEventData, legacyRefundWithoutEventData);
assert.equal(reportableOrderOriginalPaidAmount(legacyRefundWithoutEventData, legacyRefundWithoutEventOrder), 0, "legacy refunded order without a refund event should have zero reportable income");
assert.equal(legacyReportableData.orders.length, 0, "legacy refunded order should be removed from financial aggregation input");
assert.equal(legacyReportableData.commissions.length, 0, "legacy refunded order commission should not reappear in staff totals");
assert.equal(legacyRefundWithoutEventData.orders.length, 1, "financial filtering must keep the source order available for audit rows");
assert.deepEqual(
  reportOrderAuditAmounts(legacyRefundWithoutEventData, legacyRefundWithoutEventOrder),
  { paidAmount: 500, refundAmount: 500, netAmount: 0 },
  "legacy refunded order audit row should retain original payment while clearly showing zero net income",
);
const legacySummary = reportSummary(legacyReportableData, legacyRefundWithoutEventData);
assert.equal(legacySummary.revenue, 0, "legacy refunded order must not re-enter report income");
assert.equal(legacySummary.commission, 0, "legacy refunded order must not re-enter commission accrual");
assert.equal(periodStaffPerformance(legacyRefundWithoutEventData, legacyRefundWithoutEventData).length, 0, "legacy refunded order must not appear in staff performance");
assert.equal(periodServicePerformance(legacyRefundWithoutEventData, legacyRefundWithoutEventData).length, 0, "legacy refunded order must not appear in project performance");
assert.equal(periodPaymentAmounts(legacyRefundWithoutEventData, legacyRefundWithoutEventData).get("微信") ?? 0, 0, "legacy refunded order must not re-enter payment-method income");

const workbook = buildBusinessWorkbook({
  storeName: "祝融｜坤锋美学门店",
  periodLabel: "2026年7月",
  generatedAt: now,
  summary: {
    revenue: 865,
    netRevenue: 865,
    grossProfit: 600,
    grossMargin: 600 / 865,
    refundAmount: 0,
    serviceCount: 3,
    averageOrderValue: 865 / 3,
  },
  customerReport: customers,
  customerTrend: trend,
  serviceDelivery: deliveries,
  productUsage: products,
});
assert.equal(workbook.bytes[0], 0x50, "xlsx should start with a ZIP signature");
assert.equal(workbook.bytes[1], 0x4b, "xlsx should start with a ZIP signature");
assert.match(workbook.filename, /2026年7月经营分析\.xlsx$/, "workbook filename should include the selected period");
const files = unzipSync(workbook.bytes);
assert.equal(Object.keys(files).filter((name) => name.startsWith("xl/worksheets/sheet")).length, 8, "workbook should contain eight worksheets");
assert.match(strFromU8(files["xl/workbook.xml"]), /经营概览/, "workbook should contain the summary worksheet");
assert.match(strFromU8(files["xl/workbook.xml"]), /补货建议/, "workbook should contain the restock worksheet");
assert.match(strFromU8(files["xl/workbook.xml"]), /服务交付汇总/, "workbook should contain the service-delivery worksheet");
assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]), /老客回店人数/, "summary sheet should include returning-customer metrics");
assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]), /还未交付次数/, "summary sheet should include outstanding service metrics");
assert.match(strFromU8(files["xl/worksheets/sheet4.xml"]), /门店合计/, "delivery summary sheet should contain store totals");
assert.match(strFromU8(files["xl/worksheets/sheet5.xml"]), /历史卡名称推算/, "delivery detail sheet should preserve data provenance");
assert.match(strFromU8(files["xl/worksheets/sheet6.xml"]), /立即补货/, "product sheet should preserve restock status");
assert.match(strFromU8(files["xl/styles.xml"]), /¥#,\#\#0\.00/, "workbook should include currency formatting");

console.log("经营分析验证通过：客户新老客口径、服务项目交付、月度趋势、产品使用、补货判断及多工作表 Excel 导出。");
