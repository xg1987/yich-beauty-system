import {
  formatStockQuantity,
  productServiceDeductionLabel,
  productServiceStockDeductible,
  productServiceUnit,
  serviceStockQuantityForProduct,
} from "../domain/products";
import { normalizeMemberCardServiceEntitlements } from "../domain/business";
import type { AppData, Product, Service, ServiceConsumable } from "../domain/types";
import { money } from "../domain/utils";

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
    if (product && !productServiceStockDeductible(product)) return;
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
  if (!productServiceStockDeductible(product)) return "不计项目";
  if (item.quantity <= 0) return `待填用量 · ${productServicePackageText(product)}`;
  return `每次${formatStockQuantity(item.quantity)}${productServiceUnit(product)} · 折${formatStockQuantity(serviceStockQuantityForProduct(product, item.quantity))}${product.unit}`;
}

export function serviceFormulaSummary(service: Service, products: Product[]) {
  const consumables = serviceConsumablesOf(service).filter((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? productServiceStockDeductible(product) : false;
  });
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
