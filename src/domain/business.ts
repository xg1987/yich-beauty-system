import type {
  AppData,
  DailyClose,
  InventoryLog,
  MemberCardTransaction,
  OperationLog,
  Order,
  Refund,
  StaffUnavailableSlot,
} from "./types";
import { makeId, nowIso } from "./utils";

type IdFactory = (prefix: string) => string;

export type CheckoutInput = {
  customerId: string;
  staffId: string;
  collaboratorStaffIds?: string[];
  serviceId: string;
  productId?: string;
  payMethod: Order["payMethod"];
  cardId?: string;
};

export type InventoryAdjustmentInput = {
  productId: string;
  type: InventoryLog["type"];
  quantity: number;
  note?: string;
};

export type RefundInput = {
  orderId: string;
  reason: string;
  userId: string;
  amount?: number;
};

export type RefundMemberCardInput = {
  memberCardId: string;
  reason: string;
  userId: string;
};

export type OperationLogInput = {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
};

export type AppointmentInput = {
  customerId: string;
  staffId: string;
  serviceId: string;
  startAt: string;
  note?: string;
};

export type DailyCloseInput = {
  businessDate: string;
  userId: string;
};

export type StaffUnavailableSlotInput = {
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
  userId: string;
};

export function calculateOrderTotal(data: AppData, serviceId: string, productId?: string) {
  const selectedService = data.services.find((item) => item.id === serviceId);
  const selectedProduct = data.products.find((item) => item.id === productId);
  return (selectedService?.price ?? 0) + (selectedProduct?.price ?? 0);
}

export function checkoutOrder(
  data: AppData,
  input: CheckoutInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const selectedService = data.services.find((item) => item.id === input.serviceId);

  if (!selectedService) {
    throw new Error("服务项目不存在");
  }

  if (input.payMethod === "会员卡") {
    const selectedCard = data.memberCards.find((item) => item.id === input.cardId && item.customerId === input.customerId);
    if (!selectedCard || selectedCard.status !== "正常") {
      throw new Error("请选择有效会员卡");
    }
    if (selectedCard.type === "储值卡" && selectedCard.balance < calculateOrderTotal(data, input.serviceId, input.productId)) {
      throw new Error("会员卡余额不足");
    }
    if (selectedCard.type !== "储值卡" && selectedCard.remainingTimes <= 0) {
      throw new Error("会员卡次数不足");
    }
    if (selectedCard.type !== "储值卡" && selectedCard.serviceId && selectedCard.serviceId !== input.serviceId) {
      throw new Error("该次数卡不可用于当前项目");
    }
  }

  const total = calculateOrderTotal(data, input.serviceId, input.productId);
  const orderId = idFactory("o");
  const createdAt = currentTime();
  const order: Order = {
    id: orderId,
    orderNo: `SO${Date.now().toString().slice(-8)}`,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    productId: input.productId,
    cardId: input.payMethod === "会员卡" ? input.cardId : undefined,
    totalAmount: total,
    paidAmount: total,
    payMethod: input.payMethod,
    status: "已支付",
    createdAt,
  };

  const products = data.products.map((product) => {
    let delta = 0;
    if (product.id === selectedService.consumableProductId) delta -= selectedService.consumableQty ?? 0;
    if (product.id === input.productId) delta -= 1;
    return delta ? { ...product, stock: Math.max(0, product.stock + delta) } : product;
  });

  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];
  const changedProducts = products.filter((product) => data.products.find((old) => old.id === product.id)?.stock !== product.stock);
  changedProducts.forEach((product) => {
    const previousProduct = data.products.find((item) => item.id === product.id);
    if (!previousProduct) return;
    inventoryLogs.unshift({
      id: idFactory("il"),
      productId: product.id,
      type: product.id === input.productId ? "销售出库" : "服务消耗",
      delta: product.stock - previousProduct.stock,
      stockAfter: product.stock,
      note: order.orderNo,
      createdAt,
    });
  });

  const memberCards = data.memberCards.map((card) => {
    if (input.payMethod !== "会员卡" || card.id !== input.cardId) return card;
    if (card.type === "储值卡") return { ...card, balance: Math.max(0, card.balance - total) };
    return { ...card, remainingTimes: Math.max(0, card.remainingTimes - 1) };
  });

  const selectedCardAfterCheckout = memberCards.find((card) => card.id === input.cardId);
  const memberCardTransactions: MemberCardTransaction[] =
    input.payMethod === "会员卡" && selectedCardAfterCheckout
      ? [
          {
            id: idFactory("mt"),
            memberCardId: selectedCardAfterCheckout.id,
            orderId,
            type: "消费",
            amountDelta: selectedCardAfterCheckout.type === "储值卡" ? -total : 0,
            timesDelta: selectedCardAfterCheckout.type === "储值卡" ? 0 : -1,
            balanceAfter: selectedCardAfterCheckout.balance,
            remainingTimesAfter: selectedCardAfterCheckout.remainingTimes,
            note: order.orderNo,
            createdAt,
          },
          ...data.memberCardTransactions,
        ]
      : data.memberCardTransactions;

  const commissionTotal = Math.round(total * 0.12);
  const commissionStaffIds = uniqueIds([input.staffId, ...(input.collaboratorStaffIds ?? [])]);
  const commissionAmounts = splitAmount(commissionTotal, commissionStaffIds.length);

  return {
    ...data,
    products,
    memberCards,
    inventoryLogs,
    orders: [order, ...data.orders],
    memberCardTransactions,
    customers: data.customers.map((customer) => (customer.id === input.customerId ? { ...customer, lastVisit: createdAt } : customer)),
    commissions: [
      ...commissionStaffIds.map((staffId, index) => ({
        id: idFactory("cm"),
        staffId,
        orderId,
        type: "服务提成" as const,
        baseAmount: Math.round(total / commissionStaffIds.length),
        amount: commissionAmounts[index],
        status: "待结算" as const,
        createdAt,
      })),
      ...data.commissions,
    ],
  };
}

