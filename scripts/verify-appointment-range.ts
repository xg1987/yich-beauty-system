import assert from "node:assert/strict";
import { appointmentRangeMap, calculateAppointmentRoomUsage, filterAppointmentsByRange } from "../src/domain/appointments";
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

const ranges = appointmentRangeMap(baseDate);
assert.equal(ranges.today.label, "今日", "today range label should be stable");
assert.equal(ranges.tomorrow.label, "明日", "tomorrow range label should be stable");
assert.equal(ranges.week.label, "本周", "week range label should be stable");

assert.deepEqual(
  filterAppointmentsByRange(appointments, "today", baseDate).map((item) => item.id),
  ["today-early", "today-late"],
  "today filter should include only current day appointments in time order",
);

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
