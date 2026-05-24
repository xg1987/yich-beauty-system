import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedData } from "../src/domain/seed";
import type {
  AppData,
  ApprovalRequest,
  Appointment,
  AuthUser,
  Commission,
  CommissionSettlement,
  ActivityParticipant,
  CouponTemplate,
  Customer,
  CustomerCoupon,
  CustomerFollowUp,
  CustomerServiceRecord,
  DailyClose,
  DistributionCommission,
  Distributor,
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  MarketingActivity,
  OnlineBookingRequest,
  OnlineStorefront,
  OperationLog,
  Order,
  Product,
  PurchaseOrder,
  ReferralRelation,
  Refund,
  Service,
  Staff,
  StaffInvite,
  StaffShift,
  StaffUnavailableSlot,
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
  "staffInvites",
  "staff",
  "customers",
  "tagDefinitions",
  "services",
  "products",
  "appointments",
  "onlineBookingRequests",
  "staffUnavailableSlots",
  "staffShifts",
  "memberCards",
  "couponTemplates",
  "customerCoupons",
  "marketingActivities",
  "activityParticipants",
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
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM staff").get() as { count: number };
    if (row.count === 0) {
      this.writeData(seedData);
      return;
    }
    const authRow = this.db.prepare("SELECT COUNT(*) AS count FROM authUsers").get() as { count: number };
    if (authRow.count === 0) {
      this.replaceData({
        ...this.readData(),
        storeProfiles: seedData.storeProfiles,
        authUsers: seedData.authUsers,
        staff: this.readData().staff.map((staff) => seedData.staff.find((seedStaff) => seedStaff.id === staff.id) ?? staff),
      });
    }
  }

  readData(): AppData {
    return {
      storeProfiles: this.db.prepare("SELECT payload_json FROM storeProfiles ORDER BY rowid ASC").all().map(mapJsonPayload<StoreProfile>),
      onlineStorefronts: this.db.prepare("SELECT payload_json FROM onlineStorefronts ORDER BY rowid ASC").all().map(mapJsonPayload<OnlineStorefront>),
      authUsers: this.db.prepare("SELECT payload_json FROM authUsers ORDER BY rowid ASC").all().map(mapJsonPayload<AuthUser>),
      staffInvites: this.db.prepare("SELECT payload_json FROM staffInvites ORDER BY rowid DESC").all().map(mapJsonPayload<StaffInvite>),
      staff: this.db.prepare("SELECT * FROM staff ORDER BY rowid ASC").all().map(mapStaff),
      customers: this.db.prepare("SELECT * FROM customers ORDER BY rowid ASC").all().map(mapCustomer),
      tagDefinitions: this.db.prepare("SELECT payload_json FROM tagDefinitions ORDER BY rowid ASC").all().map(mapJsonPayload<TagDefinition>),
      services: this.db.prepare("SELECT * FROM services ORDER BY rowid ASC").all().map(mapService),
      products: this.db.prepare("SELECT * FROM products ORDER BY rowid ASC").all().map(mapProduct),
      appointments: this.db.prepare("SELECT * FROM appointments ORDER BY rowid ASC").all().map(mapAppointment),
      onlineBookingRequests: this.db.prepare("SELECT payload_json FROM onlineBookingRequests ORDER BY rowid DESC").all().map(mapJsonPayload<OnlineBookingRequest>),
      staffUnavailableSlots: this.db
        .prepare("SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC")
        .all()
        .map(mapStaffUnavailableSlot),
      staffShifts: this.db.prepare("SELECT payload_json FROM staffShifts ORDER BY rowid DESC").all().map(mapJsonPayload<StaffShift>),
      memberCards: this.db.prepare("SELECT * FROM memberCards ORDER BY rowid ASC").all().map(mapMemberCard),
      couponTemplates: this.db.prepare("SELECT payload_json FROM couponTemplates ORDER BY rowid DESC").all().map(mapJsonPayload<CouponTemplate>),
      customerCoupons: this.db.prepare("SELECT payload_json FROM customerCoupons ORDER BY rowid DESC").all().map(mapJsonPayload<CustomerCoupon>),
      marketingActivities: this.db.prepare("SELECT payload_json FROM marketingActivities ORDER BY rowid DESC").all().map(mapJsonPayload<MarketingActivity>),
      activityParticipants: this.db.prepare("SELECT payload_json FROM activityParticipants ORDER BY rowid DESC").all().map(mapJsonPayload<ActivityParticipant>),
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

  private writeData(data: AppData) {
    this.writeJsonTable("storeProfiles", data.storeProfiles);
    this.writeJsonTable("onlineStorefronts", data.onlineStorefronts);
    this.writeJsonTable("authUsers", data.authUsers);
    this.writeJsonTable("staffInvites", data.staffInvites);

    for (const staff of data.staff) {
      this.db
        .prepare("INSERT INTO staff (id, name, phone, role, status, accountId, hiredAt, baseSalary, commissionRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          staff.id,
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
        .prepare("INSERT INTO customers (id, name, phone, level, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(customer.id, customer.name, customer.phone, customer.level, customer.source, JSON.stringify(customer.tags), customer.lastVisit);
    }

    this.writeJsonTable("tagDefinitions", data.tagDefinitions);

    for (const service of data.services) {
      this.db
        .prepare(
          "INSERT INTO services (id, name, category, price, duration, consumableProductId, consumableQty) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          service.id,
          service.name,
          service.category,
          service.price,
          service.duration,
          service.consumableProductId ?? null,
          service.consumableQty ?? null,
        );
    }

    for (const product of data.products) {
      this.db
        .prepare("INSERT INTO products (id, name, type, unit, price, cost, stock, warningStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(product.id, product.name, product.type, product.unit, product.price, product.cost, product.stock, product.warningStock);
    }

    for (const appointment of data.appointments) {
      this.db
        .prepare(
          "INSERT INTO appointments (id, customerId, staffId, serviceId, startAt, status, note, arrivedAt, completedAt, canceledAt, cancelReason, noShowAt, rescheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          appointment.id,
          appointment.customerId,
          appointment.staffId,
          appointment.serviceId,
          appointment.startAt,
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
          "INSERT INTO staffUnavailableSlots (id, staffId, startAt, endAt, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(slot.id, slot.staffId, slot.startAt, slot.endAt, slot.reason, slot.createdBy, slot.createdAt);
    }

    this.writeJsonTable("staffShifts", data.staffShifts);

    for (const card of data.memberCards) {
      this.db
        .prepare(
          "INSERT INTO memberCards (id, customerId, name, type, balance, remainingTimes, expiresAt, status, serviceId, serviceIds_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          card.id,
          card.customerId,
          card.name,
          card.type,
          card.balance,
          card.remainingTimes,
          card.expiresAt,
          card.status,
          card.serviceId ?? null,
          JSON.stringify(card.serviceIds ?? []),
        );
    }

    this.writeJsonTable("couponTemplates", data.couponTemplates);
    this.writeJsonTable("customerCoupons", data.customerCoupons);
    this.writeJsonTable("marketingActivities", data.marketingActivities);
    this.writeJsonTable("activityParticipants", data.activityParticipants);
    this.writeJsonTable("distributors", data.distributors);
    this.writeJsonTable("referralRelations", data.referralRelations);

    for (const order of data.orders) {
      this.db
        .prepare(
          "INSERT INTO orders (id, orderNo, customerId, staffId, serviceId, productId, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, couponId, activityId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          order.id,
          order.orderNo,
          order.customerId,
          order.staffId,
          order.serviceId,
          order.productId ?? null,
          order.cardId ?? null,
          order.totalAmount,
          order.paidAmount,
          order.discountAmount ?? 0,
          order.adjustmentReason ?? null,
          order.approvalId ?? null,
          order.couponId ?? null,
          order.activityId ?? null,
          order.distributorId ?? null,
          order.appointmentId ?? null,
          order.payMethod,
          order.status,
          order.createdAt,
        );
    }

    for (const refund of data.refunds) {
      this.db
        .prepare("INSERT INTO refunds (id, orderId, amount, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run(refund.id, refund.orderId, refund.amount, refund.reason, refund.createdBy, refund.createdAt);
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
          "INSERT INTO inventoryLogs (id, productId, type, delta, stockAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(log.id, log.productId, log.type, log.delta, log.stockAfter, log.note, log.createdAt);
    }

    for (const transaction of data.memberCardTransactions) {
      this.db
        .prepare(
          "INSERT INTO memberCardTransactions (id, memberCardId, orderId, type, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          transaction.id,
          transaction.memberCardId,
          transaction.orderId ?? null,
          transaction.type,
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
          "INSERT INTO operationLogs (id, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(log.id, log.userId, log.action, log.targetType, log.targetId, log.summary, log.createdAt);
    }

    this.writeJsonTable("notifications", data.notifications ?? []);

    for (const close of data.dailyCloses) {
      this.db
        .prepare(
          "INSERT INTO dailyCloses (id, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount, cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          close.id,
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

      CREATE TABLE IF NOT EXISTS staffInvites (
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
        consumableProductId TEXT,
        consumableQty REAL
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        unit TEXT NOT NULL,
        price REAL NOT NULL,
        cost REAL NOT NULL,
        stock REAL NOT NULL,
        warningStock REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        staffId TEXT NOT NULL,
        serviceId TEXT NOT NULL,
        startAt TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS couponTemplates (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customerCoupons (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketingActivities (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activityParticipants (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
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
        staffId TEXT NOT NULL,
        serviceId TEXT NOT NULL,
        productId TEXT,
        cardId TEXT,
        totalAmount REAL NOT NULL,
        paidAmount REAL NOT NULL,
        discountAmount REAL NOT NULL DEFAULT 0,
        adjustmentReason TEXT,
        approvalId TEXT,
        couponId TEXT,
        activityId TEXT,
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
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memberCardTransactions (
        id TEXT PRIMARY KEY,
        memberCardId TEXT NOT NULL,
        orderId TEXT,
        type TEXT NOT NULL,
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
    `);

    this.addColumnIfMissing("memberCards", "serviceId", "TEXT");
    this.addColumnIfMissing("staff", "accountId", "TEXT");
    this.addColumnIfMissing("staff", "hiredAt", "TEXT");
    this.addColumnIfMissing("staff", "baseSalary", "REAL");
    this.addColumnIfMissing("staff", "commissionRate", "REAL");
    this.addColumnIfMissing("memberCards", "serviceIds_json", "TEXT");
    this.addColumnIfMissing("orders", "discountAmount", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("orders", "adjustmentReason", "TEXT");
    this.addColumnIfMissing("orders", "approvalId", "TEXT");
    this.addColumnIfMissing("orders", "couponId", "TEXT");
    this.addColumnIfMissing("orders", "activityId", "TEXT");
    this.addColumnIfMissing("orders", "distributorId", "TEXT");
    this.addColumnIfMissing("orders", "appointmentId", "TEXT");
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
    this.addColumnIfMissing("dailyCloses", "status", "TEXT NOT NULL DEFAULT '已锁定'");
    this.addColumnIfMissing("dailyCloses", "reversedBy", "TEXT");
    this.addColumnIfMissing("dailyCloses", "reversedAt", "TEXT");
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
  }
}

function mapStaff(row: unknown): Staff {
  const value = row as Staff;
  return {
    ...value,
    accountId: value.accountId ?? undefined,
    hiredAt: value.hiredAt ?? undefined,
    baseSalary: value.baseSalary ?? undefined,
    commissionRate: value.commissionRate ?? undefined,
  };
}

function mapCustomer(row: unknown): Customer {
  const value = row as Customer & { tags_json: string };
  return { ...value, tags: JSON.parse(value.tags_json) as string[] };
}

function mapService(row: unknown): Service {
  const value = row as Service;
  return {
    ...value,
    consumableProductId: value.consumableProductId ?? undefined,
    consumableQty: value.consumableQty ?? undefined,
  };
}

function mapProduct(row: unknown): Product {
  return row as Product;
}

function mapAppointment(row: unknown): Appointment {
  const value = row as Appointment;
  return {
    ...value,
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
    serviceId: value.serviceId ?? undefined,
    serviceIds: value.serviceIds_json ? (JSON.parse(value.serviceIds_json) as string[]) : undefined,
  };
}

function mapOrder(row: unknown): Order {
  const value = row as Order;
  return {
    ...value,
    productId: value.productId ?? undefined,
    cardId: value.cardId ?? undefined,
    discountAmount: value.discountAmount ?? 0,
    adjustmentReason: value.adjustmentReason ?? undefined,
    approvalId: value.approvalId ?? undefined,
    couponId: value.couponId ?? undefined,
    activityId: value.activityId ?? undefined,
    distributorId: value.distributorId ?? undefined,
    appointmentId: value.appointmentId ?? undefined,
  };
}

function mapRefund(row: unknown): Refund {
  return row as Refund;
}

function mapCommission(row: unknown): Commission {
  const value = row as Commission;
  return { ...value, rate: value.rate ?? 0, settledAt: value.settledAt ?? undefined, settlementId: value.settlementId ?? undefined };
}

function mapInventoryLog(row: unknown): InventoryLog {
  return row as InventoryLog;
}

function mapMemberCardTransaction(row: unknown): MemberCardTransaction {
  const value = row as MemberCardTransaction;
  return { ...value, orderId: value.orderId ?? undefined };
}

function mapOperationLog(row: unknown): OperationLog {
  return row as OperationLog;
}

function mapDailyClose(row: unknown): DailyClose {
  const value = row as DailyClose;
  return {
    ...value,
    status: value.status ?? "已锁定",
    reversedBy: value.reversedBy ?? undefined,
    reversedAt: value.reversedAt ?? undefined,
  };
}

function mapJsonPayload<T>(row: unknown): T {
  return JSON.parse((row as { payload_json: string }).payload_json) as T;
}
