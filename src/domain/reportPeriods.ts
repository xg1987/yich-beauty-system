import type { AppData } from "./types";

export type ReportPeriodMode = "day" | "week" | "month" | "year";

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addReportPeriod(date: Date, mode: ReportPeriodMode, delta: number) {
  const next = new Date(date);
  if (mode === "day") next.setDate(next.getDate() + delta);
  if (mode === "week") next.setDate(next.getDate() + delta * 7);
  if (mode === "month") next.setMonth(next.getMonth() + delta);
  if (mode === "year") next.setFullYear(next.getFullYear() + delta);
  return next;
}

export function reportPeriodRange(date: Date, mode: ReportPeriodMode) {
  const start = startOfLocalDay(date);
  if (mode === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }
  if (mode === "month") start.setDate(1);
  if (mode === "year") {
    start.setMonth(0);
    start.setDate(1);
  }
  const end = new Date(start);
  if (mode === "day") end.setDate(end.getDate() + 1);
  if (mode === "week") end.setDate(end.getDate() + 7);
  if (mode === "month") end.setMonth(end.getMonth() + 1);
  if (mode === "year") end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

export function inReportPeriod(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= +start && time < +end;
}

export function reportPeriodLabel(date: Date, mode: ReportPeriodMode) {
  if (mode === "day") return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (mode === "month") return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  if (mode === "year") return `${date.getFullYear()}年`;
  const { start, end } = reportPeriodRange(date, "week");
  const weekEnd = new Date(+end - 1);
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
}

export function reportPeriodHint(mode: ReportPeriodMode) {
  if (mode === "day") return "今日 · 可左右切换昨天/明天";
  if (mode === "week") return "本周 · 可左右切换上周/下周";
  if (mode === "month") return "本月 · 可左右切换上月/下月";
  return "本年 · 可左右切换去年/明年";
}

export function reportComparisonLabel(mode: ReportPeriodMode) {
  if (mode === "day") return "较上一日";
  if (mode === "week") return "较上周";
  if (mode === "month") return "较上月";
  return "较去年";
}

export function reportPeriodData(data: AppData, mode: ReportPeriodMode, date: Date): AppData {
  const { start, end } = reportPeriodRange(date, mode);
  return {
    ...data,
    orders: data.orders.filter((order) => inReportPeriod(order.createdAt, start, end)),
    refunds: data.refunds.filter((refund) => inReportPeriod(refund.createdAt, start, end)),
    memberCardTransactions: data.memberCardTransactions.filter((transaction) => inReportPeriod(transaction.createdAt, start, end)),
    appointments: data.appointments.filter((appointment) => inReportPeriod(appointment.startAt, start, end)),
    commissions: data.commissions.filter((commission) => inReportPeriod(commission.createdAt, start, end)),
    inventoryLogs: data.inventoryLogs.filter((log) => inReportPeriod(log.createdAt, start, end)),
  };
}
