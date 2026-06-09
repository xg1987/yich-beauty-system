import { CalendarDays, CreditCard, LockKeyhole } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { ApiActions } from "../../hooks/useApiData";
import type { AppData, CashPayMethod, Staff } from "../../domain/types";
import { money, shortDate, toLocalInputValue, tomorrowAt } from "../../domain/utils";
import { Badge } from "../ui/Badge";
import { DataTable } from "../ui/DataTable";
import { DateTimeInput } from "../ui/DateTimeInput";
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
  const [refundAmount, setRefundAmount] = useState(() => String(refundableCards[0]?.balance ?? 0));
  const [payMethod, setPayMethod] = useState<CashPayMethod>("微信");
  const [reason, setReason] = useState("客户退卡退费");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();
  const refundValue = Number(refundAmount);
  const invalidRefundAmount = !Number.isFinite(refundValue) || refundValue < 0 || Boolean(selectedCard && selectedCard.balance > 0 && refundValue > selectedCard.balance);
  const cardOptions = refundableCards.length
    ? refundableCards.map((card) => ({
      value: card.id,
      label: `${nameOf(data.customers, card.customerId)} · ${card.name} · 余额 ${money(card.balance)} · ${card.remainingTimes} 次`,
    }))
    : [{ value: "", label: "暂无可退会员卡", disabled: true }];

  const selectCard = (nextCardId: string) => {
    setCardId(nextCardId);
    const nextCard = data.memberCards.find((card) => card.id === nextCardId);
    setRefundAmount(String(nextCard?.balance ?? 0));
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
      setMessage({ type: "error", text: "请填写正确的实退金额，储值卡不能大于当前余额。" });
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
            </div>
          )}
          <label>实退金额<input type="number" min={0} step={1} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></label>
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

export function StaffScheduleManagement({ data, actions, runMutation }: ManagementOperationProps) {
  const staffOptions = activeBusinessStaff(data).map((staff) => ({ value: staff.id, label: `${staff.name} · ${staff.role}` }));
  const fallbackStaffId = staffOptions[0]?.value ?? "";
  const [shiftStaffId, setShiftStaffId] = useState(fallbackStaffId);
  const [shiftStartAt, setShiftStartAt] = useState(toLocalInputValue(tomorrowAt(10)));
  const [shiftEndAt, setShiftEndAt] = useState(toLocalInputValue(tomorrowAt(18)));
  const [shiftNote, setShiftNote] = useState("正常上班");
  const [blockedStaffId, setBlockedStaffId] = useState(fallbackStaffId);
  const [blockedStartAt, setBlockedStartAt] = useState(toLocalInputValue(tomorrowAt(14)));
  const [blockedEndAt, setBlockedEndAt] = useState(toLocalInputValue(tomorrowAt(15)));
  const [blockedReason, setBlockedReason] = useState("请假/培训");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();

  const sortedShifts = useMemo(() =>
    data.staffShifts.slice().sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
  [data.staffShifts]);
  const sortedBlocks = useMemo(() =>
    data.staffUnavailableSlots.slice().sort((left, right) => +new Date(left.startAt) - +new Date(right.startAt)),
  [data.staffUnavailableSlots]);

  const addShift = (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    void runMutation(() =>
      actions.addStaffShift({
        staffId: shiftStaffId,
        startAt: new Date(shiftStartAt).toISOString(),
        endAt: new Date(shiftEndAt).toISOString(),
        note: shiftNote.trim() || "正常上班",
      }),
    ).then(() => {
      setMessage({ type: "success", text: "员工班次已保存，预约会按班次判断可预约时间。" });
    }).catch((caught) => {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "班次保存失败" });
    });
  };

  const addBlockedSlot = (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    void runMutation(() =>
      actions.addStaffUnavailableSlot({
        staffId: blockedStaffId,
        startAt: new Date(blockedStartAt).toISOString(),
        endAt: new Date(blockedEndAt).toISOString(),
        reason: blockedReason.trim() || "不可预约",
      }),
    ).then(() => {
      setMessage({ type: "success", text: "不可预约时间已锁定，预约时会自动避开。" });
    }).catch((caught) => {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "锁定时间失败" });
    });
  };

  return (
    <div className="module-detail-stack">
      {message && <p className={message.type === "success" ? "form-success" : "form-error"}>{message.text}</p>}
      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="新增员工班次" action="上班时间" />
        <form className="form" onSubmit={addShift}>
          <Select label="员工" value={shiftStaffId} onChange={setShiftStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先新增员工", disabled: true }]} />
          <DateTimeInput label="上班开始" value={shiftStartAt} onChange={setShiftStartAt} />
          <DateTimeInput label="上班结束" value={shiftEndAt} onChange={setShiftEndAt} />
          <label>备注<input value={shiftNote} onChange={(event) => setShiftNote(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={!shiftStaffId}>保存班次</button>
        </form>
      </section>

      <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title="锁定不可预约时间" action="请假 / 培训 / 休息" />
        <form className="form" onSubmit={addBlockedSlot}>
          <Select label="员工" value={blockedStaffId} onChange={setBlockedStaffId} options={staffOptions.length ? staffOptions : [{ value: "", label: "请先新增员工", disabled: true }]} />
          <DateTimeInput label="开始时间" value={blockedStartAt} onChange={setBlockedStartAt} />
          <DateTimeInput label="结束时间" value={blockedEndAt} onChange={setBlockedEndAt} />
          <label>原因<input value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={!blockedStaffId}>锁定时间</button>
        </form>
      </section>

      <section className="panel">
        <PanelTitle icon={<CalendarDays size={18} />} title="排班表" action={`${sortedShifts.length} 条班次`} />
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
        <PanelTitle icon={<LockKeyhole size={18} />} title="不可预约时间" action={`${sortedBlocks.length} 条`} />
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
