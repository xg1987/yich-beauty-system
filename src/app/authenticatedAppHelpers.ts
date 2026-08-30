import {
  formatStockQuantity,
  productServiceDeductionLabel,
  productServiceStockDeductible,
  productServiceStockReviewStatus,
  productServiceUnit,
  serviceStockQuantityForProduct,
} from "../domain/products";
import { normalizeMemberCardServiceEntitlements } from "../domain/business";
import { appointmentTimeRangeIssue, MAX_APPOINTMENT_DURATION_MINUTES, shiftedAppointmentEndAt } from "../domain/appointments";
import type { AppData, Product, Service, ServiceConsumable } from "../domain/types";
import { money, shortDate, toLocalInputValue } from "../domain/utils";

export const INVENTORY_CATEGORY_PRESETS: Record<string, string[]> = {
  面护类: ["洁面", "膏霜", "面膜", "精华", "精油", "防晒", "软膜", "眼护", "套盒", "口服", "次抛", "小样"],
  养生类: ["泥灸", "私密", "套盒", "膏霜", "身体油", "泡脚汤", "艾灸"],
};

function inventoryCategoryMap(products: Product[], presets: Record<string, string[]> = INVENTORY_CATEGORY_PRESETS) {
  const map = new Map<string, Set<string>>();
  const addCategory = (category: string) => {
    const name = category.trim();
    if (!name) return undefined;
    if (!map.has(name)) map.set(name, new Set());
    return map.get(name);
  };
  Object.entries(presets).forEach(([category, subcategories]) => {
    const bucket = addCategory(category);
    subcategories.forEach((subcategory) => {
      const name = subcategory.trim();
      if (name) bucket?.add(name);
    });
  });
  products.forEach((product) => {
    const bucket = addCategory(product.category ?? "面护类");
    const subcategory = product.subcategory?.trim();
    if (subcategory) bucket?.add(subcategory);
  });
  return map;
}

export function inventoryCategoryNames(products: Product[], presets?: Record<string, string[]>) {
  return Array.from(inventoryCategoryMap(products, presets).keys());
}

export function inventorySubcategoryNames(products: Product[], category: string, presets?: Record<string, string[]>) {
  const map = inventoryCategoryMap(products, presets);
  if (category === "全部") return Array.from(new Set(Array.from(map.values()).flatMap((items) => Array.from(items))));
  return Array.from(map.get(category) ?? []);
}

export function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addMonthsInputValue(months: number, baseDate = new Date()) {
  if (!Number.isFinite(months) || months <= 0) return "";
  const date = new Date(baseDate);
  date.setMonth(date.getMonth() + Math.round(months));
  return dateInputValue(date);
}

export function shiftedAppointmentEndInputValue(previousStartAt: string, previousEndAt: string, nextStartAt: string) {
  return toLocalInputValue(shiftedAppointmentEndAt(previousStartAt, previousEndAt, nextStartAt).toISOString());
}

export function appointmentTimeRangeWarning(startAt: Date, endAt: Date, action = "预约") {
  const issue = appointmentTimeRangeIssue(startAt, endAt);
  if (issue === "invalid" || issue === "end-not-after-start") return `${action}结束时间必须晚于开始时间。`;
  if (issue === "cross-day") return `${action}开始和结束时间必须在同一天，请重新选择。`;
  if (issue === "too-long") return `单次${action}不能超过${MAX_APPOINTMENT_DURATION_MINUTES / 60}小时，请重新选择。`;
  return "";
}

export function productExpiryText(product: Product) {
  if (!product.expiryAt) return "未设置";
  return /^\d{4}-\d{2}-\d{2}$/.test(product.expiryAt) ? product.expiryAt.replace(/-/g, "/") : shortDate(product.expiryAt);
}

export function productShelfLifeText(product: Product) {
  return product.shelfLifeMonths ? `${product.shelfLifeMonths}个月` : "未设置";
}

export function productExpiryDaysText(product: Product) {
  if (!product.expiryAt) return "-";
  const today = new Date(`${dateInputValue()}T00:00:00`).getTime();
  const expiry = new Date(`${product.expiryAt}T00:00:00`).getTime();
  if (Number.isNaN(expiry)) return "-";
  const daysLeft = Math.ceil((expiry - today) / 86400000);
  if (daysLeft < 0) return `已过期${Math.abs(daysLeft)}天`;
  return `${daysLeft}天`;
}

