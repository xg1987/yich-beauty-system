import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BeautyDatabase } from "../server/database";
import { defaultSystemConfigs } from "../src/domain/business";
import type { CashierFlowPageResult } from "../src/domain/cashierFlow";
import { dataKeysForView, emptyAppData } from "../src/domain/dataSlices";
import type { AppData, Order } from "../src/domain/types";

const STORE_ID = "pos-paging-scale-store";
const OWNER_ID = "pos-paging-scale-owner";
const CUSTOMER_COUNT = 1_000;
const PRODUCT_COUNT = 300;
const SERVICE_COUNT = 100;
const STAFF_COUNT = 3;
const MEMBER_CARD_COUNT = 10;
const ORDER_COUNT = 100_000;
const SERVICE_RECORD_COUNT = 100_000;
const SIGNATURE_COUNT = 100_000;
const PAGE_SIZE = 50;
const PAGE_MAX_MS = 1_500;
const CONTEXT_MAX_MS = 1_500;
const SLICE_MAX_MS = 800;
const PAGE_MAX_BYTES = 250 * 1024;
const LATEST_ORDER_AT_MS = Date.parse("2026-07-17T12:00:00.000Z");
const DAY_START = "2026-07-17T00:00:00.000Z";
const DAY_END = "2026-07-18T00:00:00.000Z";
const ARRIVED_UNPAID_ID = "appointment-arrived-unpaid";
const ARRIVED_PAID_ID = "appointment-arrived-paid";
const ARRIVED_REFUNDED_ID = "appointment-arrived-refunded";

const excludedPosHistoryKeys = [
  "orders",
  "memberCardTransactions",
  "customerServiceRecords",
  "customerSignatures",
] as const;

const tempDir = mkdtempSync(join(tmpdir(), "beauty-pos-paging-scale-"));
let database: BeautyDatabase | undefined;

