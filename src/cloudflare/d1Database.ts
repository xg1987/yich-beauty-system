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

const storeScopedDeleteOrder: D1DataTableName[] = [
  "commissionSettlements",
  "commissions",
  "distributionCommissions",
  "referralRelations",
  "distributors",
  "refunds",
  "memberCardTransactions",
  "inventoryLogs",
  "operationLogs",
  "dailyCloses",
  "approvalRequests",
  "customerServiceRecords",
  "customerSignatures",
  "customerFollowUps",
  "stocktakes",
  "purchaseOrders",
  "suppliers",
  "notifications",
  "marketingAiRecords",
  "staffShifts",
  "staffUnavailableSlots",
  "onlineBookingRequests",
  "appointments",
  "inventoryBatches",
  "orders",
  "memberCards",
  "products",
  "services",
  "tagDefinitions",
  "customers",
  "authUsers",
  "staffInvites",
  "storeOwnerApplications",
  "storeOwnerInvites",
  "systemConfigs",
  "onlineStorefronts",
  "staff",
  "storeProfiles",
];

const storeScopedDeleteRank = new Map(storeScopedDeleteOrder.map((key, index) => [key, index]));

export class D1BeautyDatabase {
  constructor(private readonly db: D1DatabaseBinding) {}

  async reset() {
    await this.replaceData(seedData);
  }

