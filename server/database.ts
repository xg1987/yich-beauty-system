import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedData } from "../src/domain/seed";
import { normalizeSystemConfigs } from "../src/domain/business";
import {
  buildCashierFlowListItemsForKeys,
  type CashierFlowDetailResult,
  type CashierFlowListItem,
  type CashierFlowPageResult,
  type CashierFlowRelatedData,
  type CashierFlowSourceKey,
  type PosContextResult,
} from "../src/domain/cashierFlow";
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
  ServiceCardSelection,
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
const CASHIER_FLOW_MAX_PAGE_SIZE = 50;
const CASHIER_FLOW_CASH_IN_PREDICATE = `
  t.type IN ('开卡', '充值')
  AND CASE WHEN t.paidAmount IS NOT NULL THEN t.paidAmount ELSE t.amountDelta END > 0
`;
const MEMBER_CARD_CASH_REFUND_PREDICATE = `
  t.type IN ('退款', '退卡', '作废')
  AND CASE WHEN t.paidAmount IS NOT NULL THEN t.paidAmount ELSE -t.amountDelta END > 0
`;
const CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE = `
  COALESCE(TRIM(t.storeId), '') = ''
  AND COALESCE(
    NULLIF(TRIM(linkedOrder.storeId), ''),
    NULLIF(TRIM(linkedCard.storeId), ''),
    NULLIF(TRIM(linkedCustomer.storeId), '')
  ) = ?
`;
const CASHIER_FLOW_TRANSACTION_STORE_PREDICATE = `
  (t.storeId = ? OR (${CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE}))
`;
const CASHIER_FLOW_SERVICE_RECORD_STORE_PREDICATE = `
  (json_extract(record.payload_json, '$.storeId') = ? OR (
    COALESCE(json_extract(record.payload_json, '$.storeId'), '') = ''
    AND (
      json_extract(record.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
      OR json_extract(record.payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
    )
    AND NOT EXISTS (SELECT 1 FROM customers WHERE id = json_extract(record.payload_json, '$.customerId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
    AND NOT EXISTS (SELECT 1 FROM orders WHERE id = json_extract(record.payload_json, '$.orderId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
  ))
`;
const CASHIER_FLOW_SIGNATURE_STORE_PREDICATE = `
  (json_extract(signature.payload_json, '$.storeId') = ? OR (
    COALESCE(json_extract(signature.payload_json, '$.storeId'), '') = ''
    AND (
      json_extract(signature.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
      OR json_extract(signature.payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
      OR json_extract(signature.payload_json, '$.serviceRecordId') IN (
        SELECT record.id FROM customerServiceRecords record WHERE ${CASHIER_FLOW_SERVICE_RECORD_STORE_PREDICATE}
      )
    )
    AND NOT EXISTS (SELECT 1 FROM customers WHERE id = json_extract(signature.payload_json, '$.customerId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
    AND NOT EXISTS (SELECT 1 FROM orders WHERE id = json_extract(signature.payload_json, '$.orderId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
    AND NOT EXISTS (
      SELECT 1 FROM customerServiceRecords record
      WHERE record.id = json_extract(signature.payload_json, '$.serviceRecordId')
        AND (
          (COALESCE(json_extract(record.payload_json, '$.storeId'), '') <> '' AND json_extract(record.payload_json, '$.storeId') <> ?)
          OR (COALESCE(json_extract(record.payload_json, '$.storeId'), '') = '' AND (
            NOT (
              json_extract(record.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(record.payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
            )
            OR EXISTS (SELECT 1 FROM customers WHERE id = json_extract(record.payload_json, '$.customerId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
            OR EXISTS (SELECT 1 FROM orders WHERE id = json_extract(record.payload_json, '$.orderId') AND storeId IS NOT NULL AND storeId <> '' AND storeId <> ?)
          ))
        )
    )
  ))
`;

