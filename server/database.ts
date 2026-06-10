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

  reserveCheckoutSubmission(id: string, createdAt: string) {
    const cutoff = new Date(Date.parse(createdAt) - 10 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM checkoutSubmissionLocks WHERE createdAt < ?").run(cutoff);
    const result = this.db.prepare("INSERT OR IGNORE INTO checkoutSubmissionLocks (id, createdAt) VALUES (?, ?)").run(id, createdAt) as { changes?: number };
    return (result.changes ?? 0) > 0;
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
        .prepare("INSERT INTO customers (id, storeId, name, phone, level, points, birthday, nextFollowUpAt, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          customer.id,
          customer.storeId ?? null,
          customer.name,
          customer.phone,
          customer.level,
          customer.points ?? 0,
          customer.birthday ?? null,
          customer.nextFollowUpAt ?? null,
          customer.source,
          JSON.stringify(customer.tags),
          customer.lastVisit,
        );
    }

    this.writeJsonTable("tagDefinitions", data.tagDefinitions);

    for (const service of data.services) {
      this.db
        .prepare(
          "INSERT INTO services (id, storeId, name, category, price, duration, defaultTimes, consumables_json, consumableProductId, consumableQty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          service.id,
          service.storeId ?? null,
          service.name,
          service.category,
          service.price,
          service.duration,
          service.defaultTimes ?? 1,
          JSON.stringify(service.consumables ?? []),
          service.consumableProductId ?? null,
          service.consumableQty ?? null,
        );
    }

    for (const product of data.products) {
      this.db
        .prepare("INSERT INTO products (id, storeId, name, type, category, subcategory, unit, price, cost, stock, warningStock, shelfLifeMonths, expiryAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        );
    }

    this.writeJsonTable("distributors", data.distributors);
    this.writeJsonTable("referralRelations", data.referralRelations);

    for (const order of data.orders) {
      this.db
        .prepare(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          "INSERT INTO memberCardTransactions (id, storeId, memberCardId, orderId, type, paidAmount, payMethod, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          transaction.id,
          transaction.storeId ?? null,
          transaction.memberCardId,
          transaction.orderId ?? null,
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
    this.writeJsonTable("suppliers", data.suppliers);
    this.writeJsonTable("purchaseOrders", data.purchaseOrders);
    this.writeJsonTable("stocktakes", data.stocktakes);
  }

  private writeJsonTable(tableName: string, rows: Array<{ id: string }>) {
    for (const row of rows) {
      this.db.prepare(`INSERT INTO ${tableName} (id, payload_json) VALUES (?, ?)`).run(row.id, JSON.stringify(row));
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
        price REAL NOT NULL,
        duration INTEGER NOT NULL,
        defaultTimes INTEGER NOT NULL DEFAULT 1,
        consumables_json TEXT,
        consumableProductId TEXT,
        consumableQty REAL
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
        expiryAt TEXT
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
        serviceIds_json TEXT
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

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dailyCloses (
        id TEXT PRIMARY KEY,
        businessDate TEXT NOT NULL UNIQUE,
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
        reversedAt TEXT
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
    `);

    this.addColumnIfMissing("memberCards", "serviceId", "TEXT");
    this.addColumnIfMissing("memberCardTransactions", "paidAmount", "REAL");
    this.addColumnIfMissing("memberCardTransactions", "payMethod", "TEXT");
    this.addColumnIfMissing("staff", "accountId", "TEXT");
    this.addColumnIfMissing("staff", "hiredAt", "TEXT");
    this.addColumnIfMissing("staff", "baseSalary", "REAL");
    this.addColumnIfMissing("staff", "commissionRate", "REAL");
    this.addColumnIfMissing("memberCards", "serviceIds_json", "TEXT");
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
    this.addColumnIfMissing("products", "category", "TEXT");
    this.addColumnIfMissing("products", "subcategory", "TEXT");
    this.addColumnIfMissing("products", "shelfLifeMonths", "REAL");
    this.addColumnIfMissing("products", "expiryAt", "TEXT");
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
    this.addColumnIfMissing("services", "consumables_json", "TEXT");
    this.addColumnIfMissing("staff", "storeId", "TEXT");
    this.addColumnIfMissing("customers", "storeId", "TEXT");
    this.addColumnIfMissing("customers", "points", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("customers", "birthday", "TEXT");
    this.addColumnIfMissing("customers", "nextFollowUpAt", "TEXT");
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
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
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
    defaultTimes: value.defaultTimes ?? 1,
    consumables: parseJsonArray<ServiceConsumable>(value.consumables_json) ?? value.consumables,
    consumableProductId: value.consumableProductId ?? undefined,
    consumableQty: value.consumableQty ?? undefined,
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
  const value = row as MemberCard & { serviceIds_json?: string };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    discountRate: value.discountRate ?? undefined,
    pointsEarned: value.pointsEarned ?? 0,
    benefitText: value.benefitText ?? undefined,
    serviceId: value.serviceId ?? undefined,
    serviceIds: value.serviceIds_json ? (JSON.parse(value.serviceIds_json) as string[]) : undefined,
  };
}

function mapOrder(row: unknown): Order {
  const value = row as Order & { productItems_json?: string | null; giftProductItems_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    guestName: value.guestName ?? undefined,
    guestPhone: value.guestPhone ?? undefined,
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
  return { ...value, storeId: value.storeId ?? undefined, orderId: value.orderId ?? undefined, paidAmount: value.paidAmount ?? undefined, payMethod: value.payMethod ?? undefined };
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
