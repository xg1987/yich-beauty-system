import { seedData } from "../domain/seed";
import type {
  AppData,
  ApprovalRequest,
  Appointment,
  Commission,
  Customer,
  CustomerFollowUp,
  CustomerServiceRecord,
  DailyClose,
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  OperationLog,
  Order,
  Product,
  PurchaseOrder,
  Refund,
  Service,
  Staff,
  StaffShift,
  StaffUnavailableSlot,
  Stocktake,
  Supplier,
} from "../domain/types";
import type { D1DatabaseBinding, D1PreparedStatement, D1Value } from "./d1Types";

type TableName = keyof AppData;

const tableNames: TableName[] = [
  "staff",
  "customers",
  "services",
  "products",
  "appointments",
  "staffUnavailableSlots",
  "staffShifts",
  "memberCards",
  "orders",
  "refunds",
  "commissions",
  "inventoryLogs",
  "memberCardTransactions",
  "operationLogs",
  "dailyCloses",
  "approvalRequests",
  "customerServiceRecords",
  "customerFollowUps",
  "suppliers",
  "purchaseOrders",
  "stocktakes",
];

export class D1BeautyDatabase {
  constructor(private readonly db: D1DatabaseBinding) {}

  async reset() {
    await this.replaceData(seedData);
  }

  async seedIfEmpty() {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM staff").first<{ count: number }>();
    if ((row?.count ?? 0) === 0) {
      await this.replaceData(seedData);
    }
  }

  async readData(): Promise<AppData> {
    return {
      staff: await this.all("SELECT * FROM staff ORDER BY rowid ASC", mapStaff),
      customers: await this.all("SELECT * FROM customers ORDER BY rowid ASC", mapCustomer),
      services: await this.all("SELECT * FROM services ORDER BY rowid ASC", mapService),
      products: await this.all("SELECT * FROM products ORDER BY rowid ASC", mapProduct),
      appointments: await this.all("SELECT * FROM appointments ORDER BY rowid ASC", mapAppointment),
      staffUnavailableSlots: await this.all(
        "SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC",
        mapStaffUnavailableSlot,
      ),
      staffShifts: await this.all("SELECT payload_json FROM staffShifts ORDER BY rowid DESC", mapJsonPayload<StaffShift>),
      memberCards: await this.all("SELECT * FROM memberCards ORDER BY rowid ASC", mapMemberCard),
      orders: await this.all("SELECT * FROM orders ORDER BY rowid DESC", mapOrder),
      refunds: await this.all("SELECT * FROM refunds ORDER BY rowid DESC", mapRefund),
      commissions: await this.all("SELECT * FROM commissions ORDER BY rowid DESC", mapCommission),
      inventoryLogs: await this.all("SELECT * FROM inventoryLogs ORDER BY rowid DESC", mapInventoryLog),
      memberCardTransactions: await this.all(
        "SELECT * FROM memberCardTransactions ORDER BY rowid DESC",
        mapMemberCardTransaction,
      ),
      operationLogs: await this.all("SELECT * FROM operationLogs ORDER BY rowid DESC", mapOperationLog),
      dailyCloses: await this.all("SELECT * FROM dailyCloses ORDER BY businessDate DESC", mapDailyClose),
      approvalRequests: await this.all("SELECT payload_json FROM approvalRequests ORDER BY rowid DESC", mapJsonPayload<ApprovalRequest>),
      customerServiceRecords: await this.all(
        "SELECT payload_json FROM customerServiceRecords ORDER BY rowid DESC",
        mapJsonPayload<CustomerServiceRecord>,
      ),
      customerFollowUps: await this.all("SELECT payload_json FROM customerFollowUps ORDER BY rowid DESC", mapJsonPayload<CustomerFollowUp>),
      suppliers: await this.all("SELECT payload_json FROM suppliers ORDER BY rowid DESC", mapJsonPayload<Supplier>),
      purchaseOrders: await this.all("SELECT payload_json FROM purchaseOrders ORDER BY rowid DESC", mapJsonPayload<PurchaseOrder>),
      stocktakes: await this.all("SELECT payload_json FROM stocktakes ORDER BY rowid DESC", mapJsonPayload<Stocktake>),
    };
  }

  async replaceData(data: AppData) {
    const statements: D1PreparedStatement[] = [];
    for (const tableName of [...tableNames].reverse()) {
      statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
    }
    statements.push(...this.writeDataStatements(data));
    await this.db.batch(statements);
  }

  private async all<T>(query: string, mapper: (row: unknown) => T) {
    const result = await this.db.prepare(query).all();
    return (result.results ?? []).map(mapper);
  }

