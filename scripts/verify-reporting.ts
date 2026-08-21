import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  customerMonthlyTrend,
  customerPeriodReport,
  productUsageReport,
  serviceDeliveryReport,
} from "../src/domain/reporting";
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
