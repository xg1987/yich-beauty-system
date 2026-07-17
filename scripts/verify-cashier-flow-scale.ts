import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildCashierFlowRecords } from "../src/domain/cashierFlow";
import { emptyAppData } from "../src/domain/dataSlices";
import type { AppData, Order } from "../src/domain/types";

const CUSTOMER_COUNT = 1_000;
const PRODUCT_COUNT = 300;
const SERVICE_COUNT = 100;
const ORDER_COUNT = 100_000;
const MAX_BUILD_MS = 1_500;
const RUN_COUNT = 3;
const STORE_ID = "cashier-flow-scale-store";
const BASE_TIME_MS = Date.parse("2026-07-01T00:00:00.000Z");

const data = makeScaleData();

assert.equal(data.customers.length, CUSTOMER_COUNT, "should build 1000 customer rows");
assert.equal(data.products.length, PRODUCT_COUNT, "should build 300 product rows");
assert.equal(data.services.length, SERVICE_COUNT, "should build 100 service rows");
assert.equal(data.orders.length, ORDER_COUNT, "should build 100000 order rows");

buildCashierFlowRecords(data);

const durations: number[] = [];
for (let run = 1; run <= RUN_COUNT; run += 1) {
  const startedAt = performance.now();
  const records = buildCashierFlowRecords(data);
  const duration = performance.now() - startedAt;
  durations.push(duration);

  assert.equal(records.length, ORDER_COUNT, `run ${run} should return every order`);
  assert.equal(records[0]?.id, orderId(ORDER_COUNT - 1), `run ${run} should put the newest order first`);
  assert.equal(records.at(-1)?.id, orderId(0), `run ${run} should put the oldest order last`);
  assert.equal(records[0]?.customerName, "客户 999", `run ${run} should resolve the newest order customer`);
  assert.equal(records[0]?.itemName, "服务 99 + 商品 99 x1", `run ${run} should resolve the newest order items`);
  assert.equal(records[0]?.staffName, "员工 0", `run ${run} should preserve first-staff semantics`);
  assert.ok(duration <= MAX_BUILD_MS, `run ${run} should finish within ${MAX_BUILD_MS}ms (actual ${duration.toFixed(1)}ms)`);
}

const orderedDurations = [...durations].sort((left, right) => left - right);
const medianMs = orderedDurations[Math.floor(orderedDurations.length / 2)];
const maxMs = Math.max(...durations);

console.log(
  [
    "收银流水单店规模验证通过：",
    `customers=${CUSTOMER_COUNT}`,
    `products=${PRODUCT_COUNT}`,
    `services=${SERVICE_COUNT}`,
    `orders=${ORDER_COUNT}`,
    `median=${medianMs.toFixed(1)}ms`,
    `max=${maxMs.toFixed(1)}ms`,
    `limit=${MAX_BUILD_MS}ms`,
  ].join(" "),
);

function makeScaleData(): AppData {
  const scaleData = emptyAppData();

  scaleData.staff.push(
    {
      id: "staff-0",
      storeId: STORE_ID,
      name: "员工 0",
      phone: "13800000000",
      role: "美容师",
      status: "active",
    },
    {
      id: "staff-0",
      storeId: STORE_ID,
      name: "错误重复员工",
      phone: "13800000001",
      role: "美容师",
      status: "active",
    },
  );

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    scaleData.customers.push({
      id: `customer-${index}`,
      storeId: STORE_ID,
      name: `客户 ${index}`,
      phone: `139${String(index).padStart(8, "0")}`,
      level: "普通会员",
      source: "规模验证",
      tags: [],
      lastVisit: new Date(BASE_TIME_MS).toISOString(),
    });
  }

  for (let index = 0; index < PRODUCT_COUNT; index += 1) {
    scaleData.products.push({
      id: `product-${index}`,
      storeId: STORE_ID,
      name: `商品 ${index}`,
      type: "sale",
      unit: "件",
      price: 99,
      cost: 50,
      stock: ORDER_COUNT,
      warningStock: 10,
      status: "启用",
    });
  }

  for (let index = 0; index < SERVICE_COUNT; index += 1) {
    scaleData.services.push({
      id: `service-${index}`,
      storeId: STORE_ID,
      name: `服务 ${index}`,
      category: "规模验证",
      price: 298,
      duration: 60,
      status: "启用",
    });
  }

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    scaleData.orders.push(makeOrder(index));
  }

  return scaleData;
}

function makeOrder(index: number): Order {
  const customerId = `customer-${index % CUSTOMER_COUNT}`;
  const serviceId = `service-${index % SERVICE_COUNT}`;
  const productId = `product-${index % PRODUCT_COUNT}`;

  return {
    id: orderId(index),
    storeId: STORE_ID,
    orderNo: `SCALE-${String(index).padStart(6, "0")}`,
    customerId,
    staffId: "staff-0",
    serviceId,
    productItems: [{ productId, quantity: 1, unitPrice: 99, amount: 99 }],
    totalAmount: 397,
    paidAmount: 397,
    discountAmount: 0,
    payMethod: "微信",
    status: "已支付",
    createdAt: new Date(BASE_TIME_MS + index * 1_000).toISOString(),
  };
}

function orderId(index: number) {
  return `order-${String(index).padStart(6, "0")}`;
}
