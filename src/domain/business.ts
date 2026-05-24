import type {
  AppData,
  ApprovalRequest,
  CustomerFollowUp,
  CustomerServiceRecord,
  DailyClose,
  InventoryLog,
  MemberCardTransaction,
  OperationLog,
  Order,
  PurchaseOrder,
  Refund,
  Staff,
  StaffInvite,
  StaffShift,
  StaffUnavailableSlot,
  Stocktake,
  Supplier,
  UserRole,
} from "./types";
import { makeId, nowIso } from "./utils";

type IdFactory = (prefix: string) => string;

export type RegisterStoreInput = {
  storeName: string;
  ownerName: string;
  phone: string;
  address?: string;
  account: string;
  password: string;
};

export type StaffInput = {
  name: string;
  phone: string;
  role: string;
  baseSalary?: number;
  commissionRate?: number;
};

export type StaffUpdateInput = Partial<StaffInput> & {
  staffId: string;
  status?: Staff["status"];
};

export type StaffInviteInput = {
  staffId: string;
  account: string;
  role: UserRole;
  createdBy: string;
};

export type JoinInviteInput = {
  inviteCode: string;
  name: string;
  password: string;
};

export type CheckoutInput = {
  customerId: string;
  staffId: string;
  collaboratorStaffIds?: string[];
  serviceId: string;
  productId?: string;
  discountAmount?: number;
  adjustmentReason?: string;
  approvalId?: string;
  payMethod: Order["payMethod"];
  cardId?: string;
};

export type InventoryAdjustmentInput = {
  productId: string;
  type: InventoryLog["type"];
  quantity: number;
  note?: string;
};

export type ApprovalRequestInput = {
  type: ApprovalRequest["type"];
  targetId: string;
  requestedBy: string;
  amount: number;
  reason: string;
};

export type ApprovalDecisionInput = {
  approvalId: string;
  userId: string;
  approved: boolean;
};

