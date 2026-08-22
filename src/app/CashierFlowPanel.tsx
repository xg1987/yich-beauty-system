import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { PanelTitle } from "../components/layout/PanelTitle";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import type { CashierFlowListItem } from "../domain/cashierFlow";
import type { CustomerSignature } from "../domain/types";
import { money, shortDate } from "../domain/utils";

type CashierFlowPanelProps = {
  records: CashierFlowListItem[];
  totalCount: number;
  page: number;
  pageCount: number;
  pageStart: number;
  pageSize: number;
  loading?: boolean;
  error?: string;
  selectedRecord?: CashierFlowListItem;
  detailLoading?: boolean;
  detailError?: string;
  selectedCustomerText: string;
  selectedAppointmentText: string;
  selectedMemberCardName: string;
  selectedSignature?: CustomerSignature;
  selectedSignatureImage?: string;
  selectedSignatureImageLoading: boolean;
  selectedSignatureExpired: boolean;
  mutationPending: boolean;
  refundOriginalPaidAmount: number;
  onPageChange: (page: number) => void;
  onRetry?: () => void;
  onSelectRecord: (record: CashierFlowListItem) => void;
  onClearSelection: () => void;
  onRetryDetail?: () => void;
  onOpenSignature: () => void;
  onRegenerateSignature: () => Promise<void>;
  onRefundOrder: (reason: string) => Promise<void>;
};

function cashierPaymentText(record: CashierFlowListItem) {
  if (record.kind === "order" && record.payMethod === "会员卡") return "会员卡扣款";
  return record.payMethod;
}

