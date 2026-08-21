import type { AppData, Order, Product, ServiceConsumable } from "./types";
import { legacyProductServiceStockDeductible, legacyServiceStockQuantityForProduct, productServiceStockDeductible, productServiceStockReviewStatus, roundStockQuantity } from "./products";

export type CustomerPeriodDetail = {
  customerId: string;
  name: string;
  phone: string;
  customerType: "新客" | "老客";
  firstPurchaseAt: string;
  lastPurchaseAt: string;
  visitCount: number;
  paidAmount: number;
};

export type CustomerPeriodReport = {
  newCustomerCount: number;
  activeCustomerCount: number;
  returningCustomerCount: number;
  returningRate: number;
  visitCount: number;
  totalCustomerCount: number;
  newCustomerRevenue: number;
  returningCustomerRevenue: number;
  details: CustomerPeriodDetail[];
};

export type CustomerMonthlyTrendPoint = {
  key: string;
  label: string;
  fullLabel: string;
  newCustomerCount: number;
  returningCustomerCount: number;
  activeCustomerCount: number;
  cumulativePayingCustomerCount: number;
  revenue: number;
};

export type ServiceDeliveryDataSource = "项目次数明细" | "开卡流水" | "历史卡名称推算" | "仅当前余额";

export type ServiceDeliveryDetail = {
  key: string;
  cardId: string;
  customerId: string;
  customerName: string;
  phone: string;
  cardName: string;
  cardStatus: AppData["memberCards"][number]["status"];
  serviceId?: string;
  serviceName: string;
  totalTimes: number;
  deliveredTimes: number;
  remainingTimes: number;
  deliveryRate: number;
  expiresAt: string;
  dataSource: ServiceDeliveryDataSource;
};

export type ServiceDeliveryProjectSummary = {
  key: string;
  serviceName: string;
  customerCount: number;
  cardCount: number;
  totalTimes: number;
  deliveredTimes: number;
  remainingTimes: number;
  deliveryRate: number;
};

export type ServiceDeliveryReport = {
  projectCount: number;
  cardCount: number;
  customerCount: number;
  pendingCustomerCount: number;
  totalTimes: number;
  deliveredTimes: number;
  remainingTimes: number;
  deliveryRate: number;
  expiredRemainingTimes: number;
  projects: ServiceDeliveryProjectSummary[];
  details: ServiceDeliveryDetail[];
};

export type ProductRestockStatus = "待确认扣减规则" | "立即补货" | "准备补货" | "临期关注" | "需完善扣耗" | "库存充足";

export type ProductUsageReportRow = {
  productId: string;
  name: string;
  typeLabel: string;
  unit: string;
  linkedServiceNames: string[];
  serviceUseCount: number;
  serviceConsumedQuantity: number;
  soldQuantity: number;
  giftedQuantity: number;
  lossQuantity: number;
  totalOutboundQuantity: number;
  currentStock: number;
  warningStock: number;
  averageDailyOutbound: number;
  daysCover?: number;
  expiringQuantity: number;
  status: ProductRestockStatus;
  suggestedPurchaseQuantity: number;
  usageTrackingComplete: boolean;
};

