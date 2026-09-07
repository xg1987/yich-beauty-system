import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assertCashierDataAuditSafe,
  assertExpectedCloudflareAccount,
  assertReleaseVersion,
  parseCashierDataAudit,
} from "./release-safety";

const PRODUCTION_HEALTH_URL = "https://zhurongkftech.com/api/health?clientVersion=0.0.0&manualUpdateCheck=1";
const rootUrl = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", rootUrl), "utf8")) as { version?: string };
const wranglerToml = readFileSync(new URL("wrangler.toml", rootUrl), "utf8");
const localVersion = pkg.version?.trim();
const expectedAccountId = wranglerToml.match(/CLOUDFLARE_ACCOUNT_ID\s*=\s*"([a-f0-9]{32})"/i)?.[1];
const databaseName = wranglerToml.match(/database_name\s*=\s*"([^"]+)"/)?.[1];

if (!localVersion) throw new Error("package.json 缺少 version");
if (!expectedAccountId) throw new Error("wrangler.toml 缺少目标 CLOUDFLARE_ACCOUNT_ID");
if (!databaseName) throw new Error("wrangler.toml 缺少 D1 database_name");

run("npm", ["run", "verify:pwa-version"]);

const dirtyFiles = run("git", ["status", "--porcelain", "--untracked-files=all"]).trim();
if (dirtyFiles) throw new Error("发布前 Git 工作区必须干净，请先确认并提交本次改动");

// Keep checkout/appointment isolation and duplicate-submit regressions in the release gate.
run("npm", ["run", "verify:business"]);
run("npm", ["run", "verify:api"]);

const healthResponse = await fetch(PRODUCTION_HEALTH_URL, { signal: AbortSignal.timeout(15_000) });
if (!healthResponse.ok) throw new Error(`无法读取线上版本：HTTP ${healthResponse.status}`);
const health = await healthResponse.json() as { ok?: boolean; version?: string };
if (!health.ok || !health.version) throw new Error("线上健康接口未返回有效版本");
assertReleaseVersion(localVersion, health.version);

const whoami = run("npx", ["wrangler", "whoami"]);
assertExpectedCloudflareAccount(whoami, expectedAccountId);

const auditSql = `
SELECT
  (SELECT COUNT(*) FROM orders WHERE storeId IS NULL OR TRIM(storeId) = '') AS orders_without_store,
  (
    SELECT COUNT(*)
    FROM memberCardTransactions t
    LEFT JOIN orders linkedOrder ON linkedOrder.id = t.orderId
    LEFT JOIN memberCards linkedCard ON linkedCard.id = t.memberCardId
    LEFT JOIN customers linkedCustomer ON linkedCustomer.id = linkedCard.customerId
    WHERE (t.storeId IS NULL OR TRIM(t.storeId) = '')
      AND COALESCE(NULLIF(TRIM(linkedOrder.storeId), ''), NULLIF(TRIM(linkedCard.storeId), ''), NULLIF(TRIM(linkedCustomer.storeId), '')) IS NULL
  ) AS unresolved_member_card_transactions;
`.trim();
const auditOutput = run("npx", [
  "wrangler",
  "d1",
  "execute",
  databaseName,
  "--remote",
  "--command",
  auditSql,
  "--json",
]);
const audit = parseCashierDataAudit(auditOutput);
assertCashierDataAuditSafe(audit);

console.log(`production release preflight passed: ${health.version} -> ${localVersion}`);
console.log("- business and API regressions verified");
console.log("- Cloudflare account verified");
console.log("- cashier history store ownership verified");
console.log("- Git worktree and PWA version markers verified");

function run(command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd: new URL(".", rootUrl),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
