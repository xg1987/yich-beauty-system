import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { CalendarDays, ChartNoAxesColumnIncreasing, CreditCard, HeartHandshake, LayoutDashboard, PackagePlus, Share2, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { PanelTitle } from "../components/layout/PanelTitle";
import { appointmentEndAt, appointmentServiceIds, summarizeAppointmentsForMonth } from "../domain/appointments";
import type { UserSession } from "../domain/auth";
import { memberCardCashIn, memberCardCashRefund } from "../domain/business";
import type { AppData, Appointment, CustomerSignature, Staff, UserRole, ViewKey } from "../domain/types";
import { businessDateOf, businessDateToday, money, shortDate } from "../domain/utils";

type NavigateToView = (view: ViewKey, options?: { appointmentId?: string; posModule?: "card" | "product" | "signature" | "single" | "orders"; posSignatureId?: string }) => void;

const WORKBENCH_SCHEDULE_START_HOUR = 8;
const WORKBENCH_SCHEDULE_END_HOUR = 23;
const WORKBENCH_SCHEDULE_TOTAL_MINUTES = (WORKBENCH_SCHEDULE_END_HOUR - WORKBENCH_SCHEDULE_START_HOUR) * 60;
const WORKBENCH_SCHEDULE_HOURS = Array.from(
  { length: WORKBENCH_SCHEDULE_END_HOUR - WORKBENCH_SCHEDULE_START_HOUR + 1 },
  (_, index) => WORKBENCH_SCHEDULE_START_HOUR + index,
);

function shortTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dashboardAppointmentTimeRange(data: AppData, appointment: Appointment) {
  return `${shortDate(appointment.startAt)}-${shortTime(appointmentEndAt(appointment, data.services).toISOString())}`;
}

function dashboardNameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}

function dashboardPrimaryStoreName(data: AppData) {
  return data.storeProfiles[0]?.name?.trim() || "";
}

function dashboardActiveStaffOf(data: AppData): Staff[] {
  return data.staff.filter((staff) => staff.status === "active");
}

