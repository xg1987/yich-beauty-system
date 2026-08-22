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
  new URL("../migrations/0051_appointment_checkout_integrity.sql", import.meta.url),
  "utf8",
);

function createSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      storeId TEXT,
      appointmentId TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY,
      storeId TEXT,
      status TEXT NOT NULL,
      completedAt TEXT,
      canceledAt TEXT,
      cancelReason TEXT,
      noShowAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE customerSignatures (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX idx_orders_store_appointment_status
      ON orders(storeId, appointmentId, status);
    CREATE INDEX idx_customer_signatures_order
      ON customerSignatures(
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.orderId') END
      );
  `);
}

type AppointmentState = {
  status: string;
  completedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  noShowAt: string | null;
  updatedAt: string | null;
};

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
          return {
            success: true,
            results: database.prepare(query).all(...bindings) as T[],
          };
        },
        async first<T>() {
          return (database.prepare(query).get(...bindings) ?? null) as T | null;
        },
        async run() {
          const result = database.prepare(query).run(...bindings);
          return {
            success: true,
            meta: { changes: Number(result.changes) },
          };
        },
      };
      return statement;
    },
    async batch<T>() {
      throw new Error("batch is not needed by this schema verification adapter") as never;
    },
  };
}

function appointment(database: DatabaseSync, id: string) {
  return { ...database.prepare(`
    SELECT status, completedAt, canceledAt, cancelReason, noShowAt, updatedAt
    FROM appointments
    WHERE id = ?
  `).get(id) } as AppointmentState;
}

async function verifySemantics() {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  database.exec(`
    INSERT INTO appointments VALUES
      ('appt_signed', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_pending', 'store1', '待服务', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_arrived', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_canceled', 'store1', '已取消', NULL, '2026-01-01T09:30:00.000Z', '旧版收银后误取消', NULL, '2026-01-01T09:30:00.000Z'),
      ('appt_no_show', 'store1', '爽约', NULL, NULL, NULL, '2026-01-01T09:40:00.000Z', '2026-01-01T09:40:00.000Z'),
      ('appt_refunded', 'store1', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_completed', 'store1', '已完成', '2025-12-31T12:00:00.000Z', NULL, NULL, NULL, '2025-12-31T12:00:00.000Z'),
      ('appt_store_mismatch', 'store2', '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z'),
      ('appt_duplicate', NULL, '已到店', NULL, NULL, NULL, NULL, '2026-01-01T09:00:00.000Z');

    INSERT INTO orders VALUES
      ('order_signed', 'store1', 'appt_signed', '已支付', '2026-01-01T10:00:00.000Z'),
      ('order_pending', 'store1', 'appt_pending', '已支付', '2026-01-01T10:10:00.000Z'),
      ('order_arrived', 'store1', 'appt_arrived', '已支付', '2026-01-01T10:15:00.000Z'),
      ('order_canceled', 'store1', 'appt_canceled', '已支付', '2026-01-01T10:20:00.000Z'),
      ('order_no_show', 'store1', 'appt_no_show', '已支付', '2026-01-01T10:30:00.000Z'),
      ('order_refunded', 'store1', 'appt_refunded', '已退款', '2026-01-01T10:40:00.000Z'),
      ('order_completed', 'store1', 'appt_completed', '已支付', '2026-01-01T10:45:00.000Z'),
      ('order_store_mismatch', 'store1', 'appt_store_mismatch', '已支付', '2026-01-01T10:50:00.000Z'),
      ('order_duplicate_first', NULL, 'appt_duplicate', '已支付', '2026-01-01T11:00:00.000Z'),
      ('order_duplicate_second', '', 'appt_duplicate', '已支付', '2026-01-01T11:01:00.000Z');

    INSERT INTO customerSignatures VALUES
      ('signature_signed_later', '{"orderId":"order_signed","title":"服务完成确认签名","status":"已签名","signedAt":"2026-01-01T12:00:00.000Z"}'),
      ('signature_signed_earlier', '{"orderId":"order_signed","title":"服务完成确认签名","status":"已签名","signedAt":"2026-01-01T11:30:00.000Z"}'),
      ('signature_pending', '{"orderId":"order_pending","title":"服务完成确认签名","status":"待签名"}'),
      ('signature_wrong_title', '{"orderId":"order_arrived","title":"其他签名","status":"已签名","signedAt":"2026-01-01T13:00:00.000Z"}'),
      ('signature_refunded', '{"orderId":"order_refunded","title":"服务完成确认签名","status":"已签名","signedAt":"2026-01-01T13:10:00.000Z"}'),
      ('signature_malformed', '{not-valid-json');
  `);

  database.exec(migrationSql);

  const d1Database = new D1BeautyDatabase(sqliteD1Binding(database));
  const readySchema = await d1Database.checkSchema();
  assert.equal(
    readySchema.missingTables.includes("orderAppointmentConflictAudit"),
    false,
    "D1 schema health should explicitly recognize the appointment conflict audit table",
  );
  assert.deepEqual(
    readySchema.missingIndexes,
    [],
    "D1 schema health should explicitly recognize the active-appointment unique index",
  );

  database.exec("DROP INDEX idx_orders_unique_active_appointment");
  const missingIndexSchema = await d1Database.checkSchema();
  assert.deepEqual(
    missingIndexSchema.missingIndexes,
    ["idx_orders_unique_active_appointment"],
    "D1 schema health must fail when migration 0051's unique index is absent",
  );
  database.exec(`
    CREATE UNIQUE INDEX idx_orders_unique_active_appointment
      ON orders(COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId)
      WHERE appointmentId IS NOT NULL
        AND TRIM(appointmentId) <> ''
        AND status <> '已退款'
  `);

  assert.deepEqual(
    appointment(database, "appt_signed"),
    {
      status: "已完成",
      completedAt: "2026-01-01T11:30:00.000Z",
      canceledAt: null,
      cancelReason: null,
      noShowAt: null,
      updatedAt: "2026-01-01T11:30:00.000Z",
    },
    "the earliest valid signedAt should take priority over order creation time",
  );
  assert.equal(
    appointment(database, "appt_pending").completedAt,
    "2026-01-01T10:10:00.000Z",
    "a paid appointment with a pending signature should fall back to order creation time",
  );
  assert.equal(
    appointment(database, "appt_arrived").completedAt,
    "2026-01-01T10:15:00.000Z",
    "an arrived appointment should be completed even without a matching signed signature",
  );
  assert.deepEqual(
    appointment(database, "appt_canceled"),
    {
      status: "已完成",
      completedAt: "2026-01-01T10:20:00.000Z",
      canceledAt: null,
      cancelReason: null,
      noShowAt: null,
      updatedAt: "2026-01-01T10:20:00.000Z",
    },
    "a canceled appointment with an active paid order should be repaired and cancellation state cleared",
  );
  assert.deepEqual(
    appointment(database, "appt_no_show"),
    {
      status: "已完成",
      completedAt: "2026-01-01T10:30:00.000Z",
      canceledAt: null,
      cancelReason: null,
      noShowAt: null,
      updatedAt: "2026-01-01T10:30:00.000Z",
    },
    "a no-show appointment with an active paid order should be repaired and no-show state cleared",
  );
  assert.equal(appointment(database, "appt_refunded").status, "已到店", "refunded-only orders must not complete appointments");
  assert.equal(
    appointment(database, "appt_completed").completedAt,
    "2025-12-31T12:00:00.000Z",
    "already-completed appointments must retain their original completion timestamp",
  );
  assert.equal(
    appointment(database, "appt_store_mismatch").status,
    "已到店",
    "an order from another non-blank store must not complete the appointment",
  );
  assert.equal(
    (database.prepare("SELECT appointmentId FROM orders WHERE id = 'order_duplicate_second'").get() as { appointmentId: string | null }).appointmentId,
    null,
    "the later duplicate link should be detached",
  );
  assert.equal(
    (database.prepare("SELECT retainedOrderId FROM orderAppointmentConflictAudit WHERE detachedOrderId = 'order_duplicate_second'").get() as { retainedOrderId: string }).retainedOrderId,
    "order_duplicate_first",
    "duplicate-link cleanup should preserve its existing audit semantics",
  );
  assert.equal(
    (database.prepare("SELECT json_extract(payload_json, '$.status') AS status FROM customerSignatures WHERE id = 'signature_pending'").get() as { status: string }).status,
    "待签名",
    "pending signatures must remain available for later signing",
  );
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'migration0051%'").get() as { count: number }).count,
    0,
    "migration staging tables and indexes must be removed",
  );

  const beforeRerun = database.prepare(`
    SELECT id, status, completedAt, canceledAt, cancelReason, noShowAt, updatedAt
    FROM appointments
    ORDER BY id
  `).all();
  database.exec(migrationSql);
  const afterRerun = database.prepare(`
    SELECT id, status, completedAt, canceledAt, cancelReason, noShowAt, updatedAt
    FROM appointments
    ORDER BY id
  `).all();
  assert.deepEqual(afterRerun, beforeRerun, "rerunning migration 0051 should be idempotent");
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM orderAppointmentConflictAudit").get() as { count: number }).count,
    1,
    "rerunning migration 0051 must not duplicate conflict audit rows",
  );

  const insertOrder = database.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)");
  insertOrder.run("order_constraint_first", "store1", "appt_constraint", "已支付", "2026-01-02T10:00:00.000Z");
  assert.throws(
    () => insertOrder.run("order_constraint_second", "store1", "appt_constraint", "已支付", "2026-01-02T10:01:00.000Z"),
    /UNIQUE constraint failed/,
    "same-store active orders must not reuse an appointment",
  );
  insertOrder.run("order_refunded_duplicate", "store1", "appt_constraint", "已退款", "2026-01-02T10:02:00.000Z");
  database.prepare("UPDATE orders SET status = '已退款' WHERE id = 'order_constraint_first'").run();
  insertOrder.run("order_reopened", "store1", "appt_constraint", "已支付", "2026-01-02T10:03:00.000Z");
  insertOrder.run("order_null_store_first", null, "appt_null_constraint", "已支付", "2026-01-02T11:00:00.000Z");
  assert.throws(
    () => insertOrder.run("order_blank_store_second", "", "appt_null_constraint", "已支付", "2026-01-02T11:01:00.000Z"),
    /UNIQUE constraint failed/,
    "NULL and blank legacy stores must remain in the same uniqueness bucket",
  );

  database.exec("DROP TABLE orderAppointmentConflictAudit");
  const missingAuditSchema = await d1Database.checkSchema();
  assert.equal(
    missingAuditSchema.missingTables.includes("orderAppointmentConflictAudit"),
    true,
    "D1 schema health must fail when migration 0051's audit table is absent",
  );
  database.close();
}

function verifyServerStartupIntegrity() {
  const tempDir = mkdtempSync(join(tmpdir(), "beauty-appointment-integrity-"));
  const databasePath = join(tempDir, "legacy.sqlite");
  try {
    const bootstrap = new BeautyDatabase(databasePath);
    bootstrap.close();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      DROP INDEX idx_orders_unique_active_appointment;

      INSERT INTO appointments (
        id, customerId, staffId, serviceId, startAt, status, note,
        canceledAt, cancelReason, noShowAt, updatedAt, storeId
      ) VALUES
        ('server_appt_signed', 'customer1', 'staff1', 'service1', '2026-03-01T09:00:00.000Z', '已取消', '',
          '2026-03-01T09:30:00.000Z', '旧版收银后误取消', NULL, '2026-03-01T09:30:00.000Z', 'store1'),
        ('server_appt_pending', 'customer1', 'staff1', 'service1', '2026-03-01T10:00:00.000Z', '爽约', '',
          NULL, NULL, '2026-03-01T10:30:00.000Z', '2026-03-01T10:30:00.000Z', 'store1'),
        ('server_appt_duplicate', 'customer1', 'staff1', 'service1', '2026-03-01T11:00:00.000Z', '已到店', '',
          NULL, NULL, NULL, '2026-03-01T11:00:00.000Z', NULL);

      INSERT INTO orders (
        id, orderNo, customerId, staffId, serviceId, totalAmount, paidAmount,
        appointmentId, payMethod, status, createdAt, storeId
      ) VALUES
        ('server_order_signed', 'SERVER-001', 'customer1', 'staff1', 'service1', 100, 100,
          'server_appt_signed', '现金', '已支付', '2026-03-01T09:45:00.000Z', 'store1'),
        ('server_order_pending', 'SERVER-002', 'customer1', 'staff1', 'service1', 100, 100,
          'server_appt_pending', '现金', '已支付', '2026-03-01T10:45:00.000Z', 'store1'),
        ('server_order_duplicate_first', 'SERVER-003', 'customer1', 'staff1', 'service1', 100, 100,
          'server_appt_duplicate', '现金', '已支付', '2026-03-01T11:15:00.000Z', NULL),
        ('server_order_duplicate_second', 'SERVER-004', 'customer1', 'staff1', 'service1', 100, 100,
          'server_appt_duplicate', '现金', '已支付', '2026-03-01T11:16:00.000Z', '');

      INSERT INTO customerSignatures (id, payload_json) VALUES
        ('server_signature_signed', '{"orderId":"server_order_signed","title":"服务完成确认签名","status":"已签名","signedAt":"2026-03-01T12:00:00.000Z"}'),
        ('server_signature_pending', '{"orderId":"server_order_pending","title":"服务完成确认签名","status":"待签名"}');
    `);
    legacy.close();

    const repaired = new BeautyDatabase(databasePath);
    repaired.close();

    const inspect = new DatabaseSync(databasePath);
    assert.deepEqual(
      { ...inspect.prepare(`
        SELECT status, completedAt, canceledAt, cancelReason, noShowAt
        FROM appointments WHERE id = 'server_appt_signed'
      `).get() },
      {
        status: "已完成",
        completedAt: "2026-03-01T12:00:00.000Z",
        canceledAt: null,
        cancelReason: null,
        noShowAt: null,
      },
      "server startup repair should prefer the signed completion time and clear stale cancellation state",
    );
    assert.deepEqual(
      { ...inspect.prepare(`
        SELECT status, completedAt, canceledAt, cancelReason, noShowAt
        FROM appointments WHERE id = 'server_appt_pending'
      `).get() },
      {
        status: "已完成",
        completedAt: "2026-03-01T10:45:00.000Z",
        canceledAt: null,
        cancelReason: null,
        noShowAt: null,
      },
      "server startup repair should fall back to order time and clear stale no-show state",
    );
    assert.equal(
      (inspect.prepare("SELECT appointmentId FROM orders WHERE id = 'server_order_duplicate_second'").get() as { appointmentId: string | null }).appointmentId,
      null,
      "server startup repair should detach the later duplicate appointment link",
    );
    assert.equal(
      (inspect.prepare(`
        SELECT retainedOrderId FROM orderAppointmentConflictAudit
        WHERE detachedOrderId = 'server_order_duplicate_second'
      `).get() as { retainedOrderId: string }).retainedOrderId,
      "server_order_duplicate_first",
      "server startup repair should audit the retained appointment link before detaching the duplicate",
    );
    assert.equal(
      (inspect.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE name LIKE 'migration0051%'
      `).get() as { count: number }).count,
      0,
      "server startup repair must remove every staging table and index",
    );
    assert.equal(
      (inspect.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_orders_unique_active_appointment'
      `).get() as { count: number }).count,
      1,
      "server startup repair must restore the active-appointment unique index",
    );
    inspect.close();

    const rerun = new BeautyDatabase(databasePath);
    rerun.close();
    const afterRerun = new DatabaseSync(databasePath);
    assert.equal(
      (afterRerun.prepare("SELECT COUNT(*) AS count FROM orderAppointmentConflictAudit").get() as { count: number }).count,
      1,
      "repeated server startup repair must not duplicate appointment conflict audits",
    );
    afterRerun.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyPerformance() {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  const fixtureCount = 1_500;
  const baseTime = Date.parse("2026-02-01T00:00:00.000Z");
  const insertAppointment = database.prepare(`
    INSERT INTO appointments
      (id, storeId, status, completedAt, canceledAt, cancelReason, noShowAt, updatedAt)
    VALUES (?, 'store-scale', ?, NULL, ?, ?, ?, ?)
  `);
  const insertOrder = database.prepare(`
    INSERT INTO orders (id, storeId, appointmentId, status, createdAt)
    VALUES (?, 'store-scale', ?, '已支付', ?)
  `);
  const insertSignature = database.prepare("INSERT INTO customerSignatures (id, payload_json) VALUES (?, ?)");

  database.exec("BEGIN");
  for (let index = 0; index < fixtureCount; index += 1) {
    const appointmentId = `appt-scale-${index}`;
    const orderId = `order-scale-${index}`;
    const orderCreatedAt = new Date(baseTime + index * 60_000).toISOString();
    const signedAt = new Date(baseTime + index * 60_000 + 30 * 60_000).toISOString();
    const status = index % 3 === 0 ? "已到店" : index % 3 === 1 ? "已取消" : "爽约";
    insertAppointment.run(
      appointmentId,
      status,
      status === "已取消" ? orderCreatedAt : null,
      status === "已取消" ? "旧状态" : null,
      status === "爽约" ? orderCreatedAt : null,
      orderCreatedAt,
    );
    insertOrder.run(orderId, appointmentId, orderCreatedAt);
    insertSignature.run(
      `signature-scale-${index}`,
      JSON.stringify({
        orderId,
        title: "服务完成确认签名",
        status: index % 2 === 0 ? "已签名" : "待签名",
        ...(index % 2 === 0 ? { signedAt } : {}),
      }),
    );
  }
  database.exec("COMMIT");

  const startedAt = performance.now();
  database.exec(migrationSql);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 5_000, `1,500-row migration should finish well below D1's 30-second limit; observed ${elapsedMs.toFixed(1)} ms`);
  assert.equal(
    (database.prepare("SELECT COUNT(*) AS count FROM appointments WHERE status = '已完成'").get() as { count: number }).count,
    fixtureCount,
    "all active-order appointments in the scale fixture should be completed",
  );
  assert.deepEqual(
    appointment(database, "appt-scale-0"),
    {
      status: "已完成",
      completedAt: new Date(baseTime + 30 * 60_000).toISOString(),
      canceledAt: null,
      cancelReason: null,
      noShowAt: null,
      updatedAt: new Date(baseTime + 30 * 60_000).toISOString(),
    },
    "signed rows in the scale fixture should use signedAt",
  );
  assert.equal(
    appointment(database, "appt-scale-1").completedAt,
    new Date(baseTime + 60_000).toISOString(),
    "pending-signature rows in the scale fixture should use order creation time",
  );
  assert.equal(
    (database.prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE canceledAt IS NOT NULL OR cancelReason IS NOT NULL OR noShowAt IS NOT NULL
    `).get() as { count: number }).count,
    0,
    "the set-based update should clear every stale cancellation and no-show field",
  );
  database.close();
  return elapsedMs;
}

await verifySemantics();
verifyServerStartupIntegrity();
const elapsedMs = verifyPerformance();
console.log(`Migration 0051 verification passed (1,500 appointments in ${elapsedMs.toFixed(1)} ms).`);
