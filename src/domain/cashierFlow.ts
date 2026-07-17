import { memberCardCashIn } from "./business";
import type { AppData, Appointment, MemberCardTransaction, OperationLog, Order } from "./types";

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

export type CashierFlowListItem = Omit<Extract<CashierFlowRecord, { kind: "order" }>, "order">
  | Omit<Extract<CashierFlowRecord, { kind: "memberCard" }>, "transaction">;

export type CashierFlowRelatedData = Pick<
  AppData,
  | "orders"
  | "memberCardTransactions"
  | "customers"
  | "memberCards"
  | "appointments"
  | "customerSignatures"
  | "customerServiceRecords"
>;

export type CashierFlowPageResult = {
  items: CashierFlowListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  generatedAt: string;
};

export type CashierFlowDetailResult = {
  record: CashierFlowListItem;
  data: CashierFlowRelatedData;
};

export type PosContextResult = {
  cashierFlowTotal: number;
  todayPaid: number;
  todayOrderCount: number;
  todayMemberCardIncomeCount: number;
  arrivedAppointments: Appointment[];
  data: CashierFlowRelatedData;
};

export type CashierFlowSourceKey = {
  kind: CashierFlowListItem["kind"];
  id: string;
};

export function cashierFlowListItemOf(record: CashierFlowRecord): CashierFlowListItem {
  if (record.kind === "order") {
    const { order: _order, ...item } = record;
    return item;
  }
  const { transaction: _transaction, ...item } = record;
  return item;
}

export function buildCashierFlowListItemsForKeys(data: AppData, keys: readonly CashierFlowSourceKey[]) {
  const recordsByKey = new Map(
    buildCashierFlowRecords(data).map((record) => [`${record.kind}:${record.id}`, record] as const),
  );
  return keys.flatMap((key) => {
    const record = recordsByKey.get(`${key.kind}:${key.id}`);
    return record ? [cashierFlowListItemOf(record)] : [];
  });
}

function firstById<T extends { id: string }>(collection: readonly T[]) {
  const result = new Map<string, T>();
  collection.forEach((item) => {
    if (!result.has(item.id)) result.set(item.id, item);
  });
  return result;
}

function nameOf<T extends { name: string }>(collection: ReadonlyMap<string, T>, id: string) {
  return collection.get(id)?.name ?? "-";
}

type MemberCardLogMatches = {
  first: OperationLog;
  firstByCreatedAt: Map<string, OperationLog>;
};

function buildMemberCardLogIndex(operationLogs: readonly OperationLog[]) {
  const result = new Map<string, Map<string, MemberCardLogMatches>>();
  operationLogs.forEach((log) => {
    if (log.targetType !== "memberCard") return;
    let byAction = result.get(log.targetId);
    if (!byAction) {
      byAction = new Map();
      result.set(log.targetId, byAction);
    }
    let matches = byAction.get(log.action);
    if (!matches) {
      matches = { first: log, firstByCreatedAt: new Map() };
      byAction.set(log.action, matches);
    }
    if (!matches.firstByCreatedAt.has(log.createdAt)) {
      matches.firstByCreatedAt.set(log.createdAt, log);
    }
  });
  return result;
}

function createMemberCardLogFinder(operationLogs: readonly OperationLog[]) {
  let index: ReturnType<typeof buildMemberCardLogIndex> | undefined;

  return (targetId: string, action: string, createdAt: string) => {
    index ??= buildMemberCardLogIndex(operationLogs);
    const matches = index.get(targetId)?.get(action);
    return matches?.firstByCreatedAt.get(createdAt) ?? matches?.first;
  };
}

function createCashierFlowLookups(data: AppData) {
  return {
    authUsersById: firstById(data.authUsers),
    customersById: firstById(data.customers),
    memberCardsById: firstById(data.memberCards),
    ordersById: firstById(data.orders),
    productsById: firstById(data.products),
    servicesById: firstById(data.services),
    staffById: firstById(data.staff),
    findMemberCardLog: createMemberCardLogFinder(data.operationLogs),
  };
}

