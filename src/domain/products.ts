import type { Product } from "./types";

type ProductUsageFields = Pick<
  Product,
  "name" | "category" | "subcategory" | "unit" | "serviceStockDeductible" | "serviceStockReviewStatus" | "serviceUsesPerUnit" | "serviceUnitsPerStockUnit" | "serviceUnit"
>;

export function productServiceStockDeductible(product: ProductUsageFields) {
  if (productServiceStockReviewStatus(product) !== "confirmed") return legacyProductServiceStockDeductible(product);
  return product.serviceStockDeductible === true;
}

function legacyProductServiceStockDeductible(product: Pick<ProductUsageFields, "name" | "category" | "subcategory" | "unit">) {
  const text = [product.name, product.category, product.subcategory, product.unit].filter(Boolean).join(" ");
  return !/(精华|精油|按摩油|身体油|爽肤水|化妆水|乳液|喷雾|液|油)/.test(text);
}

export function productServiceStockReviewStatus(product: ProductUsageFields) {
  return product.serviceStockReviewStatus ?? "pending";
}

export function normalizeProductServiceUnitsPerStockUnit(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

export function requireConfirmedProductStockRule(input: {
  serviceStockDeductible?: boolean;
  serviceUnit?: string;
  serviceUnitsPerStockUnit?: number;
}) {
  if (input.serviceStockDeductible === undefined) {
    throw new Error("请根据商品真实用途选择“扣库存”或“不扣库存”");
  }
  if (!input.serviceStockDeductible) {
    return { serviceStockDeductible: false as const, serviceUnit: undefined, serviceUnitsPerStockUnit: undefined };
  }
  const serviceUnit = input.serviceUnit?.trim();
  if (!serviceUnit) throw new Error("扣库存商品必须填写扣减单位");
  if (typeof input.serviceUnitsPerStockUnit !== "number" || !Number.isFinite(input.serviceUnitsPerStockUnit) || input.serviceUnitsPerStockUnit <= 0) {
    throw new Error("扣库存商品必须填写正确的每件数量");
  }
  return {
    serviceStockDeductible: true as const,
    serviceUnit,
    serviceUnitsPerStockUnit: normalizeProductServiceUnitsPerStockUnit(input.serviceUnitsPerStockUnit),
  };
}

export function inferProductServiceUnit(product: Pick<ProductUsageFields, "name" | "category" | "subcategory" | "unit">) {
  const text = [product.name, product.category, product.subcategory, product.unit].filter(Boolean).join(" ");
  if (/(面膜|软膜|眼膜|贴)/.test(text)) return "片";
  if (text.includes("次抛")) return "支";
  if (/(泥灸|艾灸|泡脚汤)/.test(text)) return "份";
  if (/(护理包|套盒)/.test(text)) return "套";
  return product.unit || "件";
}

export function productServiceUnit(product: ProductUsageFields) {
  const unit = product.serviceUnit?.trim();
  return unit || inferProductServiceUnit(product);
}

function inferredServiceUnitsPerStockUnit(product: ProductUsageFields) {
  const text = [product.name, product.category, product.subcategory, product.unit].filter(Boolean).join(" ");
  if (/(面膜|软膜|眼膜)/.test(text)) return 10;
  return 1;
}

export function productServiceUnitsPerStockUnit(product: ProductUsageFields) {
  return normalizeProductServiceUnitsPerStockUnit(
    product.serviceUnitsPerStockUnit ?? product.serviceUsesPerUnit ?? inferredServiceUnitsPerStockUnit(product),
  );
}

export function serviceStockQuantityForProduct(product: ProductUsageFields, serviceUnits: number) {
  if (!productServiceStockDeductible(product) || serviceUnits <= 0) return 0;
  return roundStockQuantity(serviceUnits / productServiceUnitsPerStockUnit(product));
}

export function normalizeProductServiceFields<T extends ProductUsageFields>(product: T): T {
  const serviceStockDeductible = productServiceStockDeductible(product);
  return {
    ...product,
    serviceStockDeductible,
    serviceUnit: serviceStockDeductible ? productServiceUnit(product) : undefined,
    serviceUnitsPerStockUnit: serviceStockDeductible ? productServiceUnitsPerStockUnit(product) : undefined,
    serviceUsesPerUnit: product.serviceUsesPerUnit,
  };
}

export function productServiceDeductionLabel(product: ProductUsageFields) {
  if (product.serviceStockReviewStatus === "pending") return `待确认 · 沿用原规则${productServiceStockDeductible(product) ? "扣库存" : "不扣库存"}`;
  if (!productServiceStockDeductible(product)) return "不扣库存";
  return `扣库存 · ${productServiceUnitsPerStockUnit(product)}${productServiceUnit(product)}/${product.unit || "件"}`;
}

export function formatProductStockWithServiceUnits(product: ProductUsageFields, stock: number) {
  const stockText = `${formatStockQuantity(stock)}${product.unit || "件"}`;
  if (!productServiceStockDeductible(product)) return stockText;
  const unitsPerStockUnit = productServiceUnitsPerStockUnit(product);
  if (unitsPerStockUnit <= 1) return stockText;
  const wholeStockUnits = Math.trunc(Math.max(0, stock));
  const remainingUnits = roundStockQuantity((Math.max(0, stock) - wholeStockUnits) * unitsPerStockUnit);
  if (remainingUnits <= 0) return `${wholeStockUnits}${product.unit || "件"}`;
  if (wholeStockUnits <= 0) return `${formatStockQuantity(remainingUnits)}${productServiceUnit(product)}`;
  return `${wholeStockUnits}${product.unit || "件"}${formatStockQuantity(remainingUnits)}${productServiceUnit(product)}`;
}

export function roundStockQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function formatStockQuantity(value: number) {
  const rounded = roundStockQuantity(value);
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(3)));
}

export const normalizeProductServiceUsesPerUnit = normalizeProductServiceUnitsPerStockUnit;
export const productServiceUsesPerUnit = productServiceUnitsPerStockUnit;
