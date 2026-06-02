import type { Appointment } from "./types";

export type AppointmentRange = "today" | "tomorrow" | "week";

export type AppointmentRangeMeta = {
  label: string;
  start: Date;
  end: Date;
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
  remainingRoomSlots: number;
  roomAssignments: AppointmentRoomAssignment[];
  roomCapacity: number;
};

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
  maintenanceRoomCount = 0,
): AppointmentRoomUsage {
  const availableRoomCount = Math.max(0, roomNames.length - maintenanceRoomCount);
  const dayCount = countCalendarDays(rangeMeta.start, rangeMeta.end);
  const roomCapacity = availableRoomCount * dayCount;
  const activeAppointments = appointments.filter(isActiveRoomAppointment);
  const bookedRoomSlots = Math.min(activeAppointments.length, roomCapacity);
  const remainingRoomSlots = Math.max(0, roomCapacity - bookedRoomSlots);
  const roomAssignments = activeAppointments.slice(0, availableRoomCount).map((appointment, index) => ({
    appointment,
    roomName: roomNames[index] ?? `护理房 ${index + 1}`,
  }));

  return {
    availableRoomCount,
    bookedRoomSlots,
    dayCount,
    maintenanceRoomCount,
    remainingRoomSlots,
    roomAssignments,
    roomCapacity,
  };
}