function validTime(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function isWithin(value: string | undefined, start: Date, end: Date) {
  const time = validTime(value);
  return time !== undefined && time >= +start && time < +end;
}

function effectiveOrders(data: AppData) {
  return data.orders.filter((order) => order.status !== "已退款" && validTime(order.createdAt) !== undefined);
}

function customerFirstPurchaseTimes(orders: Order[]) {
  const firstTimes = new Map<string, number>();
  orders.forEach((order) => {
    if (!order.customerId) return;
    const time = validTime(order.createdAt);
    if (time === undefined) return;
    firstTimes.set(order.customerId, Math.min(firstTimes.get(order.customerId) ?? time, time));
  });
  return firstTimes;
}

export function customerPeriodReport(data: AppData, start: Date, end: Date): CustomerPeriodReport {
  const orders = effectiveOrders(data);
  const firstTimes = customerFirstPurchaseTimes(orders);
  const periodOrders = orders.filter((order) => isWithin(order.createdAt, start, end));
  const customerMap = new Map(data.customers.map((customer) => [customer.id, customer]));
  const orderGroups = new Map<string, Order[]>();

  periodOrders.forEach((order) => {
    if (!order.customerId) return;
    const current = orderGroups.get(order.customerId) ?? [];
    current.push(order);
    orderGroups.set(order.customerId, current);
  });

  const details = Array.from(orderGroups, ([customerId, customerOrders]) => {
    const customer = customerMap.get(customerId);
    const firstTime = firstTimes.get(customerId) ?? +start;
    const sortedOrders = [...customerOrders].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const customerType: CustomerPeriodDetail["customerType"] = firstTime >= +start ? "新客" : "老客";
    return {
      customerId,
      name: customer?.name ?? customerOrders[0]?.guestName ?? "未命名客户",
      phone: customer?.phone ?? customerOrders[0]?.guestPhone ?? "",
      customerType,
      firstPurchaseAt: new Date(firstTime).toISOString(),
      lastPurchaseAt: sortedOrders.at(-1)?.createdAt ?? new Date(firstTime).toISOString(),
      visitCount: customerOrders.length,
      paidAmount: customerOrders.reduce((sum, order) => sum + order.paidAmount, 0),
    };
  }).sort((left, right) => right.paidAmount - left.paidAmount);

  const newCustomerCount = details.filter((item) => item.customerType === "新客").length;
  const returningCustomerCount = details.filter((item) => item.customerType === "老客").length;
  const activeCustomerCount = details.length;
  return {
    newCustomerCount,
    activeCustomerCount,
    returningCustomerCount,
    returningRate: activeCustomerCount ? returningCustomerCount / activeCustomerCount : 0,
    visitCount: periodOrders.length,
    totalCustomerCount: data.customers.length,
    newCustomerRevenue: details.filter((item) => item.customerType === "新客").reduce((sum, item) => sum + item.paidAmount, 0),
    returningCustomerRevenue: details.filter((item) => item.customerType === "老客").reduce((sum, item) => sum + item.paidAmount, 0),
    details,
  };
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, delta: number) {
  const next = new Date(value);
  next.setMonth(next.getMonth() + delta);
  return next;
}

export function customerMonthlyTrend(data: AppData, referenceDate: Date, months = 12): CustomerMonthlyTrendPoint[] {
  const orders = effectiveOrders(data);
  const firstTimes = customerFirstPurchaseTimes(orders);
  const lastMonthStart = startOfMonth(referenceDate);
  return Array.from({ length: months }, (_, index) => {
    const start = addMonths(lastMonthStart, index - months + 1);
    const end = addMonths(start, 1);
    const periodOrders = orders.filter((order) => isWithin(order.createdAt, start, end));
    const activeIds = new Set(periodOrders.map((order) => order.customerId).filter(Boolean));
    const newIds = new Set(Array.from(activeIds).filter((customerId) => {
      const time = firstTimes.get(customerId);
      return time !== undefined && time >= +start && time < +end;
    }));
    const returningIds = new Set(Array.from(activeIds).filter((customerId) => {
      const time = firstTimes.get(customerId);
      return time !== undefined && time < +start;
    }));
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: `${start.getMonth() + 1}月`,
      fullLabel: `${start.getFullYear()}年${start.getMonth() + 1}月`,
      newCustomerCount: newIds.size,
      returningCustomerCount: returningIds.size,
      activeCustomerCount: activeIds.size,
      cumulativePayingCustomerCount: Array.from(firstTimes.values()).filter((time) => time < +end).length,
      revenue: periodOrders.reduce((sum, order) => sum + order.paidAmount, 0),
    };
  });
}

function inferredTimesFromText(value: string) {
  const matches = Array.from(value.matchAll(/(\d+(?:\.\d+)?)\s*次/g));
  return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
}

