import assert from "node:assert/strict";
import {
  appointmentArrivalConfirmationWindow,
  appointmentEndAt,
  appointmentMonthRange,
  appointmentRangeMap,
  calculateAppointmentRoomUsage,
  filterAppointmentsByRange,
  isAppointmentInArrivalConfirmationWindow,
  summarizeAppointmentsForMonth,
} from "../src/domain/appointments";
import type { Appointment } from "../src/domain/types";

const baseDate = new Date("2026-06-03T10:30:00+08:00");

const appointment = (id: string, startAt: string): Appointment => ({
  id,
  customerId: "c1",
  staffId: "s1",
  serviceId: "v1",
  startAt,
  status: "待确认",
  note: "",
});

const appointments: Appointment[] = [
  appointment("yesterday", "2026-06-02T12:00:00+08:00"),
  appointment("today-late", "2026-06-03T18:00:00+08:00"),
  appointment("today-early", "2026-06-03T09:00:00+08:00"),
  appointment("tomorrow", "2026-06-04T11:00:00+08:00"),
  appointment("weekend", "2026-06-07T15:00:00+08:00"),
  appointment("next-week", "2026-06-08T10:00:00+08:00"),
];

assert.equal(
  appointmentEndAt({ ...appointment("explicit-end", "2026-06-03T09:00:00+08:00"), endAt: "2026-06-03T11:00:00+08:00" }).toISOString(),
  new Date("2026-06-03T11:00:00+08:00").toISOString(),
  "appointment end helper should keep explicit end time",
);
assert.equal(
  appointmentEndAt(appointment("legacy-end", "2026-06-03T09:00:00+08:00"), [{ id: "v1", name: "测试项目", category: "测试", price: 100, duration: 75 }]).toISOString(),
  new Date("2026-06-03T10:15:00+08:00").toISOString(),
  "appointment end helper should derive legacy end time from service duration",
);

const nearStartAppointment = appointment("near-start", "2026-06-03T19:30:00+08:00");
assert.equal(
  appointmentArrivalConfirmationWindow(nearStartAppointment).opensAt.toISOString(),
  new Date("2026-06-03T19:00:00+08:00").toISOString(),
  "arrival confirmation window should open 30 minutes before the appointment starts",
);
assert.equal(
  isAppointmentInArrivalConfirmationWindow(nearStartAppointment, [], new Date("2026-06-03T19:27:00+08:00")),
  true,
  "appointment should be available for arrival confirmation shortly before the start time",
);
assert.equal(
  isAppointmentInArrivalConfirmationWindow(nearStartAppointment, [], new Date("2026-06-03T18:59:59+08:00")),
  false,
  "appointment should stay booked before the arrival confirmation lead window opens",
);
assert.equal(
  isAppointmentInArrivalConfirmationWindow(nearStartAppointment, [], new Date("2026-06-03T20:31:00+08:00")),
  false,
  "appointment should leave arrival confirmation after the service window ends",
);

const ranges = appointmentRangeMap(baseDate);
assert.equal(ranges.today.label, "今日", "today range label should be stable");
assert.equal(ranges.tomorrow.label, "明日", "tomorrow range label should be stable");
assert.equal(ranges.week.label, "本周", "week range label should be stable");

assert.deepEqual(
  filterAppointmentsByRange(appointments, "today", baseDate).map((item) => item.id),
  ["today-early", "today-late"],
  "today filter should include only current day appointments in time order",
);

const monthRange = appointmentMonthRange(baseDate);
assert.equal(monthRange.label, "2026年6月", "month range should use the selected calendar month");
assert.equal(monthRange.start.toLocaleDateString("en-CA"), "2026-06-01", "month range should start on the first day");
assert.equal(monthRange.end.toLocaleDateString("en-CA"), "2026-06-30", "month range should end on the last day");

const monthSummary = summarizeAppointmentsForMonth(
  [
    { ...appointment("arrived", "2026-06-03T09:00:00+08:00"), status: "已到店" },
    { ...appointment("completed", "2026-06-04T09:00:00+08:00"), status: "已完成" },
    { ...appointment("explicit-no-show", "2026-06-05T09:00:00+08:00"), status: "爽约" },
    appointment("expired-pending", "2026-06-06T09:00:00+08:00"),
    { ...appointment("canceled-month", "2026-06-07T09:00:00+08:00"), status: "已取消" },
    { ...appointment("future-confirmed", "2026-06-20T09:00:00+08:00"), status: "已确认" },
    { ...appointment("other-month", "2026-07-01T09:00:00+08:00"), status: "已完成" },
  ],
  [{ id: "v1", name: "测试项目", category: "测试", price: 100, duration: 60 }],
  baseDate,
  new Date("2026-06-10T12:00:00+08:00"),
);
assert.deepEqual(monthSummary.arrived.map((item) => item.id), ["arrived", "completed"], "arrived summary should include checked-in and completed customers");
assert.deepEqual(monthSummary.missed.map((item) => item.id), ["explicit-no-show", "expired-pending"], "missed summary should include no-shows and overdue pending arrivals");
assert.deepEqual(monthSummary.canceled.map((item) => item.id), ["canceled-month"], "canceled appointments should stay distinguishable");
assert.deepEqual(monthSummary.upcoming.map((item) => item.id), ["future-confirmed"], "future appointments should not be mislabeled as missed");

assert.deepEqual(
  filterAppointmentsByRange(appointments, "tomorrow", baseDate).map((item) => item.id),
  ["tomorrow"],
  "tomorrow filter should include only next day appointments",
);

assert.deepEqual(
  filterAppointmentsByRange(appointments, "week", baseDate).map((item) => item.id),
  ["yesterday", "today-early", "today-late", "tomorrow", "weekend"],
  "week filter should include Monday through Sunday appointments in time order",
);

const roomUsage = calculateAppointmentRoomUsage(
  [
    appointment("active-1", "2026-06-03T09:00:00+08:00"),
    appointment("active-2", "2026-06-03T10:00:00+08:00"),
    { ...appointment("canceled", "2026-06-03T11:00:00+08:00"), status: "已取消" },
    { ...appointment("no-show", "2026-06-03T12:00:00+08:00"), status: "爽约" },
  ],
  ranges.today,
  ["护理房 1", "护理房 2", "VIP护理房"],
  ["护理房 2"],
);

assert.equal(roomUsage.availableRoomCount, 2, "room usage should subtract maintenance rooms");
assert.deepEqual(roomUsage.maintenanceRoomNames, ["护理房 2"], "room usage should keep specified maintenance rooms");
assert.equal(roomUsage.dayCount, 1, "today room usage should count one day");
assert.equal(roomUsage.roomCapacity, 2, "room capacity should be available rooms times day count");
assert.equal(roomUsage.bookedRoomSlots, 2, "active appointments should occupy rooms");
assert.equal(roomUsage.remainingRoomSlots, 0, "full room usage should leave no remaining slots");
assert.deepEqual(
  roomUsage.roomAssignments.map((item) => `${item.roomName}:${item.appointment.id}`),
  ["护理房 1:active-1", "VIP护理房:active-2"],
  "room assignments should skip specified maintenance rooms",
);

console.log("预约日期范围筛选验证通过。");
