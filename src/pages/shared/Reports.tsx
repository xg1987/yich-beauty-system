import { BadgeCent, ChartNoAxesColumnIncreasing, ClipboardList, CreditCard, Sparkles, UsersRound } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { ModuleOverview, type FeatureModule } from "../../components/layout/ModuleOverview";
import { PageHero } from "../../components/layout/PageHero";
import { PanelTitle } from "../../components/layout/PanelTitle";
import { Badge } from "../../components/ui/Badge";
import { DataTable } from "../../components/ui/DataTable";
import { Modal } from "../../components/ui/Modal";
import { cashFlowSummary, reportSummary } from "../../domain/business";
import { addReportPeriod, reportPeriodData, type ReportPeriodMode } from "../../domain/reportPeriods";
import { periodPaymentAmounts, periodServicePerformance, periodStaffPerformance, reportablePeriodData } from "../../domain/reporting";
import type { AppData, CashPayMethod } from "../../domain/types";
import { addBusinessDays, businessDateOf, businessDateToday, money, shortDate } from "../../domain/utils";
import type { ApiActions } from "../../hooks/useApiData";

const BusinessOverviewPanel = lazy(() => import("../../components/business/BusinessOverviewPanel"));

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

type ReportsProps = {
  data: AppData;
  actions: ApiActions;
  runMutation: RunMutation;
  mutationPending: boolean;
  fromManagement?: boolean;
  onReturnManagement?: () => void;
};

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

export default function Reports({
  data,
  actions,
  runMutation,
  mutationPending,
  fromManagement = false,
  onReturnManagement,
}: ReportsProps) {
  const [businessDate, setBusinessDate] = useState(() => businessDateToday());
  const [activeModule, setActiveModule] = useState<"summary" | "payments" | "daily" | "staff" | "members" | "services" | "trend" | undefined>(fromManagement ? "summary" : undefined);
  const [reportPeriodMode, setReportPeriodMode] = useState<ReportPeriodMode>("day");
  const [reportPeriodDate, setReportPeriodDate] = useState(() => new Date());
  const periodData = useMemo(
    () => reportPeriodData(data, reportPeriodMode, reportPeriodDate),
    [data, reportPeriodDate, reportPeriodMode],
  );
  const summary = useMemo(() => reportSummary(reportablePeriodData(data, periodData), data), [periodData, data]);
  const percentText = (value: number) => `${(value * 100).toFixed(1)}%`;
  const exportCsv = (filename: string, columns: string[], rows: Array<Array<string | number>>) => {
    downloadCsvFile(filename, columns, rows);
  };
  const payMethods = useMemo(() => {
    const paymentAmounts = periodPaymentAmounts(data, periodData);
    return [
      ...(["微信", "支付宝", "现金", "银行卡"] as CashPayMethod[]).map((method) => ({
        method,
        amount: paymentAmounts.get(method) ?? 0,
      })),
      { method: "会员卡核销", amount: paymentAmounts.get("会员卡") ?? 0 },
    ];
  }, [data, periodData]);
  const positivePayMethodTotal = payMethods.reduce((sum, item) => sum + Math.max(0, item.amount), 0);

  const staffPerformance = useMemo(() => {
    const staffById = new Map(data.staff.map((staff) => [staff.id, staff]));
    return periodStaffPerformance(data, periodData)
      .map((item) => ({ ...item, staff: staffById.get(item.id) }))
      .filter((item) => item.staff && item.staff.role !== "老板")
      .slice(0, 8);
  }, [data, periodData]);

  const totalCardBalance = data.memberCards.reduce((sum, card) => sum + (card.balance || 0), 0);
  const activeMembers = data.memberCards.filter((card) => card.status === "正常").length;

  const serviceRevenue = useMemo(
    () => periodServicePerformance(data, periodData).slice(0, 5),
    [data, periodData],
  );
  const dailyTrend = useMemo(() => Array.from({ length: 14 }).map((_, index) => {
    const key = addBusinessDays(businessDateToday(), -(13 - index));
    const dayData: AppData = {
      ...data,
      orders: data.orders.filter((order) => businessDateOf(order.createdAt) === key),
      refunds: data.refunds.filter((refund) => businessDateOf(refund.createdAt) === key),
      memberCardTransactions: data.memberCardTransactions.filter((transaction) => businessDateOf(transaction.createdAt) === key),
    };
    const dayCashFlow = cashFlowSummary(reportablePeriodData(data, dayData), data);
    return {
      date: key,
      revenue: dayCashFlow.revenue,
      netRevenue: dayCashFlow.netRevenue,
      orders: dayCashFlow.orderCount,
      refunds: dayCashFlow.refundAmount,
      appointments: data.appointments.filter((appointment) => businessDateOf(appointment.startAt) === key).length,
    };
  }), [data]);
  const moveReportPeriod = (delta: number) => {
    setReportPeriodDate((current) => addReportPeriod(current, reportPeriodMode, delta));
  };
  const exportTrend = () => exportCsv("yich-report-trend.csv", ["日期", "原始实收", "退款", "净收入", "订单", "预约"], dailyTrend.map((item) => [
    item.date,
    item.revenue,
    item.refunds,
    item.netRevenue,
    item.orders,
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
              <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="支付方式分析" action="本期净收 / 核销" />
              <div className="bar-list">
                {payMethods.map((item) => (
                  <div className="bar-row" key={item.method}>
                    <span>{item.method}</span>
                    <div><i style={{ width: `${positivePayMethodTotal > 0 && item.amount > 0 ? Math.max(8, (item.amount / positivePayMethodTotal) * 100) : 0}%` }} /></div>
                    <strong>{money(item.amount)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          {activeModule === "summary" && (
            <Suspense fallback={<div className="empty-state">正在加载经营明细...</div>}>
              <BusinessOverviewPanel
                data={data}
                periodData={periodData}
                summary={summary}
                mode={reportPeriodMode}
                date={reportPeriodDate}
                setMode={setReportPeriodMode}
                movePeriod={moveReportPeriod}
                onOpenDaily={() => setActiveModule("daily")}
              />
            </Suspense>
          )}
          {activeModule === "trend" && (
            <section className="panel">
              <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="经营趋势" action={<button type="button" onClick={exportTrend}>导出 CSV</button>} />
              <DataTable
                columns={["日期", "原始实收", "退款", "净收入", "订单", "预约"]}
                rows={dailyTrend.map((item) => [
                  item.date,
                  money(item.revenue),
                  money(item.refunds),
                  money(item.netRevenue),
                  `${item.orders} 单`,
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
                  item.staff?.name ?? item.name,
                  displayStaffRole(item.staff?.role ?? "员工"),
                  item.orderCount,
                  money(item.netAmount),
                  money(item.commission),
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
                  ["本期二次消费占比", percentText(summary.repeatRate), `${summary.repeatCustomerCount} 位客户本期至少消费2次`],
                  ["本期到店客户", `${summary.activeCustomerCount} 人`, "按有效订单客户去重"],
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