function legacyCardTimes(data: AppData, card: AppData["memberCards"][number]) {
  const transactions = data.memberCardTransactions.filter((item) => item.memberCardId === card.id);
  const openingTimes = transactions
    .filter((item) => item.type === "开卡" || item.type === "调整")
    .reduce((sum, item) => sum + Math.max(0, item.timesDelta), 0);
  const netDeliveredTimes = Math.max(
    0,
    -transactions
      .filter((item) => item.type === "消费" || item.type === "退款")
      .reduce((sum, item) => sum + item.timesDelta, 0),
  );
  const textTimes = inferredTimesFromText(`${card.name} ${card.benefitText ?? ""}`);
  const remainingTimes = Math.max(0, card.remainingTimes);
  const totalTimes = Math.max(remainingTimes, openingTimes, remainingTimes + netDeliveredTimes, textTimes);
  const dataSource: ServiceDeliveryDataSource = openingTimes > 0
    ? "开卡流水"
    : textTimes > remainingTimes
      ? "历史卡名称推算"
      : netDeliveredTimes > 0
        ? "开卡流水"
        : "仅当前余额";
  return {
    totalTimes,
    remainingTimes: Math.min(remainingTimes, totalTimes),
    dataSource,
  };
}

function serviceNameOf(data: AppData, serviceId: string) {
  return data.services.find((service) => service.id === serviceId)?.name ?? "未命名项目";
}

