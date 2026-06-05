import { seedData } from "../domain/seed";
import { normalizeSystemConfigs } from "../domain/business";
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
  InventoryLog,
  MemberCard,
  MemberCardTransaction,
  OnlineBookingRequest,
  OnlineStorefront,
  OperationLog,
  Order,
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
} from "../domain/types";
import type { D1DatabaseBinding, D1PreparedStatement, D1Value } from "./d1Types";

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

export class D1BeautyDatabase {
  constructor(private readonly db: D1DatabaseBinding) {}

  async reset() {
    await this.replaceData(seedData);
  }

  async seedIfEmpty() {
    const authRow = await this.db.prepare("SELECT COUNT(*) AS count FROM authUsers").first<{ count: number }>();
    if ((authRow?.count ?? 0) === 0) {
      await this.replaceData(seedData);
      await this.ensureDefaultSuperadmin();
      return;
    }
    await this.ensureDefaultSuperadmin();
  }

  async readData(): Promise<AppData> {
    return {
      storeProfiles: await this.all("SELECT payload_json FROM storeProfiles ORDER BY rowid ASC", mapJsonPayload<StoreProfile>),
      onlineStorefronts: await this.all("SELECT payload_json FROM onlineStorefronts ORDER BY rowid ASC", mapJsonPayload<OnlineStorefront>),
      authUsers: await this.all("SELECT payload_json FROM authUsers ORDER BY rowid ASC", mapJsonPayload<AuthUser>),
      systemConfigs: normalizeSystemConfigs(await this.all("SELECT payload_json FROM systemConfigs ORDER BY rowid ASC", mapJsonPayload<SystemConfig>)),
      staffInvites: await this.all("SELECT payload_json FROM staffInvites ORDER BY rowid DESC", mapJsonPayload<StaffInvite>),
      storeOwnerInvites: await this.all("SELECT payload_json FROM storeOwnerInvites ORDER BY rowid DESC", mapJsonPayload<StoreOwnerInvite>),
      storeOwnerApplications: await this.all("SELECT payload_json FROM storeOwnerApplications ORDER BY rowid DESC", mapJsonPayload<StoreOwnerApplication>),
      staff: await this.all("SELECT * FROM staff ORDER BY rowid ASC", mapStaff),
      customers: await this.all("SELECT * FROM customers ORDER BY rowid ASC", mapCustomer),
      tagDefinitions: await this.all("SELECT payload_json FROM tagDefinitions ORDER BY rowid ASC", mapJsonPayload<TagDefinition>),
      services: await this.all("SELECT * FROM services ORDER BY rowid ASC", mapService),
      products: await this.all("SELECT * FROM products ORDER BY rowid ASC", mapProduct),
      appointments: await this.all("SELECT * FROM appointments ORDER BY rowid ASC", mapAppointment),
      onlineBookingRequests: await this.all("SELECT payload_json FROM onlineBookingRequests ORDER BY rowid DESC", mapJsonPayload<OnlineBookingRequest>),
      staffUnavailableSlots: await this.all(
        "SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC",
        mapStaffUnavailableSlot,
      ),
      staffShifts: await this.all("SELECT payload_json FROM staffShifts ORDER BY rowid DESC", mapJsonPayload<StaffShift>),
      memberCards: await this.all("SELECT * FROM memberCards ORDER BY rowid ASC", mapMemberCard),
      distributors: await this.all("SELECT payload_json FROM distributors ORDER BY rowid DESC", mapJsonPayload<Distributor>),
      referralRelations: await this.all("SELECT payload_json FROM referralRelations ORDER BY rowid DESC", mapJsonPayload<ReferralRelation>),
      orders: await this.all("SELECT * FROM orders ORDER BY rowid DESC", mapOrder),
      refunds: await this.all("SELECT * FROM refunds ORDER BY rowid DESC", mapRefund),
      commissions: await this.all("SELECT * FROM commissions ORDER BY rowid DESC", mapCommission),
      distributionCommissions: await this.all("SELECT payload_json FROM distributionCommissions ORDER BY rowid DESC", mapJsonPayload<DistributionCommission>),
      commissionSettlements: await this.all("SELECT payload_json FROM commissionSettlements ORDER BY rowid DESC", mapJsonPayload<CommissionSettlement>),
      inventoryLogs: await this.all("SELECT * FROM inventoryLogs ORDER BY rowid DESC", mapInventoryLog),
      memberCardTransactions: await this.all(
        "SELECT * FROM memberCardTransactions ORDER BY rowid DESC",
        mapMemberCardTransaction,
      ),
      operationLogs: await this.all("SELECT * FROM operationLogs ORDER BY rowid DESC", mapOperationLog),
      notifications: await this.all("SELECT payload_json FROM notifications ORDER BY rowid DESC", mapJsonPayload<SystemNotification>),
      dailyCloses: await this.all("SELECT * FROM dailyCloses ORDER BY businessDate DESC", mapDailyClose),
      approvalRequests: await this.all("SELECT payload_json FROM approvalRequests ORDER BY rowid DESC", mapJsonPayload<ApprovalRequest>),
      customerServiceRecords: await this.all(
        "SELECT payload_json FROM customerServiceRecords ORDER BY rowid DESC",
        mapJsonPayload<CustomerServiceRecord>,
      ),
      customerSignatures: await this.all("SELECT payload_json FROM customerSignatures ORDER BY rowid DESC", mapJsonPayload<CustomerSignature>),
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

    this.writeJsonTable(statements, "storeProfiles", data.storeProfiles);
    this.writeJsonTable(statements, "onlineStorefronts", data.onlineStorefronts);
    this.writeJsonTable(statements, "authUsers", data.authUsers);
    this.writeJsonTable(statements, "systemConfigs", data.systemConfigs);
    this.writeJsonTable(statements, "staffInvites", data.staffInvites);
    this.writeJsonTable(statements, "storeOwnerInvites", data.storeOwnerInvites ?? []);
    this.writeJsonTable(statements, "storeOwnerApplications", data.storeOwnerApplications ?? []);

    for (const staff of data.staff) {
      statements.push(this.statement("INSERT INTO staff (id, name, phone, role, status, accountId, hiredAt, baseSalary, commissionRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        staff.id,
        staff.name,
        staff.phone,
        staff.role,
        staff.status,
        staff.accountId ?? null,
        staff.hiredAt ?? null,
        staff.baseSalary ?? null,
        staff.commissionRate ?? null,
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

    this.writeJsonTable(statements, "tagDefinitions", data.tagDefinitions);

    for (const service of data.services) {
      statements.push(
        this.statement(
          "INSERT INTO services (id, name, category, price, duration, defaultTimes, consumables_json, consumableProductId, consumableQty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            service.id,
            service.name,
            service.category,
            service.price,
            service.duration,
            service.defaultTimes ?? 1,
            JSON.stringify(service.consumables ?? []),
            service.consumableProductId ?? null,
            service.consumableQty ?? null,
          ],
        ),
      );
    }

    for (const product of data.products) {
      statements.push(
        this.statement("INSERT INTO products (id, name, type, category, subcategory, unit, price, cost, stock, warningStock, shelfLifeMonths, expiryAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          product.id,
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
        ]),
      );
    }

    for (const appointment of data.appointments) {
      statements.push(
        this.statement("INSERT INTO appointments (id, customerId, staffId, serviceId, startAt, roomName, status, note, arrivedAt, completedAt, canceledAt, cancelReason, noShowAt, rescheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          appointment.id,
          appointment.customerId,
          appointment.staffId,
          appointment.serviceId,
          appointment.startAt,
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
        ]),
      );
    }

    this.writeJsonTable(statements, "onlineBookingRequests", data.onlineBookingRequests);

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

    this.writeJsonTable(statements, "distributors", data.distributors);
    this.writeJsonTable(statements, "referralRelations", data.referralRelations);

    for (const order of data.orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, orderNo, customerId, guestName, guestPhone, staffId, serviceId, productId, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            order.id,
            order.orderNo,
            order.customerId,
            order.guestName ?? null,
            order.guestPhone ?? null,
            order.staffId,
            order.serviceId,
            order.productId ?? null,
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
          "INSERT INTO commissions (id, staffId, orderId, type, baseAmount, rate, amount, status, createdAt, settledAt, settlementId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    this.writeJsonTable(statements, "distributionCommissions", data.distributionCommissions);
    this.writeJsonTable(statements, "commissionSettlements", data.commissionSettlements);

    for (const log of data.inventoryLogs) {
      statements.push(
        this.statement("INSERT INTO inventoryLogs (id, productId, type, delta, stockAfter, note, expiryAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
          log.id,
          log.productId,
          log.type,
          log.delta,
          log.stockAfter,
          log.note,
          log.expiryAt ?? null,
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

    this.writeJsonTable(statements, "notifications", data.notifications ?? []);

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
    this.writeJsonTable(statements, "customerSignatures", data.customerSignatures ?? []);
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

  private async ensureDefaultSuperadmin() {
    const data = await this.readData();
    if (data.authUsers.some((user) => user.role === "superadmin")) return;
    const admin = seedData.authUsers.find((user) => user.role === "superadmin");
    if (!admin) return;
    await this.replaceData({
      ...data,
      authUsers: [admin, ...data.authUsers],
    });
  }

  private statement(query: string, values: D1Value[]) {
    return this.db.prepare(query).bind(...values);
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
    category: value.category ?? undefined,
    subcategory: value.subcategory ?? undefined,
    shelfLifeMonths: value.shelfLifeMonths ?? undefined,
    expiryAt: value.expiryAt ?? undefined,
  };
}

function mapAppointment(row: unknown): Appointment {
  const value = row as Appointment;
  return {
    ...value,
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
    serviceId: value.serviceId ?? undefined,
    serviceIds: value.serviceIds_json ? (JSON.parse(value.serviceIds_json) as string[]) : undefined,
  };
}

function mapOrder(row: unknown): Order {
  const value = row as Order;
  return {
    ...value,
    guestName: value.guestName ?? undefined,
    guestPhone: value.guestPhone ?? undefined,
    productId: value.productId ?? undefined,
    cardId: value.cardId ?? undefined,
    discountAmount: value.discountAmount ?? 0,
    adjustmentReason: value.adjustmentReason ?? undefined,
    approvalId: value.approvalId ?? undefined,
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
  const value = row as InventoryLog;
  return { ...value, expiryAt: value.expiryAt ?? undefined };
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