export type TableName = keyof AppData;

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

  readCashierFlowPage(storeId: string, page: number, pageSize: number): CashierFlowPageResult {
    const totalCount = this.readCashierFlowTotal(storeId);
    const normalized = normalizeCashierFlowPage(page, pageSize, totalCount);
    const keys = this.db.prepare(
      `WITH flowKeys AS (
         SELECT 'order' AS kind, orders.id, orders.createdAt, 0 AS kindRank, orders.rowid AS sourceRowId
         FROM orders
         WHERE orders.storeId = ?
         UNION ALL
         SELECT 'memberCard' AS kind, t.id, t.createdAt, 1 AS kindRank, t.rowid AS sourceRowId
         FROM memberCardTransactions t
         WHERE t.storeId = ?
           AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
         UNION ALL
         SELECT 'memberCard' AS kind, t.id, t.createdAt, 1 AS kindRank, t.rowid AS sourceRowId
         FROM memberCardTransactions t
         LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
         LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
         LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
         WHERE ${CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE}
           AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
       )
       SELECT kind, id
       FROM flowKeys
       ORDER BY createdAt DESC, kindRank ASC, sourceRowId DESC, id DESC
       LIMIT ? OFFSET ?`,
    ).all(
      storeId,
      storeId,
      storeId,
      normalized.pageSize,
      (normalized.page - 1) * normalized.pageSize,
    ) as Array<CashierFlowSourceKey>;

    return {
      items: this.readCashierFlowItemsForKeys(storeId, keys),
      ...normalized,
      totalCount,
      generatedAt: new Date().toISOString(),
    };
  }

  readCashierFlowDetail(
    storeId: string,
    kind: CashierFlowListItem["kind"],
    id: string,
  ): CashierFlowDetailResult | undefined {
    const key = { kind, id } satisfies CashierFlowSourceKey;
    const record = this.readCashierFlowItemsForKeys(storeId, [key])[0];
    if (!record) return undefined;

    const sourceOrder = kind === "order" ? this.readOrderForStore(storeId, id) : undefined;
    const sourceTransaction = kind === "memberCard" ? this.readMemberCardTransactionForStore(storeId, id) : undefined;
    if ((kind === "order" && !sourceOrder) || (kind === "memberCard" && !sourceTransaction)) return undefined;

    return {
      record,
      data: this.readCashierFlowRelatedData(storeId, {
        orders: sourceOrder ? [sourceOrder] : [],
        transactions: sourceTransaction ? [sourceTransaction] : [],
      }),
    };
  }

  readPosContext(
    storeId: string,
    input: { dayStart: string; dayEnd: string; appointmentId?: string; signatureId?: string },
  ): PosContextResult {
    const todayOrder = this.db.prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN payMethod <> '会员卡' THEN paidAmount ELSE 0 END), 0) AS paid
       FROM orders
       WHERE storeId = ? AND createdAt >= ? AND createdAt < ?`,
    ).get(storeId, input.dayStart, input.dayEnd) as { count: number; paid: number };
    const todayMemberCard = this.db.prepare(
      `WITH memberCardCash AS (
         SELECT t.paidAmount, t.amountDelta
         FROM memberCardTransactions t
         WHERE t.storeId = ?
           AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
           AND t.createdAt >= ? AND t.createdAt < ?
         UNION ALL
         SELECT t.paidAmount, t.amountDelta
         FROM memberCardTransactions t
         LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
         LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
         LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
         WHERE ${CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE}
           AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
           AND t.createdAt >= ? AND t.createdAt < ?
       )
       SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN paidAmount IS NOT NULL THEN paidAmount ELSE amountDelta END), 0) AS paid
       FROM memberCardCash`,
    ).get(storeId, input.dayStart, input.dayEnd, storeId, input.dayStart, input.dayEnd) as { count: number; paid: number };
    const todayMemberCardRefund = this.db.prepare(
      `WITH memberCardRefund AS (
         SELECT t.paidAmount, t.amountDelta
         FROM memberCardTransactions t
         WHERE t.storeId = ?
           AND ${MEMBER_CARD_CASH_REFUND_PREDICATE}
           AND t.createdAt >= ? AND t.createdAt < ?
         UNION ALL
         SELECT t.paidAmount, t.amountDelta
         FROM memberCardTransactions t
         LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
         LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
         LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
         WHERE ${CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE}
           AND ${MEMBER_CARD_CASH_REFUND_PREDICATE}
           AND t.createdAt >= ? AND t.createdAt < ?
       )
       SELECT COALESCE(SUM(CASE WHEN paidAmount IS NOT NULL THEN paidAmount ELSE -amountDelta END), 0) AS paid
       FROM memberCardRefund`,
    ).get(storeId, input.dayStart, input.dayEnd, storeId, input.dayStart, input.dayEnd) as { paid: number };
    const arrivedAppointments = this.db.prepare(
      `SELECT appointments.*
       FROM appointments
       WHERE appointments.storeId = ?
         AND appointments.status = '已到店'
         AND NOT EXISTS (
           SELECT 1 FROM orders
           WHERE orders.storeId = appointments.storeId
             AND orders.appointmentId = appointments.id
             AND orders.status <> '已退款'
         )
       ORDER BY appointments.startAt ASC, appointments.rowid ASC`,
    ).all(storeId).map(mapAppointment);

    const requestedAppointment = input.appointmentId
      ? this.readAppointmentForStore(storeId, input.appointmentId)
      : undefined;
    const requestedSignature = input.signatureId
      ? this.readCustomerSignatureByIdForStore(input.signatureId, storeId)
      : undefined;

    return {
      cashierFlowTotal: this.readCashierFlowTotal(storeId),
      todayPaid: Number(todayOrder.paid ?? 0) + Number(todayMemberCard.paid ?? 0) - Number(todayMemberCardRefund.paid ?? 0),
      todayOrderCount: Number(todayOrder.count ?? 0),
      todayMemberCardIncomeCount: Number(todayMemberCard.count ?? 0),
      arrivedAppointments,
      data: this.readCashierFlowRelatedData(storeId, {
        appointments: requestedAppointment ? [requestedAppointment] : [],
        signatures: requestedSignature ? [requestedSignature] : [],
      }),
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

  replaceDataTables(data: AppData, keys: readonly TableName[]) {
    const uniqueKeys = Array.from(new Set(keys));
    const previousData = this.readDataTables(uniqueKeys);
    this.applyTableChanges(previousData, data, uniqueKeys);
  }

  replaceStoreData(storeId: string, data: AppData) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const storeData = dataForStoreWrite(data, storeId);
      this.deleteStoreData(storeId);
      for (const tableName of tableNames) {
        const deleteById = this.db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
        for (const row of storeData[tableName] as Array<{ id: string }>) deleteById.run(row.id);
      }
      this.writeData(storeData);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  replaceStoreTables(storeId: string, data: AppData, keys: readonly TableName[]) {
    const uniqueKeys = Array.from(new Set(keys));
    const previousData = this.readDataTablesForStore(uniqueKeys, storeId);
    this.applyStoreTableChanges(storeId, previousData, data, uniqueKeys);
  }

  applyTableChanges(previousData: AppData, nextData: AppData, keys: readonly TableName[]) {
    this.applyTableChangesInternal(previousData, nextData, keys);
  }

  applyStoreTableChanges(storeId: string, previousData: AppData, nextData: AppData, keys: readonly TableName[]) {
    this.applyTableChangesInternal(
      dataForStoreWrite(previousData, storeId),
      dataForStoreWrite(nextData, storeId),
      keys,
    );
  }

  upsertCustomerSignatures(signatures: readonly CustomerSignature[]) {
    if (!signatures.length) return;
    const statement = this.db.prepare("INSERT OR REPLACE INTO customerSignatures (id, payload_json) VALUES (?, ?)");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      signatures.forEach((signature) => statement.run(signature.id, JSON.stringify(signature)));
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  readCustomerSignatureById(id: string) {
    const row = this.db.prepare("SELECT payload_json FROM customerSignatures WHERE id = ? LIMIT 1").get(id);
    return row ? mapJsonPayload<CustomerSignature>(row) : undefined;
  }

  readCustomerSignatureByIdForStore(id: string, storeId: string) {
    const row = this.db.prepare(
      `SELECT signature.payload_json
       FROM customerSignatures signature
       WHERE signature.id = ?
         AND ${CASHIER_FLOW_SIGNATURE_STORE_PREDICATE}
       LIMIT 1`,
    ).get(id, ...Array<string>(15).fill(storeId));
    return row ? mapJsonPayload<CustomerSignature>(row) : undefined;
  }

  readCustomerSignatureByToken(token: string) {
    const row = this.db.prepare("SELECT payload_json FROM customerSignatures WHERE json_extract(payload_json, '$.token') = ? ORDER BY rowid DESC LIMIT 1").get(token);
    return row ? mapJsonPayload<CustomerSignature>(row) : undefined;
  }

  private readCashierFlowTotal(storeId: string) {
    const row = this.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE storeId = ?)
         +
         (SELECT COUNT(*)
          FROM memberCardTransactions t
          WHERE t.storeId = ?
            AND ${CASHIER_FLOW_CASH_IN_PREDICATE})
         +
         (SELECT COUNT(*)
          FROM memberCardTransactions t
          LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
          LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
          LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
          WHERE ${CASHIER_FLOW_LEGACY_TRANSACTION_STORE_PREDICATE}
            AND ${CASHIER_FLOW_CASH_IN_PREDICATE}) AS count`,
    ).get(storeId, storeId, storeId) as { count: number };
    return Number(row.count ?? 0);
  }

  private readOrderForStore(storeId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM orders WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, id);
    return row ? mapOrder(row) : undefined;
  }

  private readAppointmentForStore(storeId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM appointments WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, id);
    return row ? mapAppointment(row) : undefined;
  }

  private readMemberCardTransactionForStore(storeId: string, id: string) {
    const row = this.db.prepare(
      `SELECT t.*
       FROM memberCardTransactions t
       LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
       LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
       LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
       WHERE t.id = ?
         AND ${CASHIER_FLOW_TRANSACTION_STORE_PREDICATE}
         AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
       LIMIT 1`,
    ).get(id, storeId, storeId);
    return row ? mapMemberCardTransaction(row) : undefined;
  }

  private readCashierFlowItemsForKeys(storeId: string, requestedKeys: readonly CashierFlowSourceKey[]) {
    const keys = uniqueCashierFlowKeys(requestedKeys).slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    if (!keys.length) return [];
    const orderIds = keys.filter((key) => key.kind === "order").map((key) => key.id);
    const transactionIds = keys.filter((key) => key.kind === "memberCard").map((key) => key.id);
    const orders = orderIds.length
      ? this.all(
          `SELECT * FROM orders WHERE storeId = ? AND id IN (${sqlPlaceholders(orderIds.length)}) ORDER BY rowid DESC`,
          mapOrder,
          [storeId, ...orderIds],
        )
      : [];
    const transactions = transactionIds.length
      ? this.all(
          `SELECT t.*
           FROM memberCardTransactions t
           LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
           LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
           LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
           WHERE t.id IN (${sqlPlaceholders(transactionIds.length)})
             AND ${CASHIER_FLOW_TRANSACTION_STORE_PREDICATE}
             AND ${CASHIER_FLOW_CASH_IN_PREDICATE}
           ORDER BY t.rowid DESC`,
          mapMemberCardTransaction,
          [...transactionIds, storeId, storeId],
        )
      : [];
    const linkedOrderIds = uniqueStrings(transactions.map((transaction) => transaction.orderId)).filter(
      (id) => !orders.some((order) => order.id === id),
    );
    const linkedOrders = linkedOrderIds.length
      ? this.all(
          `SELECT * FROM orders WHERE storeId = ? AND id IN (${sqlPlaceholders(linkedOrderIds.length)}) ORDER BY rowid DESC`,
          mapOrder,
          [storeId, ...linkedOrderIds],
        )
      : [];
    const lookupOrders = dedupeById([...orders, ...linkedOrders]);
    const memberCardIds = uniqueStrings(transactions.map((transaction) => transaction.memberCardId));
    const memberCards = memberCardIds.length
      ? this.all(
          `SELECT linkedCard.*
           FROM memberCards linkedCard
           LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
           WHERE linkedCard.id IN (${sqlPlaceholders(memberCardIds.length)})
             AND (linkedCard.storeId = ? OR (COALESCE(TRIM(linkedCard.storeId), '') = '' AND linkedCustomer.storeId = ?))
           ORDER BY linkedCard.rowid ASC`,
          mapMemberCard,
          [...memberCardIds, storeId, storeId],
        )
      : [];
    const customerIds = uniqueStrings([
      ...lookupOrders.map((order) => order.customerId),
      ...memberCards.map((card) => card.customerId),
    ]);
    const customers = customerIds.length
      ? chunksOf(customerIds).flatMap((ids) => this.all(
          `SELECT * FROM customers WHERE storeId = ? AND id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapCustomer,
          [storeId, ...ids],
        ))
      : [];
    const serviceIds = uniqueStrings(lookupOrders.flatMap((order) => [order.serviceId, ...(order.serviceIds ?? [])]));
    const services = serviceIds.length
      ? chunksOf(serviceIds).flatMap((ids) => this.all(
          `SELECT * FROM services WHERE storeId = ? AND id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapService,
          [storeId, ...ids],
        ))
      : [];
    const productIds = uniqueStrings(lookupOrders.flatMap((order) => [
      order.productId,
      order.giftProductId,
      ...(order.productItems ?? []).map((item) => item.productId),
      ...(order.giftProductItems ?? []).map((item) => item.productId),
    ]));
    const products = productIds.length
      ? chunksOf(productIds).flatMap((ids) => this.all(
          `SELECT * FROM products WHERE storeId = ? AND id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapProduct,
          [storeId, ...ids],
        ))
      : [];
    const operationLogs = memberCardIds.length
      ? this.all(
          `SELECT * FROM operationLogs
           WHERE targetType = 'memberCard'
             AND targetId IN (${sqlPlaceholders(memberCardIds.length)})
             AND action IN ('开卡', '会员卡充值')
             AND (storeId = ? OR storeId IS NULL OR storeId = '')
           ORDER BY rowid DESC`,
          mapOperationLog,
          [...memberCardIds, storeId],
        )
      : [];
    const authUserIds = uniqueStrings(operationLogs.map((log) => log.userId));
    const authUsers = authUserIds.length
      ? chunksOf(authUserIds).flatMap((ids) => this.all(
          `SELECT payload_json FROM authUsers WHERE id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapJsonPayload<AuthUser>,
          ids,
        ))
      : [];
    const staffIds = uniqueStrings([
      ...lookupOrders.map((order) => order.staffId),
      ...transactions.map((transaction) => transaction.staffId),
      ...authUsers.map((user) => user.staffId),
    ]);
    const staff = staffIds.length
      ? chunksOf(staffIds).flatMap((ids) => this.all(
          `SELECT * FROM staff WHERE storeId = ? AND id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapStaff,
          [storeId, ...ids],
        ))
      : [];
    const data = emptyData();
    data.authUsers = authUsers;
    data.customers = customers;
    data.memberCards = memberCards;
    data.memberCardTransactions = transactions;
    data.operationLogs = operationLogs;
    data.orders = lookupOrders;
    data.products = products;
    data.services = services;
    data.staff = staff;
    return buildCashierFlowListItemsForKeys(data, keys);
  }

  private readCashierFlowRelatedData(
    storeId: string,
    input: {
      orders?: readonly Order[];
      transactions?: readonly MemberCardTransaction[];
      appointments?: readonly Appointment[];
      signatures?: readonly CustomerSignature[];
    },
  ): CashierFlowRelatedData {
    let appointments = dedupeById(input.appointments ?? []);
    let signatures = dedupeById(input.signatures ?? []);
    let serviceRecords: CustomerServiceRecord[] = [];
    const explicitServiceRecordIds = uniqueStrings(signatures.map((signature) => signature.serviceRecordId));
    if (explicitServiceRecordIds.length) {
      serviceRecords = this.all(
        `SELECT record.payload_json FROM customerServiceRecords record
         WHERE record.id IN (${sqlPlaceholders(explicitServiceRecordIds.length)})
           AND ${CASHIER_FLOW_SERVICE_RECORD_STORE_PREDICATE}
         ORDER BY record.rowid DESC`,
        mapJsonPayload<CustomerServiceRecord>,
        [...explicitServiceRecordIds, ...Array<string>(5).fill(storeId)],
      );
    }
    let orders = dedupeById(input.orders ?? []);
    const linkedOrderIds = uniqueStrings([
      ...(input.transactions ?? []).map((transaction) => transaction.orderId),
      ...signatures.map((signature) => signature.orderId),
      ...serviceRecords.map((record) => record.orderId),
    ]);
    if (linkedOrderIds.length) {
      orders = dedupeById([
        ...orders,
        ...this.all(
          `SELECT * FROM orders WHERE storeId = ? AND id IN (${sqlPlaceholders(linkedOrderIds.length)}) ORDER BY rowid DESC`,
          mapOrder,
          [storeId, ...linkedOrderIds],
        ),
      ]);
    }
    const requestedAppointmentIds = uniqueStrings(appointments.map((appointment) => appointment.id));
    if (requestedAppointmentIds.length) {
      orders = dedupeById([
        ...orders,
        ...this.all(
          `SELECT * FROM orders
           WHERE storeId = ? AND appointmentId IN (${sqlPlaceholders(requestedAppointmentIds.length)})
           ORDER BY rowid DESC LIMIT 50`,
          mapOrder,
          [storeId, ...requestedAppointmentIds],
        ),
      ]);
    }
    orders = orders.slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    const orderIds = uniqueStrings(orders.map((order) => order.id));
    const refunds = orderIds.length
      ? this.all(
          `SELECT * FROM refunds
           WHERE orderId IN (${sqlPlaceholders(orderIds.length)})
             AND (storeId = ? OR COALESCE(TRIM(storeId), '') = '')
           ORDER BY rowid DESC`,
          mapRefund,
          [...orderIds, storeId],
        )
      : [];
    const approvalRequests = orderIds.length
      ? this.db.prepare(
          `SELECT payload_json FROM approvalRequests
           WHERE json_extract(payload_json, '$.storeId') = ?
             AND json_extract(payload_json, '$.type') = '订单退款'
             AND json_extract(payload_json, '$.targetId') IN (${sqlPlaceholders(orderIds.length)})
           ORDER BY rowid DESC LIMIT 50`,
        ).all(storeId, ...orderIds).map(mapJsonPayload<ApprovalRequest>)
      : [];
    if (orderIds.length) {
      serviceRecords = dedupeById([
        ...serviceRecords,
        ...this.all(
          `SELECT record.payload_json FROM customerServiceRecords record
           WHERE json_extract(record.payload_json, '$.orderId') IN (${sqlPlaceholders(orderIds.length)})
             AND ${CASHIER_FLOW_SERVICE_RECORD_STORE_PREDICATE}
           ORDER BY record.rowid DESC LIMIT 50`,
          mapJsonPayload<CustomerServiceRecord>,
          [...orderIds, ...Array<string>(5).fill(storeId)],
        ),
      ]);
    }
    serviceRecords = serviceRecords.slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    const serviceRecordIds = uniqueStrings(serviceRecords.map((record) => record.id));
    const relatedSignatures = [
      ...(orderIds.length ? this.all(
        `SELECT signature.payload_json FROM customerSignatures signature
         WHERE json_extract(signature.payload_json, '$.orderId') IN (${sqlPlaceholders(orderIds.length)})
           AND ${CASHIER_FLOW_SIGNATURE_STORE_PREDICATE}
         ORDER BY signature.rowid DESC LIMIT 50`,
        mapJsonPayload<CustomerSignature>,
        [...orderIds, ...Array<string>(15).fill(storeId)],
      ) : []),
      ...(serviceRecordIds.length ? this.all(
        `SELECT signature.payload_json FROM customerSignatures signature
         WHERE json_extract(signature.payload_json, '$.serviceRecordId') IN (${sqlPlaceholders(serviceRecordIds.length)})
           AND ${CASHIER_FLOW_SIGNATURE_STORE_PREDICATE}
         ORDER BY signature.rowid DESC LIMIT 50`,
        mapJsonPayload<CustomerSignature>,
        [...serviceRecordIds, ...Array<string>(15).fill(storeId)],
      ) : []),
    ];
    signatures = dedupeById([...signatures, ...relatedSignatures]);
    signatures = signatures.slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    let transactions = dedupeById(input.transactions ?? []);
    if (orderIds.length) {
      transactions = dedupeById([
        ...transactions,
        ...this.all(
          `SELECT t.*
           FROM memberCardTransactions t
           LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
           LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
           LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
           WHERE t.orderId IN (${sqlPlaceholders(orderIds.length)})
             AND ${CASHIER_FLOW_TRANSACTION_STORE_PREDICATE}
           ORDER BY t.rowid DESC LIMIT 50`,
          mapMemberCardTransaction,
          [...orderIds, storeId, storeId],
        ),
      ]);
    }
    transactions = transactions.slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    const appointmentIds = uniqueStrings([
      ...appointments.map((appointment) => appointment.id),
      ...orders.map((order) => order.appointmentId),
    ]);
    if (appointmentIds.length) {
      appointments = dedupeById([
        ...appointments,
        ...this.all(
          `SELECT * FROM appointments WHERE storeId = ? AND id IN (${sqlPlaceholders(appointmentIds.length)}) ORDER BY rowid ASC`,
          mapAppointment,
          [storeId, ...appointmentIds],
        ),
      ]);
    }
    appointments = appointments.slice(0, CASHIER_FLOW_MAX_PAGE_SIZE);
    const directMemberCardIds = uniqueStrings(transactions.map((transaction) => transaction.memberCardId));
    let memberCards = directMemberCardIds.length
      ? this.all(
          `SELECT linkedCard.*
           FROM memberCards linkedCard
           LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
           WHERE linkedCard.id IN (${sqlPlaceholders(directMemberCardIds.length)})
             AND (linkedCard.storeId = ? OR (COALESCE(TRIM(linkedCard.storeId), '') = '' AND linkedCustomer.storeId = ?))
           ORDER BY linkedCard.rowid ASC`,
          mapMemberCard,
          [...directMemberCardIds, storeId, storeId],
        )
      : [];
    const customerIds = uniqueStrings([
      ...orders.map((order) => order.customerId),
      ...appointments.map((appointment) => appointment.customerId),
      ...signatures.map((signature) => signature.customerId),
      ...serviceRecords.map((record) => record.customerId),
      ...memberCards.map((card) => card.customerId),
    ]);
    if (customerIds.length) {
      memberCards = dedupeById([
        ...memberCards,
        ...chunksOf(customerIds).flatMap((ids) => this.all(
            `SELECT linkedCard.*
             FROM memberCards linkedCard
             LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
             WHERE linkedCard.customerId IN (${sqlPlaceholders(ids.length)})
               AND (linkedCard.storeId = ? OR (COALESCE(TRIM(linkedCard.storeId), '') = '' AND linkedCustomer.storeId = ?))
             ORDER BY linkedCard.rowid ASC`,
            mapMemberCard,
            [...ids, storeId, storeId],
          )),
      ]);
    }
    const allCustomerIds = uniqueStrings([...customerIds, ...memberCards.map((card) => card.customerId)]);
    const customers = allCustomerIds.length
      ? chunksOf(allCustomerIds).flatMap((ids) => this.all(
          `SELECT * FROM customers WHERE storeId = ? AND id IN (${sqlPlaceholders(ids.length)}) ORDER BY rowid ASC`,
          mapCustomer,
          [storeId, ...ids],
        ))
      : [];

    return {
      orders,
      refunds,
      memberCardTransactions: transactions,
      customers,
      memberCards,
      appointments,
      approvalRequests,
      customerSignatures: signatures.map(withoutSignatureText),
      customerServiceRecords: serviceRecords,
    };
  }

  private applyTableChangesInternal(previousData: AppData, nextData: AppData, keys: readonly TableName[]) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const uniqueKeys = Array.from(new Set(keys));
      const changedData = emptyData();
      for (const key of uniqueKeys) {
        const previousRows = previousData[key] as Array<{ id: string }>;
        const nextRows = nextData[key] as Array<{ id: string }>;
        const previousById = new Map(previousRows.map((row) => [row.id, JSON.stringify(row)]));
        const nextIds = new Set(nextRows.map((row) => row.id));
        const changedRows = nextRows.filter((row) => previousById.get(row.id) !== JSON.stringify(row));
        const removedIds = previousRows.filter((row) => !nextIds.has(row.id)).map((row) => row.id);
        const deleteById = this.db.prepare(`DELETE FROM ${key} WHERE id = ?`);
        for (const id of [...removedIds, ...changedRows.map((row) => row.id)]) deleteById.run(id);
        changedData[key] = changedRows as never;
      }
      this.writeData(pickDataTables(changedData, uniqueKeys));
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

  releaseCheckoutSubmission(id: string) {
    this.db.prepare("DELETE FROM checkoutSubmissionLocks WHERE id = ?").run(id);
  }

  readMemberCardOpenData(storeId: string, input: { customerId?: string; customerPhone?: string }) {
    const data = this.readDataTablesForStore(["storeProfiles", "authUsers", "staff", "services", "dailyCloses"], storeId);
    if (input.customerId) {
      const row = this.db.prepare("SELECT * FROM customers WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, input.customerId);
      data.customers = row ? [mapCustomer(row)] : [];
    } else if (input.customerPhone) {
      const row = this.db.prepare("SELECT * FROM customers WHERE storeId = ? AND phone = ? LIMIT 1").get(storeId, input.customerPhone);
      data.customers = row ? [mapCustomer(row)] : [];
    }
    return data;
  }

  readMemberCardMutationData(
    storeId: string,
    input: { memberCardId: string; extraCustomerId?: string; signatureId?: string },
  ) {
    const data = this.readDataTablesForStore(["storeProfiles", "authUsers", "services", "dailyCloses"], storeId);
    const cardRow = this.db.prepare("SELECT * FROM memberCards WHERE id = ? AND (storeId = ? OR (storeId IS NULL AND customerId IN (SELECT id FROM customers WHERE storeId = ?))) LIMIT 1").get(input.memberCardId, storeId, storeId);
    data.memberCards = cardRow ? [mapMemberCard(cardRow)] : [];
    const customerIds = Array.from(new Set([data.memberCards[0]?.customerId, input.extraCustomerId].filter((id): id is string => Boolean(id))));
    data.customers = customerIds.flatMap((customerId) => {
      const row = this.db.prepare("SELECT * FROM customers WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, customerId);
      return row ? [mapCustomer(row)] : [];
    });
    data.memberCardTransactions = data.memberCards[0]
      ? (this.db.prepare("SELECT * FROM memberCardTransactions WHERE memberCardId = ? ORDER BY rowid DESC").all(data.memberCards[0].id) as unknown[]).map(mapMemberCardTransaction)
      : [];
    if (input.signatureId) {
      const row = this.db.prepare("SELECT payload_json FROM customerSignatures WHERE id = ? LIMIT 1").get(input.signatureId);
      data.customerSignatures = row ? [mapJsonPayload<CustomerSignature>(row)] : [];
    }
    return data;
  }

  readCustomerSignatureContext(
    storeId: string,
    input: { customerId: string; orderId?: string; serviceRecordId?: string },
  ) {
    const data = this.readDataTablesForStore(["storeProfiles", "authUsers", "staff", "services"], storeId);
    const customerRow = this.db.prepare("SELECT * FROM customers WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, input.customerId);
    data.customers = customerRow ? [mapCustomer(customerRow)] : [];
    const orderRow = input.orderId
      ? this.db.prepare("SELECT * FROM orders WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, input.orderId)
      : undefined;
    data.orders = orderRow ? [mapOrder(orderRow)] : [];
    const serviceRecordRow = input.serviceRecordId
      ? this.db.prepare("SELECT payload_json FROM customerServiceRecords WHERE id = ? AND json_extract(payload_json, '$.storeId') = ? LIMIT 1").get(input.serviceRecordId, storeId)
      : undefined;
    data.customerServiceRecords = serviceRecordRow ? [mapJsonPayload<CustomerServiceRecord>(serviceRecordRow)] : [];
    data.memberCards = (this.db.prepare("SELECT * FROM memberCards WHERE storeId = ? AND customerId = ? ORDER BY rowid ASC").all(storeId, input.customerId) as unknown[]).map(mapMemberCard);
    const order = data.orders[0];
    const appointmentRow = order?.appointmentId
      ? this.db.prepare("SELECT * FROM appointments WHERE storeId = ? AND id = ? LIMIT 1").get(storeId, order.appointmentId)
      : undefined;
    data.appointments = appointmentRow ? [mapAppointment(appointmentRow)] : [];
    data.memberCardTransactions = order
      ? (this.db.prepare("SELECT * FROM memberCardTransactions WHERE storeId = ? AND orderId = ? ORDER BY rowid DESC").all(storeId, order.id) as unknown[]).map(mapMemberCardTransaction)
      : [];
    return data;
  }

  reserveMemberCardSubmission(requestId: string, storeId: string, createdAt: string) {
    const cutoff = new Date(Date.parse(createdAt) - 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM memberCardSubmissionLocks WHERE createdAt < ?").run(cutoff);
    const result = this.db
      .prepare("INSERT OR IGNORE INTO memberCardSubmissionLocks (id, storeId, memberCardId, signatureId, createdAt) VALUES (?, ?, NULL, NULL, ?)")
      .run(requestId, storeId, createdAt) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  readMemberCardSubmissionResult(requestId: string, storeId: string): AppData | undefined {
    const lock = this.db
      .prepare("SELECT memberCardId, signatureId FROM memberCardSubmissionLocks WHERE id = ? AND storeId = ? LIMIT 1")
      .get(requestId, storeId) as { memberCardId?: string | null; signatureId?: string | null } | undefined;
    if (!lock?.memberCardId) return undefined;
    const cardRow = this.db.prepare("SELECT * FROM memberCards WHERE id = ? AND storeId = ? LIMIT 1").get(lock.memberCardId, storeId);
    if (!cardRow) return undefined;
    const card = mapMemberCard(cardRow);
    const customerRow = this.db.prepare("SELECT * FROM customers WHERE id = ? AND storeId = ? LIMIT 1").get(card.customerId, storeId);
    const transactionRow = this.db
      .prepare("SELECT * FROM memberCardTransactions WHERE memberCardId = ? AND storeId = ? AND type = '开卡' ORDER BY rowid DESC LIMIT 1")
      .get(card.id, storeId);
    const operationLogRow = this.db
      .prepare("SELECT * FROM operationLogs WHERE targetType = 'memberCard' AND targetId = ? AND storeId = ? ORDER BY rowid DESC LIMIT 1")
      .get(card.id, storeId);
    const signatureRow = lock.signatureId
      ? this.db.prepare("SELECT payload_json FROM customerSignatures WHERE id = ? LIMIT 1").get(lock.signatureId)
      : undefined;
    return {
      ...emptyData(),
      customers: customerRow ? [mapCustomer(customerRow)] : [],
      memberCards: [card],
      memberCardTransactions: transactionRow ? [mapMemberCardTransaction(transactionRow)] : [],
      operationLogs: operationLogRow ? [mapOperationLog(operationLogRow)] : [],
      customerSignatures: signatureRow ? [mapJsonPayload<CustomerSignature>(signatureRow)] : [],
    };
  }

  completeMemberCardOpenMutation(input: {
    requestId?: string;
    storeId: string;
    customer: Customer;
    memberCard: MemberCard;
    transaction: MemberCardTransaction;
    operationLog: OperationLog;
    signature: CustomerSignature;
  }) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const customer = input.customer;
      this.db.prepare(
        "INSERT OR REPLACE INTO customers (id, storeId, name, phone, level, points, birthday, nextFollowUpAt, note, source, tags_json, lastVisit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(customer.id, customer.storeId ?? null, customer.name, customer.phone, customer.level, customer.points ?? 0, customer.birthday ?? null, customer.nextFollowUpAt ?? null, customer.note ?? null, customer.source, JSON.stringify(customer.tags), customer.lastVisit);
      const card = input.memberCard;
      this.db.prepare(
        "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json, serviceEntitlements_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(card.id, card.storeId ?? null, card.customerId, card.name, card.type, card.balance, card.remainingTimes, card.discountRate ?? null, card.pointsEarned ?? 0, card.benefitText ?? null, card.expiresAt, card.status, card.serviceId ?? null, JSON.stringify(card.serviceIds ?? []), card.serviceEntitlements?.length ? JSON.stringify(card.serviceEntitlements) : null);
      const transaction = input.transaction;
      this.db.prepare(
        "INSERT INTO memberCardTransactions (id, storeId, memberCardId, orderId, staffId, type, paidAmount, payMethod, amountDelta, timesDelta, balanceAfter, remainingTimesAfter, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(transaction.id, transaction.storeId ?? null, transaction.memberCardId, transaction.orderId ?? null, transaction.staffId ?? null, transaction.type, transaction.paidAmount ?? null, transaction.payMethod ?? null, transaction.amountDelta, transaction.timesDelta, transaction.balanceAfter, transaction.remainingTimesAfter, transaction.note, transaction.createdAt);
      const log = input.operationLog;
      this.db.prepare(
        "INSERT INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(log.id, log.storeId ?? null, log.userId, log.action, log.targetType, log.targetId, log.summary, log.createdAt);
      this.db.prepare("INSERT INTO customerSignatures (id, payload_json) VALUES (?, ?)").run(input.signature.id, JSON.stringify(input.signature));
      if (input.requestId) {
        this.db.prepare(
          "UPDATE memberCardSubmissionLocks SET memberCardId = ?, signatureId = ? WHERE id = ? AND storeId = ?",
        ).run(card.id, input.signature.id, input.requestId, input.storeId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  releaseMemberCardSubmission(requestId: string, storeId: string) {
    this.db.prepare("DELETE FROM memberCardSubmissionLocks WHERE id = ? AND storeId = ? AND memberCardId IS NULL").run(requestId, storeId);
  }

  acquireAiGenerationLocks(input: { ownerId: string; kind: string; createdAt: string; expiresAt: string; maxGlobalSlots: number }) {
    this.ensureAiGenerationLocks();
    this.db.prepare("DELETE FROM aiGenerationLocks WHERE expiresAt < ?").run(input.createdAt);

    const accountLockId = `account:${input.ownerId}`;
    const accountResult = this.db
      .prepare("INSERT OR IGNORE INTO aiGenerationLocks (id, scope, ownerId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(accountLockId, "account", input.ownerId, input.kind, input.createdAt, input.expiresAt) as { changes?: number };
    if ((accountResult.changes ?? 0) <= 0) {
      throw new Error("当前账号已有 AI 生成正在进行，请等待完成后再试。");
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
    throw new Error("当前 AI 生成请求较多，请稍后再试。");
  }

  releaseAiGenerationLocks(lockIds: { accountLockId?: string; globalLockId?: string }) {
    this.ensureAiGenerationLocks();
    [lockIds.accountLockId, lockIds.globalLockId].filter((id): id is string => Boolean(id)).forEach((id) => {
      this.db.prepare("DELETE FROM aiGenerationLocks WHERE id = ?").run(id);
    });
  }

  appendMarketingAiResult(input: { record: MarketingAiRecord; log: OperationLog; consumeCreditUserId?: string; consumeCreditAmount?: number }) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("INSERT OR REPLACE INTO marketingAiRecords (id, payload_json) VALUES (?, ?)").run(input.record.id, JSON.stringify(input.record));
      this.db
        .prepare("INSERT OR REPLACE INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.log.id, input.log.storeId ?? null, input.log.userId, input.log.action, input.log.targetType, input.log.targetId, input.log.summary, input.log.createdAt);
      const consumeCreditAmount = typeof input.consumeCreditAmount === "number" && Number.isFinite(input.consumeCreditAmount)
        ? Math.max(0, input.consumeCreditAmount)
        : 0;
      if (input.consumeCreditUserId && consumeCreditAmount > 0) {
        this.db
          .prepare("UPDATE authUsers SET payload_json = json_set(payload_json, '$.aiCredits', ROUND(MAX(0, COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS REAL), 0) - ?), 6)) WHERE id = ? AND COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS REAL), 0) > 0")
          .run(consumeCreditAmount, input.consumeCreditUserId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  upsertMarketingAiRecord(record: MarketingAiRecord) {
    this.db.prepare("INSERT OR REPLACE INTO marketingAiRecords (id, payload_json) VALUES (?, ?)").run(record.id, JSON.stringify(record));
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
        .prepare("INSERT INTO products (id, storeId, name, type, category, subcategory, unit, price, cost, stock, warningStock, shelfLifeMonths, expiryAt, serviceStockDeductible, serviceStockReviewStatus, serviceStockReviewedAt, serviceStockReviewedBy, serviceUsesPerUnit, serviceUnit, serviceUnitsPerStockUnit, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
          typeof product.serviceStockDeductible === "boolean" ? (product.serviceStockDeductible ? 1 : 0) : null,
          product.serviceStockReviewStatus ?? null,
          product.serviceStockReviewedAt ?? null,
          product.serviceStockReviewedBy ?? null,
          product.serviceUsesPerUnit ?? null,
          product.serviceUnit ?? null,
          product.serviceUnitsPerStockUnit ?? null,
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
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceIds_json, serviceName, servicePrice, serviceConsumables_json, serviceCardSelections_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          order.serviceIds?.length ? JSON.stringify(order.serviceIds) : null,
          order.serviceName ?? null,
          order.servicePrice ?? null,
          order.serviceConsumables !== undefined ? JSON.stringify(order.serviceConsumables) : null,
          order.serviceCardSelections?.length ? JSON.stringify(order.serviceCardSelections) : null,
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
          "INSERT INTO commissions (id, storeId, staffId, orderId, type, baseAmount, rate, amount, status, createdAt, settledAt, settlementId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          commission.id,
          commission.storeId ?? null,
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

  private deleteStoreTables(storeId: string, keys: readonly TableName[]) {
    const deleteJsonStoreRows = (tableName: string) => {
      this.db.prepare(`DELETE FROM ${tableName} WHERE json_extract(payload_json, '$.storeId') = ?`).run(storeId);
    };
    const deleteTableStoreRows = (tableName: string) => {
      this.db.prepare(`DELETE FROM ${tableName} WHERE storeId = ?`).run(storeId);
    };

    for (const key of keys) {
      switch (key) {
        case "storeProfiles":
          this.db.prepare("DELETE FROM storeProfiles WHERE id = ?").run(storeId);
          break;
        case "onlineStorefronts":
        case "staffInvites":
        case "storeOwnerApplications":
        case "tagDefinitions":
        case "inventoryBatches":
        case "onlineBookingRequests":
        case "staffShifts":
        case "distributionCommissions":
        case "referralRelations":
        case "commissionSettlements":
        case "marketingAiRecords":
        case "notifications":
        case "approvalRequests":
        case "customerServiceRecords":
        case "customerSignatures":
        case "customerFollowUps":
        case "suppliers":
        case "purchaseOrders":
        case "stocktakes":
          deleteJsonStoreRows(key);
          break;
        case "authUsers":
          this.db.prepare("DELETE FROM authUsers WHERE json_extract(payload_json, '$.storeId') = ?").run(storeId);
          break;
        case "systemConfigs":
        case "storeOwnerInvites":
          break;
        case "staff":
        case "customers":
        case "services":
        case "products":
        case "appointments":
        case "staffUnavailableSlots":
        case "memberCards":
        case "orders":
        case "refunds":
        case "commissions":
        case "inventoryLogs":
        case "memberCardTransactions":
        case "operationLogs":
        case "dailyCloses":
          deleteTableStoreRows(key);
          break;
        case "distributors":
          this.db
            .prepare(
              `DELETE FROM distributors
               WHERE json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                  OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
            )
            .run(storeId, storeId);
          break;
      }
    }
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
        return this.all(
          "SELECT * FROM memberCards WHERE storeId = ? OR (storeId IS NULL AND customerId IN (SELECT id FROM customers WHERE storeId = ?)) ORDER BY rowid ASC",
          mapMemberCard,
          [storeId, storeId],
        );
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
        return this.all(
          `SELECT * FROM memberCardTransactions
           WHERE storeId = ?
              OR memberCardId IN (SELECT id FROM memberCards WHERE storeId = ? OR (storeId IS NULL AND customerId IN (SELECT id FROM customers WHERE storeId = ?)))
              OR orderId IN (SELECT id FROM orders WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapMemberCardTransaction,
          [storeId, storeId, storeId, storeId],
        );
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
        serviceStockDeductible INTEGER,
        serviceStockReviewStatus TEXT,
        serviceStockReviewedAt TEXT,
        serviceStockReviewedBy TEXT,
        serviceUsesPerUnit REAL,
        serviceUnit TEXT,
        serviceUnitsPerStockUnit REAL,
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
        serviceIds_json TEXT,
        serviceName TEXT,
        servicePrice REAL,
        serviceConsumables_json TEXT,
        serviceCardSelections_json TEXT,
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

      CREATE TABLE IF NOT EXISTS memberCardSubmissionLocks (
        id TEXT PRIMARY KEY,
        storeId TEXT NOT NULL,
        memberCardId TEXT,
        signatureId TEXT,
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
    this.addColumnIfMissing("orders", "serviceIds_json", "TEXT");
    this.addColumnIfMissing("orders", "serviceName", "TEXT");
    this.addColumnIfMissing("orders", "servicePrice", "REAL");
    this.addColumnIfMissing("orders", "serviceConsumables_json", "TEXT");
    this.addColumnIfMissing("orders", "serviceCardSelections_json", "TEXT");
    this.addColumnIfMissing("products", "category", "TEXT");
    this.addColumnIfMissing("products", "subcategory", "TEXT");
    this.addColumnIfMissing("products", "shelfLifeMonths", "REAL");
    this.addColumnIfMissing("products", "expiryAt", "TEXT");
    this.addColumnIfMissing("products", "serviceStockDeductible", "INTEGER");
    this.addColumnIfMissing("products", "serviceStockReviewStatus", "TEXT");
    this.addColumnIfMissing("products", "serviceStockReviewedAt", "TEXT");
    this.addColumnIfMissing("products", "serviceStockReviewedBy", "TEXT");
    this.db.exec("UPDATE products SET serviceStockReviewStatus = 'pending', serviceStockReviewedAt = NULL, serviceStockReviewedBy = NULL WHERE serviceStockReviewStatus IS NULL;");
    this.addColumnIfMissing("products", "serviceUsesPerUnit", "REAL");
    this.addColumnIfMissing("products", "serviceUnit", "TEXT");
    this.addColumnIfMissing("products", "serviceUnitsPerStockUnit", "REAL");
    this.addColumnIfMissing("products", "status", "TEXT");
    this.addColumnIfMissing("inventoryLogs", "expiryAt", "TEXT");
    this.addColumnIfMissing("commissions", "rate", "REAL NOT NULL DEFAULT 0");
    this.addColumnIfMissing("commissions", "settledAt", "TEXT");
    this.addColumnIfMissing("commissions", "settlementId", "TEXT");
    this.addColumnIfMissing("commissions", "storeId", "TEXT");
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
    this.ensureAppointmentCheckoutIntegrity();
    this.createIndexes();
    this.ensureLegacySettledCommissionRefundAdjustments();
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

  private ensureAppointmentCheckoutIntegrity() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orderAppointmentConflictAudit (
        detachedOrderId TEXT PRIMARY KEY,
        storeId TEXT,
        appointmentId TEXT NOT NULL,
        retainedOrderId TEXT NOT NULL,
        reason TEXT NOT NULL,
        detectedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      WITH ranked_active_orders AS (
        SELECT
          id,
          storeId,
          appointmentId,
          FIRST_VALUE(id) OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
            ORDER BY createdAt ASC, rowid ASC, id ASC
          ) AS retainedOrderId,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
            ORDER BY createdAt ASC, rowid ASC, id ASC
          ) AS appointmentOrderRank
        FROM orders
        WHERE appointmentId IS NOT NULL
          AND TRIM(appointmentId) <> ''
          AND status <> '已退款'
      )
      INSERT OR IGNORE INTO orderAppointmentConflictAudit (
        detachedOrderId, storeId, appointmentId, retainedOrderId, reason
      )
      SELECT
        id, storeId, appointmentId, retainedOrderId, 'server-active-appointment-duplicate'
      FROM ranked_active_orders
      WHERE appointmentOrderRank > 1;

      WITH ranked_active_orders AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
            ORDER BY createdAt ASC, rowid ASC, id ASC
          ) AS appointmentOrderRank
        FROM orders
        WHERE appointmentId IS NOT NULL
          AND TRIM(appointmentId) <> ''
          AND status <> '已退款'
      )
      UPDATE orders
      SET appointmentId = NULL
      WHERE id IN (
        SELECT id FROM ranked_active_orders WHERE appointmentOrderRank > 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_active_appointment
        ON orders(COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId)
        WHERE appointmentId IS NOT NULL
          AND TRIM(appointmentId) <> ''
          AND status <> '已退款';

      DROP TABLE IF EXISTS migration0051SignedOrderTimes;
      DROP TABLE IF EXISTS migration0051ActiveOrderLinks;
      DROP TABLE IF EXISTS migration0051AppointmentCompletion;

      CREATE TABLE migration0051SignedOrderTimes (
        orderId TEXT PRIMARY KEY,
        signedAt TEXT NOT NULL
      );

      INSERT INTO migration0051SignedOrderTimes (orderId, signedAt)
      WITH extractedSignatures AS (
        SELECT
          CASE
            WHEN json_valid(signature.payload_json)
            THEN json_extract(signature.payload_json, '$.orderId')
          END AS orderId,
          CASE
            WHEN json_valid(signature.payload_json) THEN
              CASE
                WHEN json_extract(signature.payload_json, '$.title') = '服务完成确认签名'
                  AND json_extract(signature.payload_json, '$.status') = '已签名'
                THEN NULLIF(json_extract(signature.payload_json, '$.signedAt'), '')
              END
          END AS signedAt
        FROM customerSignatures AS signature
      )
      SELECT
        orderId,
        MIN(signedAt) AS signedAt
      FROM extractedSignatures
      WHERE NULLIF(TRIM(COALESCE(orderId, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(signedAt, '')), '') IS NOT NULL
      GROUP BY orderId;

      CREATE TABLE migration0051ActiveOrderLinks (
        orderId TEXT PRIMARY KEY,
        appointmentId TEXT NOT NULL,
        orderCreatedAt TEXT NOT NULL
      );

      INSERT INTO migration0051ActiveOrderLinks (orderId, appointmentId, orderCreatedAt)
      SELECT
        linkedOrder.id,
        appointment.id,
        linkedOrder.createdAt
      FROM orders AS linkedOrder
      JOIN appointments AS appointment
        ON appointment.id = linkedOrder.appointmentId
      WHERE linkedOrder.appointmentId IS NOT NULL
        AND TRIM(linkedOrder.appointmentId) <> ''
        AND linkedOrder.status <> '已退款'
        AND (
          linkedOrder.storeId = appointment.storeId
          OR COALESCE(TRIM(linkedOrder.storeId), '') = ''
          OR COALESCE(TRIM(appointment.storeId), '') = ''
        );

      CREATE INDEX migration0051ActiveOrderLinksAppointment
        ON migration0051ActiveOrderLinks(appointmentId);

      CREATE TABLE migration0051AppointmentCompletion (
        appointmentId TEXT PRIMARY KEY,
        signedAt TEXT,
        orderCreatedAt TEXT NOT NULL
      );

      INSERT INTO migration0051AppointmentCompletion (appointmentId, signedAt, orderCreatedAt)
      SELECT
        activeLink.appointmentId,
        MIN(signedOrder.signedAt) AS signedAt,
        MIN(activeLink.orderCreatedAt) AS orderCreatedAt
      FROM migration0051ActiveOrderLinks AS activeLink
      LEFT JOIN migration0051SignedOrderTimes AS signedOrder
        ON signedOrder.orderId = activeLink.orderId
      GROUP BY activeLink.appointmentId;

      UPDATE appointments
      SET
        status = '已完成',
        completedAt = COALESCE(
          (
            SELECT COALESCE(completion.signedAt, completion.orderCreatedAt)
            FROM migration0051AppointmentCompletion AS completion
            WHERE completion.appointmentId = appointments.id
          ),
          completedAt,
          CURRENT_TIMESTAMP
        ),
        canceledAt = NULL,
        cancelReason = NULL,
        noShowAt = NULL,
        updatedAt = COALESCE(
          (
            SELECT COALESCE(completion.signedAt, completion.orderCreatedAt)
            FROM migration0051AppointmentCompletion AS completion
            WHERE completion.appointmentId = appointments.id
          ),
          updatedAt,
          CURRENT_TIMESTAMP
        )
      WHERE status <> '已完成'
        AND id IN (SELECT appointmentId FROM migration0051AppointmentCompletion);

      DROP TABLE migration0051AppointmentCompletion;
      DROP TABLE migration0051ActiveOrderLinks;
      DROP TABLE migration0051SignedOrderTimes;
    `);
  }

  private ensureLegacySettledCommissionRefundAdjustments() {
    type CommissionRow = {
      id: string;
      storeId: string | null;
      staffId: string;
      orderId: string;
      type: string;
      baseAmount: number;
      rate: number;
      amount: number;
      status: string;
      settledAt: string | null;
      settlementId: string | null;
    };
    type RefundRow = { id: string; orderId: string; amount: number; createdAt: string };
    type SettlementPayload = { type?: unknown; commissionIds?: unknown; createdAt?: unknown };

    const orders = new Map(
      (this.db.prepare("SELECT id, paidAmount, storeId FROM orders").all() as Array<{ id: string; paidAmount: number; storeId: string | null }>)
        .map((order) => [order.id, order]),
    );
    const staffStores = new Map(
      (this.db.prepare("SELECT id, storeId FROM staff").all() as Array<{ id: string; storeId: string | null }>)
        .map((staff) => [staff.id, staff.storeId]),
    );
    const refundsByOrder = new Map<string, RefundRow[]>();
    (this.db.prepare("SELECT id, orderId, amount, createdAt FROM refunds").all() as RefundRow[])
      .forEach((refund) => {
        const refunds = refundsByOrder.get(refund.orderId) ?? [];
        refunds.push(refund);
        refundsByOrder.set(refund.orderId, refunds);
      });
    const commissions = this.db.prepare(`
      SELECT id, storeId, staffId, orderId, type, baseAmount, rate, amount, status, settledAt, settlementId
      FROM commissions
    `).all() as CommissionRow[];
    const adjustmentsByOrder = new Map<string, CommissionRow[]>();
    commissions.forEach((commission) => {
      if (commission.amount >= 0 || !commission.id.startsWith("cmr_")) return;
      const adjustments = adjustmentsByOrder.get(commission.orderId) ?? [];
      adjustments.push(commission);
      adjustmentsByOrder.set(commission.orderId, adjustments);
    });
    const settlements = new Map<string, { type?: string; commissionIds: Set<string>; createdAt?: string }>();
    (this.db.prepare("SELECT id, payload_json FROM commissionSettlements").all() as Array<{ id: string; payload_json: string }>)
      .forEach((row) => {
        try {
          const payload = JSON.parse(row.payload_json) as SettlementPayload;
          const commissionIds = Array.isArray(payload.commissionIds)
            ? payload.commissionIds.filter((id): id is string => typeof id === "string")
            : [];
          settlements.set(row.id, {
            type: typeof payload.type === "string" ? payload.type : undefined,
            commissionIds: new Set(commissionIds),
            createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
          });
        } catch {
          // Malformed legacy settlement payloads are not safe to auto-reconcile.
        }
      });

    const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const createdAt = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO commissions (
        id, storeId, staffId, orderId, type, baseAmount, rate, amount,
        status, createdAt, settledAt, settlementId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待结算', ?, NULL, NULL)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      commissions.forEach((commission) => {
        if (commission.id.startsWith("cmr_") || commission.amount < 0 || commission.baseAmount <= 0 || commission.rate <= 0) return;
        if (commission.status !== "已结算" && commission.status !== "已冲销") return;
        if (!commission.settlementId) return;
        const settlement = settlements.get(commission.settlementId);
        if (settlement?.type !== "员工提成" || !settlement.commissionIds.has(commission.id)) return;
        const settledAt = commission.settledAt ?? settlement.createdAt;
        const settledTime = settledAt ? Date.parse(settledAt) : Number.NaN;
        if (!Number.isFinite(settledTime)) return;
        const refunds = refundsByOrder.get(commission.orderId) ?? [];
        if (!refunds.length || refunds.some((refund) => {
          const refundTime = Date.parse(refund.createdAt);
          return refund.amount <= 0 || !Number.isFinite(refundTime) || refundTime <= settledTime;
        })) return;
        const order = orders.get(commission.orderId);
        if (!order || order.paidAmount < 0) return;
        const totalRefund = roundMoney(refunds.reduce((sum, refund) => sum + Math.max(0, refund.amount), 0));
        const originalPaidAmount = roundMoney(Math.max(0, order.paidAmount) + totalRefund);
        if (originalPaidAmount <= 0) return;
        const cumulativeRefund = Math.min(originalPaidAmount, totalRefund);
        const remainingRatio = Math.max(0, originalPaidAmount - cumulativeRefund) / originalPaidAmount;
        const originalAmount = Math.round(commission.baseAmount * commission.rate);
        const targetReversedAmount = Math.max(0, originalAmount - Math.round(originalAmount * remainingRatio));
        const targetReversedBaseAmount = roundMoney(Math.max(0, commission.baseAmount - roundMoney(commission.baseAmount * remainingRatio)));
        const existingAdjustments = (adjustmentsByOrder.get(commission.orderId) ?? []).filter((adjustment) =>
          adjustment.id.endsWith(`_${commission.id}`));
        const existingReversedAmount = existingAdjustments.reduce((sum, adjustment) => sum + Math.max(0, -adjustment.amount), 0);
        const existingReversedBaseAmount = roundMoney(
          existingAdjustments.reduce((sum, adjustment) => sum + Math.max(0, -adjustment.baseAmount), 0),
        );
        const missingAmount = Math.max(0, targetReversedAmount - existingReversedAmount);
        if (missingAmount <= 0) return;
        const missingBaseAmount = roundMoney(Math.max(0, targetReversedBaseAmount - existingReversedBaseAmount));
        insert.run(
          `cmr_m0052_${commission.id}`,
          commission.storeId?.trim() || order.storeId?.trim() || staffStores.get(commission.staffId)?.trim() || commission.storeId,
          commission.staffId,
          commission.orderId,
          commission.type,
          -missingBaseAmount,
          commission.rate,
          -missingAmount,
          createdAt,
        );
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
      CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(orderId);
      CREATE INDEX IF NOT EXISTS idx_commissions_order_id ON commissions(orderId);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_created ON inventoryLogs(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_product_created ON inventoryLogs(storeId, productId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_member_card_transactions_store_created ON memberCardTransactions(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_operation_logs_store_created ON operationLogs(storeId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_daily_closes_store_date ON dailyCloses(storeId, businessDate);
      CREATE INDEX IF NOT EXISTS idx_orders_store_created_id ON orders(storeId, createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_store_appointment_status ON orders(storeId, appointmentId, status);
      CREATE INDEX IF NOT EXISTS idx_member_card_tx_store_cash_created ON memberCardTransactions(storeId, createdAt DESC, id DESC)
        WHERE type IN ('开卡', '充值')
          AND CASE WHEN paidAmount IS NOT NULL THEN paidAmount ELSE amountDelta END > 0;
      CREATE INDEX IF NOT EXISTS idx_member_card_tx_order_store ON memberCardTransactions(orderId, storeId);
      CREATE INDEX IF NOT EXISTS idx_customer_service_records_order ON customerServiceRecords(json_extract(payload_json, '$.orderId'));
      CREATE INDEX IF NOT EXISTS idx_customer_signatures_order ON customerSignatures(json_extract(payload_json, '$.orderId'));
      CREATE INDEX IF NOT EXISTS idx_customer_signatures_service_record ON customerSignatures(json_extract(payload_json, '$.serviceRecordId'));
      CREATE INDEX IF NOT EXISTS idx_operation_logs_member_card_target ON operationLogs(targetType, targetId, action, storeId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_signatures_store_order ON customerSignatures(
        json_extract(payload_json, '$.storeId'),
        json_extract(payload_json, '$.orderId')
      );
      CREATE INDEX IF NOT EXISTS idx_customer_signatures_token ON customerSignatures(json_extract(payload_json, '$.token'));
      CREATE INDEX IF NOT EXISTS idx_customer_service_records_store_order ON customerServiceRecords(
        json_extract(payload_json, '$.storeId'),
        json_extract(payload_json, '$.orderId')
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_checkout_locks_created ON checkoutSubmissionLocks(createdAt);
      CREATE INDEX IF NOT EXISTS idx_member_card_submission_created ON memberCardSubmissionLocks(createdAt);
      CREATE INDEX IF NOT EXISTS idx_auth_users_store_json ON authUsers(json_extract(payload_json, '$.storeId'));
      CREATE INDEX IF NOT EXISTS idx_auth_users_account_json ON authUsers(json_extract(payload_json, '$.account'));
      CREATE INDEX IF NOT EXISTS idx_notifications_store_json ON notifications(json_extract(payload_json, '$.storeId'));
    `);
  }

  private ensureDefaultSuperadmin() {
    const data = this.readDataTables(["authUsers"]);
    if (data.authUsers.some((user) => user.role === "superadmin")) return;
    const admin = seedData.authUsers.find((user) => user.role === "superadmin");
    if (!admin) return;
    this.replaceDataTables({ ...data, authUsers: [admin, ...data.authUsers] }, ["authUsers"]);
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

function pickDataTables(data: AppData, keys: readonly TableName[]): AppData {
  const picked = emptyData();
  for (const key of keys) {
    picked[key] = data[key] as never;
  }
  return picked;
}

function normalizeCashierFlowPage(page: number, pageSize: number, totalCount: number) {
  const safePageSize = Math.min(
    CASHIER_FLOW_MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(pageSize) ? Math.trunc(pageSize) : CASHIER_FLOW_MAX_PAGE_SIZE),
  );
  const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));
  const requestedPage = Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1);
  return {
    page: Math.min(requestedPage, pageCount),
    pageSize: safePageSize,
    pageCount,
  };
}

function sqlPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function chunksOf<T>(values: readonly T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += CASHIER_FLOW_MAX_PAGE_SIZE) {
    chunks.push(values.slice(index, index + CASHIER_FLOW_MAX_PAGE_SIZE));
  }
  return chunks;
}

function dedupeById<T extends { id: string }>(values: readonly T[]) {
  return Array.from(new Map(values.map((value) => [value.id, value])).values());
}

function uniqueCashierFlowKeys(keys: readonly CashierFlowSourceKey[]) {
  return Array.from(new Map(keys.map((key) => [`${key.kind}:${key.id}`, key])).values());
}

function withoutSignatureText(signature: CustomerSignature): CustomerSignature {
  const { signatureText: _signatureText, ...lightSignature } = signature;
  return lightSignature;
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
    serviceStockReviewStatus?: string | null;
    serviceStockReviewedAt?: string | null;
    serviceStockReviewedBy?: string | null;
  };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    category: value.category ?? undefined,
    subcategory: value.subcategory ?? undefined,
    shelfLifeMonths: value.shelfLifeMonths ?? undefined,
    expiryAt: value.expiryAt ?? undefined,
    serviceStockDeductible: value.serviceStockDeductible === undefined || value.serviceStockDeductible === null
      ? undefined
      : Boolean(value.serviceStockDeductible),
    serviceStockReviewStatus: value.serviceStockReviewStatus === "pending" || value.serviceStockReviewStatus === "confirmed"
      ? value.serviceStockReviewStatus
      : undefined,
    serviceStockReviewedAt: value.serviceStockReviewedAt ?? undefined,
    serviceStockReviewedBy: value.serviceStockReviewedBy ?? undefined,
    serviceUsesPerUnit: value.serviceUsesPerUnit ?? undefined,
    serviceUnit: value.serviceUnit ?? undefined,
    serviceUnitsPerStockUnit: value.serviceUnitsPerStockUnit ?? undefined,
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
  const value = row as Order & { serviceIds_json?: string | null; serviceConsumables_json?: string | null; serviceCardSelections_json?: string | null; productItems_json?: string | null; giftProductItems_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    guestName: value.guestName ?? undefined,
    guestPhone: value.guestPhone ?? undefined,
    serviceIds: parseJsonArray<string>(value.serviceIds_json) ?? value.serviceIds,
    serviceName: value.serviceName ?? undefined,
    servicePrice: value.servicePrice ?? undefined,
    serviceConsumables: parseJsonArray<ServiceConsumable>(value.serviceConsumables_json) ?? value.serviceConsumables,
    serviceCardSelections: parseJsonArray<ServiceCardSelection>(value.serviceCardSelections_json) ?? value.serviceCardSelections,
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
  return { ...value, storeId: value.storeId ?? undefined, rate: value.rate ?? 0, settledAt: value.settledAt ?? undefined, settlementId: value.settlementId ?? undefined };
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
