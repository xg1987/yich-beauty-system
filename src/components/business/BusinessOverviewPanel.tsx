import {
  AlertTriangle,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  PackageSearch,
  RefreshCcw,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { memberCardCashIn, reportSummary } from "../../domain/business";
import {
  addReportPeriod,
  reportComparisonLabel,
  reportPeriodData,
  reportPeriodHint,
  reportPeriodLabel,
  reportPeriodRange,
  type ReportPeriodMode,
} from "../../domain/reportPeriods";
import {
  customerMonthlyTrend,
  customerPeriodReport,
  productUsageReport,
  serviceDeliveryReport,
  type CustomerMonthlyTrendPoint,
  type ProductRestockStatus,
  type ProductUsageReportRow,
  type ServiceDeliveryReport,
} from "../../domain/reporting";
import { formatStockQuantity } from "../../domain/products";
import type { AppData } from "../../domain/types";
import { money } from "../../domain/utils";
import SalesPerformanceDetails from "./SalesPerformanceDetails";

type ExportState = {
  status: "idle" | "working" | "success" | "error";
  message: string;
};

type BusinessOverviewPanelProps = {
  data: AppData;
  periodData: AppData;
  summary: ReturnType<typeof reportSummary>;
  mode: ReportPeriodMode;
  date: Date;
  setMode: (mode: ReportPeriodMode) => void;
  movePeriod: (delta: number) => void;
  onOpenDaily: () => void;
};

function countComparison(current: number, previous: number) {
  const delta = current - previous;
  if (delta === 0) return "与上期持平";
  return `较上期 ${delta > 0 ? "+" : ""}${delta}人`;
}

function moneyComparison(current: number, previous: number) {
  const delta = current - previous;
  if (Math.abs(delta) < 0.01) return "与上期持平";
  return `较上期 ${delta > 0 ? "+" : "-"}${money(Math.abs(delta))}`;
}

function stockText(value: number, unit: string) {
  return `${formatStockQuantity(value)}${unit}`;
}

function productStatusClass(status: ProductRestockStatus) {
  if (status === "立即补货") return "urgent";
  if (status === "准备补货") return "soon";
  if (status === "临期关注") return "expiring";
  if (status === "需完善扣耗") return "tracking";
  return "healthy";
}

function CustomerTrendChart({ points }: { points: CustomerMonthlyTrendPoint[] }) {
  const maxCustomers = Math.max(1, ...points.map((point) => Math.max(point.newCustomerCount, point.returningCustomerCount)));
  return (
    <section className="business-overview-card business-customer-trend-card">
      <header>
        <h3>近12个月客户趋势</h3>
        <div className="business-trend-legend" aria-label="客户趋势图例">
          <span><i className="new" />新增客户</span>
          <span><i className="returning" />老客回店</span>
        </div>
      </header>
      <div className="business-customer-trend" aria-label="近12个月新增客户和老客回店趋势">
        {points.map((point) => (
          <article key={point.key} title={`${point.fullLabel}：新增${point.newCustomerCount}人，老客回店${point.returningCustomerCount}人`}>
            <div className="business-trend-bars">
              <i className="new" style={{ height: `${Math.max(4, (point.newCustomerCount / maxCustomers) * 100)}%` }} />
              <i className="returning" style={{ height: `${Math.max(4, (point.returningCustomerCount / maxCustomers) * 100)}%` }} />
            </div>
            <strong>{point.activeCustomerCount}</strong>
            <span>{point.label}</span>
          </article>
        ))}
      </div>
      <small>柱形为新增与老客回店人数，上方数字为当月到店客户总数。</small>
    </section>
  );
}

function ServiceDeliveryPanel({ report }: { report: ServiceDeliveryReport }) {
  const deliveryPercent = (report.deliveryRate * 100).toFixed(1);
  const pendingDetails = report.details.filter((item) => item.remainingTimes > 0);
  return (
    <section className="business-overview-card business-delivery-card">
      <header>
        <div>
          <h3>客户服务项目交付</h3>
          <span>门店累计 · 次数卡及套餐卡</span>
        </div>
        <ClipboardCheck size={22} aria-hidden="true" />
      </header>
      <div className="business-delivery-summary">
        <article>
          <span>涉及服务项目</span>
          <strong>{report.projectCount}项</strong>
          <small>{report.customerCount}位购买客户</small>
        </article>
        <article>
          <span>客户购买总次数</span>
          <strong>{report.totalTimes}次</strong>
          <small>{report.cardCount}张项目卡</small>
        </article>
        <article className="delivered">
          <span>已经交付</span>
          <strong>{report.deliveredTimes}次</strong>
          <small>交付率 {deliveryPercent}%</small>
        </article>
        <article className={report.remainingTimes ? "pending" : "complete"}>
          <span>还未交付</span>
          <strong>{report.remainingTimes}次</strong>
          <small>{report.pendingCustomerCount}位客户待服务</small>
        </article>
      </div>
      <div className="business-delivery-progress">
        <div>
          <span>整体交付进度</span>
          <strong>{report.deliveredTimes} / {report.totalTimes}次</strong>
        </div>
        <i><b style={{ width: `${Math.min(100, report.deliveryRate * 100)}%` }} /></i>
        <small>
          当前待交付 {report.remainingTimes}次
          {report.expiredRemainingTimes > 0 ? ` · 其中过期卡仍有 ${report.expiredRemainingTimes}次` : ""}
        </small>
      </div>
      {report.projects.length ? (
        <div className="business-delivery-projects">
          {report.projects.map((project) => (
            <article key={project.key}>
              <div>
                <strong>{project.serviceName}</strong>
                <span>{project.customerCount}位客户 · {project.cardCount}张卡</span>
              </div>
              <span>总计<strong>{project.totalTimes}次</strong></span>
              <span>已交付<strong>{project.deliveredTimes}次</strong></span>
              <span className={project.remainingTimes ? "pending" : ""}>待交付<strong>{project.remainingTimes}次</strong></span>
            </article>
          ))}
        </div>
      ) : (
        <div className="business-delivery-empty">暂无次数卡或套餐卡服务项目</div>
      )}
      {pendingDetails.length ? (
        <div className="business-delivery-customers">
          <h4>待交付客户明细</h4>
          {pendingDetails.map((item) => (
            <article key={item.key}>
              <div>
                <strong>{item.customerName}</strong>
                <span>{item.serviceName} · {item.cardName}</span>
                <small>有效期至 {item.expiresAt}{item.dataSource === "历史卡名称推算" ? " · 历史卡总次数按卡名推算" : ""}</small>
              </div>
              <span>已交付<strong>{item.deliveredTimes}次</strong></span>
              <em>待交付 {item.remainingTimes}次</em>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProductUsagePanel({ rows }: { rows: ProductUsageReportRow[] }) {
  const urgentCount = rows.filter((item) => item.status === "立即补货").length;
  const soonCount = rows.filter((item) => item.status === "准备补货").length;
  const attentionCount = rows.filter((item) => item.status === "临期关注" || item.status === "需完善扣耗").length;
  return (
    <section className="business-overview-card business-product-card">
      <header>
        <div>
          <h3>产品使用与补货</h3>
          <span>本期使用 · 当前库存 · 近30天预测</span>
        </div>
        <PackageSearch size={22} aria-hidden="true" />
      </header>
      <div className="business-restock-summary">
        <article className={urgentCount ? "urgent" : ""}>
          <AlertTriangle size={18} />
          <span>立即补货</span>
          <strong>{urgentCount}款</strong>
        </article>
        <article className={soonCount ? "soon" : ""}>
          <Boxes size={18} />
          <span>准备补货</span>
          <strong>{soonCount}款</strong>
        </article>
        <article className={attentionCount ? "tracking" : ""}>
          <RefreshCcw size={18} />
          <span>临期/待完善</span>
          <strong>{attentionCount}款</strong>
        </article>
      </div>
      <div className="business-product-list">
        {rows.map((item) => (
          <article className="business-product-row" key={item.productId}>
            <header>
              <div>
                <strong>{item.name}</strong>
                <span>{item.typeLabel} · {item.linkedServiceNames.length ? `用于${item.linkedServiceNames.join("、")}` : "未关联服务项目"}</span>
              </div>
              <em className={productStatusClass(item.status)}>{item.status}</em>
            </header>
            <div className="business-product-metrics">
              <span>项目使用<strong>{formatStockQuantity(item.serviceUseCount)}次</strong></span>
              <span>服务扣库<strong>{stockText(item.serviceConsumedQuantity, item.unit)}</strong></span>
              <span>销售/赠送<strong>{stockText(item.soldQuantity + item.giftedQuantity, item.unit)}</strong></span>
              <span>当前库存<strong>{stockText(item.currentStock, item.unit)}</strong><small>预警 {stockText(item.warningStock, item.unit)}</small></span>
              <span>预计可用<strong>{item.daysCover === undefined ? "--" : `${item.daysCover}天`}</strong><small>近30天日均 {formatStockQuantity(item.averageDailyOutbound)}</small></span>
              <span>建议采购<strong>{item.status === "需完善扣耗" ? "先完善扣耗" : stockText(item.suggestedPurchaseQuantity, item.unit)}</strong><small>{item.expiringQuantity > 0 ? `临期 ${stockText(item.expiringQuantity, item.unit)}` : "按30天备货需求计算"}</small></span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function BusinessOverviewPanel({
  data,
  periodData,
  summary,
  mode,
  date,
  setMode,
  movePeriod,
  onOpenDaily,
}: BusinessOverviewPanelProps) {
  const [exportState, setExportState] = useState<ExportState>({ status: "idle", message: "" });
  const range = useMemo(() => reportPeriodRange(date, mode), [date, mode]);
  const previousDate = useMemo(() => addReportPeriod(date, mode, -1), [date, mode]);
  const previousRange = useMemo(() => reportPeriodRange(previousDate, mode), [previousDate, mode]);
  const previousData = useMemo(() => reportPeriodData(data, mode, previousDate), [data, mode, previousDate]);
  const previousSummary = useMemo(() => reportSummary(previousData), [previousData]);
  const customers = useMemo(() => customerPeriodReport(data, range.start, range.end), [data, range]);
  const previousCustomers = useMemo(
    () => customerPeriodReport(data, previousRange.start, previousRange.end),
    [data, previousRange],
  );
  const trend = useMemo(() => customerMonthlyTrend(data, date, 12), [data, date]);
  const deliveries = useMemo(() => serviceDeliveryReport(data), [data]);
  const products = useMemo(() => productUsageReport(data, range.start, range.end, new Date()), [data, range]);
  const periodOptions: Array<{ key: ReportPeriodMode; label: string }> = [
    { key: "day", label: "日" },
    { key: "week", label: "周" },
    { key: "month", label: "月" },
    { key: "year", label: "年" },
  ];
  const productIncome = periodData.orders.reduce((sum, order) => sum + (order.productItems ?? []).reduce((itemSum, item) => itemSum + item.amount, 0), 0);
  const cardIncome = periodData.memberCardTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
  const serviceIncome = Math.max(0, summary.revenue - productIncome - cardIncome);
  const structureTotal = Math.max(1, serviceIncome + productIncome + cardIncome);

  const exportWorkbook = async () => {
    setExportState({ status: "working", message: "正在整理经营、客户、服务交付和产品明细…" });
    try {
      const { exportBusinessWorkbook } = await import("../../utils/exportBusinessWorkbook");
      const filename = await exportBusinessWorkbook({
        storeName: data.storeProfiles[0]?.name ?? "美业门店",
        periodLabel: reportPeriodLabel(date, mode),
        generatedAt: new Date(),
        summary,
        customerReport: customers,
        customerTrend: trend,
        serviceDelivery: deliveries,
        productUsage: products,
      });
      setExportState({ status: "success", message: `${filename} 已生成` });
    } catch (error) {
      setExportState({
        status: "error",
        message: error instanceof Error ? `导出失败：${error.message}` : "导出失败，请稍后重试",
      });
    }
  };

  return (
    <section className="business-overview-redesign">
      <div className="business-overview-hero">
        <div>
          <span>店长经营驾驶舱</span>
          <strong>销售业绩明细</strong>
          <small>消费客户、未消费客户、库存占压、服务交付和补货一页看清</small>
        </div>
        <button type="button" onClick={exportWorkbook} disabled={exportState.status === "working"}>
          <FileSpreadsheet size={17} />
          {exportState.status === "working" ? "生成中" : "导出Excel"}
        </button>
        {exportState.message ? <p className={`business-export-message ${exportState.status}`}>{exportState.message}</p> : null}
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

      <SalesPerformanceDetails
        data={data}
        periodData={periodData}
        summary={summary}
        mode={mode}
        date={date}
      />

      <section className="business-overview-card business-core-card">
        <header>
          <h3>核心结果</h3>
          <span>{reportComparisonLabel(mode)}</span>
        </header>
        <div className="business-core-grid">
          <article>
            <span>实收金额</span>
            <strong>{money(summary.revenue)}</strong>
            <small>{moneyComparison(summary.revenue, previousSummary.revenue)}</small>
          </article>
          <article>
            <span>净收入</span>
            <strong>{money(summary.netRevenue)}</strong>
            <small>{moneyComparison(summary.netRevenue, previousSummary.netRevenue)}</small>
          </article>
        </div>
      </section>

      <section className="business-overview-card business-customer-card">
        <header>
          <h3>客户经营</h3>
          <span>{reportComparisonLabel(mode)}</span>
        </header>
        <div className="business-customer-grid">
          <article>
            <UserRoundPlus size={20} />
            <span>本期新增客户</span>
            <strong>{customers.newCustomerCount}人</strong>
            <small>{countComparison(customers.newCustomerCount, previousCustomers.newCustomerCount)}</small>
          </article>
          <article>
            <UsersRound size={20} />
            <span>本期到店客户</span>
            <strong>{customers.activeCustomerCount}人</strong>
            <small>{countComparison(customers.activeCustomerCount, previousCustomers.activeCustomerCount)}</small>
          </article>
          <article>
            <RefreshCcw size={20} />
            <span>老客回店人数</span>
            <strong>{customers.returningCustomerCount}人</strong>
            <small>{countComparison(customers.returningCustomerCount, previousCustomers.returningCustomerCount)}</small>
          </article>
          <article>
            <UsersRound size={20} />
            <span>门店总客户</span>
            <strong>{customers.totalCustomerCount}人</strong>
            <small>累计有效客户档案</small>
          </article>
        </div>
        <div className="business-customer-foot">
          <span>到店次数<strong>{customers.visitCount}次</strong></span>
          <span>老客占比<strong>{(customers.returningRate * 100).toFixed(1)}%</strong></span>
          <span>新客消费<strong>{money(customers.newCustomerRevenue)}</strong></span>
          <span>老客消费<strong>{money(customers.returningCustomerRevenue)}</strong></span>
        </div>
      </section>

      <ServiceDeliveryPanel report={deliveries} />

      <CustomerTrendChart points={trend} />

      <section className="business-overview-card">
        <h3>订单效率</h3>
        <div className="business-mini-grid">
          <article><span>订单数</span><strong>{summary.serviceCount}单</strong></article>
          <article><span>客单价</span><strong>{money(summary.averageOrderValue)}</strong></article>
          <article><span>毛利率</span><strong>{(summary.grossMargin * 100).toFixed(1)}%</strong></article>
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

      <ProductUsagePanel rows={products} />

      <button type="button" className="business-daily-close-link" onClick={onOpenDaily}>
        <strong>财务日结</strong>
        <span>流水 / 退款 / 毛利 / 库存成本 ›</span>
      </button>
    </section>
  );
}
