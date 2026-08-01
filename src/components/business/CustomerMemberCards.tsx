import type { FormEvent } from "react";
import { Badge } from "../ui/Badge";
import { Modal } from "../ui/Modal";
import type { MemberCardVoidEligibility } from "../../domain/business";
import { memberCardCashIn, memberCardVoidEligibility } from "../../domain/business";
import type { AppData } from "../../domain/types";
import { money, shortDate } from "../../domain/utils";
import { SubmitStatusButton } from "../../app/mutationPending";
import {
  memberCardAvailableTimesText,
  memberCardProjectScopeText,
  type MemberCardServiceAvailability,
} from "../../app/authenticatedAppHelpers";

type FormMessage = { type: "success" | "error"; text: string } | undefined;

export function CustomerAssetSummary({
  availability,
  activeProjectCardCount,
  remainingTimes,
  storedValueBalance,
  latestOrder,
  nextFollowUp,
}: {
  availability: MemberCardServiceAvailability[];
  activeProjectCardCount: number;
  remainingTimes: number;
  storedValueBalance: number;
  latestOrder?: AppData["orders"][number];
  nextFollowUp?: AppData["customerFollowUps"][number];
}) {
  return (
    <div className="customer-asset-grid">
      <div>
        <span>项目次数明细</span>
        {availability.length ? (
          <div className="customer-project-summary-list">
            {availability.map((row) => (
              <strong key={row.serviceId || "general"}>
                <b>{row.serviceName}</b>
                <em>总剩 {row.remainingTimes} 次 · {row.cardCount} 张卡</em>
              </strong>
            ))}
          </div>
        ) : <strong>暂无可用项目次数</strong>}
        <small>{activeProjectCardCount} 张有效项目卡 · 总剩 {remainingTimes} 次 · 已合并全部卡片</small>
      </div>
      <div>
        <span>储值余额</span>
        <strong>{money(storedValueBalance)}</strong>
        <small>可用于卡扣/储值消费</small>
      </div>
      <div>
        <span>最近消费</span>
        <strong>{latestOrder ? money(latestOrder.paidAmount) : "-"}</strong>
        <small>{latestOrder ? shortDate(latestOrder.createdAt) : "暂无订单"}</small>
      </div>
      <div>
        <span>下次跟进</span>
        <strong>{nextFollowUp ? shortDate(nextFollowUp.dueAt) : "-"}</strong>
        <small>{nextFollowUp ? nextFollowUp.note : "暂无待跟进"}</small>
      </div>
    </div>
  );
}

