import { seedData } from "../domain/seed";
import { normalizeSystemConfigs } from "../domain/business";
import { normalizeProductServiceFields, productServiceStockDeductible, productServiceUnit, productServiceUnitsPerStockUnit } from "../domain/products";
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
} from "../domain/types";
import type { D1DatabaseBinding, D1PreparedStatement, D1Value } from "./d1Types";

export type D1DataTableName = keyof AppData;

const tableNames: D1DataTableName[] = [
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
    const [
      storeProfiles,
      onlineStorefronts,
      authUsers,
      systemConfigs,
      staffInvites,
      storeOwnerInvites,
      storeOwnerApplications,
      staff,
      customers,
      tagDefinitions,
      services,
      products,
      inventoryBatches,
      appointments,
      onlineBookingRequests,
      staffUnavailableSlots,
      staffShifts,
      memberCards,
      distributors,
      referralRelations,
      orders,
      refunds,
      commissions,
      distributionCommissions,
      commissionSettlements,
      inventoryLogs,
      memberCardTransactions,
      operationLogs,
      notifications,
      dailyCloses,
      approvalRequests,
      customerServiceRecords,
      customerSignatures,
      customerFollowUps,
      suppliers,
      purchaseOrders,
      stocktakes,
    ] = await Promise.all([
      this.all("SELECT payload_json FROM storeProfiles ORDER BY rowid ASC", mapJsonPayload<StoreProfile>),
      this.all("SELECT payload_json FROM onlineStorefronts ORDER BY rowid ASC", mapJsonPayload<OnlineStorefront>),
      this.all("SELECT payload_json FROM authUsers ORDER BY rowid ASC", mapJsonPayload<AuthUser>),
      this.all("SELECT payload_json FROM systemConfigs ORDER BY rowid ASC", mapJsonPayload<SystemConfig>),
      this.all("SELECT payload_json FROM staffInvites ORDER BY rowid DESC", mapJsonPayload<StaffInvite>),
      this.all("SELECT payload_json FROM storeOwnerInvites ORDER BY rowid DESC", mapJsonPayload<StoreOwnerInvite>),
      this.all("SELECT payload_json FROM storeOwnerApplications ORDER BY rowid DESC", mapJsonPayload<StoreOwnerApplication>),
      this.all("SELECT * FROM staff ORDER BY rowid ASC", mapStaff),
      this.all("SELECT * FROM customers ORDER BY rowid ASC", mapCustomer),
      this.all("SELECT payload_json FROM tagDefinitions ORDER BY rowid ASC", mapJsonPayload<TagDefinition>),
      this.all("SELECT * FROM services ORDER BY rowid ASC", mapService),
      this.all("SELECT * FROM products ORDER BY rowid ASC", mapProduct),
      this.all("SELECT payload_json FROM inventoryBatches ORDER BY rowid DESC", mapJsonPayload<InventoryBatch>),
      this.all("SELECT * FROM appointments ORDER BY rowid ASC", mapAppointment),
      this.all("SELECT payload_json FROM onlineBookingRequests ORDER BY rowid DESC", mapJsonPayload<OnlineBookingRequest>),
      this.all("SELECT * FROM staffUnavailableSlots ORDER BY startAt ASC", mapStaffUnavailableSlot),
      this.all("SELECT payload_json FROM staffShifts ORDER BY rowid DESC", mapJsonPayload<StaffShift>),
      this.all("SELECT * FROM memberCards ORDER BY rowid ASC", mapMemberCard),
      this.all("SELECT payload_json FROM distributors ORDER BY rowid DESC", mapJsonPayload<Distributor>),
      this.all("SELECT payload_json FROM referralRelations ORDER BY rowid DESC", mapJsonPayload<ReferralRelation>),
      this.all("SELECT * FROM orders ORDER BY rowid DESC", mapOrder),
      this.all("SELECT * FROM refunds ORDER BY rowid DESC", mapRefund),
      this.all("SELECT * FROM commissions ORDER BY rowid DESC", mapCommission),
      this.all("SELECT payload_json FROM distributionCommissions ORDER BY rowid DESC", mapJsonPayload<DistributionCommission>),
      this.all("SELECT payload_json FROM commissionSettlements ORDER BY rowid DESC", mapJsonPayload<CommissionSettlement>),
      this.all("SELECT * FROM inventoryLogs ORDER BY rowid DESC", mapInventoryLog),
      this.all("SELECT * FROM memberCardTransactions ORDER BY rowid DESC", mapMemberCardTransaction),
      this.all("SELECT * FROM operationLogs ORDER BY rowid DESC", mapOperationLog),
      this.all("SELECT payload_json FROM notifications ORDER BY rowid DESC", mapJsonPayload<SystemNotification>),
      this.all("SELECT * FROM dailyCloses ORDER BY businessDate DESC", mapDailyClose),
      this.all("SELECT payload_json FROM approvalRequests ORDER BY rowid DESC", mapJsonPayload<ApprovalRequest>),
      this.all("SELECT payload_json FROM customerServiceRecords ORDER BY rowid DESC", mapJsonPayload<CustomerServiceRecord>),
      this.all("SELECT payload_json FROM customerSignatures ORDER BY rowid DESC", mapJsonPayload<CustomerSignature>),
      this.all("SELECT payload_json FROM customerFollowUps ORDER BY rowid DESC", mapJsonPayload<CustomerFollowUp>),
      this.all("SELECT payload_json FROM suppliers ORDER BY rowid DESC", mapJsonPayload<Supplier>),
      this.all("SELECT payload_json FROM purchaseOrders ORDER BY rowid DESC", mapJsonPayload<PurchaseOrder>),
      this.all("SELECT payload_json FROM stocktakes ORDER BY rowid DESC", mapJsonPayload<Stocktake>),
    ]);

    return {
      storeProfiles,
      onlineStorefronts,
      authUsers,
      systemConfigs: normalizeSystemConfigs(systemConfigs),
      staffInvites,
      storeOwnerInvites,
      storeOwnerApplications,
      staff,
      customers,
      tagDefinitions,
      services,
      products,
      inventoryBatches,
      appointments,
      onlineBookingRequests,
      staffUnavailableSlots,
      staffShifts,
      memberCards,
      distributors,
      referralRelations,
      orders,
      refunds,
      commissions,
      distributionCommissions,
      commissionSettlements,
      inventoryLogs,
      memberCardTransactions,
      operationLogs,
      notifications,
      dailyCloses,
      approvalRequests,
      customerServiceRecords,
      customerSignatures,
      customerFollowUps,
      suppliers,
      purchaseOrders,
      stocktakes,
    };
  }

  async readDataTables(keys: readonly D1DataTableName[]): Promise<AppData> {
    const data = emptyData();
    await Promise.all(Array.from(new Set(keys)).map(async (key) => {
      data[key] = await this.readTable(key) as never;
    }));
    data.systemConfigs = normalizeSystemConfigs(data.systemConfigs);
    return data;
  }

  async replacePublicSignatureData(data: AppData) {
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM customerSignatures"),
      this.db.prepare("DELETE FROM orders"),
      this.db.prepare("DELETE FROM memberCards"),
      this.db.prepare("DELETE FROM memberCardTransactions"),
    ];
    this.writeJsonTable(statements, "customerSignatures", data.customerSignatures ?? []);
    this.writeOrderStatements(statements, data.orders ?? []);
    this.writeMemberCardStatements(statements, data.memberCards ?? []);
    this.writeMemberCardTransactionStatements(statements, data.memberCardTransactions ?? []);
    await this.db.batch(statements);
  }

  async replaceData(data: AppData) {
    const statements: D1PreparedStatement[] = [];
    for (const tableName of [...tableNames].reverse()) {
      statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
    }
    statements.push(...this.writeDataStatements(data));
    await this.db.batch(statements);
  }

  async reserveCheckoutSubmission(id: string, createdAt: string) {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS checkoutSubmissionLocks (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL)").run();
    const cutoff = new Date(Date.parse(createdAt) - 10 * 60 * 1000).toISOString();
    await this.db.prepare("DELETE FROM checkoutSubmissionLocks WHERE createdAt < ?").bind(cutoff).run();
    const result = await this.db.prepare("INSERT OR IGNORE INTO checkoutSubmissionLocks (id, createdAt) VALUES (?, ?)").bind(id, createdAt).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  private async all<T>(query: string, mapper: (row: unknown) => T) {
    const result = await this.db.prepare(query).all();
    return (result.results ?? []).map(mapper);
  }

  private readTable(key: D1DataTableName) {
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

  private writeOrderStatements(statements: D1PreparedStatement[], orders: Order[]) {
    for (const order of orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceName, servicePrice, serviceConsumables_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }
  }

  private writeMemberCardStatements(statements: D1PreparedStatement[], memberCards: MemberCard[]) {
    for (const card of memberCards) {
      statements.push(
        this.statement(
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }
  }

  private writeMemberCardTransactionStatements(statements: D1PreparedStatement[], transactions: MemberCardTransaction[]) {
    for (const transaction of transactions) {
      statements.push(
        this.statement(
          "INSERT INTO memberCardTransactions (id, storeId, memberCardId, orderId, staffId, type, paidAmount, payMethod, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }
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
      statements.push(this.statement("INSERT INTO staff (id, storeId, name, phone, role, status, accountId, hiredAt, baseSalary, commissionRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
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
      ]));
    }

    for (const customer of data.customers) {
      statements.push(
        this.statement("INSERT INTO customers (id, storeId, name, phone, level, points, birthday, nextFollowUpAt, note, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
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
        ]),
      );
    }

    this.writeJsonTable(statements, "tagDefinitions", data.tagDefinitions);

    for (const service of data.services) {
      statements.push(
        this.statement(
          "INSERT INTO services (id, storeId, name, category, subcategory, price, duration, defaultTimes, consumables_json, consumableProductId, consumableQty, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    for (const product of data.products) {
      statements.push(
        this.statement("INSERT INTO products (id, storeId, name, type, category, subcategory, unit, price, cost, stock, warningStock, shelfLifeMonths, expiryAt, serviceStockDeductible, serviceUsesPerUnit, serviceUnit, serviceUnitsPerStockUnit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
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
          productServiceStockDeductible(product) ? 1 : 0,
          productServiceStockDeductible(product) ? productServiceUnitsPerStockUnit(product) : null,
          productServiceStockDeductible(product) ? productServiceUnit(product) : null,
          productServiceStockDeductible(product) ? productServiceUnitsPerStockUnit(product) : null,
          product.status ?? "启用",
        ]),
      );
    }

    this.writeJsonTable(statements, "inventoryBatches", data.inventoryBatches ?? []);

    for (const appointment of data.appointments) {
      statements.push(
        this.statement("INSERT INTO appointments (id, storeId, customerId, staffId, serviceId, serviceIds_json, startAt, endAt, roomName, status, note, arrivedAt, completedAt, canceledAt, cancelReason, noShowAt, rescheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
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
        ]),
      );
    }

    this.writeJsonTable(statements, "onlineBookingRequests", data.onlineBookingRequests);

    for (const slot of data.staffUnavailableSlots) {
      statements.push(
        this.statement(
          "INSERT INTO staffUnavailableSlots (id, storeId, staffId, startAt, endAt, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [slot.id, slot.storeId ?? null, slot.staffId, slot.startAt, slot.endAt, slot.reason, slot.createdBy, slot.createdAt],
        ),
      );
    }

    this.writeJsonTable(statements, "staffShifts", data.staffShifts);

    for (const card of data.memberCards) {
      statements.push(
        this.statement(
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    this.writeJsonTable(statements, "distributors", data.distributors);
    this.writeJsonTable(statements, "referralRelations", data.referralRelations);

    for (const order of data.orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceName, servicePrice, serviceConsumables_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    for (const refund of data.refunds) {
      statements.push(
        this.statement("INSERT INTO refunds (id, storeId, orderId, amount, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          refund.id,
          refund.storeId ?? null,
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
        this.statement("INSERT INTO inventoryLogs (id, storeId, productId, type, delta, stockAfter, note, expiryAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          log.id,
          log.storeId ?? null,
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
          "INSERT INTO memberCardTransactions (id, storeId, memberCardId, orderId, staffId, type, paidAmount, payMethod, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          ],
        ),
      );
    }

    for (const log of data.operationLogs) {
      statements.push(
        this.statement(
          "INSERT INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [log.id, log.storeId ?? null, log.userId, log.action, log.targetType, log.targetId, log.summary, log.createdAt],
        ),
      );
    }

    this.writeJsonTable(statements, "notifications", data.notifications ?? []);

    for (const close of data.dailyCloses) {
      statements.push(
        this.statement(
          "INSERT INTO dailyCloses (id, storeId, businessDate, revenue, refundAmount, orderCount, cashAmount, wechatAmount, alipayAmount, cardAmount, memberCardAmount, commissionAmount, createdBy, createdAt, status, reversedBy, reversedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
  const value = row as Product & {
    serviceStockDeductible?: boolean | number | null;
    serviceUnit?: string | null;
    serviceUnitsPerStockUnit?: number | null;
    serviceUsesPerUnit?: number | null;
  };
  return normalizeProductServiceFields({
    ...value,
    storeId: value.storeId ?? undefined,
    category: value.category ?? undefined,
    subcategory: value.subcategory ?? undefined,
    shelfLifeMonths: value.shelfLifeMonths ?? undefined,
    expiryAt: value.expiryAt ?? undefined,
    status: value.status ?? "启用",
    serviceStockDeductible: value.serviceStockDeductible === undefined || value.serviceStockDeductible === null
      ? undefined
      : Boolean(value.serviceStockDeductible),
    serviceUnit: value.serviceUnit ?? undefined,
    serviceUnitsPerStockUnit: value.serviceUnitsPerStockUnit ?? value.serviceUsesPerUnit ?? undefined,
    serviceUsesPerUnit: value.serviceUsesPerUnit ?? undefined,
  });
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