  private writeDataStatements(data: AppData) {
    const statements: D1PreparedStatement[] = [];

    for (const staff of data.staff) {
      statements.push(this.statement("INSERT INTO staff (id, name, phone, role, status) VALUES (?, ?, ?, ?, ?)", [
        staff.id,
        staff.name,
        staff.phone,
        staff.role,
        staff.status,
      ]));
    }

    for (const customer of data.customers) {
      statements.push(
        this.statement("INSERT INTO customers (id, name, phone, level, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          customer.id,
          customer.name,
          customer.phone,
          customer.level,
          customer.source,
          JSON.stringify(customer.tags),
          customer.lastVisit,
        ]),
      );
    }

    for (const service of data.services) {
      statements.push(
        this.statement(
          "INSERT INTO services (id, name, category, price, duration, consumableProductId, consumableQty) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            service.id,
            service.name,
            service.category,
            service.price,
            service.duration,
            service.consumableProductId ?? null,
            service.consumableQty ?? null,
          ],
        ),
      );
    }

    for (const product of data.products) {
      statements.push(
        this.statement("INSERT INTO products (id, name, type, unit, price, cost, stock, warningStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
          product.id,
          product.name,
          product.type,
          product.unit,
          product.price,
          product.cost,
          product.stock,
          product.warningStock,
        ]),
      );
    }

    for (const appointment of data.appointments) {
      statements.push(
        this.statement("INSERT INTO appointments (id, customerId, staffId, serviceId, startAt, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          appointment.id,
          appointment.customerId,
          appointment.staffId,
          appointment.serviceId,
          appointment.startAt,
          appointment.status,
          appointment.note,
        ]),
      );
    }

    for (const slot of data.staffUnavailableSlots) {
      statements.push(
        this.statement(
          "INSERT INTO staffUnavailableSlots (id, staffId, startAt, endAt, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [slot.id, slot.staffId, slot.startAt, slot.endAt, slot.reason, slot.createdBy, slot.createdAt],
        ),
      );
    }

    this.writeJsonTable(statements, "staffShifts", data.staffShifts);

    for (const card of data.memberCards) {
      statements.push(
        this.statement(
          "INSERT INTO memberCards (id, customerId, name, type, balance, remainingTimes, expiresAt, status, serviceId, serviceIds_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    for (const order of data.orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, orderNo, customerId, staffId, serviceId, productId, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
            order.payMethod,
            order.status,
            order.createdAt,
          ],
        ),
      );
    }

    for (const refund of data.refunds) {
      statements.push(
        this.statement("INSERT INTO refunds (id, orderId, amount, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)", [
          refund.id,
          refund.orderId,
          refund.amount,
          refund.reason,
          refund.createdBy,
          refund.createdAt,
        ]),
      );
    }

    for (const commission of data.commissions) {
      statements.push(
        this.statement(
          "INSERT INTO commissions (id, staffId, orderId, type, baseAmount, amount, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            commission.id,
            commission.staffId,
            commission.orderId,
            commission.type,
            commission.baseAmount,
            commission.amount,
            commission.status,
            commission.createdAt,
          ],
        ),
      );
    }

    for (const log of data.inventoryLogs) {
      statements.push(
        this.statement("INSERT INTO inventoryLogs (id, productId, type, delta, stockAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          log.id,
          log.productId,
          log.type,
          log.delta,
          log.stockAfter,
          log.note,
          log.createdAt,
        ]),
      );
    }

    for (const transaction of data.memberCardTransactions) {
      statements.push(
        this.statement(
          "INSERT INTO memberCardTransactions (id, memberCardId, orderId, type, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    for (const log of data.operationLogs) {
      statements.push(
        this.statement(
          "INSERT INTO operationLogs (id, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [log.id, log.userId, log.action, log.targetType, log.targetId, log.summary, log.createdAt],
        ),
      );
    }

    for (const close of data.dailyCloses) {
      statements.push(
        this.statement(
          "INSERT INTO dailyCloses (id, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount, cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    this.writeJsonTable(statements, "approvalRequests", data.approvalRequests);
    this.writeJsonTable(statements, "customerServiceRecords", data.customerServiceRecords);
    this.writeJsonTable(statements, "customerFollowUps", data.customerFollowUps);
    this.writeJsonTable(statements, "suppliers", data.suppliers);
    this.writeJsonTable(statements, "purchaseOrders", data.purchaseOrders);
    this.writeJsonTable(statements, "stocktakes", data.stocktakes);

    return statements;
  }

  private writeJsonTable(statements: D1PreparedStatement[], tableName: string, rows: Array<{ id: string }>) {
    for (const row of rows) {
      statements.push(this.statement(`INSERT INTO ${tableName} (id, payload_json) VALUES (?, ?)`, [row.id, JSON.stringify(row)]));
    }
  }

  private statement(query: string, values: D1Value[]) {
    return this.db.prepare(query).bind(...values);
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
