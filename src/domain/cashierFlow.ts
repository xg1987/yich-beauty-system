import { memberCardCashIn } from "./business";
import type { AppData, MemberCardTransaction, Order } from "./types";

type CashierFlowPayMethod = Order["payMethod"] | "-";

export type CashierFlowRecord =
  | {
    kind: "order";
    id: string;
    createdAt: string;
    orderNo: string;
    customerName: string;
    itemName: string;
    staffName: string;
    source: string;
    payMethod: CashierFlowPayMethod;
    paidAmount: number;
    discountAmount: number;
    status: Order["status"];
    order: Order;
  }
  | {
    kind: "memberCard";
    id: string;
    createdAt: string;
    orderNo: string;
    customerName: string;
    itemName: string;
    staffName: string;
    source: string;
    payMethod: CashierFlowPayMethod;
    paidAmount: number;
    discountAmount: 0;
    status: "已收款";
    transaction: MemberCardTransaction;
  };

function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "-";
}

function orderCustomerLabel(data: AppData, order: Order) {
  if (order.customerId) return nameOf(data.customers, order.customerId);
  const name = order.guestName?.trim();
  const phone = order.guestPhone?.trim();
  if (!name && !phone) return "新客";
  return [name || "新客", phone].filter(Boolean).join(" · ");
}

function orderProductLineLabels(data: AppData, order: Order) {
  if (order.productItems?.length) {
    return order.productItems.map((item) => `${nameOf(data.products, item.productId)} x${item.quantity}`);
  }
  return order.productId ? [nameOf(data.products, order.productId)] : [];
}

function orderGiftLineLabels(data: AppData, order: Order) {
  if (order.giftProductItems?.length) {
    return order.giftProductItems.map((item) => `赠 ${nameOf(data.products, item.productId)} x${item.quantity}`);
  }
  return order.giftProductId ? [`赠 ${nameOf(data.products, order.giftProductId)}`] : [];
}

function orderItemLabel(data: AppData, order: Order) {
  const serviceName = order.serviceId ? nameOf(data.services, order.serviceId) : "";
  return [
    serviceName !== "-" ? serviceName : "",
    ...orderProductLineLabels(data, order).filter((name) => !name.startsWith("-")),
    ...orderGiftLineLabels(data, order).filter((name) => !name.startsWith("赠 -")),
  ].filter(Boolean).join(" + ") || "商品";
}

const memberCardTransactionLogActions: Partial<Record<MemberCardTransaction["type"], string>> = {
  开卡: "开卡",
  充值: "会员卡充值",
  退卡: "会员退卡",
  转卡: "会员转卡",
};

function memberCardTransactionStaffName(data: AppData, transaction: MemberCardTransaction) {
  const linkedOrder = transaction.orderId ? data.orders.find((order) => order.id === transaction.orderId) : undefined;
  const directStaffId = transaction.staffId || linkedOrder?.staffId;
  if (directStaffId) return nameOf(data.staff, directStaffId);
  const action = memberCardTransactionLogActions[transaction.type];
  if (!action) return "-";
  const log = data.operationLogs.find((item) =>
    item.targetType === "memberCard"
    && item.targetId === transaction.memberCardId
    && item.action === action
    && item.createdAt === transaction.createdAt,
  ) ?? data.operationLogs.find((item) =>
    item.targetType === "memberCard"
    && item.targetId === transaction.memberCardId
    && item.action === action,
  );
  const staffId = data.authUsers.find((user) => user.id === log?.userId)?.staffId;
  return staffId ? nameOf(data.staff, staffId) : "-";
}

export function buildCashierFlowRecords(data: AppData): CashierFlowRecord[] {
  const orderRows: CashierFlowRecord[] = data.orders.map((order) => ({
    kind: "order",
    id: order.id,
    createdAt: order.createdAt,
    orderNo: order.orderNo,
    customerName: orderCustomerLabel(data, order),
    itemName: orderItemLabel(data, order),
    staffName: nameOf(data.staff, order.staffId),
    source: order.appointmentId ? "预约到店" : "手工开单",
    payMethod: order.payMethod,
    paidAmount: order.paidAmount,
    discountAmount: order.discountAmount,
    status: order.status,
    order,
  }));
  const memberCardRows = data.memberCardTransactions
    .map((transaction): CashierFlowRecord | undefined => {
      const paidAmount = memberCardCashIn(transaction);
      if (paidAmount <= 0) return undefined;
      const card = data.memberCards.find((item) => item.id === transaction.memberCardId);
      const customerName = card ? nameOf(data.customers, card.customerId) : "-";
      return {
        kind: "memberCard",
        id: transaction.id,
        createdAt: transaction.createdAt,
        orderNo: `${transaction.type}流水`,
        customerName,
        itemName: `${transaction.type} · ${card?.name || "会员卡"}`,
        staffName: memberCardTransactionStaffName(data, transaction),
        source: "会员卡",
        payMethod: transaction.payMethod ?? "-",
        paidAmount,
        discountAmount: 0,
        status: "已收款",
        transaction,
      };
    })
    .filter((row): row is CashierFlowRecord => Boolean(row));
  return [...orderRows, ...memberCardRows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
