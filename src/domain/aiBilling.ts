import type { AppData, MarketingAiCost, MarketingAiRecord, SystemConfig } from "./types";

export type AiBillingConfig = {
  freeStartsAt: string;
  freeDailyLimit: number;
};

export type AiFreeQuotaState = {
  enforced: boolean;
  credits: number;
  dateKey: string;
  startsAt: string;
  limit: number;
  used: number;
  remaining: number;
};

export const DEFAULT_AI_FREE_STARTS_AT = "2026-06-15";
export const DEFAULT_AI_FREE_DAILY_LIMIT = 1;
export const AI_CREDIT_CNY_PER_USD = 6.77;
const CHINA_TIME_ZONE = "Asia/Shanghai";

export function defaultAiBillingConfig(): AiBillingConfig {
  return {
    freeStartsAt: DEFAULT_AI_FREE_STARTS_AT,
    freeDailyLimit: DEFAULT_AI_FREE_DAILY_LIMIT,
  };
}

export function serializeAiBillingConfig(config: Partial<AiBillingConfig>) {
  return JSON.stringify(normalizeAiBillingConfig(config));
}

export function normalizeAiBillingConfig(input: unknown): AiBillingConfig {
  const defaults = defaultAiBillingConfig();
  const source = input && typeof input === "object" ? input as Partial<AiBillingConfig> : {};
  const freeStartsAt = typeof source.freeStartsAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.freeStartsAt)
    ? source.freeStartsAt
    : defaults.freeStartsAt;
  const freeDailyLimit = Number.isInteger(source.freeDailyLimit) && Number(source.freeDailyLimit) >= 0 && Number(source.freeDailyLimit) <= 100
    ? Number(source.freeDailyLimit)
    : defaults.freeDailyLimit;
  return { freeStartsAt, freeDailyLimit };
}

export function aiBillingConfigFromSystemConfigs(configs?: SystemConfig[]) {
  const rawValue = configs?.find((item) => item.key === "ai_billing_config")?.value;
  if (!rawValue) return defaultAiBillingConfig();
  try {
    return normalizeAiBillingConfig(JSON.parse(rawValue));
  } catch {
    return defaultAiBillingConfig();
  }
}

export function chinaDateKey(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(value);
}

function recordDateKey(record: MarketingAiRecord) {
  const date = new Date(record.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return chinaDateKey(date);
}

export function roundAiCreditAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(6));
}

export function accountAiCredits(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? roundAiCreditAmount(value) : 0;
}

export function aiCreditChargeForCost(cost?: Pick<MarketingAiCost, "amountUsd" | "priceConfigured">) {
  if (!cost || cost.priceConfigured === false || !Number.isFinite(cost.amountUsd) || cost.amountUsd <= 0) return 0;
  return roundAiCreditAmount(cost.amountUsd * AI_CREDIT_CNY_PER_USD);
}

export function aiFreeQuotaState(data: AppData, accountId?: string, now = new Date()): AiFreeQuotaState {
  const config = aiBillingConfigFromSystemConfigs(data.systemConfigs);
  const dateKey = chinaDateKey(now);
  const account = accountId ? data.authUsers.find((user) => user.id === accountId) : undefined;
  const credits = accountAiCredits(account?.aiCredits);
  const enforced = Boolean(accountId && credits <= 0 && dateKey >= config.freeStartsAt);
  const used = enforced
    ? (data.marketingAiRecords ?? []).filter((record) =>
      record.createdBy === accountId
      && recordDateKey(record) === dateKey
      && record.status !== "生成中"
      && record.status !== "生成失败"
      && record.billing?.source !== "credit"
    ).length
    : 0;
  const remaining = enforced ? Math.max(0, config.freeDailyLimit - used) : config.freeDailyLimit;
  return {
    enforced,
    credits,
    dateKey,
    startsAt: config.freeStartsAt,
    limit: config.freeDailyLimit,
    used,
    remaining,
  };
}

export function assertAiFreeQuotaAvailable(data: AppData, accountId?: string, now = new Date()) {
  const state = aiFreeQuotaState(data, accountId, now);
  if (state.credits > 0) return state;
  if (!state.enforced || state.remaining > 0) return state;
  throw new Error(`当前账号未充值，每天免费生成 ${state.limit} 次，今天已用完，请充值积分后继续使用。`);
}
