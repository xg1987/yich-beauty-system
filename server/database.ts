import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedData } from "../src/domain/seed";
import { normalizeSystemConfigs } from "../src/domain/business";
import type {
  AppData,
  ApprovalRequest,
  Appointment,
  AuthUser,
  Commission,
  CommissionSettlement,
  Customer,
  CustomerFollowUp,
  CustomerSignature,
  CustomerServiceRecord,
  DailyClose,
  DistributionCommission,
  Distributor,
  InventoryBatch,
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  MarketingAiRecord,
  OnlineBookingRequest,
  OnlineStorefront,
  OperationLog,
  Order,
  OrderProductItem,
  Product,
  PurchaseOrder,
  ReferralRelation,
  Refund,
  Service,
  ServiceConsumable,
  Staff,
  StaffInvite,
  StaffShift,
  StaffUnavailableSlot,
  SystemConfig,
  StoreOwnerApplication,
  StoreOwnerInvite,
  SystemNotification,
  Stocktake,
  StoreProfile,
  Supplier,
  TagDefinition,
} from "../src/domain/types";

const DEFAULT_DB_PATH = resolve("data/yich-system.sqlite");

type TableName = keyof AppData;

const tableNames: TableName[] = [
  "storeProfiles",
  "onlineStorefronts",
  "authUsers",
  "systemConfigs",
  "staffInvites",
  "storeOwnerInvites",
  "storeOwnerApplications",
  "staff",
  "customers",
  "tagDefinitions",
  "services",
  "products",
  "inventoryBatches",
  "appointments",
  "onlineBookingRequests",
  "staffUnavailableSlots",
  "staffShifts",
  "memberCards",
  "distributors",
  "referralRelations",
  "orders",
  "refunds",
  "commissions",
  "distributionCommissions",
  "commissionSettlements",
  "inventoryLogs",
  "memberCardTransactions",
  "operationLogs",
  "marketingAiRecords",
  "notifications",
  "dailyCloses",
  "approvalRequests",
  "customerServiceRecords",
  "customerSignatures",
  "customerFollowUps",
  "suppliers",
  "purchaseOrders",
  "stocktakes",
];

export class BeautyDatabase {
  private db: DatabaseSync;

