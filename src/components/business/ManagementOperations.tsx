import { CalendarDays, CreditCard, Search } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { ApiActions } from "../../hooks/useApiData";
import type { AppData, CashPayMethod, MemberCard, Order, Staff, StaffShift } from "../../domain/types";
import { appointmentEndAt } from "../../domain/appointments";
import { calculateMemberCardRefundQuote } from "../../domain/business";
import { money, shortDate } from "../../domain/utils";
import { Badge } from "../ui/Badge";
import { DataTable } from "../ui/DataTable";
import { Select } from "../ui/Select";
import { PanelTitle } from "../layout/PanelTitle";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

type ManagementOperationProps = {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
};

const cashPayMethodOptions = (["微信", "支付宝", "现金", "银行卡"] as CashPayMethod[]).map((item) => ({ value: item, label: item }));
const memberCardRefundTabs = ["储值卡", "次卡", "套餐卡", "折扣卡", "一次性消费"] as const;
type MemberCardRefundTab = typeof memberCardRefundTabs[number];

function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}

function memberCardTabOf(card: MemberCard): MemberCardRefundTab {
  if (card.type === "次数卡") return "次卡";
  return card.type;
}

function customerPhoneOf(data: AppData, customerId: string) {
  return data.customers.find((customer) => customer.id === customerId)?.phone ?? "";
}

function orderCustomerName(data: AppData, order: Order) {
  if (order.customerId) return nameOf(data.customers, order.customerId);
  return order.guestName?.trim() || "新客";
}

function orderCustomerPhone(data: AppData, order: Order) {
  if (order.customerId) return customerPhoneOf(data, order.customerId);
  return order.guestPhone?.trim() || "";
}

function isBusinessStaff(staff: Staff) {
  return staff.role !== "老板";
}

function activeBusinessStaff(data: AppData) {
  return data.staff.filter((staff) => isBusinessStaff(staff) && staff.status === "active");
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(result, mondayOffset);
}

function sameDay(value: string, date: Date) {
  return startOfDay(new Date(value)).getTime() === startOfDay(date).getTime();
}

