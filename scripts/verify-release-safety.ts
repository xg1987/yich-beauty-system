import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountIdsFromWranglerOutput,
  assertCashierDataAuditSafe,
  assertExpectedCloudflareAccount,
  assertReleaseVersion,
  compareVersions,
  parseCashierDataAudit,
} from "./release-safety";

assert.equal(compareVersions("0.1.331", "0.1.330"), 1);
assert.equal(compareVersions("1.0.0", "1"), 0);
assert.equal(compareVersions("0.1.329", "0.1.330"), -1);
assert.doesNotThrow(() => assertReleaseVersion("0.1.331", "0.1.330"));
assert.throws(() => assertReleaseVersion("0.1.330", "0.1.330"), /必须高于线上版本/);
assert.throws(() => compareVersions("0.1.beta", "0.1.330"), /格式不正确/);

const expectedAccountId = "de654b23294ca3b02f6649e3617f1b93";
const whoamiFixture = `Account Name  Account ID\nProduction  ${expectedAccountId}`;
assert.deepEqual(accountIdsFromWranglerOutput(whoamiFixture), [expectedAccountId]);
assert.doesNotThrow(() => assertExpectedCloudflareAccount(whoamiFixture, expectedAccountId));
assert.throws(() => assertExpectedCloudflareAccount("Account ID c5ebae00000000000000000000000000", expectedAccountId), /未登录目标/);

const audit = parseCashierDataAudit(JSON.stringify([{
  results: [{ orders_without_store: 0, unresolved_member_card_transactions: "0" }],
  success: true,
}]));
assert.deepEqual(audit, { ordersWithoutStore: 0, unresolvedMemberCardTransactions: 0 });
assert.doesNotThrow(() => assertCashierDataAuditSafe(audit));
assert.throws(
  () => assertCashierDataAuditSafe({ ordersWithoutStore: 2, unresolvedMemberCardTransactions: 1 }),
  /历史数据未通过门店归属审计/,
);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
const deploy = pkg.scripts?.["deploy:pages"] ?? "";
const preflightIndex = deploy.indexOf("npm run verify:production-release");
const migrationIndex = deploy.indexOf("npm run d1:migrate:remote");
const pagesIndex = deploy.indexOf("wrangler pages deploy");
assert.ok(preflightIndex >= 0, "deploy:pages must run the production release preflight");
assert.ok(migrationIndex > preflightIndex, "remote D1 migration must run after preflight");
assert.ok(pagesIndex > migrationIndex, "Pages deployment must run after the D1 migration");
assert.equal(deploy.includes("--commit-dirty=true"), false, "deployment must not allow a dirty worktree");

console.log("release safety checks passed");