export function refundOrder(
  data: AppData,
  input: RefundInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const order = data.orders.find((item) => item.id === input.orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.status === "已退款") {
    throw new Error("订单已退款");
  }

  const refundAmount = input.amount ?? order.paidAmount;
  if (refundAmount <= 0 || refundAmount > order.paidAmount) {
    throw new Error("退款金额无效");
  }

  const isFullRefund = refundAmount === order.paidAmount;

  const service = data.services.find((item) => item.id === order.serviceId);
  const refund: Refund = {
    id: idFactory("rf"),
    orderId: order.id,
    amount: refundAmount,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };

  let products = data.products;
  const inventoryLogs: InventoryLog[] = [...data.inventoryLogs];

  const restoreProduct = (productId: string | undefined, quantity: number) => {
    if (!productId || quantity <= 0) return;
    products = products.map((product) => {
      if (product.id !== productId) return product;
      const stockAfter = product.stock + quantity;
      inventoryLogs.unshift({
        id: idFactory("il"),
        productId,
        type: "退款回滚",
        delta: quantity,
        stockAfter,
        note: order.orderNo,
        createdAt,
      });
      return { ...product, stock: stockAfter };
    });
  };

  if (isFullRefund) {
    restoreProduct(service?.consumableProductId, service?.consumableQty ?? 0);
    restoreProduct(order.productId, order.productId ? 1 : 0);
  }

  let memberCards = data.memberCards;
  let memberCardTransactions = data.memberCardTransactions;
  if (order.payMethod === "会员卡" && order.cardId) {
    memberCards = data.memberCards.map((card) => {
      if (card.id !== order.cardId) return card;
      if (card.type !== "储值卡" && !isFullRefund) {
        throw new Error("次数卡订单只支持全额退款");
      }
      const nextCard =
        card.type === "储值卡"
          ? { ...card, balance: card.balance + refundAmount }
          : { ...card, remainingTimes: card.remainingTimes + 1 };

      memberCardTransactions = [
        {
          id: idFactory("mt"),
          memberCardId: card.id,
          orderId: order.id,
          type: "退款",
          amountDelta: card.type === "储值卡" ? refundAmount : 0,
          timesDelta: card.type === "储值卡" ? 0 : 1,
          balanceAfter: nextCard.balance,
          remainingTimesAfter: nextCard.remainingTimes,
          note: `${order.orderNo} 退款`,
          createdAt,
        },
        ...memberCardTransactions,
      ];
      return nextCard;
    });
  }

  return {
    ...data,
    products,
    memberCards,
    memberCardTransactions,
    inventoryLogs,
    refunds: [refund, ...data.refunds],
    orders: data.orders.map((item) =>
      item.id === order.id
        ? {
            ...item,
            paidAmount: item.paidAmount - refundAmount,
            status: isFullRefund ? "已退款" : "部分退款",
          }
        : item,
    ),
    commissions: data.commissions.map((item) =>
      item.orderId === order.id
        ? {
            ...item,
            amount: isFullRefund ? item.amount : Math.round(item.amount * ((order.paidAmount - refundAmount) / order.paidAmount)),
            status: isFullRefund ? "已冲销" : item.status,
          }
        : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "订单退款",
        targetType: "order",
        targetId: order.id,
        summary: `${order.orderNo} ${isFullRefund ? "全额退款" : "部分退款"} ${refund.amount} 元：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function refundMemberCard(
  data: AppData,
  input: RefundMemberCardInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);

  if (!card) {
    throw new Error("会员卡不存在");
  }

  if (card.status === "已退卡") {
    throw new Error("会员卡已退卡");
  }

  const amountDelta = -card.balance;
  const timesDelta = -card.remainingTimes;

  return {
    ...data,
    memberCards: data.memberCards.map((item) =>
      item.id === card.id ? { ...item, balance: 0, remainingTimes: 0, status: "已退卡" } : item,
    ),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "退卡",
        amountDelta,
        timesDelta,
        balanceAfter: 0,
        remainingTimesAfter: 0,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "会员退卡",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 退卡：余额 ${card.balance}，次数 ${card.remainingTimes}，原因：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function addOperationLog(
  data: AppData,
  input: OperationLogInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const operationLog: OperationLog = {
    id: idFactory("op"),
    userId: input.userId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    createdAt: currentTime(),
  };

  return {
    ...data,
    operationLogs: [operationLog, ...data.operationLogs],
  };
}

export function createAppointment(
  data: AppData,
  input: AppointmentInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const selectedService = data.services.find((item) => item.id === input.serviceId);

  if (!selectedService) {
    throw new Error("服务项目不存在");
  }

  const startAt = new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + selectedService.duration * 60 * 1000);

  const hasAppointmentConflict = data.appointments.some((appointment) => {
    if (appointment.staffId !== input.staffId) return false;
    if (["已取消", "爽约"].includes(appointment.status)) return false;
    const service = data.services.find((item) => item.id === appointment.serviceId);
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + (service?.duration ?? 60) * 60 * 1000);
    return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
  });

  if (hasAppointmentConflict) {
    throw new Error("该员工在此时间段已有预约");
  }

  const hasUnavailableConflict = data.staffUnavailableSlots.some((slot) => {
    if (slot.staffId !== input.staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt));
  });

  if (hasUnavailableConflict) {
    throw new Error("该员工在此时间段不可预约");
  }

  return {
    ...data,
    appointments: [
      {
        id: idFactory("a"),
        customerId: input.customerId,
        staffId: input.staffId,
        serviceId: input.serviceId,
        startAt: input.startAt,
        status: "待确认",
        note: input.note ?? "",
      },
      ...data.appointments,
    ],
  };
}

export function createStaffUnavailableSlot(
  data: AppData,
  input: StaffUnavailableSlotInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);

  if (!data.staff.some((staff) => staff.id === input.staffId)) {
    throw new Error("员工不存在");
  }

  if (!(startAt < endAt)) {
    throw new Error("不可预约结束时间必须晚于开始时间");
  }

  const hasAppointmentConflict = data.appointments.some((appointment) => {
    if (appointment.staffId !== input.staffId) return false;
    if (["已取消", "爽约"].includes(appointment.status)) return false;
    const service = data.services.find((item) => item.id === appointment.serviceId);
    const appointmentStart = new Date(appointment.startAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + (service?.duration ?? 60) * 60 * 1000);
    return hasTimeOverlap(startAt, endAt, appointmentStart, appointmentEnd);
  });

  if (hasAppointmentConflict) {
    throw new Error("该时间段已有预约，不能锁定");
  }

  const hasSlotConflict = data.staffUnavailableSlots.some((slot) => {
    if (slot.staffId !== input.staffId) return false;
    return hasTimeOverlap(startAt, endAt, new Date(slot.startAt), new Date(slot.endAt));
  });

  if (hasSlotConflict) {
    throw new Error("该时间段已锁定");
  }

  const createdAt = currentTime();
  const slot: StaffUnavailableSlot = {
    id: idFactory("su"),
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };

  return {
    ...data,
    staffUnavailableSlots: [slot, ...data.staffUnavailableSlots],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "锁定员工时间",
        targetType: "staffUnavailableSlot",
        targetId: slot.id,
        summary: `${input.reason}：${input.startAt} 至 ${input.endAt}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function createDailyClose(
  data: AppData,
  input: DailyCloseInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const createdAt = currentTime();

  if (data.dailyCloses.some((item) => item.businessDate === input.businessDate)) {
    throw new Error("该营业日已日结");
  }

  const orders = data.orders.filter((order) => order.createdAt.slice(0, 10) === input.businessDate);
  const refunds = data.refunds.filter((refund) => refund.createdAt.slice(0, 10) === input.businessDate);
  const commissions = data.commissions.filter((commission) => commission.createdAt.slice(0, 10) === input.businessDate);

  const amountByMethod = (method: Order["payMethod"]) =>
    orders.filter((order) => order.payMethod === method).reduce((sum, order) => sum + order.paidAmount, 0);

  const dailyClose: DailyClose = {
    id: idFactory("dc"),
    businessDate: input.businessDate,
    revenue: orders.reduce((sum, order) => sum + order.paidAmount, 0),
    refundAmount: refunds.reduce((sum, refund) => sum + refund.amount, 0),
    orderCount: orders.filter((order) => order.status !== "已退款").length,
    cashAmount: amountByMethod("现金"),
    wechatAmount: amountByMethod("微信"),
    alipayAmount: amountByMethod("支付宝"),
    cardAmount: amountByMethod("银行卡"),
    memberCardAmount: amountByMethod("会员卡"),
    commissionAmount: commissions.filter((commission) => commission.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0),
    createdBy: input.userId,
    createdAt,
  };

  return {
    ...data,
    dailyCloses: [dailyClose, ...data.dailyCloses],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "财务日结",
        targetType: "dailyClose",
        targetId: dailyClose.id,
        summary: `${input.businessDate} 日结：实收 ${dailyClose.revenue} 元，退款 ${dailyClose.refundAmount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

function hasTimeOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function splitAmount(amount: number, parts: number) {
  if (parts <= 0) return [];
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function adjustInventory(
  data: AppData,
  input: InventoryAdjustmentInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const currentTime = options.now ?? nowIso;
  const direction = input.type === "入库" ? 1 : -1;
  let stockAfter = 0;
  const products = data.products.map((product) => {
    if (product.id !== input.productId) return product;
    stockAfter = Math.max(0, product.stock + input.quantity * direction);
    return { ...product, stock: stockAfter };
  });

  if (!data.products.some((product) => product.id === input.productId)) {
    throw new Error("商品或耗材不存在");
  }

  return {
    ...data,
    products,
    inventoryLogs: [
      {
        id: idFactory("il"),
        productId: input.productId,
        type: input.type,
        delta: input.quantity * direction,
        stockAfter,
        note: input.note ?? "手动调整",
        createdAt: currentTime(),
      },
      ...data.inventoryLogs,
    ],
  };
}

export function reportSummary(data: AppData) {
  const revenue = data.orders.reduce((sum, item) => sum + item.paidAmount, 0);
  const refundAmount = data.refunds.reduce((sum, item) => sum + item.amount, 0);
  const cardBalance = data.memberCards.reduce((sum, item) => sum + item.balance, 0);
  const commission = data.commissions.filter((item) => item.status !== "已冲销").reduce((sum, item) => sum + item.amount, 0);
  const serviceCount = data.orders.filter((item) => item.status !== "已退款").length;

  return {
    revenue,
    refundAmount,
    cardBalance,
    commission,
    serviceCount,
    averageOrderValue: serviceCount ? revenue / serviceCount : 0,
    lowStockCount: data.products.filter((item) => item.stock <= item.warningStock).length,
  };
}