try {
  database = new BeautyDatabase(join(tempDir, "pos-paging-scale.sqlite"));

  console.log(
    `正在构造 POS 单店规模数据：${CUSTOMER_COUNT} 客户 / ${PRODUCT_COUNT} 产品 / ${SERVICE_COUNT} 服务 / ${ORDER_COUNT} 订单 / ${SERVICE_RECORD_COUNT} 服务记录 / ${SIGNATURE_COUNT} 签名。`,
  );
  const seed = measure(() => seedScaleDatabase(database!));

  const posKeys = dataKeysForView("pos");
  for (const key of excludedPosHistoryKeys) {
    assert.ok(!posKeys.includes(key), `POS 基础分片不应请求全量 ${key}`);
  }

  const slice = measure(() => database!.readDataTablesForStore(posKeys, STORE_ID));
  assertDuration("POS 基础分片", slice.ms, SLICE_MAX_MS);
  assert.equal(slice.value.customers.length, CUSTOMER_COUNT, "POS 基础分片应包含当前门店客户");
  assert.equal(slice.value.products.length, PRODUCT_COUNT, "POS 基础分片应包含当前门店产品");
  assert.equal(slice.value.services.length, SERVICE_COUNT, "POS 基础分片应包含当前门店服务");
  assert.equal(slice.value.staff.length, STAFF_COUNT, "POS 基础分片应包含当前门店员工");
  assert.equal(slice.value.memberCards.length, MEMBER_CARD_COUNT, "POS 基础分片应包含少量会员卡");
  for (const key of excludedPosHistoryKeys) {
    assert.equal(slice.value[key].length, 0, `readDataTablesForStore 不应把 ${key} 读入 POS 基础分片`);
  }

  const expectedPageCount = Math.ceil(ORDER_COUNT / PAGE_SIZE);
  const middlePageNumber = Math.ceil(expectedPageCount / 2);
  const firstPage = measure(() => database!.readCashierFlowPage(STORE_ID, 1, PAGE_SIZE));
  const middlePage = measure(() => database!.readCashierFlowPage(STORE_ID, middlePageNumber, PAGE_SIZE));
  const lastPage = measure(() => database!.readCashierFlowPage(STORE_ID, expectedPageCount, PAGE_SIZE));

  const measuredPages = [
    { name: "第1页", measurement: firstPage, expectedPage: 1 },
    { name: "中间页", measurement: middlePage, expectedPage: middlePageNumber },
    { name: "末页", measurement: lastPage, expectedPage: expectedPageCount },
  ];
  for (const { name, measurement, expectedPage } of measuredPages) {
    assertDuration(`收银流水${name}`, measurement.ms, PAGE_MAX_MS);
    assertCashierFlowPage(measurement.value, expectedPage, expectedPageCount);
  }

  const sampledItems = measuredPages.flatMap(({ measurement }) => measurement.value.items);
  assert.equal(
    new Set(sampledItems.map((item) => `${item.kind}:${item.id}`)).size,
    sampledItems.length,
    "第1/中/末页抽样不应有重复流水",
  );

  const expectedToday = expectedTodayStats();
  const context = measure(() => database!.readPosContext(STORE_ID, {
    dayStart: DAY_START,
    dayEnd: DAY_END,
    appointmentId: ARRIVED_UNPAID_ID,
    signatureId: signatureId(0),
  }));
  assertDuration("POS 上下文", context.ms, CONTEXT_MAX_MS);
  assert.equal(context.value.cashierFlowTotal, ORDER_COUNT, "POS 上下文应返回正确流水总数");
  assert.equal(context.value.todayOrderCount, expectedToday.orderCount, "POS 上下文应返回正确当日订单数");
  assert.equal(context.value.todayPaid, expectedToday.paid, "POS 上下文应返回正确当日收款");
  assert.equal(context.value.todayMemberCardIncomeCount, 0, "未造会员卡收入流水时当日笔数应为 0");
  assert.deepEqual(
    context.value.arrivedAppointments.map((appointment) => appointment.id),
    [ARRIVED_UNPAID_ID, ARRIVED_REFUNDED_ID],
    "已到店列表应排除已有非退款订单的预约，保留未结账和仅有退款订单的预约",
  );
  assert.ok(context.value.data.appointments.some((appointment) => appointment.id === ARRIVED_UNPAID_ID), "POS 上下文应包含指定预约");
  assert.ok(context.value.data.orders.some((order) => order.id === orderId(0)), "POS 上下文应包含指定签名关联订单");
  assert.ok(context.value.data.customerServiceRecords.some((record) => record.id === serviceRecordId(0)), "POS 上下文应按需返回签名关联服务记录");
  assert.ok(context.value.data.customerSignatures.some((signature) => signature.id === signatureId(0)), "POS 上下文应按需返回指定签名");
  assert.ok(context.value.data.customerSignatures.every((signature) => !signature.signatureText), "POS 上下文不应返回签名图片文本");
  assert.ok(context.value.data.orders.length <= 50, "POS 上下文订单必须保持有界");
  assert.ok(context.value.data.customerServiceRecords.length <= 50, "POS 上下文服务记录必须保持有界");
  assert.ok(context.value.data.customerSignatures.length <= 50, "POS 上下文签名必须保持有界");

  console.log(
    [
      "POS 10万级分页规模验证通过：",
      `seed=${seed.ms.toFixed(1)}ms`,
      `slice=${slice.ms.toFixed(1)}ms`,
      `page1=${firstPage.ms.toFixed(1)}ms/${payloadBytes(firstPage.value)}B`,
      `pageMiddle=${middlePage.ms.toFixed(1)}ms/${payloadBytes(middlePage.value)}B`,
      `pageLast=${lastPage.ms.toFixed(1)}ms/${payloadBytes(lastPage.value)}B`,
      `context=${context.ms.toFixed(1)}ms`,
      `total=${context.value.cashierFlowTotal}`,
    ].join(" "),
  );
} finally {
  database?.close();
  rmSync(tempDir, { force: true, recursive: true });
}