function OrderRefundAction({
  record,
  mutationPending,
  originalPaidAmount,
  onRefund,
}: {
  record: Extract<CashierFlowListItem, { kind: "order" }>;
  mutationPending: boolean;
  originalPaidAmount: number;
  onRefund: (reason: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string }>();

  if (record.status === "已退款") {
    return <p className="cashier-refund-note">该单已全额退款；原收银流水继续保留，供财务核对。</p>;
  }

  const partiallyRefunded = record.status === "部分退款";
  const busy = mutationPending || submitting;
  const reasonReady = reason.trim().length > 0;
  const submitRefund = async () => {
    if (!reasonReady || busy) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      await onRefund(reason.trim());
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "全额退款失败" });
      setSubmitting(false);
    }
  };

  return (
    <div className="cashier-refund-action">
      {!confirming ? (
        <button type="button" className="cashier-refund-trigger" disabled={busy} onClick={() => setConfirming(true)}>
          {partiallyRefunded ? "退完剩余金额" : "撤销误单（全额退款）"}
        </button>
      ) : (
        <div className="cashier-refund-confirm" role="group" aria-label="确认撤销误单">
          <strong>确认退款 {money(record.paidAmount)}</strong>
          <p>原单实收 {money(originalPaidAmount)}。退款成功后不会删除原流水；累计全额退完后，库存、会员卡、积分及财务记录按系统规则回滚。</p>
          <label>
            撤销原因（必填）
            <textarea
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：前台重复开单、项目录入错误"
            />
          </label>
          {message && <p className={message.type === "success" ? "form-success" : "form-error"} role="status">{message.text}</p>}
          <div className="row-actions">
            <button type="button" disabled={!reasonReady || busy} onClick={() => void submitRefund()}>
              {submitting ? "退款处理中..." : `确认全额退款 ${money(record.paidAmount)}`}
            </button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); setMessage(undefined); }}>返回</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CashierFlowPanel({
  records,
  totalCount,
  page,
  pageCount,
  pageStart,
  pageSize,
  loading = false,
  error,
  selectedRecord,
  detailLoading = false,
  detailError,
  selectedCustomerText,
  selectedAppointmentText,
  selectedMemberCardName,
  selectedSignature,
  selectedSignatureImage,
  selectedSignatureImageLoading,
  selectedSignatureExpired,
  mutationPending,
  refundOriginalPaidAmount,
  onPageChange,
  onRetry,
  onSelectRecord,
  onClearSelection,
  onRetryDetail,
  onOpenSignature,
  onRegenerateSignature,
  onRefundOrder,
}: CashierFlowPanelProps) {
  const pageEnd = Math.min(pageStart + records.length, totalCount);
  const pageStatusText = loading
    ? records.length > 0 ? "新页面加载中，当前流水仍可查看..." : "收银流水加载中..."
    : undefined;

  return (
    <section className="panel" aria-busy={loading || detailLoading}>
      <PanelTitle icon={<ClipboardList size={18} />} title="收银流水" action={loading && totalCount === 0 ? "加载中" : `${totalCount} 笔`} />
      {(records.length > 0 || (!loading && !error)) && (
        <DataTable
          columns={["客户", "来源", "内容", "服务人员", "支付/扣款", "金额", "状态", "时间", "操作"]}
          rows={records.map((record) => [
            record.customerName,
            record.source,
            record.itemName,
            record.staffName,
            cashierPaymentText(record),
            money(record.paidAmount),
            <Badge key={`${record.kind}:${record.id}-status`} text={record.status} tone={record.kind === "order" && record.status !== "已支付" ? "warn" : "ok"} />,
            shortDate(record.createdAt),
            <button key={`${record.kind}:${record.id}-detail`} type="button" onClick={() => onSelectRecord(record)}>
              查看详情
            </button>,
          ])}
        />
      )}
      {pageStatusText && <p className="form-note" role="status">{pageStatusText}</p>}
      {error && (
        <div className="row-actions" role="alert">
          <span className="form-error">{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>重试加载</button>}
        </div>
      )}
      {pageCount > 1 && (
        <nav className="cashier-flow-pagination" aria-label="收银流水分页">
          <span>第 {pageStart + 1}–{pageEnd} 笔，共 {totalCount} 笔</span>
          <div>
            <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
            <em>第 {page} / {pageCount} 页</em>
            <button type="button" disabled={loading || page >= pageCount} onClick={() => onPageChange(page + 1)}>下一页</button>
          </div>
        </nav>
      )}
      {selectedRecord && (
        <div className="cashier-record-detail">
          <div className="cashier-record-detail-head">
            <strong>流水详情</strong>
            <button type="button" onClick={onClearSelection}>收起</button>
          </div>
          <dl>
            <div><dt>客户</dt><dd>{selectedCustomerText}</dd></div>
            <div><dt>来源</dt><dd>{selectedRecord.source}</dd></div>
            <div><dt>内容</dt><dd>{selectedRecord.itemName}</dd></div>
            <div><dt>服务人员</dt><dd>{selectedRecord.staffName}</dd></div>
            <div><dt>支付/扣款</dt><dd>{cashierPaymentText(selectedRecord)}</dd></div>
            <div><dt>金额</dt><dd>{money(selectedRecord.paidAmount)}</dd></div>
            <div><dt>状态</dt><dd>{selectedRecord.status}</dd></div>
            <div><dt>时间</dt><dd>{shortDate(selectedRecord.createdAt)}</dd></div>
            <div><dt>流水编号</dt><dd>{selectedRecord.orderNo}</dd></div>
            <div><dt>关联预约</dt><dd>{detailLoading ? "加载中..." : selectedAppointmentText}</dd></div>
            <div><dt>会员卡</dt><dd>{detailLoading ? "加载中..." : selectedMemberCardName}</dd></div>
            <div>
              <dt>客户签名</dt>
              <dd>
                {detailLoading ? "加载中..." : selectedSignature ? (
                  <span className="cashier-record-signature-status">
                    <Badge text={selectedSignatureExpired ? "已过期" : selectedSignature.status} tone={selectedSignature.status === "已签名" ? "ok" : "warn"} />
                    {selectedSignature.status === "待签名" && !selectedSignatureExpired && <button type="button" onClick={onOpenSignature}>让客户签名</button>}
                    {selectedSignature.status === "已签名" && <button type="button" onClick={onOpenSignature}>查看签名</button>}
                    {selectedSignature.status === "待签名" && selectedSignatureExpired && (
                      <button type="button" disabled={mutationPending} onClick={() => void onRegenerateSignature().catch(() => undefined)}>
                        {mutationPending ? "生成中..." : "重新生成签名"}
                      </button>
                    )}
                  </span>
                ) : "-"}
              </dd>
            </div>
          </dl>
          {detailLoading && <p className="form-note" role="status">流水详情加载中...</p>}
          {detailError && (
            <div className="row-actions" role="alert">
              <span className="form-error">{detailError}</span>
              {onRetryDetail && <button type="button" onClick={onRetryDetail}>重试详情</button>}
            </div>
          )}
          {(selectedSignatureImage || (selectedSignature?.status === "已签名" && selectedSignatureImageLoading)) && (
            <div className="cashier-record-signature">
              <strong>客户签名</strong>
              {selectedSignatureImage ? <img src={selectedSignatureImage} alt="客户签名" /> : <p>签名图片加载中...</p>}
            </div>
          )}
          {selectedRecord.kind === "order" && !detailLoading && !detailError && (
            <OrderRefundAction
              key={`${selectedRecord.id}:${selectedRecord.status}`}
              record={selectedRecord}
              mutationPending={mutationPending}
              originalPaidAmount={refundOriginalPaidAmount}
              onRefund={onRefundOrder}
            />
          )}
        </div>
      )}
    </section>
  );
}
