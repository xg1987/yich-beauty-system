export type ViewKey =
  | "dashboard"
  | "appointments"
  | "pos"
  | "customers"
  | "catalog"
  | "staff"
  | "inventory"
  | "reports"
  | "approvals"
  | "settings";

export type UserRole = "owner" | "manager" | "frontdesk" | "therapist" | "finance";

export type StoreProfile = {
  id: string;
  name: string;
  phone: string;
  address: string;
  businessHours: string;
  createdAt: string;
};

export type OnlineStorefront = {
  id: string;
  storeId: string;
  shareCode: string;
  status: "启用" | "停用";
  headline: string;
  description: string;
  enabledServiceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Staff = {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: "active" | "inactive";
  accountId?: string;
  hiredAt?: string;
  baseSalary?: number;
  commissionRate?: number;
};

export type AuthUser = {
  id: string;
  name: string;
  account: string;
  password: string;
  role: UserRole;
  roleName: string;
  staffId?: string;
  status: "active" | "disabled";
  createdAt: string;
};

export type StaffInvite = {
  id: string;
  staffId: string;
  account: string;
  role: UserRole;
  status: "待加入" | "已加入" | "已作废";
  inviteCode: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  joinedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
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

export type TagScope = "客户" | "项目" | "员工";

export type TagDefinition = {
  id: string;
  name: string;
  scope: TagScope;
  color: string;
  status: "启用" | "停用";
  createdAt: string;
};

export type ServiceConsumable = {
  productId: string;
  quantity: number;
};

export type Service = {
  id: string;
  name: string;
  category: string;
  price: number;
  duration: number;
  consumables?: ServiceConsumable[];
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
  arrivedAt?: string;
  completedAt?: string;
  canceledAt?: string;
  cancelReason?: string;
  noShowAt?: string;
  rescheduledAt?: string;
  updatedAt?: string;
};

export type OnlineBookingRequest = {
  id: string;
  storefrontId: string;
  customerName: string;
  phone: string;
  serviceId: string;
  preferredAt: string;
  note: string;
  status: "待处理" | "已转预约" | "已关闭";
  appointmentId?: string;
  createdAt: string;
  handledAt?: string;
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

export type StaffShift = {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  note: string;
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
  serviceIds?: string[];
};

export type CouponTemplate = {
  id: string;
  name: string;
  type: "满减券";
  amount: number;
  minSpend: number;
  serviceId?: string;
  validDays: number;
  status: "启用" | "停用";
  createdAt: string;
};

export type CustomerCoupon = {
  id: string;
  templateId: string;
  customerId: string;
  name: string;
  amount: number;
  minSpend: number;
  serviceId?: string;
  status: "未使用" | "已使用" | "已过期" | "已作废";
  issuedAt: string;
  expiresAt: string;
  usedOrderId?: string;
  usedAt?: string;
};

export type MarketingActivity = {
  id: string;
  name: string;
  type: "拼团" | "秒杀";
  serviceId: string;
  activityPrice: number;
  groupSize?: number;
  quota: number;
  soldCount: number;
  startsAt: string;
  endsAt: string;
  status: "进行中" | "已结束" | "已停用";
  createdAt: string;
};

export type ActivityParticipant = {
  id: string;
  activityId: string;
  customerId: string;
  orderId?: string;
  status: "已参加" | "已核销" | "已取消";
  joinedAt: string;
  checkedAt?: string;
};

export type Distributor = {
  id: string;
  type: "客户" | "员工";
  customerId?: string;
  staffId?: string;
  name: string;
  phone: string;
  rate: number;
  status: "启用" | "停用";
  inviteCode: string;
  createdAt: string;
};

export type ReferralRelation = {
  id: string;
  distributorId: string;
  customerId: string;
  source: "手工绑定" | "邀请码";
  status: "有效" | "已解除";
  createdAt: string;
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
  discountAmount: number;
  adjustmentReason?: string;
  approvalId?: string;
  couponId?: string;
  activityId?: string;
  distributorId?: string;
  appointmentId?: string;
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
  rate: number;
  amount: number;
  status: "待结算" | "已结算" | "已冲销";
  createdAt: string;
  settledAt?: string;
  settlementId?: string;
};

export type DistributionCommission = {
  id: string;
  distributorId: string;
  customerId: string;
  orderId: string;
  baseAmount: number;
  rate: number;
  amount: number;
  status: "待结算" | "已结算" | "已冲销";
  createdAt: string;
  settledAt?: string;
  settlementId?: string;
};

export type CommissionSettlement = {
  id: string;
  type: "员工提成" | "分销佣金";
  commissionIds: string[];
  amount: number;
  count: number;
  createdBy: string;
  createdAt: string;
};

export type InventoryLog = {
  id: string;
  productId: string;
  type: "入库" | "采购入库" | "服务消耗" | "销售出库" | "报损" | "盘点调整" | "退款回滚";
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
  type: "开卡" | "充值" | "消费" | "退款" | "退卡" | "冻结" | "解冻" | "延期" | "转卡" | "调整";
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

export type SystemNotification = {
  id: string;
  title: string;
  desc: string;
  view: ViewKey;
  targetType: string;
  targetId: string;
  audienceRoles: UserRole[];
  staffId?: string;
  readByUserIds: string[];
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
  status: "已锁定" | "已反结";
  reversedBy?: string;
  reversedAt?: string;
};

export type ApprovalRequest = {
  id: string;
  type: "改价折扣" | "订单退款";
  targetId: string;
  requestedBy: string;
  amount: number;
  reason: string;
  status: "待审批" | "已通过" | "已拒绝";
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
};

export type CustomerServiceRecord = {
  id: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  orderId?: string;
  memberCardTransactionId?: string;
  skinCondition: string;
  beforeNote: string;
  careSteps: string;
  productsUsed: string;
  afterNote: string;
  customerFeedback: string;
  nextCareAdvice: string;
  nextFollowUpAt?: string;
  createdAt: string;
};

export type CustomerFollowUp = {
  id: string;
  customerId: string;
  staffId: string;
  dueAt: string;
  method: "电话" | "微信" | "到店";
  note: string;
  status: "待跟进" | "已完成";
  completedAt?: string;
  createdAt: string;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string;
  contact: string;
  status: "active" | "inactive";
};

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  status: "已入库";
  createdBy: string;
  createdAt: string;
};

export type Stocktake = {
  id: string;
  productId: string;
  systemStock: number;
  actualStock: number;
  delta: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type DataQualityIssue = {
  id: string;
  scope: string;
  name: string;
  detail: string;
  reason: string;
};

export type DataQualityReport = {
  issueCount: number;
  issues: DataQualityIssue[];
};

export type AppData = {
  storeProfiles: StoreProfile[];
  onlineStorefronts: OnlineStorefront[];
  authUsers: AuthUser[];
  staffInvites: StaffInvite[];
  staff: Staff[];
  customers: Customer[];
  tagDefinitions: TagDefinition[];
  services: Service[];
  products: Product[];
  appointments: Appointment[];
  onlineBookingRequests: OnlineBookingRequest[];
  staffUnavailableSlots: StaffUnavailableSlot[];
  staffShifts: StaffShift[];
  memberCards: MemberCard[];
  couponTemplates: CouponTemplate[];
  customerCoupons: CustomerCoupon[];
  marketingActivities: MarketingActivity[];
  activityParticipants: ActivityParticipant[];
  distributors: Distributor[];
  referralRelations: ReferralRelation[];
  orders: Order[];
  refunds: Refund[];
  commissions: Commission[];
  distributionCommissions: DistributionCommission[];
  commissionSettlements: CommissionSettlement[];
  inventoryLogs: InventoryLog[];
  memberCardTransactions: MemberCardTransaction[];
  operationLogs: OperationLog[];
  notifications: SystemNotification[];
  dailyCloses: DailyClose[];
  approvalRequests: ApprovalRequest[];
  customerServiceRecords: CustomerServiceRecord[];
  customerFollowUps: CustomerFollowUp[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  stocktakes: Stocktake[];
};
