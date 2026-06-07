UPDATE products
SET
  serviceStockDeductible = 1,
  serviceUnit = COALESCE(NULLIF(serviceUnit, ''), unit, '件'),
  serviceUnitsPerStockUnit = COALESCE(serviceUnitsPerStockUnit, serviceUsesPerUnit, 1),
  serviceUsesPerUnit = COALESCE(serviceUsesPerUnit, serviceUnitsPerStockUnit, 1)
WHERE serviceStockDeductible IS NULL OR serviceStockDeductible = 0;