function seedScaleDatabase(target: BeautyDatabase) {
  const data = emptyAppData();
  data.systemConfigs = defaultSystemConfigs();
  data.storeProfiles.push({
    id: STORE_ID,
    name: "POS 分页规模验证门店",
    phone: "13900000000",
    address: "规模验证地址",
    businessHours: "09:00-22:00",
    status: "active",
    createdAt: DAY_START,
  });
  data.authUsers.push({
    id: OWNER_ID,
    storeId: STORE_ID,
    name: "规模验证店主",
    account: "pos-paging-scale@test.local",
    password: "test-password",
    role: "owner",
    roleName: "老板",
    staffId: staffId(0),
    status: "active",
    createdAt: DAY_START,
  });

  for (let index = 0; index < STAFF_COUNT; index += 1) {
    data.staff.push({
      id: staffId(index),
      storeId: STORE_ID,
      name: `规模员工 ${index + 1}`,
      phone: `138${pad(index, 8)}`,
      role: index === 0 ? "主管" : "美容师",
      status: "active",
      accountId: index === 0 ? OWNER_ID : undefined,
      hiredAt: "2026-01-01",
      baseSalary: 6_000,
      commissionRate: 0.1,
    });
  }

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    data.customers.push({
      id: customerId(index),
      storeId: STORE_ID,
      name: `规模客户 ${index + 1}`,
      phone: `139${pad(index, 8)}`,
      level: index < MEMBER_CARD_COUNT ? "VIP" : "普通会员",
      points: index % 500,
      source: "规模验证",
      tags: ["规模客户"],
      lastVisit: orderCreatedAt(index),
    });
  }

  for (let index = 0; index < SERVICE_COUNT; index += 1) {
    data.services.push({
      id: serviceId(index),
      storeId: STORE_ID,
      name: `规模服务 ${index + 1}`,
      category: index % 2 === 0 ? "皮肤管理" : "SPA养生",
      price: 180 + index,
      duration: 60,
      defaultTimes: 1,
      status: "启用",
    });
  }

  for (let index = 0; index < PRODUCT_COUNT; index += 1) {
    data.products.push({
      id: productId(index),
      storeId: STORE_ID,
      name: `规模产品 ${index + 1}`,
      type: index % 3 === 0 ? "consumable" : "sale",
      category: index % 2 === 0 ? "面护类" : "居家类",
      unit: "件",
      price: 39 + index,
      cost: 20 + index,
      stock: 1_000,
      warningStock: 20,
      shelfLifeMonths: 24,
      status: "启用",
    });
  }

  for (let index = 0; index < MEMBER_CARD_COUNT; index += 1) {
    data.memberCards.push({
      id: memberCardId(index),
      storeId: STORE_ID,
      customerId: customerId(index),
      name: `规模储值卡 ${index + 1}`,
      type: "储值卡",
      balance: 10_000,
      remainingTimes: 0,
      expiresAt: "2027-12-31",
      status: "正常",
    });
  }

  data.appointments.push(
    makeAppointment(ARRIVED_UNPAID_ID, "2026-07-17T10:00:00.000Z", "已到店"),
    makeAppointment(ARRIVED_PAID_ID, "2026-07-17T11:00:00.000Z", "已到店"),
    makeAppointment(ARRIVED_REFUNDED_ID, "2026-07-17T12:00:00.000Z", "已到店"),
    makeAppointment("appointment-confirmed", "2026-07-17T13:00:00.000Z", "已确认"),
  );

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const customerIndex = index % CUSTOMER_COUNT;
    const serviceIndex = index % SERVICE_COUNT;
    const productIndex = index % PRODUCT_COUNT;
    const paidAmount = orderPaidAmount(index);
    const createdAt = orderCreatedAt(index);
    data.orders.push({
      id: orderId(index),
      storeId: STORE_ID,
      orderNo: `SCALE-${pad(index, 6)}`,
      customerId: customerId(customerIndex),
      staffId: staffId(index % STAFF_COUNT),
      serviceId: serviceId(serviceIndex),
      serviceIds: [serviceId(serviceIndex)],
      serviceName: `规模服务 ${serviceIndex + 1}`,
      servicePrice: paidAmount - 39,
      productItems: [{
        productId: productId(productIndex),
        productName: `规模产品 ${productIndex + 1}`,
        quantity: 1,
        unitPrice: 39,
        amount: 39,
      }],
      totalAmount: paidAmount,
      paidAmount,
      discountAmount: 0,
      appointmentId: index === 1 ? ARRIVED_PAID_ID : index === 2 ? ARRIVED_REFUNDED_ID : undefined,
      payMethod: orderPayMethod(index),
      cardId: orderPayMethod(index) === "会员卡" ? memberCardId(customerIndex) : undefined,
      status: index === 2 ? "已退款" : "已支付",
      createdAt,
    });
    data.customerServiceRecords.push({
      id: serviceRecordId(index),
      storeId: STORE_ID,
      customerId: customerId(customerIndex),
      staffId: staffId(index % STAFF_COUNT),
      serviceId: serviceId(serviceIndex),
      orderId: orderId(index),
      skinCondition: "规模验证肌肤状态",
      beforeNote: "服务前记录",
      careSteps: "清洁、护理、收尾",
      productsUsed: `规模产品 ${productIndex + 1}`,
      afterNote: "服务后状态稳定",
      customerFeedback: "体验良好",
      nextCareAdvice: "按周期回店护理",
      createdAt,
    });
    data.customerSignatures.push({
      id: signatureId(index),
      storeId: STORE_ID,
      token: `pos-scale-token-${pad(index, 6)}`,
      customerId: customerId(customerIndex),
      serviceRecordId: serviceRecordId(index),
      orderId: orderId(index),
      title: "服务完成确认签名",
      content: "已确认本次服务项目及消费金额。",
      status: "已签名",
      requestedBy: OWNER_ID,
      createdAt,
      signerName: `规模客户 ${customerIndex + 1}`,
      signatureText: "规模测试签名",
      signedAt: createdAt,
    });
  }

  assert.equal(data.orders.length, ORDER_COUNT);
  assert.equal(data.customerServiceRecords.length, SERVICE_RECORD_COUNT);
  assert.equal(data.customerSignatures.length, SIGNATURE_COUNT);
  target.replaceData(data);
}