export type RefundInput = {
  orderId: string;
  reason: string;
  userId: string;
  amount?: number;
  approvalId?: string;
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

export type StaffShiftInput = {
  staffId: string;
  startAt: string;
  endAt: string;
  note: string;
  userId: string;
};

export type MemberCardRechargeInput = {
  memberCardId: string;
  amount: number;
  giftAmount?: number;
  times?: number;
  giftTimes?: number;
  note?: string;
  userId: string;
};

export type MemberCardStatusInput = {
  memberCardId: string;
  status: "正常" | "冻结";
  reason: string;
  userId: string;
};

export type MemberCardExtendInput = {
  memberCardId: string;
  expiresAt: string;
  reason: string;
  userId: string;
};

export type MemberCardTransferInput = {
  memberCardId: string;
  toCustomerId: string;
  reason: string;
  userId: string;
};

export type CustomerServiceRecordInput = {
  customerId: string;
  staffId: string;
  serviceId: string;
  orderId?: string;
  skinCondition: string;
  beforeNote: string;
  afterNote: string;
  nextFollowUpAt?: string;
};

export type CustomerFollowUpInput = {
  customerId: string;
  staffId: string;
  dueAt: string;
  method: CustomerFollowUp["method"];
  note: string;
};

export type CompleteFollowUpInput = {
  followUpId: string;
};

export type SupplierInput = {
  name: string;
  phone: string;
  contact: string;
};

export type PurchaseOrderInput = {
  supplierId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  userId: string;
};

export type StocktakeInput = {
  productId: string;
  actualStock: number;
  reason: string;
  userId: string;
};

export function calculateOrderTotal(data: AppData, serviceId: string, productId?: string) {
  const selectedService = data.services.find((item) => item.id === serviceId);
  const selectedProduct = data.products.find((item) => item.id === productId);
  return (selectedService?.price ?? 0) + (selectedProduct?.price ?? 0);
}

export function registerStore(
  data: AppData,
  input: RegisterStoreInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  if (data.authUsers.some((user) => user.account === input.account)) {
    throw new Error("登录账号已存在");
  }

  const staffId = idFactory("s");
  const ownerUserId = idFactory("u");
  return {
    ...data,
    storeProfiles: [
      {
        id: data.storeProfiles[0]?.id ?? idFactory("store"),
        name: input.storeName,
        phone: input.phone,
        address: input.address ?? "",
        businessHours: "10:00 - 21:00",
        createdAt,
      },
    ],
    staff: [
      {
        id: staffId,
        name: input.ownerName,
        phone: input.phone,
        role: "老板",
        status: "active",
        accountId: ownerUserId,
        hiredAt: createdAt.slice(0, 10),
        baseSalary: 0,
        commissionRate: 0,
      },
      ...data.staff,
    ],
    authUsers: [
      {
        id: ownerUserId,
        name: input.ownerName,
        account: input.account,
        password: input.password,
        role: "owner",
        roleName: roleNameOf("owner"),
        staffId,
        status: "active",
        createdAt,
      },
      ...data.authUsers,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: ownerUserId,
        action: "注册门店",
        targetType: "store",
        targetId: data.storeProfiles[0]?.id ?? "store",
        summary: `${input.storeName} 完成门店注册`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function addStaffMember(
  data: AppData,
  input: StaffInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const staff: Staff = {
    id: idFactory("s"),
    name: input.name,
    phone: input.phone,
    role: input.role,
    status: "active",
    hiredAt: createdAt.slice(0, 10),
    baseSalary: input.baseSalary ?? 0,
    commissionRate: input.commissionRate ?? 0,
  };
  return { ...data, staff: [staff, ...data.staff] };
}

export function updateStaffMember(data: AppData, input: StaffUpdateInput): AppData {
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  return {
    ...data,
    staff: data.staff.map((staff) =>
      staff.id === input.staffId
        ? {
            ...staff,
            name: input.name ?? staff.name,
            phone: input.phone ?? staff.phone,
            role: input.role ?? staff.role,
            status: input.status ?? staff.status,
            baseSalary: input.baseSalary ?? staff.baseSalary,
            commissionRate: input.commissionRate ?? staff.commissionRate,
          }
        : staff,
    ),
  };
}

export function createStaffInvite(
  data: AppData,
  input: StaffInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const staff = data.staff.find((item) => item.id === input.staffId);
  if (!staff) throw new Error("员工不存在");
  if (data.authUsers.some((user) => user.account === input.account)) throw new Error("登录账号已存在");
  if (data.staffInvites.some((invite) => invite.account === input.account && invite.status === "待加入")) throw new Error("该账号已有待加入邀请");
  const invite: StaffInvite = {
    id: idFactory("si"),
    staffId: staff.id,
    account: input.account,
    role: input.role,
    status: "待加入",
    inviteCode: idFactory("join"),
    createdBy: input.createdBy,
    createdAt,
  };
  return {
    ...data,
    staffInvites: [invite, ...data.staffInvites],
  };
}

export function joinStaffInvite(
  data: AppData,
  input: JoinInviteInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const invite = data.staffInvites.find((item) => item.inviteCode === input.inviteCode && item.status === "待加入");
  if (!invite) throw new Error("邀请不存在或已失效");
  const staff = data.staff.find((item) => item.id === invite.staffId);
  if (!staff) throw new Error("员工不存在");
  if (data.authUsers.some((user) => user.account === invite.account)) throw new Error("登录账号已存在");
  const userId = idFactory("u");
  return {
    ...data,
    authUsers: [
      {
        id: userId,
        name: input.name || staff.name,
        account: invite.account,
        password: input.password,
        role: invite.role,
        roleName: roleNameOf(invite.role),
        staffId: staff.id,
        status: "active",
        createdAt,
      },
      ...data.authUsers,
    ],
    staff: data.staff.map((item) => (item.id === staff.id ? { ...item, name: input.name || item.name, accountId: userId } : item)),
    staffInvites: data.staffInvites.map((item) =>
      item.id === invite.id ? { ...item, status: "已加入", joinedAt: createdAt } : item,
    ),
  };
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

  assertBusinessDateOpen(data, currentTime().slice(0, 10));

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
    if (selectedCard.type !== "储值卡" && selectedCard.serviceIds?.length && !selectedCard.serviceIds.includes(input.serviceId)) {
      throw new Error("该套餐卡不可用于当前项目");
    }
  }

  const total = calculateOrderTotal(data, input.serviceId, input.productId);
  const discountAmount = input.discountAmount ?? 0;
  if (discountAmount < 0 || discountAmount >= total) {
    throw new Error("折扣金额无效");
  }
  if (discountAmount > 0 && !hasApprovedRequest(data, input.approvalId, "改价折扣", discountAmount)) {
    throw new Error("改价折扣需要审批通过");
  }
  const paidAmount = total - discountAmount;
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
    paidAmount,
    discountAmount,
    adjustmentReason: input.adjustmentReason,
    approvalId: input.approvalId,
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
    if (card.type === "储值卡") return { ...card, balance: Math.max(0, card.balance - paidAmount) };
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
            amountDelta: selectedCardAfterCheckout.type === "储值卡" ? -paidAmount : 0,
            timesDelta: selectedCardAfterCheckout.type === "储值卡" ? 0 : -1,
            balanceAfter: selectedCardAfterCheckout.balance,
            remainingTimesAfter: selectedCardAfterCheckout.remainingTimes,
            note: order.orderNo,
            createdAt,
          },
          ...data.memberCardTransactions,
        ]
      : data.memberCardTransactions;

  const commissionTotal = Math.round(paidAmount * 0.12);
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
        baseAmount: Math.round(paidAmount / commissionStaffIds.length),
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

  assertBusinessDateOpen(data, order.createdAt.slice(0, 10));

  const refundAmount = input.amount ?? order.paidAmount;
  if (refundAmount <= 0 || refundAmount > order.paidAmount) {
    throw new Error("退款金额无效");
  }

  const isFullRefund = refundAmount === order.paidAmount;
  if (refundAmount > 1000 && !hasApprovedRequest(data, input.approvalId, "订单退款", refundAmount)) {
    throw new Error("大额退款需要审批通过");
  }

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

export function createApprovalRequest(
  data: AppData,
  input: ApprovalRequestInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const request: ApprovalRequest = {
    id: idFactory("ap"),
    type: input.type,
    targetId: input.targetId,
    requestedBy: input.requestedBy,
    amount: input.amount,
    reason: input.reason,
    status: "待审批",
    createdAt,
  };
  return {
    ...data,
    approvalRequests: [request, ...data.approvalRequests],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.requestedBy,
        action: "提交审批",
        targetType: "approvalRequest",
        targetId: request.id,
        summary: `${input.type} ${input.amount} 元：${input.reason}`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function decideApprovalRequest(
  data: AppData,
  input: ApprovalDecisionInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const request = data.approvalRequests.find((item) => item.id === input.approvalId);
  if (!request) throw new Error("审批单不存在");
  if (request.status !== "待审批") throw new Error("审批单已处理");

  return {
    ...data,
    approvalRequests: data.approvalRequests.map((item) =>
      item.id === input.approvalId
        ? { ...item, status: input.approved ? "已通过" : "已拒绝", approvedBy: input.userId, approvedAt: createdAt }
        : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: input.approved ? "审批通过" : "审批拒绝",
        targetType: "approvalRequest",
        targetId: input.approvalId,
        summary: `${request.type} ${request.amount} 元`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function rechargeMemberCard(
  data: AppData,
  input: MemberCardRechargeInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可充值");

  const amountDelta = (input.amount ?? 0) + (input.giftAmount ?? 0);
  const timesDelta = (input.times ?? 0) + (input.giftTimes ?? 0);
  if (amountDelta <= 0 && timesDelta <= 0) throw new Error("充值金额或次数无效");

  const nextCard = {
    ...card,
    balance: card.balance + amountDelta,
    remainingTimes: card.remainingTimes + timesDelta,
  };

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? nextCard : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "充值",
        amountDelta,
        timesDelta,
        balanceAfter: nextCard.balance,
        remainingTimesAfter: nextCard.remainingTimes,
        note: input.note ?? "会员卡充值",
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "会员卡充值",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 充值 ${amountDelta} 元 / ${timesDelta} 次`,
        createdAt,
      },
      ...data.operationLogs,
    ],
  };
}

export function updateMemberCardStatus(
  data: AppData,
  input: MemberCardStatusInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可操作");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, status: input.status } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: input.status === "冻结" ? "冻结" : "解冻",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
  };
}

export function extendMemberCard(
  data: AppData,
  input: MemberCardExtendInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可延期");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, expiresAt: input.expiresAt } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "延期",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: `${input.reason}，延期至 ${input.expiresAt}`,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
  };
}

export function transferMemberCard(
  data: AppData,
  input: MemberCardTransferInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const card = data.memberCards.find((item) => item.id === input.memberCardId);
  if (!card || card.status === "已退卡") throw new Error("会员卡不存在或不可转卡");
  if (!data.customers.some((customer) => customer.id === input.toCustomerId)) throw new Error("转入客户不存在");

  return {
    ...data,
    memberCards: data.memberCards.map((item) => (item.id === card.id ? { ...item, customerId: input.toCustomerId } : item)),
    memberCardTransactions: [
      {
        id: idFactory("mt"),
        memberCardId: card.id,
        type: "转卡",
        amountDelta: 0,
        timesDelta: 0,
        balanceAfter: card.balance,
        remainingTimesAfter: card.remainingTimes,
        note: input.reason,
        createdAt,
      },
      ...data.memberCardTransactions,
    ],
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "会员转卡",
        targetType: "memberCard",
        targetId: card.id,
        summary: `${card.name} 转给 ${input.toCustomerId}：${input.reason}`,
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

  const shiftsForDay = data.staffShifts.filter(
    (shift) => shift.staffId === input.staffId && shift.startAt.slice(0, 10) === input.startAt.slice(0, 10),
  );
  const insideShift =
    shiftsForDay.length === 0 ||
    shiftsForDay.some((shift) => startAt >= new Date(shift.startAt) && endAt <= new Date(shift.endAt));
  if (!insideShift) {
    throw new Error("预约时间不在员工班次内");
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

export function createStaffShift(
  data: AppData,
  input: StaffShiftInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!data.staff.some((staff) => staff.id === input.staffId)) throw new Error("员工不存在");
  if (!(startAt < endAt)) throw new Error("班次结束时间必须晚于开始时间");
  const hasShiftConflict = data.staffShifts.some(
    (shift) => shift.staffId === input.staffId && hasTimeOverlap(startAt, endAt, new Date(shift.startAt), new Date(shift.endAt)),
  );
  if (hasShiftConflict) throw new Error("员工班次冲突");
  const shift: StaffShift = {
    id: idFactory("ss"),
    staffId: input.staffId,
    startAt: input.startAt,
    endAt: input.endAt,
    note: input.note,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    staffShifts: [shift, ...data.staffShifts],
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

  if (data.dailyCloses.some((item) => item.businessDate === input.businessDate && item.status === "已锁定")) {
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
    status: "已锁定",
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

export function reverseDailyClose(
  data: AppData,
  input: DailyCloseInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const close = data.dailyCloses.find((item) => item.businessDate === input.businessDate && item.status === "已锁定");
  if (!close) throw new Error("可反结日结不存在");
  return {
    ...data,
    dailyCloses: data.dailyCloses.map((item) =>
      item.id === close.id ? { ...item, status: "已反结", reversedBy: input.userId, reversedAt: createdAt } : item,
    ),
    operationLogs: [
      {
        id: idFactory("op"),
        userId: input.userId,
        action: "财务反结",
        targetType: "dailyClose",
        targetId: close.id,
        summary: `${input.businessDate} 反结`,
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
  assertBusinessDateOpen(data, currentTime().slice(0, 10));
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

export function addSupplier(
  data: AppData,
  input: SupplierInput,
  options: { idFactory?: IdFactory } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const supplier: Supplier = { id: idFactory("sp"), name: input.name, phone: input.phone, contact: input.contact, status: "active" };
  return { ...data, suppliers: [supplier, ...data.suppliers] };
}

export function receivePurchaseOrder(
  data: AppData,
  input: PurchaseOrderInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  assertBusinessDateOpen(data, createdAt.slice(0, 10));
  if (!data.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("供应商不存在");
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品或耗材不存在");
  const stockAfter = product.stock + input.quantity;
  const purchaseOrder: PurchaseOrder = {
    id: idFactory("po"),
    supplierId: input.supplierId,
    productId: input.productId,
    quantity: input.quantity,
    unitCost: input.unitCost,
    status: "已入库",
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    products: data.products.map((item) => (item.id === product.id ? { ...item, stock: stockAfter, cost: input.unitCost } : item)),
    purchaseOrders: [purchaseOrder, ...data.purchaseOrders],
    inventoryLogs: [
      {
        id: idFactory("il"),
        productId: product.id,
        type: "采购入库",
        delta: input.quantity,
        stockAfter,
        note: purchaseOrder.id,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function createStocktake(
  data: AppData,
  input: StocktakeInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  assertBusinessDateOpen(data, createdAt.slice(0, 10));
  const product = data.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("商品或耗材不存在");
  const delta = input.actualStock - product.stock;
  const stocktake: Stocktake = {
    id: idFactory("st"),
    productId: product.id,
    systemStock: product.stock,
    actualStock: input.actualStock,
    delta,
    reason: input.reason,
    createdBy: input.userId,
    createdAt,
  };
  return {
    ...data,
    products: data.products.map((item) => (item.id === product.id ? { ...item, stock: input.actualStock } : item)),
    stocktakes: [stocktake, ...data.stocktakes],
    inventoryLogs: [
      {
        id: idFactory("il"),
        productId: product.id,
        type: "盘点调整",
        delta,
        stockAfter: input.actualStock,
        note: input.reason,
        createdAt,
      },
      ...data.inventoryLogs,
    ],
  };
}

export function addCustomerServiceRecord(
  data: AppData,
  input: CustomerServiceRecordInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  const record: CustomerServiceRecord = {
    id: idFactory("sr"),
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
    orderId: input.orderId,
    skinCondition: input.skinCondition,
    beforeNote: input.beforeNote,
    afterNote: input.afterNote,
    nextFollowUpAt: input.nextFollowUpAt,
    createdAt,
  };
  const followUp: CustomerFollowUp | undefined = input.nextFollowUpAt
    ? {
        id: idFactory("fu"),
        customerId: input.customerId,
        staffId: input.staffId,
        dueAt: input.nextFollowUpAt,
        method: "微信",
        note: `服务后回访：${input.afterNote}`,
        status: "待跟进",
        createdAt,
      }
    : undefined;
  return {
    ...data,
    customerServiceRecords: [record, ...data.customerServiceRecords],
    customerFollowUps: followUp ? [followUp, ...data.customerFollowUps] : data.customerFollowUps,
  };
}

export function addCustomerFollowUp(
  data: AppData,
  input: CustomerFollowUpInput,
  options: { idFactory?: IdFactory; now?: () => string } = {},
): AppData {
  const idFactory = options.idFactory ?? makeId;
  const createdAt = (options.now ?? nowIso)();
  return {
    ...data,
    customerFollowUps: [
      {
        id: idFactory("fu"),
        customerId: input.customerId,
        staffId: input.staffId,
        dueAt: input.dueAt,
        method: input.method,
        note: input.note,
        status: "待跟进",
        createdAt,
      },
      ...data.customerFollowUps,
    ],
  };
}

export function completeCustomerFollowUp(
  data: AppData,
  input: CompleteFollowUpInput,
  options: { now?: () => string } = {},
): AppData {
  const completedAt = (options.now ?? nowIso)();
  return {
    ...data,
    customerFollowUps: data.customerFollowUps.map((item) =>
      item.id === input.followUpId ? { ...item, status: "已完成", completedAt } : item,
    ),
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

function hasApprovedRequest(data: AppData, approvalId: string | undefined, type: ApprovalRequest["type"], amount: number) {
  if (!approvalId) return false;
  return data.approvalRequests.some((item) => item.id === approvalId && item.type === type && item.status === "已通过" && item.amount >= amount);
}

function assertBusinessDateOpen(data: AppData, businessDate: string) {
  if (data.dailyCloses.some((item) => item.businessDate === businessDate && item.status === "已锁定")) {
    throw new Error("该营业日已日结锁账");
  }
}

function roleNameOf(role: UserRole) {
  const names: Record<UserRole, string> = {
    owner: "老板",
    manager: "店长",
    frontdesk: "前台",
    therapist: "美容师",
    finance: "财务",
  };
  return names[role];
}