export function Dashboard({ data, session, setView }: { data: AppData; session: UserSession; setView: NavigateToView }) {
  const paidRevenue = data.orders
    .filter((order) => order.payMethod !== "会员卡")
    .reduce((sum, order) => sum + order.paidAmount, 0)
    + data.memberCardTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0)
    - data.memberCardTransactions.reduce((sum, transaction) => sum + memberCardCashRefund(transaction), 0);
  const today = new Date();
  const todayBusinessDate = businessDateToday(today);
  const todayAppointmentsList = data.appointments
    .filter((item) => businessDateOf(item.startAt) === todayBusinessDate)
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const todayOrders = data.orders.filter((item) => businessDateOf(item.createdAt) === todayBusinessDate);
  const todayMemberCardIncomeTransactions = data.memberCardTransactions.filter((transaction) => businessDateOf(transaction.createdAt) === todayBusinessDate && memberCardCashIn(transaction) > 0);
  const todayMemberCardRefundTransactions = data.memberCardTransactions.filter((transaction) => businessDateOf(transaction.createdAt) === todayBusinessDate && memberCardCashRefund(transaction) > 0);
  const userStaffId = session.user.staffId;
  const roleAppointmentsList = session.user.role === "therapist" && userStaffId
    ? todayAppointmentsList.filter((item) => item.staffId === userStaffId)
    : todayAppointmentsList;
  const roleOrders = session.user.role === "therapist" && userStaffId
    ? todayOrders.filter((item) => item.staffId === userStaffId)
    : todayOrders;
  const roleCashOrders = roleOrders.filter((order) => order.payMethod !== "会员卡");
  const roleMemberCardIncomeTransactions = session.user.role === "therapist" ? [] : todayMemberCardIncomeTransactions;
  const todayAppointments = roleAppointmentsList.length;
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const pendingCommissions = data.commissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const followUps = data.customerFollowUps.filter((item) => item.status === "待跟进");
  const roleFollowUps = session.user.role === "therapist" && userStaffId ? followUps.filter((item) => item.staffId === userStaffId) : followUps;
  const pendingFollowUps = roleFollowUps.length;
  const activeCards = data.memberCards.filter((item) => item.status === "正常").length;
  const todayRevenue = roleCashOrders.reduce((sum, item) => sum + item.paidAmount, 0)
    + roleMemberCardIncomeTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0)
    - (session.user.role === "therapist"
      ? 0
      : todayMemberCardRefundTransactions.reduce((sum, transaction) => sum + memberCardCashRefund(transaction), 0));
  const completedAppointments = roleAppointmentsList.filter((item) => item.status === "已完成").length;
  const pendingConfirmAppointments = roleAppointmentsList.filter((item) => item.status === "待确认");
  const pendingArrivalAppointments = roleAppointmentsList.filter((item) => item.status === "已确认");
  const onlineRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理").length;
  const myCommission = userStaffId ? data.commissions.filter((item) => item.staffId === userStaffId && item.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0) : 0;
  const signatureStaffId = (signature: CustomerSignature) => {
    const record = signature.serviceRecordId ? data.customerServiceRecords.find((item) => item.id === signature.serviceRecordId) : undefined;
    const order = signature.orderId ? data.orders.find((item) => item.id === signature.orderId) : undefined;
    return record?.staffId ?? order?.staffId ?? "";
  };
  const pendingSignatureList = data.customerSignatures
    .filter((item) => item.status === "待签名")
    .filter((item) => session.user.role !== "therapist" || !userStaffId || signatureStaffId(item) === userStaffId);
  const dashboardContent = roleDashboardContent({
    activeCards,
    completedAppointments,
    lowStockCount: lowStock.length,
    myCommission,
    onlineRequests,
    paidRevenue,
    pendingApprovals,
    pendingCommissions,
    pendingFollowUps,
    role: session.user.role,
    todayAppointments,
    todayRevenue,
  });
  const todayLabel = today.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const waitingArrivalCount = pendingConfirmAppointments.length + pendingArrivalAppointments.length;
  const isOrdinaryEmployee = session.user.role === "therapist" || session.user.role === "frontdesk";
  const heroLine = session.user.role === "therapist" ? "护理有序，客户安心" : session.user.role === "frontdesk" ? "到店有序，客户清晰" : "今日有序，门店有数";
  const heroStats = session.user.role === "therapist"
    ? `我的预约 ${todayAppointments} · 待回访 ${pendingFollowUps} · 提成 ${money(myCommission)}`
    : isOrdinaryEmployee
      ? `预约 ${todayAppointments} · 待到店 ${waitingArrivalCount} · 客户 ${data.customers.length}`
      : `预约 ${todayAppointments} · 待到店 ${waitingArrivalCount} · 今日实收 ${money(todayRevenue)}`;
  if (isOrdinaryEmployee) {
    const todayCardOpens = todayMemberCardIncomeTransactions.length;
    return (
      <EmployeeWorkDashboard
        activeCards={activeCards}
        data={data}
        pendingFollowUps={pendingFollowUps}
        pendingSignatureCount={pendingSignatureList.length}
        roleAppointmentsList={roleAppointmentsList}
        session={session}
        setView={setView}
        todayAppointments={todayAppointments}
        todayCardOpens={todayCardOpens}
        waitingArrivalCount={waitingArrivalCount}
      />
    );
  }

  return (
    <div className="dashboard-page workbench-visual-page">
      <section className={`workbench-hero role-hero-${session.user.role}`}>
        <span className="workbench-hero-kicker"><Sparkles size={15} /> {dashboardContent.title}</span>
        <h2>{heroLine}</h2>
        <p>{heroStats}</p>
        <small>{todayLabel}</small>
      </section>

      <section className="workbench-metric-row" aria-label="今日">
        {dashboardContent.metrics.map((item) => (
          <DashboardMetric key={item.label} icon={item.icon} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <ManagerSchedulePanel data={data} setView={setView} />
    </div>
  );
}

function ManagerSchedulePanel({ data, setView }: { data: AppData; setView: NavigateToView }) {
  const [queryMode, setQueryMode] = useState<"week" | "month">("week");
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const value = new Date();
    return new Date(value.getFullYear(), value.getMonth(), 1);
  });
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const scheduleStaff = dashboardActiveStaffOf(data);
  const effectiveAppointments = useMemo(
    () => data.appointments
      .filter((appointment) => !["已取消", "爽约"].includes(appointment.status))
      .slice()
      .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
    [data.appointments],
  );
  const visibleDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() + index);
    return date;
  });
  const selectedDate = visibleDates[selectedDayIndex] ?? visibleDates[0];
  const dayAppointments = effectiveAppointments.filter((appointment) => sameScheduleDate(appointment.startAt, selectedDate));
  const scheduleDayStart = new Date(selectedDate);
  scheduleDayStart.setHours(WORKBENCH_SCHEDULE_START_HOUR, 0, 0, 0);
  const scheduleDayEnd = new Date(selectedDate);
  scheduleDayEnd.setHours(WORKBENCH_SCHEDULE_END_HOUR, 0, 0, 0);
  const visibleScheduleAppointments = dayAppointments.filter((appointment) => {
    const start = new Date(appointment.startAt);
    const end = new Date(appointmentEndAt(appointment, data.services));
    return +end > +scheduleDayStart && +start < +scheduleDayEnd;
  });
  const freeStaffCount = scheduleStaff.filter((staff) => !visibleScheduleAppointments.some((appointment) => appointment.staffId === staff.id)).length;
  const scheduleRows = scheduleStaff.map((staff) => {
    const appointments = visibleScheduleAppointments
      .filter((appointment) => appointment.staffId === staff.id)
      .map((appointment) => {
        const start = new Date(appointment.startAt);
        const end = new Date(appointmentEndAt(appointment, data.services));
        const startMinutes = Math.max(0, Math.min(WORKBENCH_SCHEDULE_TOTAL_MINUTES, Math.round((+start - +scheduleDayStart) / 60000)));
        const endMinutes = Math.max(startMinutes, Math.min(WORKBENCH_SCHEDULE_TOTAL_MINUTES, Math.round((+end - +scheduleDayStart) / 60000)));
        const left = (startMinutes / WORKBENCH_SCHEDULE_TOTAL_MINUTES) * 100;
        const rawDurationMinutes = Math.max(0, endMinutes - startMinutes);
        const visualDurationMinutes = Math.max(60, Math.ceil(rawDurationMinutes / 30) * 30);
        const visualEndMinutes = Math.min(WORKBENCH_SCHEDULE_TOTAL_MINUTES, startMinutes + visualDurationMinutes);
        const visualWidth = ((visualEndMinutes - startMinutes) / WORKBENCH_SCHEDULE_TOTAL_MINUTES) * 100;
        const serviceNames = appointmentServiceIds(appointment)
          .map((serviceId) => dashboardNameOf(data.services, serviceId))
          .filter((name) => name && name !== "-");
        const timeLabel = start.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
        const customerName = dashboardNameOf(data.customers, appointment.customerId);
        const serviceLabel = serviceNames[0] ?? "预约";
        return {
          appointment,
          label: `${timeLabel} ${customerName} ${serviceLabel}`,
          left,
          primaryLabel: timeLabel,
          secondaryLabel: customerName,
          tone: scheduleAppointmentTone(appointment.status),
          width: visualWidth,
        };
      });
    return { appointments, staff };
  });
  const selectedDateLabel = scheduleRelativeDayLabel(selectedDate, today);
  const title = `${selectedDateLabel === "今天" ? "今日" : selectedDateLabel === "明天" ? "明日" : scheduleDateTitle(selectedDate)}预约排班表`;
  const summary = `${selectedDateLabel} · ${dayAppointments.length}单 · ${scheduleStaff.length}人 · 空闲${freeStaffCount}人`;
  const monthSummary = summarizeAppointmentsForMonth(data.appointments, data.services, selectedMonth, now);
  const arrivedCustomers = monthCustomerSummaryRows(monthSummary.arrived, data, "arrived");
  const absentCustomers = monthCustomerSummaryRows(monthSummary.missed, data, "absent");
  const canceledCustomers = monthCustomerSummaryRows(monthSummary.canceled, data, "absent");

  const selectQueryMode = (mode: "week" | "month") => {
    setQueryMode(mode);
    if (mode === "week") {
      setSelectedDayIndex(0);
    }
  };

  const shiftMonth = (amount: number) => {
    setSelectedMonth((value) => new Date(value.getFullYear(), value.getMonth() + amount, 1));
  };

  return (
    <section className="workbench-panel workbench-schedule-panel">
      <div className="workbench-schedule-head">
        <div>
          <div className="workbench-schedule-title-row">
            <h2>{queryMode === "month" ? `${monthSummary.range.label}预约月总结` : title}</h2>
            <div className="workbench-schedule-query-tabs" role="group" aria-label="预约查询范围">
              <button type="button" className={queryMode === "week" ? "active" : undefined} onClick={() => selectQueryMode("week")}>本周</button>
              <button type="button" className={queryMode === "month" ? "active" : undefined} onClick={() => selectQueryMode("month")}>月总结</button>
            </div>
          </div>
          {queryMode !== "month" && (
            <div className="workbench-schedule-date-tabs" role="group" aria-label="本周连续七天预约日期">
              {visibleDates.map((date, index) => {
                const count = effectiveAppointments.filter((appointment) => sameScheduleDate(appointment.startAt, date)).length;
                const weekdayLabel = scheduleWeekday(date);
                const label = scheduleRelativeDayLabel(date, today);
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    className={selectedDayIndex === index ? "active" : undefined}
                    aria-pressed={selectedDayIndex === index}
                    onClick={() => setSelectedDayIndex(index)}
                  >
                    <span>{label}</span>
                    <strong>{scheduleShortDate(date)}</strong>
                    <small>{label === weekdayLabel ? "" : `${weekdayLabel} · `}{count}单</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <strong>{queryMode === "month" ? `共${monthSummary.appointments.length}单 · 已到店${monthSummary.arrived.length}单 · 未到店${monthSummary.missed.length}单 · 取消${monthSummary.canceled.length}单 · 待到店${monthSummary.upcoming.length}单` : summary}</strong>
          {queryMode === "month" ? (
            <div className="workbench-month-picker">
              <button type="button" aria-label="上一个月" onClick={() => shiftMonth(-1)}>‹</button>
              <label>
                <span>查询月份</span>
                <input
                  type="month"
                  value={scheduleMonthInputValue(selectedMonth)}
                  onChange={(event) => {
                    const [year, month] = event.target.value.split("-").map(Number);
                    if (year && month) setSelectedMonth(new Date(year, month - 1, 1));
                  }}
                />
              </label>
              <button type="button" aria-label="下一个月" onClick={() => shiftMonth(1)}>›</button>
            </div>
          ) : <ScheduleLegend />}
        </div>
      </div>

      {queryMode === "month" ? (
        <div className="workbench-month-summary" aria-label={`${monthSummary.range.label}预约月总结`}>
          <div className="workbench-month-kpis">
            <article><span>本月预约</span><strong>{monthSummary.appointments.length}</strong><small>单 · {new Set(monthSummary.appointments.map((item) => item.customerId)).size}人</small></article>
            <article className="arrived"><span>已到店</span><strong>{monthSummary.arrived.length}</strong><small>单 · {arrivedCustomers.length}人</small></article>
            <article className="absent"><span>未到店</span><strong>{monthSummary.missed.length}</strong><small>单 · {new Set(monthSummary.missed.map((item) => item.customerId)).size}人</small></article>
            <article className="canceled"><span>已取消</span><strong>{monthSummary.canceled.length}</strong><small>单 · {canceledCustomers.length}人</small></article>
            <article className="upcoming"><span>待到店</span><strong>{monthSummary.upcoming.length}</strong><small>单 · {new Set(monthSummary.upcoming.map((item) => item.customerId)).size}人</small></article>
          </div>
          <div className="workbench-month-lists">
            <section className="workbench-month-list arrived-list">
              <header><div><strong>已到店客户明细</strong><span>客户档案、预约项目、服务人员与到店结果</span></div><b>{arrivedCustomers.length}人 · {monthSummary.arrived.length}条</b></header>
              <div className="workbench-month-customer-list">
                <div className="workbench-month-table-head" aria-hidden="true">
                  <span>客户信息</span><span>客户档案</span><span>预约明细</span><span>项目/服务人</span><span>到店结果/备注</span><span>操作</span>
                </div>
                {arrivedCustomers.map((row) => (
                  <button key={row.customerId} type="button" onClick={() => setView("appointments", { appointmentId: row.appointmentId })}>
                    <span className="workbench-month-customer-main" data-label="客户信息"><strong>{row.name}</strong><small>{row.phone}</small></span>
                    <span className="workbench-month-customer-profile" data-label="客户档案"><strong>{row.level}</strong><small>{row.source} · {row.tags}</small></span>
                    <span className="workbench-month-customer-detail" data-label="预约明细"><strong>{row.visits}</strong><small>共{row.count}次预约</small></span>
                    <span className="workbench-month-customer-service" data-label="项目/服务人"><strong>{row.services}</strong><small>{row.staffNames} · 最近到店 {row.lastVisit}</small></span>
                    <span className="workbench-month-customer-result" data-label="到店结果/备注"><em className="arrived">已到店 {row.count}次</em><small>{row.notes}</small></span>
                    <span className="workbench-month-customer-action">查看预约 ›</span>
                  </button>
                ))}
                {arrivedCustomers.length === 0 && <p className="empty">该月暂无已到店客户</p>}
              </div>
            </section>
            <section className="workbench-month-list absent-list">
              <header><div><strong>爽约／未到店客户明细</strong><span>仅统计爽约和逾期未到店，不包含已取消预约</span></div><b>{absentCustomers.length}人 · {monthSummary.missed.length}条</b></header>
              <div className="workbench-month-customer-list">
                <div className="workbench-month-table-head" aria-hidden="true">
                  <span>客户信息</span><span>客户档案</span><span>预约明细</span><span>项目/服务人</span><span>结果/原因</span><span>操作</span>
                </div>
                {absentCustomers.map((row) => (
                  <button key={row.customerId} type="button" onClick={() => setView("appointments", { appointmentId: row.appointmentId })}>
                    <span className="workbench-month-customer-main" data-label="客户信息"><strong>{row.name}</strong><small>{row.phone}</small></span>
                    <span className="workbench-month-customer-profile" data-label="客户档案"><strong>{row.level}</strong><small>{row.source} · {row.tags}</small></span>
                    <span className="workbench-month-customer-detail" data-label="预约明细"><strong>{row.visits}</strong><small>共{row.count}次记录</small></span>
                    <span className="workbench-month-customer-service" data-label="项目/服务人"><strong>{row.services}</strong><small>{row.staffNames} · 最近到店 {row.lastVisit}</small></span>
                    <span className="workbench-month-customer-result" data-label="结果/原因"><em className={row.tone}>{row.reason} {row.count}次</em><small>{row.notes}</small></span>
                    <span className="workbench-month-customer-action">查看预约 ›</span>
                  </button>
                ))}
                {absentCustomers.length === 0 && <p className="empty">该月暂无未到店客户</p>}
              </div>
            </section>
            <section className="workbench-month-list canceled-list">
              <header><div><strong>已取消客户明细</strong><span>单独展示取消时间、项目、服务人员和取消原因</span></div><b>{canceledCustomers.length}人 · {monthSummary.canceled.length}条</b></header>
              <div className="workbench-month-customer-list">
                <div className="workbench-month-table-head" aria-hidden="true">
                  <span>客户信息</span><span>客户档案</span><span>预约明细</span><span>项目/服务人</span><span>取消原因</span><span>操作</span>
                </div>
                {canceledCustomers.map((row) => (
                  <button key={row.customerId} type="button" onClick={() => setView("appointments", { appointmentId: row.appointmentId })}>
                    <span className="workbench-month-customer-main" data-label="客户信息"><strong>{row.name}</strong><small>{row.phone}</small></span>
                    <span className="workbench-month-customer-profile" data-label="客户档案"><strong>{row.level}</strong><small>{row.source} · {row.tags}</small></span>
                    <span className="workbench-month-customer-detail" data-label="预约明细"><strong>{row.visits}</strong><small>共{row.count}次取消记录</small></span>
                    <span className="workbench-month-customer-service" data-label="项目/服务人"><strong>{row.services}</strong><small>{row.staffNames} · 最近到店 {row.lastVisit}</small></span>
                    <span className="workbench-month-customer-result" data-label="取消原因"><em className="canceled">已取消 {row.count}次</em><small>{row.notes}</small></span>
                    <span className="workbench-month-customer-action">查看预约 ›</span>
                  </button>
                ))}
                {canceledCustomers.length === 0 && <p className="empty">该月暂无已取消客户</p>}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="workbench-schedule-table" aria-label={`${selectedDateLabel}预约排班时间轴`}>
          <div className="workbench-schedule-time-row">
            <span aria-hidden="true" />
            <div>
              {WORKBENCH_SCHEDULE_HOURS.map((hour) => <b key={hour}>{hour.toString().padStart(2, "0")}</b>)}
            </div>
          </div>
          {scheduleRows.map((row) => (
            <div key={row.staff.id} className="workbench-schedule-row">
              <div className="workbench-schedule-staff"><strong>{row.staff.name}</strong></div>
              <div className="workbench-schedule-lane">
                {row.appointments.map((item) => (
                  <button
                    key={item.appointment.id}
                    type="button"
                    className={`workbench-schedule-block ${item.tone}`}
                    style={{ "--schedule-left": `${item.left}%`, "--schedule-width": `${item.width}%` } as CSSProperties}
                    title={item.label}
                    onClick={() => setView("appointments", { appointmentId: item.appointment.id })}
                  >
                    <span>{item.primaryLabel}</span><small>{item.secondaryLabel}</small>
                  </button>
                ))}
                {row.appointments.length === 0 && <span className="workbench-schedule-free">空闲 · 可安排</span>}
              </div>
            </div>
          ))}
          {scheduleRows.length === 0 && <p className="empty">暂无排班数据</p>}
        </div>
      )}
    </section>
  );
}

function ScheduleLegend() {
  return (
    <div className="workbench-schedule-legend" aria-label="预约状态">
      <span className="legend-pending"><i className="pending" />待确认</span>
      <span className="legend-waiting"><i className="waiting" />待到店</span>
      <span className="legend-active"><i className="active" />服务中</span>
      <span className="legend-done"><i className="done" />已完成</span>
    </div>
  );
}

function sameScheduleDate(value: string, date: Date) {
  return new Date(value).toDateString() === date.toDateString();
}

function scheduleShortDate(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function scheduleWeekday(date: Date) {
  return date.toLocaleDateString("zh-CN", { weekday: "short" });
}

function scheduleRelativeDayLabel(date: Date, today: Date) {
  if (sameScheduleDate(date.toISOString(), today)) return "今天";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameScheduleDate(date.toISOString(), tomorrow)) return "明天";
  return scheduleWeekday(date);
}

function scheduleMonthInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthCustomerSummaryRows(appointments: Appointment[], data: AppData, kind: "arrived" | "absent") {
  const grouped = new Map<string, Appointment[]>();
  appointments.forEach((appointment) => grouped.set(appointment.customerId, [...(grouped.get(appointment.customerId) ?? []), appointment]));
  return Array.from(grouped.entries()).map(([customerId, rows]) => {
    const customer = data.customers.find((item) => item.id === customerId);
    const sortedRows = rows.slice().sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt));
    const services = Array.from(new Set(sortedRows.flatMap((appointment) => appointmentServiceIds(appointment).map((id) => dashboardNameOf(data.services, id))))).filter((name) => name !== "-");
    const staffNames = Array.from(new Set(sortedRows.map((appointment) => dashboardNameOf(data.staff, appointment.staffId)))).filter((name) => name !== "-");
    const statuses = new Set(sortedRows.map((appointment) => appointment.status));
    const hasMissed = sortedRows.some((appointment) => appointment.status !== "已取消");
    const reason = kind === "arrived" ? "已到店" : hasMissed ? (statuses.has("爽约") ? "爽约/未到店" : "未到店") : "已取消";
    return {
      appointmentId: sortedRows.at(-1)?.id ?? "",
      count: rows.length,
      customerId,
      lastVisit: scheduleCustomerDate(customer?.lastVisit),
      level: customer?.level || "普通客户",
      name: customer?.name ?? "未知客户",
      notes: Array.from(new Set(sortedRows.flatMap((appointment) => [appointment.cancelReason, appointment.note]).map((value) => value?.trim()).filter(Boolean))).join("、") || "无备注",
      phone: customer?.phone ?? "暂无手机号",
      reason,
      services: services.join("、") || "未填项目",
      source: customer?.source ? `来源：${customer.source}` : "来源未记录",
      staffNames: staffNames.join("、") || "未分配员工",
      tags: customer?.tags?.length ? customer.tags.join("/") : "无标签",
      tone: hasMissed ? "absent" : "canceled",
      visits: sortedRows.map((appointment) => `${new Date(appointment.startAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${new Date(appointment.startAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`).join("、"),
    };
  });
}

function scheduleCustomerDate(value?: string) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}

function scheduleDateTitle(date: Date) {
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

function scheduleAppointmentTone(status: Appointment["status"]) {
  if (status === "待确认") return "pending";
  if (status === "已到店") return "active";
  if (status === "已完成") return "done";
  return "waiting";
}

function EmployeeWorkDashboard({
  activeCards,
  data,
  pendingFollowUps,
  pendingSignatureCount,
  roleAppointmentsList,
  session,
  setView,
  todayAppointments,
  todayCardOpens,
  waitingArrivalCount,
}: {
  activeCards: number;
  data: AppData;
  pendingFollowUps: number;
  pendingSignatureCount: number;
  roleAppointmentsList: Appointment[];
  session: UserSession;
  setView: NavigateToView;
  todayAppointments: number;
  todayCardOpens: number;
  waitingArrivalCount: number;
}) {
  const storeName = dashboardPrimaryStoreName(data);
  const isTherapist = session.user.role === "therapist";
  const todayLabel = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const pendingAppointments = roleAppointmentsList.filter((item) => item.status !== "已完成" && item.status !== "已取消").slice(0, 4);
  const followUpRows = data.customerFollowUps
    .filter((item) => item.status === "待跟进")
    .filter((item) => !isTherapist || !session.user.staffId || item.staffId === session.user.staffId)
    .slice(0, 3);
  const signatureRows = data.customerSignatures.filter((item) => item.status === "待签名").slice(0, 3);
  const quickStats = [
    { label: "今日预约", value: `${todayAppointments}`, hint: "单" },
    { label: "待到店", value: `${waitingArrivalCount}`, hint: "单" },
    { label: "待签名", value: `${pendingSignatureCount}`, hint: "份" },
    { label: "今日开卡", value: `${todayCardOpens}`, hint: "张" },
  ];
  return (
    <div className="dashboard-page employee-work-page">
      <section className={`workbench-hero employee-work-hero role-hero-${session.user.role}`}>
        <span className="workbench-hero-kicker"><Sparkles size={15} /> {isTherapist ? "今日工作" : "前台工作"}</span>
        <h2>{storeName || "门店"}</h2>
        <p>{todayLabel} · 预约 {todayAppointments} · 待签名 {pendingSignatureCount} · 有效卡 {activeCards}</p>
      </section>

      <section className="employee-stat-grid" aria-label="今日工作数据">
        {quickStats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.hint}</small>
          </article>
        ))}
      </section>

      <section className="employee-content-grid">
        <div className="workbench-panel employee-task-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title={isTherapist ? "我的预约" : "今日预约"} action={`${pendingAppointments.length} 单`} />
          <div className="employee-card-list">
            {pendingAppointments.map((appointment) => (
              <article key={appointment.id} className="employee-appointment-card">
                <div>
                  <strong>{dashboardAppointmentTimeRange(data, appointment)}</strong>
                  <span>{dashboardNameOf(data.customers, appointment.customerId)}</span>
                </div>
                <p>{dashboardNameOf(data.services, appointment.serviceId)} · {dashboardNameOf(data.staff, appointment.staffId)}</p>
                <small>{appointment.roomName || "未排房"} · {appointment.status}</small>
                <button type="button" onClick={() => setView("appointments")}>查看预约</button>
              </article>
            ))}
            {pendingAppointments.length === 0 && <p className="empty">今日暂无待处理预约</p>}
          </div>
        </div>

        <div className="workbench-panel employee-task-panel">
          <PanelTitle icon={<HeartHandshake size={18} />} title="客户待办" action={`${pendingFollowUps + pendingSignatureCount} 项`} />
          <div className="employee-card-list">
            {signatureRows.map((signature) => (
              <article key={signature.id} className="employee-follow-card">
                <strong>服务签名</strong>
                <span>{dashboardNameOf(data.customers, signature.customerId)} · {signature.status}</span>
                <button type="button" onClick={() => setView("pos", { posModule: "signature", posSignatureId: signature.id })}>去签名</button>
              </article>
            ))}
            {followUpRows.map((followUp) => (
              <article key={followUp.id} className="employee-follow-card">
                <strong>{followUp.method}</strong>
                <span>{dashboardNameOf(data.customers, followUp.customerId)} · {followUp.dueAt ? shortDate(followUp.dueAt) : "待安排"}</span>
                <button type="button" onClick={() => setView("customers")}>看客户</button>
              </article>
            ))}
            {signatureRows.length === 0 && followUpRows.length === 0 && <p className="empty">暂无客户待办</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

type RoleDashboardInput = {
  activeCards: number;
  completedAppointments: number;
  lowStockCount: number;
  myCommission: number;
  onlineRequests: number;
  paidRevenue: number;
  pendingApprovals: number;
  pendingCommissions: number;
  pendingFollowUps: number;
  role: UserRole;
  todayAppointments: number;
  todayRevenue: number;
};

type RoleDashboardContent = {
  title: string;
  desc: string;
  scheduleTitle: string;
  emptySchedule: string;
  followTitle: string;
  healthTitle: string;
  metrics: Array<{ icon: ReactNode; label: string; value: string; hint: string }>;
  healthMetrics: Array<{ icon: ReactNode; label: string; value: string; hint: string }>;
  actions: Array<{ icon: ReactNode; label: string; value: string; view: ViewKey }>;
};

function roleDashboardContent(input: RoleDashboardInput): RoleDashboardContent {
  if (input.role === "therapist") {
    return {
      title: "今日服务",
      desc: "今日预约、护理记录、客户回访和个人提成集中呈现。",
      scheduleTitle: "我的今日预约",
      emptySchedule: "今天暂无分配给你的预约",
      followTitle: "我的客户回访",
      healthTitle: "个人服务概览",
      metrics: [
        { icon: <CalendarDays size={18} />, label: "我的预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
        { icon: <HeartHandshake size={18} />, label: "我的回访", value: `${input.pendingFollowUps} 位`, hint: "护理后跟进任务" },
        { icon: <CreditCard size={18} />, label: "个人提成", value: money(input.myCommission), hint: "服务提成累计" },
      ],
      healthMetrics: [
        { icon: <CalendarDays size={18} />, label: "今日服务", value: `${input.todayAppointments} 单`, hint: `完成 ${input.completedAppointments} 单` },
        { icon: <HeartHandshake size={18} />, label: "客户回访", value: `${input.pendingFollowUps} 位`, hint: "待跟进" },
        { icon: <CreditCard size={18} />, label: "累计提成", value: money(input.myCommission), hint: "个人业绩" },
        { icon: <UsersRound size={18} />, label: "服务客户", value: `${input.pendingFollowUps + input.completedAppointments} 位`, hint: "今日相关客户" },
      ],
      actions: [
        { icon: <CalendarDays size={18} />, label: "我的预约", value: `${input.todayAppointments}`, view: "appointments" },
        { icon: <HeartHandshake size={18} />, label: "客户回访", value: `${input.pendingFollowUps}`, view: "customers" },
      ],
    };
  }
  if (input.role === "frontdesk") {
    return {
      title: "前台今日到店",
      desc: "把预约确认、线上到店申请和客户建档放在首屏，前台按到店流程连续处理。",
      scheduleTitle: "今日到店安排",
      emptySchedule: "今日暂无预约，可从预约栏新增到店计划",
      followTitle: "待联系客户",
      healthTitle: "前台执行概览",
      metrics: [
        { icon: <Share2 size={18} />, label: "线上申请", value: `${input.onlineRequests} 单`, hint: "待门店处理" },
        { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
        { icon: <UsersRound size={18} />, label: "项目卡", value: `${input.activeCards} 张`, hint: "有效卡项" },
      ],
      healthMetrics: [
        { icon: <Share2 size={18} />, label: "线上申请", value: `${input.onlineRequests} 单`, hint: "待处理" },
        { icon: <CalendarDays size={18} />, label: "到店安排", value: `${input.todayAppointments} 单`, hint: `完成 ${input.completedAppointments} 单` },
        { icon: <UsersRound size={18} />, label: "项目卡", value: `${input.activeCards} 张`, hint: "有效卡项" },
        { icon: <HeartHandshake size={18} />, label: "待回访", value: `${input.pendingFollowUps} 位`, hint: "客户关怀" },
      ],
      actions: [
        { icon: <Share2 size={18} />, label: "线上预约", value: `${input.onlineRequests}`, view: "appointments" },
        { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments}`, view: "appointments" },
        { icon: <UsersRound size={18} />, label: "客户建档", value: "客户", view: "customers" },
      ],
    };
  }
  if (input.role === "finance") {
    return {
      title: "财务今日核对",
      desc: "围绕实收、退款、提成、日结锁账和审批风险组织数据，财务优先核对资金与结算。",
      scheduleTitle: "今日收银关联服务",
      emptySchedule: "今日暂无需要核对的到店服务",
      followTitle: "财务相关待办",
      healthTitle: "资金结算概览",
      metrics: [
        { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "当天收银汇总" },
        { icon: <CreditCard size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "待财务结算" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals} 单`, hint: "退款和改价风险" },
      ],
      healthMetrics: [
        { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "收银流水" },
        { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "累计实收", value: money(input.paidRevenue), hint: "全部订单" },
        { icon: <CreditCard size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "提成结算" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals} 单`, hint: "风险控制" },
      ],
      actions: [
        { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "财务报表", value: "报表", view: "reports" },
        { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals}`, view: "approvals" },
        { icon: <CreditCard size={18} />, label: "收银流水", value: money(input.todayRevenue), view: "pos" },
      ],
    };
  }
  const operatorLabel = "店长";
  return {
    title: `${operatorLabel}今日总览`,
    desc: `${operatorLabel}首屏看现金流、客户档案、审批风险和库存风险，用一页判断门店今天是否健康。`,
    scheduleTitle: "今日服务动线",
    emptySchedule: "今日暂无预约，前台可从预约栏新增到店计划",
    followTitle: "客户关怀",
    healthTitle: "经营健康度",
    metrics: [
      { icon: <CalendarDays size={18} />, label: "今日预约", value: `${input.todayAppointments} 单`, hint: `已完成 ${input.completedAppointments} 单` },
      { icon: <CreditCard size={18} />, label: "今日实收", value: money(input.todayRevenue), hint: "当天收银汇总" },
      { icon: <ShieldCheck size={18} />, label: "待处理", value: `${input.pendingApprovals + input.lowStockCount + input.onlineRequests} 项`, hint: "审批、库存和线上预约" },
    ],
    healthMetrics: [
      { icon: <CreditCard size={18} />, label: "累计实收", value: money(input.paidRevenue), hint: "全部订单" },
      { icon: <CreditCard size={18} />, label: "待结提成", value: money(input.pendingCommissions), hint: "待财务结算" },
      { icon: <UsersRound size={18} />, label: "有效项目卡", value: `${input.activeCards} 张`, hint: "客户档案" },
      { icon: <PackagePlus size={18} />, label: "库存预警", value: `${input.lowStockCount} 项`, hint: "低于预警值" },
    ],
    actions: [
      { icon: <ChartNoAxesColumnIncreasing size={18} />, label: "经营收入", value: money(input.paidRevenue), view: "reports" },
      { icon: <ShieldCheck size={18} />, label: "待审批", value: `${input.pendingApprovals}`, view: "approvals" },
      { icon: <PackagePlus size={18} />, label: "低库存", value: `${input.lowStockCount}`, view: "inventory" },
    ],
  };
}

function DashboardMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="dashboard-metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}