export function CustomerProjectCardList({
  cards,
  services,
  transactions,
  canVoid,
  mutationPending,
  message,
  voidCardId,
  onVoid,
}: {
  cards: AppData["memberCards"];
  services: AppData["services"];
  transactions: AppData["memberCardTransactions"];
  canVoid: boolean;
  mutationPending: boolean;
  message: FormMessage;
  voidCardId: string;
  onVoid: (cardId: string) => void;
}) {
  const cardIds = new Set(cards.map((card) => card.id));
  const openingTransactionByCardId = new Map(
    transactions
      .filter((transaction) => transaction.type === "开卡" && cardIds.has(transaction.memberCardId))
      .map((transaction) => [transaction.memberCardId, transaction]),
  );

  return (
    <div className="customer-table-panel">
      {message && !voidCardId && <p className={message.type === "success" ? "form-success" : "form-error"}>{message.text}</p>}
      <div className="customer-project-card-list">
        {cards.map((card) => {
          const openingTransaction = openingTransactionByCardId.get(card.id);
          const eligibility = memberCardVoidEligibility(card, transactions);
          return (
            <article className={`customer-project-card-row ${card.status === "正常" ? "active" : "closed"}`} key={card.id}>
              <div className="customer-project-card-heading">
                <div>
                  <strong>{card.name}</strong>
                  <span>{card.type} · {memberCardProjectScopeText(card, services)}</span>
                </div>
                <Badge text={card.status} tone={card.status === "正常" ? "ok" : "warn"} />
              </div>
              <div className="customer-project-card-facts">
                <span><small>当前余额</small><b>{money(card.balance)}</b></span>
                <span><small>可用次数</small><b>{memberCardAvailableTimesText(card, services)}</b></span>
                <span><small>开卡实收</small><b>{openingTransaction ? money(memberCardCashIn(openingTransaction)) : "历史数据"}</b></span>
                <span><small>开卡时间</small><b>{openingTransaction ? shortDate(openingTransaction.createdAt) : "未记录"}</b></span>
                <span><small>有效期至</small><b>{shortDate(card.expiresAt)}</b></span>
              </div>
              {canVoid && card.status !== "已退卡" && card.status !== "已作废" && (
                <div className="customer-project-card-actions">
                  <small>{eligibility.reason}</small>
                  <button type="button" className="danger-button subtle" disabled={!eligibility.eligible || mutationPending} title={eligibility.reason} onClick={() => onVoid(card.id)}>
                    错录作废
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {cards.length > 0 && <p className="customer-card-operation-note">错录且从未使用的卡可由老板或店长作废；发生过消费、充值、调整或转卡的卡，请到“管理中心 → 客户退费”走正式退卡流程。</p>}
      {cards.length === 0 && <p className="customer-soft-empty">当前客户暂无项目卡</p>}
    </div>
  );
}

export function CustomerMemberOverview({
  cards,
  services,
  serviceRecords,
  staff,
  customerNote,
  nextCareAdvice,
  nextFollowUpNote,
  onShowRecords,
}: {
  cards: AppData["memberCards"];
  services: AppData["services"];
  serviceRecords: AppData["customerServiceRecords"];
  staff: AppData["staff"];
  customerNote?: string;
  nextCareAdvice?: string;
  nextFollowUpNote?: string;
  onShowRecords: () => void;
}) {
  const nameOf = (collection: Array<{ id: string; name: string }>, id: string) => collection.find((item) => item.id === id)?.name ?? "-";
  return (
    <div className="customer-overview-grid">
      <section className="customer-info-card">
        <div className="customer-section-title"><strong>项目卡</strong></div>
        <div className="customer-card-stack">
          {cards.slice(0, 3).map((card) => (
            <article key={card.id}>
              <div><strong>{card.name}</strong><span>{card.type} · {memberCardProjectScopeText(card, services)}</span></div>
              <em>{memberCardAvailableTimesText(card, services)}</em>
            </article>
          ))}
          {cards.length === 0 && <p className="customer-soft-empty">暂无项目卡</p>}
        </div>
      </section>
      <section className="customer-info-card">
        <div className="customer-section-title"><strong>最近服务</strong><button type="button" onClick={onShowRecords}>查看</button></div>
        <div className="customer-timeline">
          {serviceRecords.slice(0, 3).map((record) => (
            <article key={record.id}>
              <time>{shortDate(record.createdAt)}</time>
              <div><strong>{nameOf(services, record.serviceId)}</strong><span>{nameOf(staff, record.staffId)} · {record.customerFeedback || record.nextCareAdvice || "已完成服务"}</span></div>
            </article>
          ))}
          {serviceRecords.length === 0 && <p className="customer-soft-empty">暂无服务记录</p>}
        </div>
      </section>
      <section className="customer-info-card customer-advice-card">
        <div className="customer-section-title"><strong>{customerNote ? "客户备注" : "下次建议"}</strong></div>
        <p>{customerNote || nextCareAdvice || nextFollowUpNote || "暂无护理建议。"}</p>
      </section>
    </div>
  );
}

export function VoidMemberCardModal({
  card,
  customer,
  services,
  eligibility,
  reason,
  confirmed,
  mutationPending,
  message,
  onReasonChange,
  onConfirmedChange,
  onClose,
  onSubmit,
}: {
  card?: AppData["memberCards"][number];
  customer?: AppData["customers"][number];
  services: AppData["services"];
  eligibility?: MemberCardVoidEligibility;
  reason: string;
  confirmed: boolean;
  mutationPending: boolean;
  message: FormMessage;
  onReasonChange: (value: string) => void;
  onConfirmedChange: (value: boolean) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const openingTransaction = eligibility?.openingTransaction;
  return (
    <Modal open={Boolean(card)} title="作废错录开卡" subtitle="仅处理从未使用的重复或错误开卡" size="medium" onClose={onClose}>
      {card && (
        <form className="form customer-card-void-form" onSubmit={onSubmit}>
          <div className="customer-card-void-warning">
            <strong>这不是消费结账，也不会删除历史流水</strong>
            <span>系统将关闭这张卡，冲销原开卡收入、全部剩余权益和该卡赠送的积分，并保留完整审计记录。</span>
          </div>
          <div className="customer-card-void-target">
            <span><small>客户</small><b>{customer?.name ?? "-"} · {customer?.phone ?? "-"}</b></span>
            <span><small>目标卡</small><b>{card.name} · {card.type}</b></span>
            <span><small>项目权益</small><b>{memberCardAvailableTimesText(card, services)}</b></span>
            <span><small>开卡时间</small><b>{openingTransaction ? shortDate(openingTransaction.createdAt) : "未记录"}</b></span>
            <span><small>原开卡实收</small><b>{openingTransaction ? money(memberCardCashIn(openingTransaction)) : "无法确认"}</b></span>
            <span><small>处理校验</small><b>{eligibility?.reason ?? "正在核查"}</b></span>
          </div>
          <label>错录原因<textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="例如：同一项目重复开卡，客户只购买一次" minLength={4} required /></label>
          <label className="customer-card-void-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmedChange(event.target.checked)} />
            <span>我已核对客户、卡名、开卡时间和实收金额，确认这是错录开卡。</span>
          </label>
          {message && <p className={message.type === "success" ? "form-success" : "form-error"}>{message.text}</p>}
          <div className="form-submit-row">
            <button type="button" onClick={onClose} disabled={mutationPending}>取消</button>
            <SubmitStatusButton idleText="确认作废并冲销" busyText="正在作废..." disabled={!eligibility?.eligible || reason.trim().length < 4 || !confirmed} />
          </div>
        </form>
      )}
    </Modal>
  );
}
