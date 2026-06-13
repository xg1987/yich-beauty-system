import { type FormEvent, useState } from "react";
import { ClipboardList, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { ModuleOverview, type FeatureModule } from "../components/layout/ModuleOverview";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import type { AppData } from "../domain/types";
import { money, shortDate } from "../domain/utils";
import type { ApiActions } from "../hooks/useApiData";
import { nameOf } from "./AuthenticatedApp";
import { SubmitStatusButton, useMutationPending } from "./mutationPending";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

export function ApprovalsView({
  data,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const mutationPending = useMutationPending();
  const [type, setType] = useState<"改价折扣" | "订单退款">("改价折扣");
  const [targetId, setTargetId] = useState("manual");
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("门店例外处理");
  const [activeModule, setActiveModule] = useState<"submit" | "pending" | "refund" | "passed" | "rejected" | "all" | undefined>(fromManagement ? "pending" : undefined);

  const createApproval = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.createApproval({ type, targetId, amount, reason }));
  };

  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const passedApprovals = data.approvalRequests.filter((item) => item.status === "已通过").length;
  const rejectedApprovals = data.approvalRequests.filter((item) => item.status === "已拒绝").length;
  const approvalRows = data.approvalRequests.filter((approval) => {
    if (activeModule === "pending") return approval.status === "待审批";
    if (activeModule === "refund") return approval.type === "订单退款";
    if (activeModule === "passed") return approval.status === "已通过";
    if (activeModule === "rejected") return approval.status === "已拒绝";
    return true;
  });
  const refundApprovals = data.approvalRequests.filter((item) => item.type === "订单退款").length;
  type ApprovalModuleKey = NonNullable<typeof activeModule>;
  const approvalModules: Array<FeatureModule<ApprovalModuleKey>> = [
    { key: "submit", title: "提交审批", desc: "改价、退款和门店例外处理", icon: ShieldCheck, tone: "violet", meta: "申请入口" },
    { key: "pending", title: "待审批", desc: "需要处理的风险单据", icon: ClipboardList, tone: "rose", meta: `${pendingApprovals} 单` },
    { key: "refund", title: "退款审批", desc: "订单退款申请和处理记录", icon: RefreshCw, tone: "jade", meta: `${refundApprovals} 单` },
    { key: "passed", title: "已通过", desc: "已批准可用于业务", icon: ShieldCheck, tone: "teal", meta: `${passedApprovals} 单` },
    { key: "rejected", title: "已拒绝", desc: "已拦截的异常申请", icon: LockKeyhole, tone: "amber", meta: `${rejectedApprovals} 单` },
    { key: "all", title: "全部记录", desc: "查看完整审批流水", icon: ClipboardList, tone: "plum", meta: `${data.approvalRequests.length} 条` },
  ];
  const activeModuleTitle = activeModule ? approvalModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub approvals-module-page">
      <PageHero
        icon={<ShieldCheck size={15} />}
        eyebrow="审批中心"
        title="审批中心"
        stats={[
          { label: "待审批", value: `${pendingApprovals} 单`, hint: "需要处理", icon: <ShieldCheck size={18} /> },
          { label: "已通过", value: `${passedApprovals} 单`, hint: "可用于业务", icon: <ClipboardList size={18} /> },
          { label: "已拒绝", value: `${rejectedApprovals} 单`, hint: "风险拦截", icon: <LockKeyhole size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={approvalModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "审批中心"}
        subtitle="改价退款、待审事项和审批记录"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack approvals-modal-detail">
        {activeModule === "submit" && (
        <section className="panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="提交审批" action="改价/退款" />
        <form className="form" onSubmit={createApproval}>
          <Select label="审批类型" value={type} onChange={(value) => setType(value as "改价折扣" | "订单退款")} options={["改价折扣", "订单退款"].map((item) => ({ value: item, label: item }))} />
          <label>关联对象<input value={targetId} onChange={(event) => setTargetId(event.target.value)} /></label>
          <label>金额<input type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
          <label>原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <SubmitStatusButton idleText="提交审批" busyText="提交中..." />
        </form>
        </section>
        )}
        {(activeModule === "pending" || activeModule === "refund" || activeModule === "passed" || activeModule === "rejected" || activeModule === "all") && (
        <section className="panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="审批列表" action={`${approvalRows.length} 条`} />
        <DataTable
          columns={["类型", "对象", "金额", "原因", "申请人", "状态", "时间", "操作"]}
          rows={approvalRows.map((approval) => [
            approval.type,
            approval.targetId,
            money(approval.amount),
            approval.reason,
            nameOf(data.staff, data.staff.find((staff) => staff.id === approval.requestedBy)?.id ?? "") || approval.requestedBy,
            <Badge key={`${approval.id}-status`} text={approval.status} tone={approval.status === "已拒绝" ? "warn" : approval.status === "已通过" ? "ok" : undefined} />,
            shortDate(approval.createdAt),
            approval.status === "待审批" ? (
              <div key={`${approval.id}-actions`} className="row-actions">
                <button disabled={mutationPending} onClick={() => void runMutation(() => actions.decideApproval(approval.id, true))}>{mutationPending ? "处理中..." : "通过"}</button>
                <button disabled={mutationPending} onClick={() => void runMutation(() => actions.decideApproval(approval.id, false))}>{mutationPending ? "处理中..." : "拒绝"}</button>
              </div>
            ) : (
              approval.approvedAt ? shortDate(approval.approvedAt) : "已处理"
            ),
          ])}
        />
        </section>
        )}
      </div>
      </Modal>
    </div>
  );
}