function makeAppointment(id: string, startAt: string, status: AppData["appointments"][number]["status"]) {
  return {
    id,
    storeId: STORE_ID,
    customerId: customerId(0),
    staffId: staffId(0),
    serviceId: serviceId(0),
    serviceIds: [serviceId(0)],
    startAt,
    endAt: new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString(),
    status,
    note: "POS 分页规模验证预约",
    arrivedAt: status === "已到店" ? startAt : undefined,
  } satisfies AppData["appointments"][number];
}

function assertCashierFlowPage(page: CashierFlowPageResult, expectedPage: number, expectedPageCount: number) {
  assert.equal(page.page, expectedPage, `应返回第 ${expectedPage} 页`);
  assert.equal(page.pageSize, PAGE_SIZE, "收银流水每页不应超过 50 条");
  assert.equal(page.pageCount, expectedPageCount, "收银流水总页数应正确");
  assert.equal(page.totalCount, ORDER_COUNT, "收银流水总数应正确");
  assert.ok(page.items.length <= PAGE_SIZE, "收银流水每页最多 50 条");

  const startIndex = (expectedPage - 1) * PAGE_SIZE;
  const expectedIds = Array.from(
    { length: Math.min(PAGE_SIZE, ORDER_COUNT - startIndex) },
    (_, offset) => orderId(startIndex + offset),
  );
  assert.deepEqual(page.items.map((item) => item.id), expectedIds, `第 ${expectedPage} 页顺序应与 createdAt 倒序一致`);
  assert.ok(page.items.every((item) => item.kind === "order"), "本测试数据的收银流水应全部来自订单");
  assert.equal(new Set(page.items.map((item) => item.id)).size, page.items.length, `第 ${expectedPage} 页不应有重复流水`);
  for (let index = 1; index < page.items.length; index += 1) {
    assert.ok(
      Date.parse(page.items[index - 1].createdAt) >= Date.parse(page.items[index].createdAt),
      `第 ${expectedPage} 页必须按 createdAt 倒序`,
    );
  }
  assert.ok(payloadBytes(page) <= PAGE_MAX_BYTES, `第 ${expectedPage} 页 JSON 应不超过 250KB`);
}

function expectedTodayStats() {
  const startMs = Date.parse(DAY_START);
  const endMs = Date.parse(DAY_END);
  let orderCount = 0;
  let paid = 0;
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const createdAtMs = orderCreatedAtMs(index);
    if (createdAtMs < startMs || createdAtMs >= endMs) continue;
    orderCount += 1;
    if (orderPayMethod(index) !== "会员卡") paid += orderPaidAmount(index);
  }
  return { orderCount, paid };
}

function orderPayMethod(index: number): Order["payMethod"] {
  const customerIndex = index % CUSTOMER_COUNT;
  return customerIndex < MEMBER_CARD_COUNT && index % 2 === 0 ? "会员卡" : "微信";
}

function orderPaidAmount(index: number) {
  return 200 + (index % 100);
}

function orderCreatedAtMs(index: number) {
  return LATEST_ORDER_AT_MS - index * 1_000;
}

function orderCreatedAt(index: number) {
  return new Date(orderCreatedAtMs(index)).toISOString();
}

function orderId(index: number) {
  return `order-${pad(index, 6)}`;
}

function serviceRecordId(index: number) {
  return `service-record-${pad(index, 6)}`;
}

function signatureId(index: number) {
  return `signature-${pad(index, 6)}`;
}

function customerId(index: number) {
  return `customer-${pad(index, 4)}`;
}

function productId(index: number) {
  return `product-${pad(index, 3)}`;
}

function serviceId(index: number) {
  return `service-${pad(index, 3)}`;
}

function staffId(index: number) {
  return `staff-${index + 1}`;
}

function memberCardId(index: number) {
  return `member-card-${pad(index, 2)}`;
}

function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function payloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value));
}

function assertDuration(label: string, actualMs: number, thresholdMs: number) {
  assert.ok(actualMs < thresholdMs, `${label}应小于 ${thresholdMs}ms，实际 ${actualMs.toFixed(1)}ms`);
}

function measure<T>(fn: () => T) {
  const startedAt = performance.now();
  const value = fn();
  return { ms: performance.now() - startedAt, value };
}