export function productExpiryStatus(product: Product) {
  if (!product.expiryAt) return undefined;
  const today = new Date(`${dateInputValue()}T00:00:00`).getTime();
  const expiry = new Date(`${product.expiryAt}T00:00:00`).getTime();
  if (Number.isNaN(expiry)) return undefined;
  const daysLeft = Math.ceil((expiry - today) / 86400000);
  if (daysLeft < 0) return { text: "已过期", tone: "warn" as const };
  if (daysLeft <= 30) return { text: "临期", tone: "warn" as const };
  return undefined;
}

export function productServicePackageText(product: Product) {
  return productServiceDeductionLabel(product).replace("扣库存 · ", "");
}

export function normalizeProductName(value: string) {
  return value.trim().toLowerCase();
}

export function findCreatedProduct(products: Product[], name: string, category: string, subcategory: string) {
  const normalizedName = normalizeProductName(name);
  return products.find((product) =>
    normalizeProductName(product.name) === normalizedName
    && (product.category ?? "面护类") === category
    && (product.subcategory ?? "") === subcategory,
  ) ?? products.find((product) => normalizeProductName(product.name) === normalizedName);
}

export function serviceConsumablesOf(service?: Service): ServiceConsumable[] {
  const consumables = service?.consumables?.filter((item) => item.productId) ?? [];
  if (consumables.length > 0) return consumables;
  if (service?.consumableProductId) {
    return [{ productId: service.consumableProductId, quantity: service.consumableQty ?? 0 }];
  }
  return [];
}

export function mergeUsedProducts(consumables: ServiceConsumable[], products?: Product[]) {
  const merged: ServiceConsumable[] = [];
  const seen = new Set<string>();
  consumables.forEach((item) => {
    if (!item.productId || seen.has(item.productId)) return;
    const product = products?.find((candidate) => candidate.id === item.productId);
    if (products && !product) return;
    seen.add(item.productId);
    merged.push({ productId: item.productId, quantity: Math.max(0, roundDisplayQuantity(item.quantity)) });
  });
  return merged;
}

function roundDisplayQuantity(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
}

export function serviceConsumableDisplay(item: ServiceConsumable, products: Product[]) {
  return nameOf(products, item.productId);
}

export function serviceConsumableModeText(item: ServiceConsumable, products: Product[]) {
  const product = products.find((candidate) => candidate.id === item.productId);
  if (!product) return "未配置";
  if (productServiceStockReviewStatus(product) !== "confirmed") return "待确认 · 暂不扣库存";
  if (!productServiceStockDeductible(product)) return "不扣库存";
  if (item.quantity <= 0) return `待填用量 · ${productServicePackageText(product)}`;
  return `每次${formatStockQuantity(item.quantity)}${productServiceUnit(product)} · 折${formatStockQuantity(serviceStockQuantityForProduct(product, item.quantity))}${product.unit}`;
}

export function serviceFormulaSummary(service: Service, products: Product[]) {
  const consumables = serviceConsumablesOf(service).filter((item) => products.some((product) => product.id === item.productId));
  if (consumables.length === 0) return "未配置";
  return consumables.map((item) => `${serviceConsumableDisplay(item, products)}（${serviceConsumableModeText(item, products)}）`).join(" / ");
}

export function optionOf(item: { id: string; name: string }) {
  return { value: item.id, label: item.name };
}

