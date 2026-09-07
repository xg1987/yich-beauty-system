import type { Appointment, Service } from "./types";
import { businessDateOf } from "./utils";

export type AppointmentRange = "today" | "tomorrow" | "week";

export type AppointmentRangeMeta = {
  label: string;
  start: Date;
  end: Date;
};

export type AppointmentMonthSummary = {
  range: AppointmentRangeMeta;
  appointments: Appointment[];
  arrived: Appointment[];
  missed: Appointment[];
  upcoming: Appointment[];
  canceled: Appointment[];
};

export type AppointmentRoomAssignment = {
  appointment: Appointment;
  roomName: string;
};

export type AppointmentRoomUsage = {
  availableRoomCount: number;
  bookedRoomSlots: number;
  dayCount: number;
  maintenanceRoomCount: number;
  maintenanceRoomNames: string[];
  remainingRoomSlots: number;
  roomAssignments: AppointmentRoomAssignment[];
  roomCapacity: number;
};

export const ARRIVAL_CONFIRMATION_LEAD_TIME_MS = 30 * 60 * 1000;
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;
export const MAX_APPOINTMENT_DURATION_MINUTES = 12 * 60;

export type AppointmentTimeRangeIssue = "invalid" | "end-not-after-start" | "cross-day" | "too-long";

export function appointmentTimeRangeIssue(startAtInput: string | Date, endAtInput: string | Date): AppointmentTimeRangeIssue | undefined {
  const startAt = startAtInput instanceof Date ? startAtInput : new Date(startAtInput);
  const endAt = endAtInput instanceof Date ? endAtInput : new Date(endAtInput);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return "invalid";
  if (!(startAt < endAt)) return "end-not-after-start";
  if (businessDateOf(startAt) !== businessDateOf(endAt)) return "cross-day";
  if (endAt.getTime() - startAt.getTime() > MAX_APPOINTMENT_DURATION_MINUTES * 60 * 1000) return "too-long";
  return undefined;
}

export function shiftedAppointmentEndAt(
  previousStartAtInput: string | Date,
  previousEndAtInput: string | Date,
  nextStartAtInput: string | Date,
  fallbackMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
) {
  const previousStartAt = previousStartAtInput instanceof Date ? previousStartAtInput : new Date(previousStartAtInput);
  const previousEndAt = previousEndAtInput instanceof Date ? previousEndAtInput : new Date(previousEndAtInput);
  const nextStartAt = nextStartAtInput instanceof Date ? nextStartAtInput : new Date(nextStartAtInput);
  const previousIssue = appointmentTimeRangeIssue(previousStartAt, previousEndAt);
  const previousDurationMs = previousIssue ? undefined : previousEndAt.getTime() - previousStartAt.getTime();
  const safeFallbackMinutes = Number.isFinite(fallbackMinutes) && fallbackMinutes > 0
    ? Math.min(MAX_APPOINTMENT_DURATION_MINUTES, fallbackMinutes)
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  return new Date(nextStartAt.getTime() + (previousDurationMs ?? safeFallbackMinutes * 60 * 1000));
}

export function appointmentServiceIds(appointment: Pick<Appointment, "serviceId" | "serviceIds">) {
  const ids = appointment.serviceIds?.filter(Boolean) ?? [];
  return ids.length ? Array.from(new Set(ids)) : [appointment.serviceId].filter(Boolean);
}

/** Only service checkout can infer a service appointment; retail sales are independent. */
export function appointmentMatchesServiceCheckout(
  appointment: Appointment,
  checkout: { storeId: string; customerId: string; staffId: string; serviceIds: string[]; createdAt: string },
  services: Service[],
) {
  if (checkout.serviceIds.length === 0) return false;
  if (appointment.status !== "已到店" && appointment.status !== "已完成") return false;
  if ((appointment.storeId ?? checkout.storeId) !== checkout.storeId) return false;
  if (appointment.customerId !== checkout.customerId || appointment.staffId !== checkout.staffId) return false;
  if (businessDateOf(appointment.startAt) !== businessDateOf(checkout.createdAt)) return false;
  const allowedServiceIds = appointmentServiceIds(appointment);
  if (allowedServiceIds.length > 0 && !checkout.serviceIds.every((id) => allowedServiceIds.includes(id))) return false;
  const checkoutTime = +new Date(checkout.createdAt);
  return Number.isFinite(checkoutTime)
    && checkoutTime >= +new Date(appointment.startAt) - ARRIVAL_CONFIRMATION_LEAD_TIME_MS
    && checkoutTime <= +appointmentEndAt(appointment, services) + 4 * 60 * 60 * 1000;
}

