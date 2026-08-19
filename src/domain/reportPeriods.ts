import type { AppData } from "./types";
import { addBusinessDays, businessDateOf } from "./utils";

export type ReportPeriodMode = "day" | "week" | "month" | "year";

function businessDateStart(dateValue: string) {
  return new Date(`${dateValue}T00:00:00+08:00`);
}

function monthStart(dateValue: string) {
  return `${dateValue.slice(0, 7)}-01`;
}

function yearStart(dateValue: string) {
  return `${dateValue.slice(0, 4)}-01-01`;
}

function addBusinessMonths(dateValue: string, months: number) {
  const date = new Date(`${monthStart(dateValue)}T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function addBusinessYears(dateValue: string, years: number) {
  const date = new Date(`${yearStart(dateValue)}T12:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
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
  const selectedDate = businessDateOf(date);
  let startDate = selectedDate;
  if (mode === "week") {
    const day = new Date(`${selectedDate}T12:00:00.000Z`).getUTCDay() || 7;
    startDate = addBusinessDays(selectedDate, -day + 1);
  }
  if (mode === "month") startDate = monthStart(selectedDate);
  if (mode === "year") startDate = yearStart(selectedDate);
  const endDate = mode === "day"
    ? addBusinessDays(startDate, 1)
    : mode === "week"
      ? addBusinessDays(startDate, 7)
      : mode === "month"
        ? addBusinessMonths(startDate, 1)
        : addBusinessYears(startDate, 1);
  return { start: businessDateStart(startDate), end: businessDateStart(endDate) };
}

export function inReportPeriod(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= +start && time < +end;
}

export function reportPeriodLabel(date: Date, mode: ReportPeriodMode) {
  const selectedDate = businessDateOf(date);
  const [year, month, day] = selectedDate.split("-").map(Number);
  if (mode === "day") return `${year}年${month}月${day}日`;
  if (mode === "month") return `${year}年${month}月`;
  if (mode === "year") return `${year}年`;
  const { start, end } = reportPeriodRange(date, "week");
  const [startYear, startMonth, startDay] = businessDateOf(start).split("-").map(Number);
  const [, endMonth, endDay] = businessDateOf(new Date(+end - 1)).split("-").map(Number);
  return `${startYear}年${startMonth}月${startDay}日 - ${endMonth}月${endDay}日`;
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