export function numberFromInput(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumberFromInput(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function memberCardProjectScopeText(card: AppData["memberCards"][number], services: AppData["services"]) {
  if (card.serviceEntitlements?.length) {
    return normalizeMemberCardServiceEntitlements(card.serviceEntitlements).map((item) => nameOf(services, item.serviceId)).join(" / ");
  }
  if (card.serviceIds?.length) return card.serviceIds.map((id) => nameOf(services, id)).join(" / ");
  return card.serviceId ? nameOf(services, card.serviceId) : "通用";
}

export function memberCardPurchasedServiceIds(card: AppData["memberCards"][number]) {
  if (card.serviceEntitlements?.length) return normalizeMemberCardServiceEntitlements(card.serviceEntitlements).map((item) => item.serviceId).filter(Boolean);
  if (card.serviceIds?.length) return Array.from(new Set(card.serviceIds.filter(Boolean)));
  return card.serviceId ? [card.serviceId] : [];
}

export function memberCardAvailableServiceIds(card: AppData["memberCards"][number]) {
  if (card.serviceEntitlements?.length) {
    return normalizeMemberCardServiceEntitlements(card.serviceEntitlements)
      .filter((item) => item.remainingTimes > 0)
      .map((item) => item.serviceId)
      .filter(Boolean);
  }
  return card.remainingTimes > 0 ? memberCardPurchasedServiceIds(card) : [];
}

export function memberCardAvailableProjectScopeText(card: AppData["memberCards"][number], services: AppData["services"]) {
  const serviceIds = memberCardAvailableServiceIds(card);
  return serviceIds.length ? serviceIds.map((id) => nameOf(services, id)).join(" / ") : "暂无可用项目";
}

export function memberCardHasAvailableValue(card: AppData["memberCards"][number]) {
  if (card.status !== "正常") return false;
  if (card.type === "储值卡") return card.balance > 0;
  if (card.type === "折扣卡") return true;
  return memberCardAvailableServiceIds(card).length > 0;
}

export function memberCardDisplayStatus(card: AppData["memberCards"][number]) {
  return card.status === "正常" && !memberCardHasAvailableValue(card) ? "已用完" : card.status;
}

export function memberCardIsArchived(card: AppData["memberCards"][number]) {
  const displayStatus = memberCardDisplayStatus(card);
  return displayStatus === "已用完"
    || displayStatus === "已退卡"
    || displayStatus === "已作废"
    || displayStatus === "过期";
}

export function memberCardTimesText(
  card: AppData["memberCards"][number],
  services: AppData["services"],
  focusedServiceId?: string,
  options: { hideZeroEntitlements?: boolean; emptyText?: string } = {},
) {
  if (card.type === "储值卡") return money(card.balance);
  if (card.serviceEntitlements?.length) {
    const normalizedEntitlements = normalizeMemberCardServiceEntitlements(card.serviceEntitlements);
    const entitlements = focusedServiceId
      ? normalizedEntitlements.filter((item) => item.serviceId === focusedServiceId)
      : normalizedEntitlements;
    if (entitlements.length === 0 && focusedServiceId) return `${nameOf(services, focusedServiceId)} 0次`;
    const visibleEntitlements = options.hideZeroEntitlements
      ? entitlements.filter((item) => item.remainingTimes > 0)
      : entitlements;
    if (visibleEntitlements.length === 0) return options.emptyText ?? "0次";
    return visibleEntitlements.map((item) => `${nameOf(services, item.serviceId)} ${item.remainingTimes}/${item.totalTimes}次`).join("；");
  }
  if (focusedServiceId) return `${nameOf(services, focusedServiceId)} ${card.remainingTimes}次`;
  return `${memberCardProjectScopeText(card, services)} ${card.remainingTimes}次`;
}

export function memberCardAvailableTimesText(card: AppData["memberCards"][number], services: AppData["services"]) {
  return memberCardTimesText(card, services, undefined, { hideZeroEntitlements: true, emptyText: "暂无可用次数" });
}

export type MemberCardServiceAvailabilitySource = {
  cardId: string;
  cardName: string;
  remainingTimes: number;
  totalTimes?: number;
  sharedPool: boolean;
};

export type MemberCardServiceAvailability = {
  serviceId: string;
  serviceName: string;
  remainingTimes: number;
  cardCount: number;
  sources: MemberCardServiceAvailabilitySource[];
};

export type CheckoutServiceCardAllocationRow = {
  serviceId: string;
  quantity: number;
  sources: MemberCardServiceAvailabilitySource[];
};

function checkoutServiceCardPoolKey(serviceId: string, source: MemberCardServiceAvailabilitySource) {
  return source.sharedPool ? source.cardId : `${serviceId}:${source.cardId}`;
}

export function resolveCheckoutServiceCardIdsByServiceId(
  rows: CheckoutServiceCardAllocationRow[],
  savedCardIdsByServiceId: Record<string, string[]>,
) {
  const allocatedByPoolKey = new Map<string, number>();
  const resolved = new Map<string, string[]>();

  rows.forEach(({ serviceId, quantity, sources }) => {
    const targetQuantity = Math.max(0, Math.floor(quantity));
    const sourceByCardId = new Map(sources.map((source) => [source.cardId, source]));
    const selectedCardIds: string[] = [];
    const tryAllocate = (cardId: string) => {
      if (selectedCardIds.length >= targetQuantity) return;
      const source = sourceByCardId.get(cardId);
      if (!source) return;
      const poolKey = checkoutServiceCardPoolKey(serviceId, source);
      const allocated = allocatedByPoolKey.get(poolKey) ?? 0;
      if (allocated >= source.remainingTimes) return;
      allocatedByPoolKey.set(poolKey, allocated + 1);
      selectedCardIds.push(cardId);
    };

    (savedCardIdsByServiceId[serviceId] ?? [])
      .slice(0, targetQuantity)
      .forEach(tryAllocate);
    while (selectedCardIds.length < targetQuantity) {
      const source = sources.find((candidate) => {
        const poolKey = checkoutServiceCardPoolKey(serviceId, candidate);
        return (allocatedByPoolKey.get(poolKey) ?? 0) < candidate.remainingTimes;
      });
      if (!source) break;
      tryAllocate(source.cardId);
    }
    resolved.set(serviceId, selectedCardIds);
  });

  return resolved;
}

export function checkoutServiceCardMaxQuantity(
  serviceId: string,
  source: MemberCardServiceAvailabilitySource,
  selectedCardIdsByServiceId: Map<string, string[]>,
) {
  if (!source.sharedPool) return source.remainingTimes;
  const allocatedByOtherServices = Array.from(selectedCardIdsByServiceId).reduce((sum, [candidateServiceId, cardIds]) => (
    candidateServiceId === serviceId
      ? sum
      : sum + cardIds.filter((cardId) => cardId === source.cardId).length
  ), 0);
  return Math.max(0, source.remainingTimes - allocatedByOtherServices);
}

export function aggregateMemberCardServiceAvailability(
  cards: AppData["memberCards"],
  services: AppData["services"],
): MemberCardServiceAvailability[] {
  const rows = new Map<string, MemberCardServiceAvailability>();
  const addSource = (serviceId: string, source: MemberCardServiceAvailabilitySource) => {
    const serviceName = serviceId ? nameOf(services, serviceId) : "通用项目";
    const current = rows.get(serviceId);
    if (current) {
      current.remainingTimes += source.remainingTimes;
      current.sources.push(source);
      current.cardCount = new Set(current.sources.map((item) => item.cardId)).size;
      return;
    }
    rows.set(serviceId, {
      serviceId,
      serviceName,
      remainingTimes: source.remainingTimes,
      cardCount: 1,
      sources: [source],
    });
  };

  cards
    .filter((card) => card.status === "正常" && card.type !== "储值卡" && card.type !== "折扣卡")
    .forEach((card) => {
      if (card.serviceEntitlements?.length) {
        normalizeMemberCardServiceEntitlements(card.serviceEntitlements)
          .filter((entitlement) => entitlement.serviceId && entitlement.remainingTimes > 0)
          .forEach((entitlement) => addSource(entitlement.serviceId, {
            cardId: card.id,
            cardName: card.name,
            remainingTimes: entitlement.remainingTimes,
            totalTimes: entitlement.totalTimes,
            sharedPool: false,
          }));
        return;
      }
      const serviceIds = Array.from(new Set(memberCardPurchasedServiceIds(card)));
      const sourceIds = serviceIds.length ? serviceIds : [""];
      sourceIds.forEach((serviceId) => addSource(serviceId, {
        cardId: card.id,
        cardName: card.name,
        remainingTimes: Math.max(0, card.remainingTimes),
        sharedPool: sourceIds.length > 1 || serviceId === "",
      }));
    });

  return Array.from(rows.values()).sort((left, right) =>
    right.remainingTimes - left.remainingTimes || left.serviceName.localeCompare(right.serviceName, "zh-CN"),
  );
}

export function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}

export function parseTags(value: string) {
  return Array.from(new Set(value.split(/[,，、/\s]+/).map((item) => item.trim()).filter(Boolean)));
}

export function replaceRepeatedId(values: string[], targetId: string, quantity: number) {
  const replacement = Array.from({ length: Math.max(0, Math.floor(quantity)) }, () => targetId);
  let inserted = false;
  const next: string[] = [];
  values.forEach((value) => {
    if (value !== targetId) next.push(value);
    else if (!inserted) {
      next.push(...replacement);
      inserted = true;
    }
  });
  if (!inserted) next.push(...replacement);
  return next;
}