type CashierFlowLookups = ReturnType<typeof createCashierFlowLookups>;

function orderCustomerLabel(lookups: CashierFlowLookups, order: Order) {
  if (order.customerId) return nameOf(lookups.customersById, order.customerId);
  const name = order.guestName?.trim();
  const phone = order.guestPhone?.trim();
  if (!name && !phone) return "新客";
  return [name || "新客", phone].filter(Boolean).join(" · ");
}

function orderProductLineLabels(lookups: CashierFlowLookups, order: Order) {
  if (order.productItems?.length) {
    return order.productItems.map((item) => `${item.productName || nameOf(lookups.productsById, item.productId)} x${item.quantity}`);
  }
  return order.productId ? [nameOf(lookups.productsById, order.productId)] : [];
}

function orderGiftLineLabels(lookups: CashierFlowLookups, order: Order) {
  if (order.giftProductItems?.length) {
    return order.giftProductItems.map((item) => `赠 ${item.productName || nameOf(lookups.productsById, item.productId)} x${item.quantity}`);
  }
  return order.giftProductId ? [`赠 ${nameOf(lookups.productsById, order.giftProductId)}`] : [];
}

function orderItemLabel(lookups: CashierFlowLookups, order: Order) {
  const serviceName = order.serviceName || (order.serviceId ? nameOf(lookups.servicesById, order.serviceId) : "");
  return [
    serviceName !== "-" ? serviceName : "",
    ...orderProductLineLabels(lookups, order).filter((name) => !name.startsWith("-")),
    ...orderGiftLineLabels(lookups, order).filter((name) => !name.startsWith("赠 -")),
  ].filter(Boolean).join(" + ") || "商品";
}

const memberCardTransactionLogActions: Partial<Record<MemberCardTransaction["type"], string>> = {
  开卡: "开卡",
  充值: "会员卡充值",
  退卡: "会员退卡",
  转卡: "会员转卡",
};

function memberCardTransactionStaffName(lookups: CashierFlowLookups, transaction: MemberCardTransaction) {
  const linkedOrder = transaction.orderId ? lookups.ordersById.get(transaction.orderId) : undefined;
  const directStaffId = transaction.staffId || linkedOrder?.staffId;
  if (directStaffId) return nameOf(lookups.staffById, directStaffId);
  const action = memberCardTransactionLogActions[transaction.type];
  if (!action) return "-";
  const log = lookups.findMemberCardLog(transaction.memberCardId, action, transaction.createdAt);
  const staffId = log ? lookups.authUsersById.get(log.userId)?.staffId : undefined;
  return staffId ? nameOf(lookups.staffById, staffId) : "-";
}

export function buildCashierFlowRecords(data: AppData): CashierFlowRecord[] {
  const lookups = createCashierFlowLookups(data);
  const orderRows: CashierFlowRecord[] = data.orders.map((order) => ({
    kind: "order",
    id: order.id,
    createdAt: order.createdAt,
    orderNo: order.orderNo,
    customerName: orderCustomerLabel(lookups, order),
    itemName: orderItemLabel(lookups, order),
    staffName: nameOf(lookups.staffById, order.staffId),
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
      const card = lookups.memberCardsById.get(transaction.memberCardId);
      const customerName = card ? nameOf(lookups.customersById, card.customerId) : "-";
      return {
        kind: "memberCard",
        id: transaction.id,
        createdAt: transaction.createdAt,
        orderNo: `${transaction.type}流水`,
        customerName,
        itemName: `${transaction.type} · ${card?.name || "会员卡"}`,
        staffName: memberCardTransactionStaffName(lookups, transaction),
        source: "会员卡",
        payMethod: transaction.payMethod ?? "-",
        paidAmount,
        discountAmount: 0,
        status: "已收款",
        transaction,
      };
    })
    .filter((row): row is CashierFlowRecord => Boolean(row));
  return [...orderRows, ...memberCardRows]
    .map((record, originalIndex) => ({ record, originalIndex, createdAtMs: +new Date(record.createdAt) }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs || a.originalIndex - b.originalIndex)
    .map(({ record }) => record);
}
