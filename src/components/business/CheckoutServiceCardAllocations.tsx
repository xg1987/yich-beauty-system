import { Minus, Plus } from "lucide-react";

type CheckoutServiceCardSource = {
  cardId: string;
  cardName: string;
  remainingTimes: number;
  totalTimes?: number;
  sharedPool: boolean;
  maxQuantity: number;
};

type CheckoutServiceCardAllocationsProps = {
  serviceId: string;
  serviceName: string;
  selectedCardIds: string[];
  sources: CheckoutServiceCardSource[];
  onSetQuantity: (serviceId: string, cardId: string, quantity: number) => void;
};

export function CheckoutServiceCardAllocations({
  serviceId,
  serviceName,
  selectedCardIds,
  sources,
  onSetQuantity,
}: CheckoutServiceCardAllocationsProps) {
  return (
    <div className="checkout-service-card-allocation-list" aria-label={`${serviceName} 每卡扣卡次数`}>
      {sources.map((source, index) => {
        const allocatedQuantity = selectedCardIds.filter((selectedCardId) => selectedCardId === source.cardId).length;
        const allocatedElsewhere = Math.max(0, source.remainingTimes - source.maxQuantity);
        const quantityLabel = `${serviceName}-${source.cardName}扣卡次数`;
        return (
          <div className={`checkout-service-card-allocation ${allocatedQuantity > 0 ? "active" : ""}`} key={source.cardId}>
            <div>
              <small>{["第一张", "第二张", "第三张"][index] ?? `第 ${index + 1} 张`}</small>
              <strong>{source.cardName}</strong>
              <span>
                {source.sharedPool && allocatedElsewhere > 0
                  ? `本单可用 ${source.maxQuantity} 次 · 卡余 ${source.remainingTimes} 次 · 其他项目已选 ${allocatedElsewhere} 次`
                  : `可用 ${source.remainingTimes}${source.totalTimes ? `/${source.totalTimes}` : ""} 次${source.sharedPool ? " · 共享次数" : ""}`}
              </span>
            </div>
            <div className="checkout-product-qty checkout-card-allocation-qty" aria-label={quantityLabel}>
              <button type="button" aria-label={`减少${quantityLabel}`} disabled={allocatedQuantity <= 0} onClick={() => onSetQuantity(serviceId, source.cardId, allocatedQuantity - 1)}>
                <Minus size={14} />
              </button>
              <input type="number" inputMode="numeric" min={0} max={source.maxQuantity} aria-label={quantityLabel} value={allocatedQuantity} onChange={(event) => onSetQuantity(serviceId, source.cardId, Number(event.target.value))} />
              <button type="button" aria-label={`增加${quantityLabel}`} disabled={allocatedQuantity >= source.maxQuantity} onClick={() => onSetQuantity(serviceId, source.cardId, allocatedQuantity + 1)}>
                <Plus size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type CheckoutServiceCardSourcesProps = {
  serviceId: string;
  serviceName: string;
  serviceSelected: boolean;
  selectedCardIds: string[];
  sources: CheckoutServiceCardSource[];
  onSelectService: (serviceId: string, cardId?: string) => void;
  onToggleSource: (serviceId: string, cardId: string) => void;
};

export function CheckoutServiceCardSources({
  serviceId,
  serviceName,
  serviceSelected,
  selectedCardIds,
  sources,
  onSelectService,
  onToggleSource,
}: CheckoutServiceCardSourcesProps) {
  return (
    <div className="service-picker-card-sources" aria-label={`${serviceName}扣卡来源`}>
      {sources.map((source, index) => {
        const allocatedQuantity = selectedCardIds.filter((selectedCardId) => selectedCardId === source.cardId).length;
        const sourceSelected = allocatedQuantity > 0;
        const allocatedElsewhere = Math.max(0, source.remainingTimes - source.maxQuantity);
        const sourceUnavailable = !sourceSelected && source.maxQuantity <= 0;
        return (
          <button
            type="button"
            key={source.cardId}
            className={`checkout-card-source-button ${sourceSelected ? "active" : ""}`}
            aria-pressed={sourceSelected}
            disabled={sourceUnavailable}
            onClick={() => serviceSelected
              ? onToggleSource(serviceId, source.cardId)
              : onSelectService(serviceId, source.cardId)}
          >
            <small>{["第一张", "第二张", "第三张"][index] ?? `第 ${index + 1} 张`}{sourceSelected ? " · 已选" : index === 0 ? " · 默认" : " · 可多选"}</small>
            <strong>{source.cardName}</strong>
            <span>
              {source.sharedPool && allocatedElsewhere > 0
                ? `卡余 ${source.remainingTimes} 次 · 其他项目已选 ${allocatedElsewhere} 次 · 本项目可选 ${source.maxQuantity} 次`
                : `剩 ${source.remainingTimes}${source.totalTimes ? `/${source.totalTimes}` : ""} 次${sourceSelected ? ` · 本单扣 ${allocatedQuantity} 次` : ""}${source.sharedPool ? " · 共享次数" : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
