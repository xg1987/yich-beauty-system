import { Minus, Plus } from "lucide-react";

type CheckoutServiceCardSource = {
  cardId: string;
  cardName: string;
  remainingTimes: number;
  totalTimes?: number;
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
        const quantityLabel = `${serviceName}-${source.cardName}扣卡次数`;
        return (
          <div className={`checkout-service-card-allocation ${allocatedQuantity > 0 ? "active" : ""}`} key={source.cardId}>
            <div>
              <small>{["第一张", "第二张", "第三张"][index] ?? `第 ${index + 1} 张`}</small>
              <strong>{source.cardName}</strong>
              <span>可用 {source.remainingTimes}{source.totalTimes ? `/${source.totalTimes}` : ""} 次</span>
            </div>
            <div className="checkout-product-qty checkout-card-allocation-qty" aria-label={quantityLabel}>
              <button type="button" aria-label={`减少${quantityLabel}`} disabled={allocatedQuantity <= 0} onClick={() => onSetQuantity(serviceId, source.cardId, allocatedQuantity - 1)}>
                <Minus size={14} />
              </button>
              <input type="number" inputMode="numeric" min={0} max={source.remainingTimes} aria-label={quantityLabel} value={allocatedQuantity} onChange={(event) => onSetQuantity(serviceId, source.cardId, Number(event.target.value))} />
              <button type="button" aria-label={`增加${quantityLabel}`} disabled={allocatedQuantity >= source.remainingTimes} onClick={() => onSetQuantity(serviceId, source.cardId, allocatedQuantity + 1)}>
                <Plus size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
