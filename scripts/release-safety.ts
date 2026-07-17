export type CashierDataAudit = {
  ordersWithoutStore: number;
  unresolvedMemberCardTransactions: number;
};

export function compareVersions(left: string, right: string) {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function assertReleaseVersion(localVersion: string, liveVersion: string) {
  if (compareVersions(localVersion, liveVersion) <= 0) {
    throw new Error(`待发布版本 ${localVersion} 必须高于线上版本 ${liveVersion}`);
  }
}

export function accountIdsFromWranglerOutput(output: string) {
  return Array.from(new Set(output.match(/\b[a-f0-9]{32}\b/gi) ?? [])).map((id) => id.toLowerCase());
}

export function assertExpectedCloudflareAccount(output: string, expectedAccountId: string) {
  const accountIds = accountIdsFromWranglerOutput(output);
  if (!accountIds.includes(expectedAccountId.toLowerCase())) {
    throw new Error(`当前 Wrangler 未登录目标 Cloudflare 账号 ${expectedAccountId}`);
  }
}

export function parseCashierDataAudit(output: string): CashierDataAudit {
  const parsed = JSON.parse(output) as unknown;
  const row = findAuditRow(parsed);
  if (!row) throw new Error("无法解析线上结账数据审计结果");
  return {
    ordersWithoutStore: nonNegativeCount(row.orders_without_store, "orders_without_store"),
    unresolvedMemberCardTransactions: nonNegativeCount(
      row.unresolved_member_card_transactions,
      "unresolved_member_card_transactions",
    ),
  };
}

export function assertCashierDataAuditSafe(audit: CashierDataAudit) {
  const problems: string[] = [];
  if (audit.ordersWithoutStore > 0) problems.push(`${audit.ordersWithoutStore} 笔订单缺少门店归属`);
  if (audit.unresolvedMemberCardTransactions > 0) {
    problems.push(`${audit.unresolvedMemberCardTransactions} 笔会员卡流水无法通过订单、会员卡或客户确定门店`);
  }
  if (problems.length) throw new Error(`线上结账历史数据未通过门店归属审计：${problems.join("；")}`);
}

function numericVersionParts(version: string) {
  const normalized = version.trim().replace(/^v/i, "");
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) throw new Error(`版本号格式不正确：${version}`);
  return normalized.split(".").map((part) => Number.parseInt(part, 10));
}

function findAuditRow(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = findAuditRow(item);
      if (row) return row;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if ("orders_without_store" in record && "unresolved_member_card_transactions" in record) return record;
  for (const nested of Object.values(record)) {
    const row = findAuditRow(nested);
    if (row) return row;
  }
  return undefined;
}

function nonNegativeCount(value: unknown, label: string) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`线上审计字段 ${label} 不是有效数量`);
  return count;
}