  async checkSchema() {
    const rows = await this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const existingTables = new Set((rows.results ?? []).map((row) => row.name));
    const missingTables = tableNames.filter((tableName) => !existingTables.has(tableName));
    return {
      ok: missingTables.length === 0,
      missingTables,
    };
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
      marketingAiRecords,
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
      this.all("SELECT payload_json FROM marketingAiRecords ORDER BY rowid DESC", mapJsonPayload<MarketingAiRecord>),
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
      marketingAiRecords,
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

  async readDataTablesForStore(keys: readonly D1DataTableName[], storeId: string): Promise<AppData> {
    const data = emptyData();
    await Promise.all(Array.from(new Set(keys)).map(async (key) => {
      data[key] = await this.readTableForStore(key, storeId) as never;
    }));
    data.systemConfigs = normalizeSystemConfigs(data.systemConfigs);
    return data;
  }

  async readCustomerSignatureByToken(token: string): Promise<CustomerSignature | undefined> {
    const rows = await this.all(
      "SELECT payload_json FROM customerSignatures WHERE json_extract(payload_json, '$.token') = ? ORDER BY rowid DESC LIMIT 1",
      mapJsonPayload<CustomerSignature>,
      [token],
    );
    return rows[0];
  }

  async readCustomerSignatureById(id: string): Promise<CustomerSignature | undefined> {
    const rows = await this.all(
      "SELECT payload_json FROM customerSignatures WHERE id = ? LIMIT 1",
      mapJsonPayload<CustomerSignature>,
      [id],
    );
    return rows[0];
  }

  async resolveCustomerSignatureStoreId(signature: CustomerSignature): Promise<string | undefined> {
    if (signature.storeId) return signature.storeId;
    const rows = await this.all(
      `SELECT storeId FROM (
         SELECT storeId FROM customers WHERE id = ?
         UNION ALL
         SELECT storeId FROM orders WHERE id = ?
         UNION ALL
         SELECT json_extract(payload_json, '$.storeId') AS storeId FROM customerServiceRecords WHERE id = ?
       )
       WHERE storeId IS NOT NULL AND storeId <> ''
       LIMIT 1`,
      (row) => (row as { storeId?: string | null }).storeId ?? undefined,
      [signature.customerId, signature.orderId ?? "", signature.serviceRecordId ?? ""],
    );
    return rows.find(Boolean);
  }

  async replaceData(data: AppData) {
    const statements: D1PreparedStatement[] = [];
    for (const tableName of [...tableNames].reverse()) {
      statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
    }
    statements.push(...this.writeDataStatements(data));
    await this.db.batch(statements);
  }

  async replaceTables(data: AppData, keys: readonly D1DataTableName[]) {
    const uniqueKeys = Array.from(new Set(keys));
    const statements: D1PreparedStatement[] = [];
    for (const tableName of [...tableNames].reverse()) {
      if (uniqueKeys.includes(tableName)) {
        statements.push(this.db.prepare(`DELETE FROM ${tableName}`));
      }
    }
    statements.push(...this.writeDataStatements(pickDataTables(data, uniqueKeys)));
    await this.db.batch(statements);
  }

  async replaceStoreData(storeId: string, data: AppData) {
    const statements: D1PreparedStatement[] = [];
    this.deleteStoreDataStatements(statements, storeId);
    statements.push(...this.writeDataStatements(dataForStoreWrite(data, storeId)));
    await this.db.batch(statements);
  }

  async replaceStoreTables(storeId: string, data: AppData, keys: readonly D1DataTableName[]) {
    const uniqueKeys = Array.from(new Set(keys));
    const statements: D1PreparedStatement[] = [];
    this.deleteStoreTableStatements(statements, storeId, uniqueKeys);
    statements.push(...this.writeDataStatements(pickDataTables(dataForStoreWrite(data, storeId), uniqueKeys)));
    await this.db.batch(statements);
  }

  async upsertCustomerSignatures(signatures: readonly CustomerSignature[]) {
    if (!signatures.length) return;
    await this.db.batch(
      signatures.map((signature) =>
        this.statement("INSERT OR REPLACE INTO customerSignatures (id, payload_json) VALUES (?, ?)", [
          signature.id,
          JSON.stringify(signature),
        ]),
      ),
    );
  }

  async reserveCheckoutSubmission(id: string, createdAt: string) {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS checkoutSubmissionLocks (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL)").run();
    const cutoff = new Date(Date.parse(createdAt) - 10 * 60 * 1000).toISOString();
    await this.db.prepare("DELETE FROM checkoutSubmissionLocks WHERE createdAt < ?").bind(cutoff).run();
    const result = await this.db.prepare("INSERT OR IGNORE INTO checkoutSubmissionLocks (id, createdAt) VALUES (?, ?)").bind(id, createdAt).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async acquireAiGenerationLocks(input: { ownerId: string; kind: string; createdAt: string; expiresAt: string; maxGlobalSlots: number }) {
    await this.ensureAiGenerationLocks();
    await this.db.prepare("DELETE FROM aiGenerationLocks WHERE expiresAt < ?").bind(input.createdAt).run();

    const accountLockId = `account:${input.ownerId}`;
    const accountResult = await this.db
      .prepare("INSERT OR IGNORE INTO aiGenerationLocks (id, scope, ownerId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(accountLockId, "account", input.ownerId, input.kind, input.createdAt, input.expiresAt)
      .run();
    if ((accountResult.meta?.changes ?? 0) <= 0) {
      throw new Error("当前账号已有 AI 生成正在进行，请等待完成后再试。");
    }

    for (let slot = 0; slot < input.maxGlobalSlots; slot += 1) {
      const globalLockId = `global:${input.kind}:${slot}`;
      const globalResult = await this.db
        .prepare("INSERT OR IGNORE INTO aiGenerationLocks (id, scope, ownerId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(globalLockId, "global", input.ownerId, input.kind, input.createdAt, input.expiresAt)
        .run();
      if ((globalResult.meta?.changes ?? 0) > 0) {
        return { accountLockId, globalLockId };
      }
    }

    await this.db.prepare("DELETE FROM aiGenerationLocks WHERE id = ?").bind(accountLockId).run();
    throw new Error("当前 AI 生成请求较多，请稍后再试。");
  }

  async releaseAiGenerationLocks(lockIds: { accountLockId?: string; globalLockId?: string }) {
    const ids = [lockIds.accountLockId, lockIds.globalLockId].filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    await this.ensureAiGenerationLocks();
    await this.db.batch(ids.map((id) => this.db.prepare("DELETE FROM aiGenerationLocks WHERE id = ?").bind(id)));
  }

  async appendMarketingAiResult(input: { record: MarketingAiRecord; log: OperationLog; consumeCreditUserId?: string; consumeCreditAmount?: number }) {
    const statements: D1PreparedStatement[] = [
      this.statement("INSERT OR REPLACE INTO marketingAiRecords (id, payload_json) VALUES (?, ?)", [input.record.id, JSON.stringify(input.record)]),
      this.statement(
        "INSERT OR REPLACE INTO operationLogs (id, storeId, userId, action, targetType, targetId, summary, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [input.log.id, input.log.storeId ?? null, input.log.userId, input.log.action, input.log.targetType, input.log.targetId, input.log.summary, input.log.createdAt],
      ),
    ];
    const consumeCreditAmount = typeof input.consumeCreditAmount === "number" && Number.isFinite(input.consumeCreditAmount)
      ? Math.max(0, input.consumeCreditAmount)
      : 0;
    if (input.consumeCreditUserId && consumeCreditAmount > 0) {
      statements.push(
        this.statement(
          "UPDATE authUsers SET payload_json = json_set(payload_json, '$.aiCredits', ROUND(MAX(0, COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS REAL), 0) - ?), 6)) WHERE id = ? AND COALESCE(CAST(json_extract(payload_json, '$.aiCredits') AS REAL), 0) > 0",
          [consumeCreditAmount, input.consumeCreditUserId],
        ),
      );
    }
    await this.db.batch(statements);
  }

  async upsertMarketingAiRecord(record: MarketingAiRecord) {
    await this.db
      .prepare("INSERT OR REPLACE INTO marketingAiRecords (id, payload_json) VALUES (?, ?)")
      .bind(record.id, JSON.stringify(record))
      .run();
  }

  private async all<T>(query: string, mapper: (row: unknown) => T, values: D1Value[] = []) {
    const statement = values.length ? this.db.prepare(query).bind(...values) : this.db.prepare(query);
    const result = await statement.all();
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

  private readTableForStore(key: D1DataTableName, storeId: string) {
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
          `SELECT payload_json FROM authUsers
           WHERE json_extract(payload_json, '$.role') = 'superadmin'
              OR json_extract(payload_json, '$.storeId') = ?
              OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
           ORDER BY rowid ASC`,
          mapJsonPayload<AuthUser>,
          [storeId, storeId],
        );
      case "systemConfigs":
        return this.readTable(key);
      case "staffInvites":
        return jsonStoreRows("staffInvites", mapJsonPayload<StaffInvite>);
      case "storeOwnerInvites":
        return Promise.resolve([] as StoreOwnerInvite[]);
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
        return this.all(
          "SELECT * FROM refunds WHERE storeId = ? OR orderId IN (SELECT id FROM orders WHERE storeId = ?) ORDER BY rowid DESC",
          mapRefund,
          [storeId, storeId],
        );
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
        return this.all(
          "SELECT * FROM inventoryLogs WHERE storeId = ? OR productId IN (SELECT id FROM products WHERE storeId = ?) ORDER BY rowid DESC",
          mapInventoryLog,
          [storeId, storeId],
        );
      case "memberCardTransactions":
        return this.all(
          `SELECT * FROM memberCardTransactions
           WHERE storeId = ?
              OR memberCardId IN (SELECT id FROM memberCards WHERE storeId = ?)
              OR orderId IN (SELECT id FROM orders WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapMemberCardTransaction,
          [storeId, storeId, storeId],
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
        return this.all(
          `SELECT payload_json FROM customerServiceRecords
           WHERE json_extract(payload_json, '$.storeId') = ?
              OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
              OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapJsonPayload<CustomerServiceRecord>,
          [storeId, storeId, storeId, storeId],
        );
      case "customerSignatures":
        return this.all(
          `SELECT payload_json FROM customerSignatures
           WHERE json_extract(payload_json, '$.storeId') = ?
              OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
              OR json_extract(payload_json, '$.serviceRecordId') IN (
                SELECT id FROM customerServiceRecords
                WHERE json_extract(payload_json, '$.storeId') = ?
                   OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                   OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
                   OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
              )
           ORDER BY rowid DESC`,
          mapJsonPayload<CustomerSignature>,
          [storeId, storeId, storeId, storeId, storeId, storeId, storeId],
        );
      case "customerFollowUps":
        return this.all(
          `SELECT payload_json FROM customerFollowUps
           WHERE json_extract(payload_json, '$.storeId') = ?
              OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
           ORDER BY rowid DESC`,
          mapJsonPayload<CustomerFollowUp>,
          [storeId, storeId, storeId],
        );
      case "suppliers":
        return jsonStoreRows("suppliers", mapJsonPayload<Supplier>);
      case "purchaseOrders":
        return jsonStoreRows("purchaseOrders", mapJsonPayload<PurchaseOrder>);
      case "stocktakes":
        return jsonStoreRows("stocktakes", mapJsonPayload<Stocktake>);
    }
  }

  private writeOrderStatements(statements: D1PreparedStatement[], orders: Order[]) {
    for (const order of orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceIds_json, serviceName, servicePrice, serviceConsumables_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json, serviceEntitlements_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            card.serviceEntitlements?.length ? JSON.stringify(card.serviceEntitlements) : null,
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
          "INSERT INTO memberCards (id, storeId, customerId, name, type, balance, remainingTimes, discountRate, pointsEarned, benefitText, expiresAt, status, serviceId, serviceIds_json, serviceEntitlements_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            card.serviceEntitlements?.length ? JSON.stringify(card.serviceEntitlements) : null,
          ],
        ),
      );
    }

    this.writeJsonTable(statements, "distributors", data.distributors);
    this.writeJsonTable(statements, "referralRelations", data.referralRelations);

    for (const order of data.orders) {
      statements.push(
        this.statement(
          "INSERT INTO orders (id, storeId, orderNo, customerId, guestName, guestPhone, staffId, serviceId, serviceIds_json, serviceName, servicePrice, serviceConsumables_json, productId, giftProductId, productItems_json, giftProductItems_json, cardId, totalAmount, paidAmount, discountAmount, adjustmentReason, approvalId, distributorId, appointmentId, payMethod, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
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
    this.writeJsonTable(statements, "marketingAiRecords", data.marketingAiRecords ?? []);
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

  private deleteStoreDataStatements(statements: D1PreparedStatement[], storeId: string) {
    const deleteJsonStoreRows = (tableName: string) => {
      statements.push(this.statement(`DELETE FROM ${tableName} WHERE json_extract(payload_json, '$.storeId') = ?`, [storeId]));
    };
    const deleteTableStoreRows = (tableName: string) => {
      statements.push(this.statement(`DELETE FROM ${tableName} WHERE storeId = ?`, [storeId]));
    };

    statements.push(
      this.statement(
        `DELETE FROM commissionSettlements
         WHERE EXISTS (
           SELECT 1 FROM json_each(commissionSettlements.payload_json, '$.commissionIds') AS commissionId
           JOIN commissions ON commissions.id = commissionId.value
           WHERE commissions.staffId IN (SELECT id FROM staff WHERE storeId = ?)
              OR commissions.orderId IN (SELECT id FROM orders WHERE storeId = ?)
         )`,
        [storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        "DELETE FROM commissions WHERE staffId IN (SELECT id FROM staff WHERE storeId = ?) OR orderId IN (SELECT id FROM orders WHERE storeId = ?)",
        [storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        `DELETE FROM distributionCommissions
         WHERE json_extract(payload_json, '$.distributorId') IN (
           SELECT distributors.id
           FROM distributors
           WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
         )
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)`,
        [storeId, storeId, storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        `DELETE FROM referralRelations
         WHERE json_extract(payload_json, '$.distributorId') IN (
           SELECT distributors.id
           FROM distributors
           WHERE json_extract(distributors.payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
              OR json_extract(distributors.payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
         )
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)`,
        [storeId, storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        `DELETE FROM distributors
         WHERE json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
        [storeId, storeId],
      ),
    );

    deleteJsonStoreRows("stocktakes");
    deleteJsonStoreRows("purchaseOrders");
    deleteJsonStoreRows("suppliers");
    deleteJsonStoreRows("marketingAiRecords");
    statements.push(
      this.statement(
        `DELETE FROM customerFollowUps
         WHERE json_extract(payload_json, '$.storeId') = ?
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
        [storeId, storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        `DELETE FROM customerSignatures
         WHERE json_extract(payload_json, '$.storeId') = ?
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
            OR json_extract(payload_json, '$.serviceRecordId') IN (
              SELECT id FROM customerServiceRecords
              WHERE json_extract(payload_json, '$.storeId') = ?
                 OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                 OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
                 OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
            )`,
        [storeId, storeId, storeId, storeId, storeId, storeId, storeId],
      ),
    );
    statements.push(
      this.statement(
        `DELETE FROM customerServiceRecords
         WHERE json_extract(payload_json, '$.storeId') = ?
            OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
            OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
            OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)`,
        [storeId, storeId, storeId, storeId],
      ),
    );
    deleteJsonStoreRows("approvalRequests");
    deleteTableStoreRows("dailyCloses");
    deleteJsonStoreRows("notifications");
    deleteTableStoreRows("operationLogs");
    statements.push(
      this.statement(
        `DELETE FROM memberCardTransactions
         WHERE storeId = ?
            OR memberCardId IN (SELECT id FROM memberCards WHERE storeId = ?)
            OR orderId IN (SELECT id FROM orders WHERE storeId = ?)`,
        [storeId, storeId, storeId],
      ),
    );
    statements.push(this.statement("DELETE FROM inventoryLogs WHERE storeId = ? OR productId IN (SELECT id FROM products WHERE storeId = ?)", [storeId, storeId]));
    statements.push(this.statement("DELETE FROM refunds WHERE storeId = ? OR orderId IN (SELECT id FROM orders WHERE storeId = ?)", [storeId, storeId]));
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
    statements.push(
      this.statement(
        `DELETE FROM authUsers
         WHERE json_extract(payload_json, '$.storeId') = ?
            OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
        [storeId, storeId],
      ),
    );
    deleteTableStoreRows("staff");
    deleteJsonStoreRows("staffInvites");
    deleteJsonStoreRows("storeOwnerApplications");
    deleteJsonStoreRows("onlineStorefronts");
    statements.push(this.statement("DELETE FROM storeProfiles WHERE id = ?", [storeId]));
  }

  private deleteStoreTableStatements(statements: D1PreparedStatement[], storeId: string, keys: readonly D1DataTableName[]) {
    const deleteJsonStoreRows = (tableName: string) => {
      statements.push(this.statement(`DELETE FROM ${tableName} WHERE json_extract(payload_json, '$.storeId') = ?`, [storeId]));
    };
    const deleteTableStoreRows = (tableName: string) => {
      statements.push(this.statement(`DELETE FROM ${tableName} WHERE storeId = ?`, [storeId]));
    };

    const orderedKeys = Array.from(new Set(keys)).sort(
      (left, right) => (storeScopedDeleteRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (storeScopedDeleteRank.get(right) ?? Number.MAX_SAFE_INTEGER),
    );

    for (const key of orderedKeys) {
      switch (key) {
        case "storeProfiles":
          statements.push(this.statement("DELETE FROM storeProfiles WHERE id = ?", [storeId]));
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
        case "suppliers":
        case "purchaseOrders":
        case "stocktakes":
          deleteJsonStoreRows(key);
          break;
        case "customerServiceRecords":
          statements.push(
            this.statement(
              `DELETE FROM customerServiceRecords
               WHERE json_extract(payload_json, '$.storeId') = ?
                  OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                  OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
                  OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)`,
              [storeId, storeId, storeId, storeId],
            ),
          );
          break;
        case "customerSignatures":
          statements.push(
            this.statement(
              `DELETE FROM customerSignatures
               WHERE json_extract(payload_json, '$.storeId') = ?
                  OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                  OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
                  OR json_extract(payload_json, '$.serviceRecordId') IN (
                    SELECT id FROM customerServiceRecords
                    WHERE json_extract(payload_json, '$.storeId') = ?
                       OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                       OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)
                       OR json_extract(payload_json, '$.orderId') IN (SELECT id FROM orders WHERE storeId = ?)
                  )`,
              [storeId, storeId, storeId, storeId, storeId, storeId, storeId],
            ),
          );
          break;
        case "customerFollowUps":
          statements.push(
            this.statement(
              `DELETE FROM customerFollowUps
               WHERE json_extract(payload_json, '$.storeId') = ?
                  OR json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                  OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
              [storeId, storeId, storeId],
            ),
          );
          break;
        case "authUsers":
          statements.push(
            this.statement(
              `DELETE FROM authUsers
               WHERE json_extract(payload_json, '$.storeId') = ?
                  OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
              [storeId, storeId],
            ),
          );
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
          deleteTableStoreRows(key);
          break;
        case "refunds":
          statements.push(
            this.statement("DELETE FROM refunds WHERE storeId = ? OR orderId IN (SELECT id FROM orders WHERE storeId = ?)", [storeId, storeId]),
          );
          break;
        case "inventoryLogs":
          statements.push(
            this.statement("DELETE FROM inventoryLogs WHERE storeId = ? OR productId IN (SELECT id FROM products WHERE storeId = ?)", [storeId, storeId]),
          );
          break;
        case "memberCardTransactions":
          statements.push(
            this.statement(
              `DELETE FROM memberCardTransactions
               WHERE storeId = ?
                  OR memberCardId IN (SELECT id FROM memberCards WHERE storeId = ?)
                  OR orderId IN (SELECT id FROM orders WHERE storeId = ?)`,
              [storeId, storeId, storeId],
            ),
          );
          break;
        case "operationLogs":
        case "dailyCloses":
          deleteTableStoreRows(key);
          break;
        case "commissions":
          statements.push(
            this.statement(
              "DELETE FROM commissions WHERE staffId IN (SELECT id FROM staff WHERE storeId = ?) OR orderId IN (SELECT id FROM orders WHERE storeId = ?)",
              [storeId, storeId],
            ),
          );
          break;
        case "distributors":
          statements.push(
            this.statement(
              `DELETE FROM distributors
               WHERE json_extract(payload_json, '$.customerId') IN (SELECT id FROM customers WHERE storeId = ?)
                  OR json_extract(payload_json, '$.staffId') IN (SELECT id FROM staff WHERE storeId = ?)`,
              [storeId, storeId],
            ),
          );
          break;
      }
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

  private async ensureAiGenerationLocks() {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS aiGenerationLocks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        kind TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      )
    `).run();
    await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_scope_expires ON aiGenerationLocks(scope, expiresAt)").run();
    await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_owner_kind ON aiGenerationLocks(ownerId, kind)").run();
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
  const ensureStoreId = <T extends { storeId?: string }>(item: T): T => item.storeId === storeId ? item : { ...item, storeId };
  const staff = data.staff.filter(belongsToStore);
  const staffIds = new Set(staff.map((item) => item.id));
  const customers = data.customers.filter(belongsToStore);
  const customerIds = new Set(customers.map((item) => item.id));
  const products = data.products.filter(belongsToStore);
  const productIds = new Set(products.map((item) => item.id));
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
  const customerServiceRecords = data.customerServiceRecords
    .filter((item) =>
      item.storeId === storeId
        || customerIds.has(item.customerId)
        || staffIds.has(item.staffId)
        || Boolean(item.orderId && orderIds.has(item.orderId)),
    )
    .map(ensureStoreId);
  const customerServiceRecordIds = new Set(customerServiceRecords.map((item) => item.id));
  const customerSignatures = data.customerSignatures
    .filter((item) =>
      item.storeId === storeId
        || customerIds.has(item.customerId)
        || Boolean(item.orderId && orderIds.has(item.orderId))
        || Boolean(item.serviceRecordId && customerServiceRecordIds.has(item.serviceRecordId)),
    )
    .map(ensureStoreId);
  const customerFollowUps = data.customerFollowUps
    .filter((item) => item.storeId === storeId || customerIds.has(item.customerId) || staffIds.has(item.staffId))
    .map(ensureStoreId);

  return {
    ...emptyData(),
    storeProfiles: data.storeProfiles.filter((item) => item.id === storeId),
    onlineStorefronts: data.onlineStorefronts.filter(belongsToStore),
    authUsers: data.authUsers.filter((item) => item.storeId === storeId || Boolean(item.staffId && staffIds.has(item.staffId))),
    staffInvites: data.staffInvites.filter(belongsToStore),
    storeOwnerApplications: data.storeOwnerApplications.filter(belongsToStore),
    staff,
    customers,
    tagDefinitions: data.tagDefinitions.filter(belongsToStore),
    services: data.services.filter(belongsToStore),
    products,
    inventoryBatches: data.inventoryBatches.filter(belongsToStore),
    appointments: data.appointments.filter(belongsToStore),
    onlineBookingRequests: data.onlineBookingRequests.filter(belongsToStore),
    staffUnavailableSlots: data.staffUnavailableSlots.filter(belongsToStore),
    staffShifts: data.staffShifts.filter(belongsToStore),
    memberCards: cards,
    distributors,
    referralRelations: data.referralRelations.filter((item) => distributorIds.has(item.distributorId) && customerIds.has(item.customerId)),
    orders,
    refunds: data.refunds.filter((item) => item.storeId === storeId || orderIds.has(item.orderId)).map(ensureStoreId),
    commissions,
    distributionCommissions: data.distributionCommissions.filter((item) =>
      distributorIds.has(item.distributorId) || customerIds.has(item.customerId) || orderIds.has(item.orderId),
    ),
    commissionSettlements: data.commissionSettlements.filter((item) => item.commissionIds.some((commissionId) => commissionIds.has(commissionId))),
    inventoryLogs: data.inventoryLogs.filter((item) => item.storeId === storeId || productIds.has(item.productId)).map(ensureStoreId),
    memberCardTransactions: data.memberCardTransactions.filter((item) =>
      item.storeId === storeId || cardIds.has(item.memberCardId) || Boolean(item.orderId && orderIds.has(item.orderId)),
    ).map(ensureStoreId),
    operationLogs: data.operationLogs.filter(belongsToStore),
    marketingAiRecords: (data.marketingAiRecords ?? []).filter(belongsToStore),
    notifications: data.notifications.filter(belongsToStore),
    dailyCloses: data.dailyCloses.filter(belongsToStore),
    approvalRequests: data.approvalRequests.filter(belongsToStore),
    customerServiceRecords,
    customerSignatures,
    customerFollowUps,
    suppliers: data.suppliers.filter(belongsToStore),
    purchaseOrders: data.purchaseOrders.filter(belongsToStore),
    stocktakes: data.stocktakes.filter(belongsToStore),
  };
}

function pickDataTables(data: AppData, keys: readonly D1DataTableName[]): AppData {
  const picked = emptyData();
  for (const key of keys) {
    picked[key] = data[key] as never;
  }
  return picked;
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
  const value = row as Order & { serviceIds_json?: string | null; serviceConsumables_json?: string | null; productItems_json?: string | null; giftProductItems_json?: string | null };
  return {
    ...value,
    storeId: value.storeId ?? undefined,
    guestName: value.guestName ?? undefined,
    guestPhone: value.guestPhone ?? undefined,
    serviceIds: parseJsonArray<string>(value.serviceIds_json) ?? value.serviceIds,
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
