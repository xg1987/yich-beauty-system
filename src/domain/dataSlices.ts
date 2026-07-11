import type { AppData, ViewKey } from "./types";

export type AppDataSlice = {
  kind: "app-data-slice";
  view: ViewKey;
  data: Partial<AppData>;
  generatedAt: string;
};

export type AppDataPatch = {
  kind: "app-data-patch";
  view: ViewKey;
  upserts: Partial<AppData>;
  generatedAt: string;
};

export type AppDataUpdate = AppData | AppDataSlice | AppDataPatch;

type AppDataKey = keyof AppData;

const commonKeys: AppDataKey[] = [
  "storeProfiles",
  "authUsers",
  "staff",
  "notifications",
  "systemConfigs",
];

const viewKeys: Record<ViewKey, AppDataKey[]> = {
  dashboard: [
    "customers",
    "services",
    "appointments",
    "onlineBookingRequests",
    "orders",
    "products",
    "memberCards",
    "approvalRequests",
    "customerSignatures",
    "customerFollowUps",
    "dailyCloses",
    "operationLogs",
  ],
  appointments: [
    "customers",
    "services",
    "appointments",
    "onlineBookingRequests",
    "staffUnavailableSlots",
    "staffShifts",
    "orders",
    "customerSignatures",
  ],
  pos: [
    "customers",
    "services",
    "products",
    "appointments",
    "memberCards",
    "orders",
    "refunds",
    "commissions",
    "inventoryBatches",
    "inventoryLogs",
    "memberCardTransactions",
    "approvalRequests",
    "customerServiceRecords",
    "customerSignatures",
    "customerFollowUps",
    "dailyCloses",
  ],
  customers: [
    "customers",
    "tagDefinitions",
    "services",
    "products",
    "appointments",
    "orders",
    "refunds",
    "memberCards",
    "memberCardTransactions",
    "customerServiceRecords",
    "customerSignatures",
    "customerFollowUps",
  ],
  marketing: [
    "customers",
    "services",
    "products",
    "memberCards",
    "orders",
    "customerFollowUps",
    "onlineStorefronts",
    "marketingAiRecords",
  ],
  catalog: [
    "tagDefinitions",
    "services",
    "products",
    "inventoryBatches",
    "inventoryLogs",
  ],
  staff: [
    "staffInvites",
    "orders",
    "commissions",
    "commissionSettlements",
  ],
  inventory: [
    "services",
    "products",
    "inventoryBatches",
    "inventoryLogs",
    "suppliers",
    "purchaseOrders",
    "stocktakes",
  ],
  reports: [
    "customers",
    "services",
    "products",
    "appointments",
    "orders",
    "refunds",
    "commissions",
    "commissionSettlements",
    "inventoryLogs",
    "memberCards",
    "memberCardTransactions",
    "dailyCloses",
  ],
  approvals: [
    "customers",
    "orders",
    "approvalRequests",
  ],
  logs: [
    "operationLogs",
  ],
  accounts: [
    "storeOwnerInvites",
    "storeOwnerApplications",
    "staffInvites",
  ],
  permissions: [
    "storeOwnerApplications",
  ],
  platformConfig: [
    "storeOwnerApplications",
  ],
  aiConfig: [
    "storeOwnerApplications",
  ],
  aiCredits: [
    "marketingAiRecords",
    "operationLogs",
  ],
  aiTest: [
    "storeOwnerApplications",
  ],
  aiUsage: [
    "operationLogs",
    "marketingAiRecords",
  ],
  storeCustomerDetails: [
    "customers",
    "services",
    "products",
    "appointments",
    "orders",
    "refunds",
    "memberCards",
    "memberCardTransactions",
    "customerServiceRecords",
    "customerSignatures",
    "customerFollowUps",
    "inventoryLogs",
  ],
  usage: [
    "storeOwnerApplications",
    "operationLogs",
    "marketingAiRecords",
  ],
  roomSettings: [
    "appointments",
    "staffUnavailableSlots",
    "staffShifts",
  ],
  settings: [
    "customers",
    "services",
    "appointments",
    "staffUnavailableSlots",
    "staffShifts",
    "memberCards",
    "memberCardTransactions",
    "customerSignatures",
    "refunds",
    "onlineStorefronts",
    "staffInvites",
    "storeOwnerInvites",
    "storeOwnerApplications",
  ],
};

export function isAppDataSlice(value: unknown): value is AppDataSlice {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "app-data-slice"
    && typeof (value as { data?: unknown }).data === "object"
    && (value as { data?: unknown }).data !== null;
}

export function isAppDataPatch(value: unknown): value is AppDataPatch {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "app-data-patch"
    && typeof (value as { upserts?: unknown }).upserts === "object"
    && (value as { upserts?: unknown }).upserts !== null;
}

export function isViewKey(value: string | undefined | null): value is ViewKey {
  return typeof value === "string" && value in viewKeys;
}

export function dataKeysForView(view: ViewKey) {
  return Array.from(new Set([...commonKeys, ...viewKeys[view]]));
}

export function emptyAppData(): AppData {
  return {
    storeProfiles: [],
    onlineStorefronts: [],
    authUsers: [],
    staffInvites: [],
    storeOwnerInvites: [],
    storeOwnerApplications: [],
    staff: [],
    customers: [],
    tagDefinitions: [],
    services: [],
    products: [],
    inventoryBatches: [],
    appointments: [],
    onlineBookingRequests: [],
    staffUnavailableSlots: [],
    staffShifts: [],
    memberCards: [],
    distributors: [],
    referralRelations: [],
    orders: [],
    refunds: [],
    commissions: [],
    distributionCommissions: [],
    commissionSettlements: [],
    inventoryLogs: [],
    memberCardTransactions: [],
    operationLogs: [],
    marketingAiRecords: [],
    systemConfigs: [],
    notifications: [],
    dailyCloses: [],
    approvalRequests: [],
    customerServiceRecords: [],
    customerSignatures: [],
    customerFollowUps: [],
    suppliers: [],
    purchaseOrders: [],
    stocktakes: [],
  };
}

export function dataSliceForView(data: AppData, view: ViewKey): Partial<AppData> {
  const slice: Partial<AppData> = {};
  for (const key of dataKeysForView(view)) {
    slice[key] = data[key] as never;
  }
  return slice;
}

export function makeAppDataSlice(data: AppData, view: ViewKey): AppDataSlice {
  return {
    kind: "app-data-slice",
    view,
    data: dataSliceForView(data, view),
    generatedAt: new Date().toISOString(),
  };
}

export function makeAppDataPatch(data: Partial<AppData>, view: ViewKey): AppDataPatch {
  return {
    kind: "app-data-patch",
    view,
    upserts: data,
    generatedAt: new Date().toISOString(),
  };
}
