import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { BeautyDatabase } from "../server/database";
import { D1BeautyDatabase } from "../src/cloudflare/d1Database";
import type { D1DatabaseBinding, D1PreparedStatement, D1Value } from "../src/cloudflare/d1Types";

const migrationSql = readFileSync(
  new URL("../migrations/0052_legacy_settled_commission_refund_reconciliation.sql", import.meta.url),
  "utf8",
);

function createSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      paidAmount REAL NOT NULL,
      storeId TEXT
    );
    CREATE TABLE staff (
      id TEXT PRIMARY KEY,
      storeId TEXT
    );
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      amount REAL NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY,
      storeId TEXT,
      staffId TEXT NOT NULL,
      orderId TEXT NOT NULL,
      type TEXT NOT NULL,
      baseAmount REAL NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      settledAt TEXT,
      settlementId TEXT
    );
    CREATE TABLE commissionSettlements (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
  `);
}

function sqliteD1Binding(database: DatabaseSync): D1DatabaseBinding {
  return {
    prepare(query: string) {
      let bindings: D1Value[] = [];
      const statement: D1PreparedStatement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async all<T>() {
          return { success: true, results: database.prepare(query).all(...bindings) as T[] };
        },
        async first<T>() {
          return (database.prepare(query).get(...bindings) ?? null) as T | null;
        },
        async run() {
          const result = database.prepare(query).run(...bindings);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch<T>() {
      throw new Error("batch is not needed by this migration verification adapter") as never;
    },
  };
}

type Scenario = {
  id: string;
  paidAmount: number;
  refundAmounts: number[];
  refundTimes?: string[];
  commissionAmount: number;
  commissionStatus?: "待结算" | "已结算" | "已冲销";
  baseAmount?: number;
  rate?: number;
  settledAt?: string;
  settlementIncludesCommission?: boolean;
  existingReversals?: Array<{ id: string; amount: number; baseAmount: number }>;
};

function insertScenario(database: DatabaseSync, scenario: Scenario) {
  const commissionId = `commission_${scenario.id}`;
  const orderId = `order_${scenario.id}`;
  const settlementId = `settlement_${scenario.id}`;
  const settledAt = scenario.settledAt ?? "2026-05-24T02:00:00.000Z";
  database.prepare("INSERT INTO orders (id, paidAmount, storeId) VALUES (?, ?, 'store1')").run(orderId, scenario.paidAmount);
  scenario.refundAmounts.forEach((amount, index) => {
    database.prepare("INSERT INTO refunds (id, orderId, amount, createdAt) VALUES (?, ?, ?, ?)").run(
      `refund_${scenario.id}_${index}`,
      orderId,
      amount,
      scenario.refundTimes?.[index] ?? `2026-05-${String(25 + index).padStart(2, "0")}T01:00:00.000Z`,
    );
  });
  database.prepare(`
    INSERT INTO commissions (
      id, storeId, staffId, orderId, type, baseAmount, rate, amount,
      status, createdAt, settledAt, settlementId
    ) VALUES (?, 'store1', 'staff1', ?, '服务提成', ?, ?, ?, ?, '2026-05-24T01:00:00.000Z', ?, ?)
  `).run(
    commissionId,
    orderId,
    scenario.baseAmount ?? 400,
    scenario.rate ?? 0.12,
    scenario.commissionAmount,
    scenario.commissionStatus ?? "已结算",
    settledAt,
    settlementId,
  );
  database.prepare("INSERT INTO commissionSettlements (id, payload_json) VALUES (?, ?)").run(
    settlementId,
    JSON.stringify({
      id: settlementId,
      type: "员工提成",
      commissionIds: scenario.settlementIncludesCommission === false ? [] : [commissionId],
      amount: scenario.commissionAmount,
      count: 1,
      createdBy: "u_manager",
      createdAt: settledAt,
    }),
  );
  (scenario.existingReversals ?? []).forEach((adjustment) => {
    database.prepare(`
      INSERT INTO commissions (
        id, storeId, staffId, orderId, type, baseAmount, rate, amount,
        status, createdAt, settledAt, settlementId
      ) VALUES (?, 'store1', 'staff1', ?, '服务提成', ?, 0.12, ?, '待结算', '2026-05-25T02:00:00.000Z', NULL, NULL)
    `).run(adjustment.id, orderId, adjustment.baseAmount, adjustment.amount);
  });
  return { commissionId, orderId };
}

function adjustmentAmount(database: DatabaseSync, commissionId: string) {
  const row = database.prepare(`
    SELECT amount FROM commissions
    WHERE id = 'cmr_m0052_' || ?
  `).get(commissionId) as { amount?: number } | undefined;
  return row?.amount;
}

async function verifySemanticsAndD1RoundTrip() {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  const partial = insertScenario(database, {
    id: "partial_missing",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
  });
  const partialExisting = insertScenario(database, {
    id: "partial_existing_five",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
    existingReversals: [{ id: "cmr_refund_partial_existing_five_0_commission_partial_existing_five", amount: -5, baseAmount: -40 }],
  });
  const fullWithExisting = insertScenario(database, {
    id: "full_existing",
    paidAmount: 0,
    refundAmounts: [100, 300],
    commissionAmount: 36,
    commissionStatus: "已冲销",
    existingReversals: [{ id: "cmr_refund_full_existing_0_commission_full_existing", amount: -36, baseAmount: -300 }],
  });
  const complete = insertScenario(database, {
    id: "already_complete",
    paidAmount: 0,
    refundAmounts: [400],
    commissionAmount: 48,
    existingReversals: [{ id: "cmr_refund_already_complete_0_commission_already_complete", amount: -48, baseAmount: -400 }],
  });
  const overReversed = insertScenario(database, {
    id: "over_reversed",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
    existingReversals: [{ id: "cmr_refund_over_reversed_0_commission_over_reversed", amount: -15, baseAmount: -125 }],
  });
  const pending = insertScenario(database, {
    id: "pending",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
    commissionStatus: "待结算",
  });
  const preSettlementRefund = insertScenario(database, {
    id: "pre_settlement",
    paidAmount: 300,
    refundAmounts: [100],
    refundTimes: ["2026-05-24T01:30:00.000Z"],
    commissionAmount: 36,
  });
  const batchMismatch = insertScenario(database, {
    id: "batch_mismatch",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
    settlementIncludesCommission: false,
  });
  const missingRate = insertScenario(database, {
    id: "missing_rate",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
    rate: 0,
  });
  const invalidRefund = insertScenario(database, {
    id: "invalid_refund",
    paidAmount: 301,
    refundAmounts: [100, -1],
    commissionAmount: 36,
  });

  database.exec(migrationSql);

  assert.equal(adjustmentAmount(database, partial.commissionId), -12, "a settled legacy partial refund should receive the full missing reversal");
  assert.equal(adjustmentAmount(database, partialExisting.commissionId), -7, "an incomplete existing reversal should receive only its missing difference");
  assert.equal(adjustmentAmount(database, fullWithExisting.commissionId), -12, "a legacy full refund should top up an incomplete existing reversal");
  assert.equal(adjustmentAmount(database, complete.commissionId), undefined, "a complete reversal must not be duplicated");
  assert.equal(adjustmentAmount(database, overReversed.commissionId), undefined, "an already over-reversed commission must never be reversed further");
  assert.equal(adjustmentAmount(database, pending.commissionId), undefined, "pending positive commissions must not be changed by migration 0052");
  assert.equal(adjustmentAmount(database, preSettlementRefund.commissionId), undefined, "refunds at or before settlement must fail closed instead of risking a double reversal");
  assert.equal(adjustmentAmount(database, batchMismatch.commissionId), undefined, "settlement status without exact batch membership is not reliable payout evidence");
  assert.equal(adjustmentAmount(database, missingRate.commissionId), undefined, "missing original rate/base evidence must fail closed");
  assert.equal(adjustmentAmount(database, invalidRefund.commissionId), undefined, "non-positive refund history must fail closed");
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'migration0052%'").get() as { count: number }).count,
    0,
    "migration 0052 must remove all staging tables",
  );
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM commissions").get() as { count: number }).count,
    10 + 4 + 3,
    "migration should add exactly three missing reversal rows without rewriting existing rows",
  );

  const d1Data = await new D1BeautyDatabase(sqliteD1Binding(database)).readDataTables(["commissions"]);
  const d1Adjustment = d1Data.commissions.find((commission) => commission.id === `cmr_m0052_${partial.commissionId}`);
  assert.deepEqual(
    d1Adjustment && {
      storeId: d1Adjustment.storeId,
      staffId: d1Adjustment.staffId,
      orderId: d1Adjustment.orderId,
      amount: d1Adjustment.amount,
      status: d1Adjustment.status,
      settlementId: d1Adjustment.settlementId,
    },
    {
      storeId: "store1",
      staffId: "staff1",
      orderId: partial.orderId,
      amount: -12,
      status: "待结算",
      settlementId: undefined,
    },
    "D1 should round-trip the migration adjustment as an unsettled negative commission",
  );

  const beforeRerun = database.prepare("SELECT * FROM commissions ORDER BY id").all();
  database.exec(migrationSql);
  const afterRerun = database.prepare("SELECT * FROM commissions ORDER BY id").all();
  assert.deepEqual(afterRerun, beforeRerun, "rerunning migration 0052 must be idempotent");
  database.close();
}

function verifyCollisionFailsLoudly() {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  const eligible = insertScenario(database, {
    id: "collision",
    paidAmount: 300,
    refundAmounts: [100],
    commissionAmount: 36,
  });
  database.prepare(`
    INSERT INTO commissions (
      id, storeId, staffId, orderId, type, baseAmount, rate, amount,
      status, createdAt, settledAt, settlementId
    ) VALUES (?, 'store1', 'staff1', ?, '服务提成', 0, 0.12, 0,
      '待结算', '2026-05-25T02:00:00.000Z', NULL, NULL)
  `).run(`cmr_m0052_${eligible.commissionId}`, eligible.orderId);
  assert.throws(
    () => database.exec(migrationSql),
    /UNIQUE constraint failed/,
    "a conflicting deterministic reconciliation id must stop migration instead of silently skipping a missing reversal",
  );
  database.close();
}

function verifyNodeStartupReconciliation() {
  const tempDir = mkdtempSync(join(tmpdir(), "beauty-commission-reconciliation-"));
  const databasePath = join(tempDir, "legacy.sqlite");
  try {
    const bootstrap = new BeautyDatabase(databasePath);
    bootstrap.close();
    const legacy = new DatabaseSync(databasePath);
    legacy.prepare(`
      INSERT INTO orders (
        id, orderNo, customerId, staffId, serviceId, totalAmount, paidAmount,
        payMethod, status, createdAt, storeId
      ) VALUES ('node_order', 'NODE-001', 'customer1', 'staff1', 'service1', 400, 300,
        '微信', '部分退款', '2026-05-24T01:00:00.000Z', 'store1')
    `).run();
    legacy.prepare(`
      INSERT INTO refunds (id, storeId, orderId, amount, reason, createdBy, createdAt)
      VALUES ('node_refund', 'store1', 'node_order', 100, '旧版部分退款', 'u_manager', '2026-05-25T01:00:00.000Z')
    `).run();
    legacy.prepare(`
      INSERT INTO commissions (
        id, storeId, staffId, orderId, type, baseAmount, rate, amount,
        status, createdAt, settledAt, settlementId
      ) VALUES ('node_commission', 'store1', 'staff1', 'node_order', '服务提成', 400, 0.12, 36,
        '已结算', '2026-05-24T01:00:00.000Z', '2026-05-24T02:00:00.000Z', 'node_settlement')
    `).run();
    legacy.prepare("INSERT INTO commissionSettlements (id, payload_json) VALUES (?, ?)").run(
      "node_settlement",
      JSON.stringify({
        id: "node_settlement",
        type: "员工提成",
        commissionIds: ["node_commission"],
        amount: 48,
        count: 1,
        createdBy: "u_manager",
        createdAt: "2026-05-24T02:00:00.000Z",
      }),
    );
    legacy.close();

    const repaired = new BeautyDatabase(databasePath);
    repaired.close();
    const inspect = new DatabaseSync(databasePath);
    assert.deepEqual(
      { ...inspect.prepare(`
        SELECT storeId, staffId, orderId, amount, status, settledAt, settlementId
        FROM commissions WHERE id = 'cmr_m0052_node_commission'
      `).get() },
      {
        storeId: "store1",
        staffId: "staff1",
        orderId: "node_order",
        amount: -12,
        status: "待结算",
        settledAt: null,
        settlementId: null,
      },
      "Node startup should mirror migration 0052 for legacy local databases",
    );
    inspect.close();

    const rerun = new BeautyDatabase(databasePath);
    rerun.close();
    const afterRerun = new DatabaseSync(databasePath);
    assert.equal(
      (afterRerun.prepare("SELECT COUNT(*) AS count FROM commissions WHERE id = 'cmr_m0052_node_commission'").get() as { count: number }).count,
      1,
      "Node startup reconciliation must remain idempotent",
    );
    afterRerun.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyPerformance() {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  const fixtureCount = 5_000;
  const insertOrder = database.prepare("INSERT INTO orders (id, paidAmount, storeId) VALUES (?, 300, 'store-scale')");
  const insertRefund = database.prepare("INSERT INTO refunds (id, orderId, amount, createdAt) VALUES (?, ?, 100, '2026-05-25T01:00:00.000Z')");
  const insertCommission = database.prepare(`
    INSERT INTO commissions (
      id, storeId, staffId, orderId, type, baseAmount, rate, amount,
      status, createdAt, settledAt, settlementId
    ) VALUES (?, 'store-scale', 'staff-scale', ?, '服务提成', 400, 0.12, 36,
      '已结算', '2026-05-24T01:00:00.000Z', '2026-05-24T02:00:00.000Z', ?)
  `);
  const insertSettlement = database.prepare("INSERT INTO commissionSettlements (id, payload_json) VALUES (?, ?)");
  database.exec("BEGIN");
  for (let index = 0; index < fixtureCount; index += 1) {
    const orderId = `scale_order_${index}`;
    const commissionId = `scale_commission_${index}`;
    const settlementId = `scale_settlement_${index}`;
    insertOrder.run(orderId);
    insertRefund.run(`scale_refund_${index}`, orderId);
    insertCommission.run(commissionId, orderId, settlementId);
    insertSettlement.run(settlementId, JSON.stringify({
      type: "员工提成",
      commissionIds: [commissionId],
      createdAt: "2026-05-24T02:00:00.000Z",
    }));
  }
  database.exec("COMMIT");

  const startedAt = performance.now();
  database.exec(migrationSql);
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 5_000, `5,000-row migration should stay below D1's 30-second limit; observed ${elapsedMs.toFixed(1)} ms`);
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM commissions WHERE id LIKE 'cmr_m0052_%'").get() as { count: number }).count,
    fixtureCount,
    "the scale migration should reconcile every eligible settled commission",
  );
  database.close();
  return elapsedMs;
}

await verifySemanticsAndD1RoundTrip();
verifyCollisionFailsLoudly();
verifyNodeStartupReconciliation();
const elapsedMs = verifyPerformance();
console.log(`Migration 0052 verification passed (5,000 settled refunds in ${elapsedMs.toFixed(1)} ms).`);
