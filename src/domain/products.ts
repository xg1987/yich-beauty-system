import type { Product } from "./types";

type ProductUsageFields = Pick<Product, "name" | "category" | "subcategory" | "unit" | "serviceStockDeductible" | "serviceUsesPerUnit">;

const untrackedServiceProductKeywords = [
  "精油",
  "身体油",
  "按摩油",
  "精华",
  "精华液",
  "原液",
  "乳",
  "液",
  "水",
  "膏霜",
  "面霜",
  "乳霜",
  "防晒",
  "洁面",
  "喷雾",
  "凝胶",
  "啫喱",
];

export function isUntrackedServiceProduct(product: Pick<ProductUsageFields, "name" | "category" | "subcategory" | "unit">) {
  const text = [product.name, product.category, product.subcategory, product.unit].filter(Boolean).join(" ");
  return untrackedServiceProductKeywords.some((keyword) => text.includes(keyword));
}

export function productServiceStockDeductible(product: ProductUsageFields) {
  if (typeof product.serviceStockDeductible === "boolean") return product.serviceStockDeductible;
  return !isUntrackedServiceProduct(product);
}

export function normalizeProductServiceUsesPerUnit(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

export function productServiceUsesPerUnit(product: ProductUsageFields) {
  return normalizeProductServiceUsesPerUnit(product.serviceUsesPerUnit);
}

export function serviceStockQuantityForProduct(product: ProductUsageFields) {
  if (!productServiceStockDeductible(product)) return 0;
  return roundStockQuantity(1 / productServiceUsesPerUnit(product));
}

export function normalizeProductServiceFields<T extends ProductUsageFields>(product: T): T {
  const serviceStockDeductible = productServiceStockDeductible(product);
  return {
    ...product,
    serviceStockDeductible,
    serviceUsesPerUnit: serviceStockDeductible ? productServiceUsesPerUnit(product) : undefined,
  };
}

export function productServiceDeductionLabel(product: ProductUsageFields) {
  if (!productServiceStockDeductible(product)) return "仅展示";
  return `扣库存 · ${productServiceUsesPerUnit(product)}次/${product.unit || "件"}`;
}

export function roundStockQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function formatStockQuantity(value: number) {
  const rounded = roundStockQuantity(value);
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(3)));
}
