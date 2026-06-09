import { CalendarDays, CreditCard, LockKeyhole } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { ApiActions } from "../../hooks/useApiData";
import type { AppData, CashPayMethod, Staff } from "../../domain/types";
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

function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}

function isBusinessStaff(staff: Staff) {
  return staff.role !== "老板";
}

function activeBusinessStaff(data: AppData) {
  return data.staff.filter((staff) => isBusinessStaff(staff) && staff.status === "active");
}

export function CustomerRefundManagement({ data, actions, runMutation }: ManagementOperationProps) {
  const refundableCards = data.memberCards.filter((card) => card.status !== "已退卡");
  const [cardId, setCardId] = useState(refundableCards[0]?.id ?? "");
  const selectedCard = data.memberCards.find((card) => card.id === cardId);
  const selectedRefundQuote = selectedCard ? calculateMemberCardRefundQuote(selectedCard, data.memberCardTransactions) : undefined;
  const initialRefundQuote = refundableCards[0] ? calculateMemberCardRefundQuote(refundableCards[0], data.memberCardTransactions) : undefined;
  const [refundAmount, setRefundAmount] = useState(() => String(initialRefundQuote?.refundableAmount ?? refundableCards[0]?.balance ?? 0));
  const [payMethod, setPayMethod] = useState<CashPayMethod>("微信");
  const [reason, setReason] = useState("客户退卡退费");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();
  const refundValue = Number(refundAmount);
  const maxRefundAmount = selectedRefundQuote?.refundableAmount ?? selectedCard?.balance ?? 0;
  const invalidRefundAmount = !Number.isFinite(refundValue) || refundValue < 0 || Boolean(selectedCard && refundValue > maxRefundAmount);
  const cardOptions = refundableCards.length
    ? refundableCards.map((card) => ({
      value: card.id,
      label: `${nameOf(data.customers, card.customerId)} · ${card.name} · 余额 ${money(card.balance)} · ${card.remainingTimes} 次`,
    }))
    : [{ value: "", label: "暂无可退会员卡", disabled: true }];

  const selectCard = (nextCardId: string) => {
    setCardId(nextCardId);
    const nextCard = data.memberCards.find((card) => card.id === nextCardId);
    const nextQuote = nextCard ? calculateMemberCardRefundQuote(nextCard, data.memberCardTransactions) : undefined;
    setRefundAmount(String(nextQuote?.refundableAmount ?? nextCard?.balance ?? 0));
    setMessage(undefined);
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
    void runMutation(() =>
      actions.refundMemberCard(selectedCard.id, {
        reason: reason.trim() || "客户退卡",
        refundAmount: refundValue,
        payMethod,
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
          <Select label="选择会员卡" value={cardId} onChange={selectCard} options={cardOptions} />
          {selectedCard && (
            <div className="settings-static-panel">
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
          {message && <p className={message.type === "success" ? "form-success" : "form-error"}>{message.text}</p>}
          <button className="primary-button" type="submit" disabled={!selectedCard || invalidRefundAmount}>确认退费并关闭卡</button>
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
  const businessStaff = activeBusinessStaff(data);
  const now = Date.now();
  const sortedShifts = useMemo(
    () => data.staffShifts.slice().sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
    [data.staffShifts],
  );
  const sortedBlocks = useMemo(
    () => data.staffUnavailableSlots.slice().sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
    [data.staffUnavailableSlots],
  );
  const sortedAppointments = useMemo(
    () =>
      data.appointments
        .filter((appointment) => appointment.status !== "已取消" && appointment.status !== "爽约")
        .slice()
        .sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
    [data.appointments],
  );
  const upcomingShifts = sortedShifts.filter((shift) => +new Date(shift.endAt) >= now);
  const upcomingBlocks = sortedBlocks.filter((slot) => +new Date(slot.endAt) >= now);
  const upcomingAppointments = sortedAppointments.filter((appointment) => +appointmentEndAt(appointment, data.services) >= now);

  return (
    <div className="module-detail-stack">
      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="员工排班查看" action={`${businessStaff.length} 名员工`} />
        <div className="staff-schedule-grid">
          {businessStaff.map((staff) => {
            const staffShifts = upcomingShifts.filter((shift) => shift.staffId === staff.id).slice(0, 4);
            const staffBlocks = upcomingBlocks.filter((slot) => slot.staffId === staff.id).slice(0, 4);
            const staffAppointments = upcomingAppointments.filter((appointment) => appointment.staffId === staff.id).slice(0, 4);
            return (
              <article className="staff-schedule-card" key={staff.id}>
                <div className="staff-schedule-card-head">
                  <div>
                    <strong>{staff.name}</strong>
                    <span>{staff.role}</span>
                  </div>
                  <Badge text={staff.status === "active" ? "在职" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />
                </div>
                <div className="staff-schedule-section">
                  <small>班次</small>
                  {staffShifts.length ? staffShifts.map((shift) => (
                    <p key={shift.id}><span>{shortDate(shift.startAt)} - {shortDate(shift.endAt)}</span><em>{shift.note || "正常上班"}</em></p>
                  )) : <p><span>暂无未来班次</span><em>预约时会按已有规则判断</em></p>}
                </div>
                <div className="staff-schedule-section">
                  <small>预约</small>
                  {staffAppointments.length ? staffAppointments.map((appointment) => (
                    <p key={appointment.id}>
                      <span>{shortDate(appointment.startAt)} - {shortDate(appointmentEndAt(appointment, data.services).toISOString())}</span>
                      <em>{nameOf(data.customers, appointment.customerId)} · {nameOf(data.services, appointment.serviceId)} · {appointment.status}</em>
                    </p>
                  )) : <p><span>暂无未来预约</span><em>没有待确认/已确认/已到店预约</em></p>}
                </div>
                <div className="staff-schedule-section blocked">
                  <small>不可预约</small>
                  {staffBlocks.length ? staffBlocks.map((slot) => (
                    <p key={slot.id}><span>{shortDate(slot.startAt)} - {shortDate(slot.endAt)}</span><em>{slot.reason}</em></p>
                  )) : <p><span>暂无锁定时间</span><em>无请假/培训/休息记录</em></p>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="全员预约明细" action={`${sortedAppointments.length} 条预约`} />
        <DataTable
          columns={["员工", "客户", "项目", "开始", "结束", "状态"]}
          rows={sortedAppointments.slice(0, 120).map((appointment) => [
            nameOf(data.staff, appointment.staffId),
            nameOf(data.customers, appointment.customerId),
            nameOf(data.services, appointment.serviceId),
            shortDate(appointment.startAt),
            shortDate(appointmentEndAt(appointment, data.services).toISOString()),
            appointment.status,
          ])}
        />
      </section>

      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="全员班次明细" action={`${sortedShifts.length} 条班次`} />
        <DataTable
          columns={["员工", "开始", "结束", "备注"]}
          rows={sortedShifts.slice(0, 120).map((shift) => [
            nameOf(data.staff, shift.staffId),
            shortDate(shift.startAt),
            shortDate(shift.endAt),
            shift.note || "-",
          ])}
        />
      </section>

      <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title="全员不可预约时间" action={`${sortedBlocks.length} 条`} />
        <DataTable
          columns={["员工", "开始", "结束", "原因"]}
          rows={sortedBlocks.slice(0, 120).map((slot) => [
            nameOf(data.staff, slot.staffId),
            shortDate(slot.startAt),
            shortDate(slot.endAt),
            <span key={slot.id}><Badge text="不可预约" tone="warn" /> {slot.reason}</span>,
          ])}
        />
      </section>
    </div>
  );
}