export function appointmentEndAt(appointment: Pick<Appointment, "serviceId" | "serviceIds" | "startAt" | "endAt">, services: Service[] = []) {
  const startAt = new Date(appointment.startAt);
  const savedEndAt = appointment.endAt ? new Date(appointment.endAt) : undefined;
  if (!Number.isNaN(startAt.getTime()) && savedEndAt && !appointmentTimeRangeIssue(startAt, savedEndAt)) {
    return savedEndAt;
  }
  const selectedServices = appointmentServiceIds(appointment)
    .map((serviceId) => services.find((item) => item.id === serviceId))
    .filter((service): service is Service => Boolean(service));
  const minutes = selectedServices.length
    ? selectedServices.reduce((sum, service) => sum + (service.duration && service.duration > 0 ? service.duration : DEFAULT_APPOINTMENT_DURATION_MINUTES), 0)
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  return new Date(startAt.getTime() + minutes * 60 * 1000);
}

export function appointmentArrivalConfirmationWindow(
  appointment: Pick<Appointment, "serviceId" | "serviceIds" | "startAt" | "endAt">,
  services: Service[] = [],
  leadTimeMs = ARRIVAL_CONFIRMATION_LEAD_TIME_MS,
) {
  const startAt = new Date(appointment.startAt);
  const endAt = appointmentEndAt(appointment, services);
  return {
    opensAt: new Date(startAt.getTime() - leadTimeMs),
    startAt,
    endAt,
  };
}

export function isAppointmentInArrivalConfirmationWindow(
  appointment: Pick<Appointment, "serviceId" | "serviceIds" | "startAt" | "endAt">,
  services: Service[] = [],
  now = new Date(),
  leadTimeMs = ARRIVAL_CONFIRMATION_LEAD_TIME_MS,
) {
  const { opensAt, endAt } = appointmentArrivalConfirmationWindow(appointment, services, leadTimeMs);
  return opensAt <= now && now <= endAt;
}

