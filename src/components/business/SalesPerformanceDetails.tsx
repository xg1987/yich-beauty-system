import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { memberCardCashIn, memberCardCashRefund, reportSummary } from "../../domain/business";
import { periodPaymentAmounts, periodServicePerformance, periodStaffPerformance, reportableOrderOriginalPaidAmount, reportablePeriodData, reportOrderAuditAmounts } from "../../domain/reporting";
import {
  addReportPeriod,
  reportPeriodData,
  reportPeriodLabel,
  reportPeriodRange,
  type ReportPeriodMode,
} from "../../domain/reportPeriods";
import type { AppData, Order } from "../../domain/types";
import { money, shortDate } from "../../domain/utils";

type BusinessDetailRow = { key: string; cells: ReactNode[] };
type DormancyFilter = "all" | "never" | "30" | "60" | "90";
type InventoryPressureFilter = "all" | "backlog" | "expiring" | "unknown";

type SalesPerformanceDetailsProps = {
  data: AppData;
  periodData: AppData;
  summary: ReturnType<typeof reportSummary>;
  mode: ReportPeriodMode;
  date: Date;
};

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsvSections(filename: string, sections: Array<{
  title: string;
  columns: Array<string | number>;
  rows: Array<Array<string | number>>;
}>) {
  const csv = sections.flatMap((section, index) => [
    ...(index ? [""] : []),
    csvCell(section.title),
    section.columns.map(csvCell).join(","),
    ...section.rows.map((row) => row.map(csvCell).join(",")),
  ]).join("\n");
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

function uniqueText(values: string[], limit = 3) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (!uniqueValues.length) return "-";
  return uniqueValues.length > limit ? `${uniqueValues.slice(0, limit).join("、")}等` : uniqueValues.join("、");
}

function comparisonText(current: number, previous: number, suffix = "") {
  const difference = current - previous;
  if (difference === 0) return "与上期持平";
  if (previous === 0) return `较上期${difference > 0 ? "增加" : "减少"} ${Math.abs(difference).toLocaleString("zh-CN")}${suffix ? ` ${suffix}` : ""}`;
  const rate = Math.abs((difference / previous) * 100).toFixed(1);
  return `较上期${difference > 0 ? "增长" : "下降"} ${rate}%`;
}

function daysBetween(earlier: string | Date | undefined, later: Date) {
  if (!earlier) return undefined;
  const time = +new Date(earlier);
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, Math.floor((+later - time) / 86400000));
}

function orderContent(order: Order, serviceNames: Map<string, string>, productNames: Map<string, string>) {
  const serviceIds = order.serviceIds?.length ? order.serviceIds : order.serviceId ? [order.serviceId] : [];
  const serviceLabels = serviceIds.map((id) => serviceNames.get(id) ?? "");
  const productLabels = (order.productItems ?? []).map((item) => item.productName ?? productNames.get(item.productId) ?? "");
  return [...serviceLabels, ...productLabels].filter(Boolean);
}