export function serviceDeliveryReport(data: AppData, now = new Date()): ServiceDeliveryReport {
  const customerMap = new Map(data.customers.map((customer) => [customer.id, customer]));
  const distinctProjectKeys = new Set<string>();
  const details: ServiceDeliveryDetail[] = [];

  data.memberCards
    .filter((card) => card.type !== "储值卡" && card.type !== "折扣卡" && card.status !== "已退卡" && card.status !== "已作废")
    .forEach((card) => {
      const customer = customerMap.get(card.customerId);
      if (card.serviceEntitlements?.length) {
        card.serviceEntitlements.forEach((entitlement) => {
          const totalTimes = Math.max(0, entitlement.totalTimes, entitlement.remainingTimes);
          const remainingTimes = Math.min(Math.max(0, entitlement.remainingTimes), totalTimes);
          distinctProjectKeys.add(entitlement.serviceId || `card:${card.id}`);
          details.push({
            key: `${card.id}:${entitlement.serviceId}`,
            cardId: card.id,
            customerId: card.customerId,
            customerName: customer?.name ?? "未命名客户",
            phone: customer?.phone ?? "",
            cardName: card.name,
            cardStatus: card.status,
            serviceId: entitlement.serviceId,
            serviceName: serviceNameOf(data, entitlement.serviceId),
            totalTimes,
            deliveredTimes: Math.max(0, totalTimes - remainingTimes),
            remainingTimes,
            deliveryRate: totalTimes ? Math.max(0, totalTimes - remainingTimes) / totalTimes : 0,
            expiresAt: card.expiresAt,
            dataSource: "项目次数明细",
          });
        });
        return;
      }

      const serviceIds = Array.from(new Set([...(card.serviceIds ?? []), ...(card.serviceId ? [card.serviceId] : [])].filter(Boolean)));
      serviceIds.forEach((serviceId) => distinctProjectKeys.add(serviceId));
      const projectKey = serviceIds.length ? serviceIds.slice().sort().join("|") : `card:${card.id}`;
      if (serviceIds.length === 0) distinctProjectKeys.add(projectKey);
      const times = legacyCardTimes(data, card);
      const serviceName = serviceIds.length
        ? `${serviceIds.map((serviceId) => serviceNameOf(data, serviceId)).join(" / ")}${serviceIds.length > 1 ? "（共享次数）" : ""}`
        : `${card.name}（未指定项目）`;
      const deliveredTimes = Math.max(0, times.totalTimes - times.remainingTimes);
      details.push({
        key: `${card.id}:${projectKey}`,
        cardId: card.id,
        customerId: card.customerId,
        customerName: customer?.name ?? "未命名客户",
        phone: customer?.phone ?? "",
        cardName: card.name,
        cardStatus: card.status,
        serviceId: serviceIds.length === 1 ? serviceIds[0] : undefined,
        serviceName,
        totalTimes: times.totalTimes,
        deliveredTimes,
        remainingTimes: times.remainingTimes,
        deliveryRate: times.totalTimes ? deliveredTimes / times.totalTimes : 0,
        expiresAt: card.expiresAt,
        dataSource: times.dataSource,
      });
    });

  const projectGroups = new Map<string, ServiceDeliveryDetail[]>();
  details.forEach((detail) => {
    const groupKey = detail.serviceId ?? detail.serviceName;
    const current = projectGroups.get(groupKey) ?? [];
    current.push(detail);
    projectGroups.set(groupKey, current);
  });
  const projects = Array.from(projectGroups, ([key, rows]) => {
    const totalTimes = rows.reduce((sum, item) => sum + item.totalTimes, 0);
    const deliveredTimes = rows.reduce((sum, item) => sum + item.deliveredTimes, 0);
    const remainingTimes = rows.reduce((sum, item) => sum + item.remainingTimes, 0);
    return {
      key,
      serviceName: rows[0]?.serviceName ?? "未命名项目",
      customerCount: new Set(rows.map((item) => item.customerId)).size,
      cardCount: new Set(rows.map((item) => item.cardId)).size,
      totalTimes,
      deliveredTimes,
      remainingTimes,
      deliveryRate: totalTimes ? deliveredTimes / totalTimes : 0,
    };
  }).sort((left, right) => right.remainingTimes - left.remainingTimes || left.serviceName.localeCompare(right.serviceName, "zh-CN"));

  const totalTimes = details.reduce((sum, item) => sum + item.totalTimes, 0);
  const deliveredTimes = details.reduce((sum, item) => sum + item.deliveredTimes, 0);
  const remainingTimes = details.reduce((sum, item) => sum + item.remainingTimes, 0);
  const nowTime = +now;
  return {
    projectCount: distinctProjectKeys.size,
    cardCount: new Set(details.map((item) => item.cardId)).size,
    customerCount: new Set(details.map((item) => item.customerId)).size,
    pendingCustomerCount: new Set(details.filter((item) => item.remainingTimes > 0).map((item) => item.customerId)).size,
    totalTimes,
    deliveredTimes,
    remainingTimes,
    deliveryRate: totalTimes ? deliveredTimes / totalTimes : 0,
    expiredRemainingTimes: details
      .filter((item) => item.remainingTimes > 0 && (item.cardStatus === "过期" || Date.parse(`${item.expiresAt}T23:59:59`) < nowTime))
      .reduce((sum, item) => sum + item.remainingTimes, 0),
    projects,
    details: details.sort((left, right) =>
      right.remainingTimes - left.remainingTimes
      || left.customerName.localeCompare(right.customerName, "zh-CN")
      || left.serviceName.localeCompare(right.serviceName, "zh-CN"),
    ),
  };
}

type ProductUsageAccumulator = {
  serviceUseCount: number;
  serviceConsumedQuantity: number;
  soldQuantity: number;
  giftedQuantity: number;
};

function emptyProductUsage(): ProductUsageAccumulator {
  return {
    serviceUseCount: 0,
    serviceConsumedQuantity: 0,
    soldQuantity: 0,
    giftedQuantity: 0,
  };
}

function addQuantity(target: Map<string, ProductUsageAccumulator>, productId: string, field: keyof ProductUsageAccumulator, quantity: number) {
  const current = target.get(productId) ?? emptyProductUsage();
  current[field] = roundStockQuantity(current[field] + quantity);
  target.set(productId, current);
}

function serviceConsumables(service: AppData["services"][number]): ServiceConsumable[] {
  if (service.consumables?.length) return service.consumables.filter((item) => item.productId);
  if (service.consumableProductId) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
  return [];
}

