import { type FormEvent, useEffect, useState } from "react";
import { BadgeCent, ClipboardList, HeartHandshake, LockKeyhole, UsersRound } from "lucide-react";
import { ModuleOverview, type FeatureModule } from "../components/layout/ModuleOverview";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { hasPermission, type UserSession } from "../domain/auth";
import type { AppData, Staff, UserRole } from "../domain/types";
import { money, shortDate } from "../domain/utils";
import type { ApiActions } from "../hooks/useApiData";
import { SubmitStatusButton, useMutationPending } from "./mutationPending";
import {
  businessStaffOf,
  copyTextToClipboard,
  displayRoleName,
  displayStaffRole,
  displayUserRole,
  nameOf,
  optionOf,
} from "./AuthenticatedApp";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

export function StaffCommissions({
  data,
  session,
  actions,
  runMutation,
  fromManagement = false,
  onReturnManagement,
}: {
  data: AppData;
  session: UserSession;
  actions: ApiActions;
  runMutation: RunMutation;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
}) {
  const mutationPending = useMutationPending();
  const canManageStaff = hasPermission(session, "staff:manage");
  const staffRows = businessStaffOf(data);
  const staffIds = new Set(staffRows.map((staff) => staff.id));
  const staffRoleOptions = ["店长", "员工", "前台"].map((item) => ({ value: item, label: item }));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("员工");
  const [baseSalary, setBaseSalary] = useState(6500);
  const [commissionRate, setCommissionRate] = useState(0.12);
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [editingRole, setEditingRole] = useState("员工");
  const [editingBaseSalary, setEditingBaseSalary] = useState(0);
  const [editingCommissionRate, setEditingCommissionRate] = useState(0);
  const [editingStatus, setEditingStatus] = useState<Staff["status"]>("active");
  const [inviteStaffId, setInviteStaffId] = useState(staffRows[0]?.id ?? "");
  const [inviteAccount, setInviteAccount] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("therapist");
  const [inviteValidDays, setInviteValidDays] = useState(7);
  const [lastInviteCode, setLastInviteCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [activeModule, setActiveModule] = useState<"profile" | "invite" | "salary" | "settlements" | "commissions" | undefined>(fromManagement ? "profile" : undefined);
  const editingStaff = staffRows.find((staff) => staff.id === editingStaffId);

  const settleAll = () => {
    void runMutation(actions.settleCommissions);
  };

  const addStaff = (event: FormEvent) => {
    event.preventDefault();
    void runMutation(() => actions.addStaff({ name, phone, role, baseSalary, commissionRate }));
    setName("");
    setPhone("");
  };

  const startEditStaff = (staff: Staff) => {
    setEditingStaffId(staff.id);
    setEditingName(staff.name);
    setEditingPhone(staff.phone);
    setEditingRole(staff.role);
    setEditingBaseSalary(staff.baseSalary ?? 0);
    setEditingCommissionRate(staff.commissionRate ?? 0);
    setEditingStatus(staff.status);
  };

  const cancelEditStaff = () => {
    setEditingStaffId("");
    setEditingName("");
    setEditingPhone("");
    setEditingRole("员工");
    setEditingBaseSalary(0);
    setEditingCommissionRate(0);
    setEditingStatus("active");
  };

  const saveStaffEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingStaffId) return;
    void runMutation(() =>
      actions.updateStaff(editingStaffId, {
        name: editingName,
        phone: editingPhone,
        role: editingRole,
        baseSalary: editingBaseSalary,
        commissionRate: editingCommissionRate,
        status: editingStatus,
      }),
    ).then(cancelEditStaff);
  };

  const createInvite = (event: FormEvent) => {
    event.preventDefault();
    const account = inviteAccount;
    void runMutation(() => actions.createStaffInvite({ staffId: inviteStaffId, account, role: inviteRole, validDays: inviteValidDays }))
      .then((nextData) => {
        const nextInvite = nextData.staffInvites.find((invite) => invite.staffId === inviteStaffId && invite.account === account && invite.status === "待加入");
        setLastInviteCode(nextInvite?.inviteCode ?? "");
        setInviteAccount("");
      });
  };

  const copyLastInviteCode = () => {
    if (!lastInviteCode) return;
    void copyTextToClipboard(lastInviteCode).then((copied) => {
      if (!copied) return;
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1400);
    });
  };

  const activeStaff = staffRows.filter((staff) => staff.status === "active").length;
  const pendingInvites = data.staffInvites.filter((invite) => invite.status === "待加入").length;
  const pendingCommission = data.commissions.filter((item) => staffIds.has(item.staffId) && item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
  const inviteStaffOptions = staffRows
    .filter((staff) => !staff.accountId && !data.authUsers.some((user) => user.staffId === staff.id))
    .map(optionOf);

  useEffect(() => {
    if (!inviteStaffOptions.some((option) => option.value === inviteStaffId)) {
      setInviteStaffId(inviteStaffOptions[0]?.value ?? "");
    }
  }, [inviteStaffId, inviteStaffOptions]);
  const salaryRows = staffRows.map((staff) => {
    const staffCommissions = data.commissions.filter((item) => item.staffId === staff.id && item.status !== "已冲销");
    const pending = staffCommissions.filter((item) => item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);
    const settled = staffCommissions.filter((item) => item.status === "已结算").reduce((sum, item) => sum + item.amount, 0);
    const serviceCommission = staffCommissions.filter((item) => item.type === "服务提成").reduce((sum, item) => sum + item.amount, 0);
    const salesCommission = staffCommissions.filter((item) => item.type === "销售提成").reduce((sum, item) => sum + item.amount, 0);
    return {
      staff,
      pending,
      settled,
      serviceCommission,
      salesCommission,
      expected: (staff.baseSalary ?? 0) + pending + settled,
    };
  });
  type StaffModuleKey = NonNullable<typeof activeModule>;
  const staffModules: Array<FeatureModule<StaffModuleKey>> = [
    { key: "profile", title: "员工档案", desc: "建档、岗位、底薪和状态", icon: UsersRound, tone: "violet", meta: `${staffRows.length} 人` },
    { key: "invite", title: "员工邀请码", desc: "创建一次性邀请，员工自行加入", icon: LockKeyhole, tone: "rose", meta: `${pendingInvites} 个待加入` },
    { key: "salary", title: "薪资汇总", desc: "底薪、项目提成和预计薪资", icon: HeartHandshake, tone: "teal", meta: money(pendingCommission) },
    { key: "settlements", title: "结算流水", desc: "批量结算记录和操作人", icon: ClipboardList, tone: "amber", meta: `${data.commissionSettlements.length} 批` },
    { key: "commissions", title: "提成记录", desc: "订单提成、比例和状态", icon: BadgeCent, tone: "violet", meta: `${data.commissions.filter((item) => staffIds.has(item.staffId)).length} 条` },
  ];
  const activeModuleTitle = activeModule ? staffModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub staff-module-page">
      <PageHero
        icon={<BadgeCent size={15} />}
        eyebrow="人员账号"
        title="人员账号"
        stats={[
          { label: "在职员工", value: `${activeStaff} 人`, hint: `${staffRows.length} 人档案`, icon: <UsersRound size={18} /> },
          { label: "待加入员工", value: `${pendingInvites} 个`, hint: "邀请未完成", icon: <LockKeyhole size={18} /> },
          { label: "待结提成", value: money(pendingCommission), hint: "财务待处理", icon: <BadgeCent size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={staffModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "人员账号"}
        subtitle="员工档案、提成结算和账号信息"
        size="large"
        onClose={closeModule}
      >
      <div className="module-detail-stack staff-modal-detail">
        {(activeModule === "profile" || activeModule === "invite") && (
        <section className="panel">
        <PanelTitle
          icon={activeModule === "invite" ? <LockKeyhole size={18} /> : <BadgeCent size={18} />}
          title={activeModule === "invite" ? "邀请员工" : "员工档案"}
          action={activeModule === "invite" ? "一次性员工邀请" : canManageStaff ? "先建档，再邀请加入" : "个人视图"}
        />
        {canManageStaff && activeModule === "profile" ? (
          <>
            <form className="form" onSubmit={addStaff}>
              <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
              <label>手机号<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
              <Select label="岗位" value={role} onChange={setRole} options={staffRoleOptions} />
              <label>底薪<input type="number" value={baseSalary} onChange={(event) => setBaseSalary(Number(event.target.value))} /></label>
              <label>提成比例<input type="number" step="0.01" value={commissionRate} onChange={(event) => setCommissionRate(Number(event.target.value))} /></label>
              <SubmitStatusButton idleText="保存员工档案" busyText="保存中..." />
            </form>
          </>
        ) : canManageStaff && activeModule === "invite" ? (
          <>
            <form className="form" onSubmit={createInvite}>
              <Select label="员工" value={inviteStaffId} onChange={setInviteStaffId} options={inviteStaffOptions} />
              <label>员工手机号/账号<input value={inviteAccount} onChange={(event) => setInviteAccount(event.target.value)} placeholder="员工加入门店后用于登录" /></label>
              <Select
                label="账号角色"
                value={inviteRole}
                onChange={(value) => setInviteRole(value as UserRole)}
                options={[
                  { value: "manager", label: "店长" },
                  { value: "frontdesk", label: "前台" },
                  { value: "therapist", label: "员工" },
                ]}
              />
              <label>有效期（天）<input type="number" min={1} value={inviteValidDays} onChange={(event) => setInviteValidDays(Number(event.target.value))} /></label>
              <SubmitStatusButton idleText="创建一次性邀请" busyText="创建中..." disabled={!inviteStaffId} />
            </form>
            {lastInviteCode && (
              <div className="invite-result-card">
                <span>员工一次性邀请码</span>
                <strong>{lastInviteCode}</strong>
                <small>把这个邀请码发给员工，员工在登录页选择“加入门店”，填写邀请码、姓名和密码后开通账号。</small>
                <button type="button" onClick={copyLastInviteCode}>{inviteCopied ? "已复制" : "复制邀请码"}</button>
              </div>
            )}
          </>
        ) : (
          <div className="settings-card compact">
            <strong>{session.user.name}</strong>
            <span>角色：{displayRoleName(session.user)}</span>
            <span>账号：{session.user.account}</span>
          </div>
        )}
        </section>
        )}
        {activeModule === "profile" && (
        <section className="panel">
        <PanelTitle icon={<UsersRound size={18} />} title="员工档案" action={`${staffRows.length} 人`} />
        {canManageStaff && editingStaff && (
          <form className="staff-edit-form" onSubmit={saveStaffEdit}>
            <div className="staff-edit-head">
              <strong>编辑员工档案</strong>
              <span>{editingStaff.name} · {data.authUsers.find((user) => user.staffId === editingStaff.id)?.account ?? "未开通账号"}</span>
            </div>
            <label>姓名<input value={editingName} onChange={(event) => setEditingName(event.target.value)} autoComplete="name" required /></label>
            <label>手机号<input type="tel" inputMode="tel" autoComplete="tel" value={editingPhone} onChange={(event) => setEditingPhone(event.target.value)} required /></label>
            <Select label="岗位" value={editingRole} onChange={setEditingRole} options={staffRoleOptions} />
            <label>底薪<input type="number" min={0} value={editingBaseSalary} onChange={(event) => setEditingBaseSalary(Number(event.target.value))} /></label>
            <label>提成比例<input type="number" min={0} step="0.01" value={editingCommissionRate} onChange={(event) => setEditingCommissionRate(Number(event.target.value))} /></label>
            <Select
              label="状态"
              value={editingStatus}
              onChange={(value) => setEditingStatus(value as Staff["status"])}
              options={[
                { value: "active", label: "在职" },
                { value: "inactive", label: "停用" },
              ]}
            />
            <div className="staff-edit-actions">
              <SubmitStatusButton idleText="保存修改" busyText="保存中..." />
              <button type="button" onClick={cancelEditStaff}>取消</button>
            </div>
          </form>
        )}
        <DataTable
          columns={["员工", "岗位", "手机号", "状态", "账号", "底薪", "提成比例", "操作"]}
          rows={staffRows.map((staff) => [
            staff.name,
            displayStaffRole(staff.role),
            staff.phone,
            <Badge key={`${staff.id}-status`} text={staff.status === "active" ? "在职" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />,
            data.authUsers.find((user) => user.staffId === staff.id)?.account ?? "未开通",
            money(staff.baseSalary ?? 0),
            `${Math.round((staff.commissionRate ?? 0) * 100)}%`,
            canManageStaff ? (
              <div className="row-actions" key={`${staff.id}-actions`}>
                <button type="button" onClick={() => startEditStaff(staff)}>编辑</button>
                <button
                  type="button"
                  disabled={mutationPending}
                  onClick={() => void runMutation(() => actions.updateStaff(staff.id, { status: staff.status === "active" ? "inactive" : "active" }))}
                >
                  {mutationPending ? "处理中..." : staff.status === "active" ? "停用" : "启用"}
                </button>
              </div>
            ) : (
              "仅查看"
            ),
          ])}
        />
        </section>
        )}
        {activeModule === "salary" && (
        <section className="panel">
        <PanelTitle icon={<HeartHandshake size={18} />} title="薪资汇总" action="底薪 + 提成" />
        <DataTable
          columns={["员工", "岗位", "底薪", "项目提成", "商品提成", "待结提成", "已结提成", "预计薪资"]}
          rows={salaryRows.map((row) => [
            row.staff.name,
            displayStaffRole(row.staff.role),
            money(row.staff.baseSalary ?? 0),
            money(row.serviceCommission),
            money(row.salesCommission),
            money(row.pending),
            money(row.settled),
            money(row.expected),
          ])}
        />
        </section>
        )}
        {activeModule === "invite" && (
        <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title="邀请记录" action={`${data.staffInvites.length} 条`} />
        <DataTable
          columns={["员工", "账号", "角色", "状态", "邀请码", "有效期", "加入时间", "操作"]}
          rows={data.staffInvites.map((invite) => [
            nameOf(data.staff, invite.staffId),
            invite.account,
            displayUserRole(invite.role),
            <Badge key={`${invite.id}-status`} text={invite.status === "待加入" && invite.expiresAt && +new Date(invite.expiresAt) <= Date.now() ? "已过期" : invite.status} />,
            invite.inviteCode,
            invite.expiresAt ? shortDate(invite.expiresAt) : "未设置",
            invite.joinedAt ? shortDate(invite.joinedAt) : "-",
            canManageStaff && invite.status === "待加入" ? (
              <button key={`${invite.id}-revoke`} disabled={mutationPending} onClick={() => void runMutation(() => actions.revokeStaffInvite(invite.id))}>{mutationPending ? "处理中..." : "作废"}</button>
            ) : (
              invite.revokedAt ? shortDate(invite.revokedAt) : "-"
            ),
          ])}
        />
        </section>
        )}
        {activeModule === "settlements" && (
        <section className="panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="结算流水" action={`${data.commissionSettlements.length} 批`} />
        <DataTable
          columns={["类型", "金额", "笔数", "操作人", "时间"]}
          rows={data.commissionSettlements.map((item) => [
            item.type,
            money(item.amount),
            `${item.count} 笔`,
            nameOf(data.authUsers, item.createdBy),
            shortDate(item.createdAt),
          ])}
        />
        </section>
        )}
        {activeModule === "commissions" && (
        <section className="panel">
        <PanelTitle
          icon={<BadgeCent size={18} />}
          title="提成记录"
          action={hasPermission(session, "commissions:settle") ? <button onClick={settleAll}>全部结算</button> : "仅查看"}
        />
        <DataTable
          columns={["员工", "类型", "订单", "计算基数", "比例", "提成", "状态", "结算批次", "时间"]}
          rows={data.commissions.filter((item) => staffIds.has(item.staffId)).map((item) => [
            nameOf(data.staff, item.staffId),
            item.type,
            data.orders.find((order) => order.id === item.orderId)?.orderNo ?? item.orderId,
            money(item.baseAmount),
            `${Math.round((item.rate ?? 0) * 100)}%`,
            money(item.amount),
            <Badge key={item.id} text={item.status} />,
            item.settlementId ?? "-",
            shortDate(item.createdAt),
          ])}
        />
        </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

