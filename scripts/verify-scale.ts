import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BeautyDatabase } from "../server/database";
import { defaultSystemConfigs } from "../src/domain/business";
import { dataKeysForView, emptyAppData } from "../src/domain/dataSlices";
import type { AppData } from "../src/domain/types";

const STORE_COUNT = 1000;
const TARGET_STORE_INDEX = 500;
const TARGET_STORE_ID = storeId(TARGET_STORE_INDEX);
const now = "2026-06-13T00:00:00.000Z";
const tempDir = mkdtempSync(join(tmpdir(), "beauty-scale-"));
const database = new BeautyDatabase(join(tempDir, "scale.sqlite"));

try {
  const scaleData = makeScaleData(STORE_COUNT);
  const seedMs = measure(() => database.replaceData(scaleData));
  const fullRead = measure(() => database.readData());
  const customersSlice = measure(() => database.readDataTablesForStore(dataKeysForView("customers"), TARGET_STORE_ID));
  const reportsSlice = measure(() => database.readDataTablesForStore(dataKeysForView("reports"), TARGET_STORE_ID));
  const relationSlice = measure(() =>
    database.readDataTablesForStore(["distributors", "referralRelations", "distributionCommissions", "commissionSettlements"], TARGET_STORE_ID),
  );

  assert.equal(fullRead.value.storeProfiles.length, STORE_COUNT, "scale seed should include 1000 stores");
  assert.equal(fullRead.value.customers.length, STORE_COUNT * 6, "scale seed should include six customers per store");
  assert.equal(fullRead.value.orders.length, STORE_COUNT * 3, "scale seed should include three orders per store");

  assertStoreScoped(customersSlice.value, TARGET_STORE_ID);
  assertStoreScoped(reportsSlice.value, TARGET_STORE_ID);
  assert.equal(customersSlice.value.customers.length, 6, "customers slice should only include target store customers");
  assert.equal(customersSlice.value.orders.length, 3, "customers slice should only include target store orders");
  assert.equal(customersSlice.value.storeProfiles.length, 1, "store-scoped slice should include only one store profile");
  assert.ok(customersSlice.value.authUsers.some((user) => user.role === "superadmin"), "store-scoped auth slice should retain platform superadmin");
  assert.ok(!customersSlice.value.customers.some((customer) => customer.storeId !== TARGET_STORE_ID), "customers slice should not leak other stores");

  assert.equal(relationSlice.value.distributors.length, 1, "distributor read should be SQL-scoped to the target store");
  assert.equal(relationSlice.value.referralRelations.length, 1, "referral relation read should be SQL-scoped to the target store");
  assert.equal(relationSlice.value.distributionCommissions.length, 1, "distribution commission read should be SQL-scoped to the target store");
  assert.equal(relationSlice.value.commissionSettlements.length, 2, "commission settlement read should be SQL-scoped to the target store");

  const nextData = {
    ...customersSlice.value,
    customers: [
      ...customersSlice.value.customers,
      {
        id: `${TARGET_STORE_ID}-customer-new`,
        storeId: TARGET_STORE_ID,
        name: "规模写入验证客户",
        phone: "13900009999",
        level: "普通会员",
        points: 0,
        source: "规模验证",
        tags: ["规模验证"],
        lastVisit: now,
      },
    ],
  };
  const scopedWriteMs = measure(() => database.replaceStoreData(TARGET_STORE_ID, nextData)).ms;
  const afterWrite = database.readDataTablesForStore(dataKeysForView("customers"), TARGET_STORE_ID);
  const neighborStore = database.readDataTablesForStore(dataKeysForView("customers"), storeId(TARGET_STORE_INDEX + 1));

  assert.equal(afterWrite.customers.length, 7, "store-scoped write should persist the target store customer");
  assert.ok(afterWrite.customers.some((customer) => customer.id === `${TARGET_STORE_ID}-customer-new`), "target store should contain the new customer");
  assert.equal(neighborStore.customers.length, 6, "store-scoped write should preserve neighboring store customers");
  assert.ok(!neighborStore.customers.some((customer) => customer.id === `${TARGET_STORE_ID}-customer-new`), "store-scoped write should not leak to another store");

  const fullPayloadBytes = Buffer.byteLength(JSON.stringify(fullRead.value));
  const slicePayloadBytes = Buffer.byteLength(JSON.stringify(customersSlice.value));
  assert.ok(slicePayloadBytes * 20 < fullPayloadBytes, "store-scoped customer slice should stay much smaller than full platform data");
  assert.ok(customersSlice.ms < 500, `store-scoped customer slice should stay fast enough locally (${customersSlice.ms.toFixed(1)}ms)`);
  assert.ok(reportsSlice.ms < 800, `store-scoped reports slice should stay fast enough locally (${reportsSlice.ms.toFixed(1)}ms)`);
  assert.ok(scopedWriteMs < 1500, `store-scoped write should avoid full platform rewrite cost (${scopedWriteMs.toFixed(1)}ms)`);

  console.log(
    [
      "1000 门店规模验证通过：",
      `seed=${seedMs.ms.toFixed(1)}ms`,
      `fullRead=${fullRead.ms.toFixed(1)}ms`,
      `customersSlice=${customersSlice.ms.toFixed(1)}ms`,
      `reportsSlice=${reportsSlice.ms.toFixed(1)}ms`,
      `storeWrite=${scopedWriteMs.toFixed(1)}ms`,
      `payload=${slicePayloadBytes}/${fullPayloadBytes} bytes`,
    ].join(" "),
  );
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function measure<T>(fn: () => T) {
  const startedAt = performance.now();
  const value = fn();
  return { ms: performance.now() - startedAt, value };
}

function assertStoreScoped(data: AppData, expectedStoreId: string) {
  assert.ok(data.storeProfiles.every((item) => item.id === expectedStoreId), "storeProfiles should be scoped");
  assert.ok(data.authUsers.every((item) => item.role === "superadmin" || item.storeId === expectedStoreId), "authUsers should be scoped");
  assert.ok(data.staff.every((item) => item.storeId === expectedStoreId), "staff should be scoped");
  assert.ok(data.customers.every((item) => item.storeId === expectedStoreId), "customers should be scoped");
  assert.ok(data.services.every((item) => item.storeId === expectedStoreId), "services should be scoped");
  assert.ok(data.products.every((item) => item.storeId === expectedStoreId), "products should be scoped");
  assert.ok(data.appointments.every((item) => item.storeId === expectedStoreId), "appointments should be scoped");
  assert.ok(data.orders.every((item) => item.storeId === expectedStoreId), "orders should be scoped");
  assert.ok(data.memberCards.every((item) => item.storeId === expectedStoreId), "memberCards should be scoped");
  assert.ok(data.inventoryLogs.every((item) => item.storeId === expectedStoreId), "inventoryLogs should be scoped");
  assert.ok(data.memberCardTransactions.every((item) => item.storeId === expectedStoreId), "memberCardTransactions should be scoped");
  assert.ok(data.dailyCloses.every((item) => item.storeId === expectedStoreId), "dailyCloses should be scoped");
  assert.ok(data.customerServiceRecords.every((item) => item.storeId === expectedStoreId), "customerServiceRecords should be scoped");
  assert.ok(data.customerSignatures.every((item) => item.storeId === expectedStoreId), "customerSignatures should be scoped");
  assert.ok(data.customerFollowUps.every((item) => item.storeId === expectedStoreId), "customerFollowUps should be scoped");
}

function makeScaleData(storeCount: number): AppData {
  const data = emptyAppData();
  data.systemConfigs = defaultSystemConfigs();
  data.authUsers.push({
    id: "scale-superadmin",
    name: "规模平台管理员",
    account: "scale-admin@test.local",
    password: "test-password",
    role: "superadmin",
    roleName: "Admin",
    status: "active",
    createdAt: now,
  });

  for (let index = 1; index <= storeCount; index += 1) {
    appendStoreData(data, index);
  }
  return data;
}

function appendStoreData(data: AppData, index: number) {
  const id = storeId(index);
  const staffA = `${id}-staff-a`;
  const staffB = `${id}-staff-b`;
  const owner = `${id}-owner`;
  const serviceA = `${id}-service-a`;
  const serviceB = `${id}-service-b`;
  const productA = `${id}-product-a`;
  const productB = `${id}-product-b`;
  const distributor = `${id}-distributor`;
  const commissionA = `${id}-commission-1`;
  const distributionCommission = `${id}-distribution-commission`;

  data.storeProfiles.push({ id, name: `规模验证门店 ${index}`, phone: `139${pad(index, 8)}`, address: `规模验证地址 ${index}`, businessHours: "10:00-22:00", status: "active", createdAt: now });
  data.onlineStorefronts.push({ id: `${id}-online`, storeId: id, shareCode: `${id}-share`, status: "启用", headline: `规模验证门店 ${index}`, description: "规模验证线上店铺", enabledServiceIds: [serviceA, serviceB], createdAt: now, updatedAt: now });
  data.authUsers.push({ id: owner, storeId: id, name: `规模店主 ${index}`, account: `${id}@test.local`, password: "test-password", role: "owner", roleName: "老板", status: "active", createdAt: now });
  data.staff.push(
    { id: staffA, storeId: id, name: `规模员工A ${index}`, phone: `138${pad(index, 8)}`, role: "主管", status: "active", accountId: owner, hiredAt: "2026-01-01", baseSalary: 8000, commissionRate: 0.1 },
    { id: staffB, storeId: id, name: `规模员工B ${index}`, phone: `137${pad(index, 8)}`, role: "员工", status: "active", hiredAt: "2026-01-01", baseSalary: 6000, commissionRate: 0.08 },
  );
  data.tagDefinitions.push({ id: `${id}-tag`, storeId: id, name: "规模客户", scope: "客户", color: "#0f766e", status: "启用", createdAt: now });
  data.services.push(
    { id: serviceA, storeId: id, name: "规模护理A", category: "皮肤管理", price: 298, duration: 60, status: "启用" },
    { id: serviceB, storeId: id, name: "规模护理B", category: "SPA养生", price: 398, duration: 90, status: "启用" },
  );
  data.products.push(
    { id: productA, storeId: id, name: "规模耗材A", type: "consumable", category: "面护类", unit: "瓶", price: 99, cost: 40, stock: 100, warningStock: 10, shelfLifeMonths: 24, status: "启用" },
    { id: productB, storeId: id, name: "规模商品B", type: "sale", category: "居家类", unit: "盒", price: 199, cost: 90, stock: 80, warningStock: 8, shelfLifeMonths: 24, status: "启用" },
  );

  for (let customerIndex = 1; customerIndex <= 6; customerIndex += 1) {
    data.customers.push({
      id: `${id}-customer-${customerIndex}`,
      storeId: id,
      name: `规模客户 ${index}-${customerIndex}`,
      phone: `136${pad(index * 10 + customerIndex, 8)}`,
      level: customerIndex === 1 ? "VIP" : "普通会员",
      points: customerIndex * 10,
      source: "规模验证",
      tags: ["规模客户"],
      lastVisit: now,
    });
  }

  data.memberCards.push(
    { id: `${id}-card-a`, storeId: id, customerId: `${id}-customer-1`, name: "规模储值卡", type: "储值卡", balance: 1000, remainingTimes: 0, expiresAt: "2027-12-31", status: "正常" },
    { id: `${id}-card-b`, storeId: id, customerId: `${id}-customer-2`, name: "规模次数卡", type: "次数卡", balance: 0, remainingTimes: 5, expiresAt: "2027-12-31", status: "正常", serviceId: serviceA, serviceIds: [serviceA] },
  );
  data.distributors.push({ id: distributor, type: "客户", customerId: `${id}-customer-1`, name: `规模客户 ${index}-1`, phone: `136${pad(index * 10 + 1, 8)}`, rate: 0.08, status: "启用", inviteCode: `SCALE-${index}`, createdAt: now });
  data.referralRelations.push({ id: `${id}-referral`, distributorId: distributor, customerId: `${id}-customer-2`, source: "手工绑定", status: "有效", createdAt: now });

  for (let orderIndex = 1; orderIndex <= 3; orderIndex += 1) {
    const orderId = `${id}-order-${orderIndex}`;
    data.orders.push({
      id: orderId,
      storeId: id,
      orderNo: `SO-${pad(index, 4)}-${orderIndex}`,
      customerId: `${id}-customer-${orderIndex}`,
      staffId: orderIndex % 2 === 0 ? staffB : staffA,
      serviceId: orderIndex % 2 === 0 ? serviceB : serviceA,
      totalAmount: 298 + orderIndex,
      paidAmount: 298 + orderIndex,
      discountAmount: 0,
      distributorId: orderIndex === 1 ? distributor : undefined,
      payMethod: "微信",
      status: "已支付",
      createdAt: now,
    });
    data.commissions.push({ id: `${id}-commission-${orderIndex}`, staffId: orderIndex % 2 === 0 ? staffB : staffA, orderId, type: "服务提成", baseAmount: 298 + orderIndex, rate: 0.1, amount: 29.8 + orderIndex, status: "待结算", createdAt: now });
  }

  data.distributionCommissions.push({ id: distributionCommission, distributorId: distributor, customerId: `${id}-customer-1`, orderId: `${id}-order-1`, baseAmount: 299, rate: 0.08, amount: 23.92, status: "待结算", createdAt: now });
  data.commissionSettlements.push(
    { id: `${id}-settlement-staff`, type: "员工提成", commissionIds: [commissionA], amount: 30.8, count: 1, createdBy: owner, createdAt: now },
    { id: `${id}-settlement-distribution`, type: "分销佣金", commissionIds: [distributionCommission], amount: 23.92, count: 1, createdBy: owner, createdAt: now },
  );
  data.appointments.push({ id: `${id}-appointment`, storeId: id, customerId: `${id}-customer-1`, staffId: staffA, serviceId: serviceA, startAt: now, endAt: "2026-06-13T01:00:00.000Z", roomName: "护理房 1", status: "已确认", note: "规模验证预约" });
  data.staffShifts.push({ id: `${id}-shift`, storeId: id, staffId: staffA, startAt: now, endAt: "2026-06-13T10:00:00.000Z", note: "规模验证班次", createdBy: owner, createdAt: now });
  data.inventoryLogs.push({ id: `${id}-inventory-log`, storeId: id, productId: productA, type: "入库", delta: 10, stockAfter: 100, note: "规模验证库存", createdAt: now });
  data.memberCardTransactions.push({ id: `${id}-card-transaction`, storeId: id, memberCardId: `${id}-card-a`, orderId: `${id}-order-1`, staffId: staffA, type: "消费", amountDelta: -100, timesDelta: 0, balanceAfter: 900, remainingTimesAfter: 0, note: "规模验证卡项", createdAt: now });
  data.operationLogs.push({ id: `${id}-log`, storeId: id, userId: owner, action: "规模验证", targetType: "store", targetId: id, summary: "规模验证日志", createdAt: now });
  data.notifications.push({ id: `${id}-notification`, storeId: id, title: "规模验证通知", desc: "规模验证", view: "dashboard", targetType: "store", targetId: id, audienceRoles: ["owner"], readByUserIds: [], createdAt: now });
  data.dailyCloses.push({ id: `${id}-daily-close`, storeId: id, businessDate: "2026-06-13", revenue: 897, refundAmount: 0, orderCount: 3, cashAmount: 0, wechatAmount: 897, alipayAmount: 0, cardAmount: 0, memberCardAmount: 0, commissionAmount: 92.4, createdBy: owner, createdAt: now, status: "已锁定" });
  data.approvalRequests.push({ id: `${id}-approval`, storeId: id, type: "改价折扣", targetId: `${id}-order-1`, requestedBy: owner, amount: 10, reason: "规模验证审批", status: "待审批", createdAt: now });
  data.customerServiceRecords.push({ id: `${id}-service-record`, storeId: id, customerId: `${id}-customer-1`, staffId: staffA, serviceId: serviceA, orderId: `${id}-order-1`, skinCondition: "稳定", beforeNote: "规模验证", careSteps: "规模验证", productsUsed: "规模验证", afterNote: "规模验证", customerFeedback: "满意", nextCareAdvice: "按时护理", createdAt: now });
  data.customerSignatures.push({ id: `${id}-signature`, storeId: id, token: `${id}-signature-token`, customerId: `${id}-customer-1`, serviceRecordId: `${id}-service-record`, title: "服务确认", content: "规模验证签名", status: "待签名", requestedBy: owner, createdAt: now });
  data.customerFollowUps.push({ id: `${id}-follow-up`, storeId: id, customerId: `${id}-customer-1`, staffId: staffA, dueAt: "2026-06-14T00:00:00.000Z", method: "微信", note: "规模验证回访", status: "待跟进", createdAt: now });
  data.suppliers.push({ id: `${id}-supplier`, storeId: id, name: "规模供应商", phone: `135${pad(index, 8)}`, contact: "规模联系人", status: "active" });
  data.purchaseOrders.push({ id: `${id}-purchase`, storeId: id, supplierId: `${id}-supplier`, productId: productA, quantity: 10, unitCost: 40, status: "已入库", createdBy: owner, createdAt: now });
  data.stocktakes.push({ id: `${id}-stocktake`, storeId: id, productId: productA, systemStock: 100, actualStock: 100, delta: 0, reason: "规模验证盘点", createdBy: owner, createdAt: now });
}

function storeId(index: number) {
  return `scale-store-${pad(index, 4)}`;
}

function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}