function timeOnly(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function timeRange(startAt: string, endAt: string) {
  return `${timeOnly(startAt)} - ${timeOnly(endAt)}`;
}

function dateTitle(date: Date) {
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${weekday}`;
}

function weekRangeLabel(dates: Date[]) {
  const first = dates[0];
  const last = dates.at(-1) ?? first;
  return `${first.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} - ${last.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;
}

function intervalsOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return +new Date(leftStart) < +new Date(rightEnd) && +new Date(rightStart) < +new Date(leftEnd);
}

function scheduleSlotsForShift(shift: StaffShift) {
  const start = new Date(shift.startAt);
  const end = new Date(shift.endAt);
  const slots: Array<{ startAt: string; endAt: string }> = [];
  let cursor = new Date(start);
  while (+cursor < +end) {
    const next = new Date(cursor);
    next.setMinutes(next.getMinutes() + 60);
    slots.push({ startAt: cursor.toISOString(), endAt: new Date(Math.min(+next, +end)).toISOString() });
    cursor = next;
  }
  return slots.length ? slots : [{ startAt: shift.startAt, endAt: shift.endAt }];
}

function summaryForDate(date: Date, staffList: Staff[], data: AppData) {
  const shifts = data.staffShifts.filter((shift) => sameDay(shift.startAt, date) && staffList.some((staff) => staff.id === shift.staffId));
  const appointments = data.appointments.filter(
    (appointment) =>
      sameDay(appointment.startAt, date)
      && appointment.status !== "已取消"
      && appointment.status !== "爽约"
      && staffList.some((staff) => staff.id === appointment.staffId),
  );
  return {
    staffDays: new Set(shifts.map((shift) => shift.staffId)).size,
    totalSlots: shifts.reduce((sum, shift) => sum + scheduleSlotsForShift(shift).length, 0),
    occupiedSlots: appointments.length,
  };
}

export function CustomerRefundManagement({ data, actions, runMutation }: ManagementOperationProps) {
  const refundableCards = data.memberCards.filter((card) => card.status !== "已退卡");
  const initialCard = refundableCards.find((card) => card.type === "储值卡") ?? refundableCards[0];
  const [activeTab, setActiveTab] = useState<MemberCardRefundTab>("储值卡");
  const [searchText, setSearchText] = useState("");
  const [refundPickerOpen, setRefundPickerOpen] = useState(false);
  const [cardId, setCardId] = useState(initialCard?.id ?? "");
  const [refundSignatureId, setRefundSignatureId] = useState("");
  const selectedCard = data.memberCards.find((card) => card.id === cardId);
  const selectedCustomer = selectedCard ? data.customers.find((customer) => customer.id === selectedCard.customerId) : undefined;
  const selectedRefundQuote = selectedCard ? calculateMemberCardRefundQuote(selectedCard, data.memberCardTransactions) : undefined;
  const initialRefundQuote = initialCard ? calculateMemberCardRefundQuote(initialCard, data.memberCardTransactions) : undefined;
  const [refundAmount, setRefundAmount] = useState(() => String(initialRefundQuote?.refundableAmount ?? initialCard?.balance ?? 0));
  const [payMethod, setPayMethod] = useState<CashPayMethod>("微信");
  const [reason, setReason] = useState("客户退卡退费");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();
  const refundValue = Number(refundAmount);
  const maxRefundAmount = selectedRefundQuote?.refundableAmount ?? selectedCard?.balance ?? 0;
  const invalidRefundAmount = !Number.isFinite(refundValue) || refundValue < 0 || Boolean(selectedCard && refundValue > maxRefundAmount);
  const normalizedSearch = searchText.trim().toLowerCase();
  const hasRefundSearch = normalizedSearch.length > 0;
  const showRefundChoices = hasRefundSearch || refundPickerOpen;
  const tabCards = refundableCards.filter((card) => memberCardTabOf(card) === activeTab);
  const filteredCards = activeTab === "一次性消费"
    ? []
    : tabCards.filter((card) => {
      const customerName = nameOf(data.customers, card.customerId);
      const phone = customerPhoneOf(data, card.customerId);
      const target = `${customerName} ${phone} ${card.name} ${card.type}`.toLowerCase();
      return !normalizedSearch || target.includes(normalizedSearch);
    });
  const oneTimeOrders = data.orders
    .filter((order) => order.status === "已支付" && order.payMethod !== "会员卡")
    .filter((order) => {
      const target = `${orderCustomerName(data, order)} ${orderCustomerPhone(data, order)} ${order.orderNo}`.toLowerCase();
      return !normalizedSearch || target.includes(normalizedSearch);
    })
    .slice(0, 20);
  const selectedRefundSignature = refundSignatureId ? data.customerSignatures.find((signature) => signature.id === refundSignatureId) : undefined;
  const hasSignedRefundSignature = Boolean(selectedRefundSignature && selectedRefundSignature.status === "已签名");
  const signatureUrl = (token: string) => `${window.location.origin}/signature/${token}`;

  const openRefundTab = (tab: MemberCardRefundTab) => {
    setActiveTab(tab);
    setRefundPickerOpen(true);
  };

  const selectCard = (nextCardId: string) => {
    setCardId(nextCardId);
    const nextCard = data.memberCards.find((card) => card.id === nextCardId);
    const nextQuote = nextCard ? calculateMemberCardRefundQuote(nextCard, data.memberCardTransactions) : undefined;
    if (nextCard) setActiveTab(memberCardTabOf(nextCard));
    setRefundPickerOpen(false);
    setRefundAmount(String(nextQuote?.refundableAmount ?? nextCard?.balance ?? 0));
    setRefundSignatureId("");
    setMessage(undefined);
  };

  const createRefundSignature = () => {
    setMessage(undefined);
    if (!selectedCard || !selectedCustomer) {
      setMessage({ type: "error", text: "请选择需要退费的会员卡。" });
      return;
    }
    void runMutation(() =>
      actions.createCustomerSignature({
        customerId: selectedCard.customerId,
        title: "会员卡退费确认签名",
        content: `${selectedCustomer.name}确认办理${selectedCard.name}退费，实退金额${money(refundValue || 0)}，退款方式${payMethod}，退费后会员卡关闭，余额和剩余次数清零。`,
        validDays: 1,
      }),
    ).then((nextData) => {
      const createdSignature = nextData.customerSignatures.find(
        (signature) =>
          signature.customerId === selectedCard.customerId
          && signature.title === "会员卡退费确认签名"
          && signature.status === "待签名",
      );
      if (createdSignature) {
        setRefundSignatureId(createdSignature.id);
        setMessage({ type: "success", text: "退费签名已生成。" });
      }
    }).catch((caught) => {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "生成签名失败" });
    });
  };

  const submitRefund = (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    if (!selectedCard) {
      setMessage({ type: "error", text: "请选择需要退费的会员卡。" });
      return;
    }
    if (invalidRefundAmount) {
      setMessage({ type: "error", text: `请填写正确的实退金额，不能大于扣除已用金额后的 ${money(maxRefundAmount)}。` });
      return;
    }
    if (!hasSignedRefundSignature || !selectedRefundSignature) {
      setMessage({ type: "error", text: "请先完成客户退费签名。" });
      return;
    }
    void runMutation(() =>
      actions.refundMemberCard(selectedCard.id, {
        reason: reason.trim() || "客户退卡",
        refundAmount: refundValue,
        payMethod,
        signatureId: selectedRefundSignature.id,
      }),
    ).then(() => {
      setMessage({ type: "success", text: "退费已完成，会员卡已关闭并写入退卡流水。" });
    }).catch((caught) => {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "退费失败" });
    });
  };

  const recentRefundRows = data.memberCardTransactions
    .filter((transaction) => transaction.type === "退卡" || transaction.type === "退款")
    .slice(0, 80)
    .map((transaction) => [
      nameOf(data.memberCards, transaction.memberCardId),
      transaction.type,
      transaction.paidAmount ? money(transaction.paidAmount) : money(Math.abs(transaction.amountDelta)),
      transaction.payMethod ?? "-",
      transaction.note,
      shortDate(transaction.createdAt),
    ]);

  return (
    <div className="module-detail-stack">
      <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="会员卡退费" action="退余额 / 退卡关闭" />
        <form className="form" onSubmit={submitRefund}>
          <div className="refund-picker">
            <div className="refund-tabs" role="tablist" aria-label="退费类型">
              {memberCardRefundTabs.map((tab) => (
                <button
                  type="button"
                  key={tab}
                  className={activeTab === tab ? "active" : ""}
                  onClick={() => openRefundTab(tab)}
                >
                  {tab}
                  <em>{tab === "一次性消费" ? oneTimeOrders.length : refundableCards.filter((card) => memberCardTabOf(card) === tab).length}</em>
                </button>
              ))}
            </div>
            <label className="refund-search">
              <span>搜索客户姓名 / 手机号码</span>
              <div>
                <Search size={16} />
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="输入姓名或手机号" />
              </div>
            </label>
            {showRefundChoices && activeTab === "一次性消费" ? (
              <div className="refund-order-list">
                {oneTimeOrders.length ? oneTimeOrders.map((order) => (
                  <article key={order.id}>
                    <strong>{orderCustomerName(data, order)}{orderCustomerPhone(data, order) ? ` · ${orderCustomerPhone(data, order)}` : ""}</strong>
                    <span>{order.orderNo} · {money(order.paidAmount)} · {order.payMethod} · {shortDate(order.createdAt)}</span>
                  </article>
                )) : <p className="empty">暂无一次性消费记录</p>}
              </div>
            ) : showRefundChoices ? (
              <div className="refund-card-list">
                {filteredCards.length ? filteredCards.map((card) => (
                  <button
                    type="button"
                    key={card.id}
                    className={card.id === cardId ? "active" : ""}
                    onClick={() => selectCard(card.id)}
                  >
                    <strong>{nameOf(data.customers, card.customerId)} · {card.name}</strong>
                    <span>{card.type} · {customerPhoneOf(data, card.customerId) || "-"} · 余额 {money(card.balance)} · 剩余 {card.remainingTimes} 次</span>
                  </button>
                )) : <p className="empty">暂无匹配会员卡</p>}
              </div>
            ) : null}
          </div>
          {selectedCard && (
            <div className="settings-static-panel refund-selected-card">
              <strong>{nameOf(data.customers, selectedCard.customerId)} · {selectedCard.name}</strong>
              <span>类型：{selectedCard.type} · 状态：{selectedCard.status}</span>
              <span>余额：{money(selectedCard.balance)} · 剩余次数：{selectedCard.remainingTimes} 次</span>
              {selectedRefundQuote && (
                <div className="refund-quote-grid">
                  <span><small>购买金额</small><strong>{money(selectedRefundQuote.paidAmount)}</strong></span>
                  <span><small>购买次数</small><strong>{selectedRefundQuote.purchasedTimes} 次</strong></span>
                  <span><small>已使用</small><strong>{selectedRefundQuote.usedTimes} 次</strong></span>
                  <span><small>单次扣除</small><strong>{money(selectedRefundQuote.unitDeduction)}</strong></span>
                  <span><small>必须扣除</small><strong>{money(selectedRefundQuote.usedDeduction)}</strong></span>
                  <span><small>建议实退</small><strong>{money(selectedRefundQuote.refundableAmount)}</strong></span>
                </div>
              )}
            </div>
          )}
          <label>实退金额<input type="number" min={0} max={maxRefundAmount} step={1} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></label>
          <Select label="退款方式" value={payMethod} onChange={(value) => setPayMethod(value as CashPayMethod)} options={cashPayMethodOptions} />
          <label>退款原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：客户退卡、余额退回、活动协商退款。" /></label>
          <div className="refund-signature-panel">
            <div>
              <strong>客户退费签名</strong>
              <span>{selectedRefundSignature ? `${selectedRefundSignature.status} · ${selectedRefundSignature.signerName ?? nameOf(data.customers, selectedRefundSignature.customerId)}` : "未生成"}</span>
            </div>
            <div>
              <button type="button" onClick={createRefundSignature} disabled={!selectedCard || invalidRefundAmount}>
                生成签名
              </button>
              {selectedRefundSignature?.status === "待签名" && (
                <a href={signatureUrl(selectedRefundSignature.token)} target="_blank" rel="noreferrer">打开签名页</a>
              )}
              {selectedRefundSignature?.status === "待签名" && (
                <button type="button" onClick={() => window.location.reload()}>刷新状态</button>
              )}
            </div>
          </div>
          {message && <p className={message.type === "success" ? "form-success" : "form-error"}>{message.text}</p>}
          <button className="primary-button" type="submit" disabled={!selectedCard || invalidRefundAmount || !hasSignedRefundSignature}>确认退费并关闭卡</button>
        </form>
      </section>

      <section className="panel">
        <PanelTitle icon={<CreditCard size={18} />} title="退费记录" action={`${recentRefundRows.length} 条`} />
        <DataTable columns={["会员卡", "类型", "实退", "方式", "原因", "时间"]} rows={recentRefundRows} />
      </section>
    </div>
  );
}