  constructor(dbPath = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  reset() {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      for (const tableName of [...tableNames].reverse()) {
        this.db.prepare(`DELETE FROM ${tableName}`).run();
      }
      this.writeData(seedData);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  seedIfEmpty() {
    const authRow = this.db.prepare("SELECT COUNT(*) AS count FROM authUsers").get() as { count: number };
    if (authRow.count === 0) {
      this.replaceData(seedData);
      this.ensureDefaultSuperadmin();
      return;
    }
    this.ensureDefaultSuperadmin();
  }

  readData(): AppData {
    return {
      storeProfiles: this.db.prepare("SELECT payload_json FROM storeProfiles ORDER BY rowid ASC").all().map(mapJsonPayload<StoreProfile>),
      onlineStorefronts: this.db.prepare("SELECT payload_json FROM onlineStorefronts ORDER BY rowid ASC").all().map(mapJsonPayload<OnlineStorefront>),
      authUsers: this.db.prepare("SELECT payload_json FROM authUsers ORDER BY rowid ASC").all().map(mapJsonPayload<AuthUser>),
      systemConfigs: normalizeSystemConfigs(this.db.prepare("SELECT payload_json FROM systemConfigs ORDER BY rowid ASC").all().map(mapJsonPayload<SystemConfig>)),
      staffInvites: this.db.prepare("SELECT payload_json FROM staffInvites ORDER BY rowid DESC").all().map(mapJsonPayload<StaffInvite>),
      storeOwnerInvites: this.db.prepare("SELECT payload_json FROM storeOwnerInvites ORDER BY rowid DESC").all().map(mapJsonPayload<StoreOwnerInvite>),
      storeOwnerApplications: this.db.prepare("SELECT payload_json FROM storeOwnerApplications ORDER BY rowid DESC").all().map(mapJsonPayload<StoreOwnerApplication>),
      staff: this.db.prepare("SELECT * FROM staff ORDER BY rowid ASC").all().map(mapStaff),
      customers: this.db.prepare("SELECT * FROM customers ORDER BY rowid ASC").all().map(mapCustomer),
      tagDefinitions: this.db.prepare("SELECT payload_json FROM tagDefinitions ORDER BY rowid ASC").all().map(mapJsonPayload<TagDefinition>),
      services: this.db.prepare("SELECT * FROM services ORDER BY rowid ASC").all().map(mapService),
      products: this.db.prepare("SELECT * FROM products ORDER BY rowid ASC").all().map(mapProduct),
      inventoryBatches: this.db.prepare("SELECT payload_json FROM inventoryBatches ORDER BY rowid DESC").all().map(mapJsonPayload<InventoryBatch>),
      appointments: this.db.prepare("SELECT * FROM appointments ORDER BY rowid ASC").all().map(mapAppointment),
      onlineBookingRequests: this.db.prepare("SELECT payload_json FROM onlineBookingRequests ORDER BY rowid DESC").all().map(mapJsonPayload<OnlineBookingRequest>),
      staffUnavailableSlots: this.db
        .prepare("SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC")
        .all()
        .map(mapStaffUnavailableSlot),
      staffShifts: this.db.prepare("SELECT payload_json FROM staffShifts ORDER BY rowid DESC").all().map(mapJsonPayload<StaffShift>),
      memberCards: this.db.prepare("SELECT * FROM memberCards ORDER BY rowid ASC").all().map(mapMemberCard),
      distributors: this.db.prepare("SELECT payload_json FROM distributors ORDER BY rowid DESC").all().map(mapJsonPayload<Distributor>),
      referralRelations: this.db.prepare("SELECT payload_json FROM referralRelations ORDER BY rowid DESC").all().map(mapJsonPayload<ReferralRelation>),
      orders: this.db.prepare("SELECT * FROM orders ORDER BY rowid DESC").all().map(mapOrder),
      refunds: this.db.prepare("SELECT * FROM refunds ORDER BY rowid DESC").all().map(mapRefund),
      commissions: this.db.prepare("SELECT * FROM commissions ORDER BY rowid DESC").all().map(mapCommission),
      distributionCommissions: this.db.prepare("SELECT payload_json FROM distributionCommissions ORDER BY rowid DESC").all().map(mapJsonPayload<DistributionCommission>),
      commissionSettlements: this.db.prepare("SELECT payload_json FROM commissionSettlements ORDER BY rowid DESC").all().map(mapJsonPayload<CommissionSettlement>),
      inventoryLogs: this.db.prepare("SELECT * FROM inventoryLogs ORDER BY rowid DESC").all().map(mapInventoryLog),
      memberCardTransactions: this.db
        .prepare("SELECT * FROM memberCardTransactions ORDER BY rowid DESC")
        .all()
        .map(mapMemberCardTransaction),
      operationLogs: this.db.prepare("SELECT * FROM operationLogs ORDER BY rowid DESC").all().map(mapOperationLog),
      marketingAiRecords: this.db.prepare("SELECT payload_json FROM marketingAiRecords ORDER BY rowid DESC").all().map(mapJsonPayload<MarketingAiRecord>),
      notifications: this.db.prepare("SELECT payload_json FROM notifications ORDER BY rowid DESC").all().map(mapJsonPayload<SystemNotification>),
      dailyCloses: this.db.prepare("SELECT * FROM dailyCloses ORDER BY businessDate DESC").all().map(mapDailyClose),
      approvalRequests: this.db.prepare("SELECT payload_json FROM approvalRequests ORDER BY rowid DESC").all().map(mapJsonPayload<ApprovalRequest>),
      customerServiceRecords: this.db
        .prepare("SELECT payload_json FROM customerServiceRecords ORDER BY rowid DESC")
        .all()
        .map(mapJsonPayload<CustomerServiceRecord>),
      customerSignatures: this.db.prepare("SELECT payload_json FROM customerSignatures ORDER BY rowid DESC").all().map(mapJsonPayload<CustomerSignature>),
      customerFollowUps: this.db.prepare("SELECT payload_json FROM customerFollowUps ORDER BY rowid DESC").all().map(mapJsonPayload<CustomerFollowUp>),
      suppliers: this.db.prepare("SELECT payload_json FROM suppliers ORDER BY rowid DESC").all().map(mapJsonPayload<Supplier>),
      purchaseOrders: this.db.prepare("SELECT payload_json FROM purchaseOrders ORDER BY rowid DESC").all().map(mapJsonPayload<PurchaseOrder>),
      stocktakes: this.db.prepare("SELECT payload_json FROM stocktakes ORDER BY rowid DESC").all().map(mapJsonPayload<Stocktake>),
    };
  }

  readDataTables(keys: readonly TableName[]): AppData {
    const data = emptyData();
    for (const key of Array.from(new Set(keys))) {
      data[key] = this.readTable(key) as never;
    }
    data.systemConfigs = normalizeSystemConfigs(data.systemConfigs);
    return data;
  }

  readDataTablesForStore(keys: readonly TableName[], storeId: string): AppData {
    const data = emptyData();
    for (const key of Array.from(new Set(keys))) {
      data[key] = this.readTableForStore(key, storeId) as never;
    }
    data.systemConfigs = normalizeSystemConfigs(data.systemConfigs);
    return data;
  }

  replaceData(data: AppData) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      for (const tableName of [...tableNames].reverse()) {
        this.db.prepare(`DELETE FROM ${tableName}`).run();
      }
      this.writeData(data);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  replaceStoreData(storeId: string, data: AppData) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.deleteStoreData(storeId);
      this.writeData(dataForStoreWrite(data, storeId));
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  reserveCheckoutSubmission(id: string, createdAt: string) {
    const cutoff = new Date(Date.parse(createdAt) - 10 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM checkoutSubmissionLocks WHERE createdAt < ?").run(cutoff);
    const result = this.db.prepare("INSERT OR IGNORE INTO checkoutSubmissionLocks (id, createdAt) VALUES (?, ?)").run(id, createdAt) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  acquireAiGenerationLocks(input: { ownerId: string; kind: string; createdAt: string; expiresAt: string; maxGlobalSlots: number }) {
    this.ensureAiGenerationLocks();
    this.db.prepare("DELETE FROM aiGenerationLocks WHERE expiresAt < ?").run(input.createdAt);

    const accountLockId = `account:${input.kind}:${input.ownerId}`;
    const accountResult = this.db
      .prepare("INSERT OR IGNORE INTO aiGenerationLocks (id, scope, ownerId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(accountLockId, "account", input.ownerId, input.kind, input.createdAt, input.expiresAt) as { changes?: number };
    if ((accountResult.changes ?? 0) <= 0) {
      throw new Error("当前账号已有图片生成正在进行，请等待完成后再试。");
    }

    for (let slot = 0; slot < input.maxGlobalSlots; slot += 1) {
      const globalLockId = `global:${input.kind}:${slot}`;
      const globalResult = this.db
        .prepare("INSERT OR IGNORE INTO aiGenerationLocks (id, scope, ownerId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run(globalLockId, "global", input.ownerId, input.kind, input.createdAt, input.expiresAt) as { changes?: number };
      if ((globalResult.changes ?? 0) > 0) {
        return { accountLockId, globalLockId };
      }
    }

    this.db.prepare("DELETE FROM aiGenerationLocks WHERE id = ?").run(accountLockId);
    throw new Error("当前图片生成请求较多，请稍后再试。");
  }

  releaseAiGenerationLocks(lockIds: { accountLockId?: string; globalLockId?: string }) {
    this.ensureAiGenerationLocks();
    [lockIds.accountLockId, lockIds.globalLockId].filter((id): id is string => Boolean(id)).forEach((id) => {
      this.db.prepare("DELETE FROM aiGenerationLocks WHERE id = ?").run(id);
    });
  }

  appendMarketingAiResult(input: { record: MarketingAiRecord; log: OperationLog; consumeCreditUserId?: string }) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("INSERT OR REPLACE INTO marketingAiRecords (id, payload_json) VALUES (?, ?)").run(input.record.id, JSON.stringify(input.record));
      this.db
        .prepare("INSERT OR REPLACE INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.log.id, input.log.storeId ?? null, input.log.userId, input.log.action, input.log.targetType, input.log.targetId, input.log.summary, input.log.createdAt);
      if (input.consumeCreditUserId) {
        this.db
          .prepare("UPDATE authUsers SET payload_json = json_set(payload_json, '$.aiCredits', MAX(0, COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS INTEGER), 0) - 1)) WHERE id = ? AND COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS INTEGER), 0) > 0")
          .run(input.consumeCreditUserId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private writeData(data: AppData) {
    this.writeJsonTable("storeProfiles", data.storeProfiles);
    this.writeJsonTable("onlineStorefronts", data.onlineStorefronts);
    this.writeJsonTable("authUsers", data.authUsers);
    this.writeJsonTable("systemConfigs", data.systemConfigs);
    this.writeJsonTable("staffInvites", data.staffInvites);
    this.writeJsonTable("storeOwnerInvites", data.storeOwnerInvites ?? []);
    this.writeJsonTable("storeOwnerApplications", data.storeOwnerApplications ?? []);

    for (const staff of data.staff) {
      this.db
        .prepare("INSERT INTO staff (id, storeId, name, phone, role, status, accountId, hiredAt, baseSalary, commissionRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          staff.id,
          staff.storeId ?? null,
          staff.name,
          staff.phone,
          staff.role,
          staff.status,
          staff.accountId ?? null,
          staff.hiredAt ?? null,
          staff.baseSalary ?? null,
          staff.commissionRate ?? null,
        );
    }

    for (const customer of data.customers) {
      this.db
        .prepare("INSERT INTO customers (id, storeId, name, phone, level, points, birthday, nextFollowUpAt, note, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          customer.id,
          customer.storeId ?? null,
          customer.name,
          customer.phone,
          customer.level,
          customer.points ?? 0,
          customer.birthday ?? null,
          customer.nextFollowUpAt ?? null,
          customer.note ?? null,
          customer.source,
          JSON.stringify(customer.tags),
          customer.lastVisit,
        );
    }

    this.writeJsonTable("tagDefinitions", data.tagDefinitions);

    for (const service of data.services) {
      this.db
        .prepare(
          "INSERT INTO services (id, storeId, name, category, subcategory, price, duration, defaultTimes, consumables_json, consumableProductId, consumableQty, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          service.id,
          service.storeId ?? null,
          service.name,
          service.category,
          service.subcategory ?? null,
          service.price,
          service.duration,
          service.defaultTimes ?? 1,
          JSON.stringify(service.consumables ?? []),
          service.consumableProductId ?? null,
          service.consumableQty ?? null,
          service.status ?? "启用",
        );
    }

    for (const product of data.products) {
      this.db
        .prepare("INSERT INTO products (id, storeId, name, type, category, subcategory, unit, price, cost, stock, warningStock, shelfLifeMonths, expiryAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          product.id,
          product.storeId ?? null,
          product.name,
          product.type,
          product.category ?? null,
          product.subcategory ?? null,
          product.unit,
          product.price,
          product.cost,
          product.stock,
          product.warningStock,
          product.shelfLifeMonths ?? null,
          product.expiryAt ?? null,
          product.status ?? "启用",
        );
    }

    this.writeJsonTable("inventoryBatches", data.inventoryBatches ?? []);

    for (const appointment of data.appointments) {
      this.db
        .prepare(
          "INSERT INTO appointments (id, storeId, customerId, staffId, serviceId, serviceIds_json, startAt, endAt, roomName, status, note, arrivedAt, completedAt, canceledAt, cancelReason, noShowAt, rescheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          appointment.id,
          appointment.storeId ?? null,
          appointment.customerId,
          appointment.staffId,
          appointment.serviceId,
          JSON.stringify(appointment.serviceIds?.length ? appointment.serviceIds : [appointment.serviceId]),
          appointment.startAt,
          appointment.endAt ?? null,
          appointment.roomName ?? null,
          appointment.status,
          appointment.note,
          appointment.arrivedAt ?? null,
          appointment.completedAt ?? null,
          appointment.canceledAt ?? null,
          appointment.cancelReason ?? null,
          appointment.noShowAt ?? null,
          appointment.rescheduledAt ?? null,
          appointment.updatedAt ?? null,
        );
    }

    this.writeJsonTable("onlineBookingRequests", data.onlineBookingRequests);

    for (const slot of data.staffUnavailableSlots) {
      this.db
        .prepare(
          "INSERT INTO staffUnavailableSlots (id, storeId, staffId, startAt, endAt, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(slot.id, slot.storeId ?? null, slot.staffId, slot.startAt, slot.endAt, slot.reason, slot.createdBy, slot.createdAt);
    }

    this.writeJsonTable("staffShifts", data.staffShifts);

    for (const card of data.memberCards) {
      this.db
        .prepare(
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json, serviceEntitlements_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          card.id,
          card.storeId ?? null,
          card.customerId,
          card.name,
          card.type,
          card.balance,
          card.remainingTimes,
          card.discountRate ?? null,
          card.pointsEarned ?? 0,
          card.benefitText ?? null,
          card.expiresAt,
          card.status,
          card.serviceId ?? null,
          JSON.stringify(card.serviceIds ?? []),
          card.serviceEntitlements?.length ? JSON.stringify(card.serviceEntitlements) : null,
        );
    }

    this.writeJsonTable("distributors", data.distributors);
    this.writeJsonTable("referralRelations", data.referralRelations);

    for (const order of data.orders) {
      this.db
        .prepare(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceName, servicePrice, serviceConsumables_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          order.id,
          order.storeId ?? null,
          order.orderNo,
          order.customerId,
          order.guestName ?? null,
          order.guestPhone ?? null,
          order.staffId,
          order.serviceId,
          order.serviceName ?? null,
          order.servicePrice ?? null,
          order.serviceConsumables?.length ? JSON.stringify(order.serviceConsumables) : null,
          order.productId ?? null,
          order.giftProductId ?? null,
          order.productItems?.length ? JSON.stringify(order.productItems) : null,
          order.giftProductItems?.length ? JSON.stringify(order.giftProductItems) : null,
          order.cardId ?? null,
          order.totalAmount,
          order.paidAmount,
          order.discountAmount ?? 0,
          order.adjustmentReason ?? null,
          order.approvalId ?? null,
          order.distributorId ?? null,
          order.appointmentId ?? null,
          order.payMethod,
          order.status,
          order.createdAt,
        );
    }

    for (const refund of data.refunds) {
      this.db
        .prepare("INSERT INTO refunds (id, storeId, orderId, amount, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(refund.id, refund.storeId ?? null, refund.orderId, refund.amount, refund.reason, refund.createdBy, refund.createdAt);
    }

    for (const commission of data.commissions) {
      this.db
        .prepare(
          "INSERT INTO commissions (id, staffId, orderId, type, baseAmount, rate, amount, status, createdAt, settledAt, settlementId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          commission.id,
          commission.staffId,
          commission.orderId,
          commission.type,
          commission.baseAmount,
          commission.rate ?? 0,
          commission.amount,
          commission.status,
          commission.createdAt,
          commission.settledAt ?? null,
          commission.settlementId ?? null,
        );
    }

    this.writeJsonTable("distributionCommissions", data.distributionCommissions);
    this.writeJsonTable("commissionSettlements", data.commissionSettlements);

    for (const log of data.inventoryLogs) {
      this.db
        .prepare(
          "INSERT INTO inventoryLogs (id, storeId, productId, type, delta, stockAfter, note, expiryAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(log.id, log.storeId ?? null, log.productId, log.type, log.delta, log.stockAfter, log.note, log.expiryAt ?? null, log.createdAt);
    }

    for (const transaction of data.memberCardTransactions) {
      this.db
        .prepare(
          "INSERT INTO memberCardTransactions (id, storeId, memberCardId, orderId, staffId, type, paidAmount, payMethod, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          transaction.id,
          transaction.storeId ?? null,
          transaction.memberCardId,
          transaction.orderId ?? null,
          transaction.staffId ?? null,
          transaction.type,
          transaction.paidAmount ?? null,
          transaction.payMethod ?? null,
          transaction.amountDelta,
          transaction.timesDelta,
          transaction.balanceAfter,
          transaction.remainingTimesAfter,
          transaction.note,
          transaction.createdAt,
        );
    }

    for (const log of data.operationLogs) {
      this.db
        .prepare(
          "INSERT INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(log.id, log.storeId ?? null, log.userId, log.action, log.targetType, log.targetId, log.summary, log.createdAt);
    }

    this.writeJsonTable("notifications", data.notifications ?? []);

    for (const close of data.dailyCloses) {
      this.db
        .prepare(
          "INSERT INTO dailyCloses (id, storeId, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount, cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          close.id,
          close.storeId ?? null,
          close.businessDate,
          close.revenue,
          close.refundAmount,
          close.orderCount,
          close.cashAmount,
          close.wechatAmount,
          close.alipayAmount,
          close.cardAmount,
          close.memberCardAmount,
          close.commissionAmount,
          close.createdBy,
          close.createdAt,
          close.status ?? "已锁定",
          close.reversedBy ?? null,
          close.reversedAt ?? null,
        );
    }

    this.writeJsonTable("approvalRequests", data.approvalRequests);
    this.writeJsonTable("customerServiceRecords", data.customerServiceRecords);
    this.writeJsonTable("customerSignatures", data.customerSignatures ?? []);
    this.writeJsonTable("customerFollowUps", data.customerFollowUps);
    this.writeJsonTable("marketingAiRecords", data.marketingAiRecords ?? []);
    this.writeJsonTable("suppliers", data.suppliers);
    this.writeJsonTable("purchaseOrders", data.purchaseOrders);
    this.writeJsonTable("stocktakes", data.stocktakes);
  }

  private writeJsonTable(tableName: string, rows: Array<{ id: string }>) {
    for (const row of rows) {
      this.db.prepare(`INSERT INTO ${tableName} (id, payload_json) VALUES (?, ?)`).run(row.id, JSON.stringify(row));
    }
  }

  private deleteStoreData(storeId: string) {
    const deleteJsonStoreRows = (tableName: string) => {
      this.db.prepare(`DELETE FROM ${tableName} WHERE json_extract(payload_json, '$.storeId') = ?`).run(storeId);
    };
    const deleteTableStoreRows = (tableName: string) => {
      this.db.prepare(`DELETE FROM ${tableName} WHERE storeId = ?`).run(storeId);
    };

    this.db
      .prepare(
        `DELETE FROM commissionSettlements
         WHERE EXISTS (
           SELECT 1 FROM json_each(commissionSettlements.payload_json, '$.commissionIds') AS commissionId
           JOIN commissions ON commissions.id = commissionId.value
           WHERE commissions.staffId IN (SELECT id FROM staff WHERE storeId = ?)
              OR commissions.orderId IN (SELECT id FROM orders WHERE storeId = ?)
         )`,
      )
      .run(storeId, storeId);
    this.db
      .prepare("DELETE FROM commissions WHERE staffId IN (SELECT id FROM staff WHERE storeId = ?) OR orderId IN (SELECT id FROM orders WHERE storeId = ?)")
      .run(storeId, storeId);
    this.db
      .prepare(
        `DELETE FROM distributionCommissions
         WHERE json_extract(payload_json, '$.distributorId') IN (
           SELECT distributors.id
           FROM distributors
           WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
         )
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)`,
      )
      .run(storeId, storeId, storeId, storeId);
    this.db
      .prepare(
        `DELETE FROM referralRelations
         WHERE json_extract(payload_json, '$.distributorId') IN (
           SELECT distributors.id
           FROM distributors
           WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
         )
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)`,
      )
      .run(storeId, storeId, storeId);
    this.db
      .prepare(
        `DELETE FROM distributors
         WHERE json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
      )
      .run(storeId, storeId);

    deleteJsonStoreRows("stocktakes");
    deleteJsonStoreRows("purchaseOrders");
    deleteJsonStoreRows("suppliers");
    deleteJsonStoreRows("customerFollowUps");
    deleteJsonStoreRows("marketingAiRecords");
    deleteJsonStoreRows("customerSignatures");
    deleteJsonStoreRows("customerServiceRecords");
    deleteJsonStoreRows("approvalRequests");
    deleteTableStoreRows("dailyCloses");
    deleteJsonStoreRows("notifications");
    deleteTableStoreRows("operationLogs");
    deleteTableStoreRows("memberCardTransactions");
    deleteTableStoreRows("inventoryLogs");
    deleteTableStoreRows("refunds");
    deleteTableStoreRows("orders");
    deleteTableStoreRows("memberCards");
    deleteJsonStoreRows("staffShifts");
    deleteTableStoreRows("staffUnavailableSlots");
    deleteJsonStoreRows("onlineBookingRequests");
    deleteTableStoreRows("appointments");
    deleteJsonStoreRows("inventoryBatches");
    deleteTableStoreRows("products");
    deleteTableStoreRows("services");
    deleteJsonStoreRows("tagDefinitions");
    deleteTableStoreRows("customers");
    deleteTableStoreRows("staff");
    deleteJsonStoreRows("staffInvites");
    deleteJsonStoreRows("storeOwnerApplications");
    deleteJsonStoreRows("onlineStorefronts");
    this.db.prepare("DELETE FROM authUsers WHERE json_extract(payload_json, '$.storeId') = ?").run(storeId);
    this.db.prepare("DELETE FROM storeProfiles WHERE id = ?").run(storeId);
  }

  private all<T>(query: string, mapper: (row: unknown) => T, values: Array<string | number | null> = []) {
    return this.db.prepare(query).all(...values).map(mapper);
  }

  private readTable(key: TableName) {
    switch (key) {
      case "storeProfiles":
        return this.all("SELECT payload_json FROM storeProfiles ORDER BY rowid ASC", mapJsonPayload<StoreProfile>);
      case "onlineStorefronts":
        return this.all("SELECT payload_json FROM onlineStorefronts ORDER BY rowid ASC", mapJsonPayload<OnlineStorefront>);
      case "authUsers":
        return this.all("SELECT payload_json FROM authUsers ORDER BY rowid ASC", mapJsonPayload<AuthUser>);
      case "systemConfigs":
        return this.all("SELECT payload_json FROM systemConfigs ORDER BY rowid ASC", mapJsonPayload<SystemConfig>);
      case "staffInvites":
        return this.all("SELECT payload_json FROM staffInvites ORDER BY rowid DESC", mapJsonPayload<StaffInvite>);
      case "storeOwnerInvites":
        return this.all("SELECT payload_json FROM storeOwnerInvites ORDER BY rowid DESC", mapJsonPayload<StoreOwnerInvite>);
      case "storeOwnerApplications":
        return this.all("SELECT payload_json FROM storeOwnerApplications ORDER BY rowid DESC", mapJsonPayload<StoreOwnerApplication>);
      case "staff":
        return this.all("SELECT * FROM staff ORDER BY rowid ASC", mapStaff);
      case "customers":
        return this.all("SELECT * FROM customers ORDER BY rowid ASC", mapCustomer);
      case "tagDefinitions":
        return this.all("SELECT payload_json FROM tagDefinitions ORDER BY rowid ASC", mapJsonPayload<TagDefinition>);
      case "services":
        return this.all("SELECT * FROM services ORDER BY rowid ASC", mapService);
      case "products":
        return this.all("SELECT * FROM products ORDER BY rowid ASC", mapProduct);
      case "inventoryBatches":
        return this.all("SELECT payload_json FROM inventoryBatches ORDER BY rowid DESC", mapJsonPayload<InventoryBatch>);
      case "appointments":
        return this.all("SELECT * FROM appointments ORDER BY rowid ASC", mapAppointment);
      case "onlineBookingRequests":
        return this.all("SELECT payload_json FROM onlineBookingRequests ORDER BY rowid DESC", mapJsonPayload<OnlineBookingRequest>);
      case "staffUnavailableSlots":
        return this.all("SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC", mapStaffUnavailableSlot);
      case "staffShifts":
        return this.all("SELECT payload_json FROM staffShifts ORDER BY rowid DESC", mapJsonPayload<StaffShift>);
      case "memberCards":
        return this.all("SELECT * FROM memberCards ORDER BY rowid ASC", mapMemberCard);
      case "distributors":
        return this.all("SELECT payload_json FROM distributors ORDER BY rowid DESC", mapJsonPayload<Distributor>);
      case "referralRelations":
        return this.all("SELECT payload_json FROM referralRelations ORDER BY rowid DESC", mapJsonPayload<ReferralRelation>);
      case "orders":
        return this.all("SELECT * FROM orders ORDER BY rowid DESC", mapOrder);
      case "refunds":
        return this.all("SELECT * FROM refunds ORDER BY rowid DESC", mapRefund);
      case "commissions":
        return this.all("SELECT * FROM commissions ORDER BY rowid DESC", mapCommission);
      case "distributionCommissions":
        return this.all("SELECT payload_json FROM distributionCommissions ORDER BY rowid DESC", mapJsonPayload<DistributionCommission>);
      case "commissionSettlements":
        return this.all("SELECT payload_json FROM commissionSettlements ORDER BY rowid DESC", mapJsonPayload<CommissionSettlement>);
      case "inventoryLogs":
        return this.all("SELECT * FROM inventoryLogs ORDER BY rowid DESC", mapInventoryLog);
      case "memberCardTransactions":
        return this.all("SELECT * FROM memberCardTransactions ORDER BY rowid DESC", mapMemberCardTransaction);
      case "operationLogs":
        return this.all("SELECT * FROM operationLogs ORDER BY rowid DESC", mapOperationLog);
      case "marketingAiRecords":
        return this.all("SELECT payload_json FROM marketingAiRecords ORDER BY rowid DESC", mapJsonPayload<MarketingAiRecord>);
      case "notifications":
        return this.all("SELECT payload_json FROM notifications ORDER BY rowid DESC", mapJsonPayload<SystemNotification>);
      case "dailyCloses":
        return this.all("SELECT * FROM dailyCloses ORDER BY businessDate DESC", mapDailyClose);
      case "approvalRequests":
        return this.all("SELECT payload_json FROM approvalRequests ORDER BY rowid DESC", mapJsonPayload<ApprovalRequest>);
      case "customerServiceRecords":
        return this.all("SELECT payload_json FROM customerServiceRecords ORDER BY rowid DESC", mapJsonPayload<CustomerServiceRecord>);
      case "customerSignatures":
        return this.all("SELECT payload_json FROM customerSignatures ORDER BY rowid DESC", mapJsonPayload<CustomerSignature>);
      case "customerFollowUps":
        return this.all("SELECT payload_json FROM customerFollowUps ORDER BY rowid DESC", mapJsonPayload<CustomerFollowUp>);
      case "suppliers":
        return this.all("SELECT payload_json FROM suppliers ORDER BY rowid DESC", mapJsonPayload<Supplier>);
      case "purchaseOrders":
        return this.all("SELECT payload_json FROM purchaseOrders ORDER BY rowid DESC", mapJsonPayload<PurchaseOrder>);
      case "stocktakes":
        return this.all("SELECT payload_json FROM stocktakes ORDER BY rowid DESC", mapJsonPayload<Stocktake>);
    }
  }

  private readTableForStore(key: TableName, storeId: string) {
    const jsonStoreRows = <T>(tableName: string, mapper: (row: unknown) => T, order = "rowid DESC") =>
      this.all(`SELECT payload_json FROM ${tableName} WHERE json_extract(payload_json, '$.storeId') = ? ORDER BY ${order}`, mapper, [storeId]);
    const tableStoreRows = <T>(tableName: string, mapper: (row: unknown) => T, order = "rowid DESC") =>
      this.all(`SELECT * FROM ${tableName} WHERE storeId = ? ORDER BY ${order}`, mapper, [storeId]);

    switch (key) {
      case "storeProfiles":
        return this.all("SELECT payload_json FROM storeProfiles WHERE id = ? ORDER BY rowid ASC", mapJsonPayload<StoreProfile>, [storeId]);
      case "onlineStorefronts":
        return jsonStoreRows("onlineStorefronts", mapJsonPayload<OnlineStorefront>, "rowid ASC");
      case "authUsers":
        return this.all(
          "SELECT payload_json FROM authUsers WHERE json_extract(payload_json, '$.role') = 'superadmin' OR json_extract(payload_json, '$.storeId') = ? ORDER BY rowid ASC",
          mapJsonPayload<AuthUser>,
          [storeId],
        );
      case "systemConfigs":
        return this.readTable(key);
      case "staffInvites":
        return jsonStoreRows("staffInvites", mapJsonPayload<StaffInvite>);
      case "storeOwnerInvites":
        return [] as StoreOwnerInvite[];
      case "storeOwnerApplications":
        return jsonStoreRows("storeOwnerApplications", mapJsonPayload<StoreOwnerApplication>);
      case "staff":
        return tableStoreRows("staff", mapStaff, "rowid ASC");
      case "customers":
        return tableStoreRows("customers", mapCustomer, "rowid ASC");
      case "tagDefinitions":
        return jsonStoreRows("tagDefinitions", mapJsonPayload<TagDefinition>, "rowid ASC");
      case "services":
        return tableStoreRows("services", mapService, "rowid ASC");
      case "products":
        return tableStoreRows("products", mapProduct, "rowid ASC");
      case "inventoryBatches":
        return jsonStoreRows("inventoryBatches", mapJsonPayload<InventoryBatch>);
      case "appointments":
        return tableStoreRows("appointments", mapAppointment, "rowid ASC");
      case "onlineBookingRequests":
        return jsonStoreRows("onlineBookingRequests", mapJsonPayload<OnlineBookingRequest>);
      case "staffUnavailableSlots":
        return tableStoreRows("staffUnavailableSlots", mapStaffUnavailableSlot, "startAt ASC");
      case "staffShifts":
        return jsonStoreRows("staffShifts", mapJsonPayload<StaffShift>);
      case "memberCards":
        return tableStoreRows("memberCards", mapMemberCard, "rowid ASC");
      case "distributors":
        return this.all(
          `SELECT payload_json FROM distributors
           WHERE json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapJsonPayload<Distributor>,
          [storeId, storeId],
        );
      case "referralRelations":
        return this.all(
          `SELECT payload_json FROM referralRelations
           WHERE json_extract(payload_json, '$.distributorId') IN (
             SELECT distributors.id
             FROM distributors
             WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
           )
              OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapJsonPayload<ReferralRelation>,
          [storeId, storeId, storeId],
        );
      case "orders":
        return tableStoreRows("orders", mapOrder);
      case "refunds":
        return tableStoreRows("refunds", mapRefund);
      case "commissions":
        return this.all(
          "SELECT commissions.* FROM commissions JOIN staff ON staff.id = commissions.staffId WHERE staff.storeId = ? ORDER BY commissions.rowid DESC",
          mapCommission,
          [storeId],
        );
      case "distributionCommissions":
        return this.all(
          `SELECT payload_json FROM distributionCommissions
           WHERE json_extract(payload_json, '$.distributorId') IN (
             SELECT distributors.id
             FROM distributors
             WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
           )
              OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapJsonPayload<DistributionCommission>,
          [storeId, storeId, storeId, storeId],
        );
      case "commissionSettlements":
        return this.all(
          `SELECT payload_json FROM commissionSettlements
           WHERE EXISTS (
             SELECT 1 FROM json_each(commissionSettlements.payload_json, '$.commissionIds') AS commissionId
             LEFT JOIN commissions ON commissions.id = commissionId.value
             LEFT JOIN distributionCommissions ON distributionCommissions.id = commissionId.value
             WHERE commissions.staffId IN (SELECT id FROM staff WHERE storeId = ?)
                OR commissions.orderId IN (SELECT id FROM orders WHERE storeId = ?)
                OR json_extract(distributionCommissions.payload_json, '$.distributorId') IN (
                  SELECT distributors.id
                  FROM distributors
                  WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                     OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
                )
                OR json_extract(distributionCommissions.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                OR json_extract(distributionCommissions.payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
           )
           ORDER BY rowid DESC`,
          mapJsonPayload<CommissionSettlement>,
          [storeId, storeId, storeId, storeId, storeId, storeId],
        );
      case "inventoryLogs":
        return tableStoreRows("inventoryLogs", mapInventoryLog);
      case "memberCardTransactions":
        return tableStoreRows("memberCardTransactions", mapMemberCardTransaction);
      case "operationLogs":
        return this.all("SELECT * FROM operationLogs WHERE storeId = ? OR userId = 'system' ORDER BY rowid DESC", mapOperationLog, [storeId]);
      case "marketingAiRecords":
        return jsonStoreRows("marketingAiRecords", mapJsonPayload<MarketingAiRecord>);
      case "notifications":
        return this.all(
          "SELECT payload_json FROM notifications WHERE json_extract(payload_json, '$.storeId') IS NULL OR json_extract(payload_json, '$.storeId') = '' OR json_extract(payload_json, '$.storeId') = ? ORDER BY rowid DESC",
          mapJsonPayload<SystemNotification>,
          [storeId],
        );
      case "dailyCloses":
        return tableStoreRows("dailyCloses", mapDailyClose, "businessDate DESC");
      case "approvalRequests":
        return jsonStoreRows("approvalRequests", mapJsonPayload<ApprovalRequest>);
      case "customerServiceRecords":
        return jsonStoreRows("customerServiceRecords", mapJsonPayload<CustomerServiceRecord>);
      case "customerSignatures":
        return jsonStoreRows("customerSignatures", mapJsonPayload<CustomerSignature>);
      case "customerFollowUps":
        return jsonStoreRows("customerFollowUps", mapJsonPayload<CustomerFollowUp>);
      case "suppliers":
        return jsonStoreRows("suppliers", mapJsonPayload<Supplier>);
      case "purchaseOrders":
        return jsonStoreRows("purchaseOrders", mapJsonPayload<PurchaseOrder>);
      case "stocktakes":
        return jsonStoreRows("stocktakes", mapJsonPayload<Stocktake>);
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        accountId TEXT,
        hiredAt TEXT,
        baseSalary REAL,
        commissionRate REAL
      );

      CREATE TABLE IF NOT EXISTS storeProfiles (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS onlineStorefronts (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS authUsers (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS systemConfigs (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staffInvites (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS storeOwnerInvites (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS storeOwnerApplications (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        lastVisit TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tagDefinitions (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        price REAL NOT NULL,
        duration INTEGER NOT NULL,
        defaultTimes INTEGER NOT NULL DEFAULT 1,
        consumables_json TEXT,
        consumableProductId TEXT,
        consumableQty REAL,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT,
        subcategory TEXT,
        unit TEXT NOT NULL,
        price REAL NOT NULL,
        cost REAL NOT NULL,
        stock REAL NOT NULL,
        warningStock REAL NOT NULL,
        shelfLifeMonths REAL,
        expiryAt TEXT,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        staffId TEXT NOT NULL,
        serviceId TEXT NOT NULL,
        serviceIds_json TEXT,
        startAt TEXT NOT NULL,
        endAt TEXT,
        roomName TEXT,
        status TEXT NOT NULL,
        note TEXT NOT NULL,
        arrivedAt TEXT,
        completedAt TEXT,
        canceledAt TEXT,
        cancelReason TEXT,
        noShowAt TEXT,
        rescheduledAt TEXT,
        updatedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS onlineBookingRequests (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staffUnavailableSlots (
        id TEXT PRIMARY KEY,
        staffId TEXT NOT NULL,
        startAt TEXT NOT NULL,
        endAt TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staffShifts (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memberCards (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL NOT NULL,
        remainingTimes INTEGER NOT NULL,
        expiresAt TEXT NOT NULL,
        status TEXT NOT NULL,
        serviceId TEXT,
        serviceIds_json TEXT,
        serviceEntitlements_json TEXT
      );

      CREATE TABLE IF NOT EXISTS distributors (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referralRelations (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        orderNo TEXT NOT NULL,
        customerId TEXT NOT NULL,
        guestName TEXT,
        guestPhone TEXT,
        staffId TEXT NOT NULL,
        serviceId TEXT NOT NULL,
        serviceName TEXT,
        servicePrice REAL,
        serviceConsumables_json TEXT,
        productId TEXT,
        giftProductId TEXT,
        productItems_json TEXT,
        giftProductItems_json TEXT,
        cardId TEXT,
        totalAmount REAL NOT NULL,
        paidAmount REAL NOT NULL,
        discountAmount REAL NOT NULL DEFAULT 0,
        adjustmentReason TEXT,
        approvalId TEXT,
        distributorId TEXT,
        appointmentId TEXT,
        payMethod TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commissions (
        id TEXT PRIMARY KEY,
        staffId TEXT NOT NULL,
        orderId TEXT NOT NULL,
        type TEXT NOT NULL,
        baseAmount REAL NOT NULL,
        rate REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        settledAt TEXT,
        settlementId TEXT
      );

      CREATE TABLE IF NOT EXISTS distributionCommissions (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commissionSettlements (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id TEXT PRIMARY KEY,
        orderId TEXT NOT NULL,
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventoryLogs (
        id TEXT PRIMARY KEY,
        productId TEXT NOT NULL,
        type TEXT NOT NULL,
        delta REAL NOT NULL,
        stockAfter REAL NOT NULL,
        note TEXT NOT NULL,
        expiryAt TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memberCardTransactions (
        id TEXT PRIMARY KEY,
        memberCardId TEXT NOT NULL,
        orderId TEXT,
        staffId TEXT,
        type TEXT NOT NULL,
        paidAmount REAL,
        payMethod TEXT,
        amountDelta REAL NOT NULL,
        timesDelta INTEGER NOT NULL,
        balanceAfter REAL NOT NULL,
        remainingTimesAfter INTEGER NOT NULL,
        note TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operationLogs (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        action TEXT NOT NULL,
        targetType TEXT NOT NULL,
        targetId TEXT NOT NULL,
        summary TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketingAiRecords (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dailyCloses (
        id TEXT PRIMARY KEY,
        storeId TEXT,
        businessDate TEXT NOT NULL,
        revenue REAL NOT NULL,
        refundAmount REAL NOT NULL,
        orderCount INTEGER NOT NULL,
        cashAmount REAL NOT NULL,
        wechatAmount REAL NOT NULL,
        alipayAmount REAL NOT NULL,
        cardAmount REAL NOT NULL,
        memberCardAmount REAL NOT NULL,
        commissionAmount REAL NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '已锁定',
        reversedBy TEXT,
        reversedAt TEXT,
        UNIQUE(storeId, businessDate)
      );

      CREATE TABLE IF NOT EXISTS approvalRequests (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customerServiceRecords (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customerSignatures (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customerFollowUps (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchaseOrders (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stocktakes (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventoryBatches (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkoutSubmissionLocks (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aiGenerationLocks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        kind TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);

    this.addColumnIfMissing("memberCards", "serviceId", "TEXT");
    this.addColumnIfMissing("memberCardTransactions", "paidAmount", "REAL");
    this.addColumnIfMissing("memberCardTransactions", "payMethod", "TEXT");
    this.addColumnIfMissing("memberCardTransactions", "staffId", "TEXT");
    this.addColumnIfMissing("staff", "accountId", "TEXT");
    this.addColumnIfMissing("staff", "hiredAt", "TEXT");
    this.addColumnIfMissing("staff", "baseSalary", "REAL");
    this.addColumnIfMissing("staff", "commissionRate", "REAL");
    this.addColumnIfMissing("memberCards", "serviceIds_json", "TEXT");
    this.addColumnIfMissing("memberCards", "serviceEntitlements_json", "TEXT");
    this.addColumnIfMissing("orders", "discountAmount", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("orders", "adjustmentReason", "TEXT");
    this.addColumnIfMissing("orders", "approvalId", "TEXT");
    this.addColumnIfMissing("orders", "distributorId", "TEXT");
    this.addColumnIfMissing("orders", "appointmentId", "TEXT");
    this.addColumnIfMissing("orders", "guestName", "TEXT");
    this.addColumnIfMissing("orders", "guestPhone", "TEXT");
    this.addColumnIfMissing("orders", "giftProductId", "TEXT");
    this.addColumnIfMissing("orders", "productItems_json", "TEXT");
    this.addColumnIfMissing("orders", "giftProductItems_json", "TEXT");
    this.addColumnIfMissing("orders", "serviceName", "TEXT");
    this.addColumnIfMissing("orders", "servicePrice", "REAL");
    this.addColumnIfMissing("orders", "serviceConsumables_json", "TEXT");
    this.addColumnIfMissing("products", "category", "TEXT");
    this.addColumnIfMissing("products", "subcategory", "TEXT");
    this.addColumnIfMissing("products", "shelfLifeMonths", "REAL");
    this.addColumnIfMissing("products", "expiryAt", "TEXT");
    this.addColumnIfMissing("products", "status", "TEXT");
    this.addColumnIfMissing("inventoryLogs", "expiryAt", "TEXT");
    this.addColumnIfMissing("commissions", "rate", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("commissions", "settledAt", "TEXT");
    this.addColumnIfMissing("commissions", "settlementId", "TEXT");
    this.addColumnIfMissing("appointments", "arrivedAt", "TEXT");
    this.addColumnIfMissing("appointments", "completedAt", "TEXT");
    this.addColumnIfMissing("appointments", "canceledAt", "TEXT");
    this.addColumnIfMissing("appointments", "cancelReason", "TEXT");
    this.addColumnIfMissing("appointments", "noShowAt", "TEXT");
    this.addColumnIfMissing("appointments", "rescheduledAt", "TEXT");
    this.addColumnIfMissing("appointments", "updatedAt", "TEXT");
    this.addColumnIfMissing("appointments", "roomName", "TEXT");
    this.addColumnIfMissing("appointments", "endAt", "TEXT");
    this.addColumnIfMissing("appointments", "serviceIds_json", "TEXT");
    this.addColumnIfMissing("dailyCloses", "status", "TEXT NOT NULL DEFAULT '已锁定'");
    this.addColumnIfMissing("dailyCloses", "reversedBy", "TEXT");
    this.addColumnIfMissing("dailyCloses", "reversedAt", "TEXT");
    this.addColumnIfMissing("services", "defaultTimes", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("services", "subcategory", "TEXT");
    this.addColumnIfMissing("services", "status", "TEXT");
    this.addColumnIfMissing("services", "consumables_json", "TEXT");
    this.addColumnIfMissing("staff", "storeId", "TEXT");
    this.addColumnIfMissing("customers", "storeId", "TEXT");
    this.addColumnIfMissing("customers", "points", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("customers", "birthday", "TEXT");
    this.addColumnIfMissing("customers", "nextFollowUpAt", "TEXT");
    this.addColumnIfMissing("customers", "note", "TEXT");
    this.addColumnIfMissing("services", "storeId", "TEXT");
    this.addColumnIfMissing("products", "storeId", "TEXT");
    this.addColumnIfMissing("appointments", "storeId", "TEXT");
    this.addColumnIfMissing("staffUnavailableSlots", "storeId", "TEXT");
    this.addColumnIfMissing("memberCards", "storeId", "TEXT");
    this.addColumnIfMissing("memberCards", "discountRate", "REAL");
    this.addColumnIfMissing("memberCards", "pointsEarned", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("memberCards", "benefitText", "TEXT");
    this.addColumnIfMissing("orders", "storeId", "TEXT");
    this.addColumnIfMissing("refunds", "storeId", "TEXT");
    this.addColumnIfMissing("inventoryLogs", "storeId", "TEXT");
    this.addColumnIfMissing("memberCardTransactions", "storeId", "TEXT");
    this.addColumnIfMissing("operationLogs", "storeId", "TEXT");
    this.addColumnIfMissing("dailyCloses", "storeId", "TEXT");
    this.ensureDailyClosesStoreDateUnique();
    this.createIndexes();
  }

  private ensureAiGenerationLocks() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aiGenerationLocks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        kind TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_scope_expires ON aiGenerationLocks(scope, expiresAt);
      CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_owner_kind ON aiGenerationLocks(ownerId, kind);
    `);
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
  }

  private ensureDailyClosesStoreDateUnique() {
    const indexes = this.db.prepare("PRAGMA index_list(dailyCloses)").all() as Array<{ name: string; unique: number }>;
    const hasBusinessDateOnlyUnique = indexes.some((index) => {
      if (!index.unique) return false;
      const columns = this.db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>;
      return columns.length === 1 && columns[0]?.name === "businessDate";
    });
    if (!hasBusinessDateOnlyUnique) return;

    this.db.exec(`
      CREATE TABLE dailyCloses_store_unique (
        id TEXT PRIMARY KEY,
        storeId TEXT,
        businessDate TEXT NOT NULL,
        revenue REAL NOT NULL,
        refundAmount REAL NOT NULL,
        orderCount INTEGER NOT NULL,
        cashAmount REAL NOT NULL,
        wechatAmount REAL NOT NULL,
        alipayAmount REAL NOT NULL,
        cardAmount REAL NOT NULL,
        memberCardAmount REAL NOT NULL,
        commissionAmount REAL NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '已锁定',
        reversedBy TEXT,
        reversedAt TEXT,
        UNIQUE(storeId, businessDate)
      );
      INSERT INTO dailyCloses_store_unique (
        id, storeId, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount,
        cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt
      )
      SELECT
        id, storeId, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount,
        cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt
      FROM dailyCloses;
      DROP TABLE dailyCloses;
      ALTER TABLE dailyCloses_store_unique RENAME TO dailyCloses;
    `);
  }

  private createIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_staff_store ON staff(storeId);
      CREATE INDEX IF NOT EXISTS idx_customers_store_last_visit ON customers(storeId, lastVisit);
      CREATE INDEX IF NOT EXISTS idx_customers_store_phone ON customers(storeId, phone);
      CREATE INDEX IF NOT EXISTS idx_services_store_status ON services(storeId, status);
      CREATE INDEX IF NOT EXISTS idx_products_store_status ON products(storeId, status);
      CREATE INDEX IF NOT EXISTS idx_products_store_category ON products(storeId, category, subcategory);
      CREATE INDEX IF NOT EXISTS idx_appointments_store_start ON appointments(storeId, startAt);
      CREATE INDEX IF NOT EXISTS idx_appointments_store_status ON appointments(storeId, status);
      CREATE INDEX IF NOT EXISTS idx_appointments_store_staff_start ON appointments(storeId, staffId, startAt);
      CREATE INDEX IF NOT EXISTS idx_member_cards_store_customer ON memberCards(storeId, customerId);
      CREATE INDEX IF NOT EXISTS idx_member_cards_store_status ON memberCards(storeId, status);
      CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_orders_store_customer_created ON orders(storeId, customerId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_orders_store_staff_created ON orders(storeId, staffId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_refunds_store_created ON refunds(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_created ON inventoryLogs(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_product_created ON inventoryLogs(storeId, productId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_member_card_transactions_store_created ON memberCardTransactions(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_operation_logs_store_created ON operationLogs(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_daily_closes_store_date ON dailyCloses(storeId, businessDate);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_checkout_locks_created ON checkoutSubmissionLocks(createdAt);
      CREATE INDEX IF NOT EXISTS idx_auth_users_store_json ON authUsers(json_extract(payload_json, '$.storeId'));
      CREATE INDEX IF NOT EXISTS idx_auth_users_account_json ON authUsers(json_extract(payload_json, '$.account'));
      CREATE INDEX IF NOT EXISTS idx_notifications_store_json ON notifications(json_extract(payload_json, '$.storeId'));
    `);
  }

  private ensureDefaultSuperadmin() {
    const data = this.readData();
    if (data.authUsers.some((user) => user.role === "superadmin")) return;
    const admin = seedData.authUsers.find((user) => user.role === "superadmin");
    if (!admin) return;
    this.replaceData({
      ...data,
      authUsers: [admin, ...data.authUsers],
    });
  }
}

function emptyData(): AppData {
  return {
    storeProfiles: [],
    onlineStorefronts: [],
    authUsers: [],
    staffInvites: [],
    storeOwnerInvites: [],
    storeOwnerApplications: [],
    staff: [],
    customers: [],
    tagDefinitions: [],
    services: [],
    products: [],
    inventoryBatches: [],
    appointments: [],
    onlineBookingRequests: [],
    staffUnavailableSlots: [],
    staffShifts: [],
    memberCards: [],
    distributors: [],
    referralRelations: [],
    orders: [],
    refunds: [],
    commissions: [],
    distributionCommissions: [],
    commissionSettlements: [],
    inventoryLogs: [],
    memberCardTransactions: [],
    operationLogs: [],
    marketingAiRecords: [],
    systemConfigs: [],
    notifications: [],
    dailyCloses: [],
    approvalRequests: [],
    customerServiceRecords: [],
    customerSignatures: [],
    customerFollowUps: [],
    suppliers: [],
    purchaseOrders: [],
    stocktakes: [],
  };
}

function dataForStoreWrite(data: AppData, storeId: string): AppData {
  const belongsToStore = (item: { storeId?: string }) => item.storeId === storeId;
  const staff = data.staff.filter(belongsToStore);
  const staffIds = new Set(staff.map((item) => item.id));
  const customers = data.customers.filter(belongsToStore);
  const customerIds = new Set(customers.map((item) => item.id));
  const orders = data.orders.filter(belongsToStore);
  const orderIds = new Set(orders.map((item) => item.id));
  const cards = data.memberCards.filter(belongsToStore);
  const cardIds = new Set(cards.map((item) => item.id));
  const distributors = data.distributors.filter((item) =>
    (item.customerId && customerIds.has(item.customerId)) || (item.staffId && staffIds.has(item.staffId)),
  );
  const distributorIds = new Set(distributors.map((item) => item.id));
  const commissions = data.commissions.filter((item) => staffIds.has(item.staffId) || orderIds.has(item.orderId));
  const commissionIds = new Set(commissions.map((item) => item.id));

  return {
    ...emptyData(),
    storeProfiles: data.storeProfiles.filter((item) => item.id === storeId),
    onlineStorefronts: data.onlineStorefronts.filter(belongsToStore),
    authUsers: data.authUsers.filter((item) => item.storeId === storeId),
    staffInvites: data.staffInvites.filter(belongsToStore),
    storeOwnerApplications: data.storeOwnerApplications.filter(belongsToStore),
    staff,
    customers,
    tagDefinitions: data.tagDefinitions.filter(belongsToStore),
    services: data.services.filter(belongsToStore),
    products: data.products.filter(belongsToStore),
    inventoryBatches: data.inventoryBatches.filter(belongsToStore),
    appointments: data.appointments.filter(belongsToStore),
    onlineBookingRequests: data.onlineBookingRequests.filter(belongsToStore),
    staffUnavailableSlots: data.staffUnavailableSlots.filter(belongsToStore),
    staffShifts: data.staffShifts.filter(belongsToStore),
    memberCards: cards,
    distributors,
    referralRelations: data.referralRelations.filter((item) => distributorIds.has(item.distributorId) && customerIds.has(item.customerId)),
    orders,
    refunds: data.refunds.filter((item) => item.storeId === storeId || orderIds.has(item.orderId)),
    commissions,
    distributionCommissions: data.distributionCommissions.filter((item) =>
      distributorIds.has(item.distributorId) || customerIds.has(item.customerId) || orderIds.has(item.orderId),
    ),
    commissionSettlements: data.commissionSettlements.filter((item) => item.commissionIds.some((commissionId) => commissionIds.has(commissionId))),
    inventoryLogs: data.inventoryLogs.filter(belongsToStore),
    memberCardTransactions: data.memberCardTransactions.filter((item) => item.storeId === storeId || cardIds.has(item.memberCardId)),
    operationLogs: data.operationLogs.filter(belongsToStore),
    marketingAiRecords: (data.marketingAiRecords ?? []).filter(belongsToStore),
    notifications: data.notifications.filter(belongsToStore),
    dailyCloses: data.dailyCloses.filter(belongsToStore),
    approvalRequests: data.approvalRequests.filter(belongsToStore),
    customerServiceRecords: data.customerServiceRecords.filter(belongsToStore),
    customerSignatures: data.customerSignatures.filter(belongsToStore),
    customerFollowUps: data.customerFollowUps.filter(belongsToStore),
    suppliers: data.suppliers.filter(belongsToStore),
    purchaseOrders: data.purchaseOrders.filter(belongsToStore),
    stocktakes: data.stocktakes.filter(belongsToStore),
  };
}

function mapStaff(row: unknown): Staff {
  const value = row as Staff;
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    accountId: value.accountId ?? undefined,
    hiredAt: value.hiredAt ?? undefined,
    baseSalary: value.baseSalary ?? undefined,
    commissionRate: value.commissionRate ?? undefined,
  };
}

function mapCustomer(row: unknown): Customer {
  const value = row as Customer & { tags_json: string };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    points: value.points ?? 0,
    birthday: value.birthday ?? undefined,
    nextFollowUpAt: value.nextFollowUpAt ?? undefined,
    note: value.note ?? undefined,
    tags: JSON.parse(value.tags_json) as string[],
  };
}

function parseJsonArray<T>(value?: string | null): T[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

function mapService(row: unknown): Service {
  const value = row as Service & { consumables_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    subcategory: value.subcategory ?? undefined,
    defaultTimes: value.defaultTimes ?? 1,
    consumables: parseJsonArray<ServiceConsumable>(value.consumables_json) ?? value.consumables,
    consumableProductId: value.consumableProductId ?? undefined,
    consumableQty: value.consumableQty ?? undefined,
    status: value.status ?? "启用",
  };
}

function mapProduct(row: unknown): Product {
  const value = row as Product;
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    category: value.category ?? undefined,
    subcategory: value.subcategory ?? undefined,
    shelfLifeMonths: value.shelfLifeMonths ?? undefined,
    expiryAt: value.expiryAt ?? undefined,
    status: value.status ?? "启用",
  };
}

function mapAppointment(row: unknown): Appointment {
  const value = row as Appointment & { serviceIds_json?: string | null };
  const { serviceIds_json: serviceIdsJson, ...appointment } = value;
  return {
    ...appointment,
    storeId: appointment.storeId ?? undefined,
    serviceIds: parseJsonArray<string>(serviceIdsJson),
    endAt: value.endAt ?? undefined,
    roomName: value.roomName ?? undefined,
    arrivedAt: value.arrivedAt ?? undefined,
    completedAt: value.completedAt ?? undefined,
    canceledAt: value.canceledAt ?? undefined,
    cancelReason: value.cancelReason ?? undefined,
    noShowAt: value.noShowAt ?? undefined,
    rescheduledAt: value.rescheduledAt ?? undefined,
    updatedAt: value.updatedAt ?? undefined,
  };
}

function mapStaffUnavailableSlot(row: unknown): StaffUnavailableSlot {
  return row as StaffUnavailableSlot;
}

function mapMemberCard(row: unknown): MemberCard {
  const value = row as MemberCard & { serviceIds_json?: string; serviceEntitlements_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    discountRate: value.discountRate ?? undefined,
    pointsEarned: value.pointsEarned ?? 0,
    benefitText: value.benefitText ?? undefined,
    serviceId: value.serviceId ?? undefined,
    serviceIds: value.serviceIds_json ? (JSON.parse(value.serviceIds_json) as string[]) : undefined,
    serviceEntitlements: value.serviceEntitlements_json ? JSON.parse(value.serviceEntitlements_json) as MemberCard["serviceEntitlements"] : undefined,
  };
}

function mapOrder(row: unknown): Order {
  const value = row as Order & { serviceConsumables_json?: string | null; productItems_json?: string | null; giftProductItems_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    guestName: value.guestName ?? undefined,
    guestPhone: value.guestPhone ?? undefined,
    serviceName: value.serviceName ?? undefined,
    servicePrice: value.servicePrice ?? undefined,
    serviceConsumables: parseJsonArray<ServiceConsumable>(value.serviceConsumables_json) ?? value.serviceConsumables,
    productId: value.productId ?? undefined,
    giftProductId: value.giftProductId ?? undefined,
    productItems: parseJsonArray<OrderProductItem>(value.productItems_json) ?? value.productItems,
    giftProductItems: parseJsonArray<OrderProductItem>(value.giftProductItems_json) ?? value.giftProductItems,
    cardId: value.cardId ?? undefined,
    discountAmount: value.discountAmount ?? 0,
    adjustmentReason: value.adjustmentReason ?? undefined,
    approvalId: value.approvalId ?? undefined,
    distributorId: value.distributorId ?? undefined,
    appointmentId: value.appointmentId ?? undefined,
  };
}

function mapRefund(row: unknown): Refund {
  const value = row as Refund;
  return { ...value, storeId: value.storeId ?? undefined };
}

function mapCommission(row: unknown): Commission {
  const value = row as Commission;
  return { ...value, rate: value.rate ?? 0, settledAt: value.settledAt ?? undefined, settlementId: value.settlementId ?? undefined };
}

function mapInventoryLog(row: unknown): InventoryLog {
  const value = row as InventoryLog;
  return { ...value, storeId: value.storeId ?? undefined, expiryAt: value.expiryAt ?? undefined };
}

function mapMemberCardTransaction(row: unknown): MemberCardTransaction {
  const value = row as MemberCardTransaction;
  return { ...value, storeId: value.storeId ?? undefined, orderId: value.orderId ?? undefined, staffId: value.staffId ?? undefined, paidAmount: value.paidAmount ?? undefined, payMethod: value.payMethod ?? undefined };
}

function mapOperationLog(row: unknown): OperationLog {
  const value = row as OperationLog;
  return { ...value, storeId: value.storeId ?? undefined };
}

function mapDailyClose(row: unknown): DailyClose {
  const value = row as DailyClose;
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    status: value.status ?? "已锁定",
    reversedBy: value.reversedBy ?? undefined,
    reversedAt: value.reversedAt ?? undefined,
  };
}

function mapJsonPayload<T>(row: unknown): T {
  return JSON.parse((row as { payload_json: string }).payload_json) as T;
}
