import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedData } from "../src/domain/seed";
import type {
  AppData,
  Appointment,
  Commission,
  Customer,
  DailyClose,
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  OperationLog,
  Order,
  Product,
  Refund,
  Service,
  Staff,
  StaffUnavailableSlot,
} from "../src/domain/types";

const DEFAULT_DB_PATH = resolve("data/yich-system.sqlite");

type TableName = keyof AppData;

const tableNames: TableName[] = [
  "staff",
  "customers",
  "services",
  "products",
  "appointments",
  "staffUnavailableSlots",
  "memberCards",
  "orders",
  "refunds",
  "commissions",
  "inventoryLogs",
  "memberCardTransactions",
  "operationLogs",
  "dailyCloses",
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
    }
  }

  readData(): AppData {
    return {
      staff: this.db.prepare("SELECT * FROM staff ORDER BY rowid ASC").all().map(mapStaff),
      customers: this.db.prepare("SELECT * FROM customers ORDER BY rowid ASC").all().map(mapCustomer),
      services: this.db.prepare("SELECT * FROM services ORDER BY rowid ASC").all().map(mapService),
      products: this.db.prepare("SELECT * FROM products ORDER BY rowid ASC").all().map(mapProduct),
      appointments: this.db.prepare("SELECT * FROM appointments ORDER BY rowid ASC").all().map(mapAppointment),
      staffUnavailableSlots: this.db
        .prepare("SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC")
        .all()
        .map(mapStaffUnavailableSlot),
      memberCards: this.db.prepare("SELECT * FROM memberCards ORDER BY rowid ASC").all().map(mapMemberCard),
      orders: this.db.prepare("SELECT * FROM orders ORDER BY rowid DESC").all().map(mapOrder),
      refunds: this.db.prepare("SELECT * FROM refunds ORDER BY rowid DESC").all().map(mapRefund),
      commissions: this.db.prepare("SELECT * FROM commissions ORDER BY rowid DESC").all().map(mapCommission),
      inventoryLogs: this.db.prepare("SELECT * FROM inventoryLogs ORDER BY rowid DESC").all().map(mapInventoryLog),
      memberCardTransactions: this.db
        .prepare("SELECT * FROM memberCardTransactions ORDER BY rowid DESC")
        .all()
        .map(mapMemberCardTransaction),
      operationLogs: this.db.prepare("SELECT * FROM operationLogs ORDER BY rowid DESC").all().map(mapOperationLog),
      dailyCloses: this.db.prepare("SELECT * FROM dailyCloses ORDER BY businessDate DESC").all().map(mapDailyClose),
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
    for (const staff of data.staff) {
      this.db
        .prepare("INSERT INTO staff (id, name, phone, role, status) VALUES (?, ?, ?, ?, ?)")
        .run(staff.id, staff.name, staff.phone, staff.role, staff.status);
    }

    for (const customer of data.customers) {
      this.db
        .prepare("INSERT INTO customers (id, name, phone, level, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(customer.id, customer.name, customer.phone, customer.level, customer.source, JSON.stringify(customer.tags), customer.lastVisit);
    }

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
          "INSERT INTO appointments (id, customerId, staffId, serviceId, startAt, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          appointment.id,
          appointment.customerId,
          appointment.staffId,
          appointment.serviceId,
          appointment.startAt,
          appointment.status,
          appointment.note,
        );
    }

    for (const slot of data.staffUnavailableSlots) {
      this.db
        .prepare(
          "INSERT INTO staffUnavailableSlots (id, staffId, startAt, endAt, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(slot.id, slot.staffId, slot.startAt, slot.endAt, slot.reason, slot.createdBy, slot.createdAt);
    }

    for (const card of data.memberCards) {
      this.db
        .prepare(
          "INSERT INTO memberCards (id, customerId, name, type, balance, remainingTimes, expiresAt, status, serviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        );
    }

    for (const order of data.orders) {
      this.db
        .prepare(
          "INSERT INTO orders (id, orderNo, customerId, staffId, serviceId, productId, cardId, totalAmount, paidAmount, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          "INSERT INTO commissions (id, staffId, orderId, type, baseAmount, amount, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          commission.id,
          commission.staffId,
          commission.orderId,
          commission.type,
          commission.baseAmount,
          commission.amount,
          commission.status,
          commission.createdAt,
        );
    }

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

    for (const close of data.dailyCloses) {
      this.db
        .prepare(
          "INSERT INTO dailyCloses (id, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount, cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        );
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL
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
        note TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS memberCards (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL NOT NULL,
        remainingTimes INTEGER NOT NULL,
        expiresAt TEXT NOT NULL,
        status TEXT NOT NULL,
        serviceId TEXT
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
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
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
        createdAt TEXT NOT NULL
      );
    `);

    this.addColumnIfMissing("memberCards", "serviceId", "TEXT");
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
  }
}

function mapStaff(row: unknown): Staff {
  return row as Staff;
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
  return row as Appointment;
}

function mapStaffUnavailableSlot(row: unknown): StaffUnavailableSlot {
  return row as StaffUnavailableSlot;
}

function mapMemberCard(row: unknown): MemberCard {
  const value = row as MemberCard;
  return { ...value, serviceId: value.serviceId ?? undefined };
}

function mapOrder(row: unknown): Order {
  const value = row as Order;
  return {
    ...value,
    productId: value.productId ?? undefined,
    cardId: value.cardId ?? undefined,
  };
}

function mapRefund(row: unknown): Refund {
  return row as Refund;
}

function mapCommission(row: unknown): Commission {
  return row as Commission;
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
  return row as DailyClose;
}
