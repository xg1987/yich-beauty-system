import { BadgeCent, ChartNoAxesColumnIncreasing, ClipboardList, CreditCard, Sparkles, UsersRound } from "lucide-react";
import { useState } from "react";
import { ModuleOverview, type FeatureModule } from "../../components/layout/ModuleOverview";
import { PageHero } from "../../components/layout/PageHero";
import { PanelTitle } from "../../components/layout/PanelTitle";
import { Badge } from "../../components/ui/Badge";
import { DataTable } from "../../components/ui/DataTable";
import { Modal } from "../../components/ui/Modal";
import { memberCardCashIn, reportSummary } from "../../domain/business";
import type { AppData, CashPayMethod, Staff } from "../../domain/types";
import { money, shortDate } from "../../domain/utils";
import type { ApiActions } from "../../hooks/useApiData";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;
type ReportPeriodMode = "day" | "week" | "month" | "year";

type ReportsProps = {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  mutationPending: boolean;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
};

function isBusinessStaff(staff: Staff) {
  return staff.role !== "老板";
}

function businessStaffOf(data: AppData) {
  return data.staff.filter(isBusinessStaff);
}

function displayStaffRole(role: string) {
  return role === "老板" || role === "主管" ? "店长" : role;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename: string, columns: Array<string | number>, rows: Array<Array<string | number>>) {
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function DailyCloseControl({
  businessDate,
  setBusinessDate,
  onClose,
  onReverse,
  mutationPending,
}: {
  businessDate: string;
  setBusinessDate: (value: string) => void;
  onClose: () => void;
  onReverse: () => void;
  mutationPending: boolean;
}) {
  return (
    <div className="inline-form">
      <label>
        营业日
        <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
      </label>
      <button disabled={mutationPending} onClick={onClose}>{mutationPending ? "处理中..." : "生成日结"}</button>
      <button className="secondary-button" disabled={mutationPending} onClick={onReverse}>{mutationPending ? "处理中..." : "反结解锁"}</button>
    </div>
  );
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addReportPeriod(date: Date, mode: ReportPeriodMode, delta: number) {
  const next = new Date(date);
  if (mode === "day") next.setDate(next.getDate() + delta);
  if (mode === "week") next.setDate(next.getDate() + delta * 7);
  if (mode === "month") next.setMonth(next.getMonth() + delta);
  if (mode === "year") next.setFullYear(next.getFullYear() + delta);
  return next;
}

function reportPeriodRange(date: Date, mode: ReportPeriodMode) {
  const start = startOfLocalDay(date);
  if (mode === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }
  if (mode === "month") start.setDate(1);
  if (mode === "year") {
    start.setMonth(0);
    start.setDate(1);
  }
  const end = new Date(start);
  if (mode === "day") end.setDate(end.getDate() + 1);
  if (mode === "week") end.setDate(end.getDate() + 7);
  if (mode === "month") end.setMonth(end.getMonth() + 1);
  if (mode === "year") end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function inReportPeriod(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= +start && time < +end;
}

function reportPeriodLabel(date: Date, mode: ReportPeriodMode) {
  if (mode === "day") return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (mode === "month") return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  if (mode === "year") return `${date.getFullYear()}年`;
  const { start, end } = reportPeriodRange(date, "week");
  const weekEnd = new Date(+end - 1);
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
}

function reportPeriodHint(mode: ReportPeriodMode) {
  if (mode === "day") return "今日 · 可左右切换昨天/明天";
  if (mode === "week") return "本周 · 可左右切换上周/下周";
  if (mode === "month") return "本月 · 可左右切换上月/下月";
  return "本年 · 可左右切换去年/明年";
}

function reportComparisonLabel(mode: ReportPeriodMode) {
  if (mode === "day") return "较上一日";
  if (mode === "week") return "较上周";
  if (mode === "month") return "较上月";
  return "较去年";
}

function reportPeriodData(data: AppData, mode: ReportPeriodMode, date: Date) {
  const { start, end } = reportPeriodRange(date, mode);
  return {
    ...data,
    orders: data.orders.filter((order) => inReportPeriod(order.createdAt, start, end)),
    refunds: data.refunds.filter((refund) => inReportPeriod(refund.createdAt, start, end)),
    memberCardTransactions: data.memberCardTransactions.filter((transaction) => inReportPeriod(transaction.createdAt, start, end)),
    appointments: data.appointments.filter((appointment) => inReportPeriod(appointment.startAt, start, end)),
    commissions: data.commissions.filter((commission) => inReportPeriod(commission.createdAt, start, end)),
  };
}

function BusinessOverviewPanel({
  data,
  summary,
  mode,
  date,
  setMode,
  movePeriod,
  exportReportSummary,
  onOpenDaily,
}: {
  data: AppData;
  summary: ReturnType<typeof reportSummary>;
  mode: ReportPeriodMode;
  date: Date;
  setMode: (mode: ReportPeriodMode) => void;
  movePeriod: (delta: number) => void;
  exportReportSummary: () => void;
  onOpenDaily: () => void;
}) {
  const periodOptions: Array<{ key: ReportPeriodMode; label: string }> = [
    { key: "day", label: "日" },
    { key: "week", label: "周" },
    { key: "month", label: "月" },
    { key: "year", label: "年" },
  ];
  const productIncome = data.orders.reduce((sum, order) => sum + (order.productItems ?? []).reduce((itemSum, item) => itemSum + item.amount, 0), 0);
  const cardIncome = data.memberCardTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
  const serviceIncome = Math.max(0, summary.revenue - productIncome - cardIncome);
  const structureTotal = Math.max(1, serviceIncome + productIncome + cardIncome);
  return (
    <section className="business-overview-redesign">
      <div className="business-overview-hero">
        <div>
          <span>店长经营看板</span>
          <strong>经营按周期看</strong>
          <small>日、周、月、年自由切换，可回看历史周期</small>
        </div>
        <button type="button" onClick={exportReportSummary}>导出</button>
      </div>

      <div className="business-period-card">
        <div className="business-period-tabs">
          {periodOptions.map((item) => (
            <button key={item.key} type="button" className={mode === item.key ? "active" : ""} onClick={() => setMode(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="business-period-main">
          <div>
            <strong>{reportPeriodLabel(date, mode)}</strong>
            <span>{reportPeriodHint(mode)}</span>
          </div>
          <div className="business-period-arrows">
            <button type="button" aria-label="上一周期" onClick={() => movePeriod(-1)}>‹</button>
            <button type="button" aria-label="下一周期" onClick={() => movePeriod(1)}>›</button>
          </div>
        </div>
      </div>

      <section className="business-overview-card business-core-card">
        <header>
          <h3>核心结果</h3>
          <span>{reportComparisonLabel(mode)}</span>
        </header>
        <div className="business-core-grid">
          <article>
            <span>实收金额</span>
            <strong>{money(summary.revenue)}</strong>
            <small>--</small>
          </article>
          <article>
            <span>净收入</span>
            <strong>{money(summary.netRevenue)}</strong>
            <small>--</small>
          </article>
        </div>
      </section>

      <section className="business-overview-card">
        <h3>订单与客流</h3>
        <div className="business-mini-grid">
          <article><span>订单数</span><strong>{summary.serviceCount} 单</strong></article>
          <article><span>客单价</span><strong>{money(summary.averageOrderValue)}</strong></article>
          <article><span>到店客户</span><strong>{summary.activeCustomerCount} 人</strong></article>
        </div>
      </section>

      <section className="business-overview-card business-income-card">
        <h3>收入结构</h3>
        <div className="business-income-bar">
          <i style={{ width: `${(serviceIncome / structureTotal) * 100}%` }} />
          <b style={{ width: `${(productIncome / structureTotal) * 100}%` }} />
          <em style={{ width: `${(cardIncome / structureTotal) * 100}%` }} />
        </div>
        <div className="business-income-list">
          <span>服务收入<strong>{money(serviceIncome)}</strong></span>
          <span>商品收入<strong>{money(productIncome)}</strong></span>
          <span>开卡/充值<strong>{money(cardIncome)}</strong></span>
        </div>
      </section>

      <section className="business-overview-card">
        <h3>会员与转化</h3>
        <div className="business-core-grid">
          <article><span>预约转化</span><strong>{summary.serviceCount} / {data.appointments.length}</strong></article>
          <article><span>复购率</span><strong>{(summary.repeatRate * 100).toFixed(1)}%</strong></article>
        </div>
      </section>

      <button type="button" className="business-daily-close-link" onClick={onOpenDaily}>
        <strong>财务日结</strong>
        <span>流水 / 退款 / 毛利 / 库存成本 ›</span>
      </button>
    </section>
  );
}

export default function Reports({
  data,
  actions,
  runMutation,
  mutationPending,
  fromManagement = false,
  onReturnManagement,
}: ReportsProps) {
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeModule, setActiveModule] = useState<"summary" | "payments" | "daily" | "staff" | "members" | "services" | "trend" | undefined>(fromManagement ? "summary" : undefined);
  const [reportPeriodMode, setReportPeriodMode] = useState<ReportPeriodMode>("day");
  const [reportPeriodDate, setReportPeriodDate] = useState(() => new Date());
  const periodData = reportPeriodData(data, reportPeriodMode, reportPeriodDate);
  const summary = reportSummary(periodData);
  const percentText = (value: number) => `${(value * 100).toFixed(1)}%`;
  const exportCsv = (filename: string, columns: string[], rows: Array<Array<string | number>>) => {
    downloadCsvFile(filename, columns, rows);
  };
  const payMethods = [
    ...(["微信", "支付宝", "现金", "银行卡"] as CashPayMethod[]).map((method) => ({
      method,
      amount: data.orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + order.paidAmount, 0)
        + data.memberCardTransactions
          .filter((transaction) => transaction.payMethod === method)
          .reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0),
    })),
    {
      method: "会员卡核销",
      amount: data.orders.filter((order) => order.payMethod === "会员卡").reduce((sum, order) => sum + order.paidAmount, 0),
    },
  ];

  const staffPerformance = businessStaffOf(data)
    .map((staff) => {
      const staffOrders = data.orders.filter((order) => order.staffId === staff.id);
      const revenue = staffOrders.reduce((sum, order) => sum + order.paidAmount, 0);
      const commissions = data.commissions.filter((commission) => commission.staffId === staff.id).reduce((sum, commission) => sum + (commission.amount || 0), 0);
      return { staff, revenue, commissions, orderCount: staffOrders.length };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const totalCardBalance = data.memberCards.reduce((sum, card) => sum + (card.balance || 0), 0);
  const activeMembers = data.memberCards.filter((card) => card.status === "正常").length;
  const newCustomersThisMonth = data.customers.filter((customer) => {
    const created = new Date(customer.lastVisit || Date.now());
    const now = new Date();
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  const serviceRevenue = data.services.map((service) => {
    const revenue = data.orders
      .filter((order) => order.serviceId === service.id)
      .reduce((sum, order) => sum + order.paidAmount, 0);
    return { name: service.name, revenue };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const dailyTrend = Array.from({ length: 14 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    const dayOrders = data.orders.filter((order) => order.createdAt.slice(0, 10) === key && order.status !== "已退款");
    const dayRefunds = data.refunds.filter((refund) => refund.createdAt.slice(0, 10) === key);
    return {
      date: key,
      revenue: dayOrders.reduce((sum, order) => sum + order.paidAmount, 0),
      orders: dayOrders.length,
      refunds: dayRefunds.reduce((sum, refund) => sum + refund.amount, 0),
      appointments: data.appointments.filter((appointment) => appointment.startAt.slice(0, 10) === key).length,
    };
  });
  const exportReportSummary = () => exportCsv("yich-report-summary.csv", ["指标", "结果", "说明"], [
    ["实收现金流", summary.revenue, "扣除退款前的实收订单合计"],
    ["净收入", summary.netRevenue, "实收现金流 - 退款"],
    ["毛利", summary.grossProfit, "净收入 - 商品/库存成本"],
    ["毛利率", percentText(summary.grossMargin), "毛利 / 净收入"],
    ["退款金额", summary.refundAmount, "退款记录合计"],
    ["服务订单", summary.serviceCount, "已完成收银订单"],
    ["员工提成", summary.commission, "服务提成合计"],
    ["会员卡余额", summary.cardBalance, "客户未消耗储值"],
    ["会员积分", summary.totalMemberPoints, "客户积分合计"],
    ["复购率", percentText(summary.repeatRate), "复购客户 / 活跃客户"],
    ["库存估值", summary.inventoryCost, "剩余批次成本"],
    ["临期库存", summary.expiringInventoryCount, "30 天内到期批次"],
    ["低库存项", summary.lowStockCount, "低于预警值"],
  ]);
  const moveReportPeriod = (delta: number) => {
    setReportPeriodDate((current) => addReportPeriod(current, reportPeriodMode, delta));
  };
  const exportTrend = () => exportCsv("yich-report-trend.csv", ["日期", "实收", "订单", "退款", "预约"], dailyTrend.map((item) => [
    item.date,
    item.revenue,
    item.orders,
    item.refunds,
    item.appointments,
  ]));
  type ReportsModuleKey = NonNullable<typeof activeModule>;
  const reportModules: Array<FeatureModule<ReportsModuleKey>> = [
    { key: "summary", title: "经营总览", icon: ChartNoAxesColumnIncreasing, tone: "violet", meta: money(summary.revenue) },
    { key: "trend", title: "经营趋势", icon: ChartNoAxesColumnIncreasing, tone: "teal", meta: `${dailyTrend.length} 天` },
    { key: "payments", title: "收银流水", icon: CreditCard, tone: "rose", meta: `${data.orders.length} 单` },
    { key: "daily", title: "财务日结", icon: ClipboardList, tone: "amber", meta: `${data.dailyCloses.length} 天` },
    { key: "staff", title: "员工业绩", icon: BadgeCent, tone: "jade", meta: `${staffPerformance.length} 人` },
    { key: "members", title: "会员资产", icon: UsersRound, tone: "teal", meta: `${activeMembers} 张` },
    { key: "services", title: "项目排行", icon: Sparkles, tone: "plum", meta: `${serviceRevenue.length} 项` },
  ];
  const activeModuleTitle = activeModule ? reportModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const closeModule = () => {
    if (fromManagement && onReturnManagement) {
      onReturnManagement();
      return;
    }
    setActiveModule(undefined);
  };

  return (
    <div className="page-stack module-hub reports-module-page">
      <PageHero
        icon={<ChartNoAxesColumnIncreasing size={15} />}
        eyebrow="报表分析"
        title="报表分析"
        stats={[
          { label: "净收入", value: money(summary.netRevenue), hint: `退款 ${money(summary.refundAmount)}`, icon: <CreditCard size={18} /> },
          { label: "项目服务数", value: `${summary.serviceCount} 单`, hint: "已完成收银", icon: <Sparkles size={18} /> },
          { label: "毛利率", value: percentText(summary.grossMargin), hint: `毛利 ${money(summary.grossProfit)}`, icon: <BadgeCent size={18} /> },
          { label: "会员资产", value: `${activeMembers} 张`, hint: `余额 ${money(summary.cardBalance)}`, icon: <UsersRound size={18} /> },
        ]}
      />
      {!fromManagement && <ModuleOverview modules={reportModules} activeKey={activeModule} onSelect={setActiveModule} />}
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "报表分析"}
        subtitle={activeModule === "summary" ? undefined : "经营指标、收银流水和财务日结数据"}
        size="large"
        className={activeModule === "summary" ? "business-overview-modal" : undefined}
        onClose={closeModule}
      >
        <div className="module-detail-stack reports-modal-detail">
          {activeModule === "payments" && (
            <section className="panel">
              <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="支付方式分析" action="实收 / 核销" />
              <div className="bar-list">
                {payMethods.map((item) => (
                  <div className="bar-row" key={item.method}>
                    <span>{item.method}</span>
                    <div><i style={{ width: `${summary.revenue ? Math.max(8, (item.amount / summary.revenue) * 100) : 0}%` }} /></div>
                    <strong>{money(item.amount)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          {activeModule === "summary" && (
            <BusinessOverviewPanel
              data={periodData}
              summary={summary}
              mode={reportPeriodMode}
              date={reportPeriodDate}
              setMode={setReportPeriodMode}
              movePeriod={moveReportPeriod}
              exportReportSummary={exportReportSummary}
              onOpenDaily={() => setActiveModule("daily")}
            />
          )}
          {activeModule === "trend" && (
            <section className="panel">
              <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营趋势" action={<button type="button" onClick={exportTrend}>导出 CSV</button>} />
              <DataTable
                columns={["日期", "实收", "订单", "退款", "预约"]}
                rows={dailyTrend.map((item) => [
                  item.date,
                  money(item.revenue),
                  `${item.orders} 单`,
                  money(item.refunds),
                  `${item.appointments} 单`,
                ])}
              />
            </section>
          )}
          {activeModule === "daily" && (
            <section className="panel">
              <PanelTitle icon={<ClipboardList size={18} />} title="财务日结" action="营业日锁定记录" />
              <DailyCloseControl
                businessDate={businessDate}
                setBusinessDate={setBusinessDate}
                mutationPending={mutationPending}
                onClose={() => void runMutation(() => actions.createDailyClose(businessDate))}
                onReverse={() => void runMutation(() => actions.reverseDailyClose(businessDate))}
              />
              <DataTable
                columns={["营业日", "状态", "实收", "退款", "订单", "微信", "会员卡核销", "提成", "时间"]}
                rows={data.dailyCloses.map((item) => [
                  item.businessDate,
                  <Badge key={`${item.id}-status`} text={item.status} tone={item.status === "已反结" ? "warn" : "ok"} />,
                  money(item.revenue),
                  money(item.refundAmount),
                  item.orderCount,
                  money(item.wechatAmount),
                  money(item.memberCardAmount),
                  money(item.commissionAmount),
                  shortDate(item.createdAt),
                ])}
              />
            </section>
          )}
          {activeModule === "staff" && (
            <section className="panel">
              <PanelTitle icon={<BadgeCent size={18} />} title="员工业绩排行" action="按实收排序" />
              <DataTable
                columns={["员工", "角色", "订单数", "实收业绩", "提成合计"]}
                rows={staffPerformance.map((item) => [
                  item.staff.name,
                  displayStaffRole(item.staff.role),
                  item.orderCount,
                  money(item.revenue),
                  money(item.commissions),
                ])}
              />
            </section>
          )}
          {activeModule === "members" && (
            <section className="panel">
              <PanelTitle icon={<UsersRound size={18} />} title="会员分析" action="客户资产概览" />
              <DataTable
                columns={["指标", "数值", "说明"]}
                rows={[
                  ["有效会员卡", `${activeMembers} 张`, "当前正常状态"],
                  ["会员卡总余额", money(totalCardBalance), "客户未消耗储值"],
                  ["客户积分", `${summary.totalMemberPoints} 分`, "开卡、充值和消费累计"],
                  ["复购率", percentText(summary.repeatRate), `${summary.repeatCustomerCount} 位复购客户`],
                  ["本月新增客户", `${newCustomersThisMonth} 人`, "按最近到店时间"],
                  ["客户总数", `${data.customers.length} 人`, "累计建档"],
                ]}
              />
            </section>
          )}
          {activeModule === "services" && (
            <section className="panel">
              <PanelTitle icon={<Sparkles size={18} />} title="热门项目排行" action="按实收" />
              <DataTable
                columns={["项目", "实收金额"]}
                rows={serviceRevenue.map((service) => [service.name, money(service.revenue)])}
              />
            </section>
          )}
        </div>
      </Modal>
    </div>
  );
}