function businessOverviewDetails(allData: AppData, periodData: AppData, mode: ReportPeriodMode, date: Date) {
  const customerById = new Map(allData.customers.map((customer) => [customer.id, customer]));
  const serviceNames = new Map(allData.services.map((service) => [service.id, service.name]));
  const productNames = new Map(allData.products.map((product) => [product.id, product.name]));
  const staffNames = new Map(allData.staff.map((staff) => [staff.id, staff.name]));
  const cardById = new Map(allData.memberCards.map((card) => [card.id, card]));
  const periodRefundsByOrder = new Map<string, number>();
  periodData.refunds.forEach((refund) => periodRefundsByOrder.set(refund.orderId, (periodRefundsByOrder.get(refund.orderId) ?? 0) + refund.amount));
  const reportableOrderPaidAmount = (order: Order) => reportableOrderOriginalPaidAmount(allData, order);

  const periodOrders = periodData.orders.filter((order) => {
    const paidAmount = reportableOrderPaidAmount(order);
    return paidAmount > 0 && (periodRefundsByOrder.get(order.id) ?? 0) < paidAmount;
  });
  const ordersByCustomer = new Map<string, Order[]>();
  periodOrders.forEach((order) => {
    const orders = ordersByCustomer.get(order.customerId) ?? [];
    orders.push(order);
    ordersByCustomer.set(order.customerId, orders);
  });
  const cardIncomeByCustomer = new Map<string, typeof allData.memberCardTransactions>();
  const cardRefundsByCustomer = new Map<string, number>();
  periodData.memberCardTransactions.forEach((transaction) => {
    const customerId = cardById.get(transaction.memberCardId)?.customerId;
    if (!customerId) return;
    const cashIn = memberCardCashIn(transaction);
    if (cashIn > 0) {
      const transactions = cardIncomeByCustomer.get(customerId) ?? [];
      transactions.push(transaction);
      cardIncomeByCustomer.set(customerId, transactions);
    }
    const cashRefund = memberCardCashRefund(transaction);
    if (cashRefund > 0) cardRefundsByCustomer.set(customerId, (cardRefundsByCustomer.get(customerId) ?? 0) + cashRefund);
  });
  const consumingCustomerIds = new Set([...ordersByCustomer.keys(), ...cardIncomeByCustomer.keys()]);
  const consumingCustomers = Array.from(consumingCustomerIds)
    .map((customerId) => {
      const orders = ordersByCustomer.get(customerId) ?? [];
      const cardTransactions = cardIncomeByCustomer.get(customerId) ?? [];
      const customer = customerById.get(customerId);
      const lastOrder = orders.reduce<Order | undefined>((latest, order) => !latest || order.createdAt > latest.createdAt ? order : latest, undefined);
      const lastCardTransaction = cardTransactions.reduce<(typeof cardTransactions)[number] | undefined>((latest, transaction) => !latest || transaction.createdAt > latest.createdAt ? transaction : latest, undefined);
      const lastAt = [lastOrder?.createdAt, lastCardTransaction?.createdAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? "";
      const orderPaidAmount = orders.reduce((sum, order) => sum + reportableOrderPaidAmount(order), 0);
      const cardPaidAmount = cardTransactions.reduce((sum, transaction) => sum + memberCardCashIn(transaction), 0);
      const paidAmount = orderPaidAmount + cardPaidAmount;
      const refundAmount = orders.reduce((sum, order) => sum + (periodRefundsByOrder.get(order.id) ?? 0), 0) + (cardRefundsByCustomer.get(customerId) ?? 0);
      const contentLabels = [
        ...orders.flatMap((order) => orderContent(order, serviceNames, productNames)),
        ...cardTransactions.map((transaction) => `${transaction.type}·${cardById.get(transaction.memberCardId)?.name ?? "会员卡"}`),
      ];
      const employeeLabels = [
        ...orders.map((order) => staffNames.get(order.staffId) ?? ""),
        ...cardTransactions.map((transaction) => transaction.staffId ? staffNames.get(transaction.staffId) ?? "" : ""),
      ];
      return {
        id: customerId,
        name: customer?.name ?? lastOrder?.guestName ?? "未建档客户",
        phone: customer?.phone ?? lastOrder?.guestPhone ?? "-",
        transactionCount: orders.length + cardTransactions.length,
        content: uniqueText(contentLabels),
        staff: uniqueText(employeeLabels, 2),
        totalAmount: orders.reduce((sum, order) => sum + order.totalAmount, 0) + cardPaidAmount,
        discountAmount: orders.reduce((sum, order) => sum + order.discountAmount, 0),
        paidAmount,
        refundAmount,
        netAmount: Math.max(0, paidAmount - refundAmount),
        lastAt,
      };
    })
    .sort((left, right) => right.netAmount - left.netAmount || right.lastAt.localeCompare(left.lastAt));
  const consumptionRecords = [
    ...periodData.orders.map((order) => {
      const customer = customerById.get(order.customerId);
      const auditAmounts = reportOrderAuditAmounts(allData, order);
      return {
        id: order.id,
        kind: "收银订单",
        orderNo: order.orderNo,
        customerId: order.customerId,
        customerName: customer?.name ?? order.guestName ?? "未建档客户",
        customerPhone: customer?.phone ?? order.guestPhone ?? "-",
        content: uniqueText(orderContent(order, serviceNames, productNames)),
        staff: staffNames.get(order.staffId) ?? "-",
        totalAmount: order.totalAmount,
        discountAmount: order.discountAmount,
        paidAmount: auditAmounts.paidAmount,
        refundAmount: auditAmounts.refundAmount,
        netAmount: auditAmounts.netAmount,
        payMethod: order.payMethod,
        status: order.status,
        createdAt: order.createdAt,
      };
    }),
    ...periodData.refunds.map((refund) => {
      const order = allData.orders.find((candidate) => candidate.id === refund.orderId);
      const customer = order ? customerById.get(order.customerId) : undefined;
      return {
        id: refund.id,
        kind: "订单退款",
        orderNo: order?.orderNo ?? refund.orderId,
        customerId: order?.customerId ?? "unknown",
        customerName: customer?.name ?? order?.guestName ?? "未建档客户",
        customerPhone: customer?.phone ?? order?.guestPhone ?? "-",
        content: order ? uniqueText(orderContent(order, serviceNames, productNames)) : "历史订单退款",
        staff: order ? staffNames.get(order.staffId) ?? "-" : "-",
        totalAmount: 0,
        discountAmount: 0,
        paidAmount: 0,
        refundAmount: refund.amount,
        netAmount: -refund.amount,
        payMethod: order?.payMethod ?? "-",
        status: "已退款",
        createdAt: refund.createdAt,
      };
    }),
    ...periodData.memberCardTransactions.flatMap((transaction) => {
      const cashIn = memberCardCashIn(transaction);
      const cashRefund = memberCardCashRefund(transaction);
      if (cashIn <= 0 && cashRefund <= 0) return [];
      const card = cardById.get(transaction.memberCardId);
      const customer = card ? customerById.get(card.customerId) : undefined;
      return [{
        id: transaction.id,
        kind: transaction.type,
        orderNo: transaction.id,
        customerId: card?.customerId ?? "unknown",
        customerName: customer?.name ?? "未找到客户",
        customerPhone: customer?.phone ?? "-",
        content: `${transaction.type}·${card?.name ?? "会员卡"}`,
        staff: transaction.staffId ? staffNames.get(transaction.staffId) ?? "-" : "-",
        totalAmount: cashIn,
        discountAmount: 0,
        paidAmount: cashIn,
        refundAmount: cashRefund,
        netAmount: cashIn - cashRefund,
        payMethod: transaction.payMethod ?? "-",
        status: cashRefund > 0 ? "已退款" : "已入账",
        createdAt: transaction.createdAt,
      }];
    }),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const periodEnd = reportPeriodRange(date, mode).end;
  const referenceDate = new Date(Math.min(Date.now(), +periodEnd - 1));
  const lifetimeOrdersByCustomer = new Map<string, Order[]>();
  allData.orders
    .filter((order) => {
      if (+new Date(order.createdAt) >= +periodEnd) return false;
      const refundedBeforePeriodEnd = allData.refunds
        .filter((refund) => refund.orderId === order.id && +new Date(refund.createdAt) < +periodEnd)
        .reduce((sum, refund) => sum + refund.amount, 0);
      const reportablePaidAmount = reportableOrderPaidAmount(order);
      return reportablePaidAmount > 0 && refundedBeforePeriodEnd < reportablePaidAmount;
    })
    .forEach((order) => {
      const orders = lifetimeOrdersByCustomer.get(order.customerId) ?? [];
      orders.push(order);
      lifetimeOrdersByCustomer.set(order.customerId, orders);
    });
  const lifetimeCardIncomeByCustomer = new Map<string, typeof allData.memberCardTransactions>();
  allData.memberCardTransactions
    .filter((transaction) => memberCardCashIn(transaction) > 0 && +new Date(transaction.createdAt) < +periodEnd)
    .forEach((transaction) => {
      const customerId = cardById.get(transaction.memberCardId)?.customerId;
      if (!customerId) return;
      const transactions = lifetimeCardIncomeByCustomer.get(customerId) ?? [];
      transactions.push(transaction);
      lifetimeCardIncomeByCustomer.set(customerId, transactions);
    });
  const cardsByCustomer = new Map<string, typeof allData.memberCards>();
  allData.memberCards.filter((card) => card.status !== "已退卡").forEach((card) => {
    const cards = cardsByCustomer.get(card.customerId) ?? [];
    cards.push(card);
    cardsByCustomer.set(card.customerId, cards);
  });
  const nonConsumingCustomers = allData.customers
    .filter((customer) => !consumingCustomerIds.has(customer.id))
    .map((customer) => {
      const orders = lifetimeOrdersByCustomer.get(customer.id) ?? [];
      const lastOrder = orders.reduce<Order | undefined>((latest, order) => !latest || order.createdAt > latest.createdAt ? order : latest, undefined);
      const cardTransactions = lifetimeCardIncomeByCustomer.get(customer.id) ?? [];
      const lastCardTransaction = cardTransactions.reduce<(typeof cardTransactions)[number] | undefined>((latest, transaction) => !latest || transaction.createdAt > latest.createdAt ? transaction : latest, undefined);
      const lastAt = [lastOrder?.createdAt, lastCardTransaction?.createdAt].filter((value): value is string => Boolean(value)).sort().at(-1);
      const silentDays = daysBetween(lastAt, referenceDate);
      const cards = cardsByCustomer.get(customer.id) ?? [];
      const remainingTimes = cards.reduce((sum, card) => sum + (card.serviceEntitlements?.length
        ? card.serviceEntitlements.reduce((itemSum, item) => itemSum + item.remainingTimes, 0)
        : card.remainingTimes), 0);
      const balance = cards.reduce((sum, card) => sum + card.balance, 0);
      const action = silentDays == null ? "首次转化" : silentDays >= 90 ? "重点召回" : silentDays >= 30 ? "到店唤醒" : "持续维护";
      return {
        customer,
        lastAt,
        silentDays,
        balance,
        remainingTimes,
        cardCount: cards.length,
        sourceAndTags: uniqueText([customer.source, ...customer.tags], 3),
        action,
      };
    })
    .sort((left, right) => {
      if (left.silentDays == null && right.silentDays != null) return -1;
      if (left.silentDays != null && right.silentDays == null) return 1;
      return (right.silentDays ?? 0) - (left.silentDays ?? 0);
    });

  const latestOutboundByProduct = new Map<string, string>();
  allData.inventoryLogs
    .filter((log) => ["服务消耗", "销售出库", "赠品出库"].includes(log.type) && log.delta < 0)
    .forEach((log) => {
      const current = latestOutboundByProduct.get(log.productId);
      if (!current || log.createdAt > current) latestOutboundByProduct.set(log.productId, log.createdAt);
    });
  const now = new Date();
  const activeBatches = allData.inventoryBatches.filter((batch) => batch.remainingQuantity > 0);
  const inventorySource = activeBatches.length
    ? activeBatches.map((batch) => ({
      id: batch.id,
      productId: batch.productId,
      source: batch.source,
      quantity: batch.remainingQuantity,
      unitCost: batch.unitCost,
      createdAt: batch.createdAt,
      expiryAt: batch.expiryAt,
    }))
    : allData.products.filter((product) => product.stock > 0).map((product) => ({
      id: `product-${product.id}`,
      productId: product.id,
      source: "商品总库存",
      quantity: product.stock,
      unitCost: product.cost,
      createdAt: undefined,
      expiryAt: product.expiryAt,
    }));
  const inventoryPressure = inventorySource.map((item) => {
    const lastOutboundAt = latestOutboundByProduct.get(item.productId);
    const ageDays = daysBetween(item.createdAt, now);
    const idleDays = daysBetween(lastOutboundAt ?? item.createdAt, now);
    const expiryDays = item.expiryAt ? Math.ceil((+new Date(`${item.expiryAt}T23:59:59`) - +now) / 86400000) : undefined;
    const amount = item.quantity * item.unitCost;
    const isExpired = expiryDays != null && expiryDays < 0;
    const isBacklog = isExpired || (idleDays ?? 0) >= 90;
    const hasAgeEvidence = item.createdAt != null || lastOutboundAt != null;
    const status = !hasAgeEvidence
      ? "待核对"
      : isExpired
      ? "已过期"
      : expiryDays != null && expiryDays <= 30
        ? "临期"
        : (idleDays ?? 0) >= 180
          ? "严重积压"
          : (idleDays ?? 0) >= 90
            ? "积压"
            : (idleDays ?? ageDays ?? 0) >= 60
              ? "观察"
              : "正常";
    const tone = ["已过期", "严重积压"].includes(status) ? "danger" : ["临期", "积压"].includes(status) ? "warn" : ["观察", "待核对"].includes(status) ? "watch" : "ok";
    return {
      ...item,
      productName: productNames.get(item.productId) ?? "未命名商品",
      lastOutboundAt,
      ageDays,
      idleDays,
      expiryDays,
      amount,
      isBacklog,
      status,
      tone,
    };
  }).sort((left, right) => Number(right.isBacklog) - Number(left.isBacklog) || right.amount - left.amount);

  const staffRanking = periodStaffPerformance(allData, periodData);
  const serviceRanking = periodServicePerformance(allData, periodData);

  const paymentAmounts = periodPaymentAmounts(allData, periodData);
  const paymentBreakdown = Array.from(paymentAmounts.entries())
    .filter(([, amount]) => amount !== 0)
    .map(([method, amount]) => ({ method, amount }))
    .sort((left, right) => right.amount - left.amount);

  return {
    consumingCustomers,
    consumptionRecords,
    nonConsumingCustomers,
    inventoryPressure,
    staffRanking,
    serviceRanking,
    paymentBreakdown,
    inventoryValue: inventoryPressure.reduce((sum, item) => sum + item.amount, 0),
    backlogValue: inventoryPressure.filter((item) => item.isBacklog).reduce((sum, item) => sum + item.amount, 0),
    unknownInventoryCount: inventoryPressure.filter((item) => item.status === "待核对").length,
  };
}

function BusinessDetailTable({
  label,
  columns,
  rows,
  columnsTemplate,
  emptyText,
}: {
  label: string;
  columns: string[];
  rows: BusinessDetailRow[];
  columnsTemplate: string;
  emptyText: string;
}) {
  if (!rows.length) {
    return <div className="business-detail-empty">{emptyText}</div>;
  }
  const style = { "--business-detail-columns": columnsTemplate } as CSSProperties;
  return (
    <div className="business-detail-table" role="table" aria-label={label} style={style}>
      <div className="business-detail-head" role="row">
        {columns.map((column) => <div key={column} role="columnheader">{column}</div>)}
      </div>
      <div className="business-detail-body" role="rowgroup">
        {rows.map((row) => (
          <div className="business-detail-row" role="row" key={row.key}>
            {row.cells.map((cell, index) => <div key={columns[index]} role="cell" data-label={columns[index]}>{cell}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SalesPerformanceDetails({
  data,
  periodData,
  summary,
  mode,
  date,
}: SalesPerformanceDetailsProps) {
  const details = useMemo(
    () => businessOverviewDetails(data, periodData, mode, date),
    [data, periodData, mode, date],
  );
  const previousDate = useMemo(() => addReportPeriod(date, mode, -1), [date, mode]);
  const previousPeriodData = useMemo(
    () => reportPeriodData(data, mode, previousDate),
    [data, mode, previousDate],
  );
  const previousSummary = useMemo(() => reportSummary(reportablePeriodData(data, previousPeriodData), data), [previousPeriodData, data]);
  const previousDetails = useMemo(
    () => businessOverviewDetails(data, previousPeriodData, mode, previousDate),
    [data, previousPeriodData, mode, previousDate],
  );
  const exportReportDetails = () => {
    const periodLabel = reportPeriodLabel(date, mode);
    downloadCsvSections(`yich-sales-detail-${periodLabel.replace(/[^0-9]/g, "-")}.csv`, [
      {
        title: `销售业绩汇总｜${periodLabel}`,
        columns: ["指标", "本期", "上期", "说明"],
        rows: [
          ["实收现金流", summary.revenue, previousSummary.revenue, comparisonText(summary.revenue, previousSummary.revenue)],
          ["净收入", summary.netRevenue, previousSummary.netRevenue, "实收现金流 - 退款"],
          ["消费客户", details.consumingCustomers.length, previousDetails.consumingCustomers.length, "订单及开卡充值客户去重"],
          ["未消费客户", details.nonConsumingCustomers.length, previousDetails.nonConsumingCustomers.length, "全部客户 - 本周期消费客户"],
          ["订单数", summary.serviceCount, previousSummary.serviceCount, "含有效收银订单"],
          ["退款金额", summary.refundAmount, previousSummary.refundAmount, "订单及会员卡退款"],
          ["库存占压", details.inventoryValue, previousDetails.inventoryValue, "当前剩余数量 × 单位成本"],
          ["确认积压", details.backlogValue, previousDetails.backlogValue, "90 天无销售或服务消耗"],
        ],
      },
      {
        title: "逐笔消费流水",
        columns: ["时间", "单号", "类型", "客户", "手机号", "内容", "员工", "支付方式", "原价", "优惠", "实收", "退款", "净额", "状态"],
        rows: details.consumptionRecords.map((record) => [
          record.createdAt,
          record.orderNo,
          record.kind,
          record.customerName,
          record.customerPhone,
          record.content,
          record.staff,
          record.payMethod,
          record.totalAmount,
          record.discountAmount,
          record.paidAmount,
          record.refundAmount,
          record.netAmount,
          record.status,
        ]),
      },
      {
        title: "未消费客户",
        columns: ["客户", "手机号", "卡余额", "剩余次数", "卡数", "最后消费", "沉默天数", "来源标签", "建议动作"],
        rows: details.nonConsumingCustomers.map((item) => [
          item.customer.name,
          item.customer.phone,
          item.balance,
          item.remainingTimes,
          item.cardCount,
          item.lastAt ?? "从未消费",
          item.silentDays ?? "从未消费",
          item.sourceAndTags,
          item.action,
        ]),
      },
      {
        title: "库存占压",
        columns: ["商品", "来源批次", "剩余数量", "单位成本", "占压金额", "库龄天数", "最近出库", "到期日", "状态"],
        rows: details.inventoryPressure.map((item) => [
          item.productName,
          item.source,
          item.quantity,
          item.unitCost,
          item.amount,
          item.ageDays ?? "待核对",
          item.lastOutboundAt ?? "暂无出库",
          item.expiryAt ?? "-",
          item.status,
        ]),
      },
      {
        title: "员工业绩排行",
        columns: ["员工", "笔数", "客户数", "业绩", "退款", "净业绩", "提成"],
        rows: details.staffRanking.map((item) => [item.name, item.orderCount, item.customerCount, item.revenue, item.refundAmount, item.netAmount, item.commission]),
      },
      {
        title: "项目排行",
        columns: ["项目", "次数", "客户数", "业绩"],
        rows: details.serviceRanking.map((item) => [item.name, item.count, item.customerCount, item.revenue]),
      },
      {
        title: "支付方式",
        columns: ["支付方式", "金额"],
        rows: details.paymentBreakdown.map((item) => [item.method, item.amount]),
      },
    ]);
  };

  const [detailQuery, setDetailQuery] = useState("");
  const [dormancyFilter, setDormancyFilter] = useState<DormancyFilter>("all");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryPressureFilter>("all");
  const normalizedQuery = detailQuery.trim().toLocaleLowerCase("zh-CN");
  const includesQuery = (...values: Array<string | number | undefined>) => !normalizedQuery
    || values.some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const visibleConsumingCustomers = details.consumingCustomers.filter((customer) => includesQuery(
    customer.name,
    customer.phone,
    customer.content,
    customer.staff,
  ));
  const visibleConsumptionRecords = details.consumptionRecords.filter((record) => includesQuery(
    record.orderNo,
    record.customerName,
    record.customerPhone,
    record.content,
    record.staff,
    record.payMethod,
    record.status,
  ));
  const visibleNonConsumingCustomers = details.nonConsumingCustomers.filter((item) => {
    const matchesDormancy = dormancyFilter === "all"
      ? true
      : dormancyFilter === "never"
        ? item.silentDays == null
        : item.silentDays == null || item.silentDays >= Number(dormancyFilter);
    return matchesDormancy && includesQuery(item.customer.name, item.customer.phone, item.sourceAndTags, item.action);
  });
  const visibleInventoryPressure = details.inventoryPressure.filter((item) => {
    const matchesStatus = inventoryFilter === "all"
      || inventoryFilter === "backlog" && item.isBacklog
      || inventoryFilter === "expiring" && ["临期", "已过期"].includes(item.status)
      || inventoryFilter === "unknown" && item.status === "待核对";
    return matchesStatus && includesQuery(item.productName, item.source, item.status);
  });
  const consumingRows: BusinessDetailRow[] = visibleConsumingCustomers.map((customer) => ({
    key: customer.id,
    cells: [
      <span className="business-person" key="customer"><strong>{customer.name}</strong><small>{customer.phone}</small></span>,
      <span className="business-cell-stack" key="content"><strong>{customer.content}</strong><small>{customer.staff}</small></span>,
      `${customer.transactionCount} 笔`,
      <span className="business-cell-stack" key="amount"><strong>{money(customer.totalAmount)}</strong><small>优惠 {money(customer.discountAmount)}</small></span>,
      <span className="business-cell-stack business-money-positive" key="paid"><strong>{money(customer.netAmount)}</strong><small>退款 {money(customer.refundAmount)}</small></span>,
      shortDate(customer.lastAt),
    ],
  }));
  const consumptionRecordRows: BusinessDetailRow[] = visibleConsumptionRecords.map((record) => ({
    key: record.id,
    cells: [
      <span className="business-cell-stack" key="time"><strong>{shortDate(record.createdAt)}</strong><small>{record.orderNo}</small></span>,
      <span className="business-person" key="customer"><strong>{record.customerName}</strong><small>{record.customerPhone}</small></span>,
      <span className="business-cell-stack" key="content"><strong>{record.content}</strong><small>{record.staff}</small></span>,
      record.payMethod,
      <span className="business-cell-stack" key="amount"><strong>{money(record.totalAmount)}</strong><small>优惠 {money(record.discountAmount)}</small></span>,
      <span className="business-cell-stack business-money-positive" key="net"><strong>{money(record.netAmount)}</strong><small>实收 {money(record.paidAmount)} · 退款 {money(record.refundAmount)}</small></span>,
      <span className={`business-record-status tone-${record.netAmount < 0 || record.status === "已退款" ? "danger" : record.refundAmount > 0 ? "warn" : "ok"}`} key="status">{record.status}</span>,
    ],
  }));
  const nonConsumingRows: BusinessDetailRow[] = visibleNonConsumingCustomers.map((item) => ({
    key: item.customer.id,
    cells: [
      <span className="business-person" key="customer"><strong>{item.customer.name}</strong><small>{item.customer.phone}</small></span>,
      <span className="business-cell-stack" key="asset"><strong>{money(item.balance)} · {item.remainingTimes}次</strong><small>{item.cardCount} 张卡</small></span>,
      item.lastAt ? shortDate(item.lastAt) : "从未消费",
      <span className="business-cell-stack" key="silence"><strong>{item.silentDays == null ? "未转化" : `${item.silentDays} 天`}</strong><small>{item.action}</small></span>,
      item.sourceAndTags,
    ],
  }));
  const inventoryRows: BusinessDetailRow[] = visibleInventoryPressure.map((item) => ({
    key: item.id,
    cells: [
      <span className="business-cell-stack" key="product"><strong>{item.productName}</strong><small>{item.source}</small></span>,
      `${item.quantity} · ${money(item.unitCost)}/件`,
      <strong key="amount">{money(item.amount)}</strong>,
      item.ageDays == null ? "-" : `${item.ageDays} 天`,
      item.lastOutboundAt ? shortDate(item.lastOutboundAt) : "暂无出库",
      <span className={`business-inventory-status tone-${item.tone}`} key="status">{item.status}</span>,
    ],
  }));
  return (
    <div className="sales-performance-detail-stack">
      <section className="business-kpi-grid" aria-label="销售业绩核心数据">
        <article><span>本周期实收</span><strong>{money(summary.revenue)}</strong><small>净收入 {money(summary.netRevenue)} · {comparisonText(summary.revenue, previousSummary.revenue, "元")}</small></article>
        <article><span>消费客户</span><strong>{details.consumingCustomers.length} 位</strong><small>{summary.serviceCount} 单 · {comparisonText(details.consumingCustomers.length, previousDetails.consumingCustomers.length, "位")}</small></article>
        <article><span>未消费客户</span><strong>{details.nonConsumingCustomers.length} 位</strong><small>{comparisonText(details.nonConsumingCustomers.length, previousDetails.nonConsumingCustomers.length, "位")}</small></article>
        <article><span>库存占压</span><strong>{money(details.inventoryValue)}</strong><small>确认积压 {money(details.backlogValue)}{details.unknownInventoryCount ? ` · ${details.unknownInventoryCount}项待核对` : ""}</small></article>
      </section>

      <section className="business-detail-toolbar" aria-label="销售业绩明细筛选">
        <label>
          <span>搜索明细</span>
          <input
            type="search"
            aria-label="搜索客户、手机号、项目、员工或商品"
            placeholder="客户、手机号、项目、员工或商品"
            value={detailQuery}
            onChange={(event) => setDetailQuery(event.target.value)}
          />
        </label>
        <div>
          <span>当前共 {details.consumptionRecords.length} 笔消费流水</span>
          {detailQuery && <button type="button" onClick={() => setDetailQuery("")}>清除搜索</button>}
          <button type="button" onClick={exportReportDetails}>导出明细 CSV</button>
        </div>
      </section>

      <section className="business-detail-card">
        <header>
          <div><h3>消费客户明细</h3><p>本周期产生有效消费的客户、项目和实收情况</p></div>
          <strong>{visibleConsumingCustomers.length}/{details.consumingCustomers.length} 位 · {visibleConsumptionRecords.length} 笔</strong>
        </header>
        <BusinessDetailTable
          label="消费客户明细"
          columns={["客户", "消费内容 / 员工", "消费笔数", "原价 / 优惠", "净消费 / 退款", "最近消费"]}
          columnsTemplate="minmax(138px, 1.1fr) minmax(180px, 1.6fr) 68px minmax(116px, .9fr) minmax(116px, .9fr) 118px"
          rows={consumingRows}
          emptyText="本周期暂无消费客户，可切换周、月或年查看历史消费。"
        />
        <div className="business-subsection-title">
          <div><strong>逐笔消费流水</strong><small>订单、开卡、充值和退款逐笔核对</small></div>
          <span>{visibleConsumptionRecords.length} 笔</span>
        </div>
        <BusinessDetailTable
          label="逐笔消费流水"
          columns={["时间 / 单号", "客户", "内容 / 员工", "支付", "原价 / 优惠", "净额 / 实收退款", "状态"]}
          columnsTemplate="minmax(132px, 1fr) minmax(128px, 1fr) minmax(170px, 1.45fr) 72px minmax(112px, .9fr) minmax(145px, 1.1fr) 78px"
          rows={consumptionRecordRows}
          emptyText="没有符合当前周期和搜索条件的消费流水。"
        />
      </section>

      <section className="business-detail-card">
        <header>
          <div>
            <h3>未消费客户明细</h3>
            <p>本周期没有有效消费的客户，优先查看未转化和长期沉默客户</p>
            <div className="business-inline-filters" role="group" aria-label="未消费客户筛选">
              {([
                ["all", "全部"],
                ["never", "从未消费"],
                ["30", "30天+"],
                ["60", "60天+"],
                ["90", "90天+"],
              ] as Array<[DormancyFilter, string]>).map(([key, label]) => (
                <button type="button" key={key} className={dormancyFilter === key ? "active" : ""} onClick={() => setDormancyFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <strong>{visibleNonConsumingCustomers.length}/{details.nonConsumingCustomers.length} 位待跟进</strong>
        </header>
        <BusinessDetailTable
          label="未消费客户明细"
          columns={["客户", "卡内资产", "最后消费", "沉默情况", "来源 / 标签"]}
          columnsTemplate="minmax(138px, 1.1fr) minmax(128px, 1fr) 118px 100px minmax(140px, 1.2fr)"
          rows={nonConsumingRows}
          emptyText="本周期所有客户均有消费。"
        />
      </section>

      <section className="business-detail-card">
        <header>
          <div>
            <h3>库存占压明细</h3>
            <p>当前剩余库存资金；90 天无销售或服务消耗计为积压</p>
            <div className="business-inline-filters" role="group" aria-label="库存占压筛选">
              {([
                ["all", "全部库存"],
                ["backlog", "确认积压"],
                ["expiring", "临期/过期"],
                ["unknown", "待核对"],
              ] as Array<[InventoryPressureFilter, string]>).map(([key, label]) => (
                <button type="button" key={key} className={inventoryFilter === key ? "active" : ""} onClick={() => setInventoryFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <strong>{visibleInventoryPressure.length}/{details.inventoryPressure.length} 项 · 占压 {money(details.inventoryValue)}</strong>
        </header>
        <BusinessDetailTable
          label="库存占压明细"
          columns={["商品 / 批次", "剩余 / 成本", "占压金额", "库龄", "最近出库", "状态"]}
          columnsTemplate="minmax(150px, 1.3fr) minmax(118px, 1fr) 105px 76px 118px 82px"
          rows={inventoryRows}
          emptyText="当前没有库存占压。"
        />
      </section>

      <section className="business-detail-card business-ranking-card">
        <header>
          <div><h3>经营排行与支付结构</h3><p>同一周期内查看员工贡献、热门项目和收款方式</p></div>
          <strong>按净业绩排序</strong>
        </header>
        <div className="business-ranking-grid">
          <section>
            <h4>员工业绩</h4>
            <div className="business-rank-list">
              {details.staffRanking.slice(0, 8).map((item, index) => (
                <div key={item.id}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{item.orderCount} 笔 · {item.customerCount} 位客户 · 提成 {money(item.commission)}</small></span><em>{money(item.netAmount)}</em></div>
              ))}
              {!details.staffRanking.length && <p>本周期暂无员工业绩</p>}
            </div>
          </section>
          <section>
            <h4>项目排行</h4>
            <div className="business-rank-list">
              {details.serviceRanking.slice(0, 8).map((item, index) => (
                <div key={item.id}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{item.count} 次 · {item.customerCount} 位客户</small></span><em>{money(item.revenue)}</em></div>
              ))}
              {!details.serviceRanking.length && <p>本周期暂无项目消费</p>}
            </div>
          </section>
          <section>
            <h4>支付方式</h4>
            <div className="business-rank-list">
              {details.paymentBreakdown.map((item, index) => (
                <div key={item.method}><b>{index + 1}</b><span><strong>{item.method}</strong><small>本周期实收/核销</small></span><em>{money(item.amount)}</em></div>
              ))}
              {!details.paymentBreakdown.length && <p>本周期暂无支付记录</p>}
            </div>
          </section>
        </div>
      </section>

    </div>
  );
}