export function StaffScheduleManagement({ data }: ManagementOperationProps) {
  const [scheduleView, setScheduleView] = useState<"today" | "tomorrow" | "week">("today");
  const businessStaff = activeBusinessStaff(data);
  const today = startOfDay(new Date());
  const focusedDate = scheduleView === "tomorrow" ? addDays(today, 1) : today;
  const weekStart = startOfWeek(today);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const activeAppointments = useMemo(
    () =>
      data.appointments
        .filter((appointment) => appointment.status !== "已取消" && appointment.status !== "爽约")
        .slice()
        .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
    [data.appointments],
  );
  const shiftsForDate = (date: Date, staffId?: string) =>
    data.staffShifts
      .filter((shift) => sameDay(shift.startAt, date) && (!staffId || shift.staffId === staffId))
      .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt));
  const appointmentsForDate = (date: Date, staffId?: string) =>
    activeAppointments.filter((appointment) => sameDay(appointment.startAt, date) && (!staffId || appointment.staffId === staffId));
  const blocksForDate = (date: Date, staffId?: string) =>
    data.staffUnavailableSlots.filter((slot) => sameDay(slot.startAt, date) && (!staffId || slot.staffId === staffId));
  const daySummary = summaryForDate(focusedDate, businessStaff, data);
  const weekSummary = weekDates.reduce(
    (summary, date) => {
      const item = summaryForDate(date, businessStaff, data);
      return {
        staffDays: summary.staffDays + item.staffDays,
        totalSlots: summary.totalSlots + item.totalSlots,
        occupiedSlots: summary.occupiedSlots + item.occupiedSlots,
      };
    },
    { staffDays: 0, totalSlots: 0, occupiedSlots: 0 },
  );

  return (
    <div className="module-detail-stack">
      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="排班时间" action={scheduleView === "week" ? weekRangeLabel(weekDates) : dateTitle(focusedDate)} />
        <div className="schedule-view-tabs">
          <button type="button" className={scheduleView === "today" ? "active" : ""} onClick={() => setScheduleView("today")}>今天</button>
          <button type="button" className={scheduleView === "tomorrow" ? "active" : ""} onClick={() => setScheduleView("tomorrow")}>明天</button>
          <button type="button" className={scheduleView === "week" ? "active" : ""} onClick={() => setScheduleView("week")}>本周</button>
        </div>
        {scheduleView === "week" ? (
          <>
            <div className="schedule-summary-strip">
              <span><small>排班</small><strong>{weekSummary.staffDays} 人次</strong></span>
              <span><small>可预约</small><strong>{Math.max(0, weekSummary.totalSlots - weekSummary.occupiedSlots)} 个</strong></span>
              <span><small>已占用</small><strong>{weekSummary.occupiedSlots} 个</strong></span>
            </div>
            <div className="schedule-week-list">
              {weekDates.map((date) => {
                const dateShifts = shiftsForDate(date);
                return (
                  <article key={date.toISOString()}>
                    <strong>{dateTitle(date)}</strong>
                    {dateShifts.length ? dateShifts.map((shift) => {
                      const staffAppointments = appointmentsForDate(date, shift.staffId);
                      const occupiedRooms = Array.from(new Set(staffAppointments.map((appointment) => appointment.roomName || "未分房")));
                      return (
                        <p key={shift.id}>
                          <span>{nameOf(data.staff, shift.staffId)}</span>
                          <em>{timeRange(shift.startAt, shift.endAt)}</em>
                          <i>可约 {Math.max(0, scheduleSlotsForShift(shift).length - staffAppointments.length)} · 已占 {staffAppointments.length}{occupiedRooms.length ? `：${occupiedRooms.join("、")}` : ""}</i>
                        </p>
                      );
                    }) : <p><span>暂无排班</span><em>-</em><i>-</i></p>}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="schedule-summary-strip">
              <span><small>在岗</small><strong>{daySummary.staffDays} 人</strong></span>
              <span><small>可预约</small><strong>{Math.max(0, daySummary.totalSlots - daySummary.occupiedSlots)} 个</strong></span>
              <span><small>已占用</small><strong>{daySummary.occupiedSlots} 个</strong></span>
            </div>
            <div className="staff-schedule-grid">
              {businessStaff.map((staff) => {
                const staffShifts = shiftsForDate(focusedDate, staff.id);
                const staffAppointments = appointmentsForDate(focusedDate, staff.id);
                const staffBlocks = blocksForDate(focusedDate, staff.id);
                return (
                  <article className="staff-schedule-card" key={staff.id}>
                    <div className="staff-schedule-card-head">
                      <div>
                        <strong>{staff.name}</strong>
                        <span>{staffShifts.length ? staffShifts.map((shift) => timeRange(shift.startAt, shift.endAt)).join(" / ") : "休息"}</span>
                      </div>
                      <Badge text={staffShifts.length ? "在岗" : "休息"} tone={staffShifts.length ? "ok" : "warn"} />
                    </div>
                    {staffShifts.length ? (
                      <div className="schedule-slot-grid">
                        {staffShifts.flatMap((shift) => scheduleSlotsForShift(shift).map((slot) => {
                          const appointment = staffAppointments.find((item) => intervalsOverlap(slot.startAt, slot.endAt, item.startAt, appointmentEndAt(item, data.services).toISOString()));
                          const block = staffBlocks.find((item) => intervalsOverlap(slot.startAt, slot.endAt, item.startAt, item.endAt));
                          const status = appointment
                            ? `${appointment.roomName || "未分房"} · ${nameOf(data.customers, appointment.customerId)} · ${nameOf(data.services, appointment.serviceId)}`
                            : block ? "不可约" : "空闲";
                          return (
                            <span className={appointment ? "occupied" : block ? "blocked" : "free"} key={`${shift.id}-${slot.startAt}`}>
                              <strong>{timeOnly(slot.startAt)}</strong>
                              <em>{status}</em>
                            </span>
                          );
                        }))}
                      </div>
                    ) : (
                      <p className="schedule-rest">今日未排班</p>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