function orderServiceIds(order: Order) {
  return order.serviceIds?.length ? order.serviceIds : order.serviceId ? [order.serviceId] : [];
}

function orderServiceStockConsumption(order: Order, data: AppData) {
  if (order.serviceConsumables !== undefined) return order.serviceConsumables;
  const productMap = new Map(data.products.map((product) => [product.id, product]));
  const merged = new Map<string, number>();
  orderServiceIds(order).forEach((serviceId) => {
    const service = data.services.find((item) => item.id === serviceId);
    if (!service) return;
    serviceConsumables(service).forEach((item) => {
      const product = productMap.get(item.productId);
      if (!product || !legacyProductServiceStockDeductible(product)) return;
      const quantity = legacyServiceStockQuantityForProduct(product, item.quantity);
      if (quantity <= 0) return;
      merged.set(item.productId, roundStockQuantity((merged.get(item.productId) ?? 0) + quantity));
    });
  });
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

function usageFromOrders(orders: Order[], data: AppData) {
  const usage = new Map<string, ProductUsageAccumulator>();
  const serviceMap = new Map(data.services.map((service) => [service.id, service]));
  orders.forEach((order) => {
    orderServiceIds(order).forEach((serviceId) => {
      const service = serviceMap.get(serviceId);
      if (!service) return;
      serviceConsumables(service).forEach((item) => addQuantity(usage, item.productId, "serviceUseCount", 1));
    });
    orderServiceStockConsumption(order, data).forEach((item) => {
      addQuantity(usage, item.productId, "serviceConsumedQuantity", item.quantity);
    });
    (order.productItems ?? (order.productId ? [{ productId: order.productId, quantity: 1, unitPrice: 0, amount: 0 }] : []))
      .forEach((item) => addQuantity(usage, item.productId, "soldQuantity", item.quantity));
    (order.giftProductItems ?? (order.giftProductId ? [{ productId: order.giftProductId, quantity: 1, unitPrice: 0, amount: 0 }] : []))
      .forEach((item) => addQuantity(usage, item.productId, "giftedQuantity", item.quantity));
  });
  return usage;
}

function expiringQuantity(data: AppData, productId: string, now: Date) {
  const deadline = new Date(+now + 30 * 86400000);
  return (data.inventoryBatches ?? [])
    .filter((batch) =>
      batch.productId === productId
      && batch.remainingQuantity > 0
      && batch.expiryAt
      && validTime(`${batch.expiryAt}T00:00:00.000Z`) !== undefined
      && Date.parse(`${batch.expiryAt}T00:00:00.000Z`) <= +deadline,
    )
    .reduce((sum, batch) => sum + batch.remainingQuantity, 0);
}

function restockStatus(input: {
  product: Product;
  averageDailyOutbound: number;
  daysCover?: number;
  expiringQuantity: number;
  usageTrackingComplete: boolean;
  linkedServiceCount: number;
}): ProductRestockStatus {
  if (productServiceStockReviewStatus(input.product) === "pending") return "待确认扣减规则";
  if (input.product.stock <= input.product.warningStock || (input.daysCover !== undefined && input.daysCover <= 7)) {
    return "立即补货";
  }
  if (input.daysCover !== undefined && input.daysCover <= 14) return "准备补货";
  if (input.expiringQuantity > 0) return "临期关注";
  if (!input.usageTrackingComplete && input.linkedServiceCount > 0) return "需完善扣耗";
  return "库存充足";
}

function suggestedPurchaseQuantity(product: Product, averageDailyOutbound: number, status: ProductRestockStatus) {
  if (status !== "立即补货" && status !== "准备补货") return 0;
  const targetStock = Math.max(product.warningStock * 2, averageDailyOutbound * 30);
  return Math.max(0, Math.ceil(targetStock - product.stock));
}

export function productUsageReport(data: AppData, start: Date, end: Date, now = new Date()): ProductUsageReportRow[] {
  const orders = effectiveOrders(data);
  const linkedServicesByProduct = new Map<string, AppData["services"]>();
  data.services.forEach((service) => {
    serviceConsumables(service).forEach((item) => {
      const linked = linkedServicesByProduct.get(item.productId) ?? [];
      linked.push(service);
      linkedServicesByProduct.set(item.productId, linked);
    });
  });
  const periodUsage = usageFromOrders(orders.filter((order) => isWithin(order.createdAt, start, end)), data);
  const trailingStart = new Date(+now - 30 * 86400000);
  const trailingUsage = usageFromOrders(orders.filter((order) => isWithin(order.createdAt, trailingStart, new Date(+now + 1))), data);
  const periodLosses = new Map<string, number>();
  const trailingLosses = new Map<string, number>();

  data.inventoryLogs.filter((log) => log.type === "报损" && log.delta < 0).forEach((log) => {
    if (isWithin(log.createdAt, start, end)) {
      periodLosses.set(log.productId, roundStockQuantity((periodLosses.get(log.productId) ?? 0) + Math.abs(log.delta)));
    }
    if (isWithin(log.createdAt, trailingStart, new Date(+now + 1))) {
      trailingLosses.set(log.productId, roundStockQuantity((trailingLosses.get(log.productId) ?? 0) + Math.abs(log.delta)));
    }
  });

  const statusOrder: Record<ProductRestockStatus, number> = {
    "待确认扣减规则": 0,
    "立即补货": 1,
    "准备补货": 2,
    "临期关注": 3,
    "需完善扣耗": 4,
    "库存充足": 5,
  };

  return data.products.map((product) => {
    const period = periodUsage.get(product.id) ?? emptyProductUsage();
    const trailing = trailingUsage.get(product.id) ?? emptyProductUsage();
    const linkedServices = linkedServicesByProduct.get(product.id) ?? [];
    const usageTrackingComplete = linkedServices.length === 0 || productServiceStockDeductible(product);
    const lossQuantity = periodLosses.get(product.id) ?? 0;
    const trailingOutbound = trailing.serviceConsumedQuantity + trailing.soldQuantity + trailing.giftedQuantity + (trailingLosses.get(product.id) ?? 0);
    const averageDailyOutbound = roundStockQuantity(trailingOutbound / 30);
    const daysCover = averageDailyOutbound > 0 ? Math.max(0, product.stock / averageDailyOutbound) : undefined;
    const soonExpiringQuantity = expiringQuantity(data, product.id, now);
    const status = restockStatus({
      product,
      averageDailyOutbound,
      daysCover,
      expiringQuantity: soonExpiringQuantity,
      usageTrackingComplete,
      linkedServiceCount: linkedServices.length,
    });
    return {
      productId: product.id,
      name: product.name,
      typeLabel: product.type === "consumable" ? "服务耗材" : "零售/项目产品",
      unit: product.unit || "件",
      linkedServiceNames: linkedServices.map((service) => service.name),
      serviceUseCount: period.serviceUseCount,
      serviceConsumedQuantity: period.serviceConsumedQuantity,
      soldQuantity: period.soldQuantity,
      giftedQuantity: period.giftedQuantity,
      lossQuantity,
      totalOutboundQuantity: roundStockQuantity(period.serviceConsumedQuantity + period.soldQuantity + period.giftedQuantity + lossQuantity),
      currentStock: product.stock,
      warningStock: product.warningStock,
      averageDailyOutbound,
      daysCover: daysCover === undefined ? undefined : Math.round(daysCover * 10) / 10,
      expiringQuantity: soonExpiringQuantity,
      status,
      suggestedPurchaseQuantity: suggestedPurchaseQuantity(product, averageDailyOutbound, status),
      usageTrackingComplete,
    };
  }).sort((left, right) =>
    statusOrder[left.status] - statusOrder[right.status]
    || right.totalOutboundQuantity - left.totalOutboundQuantity
    || left.name.localeCompare(right.name, "zh-CN"),
  );
}
