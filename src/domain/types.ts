export type ViewKey =
  | "dashboard"
  | "appointments"
  | "pos"
  | "customers"
  | "catalog"
  | "staff"
  | "inventory"
  | "reports"
  | "settings";

export type Staff = {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: "active" | "inactive";
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  level: string;
  source: string;
  tags: string[];
  lastVisit: string;
};

export type Service = {
  id: string;
  name: string;
  category: string;
  price: number;
  duration: number;
  consumableProductId?: string;
  consumableQty?: number;
};

export type Product = {
  id: string;
  name: string;
  type: "sale" | "consumable";
  unit: string;
  price: number;
  cost: number;
  stock: number;
  warningStock: number;
};

export type Appointment = {
  id: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  startAt: string;
  status: "待确认" | "已确认" | "已到店" | "已完成" | "已取消" | "爽约";
  note: string;
};

export type StaffUnavailableSlot = {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type MemberCard = {
  id: string;
  customerId: string;
  name: string;
  type: "储值卡" | "次数卡" | "套餐卡";
  balance: number;
  remainingTimes: number;
  expiresAt: string;
  status: "正常" | "冻结" | "过期" | "已退卡";
  serviceId?: string;
};

export type Order = {
  id: string;
  orderNo: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  productId?: string;
  cardId?: string;
  totalAmount: number;
  paidAmount: number;
  payMethod: "现金" | "微信" | "支付宝" | "银行卡" | "会员卡";
  status: "已支付" | "部分退款" | "已退款";
  createdAt: string;
};

export type Commission = {
  id: string;
  staffId: string;
  orderId: string;
  type: "服务提成" | "销售提成";
  baseAmount: number;
  amount: number;
  status: "待结算" | "已结算" | "已冲销";
  createdAt: string;
};

export type InventoryLog = {
  id: string;
  productId: string;
  type: "入库" | "服务消耗" | "销售出库" | "报损" | "盘点调整" | "退款回滚";
  delta: number;
  stockAfter: number;
  note: string;
  createdAt: string;
};

export type Refund = {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type MemberCardTransaction = {
  id: string;
  memberCardId: string;
  orderId?: string;
  type: "开卡" | "充值" | "消费" | "退款" | "退卡" | "调整";
  amountDelta: number;
  timesDelta: number;
  balanceAfter: number;
  remainingTimesAfter: number;
  note: string;
  createdAt: string;
};

export type OperationLog = {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
};

export type DailyClose = {
  id: string;
  businessDate: string;
  revenue: number;
  refundAmount: number;
  orderCount: number;
  cashAmount: number;
  wechatAmount: number;
  alipayAmount: number;
  cardAmount: number;
  memberCardAmount: number;
  commissionAmount: number;
  createdBy: string;
  createdAt: string;
};

export type AppData = {
  staff: Staff[];
  customers: Customer[];
  services: Service[];
  products: Product[];
  appointments: Appointment[];
  staffUnavailableSlots: StaffUnavailableSlot[];
  memberCards: MemberCard[];
  orders: Order[];
  refunds: Refund[];
  commissions: Commission[];
  inventoryLogs: InventoryLog[];
  memberCardTransactions: MemberCardTransaction[];
  operationLogs: OperationLog[];
  dailyCloses: DailyClose[];
};