const startOfDay = (date: Date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfDay = (date: Date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};

export function appointmentRollingSevenDayDates(baseDate = new Date(), blockOffset = 0) {
  const safeOffset = Number.isFinite(blockOffset) ? Math.trunc(blockOffset) : 0;
  const start = startOfDay(baseDate);
  start.setDate(start.getDate() + safeOffset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function appointmentRangeMap(baseDate = new Date()): Record<AppointmentRange, AppointmentRangeMeta> {
  const today = new Date(baseDate);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
  const weekStart = startOfDay(today);
  weekStart.setDate(today.getDate() - dayOfWeek + 1);
  const weekEnd = endOfDay(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return {
    today: { label: "今日", start: startOfDay(today), end: endOfDay(today) },
    tomorrow: { label: "明日", start: startOfDay(tomorrow), end: endOfDay(tomorrow) },
    week: { label: "本周", start: weekStart, end: weekEnd },
  };
}

export function filterAppointmentsByRange(appointments: Appointment[], range: AppointmentRange, baseDate = new Date()) {
  const selectedRange = appointmentRangeMap(baseDate)[range];

  return appointments
    .filter((appointment) => {
      const startAt = new Date(appointment.startAt).getTime();
      return startAt >= selectedRange.start.getTime() && startAt <= selectedRange.end.getTime();
    })
    .slice()
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
}

export function appointmentMonthRange(monthDate = new Date()): AppointmentRangeMeta {
  const start = startOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
  const end = endOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
  return {
    label: `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`,
    start,
    end,
  };
}

export function summarizeAppointmentsForMonth(
  appointments: Appointment[],
  services: Service[],
  monthDate = new Date(),
  now = new Date(),
): AppointmentMonthSummary {
  const range = appointmentMonthRange(monthDate);
  const monthlyAppointments = appointments
    .filter((appointment) => {
      const startAt = new Date(appointment.startAt).getTime();
      return startAt >= range.start.getTime() && startAt <= range.end.getTime();
    })
    .slice()
    .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt));
  const arrived: Appointment[] = [];
  const missed: Appointment[] = [];
  const upcoming: Appointment[] = [];
  const canceled: Appointment[] = [];

  monthlyAppointments.forEach((appointment) => {
    if (appointment.status === "已到店" || appointment.status === "已完成") {
      arrived.push(appointment);
      return;
    }
    if (appointment.status === "已取消") {
      canceled.push(appointment);
      return;
    }
    if (appointment.status === "爽约" || appointmentEndAt(appointment, services) < now) {
      missed.push(appointment);
      return;
    }
    upcoming.push(appointment);
  });

  return { range, appointments: monthlyAppointments, arrived, missed, upcoming, canceled };
}

function countCalendarDays(start: Date, end: Date) {
  const startDay = new Date(start);
  const endDay = new Date(end);
  startDay.setHours(0, 0, 0, 0);
  endDay.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1);
}

function isActiveRoomAppointment(appointment: Appointment) {
  return appointment.status !== "已取消" && appointment.status !== "爽约";
}

export function calculateAppointmentRoomUsage(
  appointments: Appointment[],
  rangeMeta: AppointmentRangeMeta,
  roomNames: string[],
  maintenanceRooms: number | string[] = 0,
): AppointmentRoomUsage {
  const maintenanceRoomNames = normalizeMaintenanceRoomNames(roomNames, maintenanceRooms);
  const availableRoomCount = Math.max(0, roomNames.length - maintenanceRoomNames.length);
  const dayCount = countCalendarDays(rangeMeta.start, rangeMeta.end);
  const roomCapacity = availableRoomCount * dayCount;
  const activeAppointments = appointments.filter(isActiveRoomAppointment);
  const bookedRoomSlots = Math.min(activeAppointments.length, roomCapacity);
  const remainingRoomSlots = Math.max(0, roomCapacity - bookedRoomSlots);
  const roomAssignments = assignAppointmentRooms(activeAppointments.slice(0, availableRoomCount), roomNames, maintenanceRoomNames);

  return {
    availableRoomCount,
    bookedRoomSlots,
    dayCount,
    maintenanceRoomCount: maintenanceRoomNames.length,
    maintenanceRoomNames,
    remainingRoomSlots,
    roomAssignments,
    roomCapacity,
  };
}

export function assignAppointmentRooms(
  appointments: Appointment[],
  roomNames: string[],
  maintenanceRooms: number | string[] = 0,
): AppointmentRoomAssignment[] {
  const maintenanceRoomNames = normalizeMaintenanceRoomNames(roomNames, maintenanceRooms);
  const availableRoomNames = roomNames.filter((roomName) => !maintenanceRoomNames.includes(roomName));
  const usedRoomNames = new Set<string>();
  return appointments.map((appointment) => {
    const savedRoomName = appointment.roomName?.trim();
    const roomName = savedRoomName && availableRoomNames.includes(savedRoomName) && !usedRoomNames.has(savedRoomName)
      ? savedRoomName
      : availableRoomNames.find((name) => !usedRoomNames.has(name)) ?? "";
    if (roomName) usedRoomNames.add(roomName);
    return { appointment, roomName };
  }).filter((assignment) => assignment.roomName);
}

function normalizeMaintenanceRoomNames(roomNames: string[], maintenanceRooms: number | string[]) {
  if (Array.isArray(maintenanceRooms)) {
    return Array.from(new Set(maintenanceRooms.map((roomName) => roomName.trim()).filter((roomName) => roomNames.includes(roomName))));
  }
  const maintenanceRoomCount = Math.max(0, Math.min(roomNames.length, Math.trunc(maintenanceRooms)));
  return roomNames.slice(Math.max(0, roomNames.length - maintenanceRoomCount));
}
