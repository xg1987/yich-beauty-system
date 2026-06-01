import type { Appointment } from "./types";

export type AppointmentRange = "today" | "tomorrow" | "week";

export type AppointmentRangeMeta = {
  label: string;
  start: Date;
  end: Date;
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
