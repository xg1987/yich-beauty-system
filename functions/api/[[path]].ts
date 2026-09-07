import {
  addOperationLog,
  addSystemNotification,
  addCustomerFollowUp,
  addCustomerServiceRecord,
  archiveNotification,
  createCustomerSignature,
  signCustomerSignature,
  addStaffMember,
  addSupplier,
  adjustInventory,
  cleanupFormalData,
  convertOnlineBookingRequest,
  checkoutOrder,
  normalizeCheckoutServiceIds,
  createAppointment,
  createOnlineBookingRequest,
  createApprovalRequest,
  createTagDefinition,
  createDailyClose,
  createStaffShift,
  createStaffUnavailableSlot,
  createStaffInvite,
  createStoreOwnerInvite,
  createStocktake,
  completeCustomerFollowUp,
  decideApprovalRequest,
  decideStoreOwnerApplication,
  deleteStaffMember,
  extendMemberCard,
  receiveSupplierPurchase,
  rechargeMemberCard,
  refundMemberCard,
  refundOrder,
  registerStore,
  revokeStaffInvite,
  reverseDailyClose,
  restockLowInventory,
  rescheduleAppointment,
  settleCommissions,
  updateAppointmentStatus,
  updateAuthUserAiCredits,
  transferMemberCard,
  voidMemberCardOpening,
  upsertOnlineStorefront,
  joinInviteByCode,
  isStoreStaffInviteCode,
  markAllVisibleNotificationsRead,
  markNotificationRead,
  expireStaleMarketingAiRecords,
  normalizeStoreAiUsagePermissions,
  normalizeStoreOperationalPermissions,
  normalizeStoreScopedData,
  openMemberCard,
  previewFormalDataCleanup,
  scopeDataToStore,
  sanitizeSystemConfigsForRole,
  storeStaffCanViewAllAppointments,
  updateTagDefinition,
  updateServiceCatalog,
  updateProductCatalog,
  updateStaffMember,
  updateAccountProfile,
  updateAuthUserStatus,
  resetAuthUserPassword,
  updateStoreAiUsagePermissions,
  updateStoreOperationalPermissions,
  updateStoreProfile,
  updateStoreStatus,
  updateSystemConfig,
  updateMemberCardStatus,
  platformInviteIssuerId,
  isStaleMarketingAiRecord,
  storeIdForUser,
} from "../../src/domain/business";
import { assertStrongResetPassword, hashPassword } from "../../src/lib/password";
import { requireMobilePhone } from "../../src/domain/phone";
import { aiCreditChargeForCost, assertAiFreeQuotaAvailable } from "../../src/domain/aiBilling";

// Read version from package.json at runtime (works in Cloudflare Workers)
import pkg from "../../package.json" with { type: "json" };
import type { Permission, UserSession } from "../../src/domain/auth";
import type { AiUsageCapability, AppData, Appointment, CashPayMethod, Customer, CustomerFollowUp, CustomerSignature, InventoryLog, MarketingAiRecord, MemberCard, OperationLog, Order, R2UsageSnapshot, ServiceCardSelection, ServiceConsumable, SystemConfigKey, TagScope, UserRole, ViewKey, WorkerUsageSnapshot } from "../../src/domain/types";
import type { CheckoutProductItemInput } from "../../src/domain/business";
import { dataKeysForView, diffAppData, emptyAppData, isViewKey, makeAppDataPatch, makeAppDataSlice, POS_REMOTE_PAGING_CAPABILITY } from "../../src/domain/dataSlices";
import { normalizeProductServiceUnitsPerStockUnit, productServiceStockDeductible, productServiceUnit, requireConfirmedProductStockRule } from "../../src/domain/products";
import { appointmentEndAt, appointmentMatchesServiceCheckout, appointmentServiceIds } from "../../src/domain/appointments";
import { businessDateOf, businessDateToday, makeId, nowIso } from "../../src/domain/utils";
import { resolveStoreMutationTarget } from "../../src/domain/storeMutationTarget";
import { AI_VIDEO_PROVIDER_DEFAULT_RESOLUTIONS, DEFAULT_AI_VIDEO_RESOLUTION } from "../../src/domain/aiVideoDefaults";
import { D1BeautyDatabase, type D1DataTableName } from "../../src/cloudflare/d1Database";
import { buildSession, getSessionFromD1, loginWithD1, destroySessionInD1 } from "../../src/cloudflare/auth";
import type { D1DatabaseBinding } from "../../src/cloudflare/d1Types";

type Env = {
  DB: D1DatabaseBinding;
  R2_BUCKET?: R2BucketLike;
  YICH_R2?: R2BucketLike;
  ASSETS_BUCKET?: R2BucketLike;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_WORKER_SCRIPT_NAME?: string;
};

type JsonBody = Record<string, unknown>;
const requestJsonCache = new WeakMap<Request, Promise<JsonBody>>();
type MarketingTalkTopic = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source?: string;
  publishedAt?: string;
};
type R2ObjectLike = { key: string; size?: number };
type R2StoredObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  writeHttpMetadata?: (headers: Headers) => void;
};
type R2BucketLike = {
  list: (options?: { cursor?: string; limit?: number }) => Promise<{ objects: R2ObjectLike[]; truncated?: boolean; cursor?: string }>;
  get: (key: string) => Promise<R2StoredObjectLike | null>;
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | Blob | string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) => Promise<unknown>;
};

function shouldExposeAppVersion(clientVersion: string | null, manualUpdateCheck: boolean) {
  return !clientVersion || manualUpdateCheck || isVersionGreater(pkg.version, clientVersion);
}

function isVersionGreater(nextVersion: string, currentVersion: string) {
  const nextParts = versionParts(nextVersion);
  const currentParts = versionParts(currentVersion);
  const length = Math.max(nextParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = nextParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (nextPart > currentPart) return true;
    if (nextPart < currentPart) return false;
  }
  return false;
}

function versionParts(version: string) {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
type PagesFunction<Bindings> = (context: {
  request: Request;
  env: Bindings;
  waitUntil?: (promise: Promise<unknown>) => void;
}) => Response | Promise<Response>;

const aiImageGenerationMaxGlobalSlots = 4;
const aiImageGenerationLockTtlMs = 5 * 60 * 1000;
const androidApkR2Key = "releases/zhurongkftech-app.apk";

const customerSignatureWriteKeys = [
  "appointments",
  "orders",
  "memberCards",
  "memberCardTransactions",
  "customerSignatures",
] as const;

const appointmentMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "services",
  "staff",
  "appointments",
  "orders",
  "staffUnavailableSlots",
  "staffShifts",
] as const;

const appointmentCreateResponseKeys = ["appointments", "notifications"] as const;
const appointmentUpdateResponseKeys = ["appointments"] as const;
const onlineBookingConvertResponseKeys = ["customers", "appointments", "onlineBookingRequests"] as const;

const checkoutMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "customers",
  "services",
  "products",
  "inventoryBatches",
  "appointments",
  "orders",
  "memberCards",
  "inventoryLogs",
  "memberCardTransactions",
  "commissions",
  "dailyCloses",
  "approvalRequests",
  "customerSignatures",
  "operationLogs",
] as const;

const checkoutWriteKeys = [
  "customers",
  "products",
  "inventoryBatches",
  "appointments",
  "orders",
  "memberCards",
  "inventoryLogs",
  "memberCardTransactions",
  "commissions",
  "customerSignatures",
  "operationLogs",
] as const;

const checkoutResponseKeys = [
  "customers",
  "products",
  "inventoryBatches",
  "appointments",
  "orders",
  "memberCards",
  "inventoryLogs",
  "memberCardTransactions",
  "commissions",
  "customerSignatures",
  "dailyCloses",
] as const;

const orderRefundMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "services",
  "products",
  "inventoryBatches",
  "appointments",
  "orders",
  "refunds",
  "memberCards",
  "memberCardTransactions",
  "inventoryLogs",
  "commissions",
  "commissionSettlements",
  "dailyCloses",
  "approvalRequests",
  "customerSignatures",
  "operationLogs",
] as const;

const orderRefundWriteKeys = [
  "customers",
  "products",
  "inventoryBatches",
  "appointments",
  "orders",
  "refunds",
  "memberCards",
  "memberCardTransactions",
  "inventoryLogs",
  "commissions",
  "customerSignatures",
  "operationLogs",
] as const;

const storeMutationTargetKeys = [
  "storeProfiles", "customers", "staff", "services", "products", "suppliers", "memberCards", "appointments", "orders", "customerSignatures",
] as const;

const inventoryAdjustmentMutationKeys = [
  "storeProfiles",
  "authUsers",
  "products",
  "inventoryBatches",
  "inventoryLogs",
  "dailyCloses",
  "operationLogs",
  "notifications",
] as const;

const inventoryAdjustmentWriteKeys = [
  "products",
  "inventoryBatches",
  "inventoryLogs",
  "operationLogs",
  "notifications",
] as const;

const memberCardWriteKeys = [
  "customers",
  "memberCards",
  "memberCardTransactions",
  "operationLogs",
] as const;

const memberCardRefundWriteKeys = [
  "memberCards",
  "memberCardTransactions",
  "operationLogs",
] as const;

const customerMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "operationLogs",
] as const;

const customerWriteKeys = [
  "customers",
  "operationLogs",
] as const;

const tagMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "tagDefinitions",
  "operationLogs",
] as const;

const tagWriteKeys = [
  "customers",
  "tagDefinitions",
  "operationLogs",
] as const;

const serviceRecordMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "staff",
  "services",
  "products",
  "orders",
  "memberCardTransactions",
  "customerServiceRecords",
  "customerFollowUps",
  "notifications",
] as const;

const serviceRecordWriteKeys = [
  "customers",
  "customerServiceRecords",
  "customerFollowUps",
  "notifications",
] as const;

const followUpMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "staff",
  "customerFollowUps",
  "operationLogs",
] as const;

const followUpWriteKeys = [
  "customerFollowUps",
  "operationLogs",
] as const;

const serviceCatalogMutationKeys = [
  "storeProfiles",
  "authUsers",
  "services",
  "products",
  "orders",
  "operationLogs",
] as const;

const serviceCatalogWriteKeys = [
  "services",
  "orders",
  "operationLogs",
] as const;

const productCatalogMutationKeys = [
  "storeProfiles",
  "authUsers",
  "services",
  "products",
  "orders",
  "inventoryBatches",
  "inventoryLogs",
  "operationLogs",
] as const;

const productCatalogWriteKeys = [
  "products",
  "orders",
  "inventoryBatches",
  "inventoryLogs",
  "operationLogs",
] as const;

const supplierMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "suppliers",
] as const;

const supplierWriteKeys = [
  "suppliers",
] as const;

const purchaseMutationKeys = [
  "storeProfiles",
  "authUsers",
  "suppliers",
  "products",
  "inventoryBatches",
  "purchaseOrders",
  "inventoryLogs",
  "dailyCloses",
] as const;

const purchaseWriteKeys = [
  "suppliers",
  "products",
  "inventoryBatches",
  "purchaseOrders",
  "inventoryLogs",
] as const;

const stocktakeMutationKeys = [
  "storeProfiles",
  "authUsers",
  "products",
  "inventoryBatches",
  "stocktakes",
  "inventoryLogs",
  "dailyCloses",
] as const;

const stocktakeWriteKeys = [
  "products",
  "inventoryBatches",
  "stocktakes",
  "inventoryLogs",
] as const;

const restockLowMutationKeys = [
  "storeProfiles",
  "authUsers",
  "suppliers",
  "products",
  "inventoryBatches",
  "purchaseOrders",
  "inventoryLogs",
  "operationLogs",
  "dailyCloses",
] as const;

const restockLowWriteKeys = [
  "suppliers",
  "products",
  "inventoryBatches",
  "purchaseOrders",
  "inventoryLogs",
  "operationLogs",
] as const;

const notificationMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "notifications",
] as const;

const notificationWriteKeys = [
  "notifications",
] as const;

const accountProfileMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "systemConfigs",
  "operationLogs",
] as const;

const accountProfileWriteKeys = [
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const authUserMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const authUserWriteKeys = [
  "authUsers",
  "operationLogs",
] as const;

const systemConfigMutationKeys = [
  "systemConfigs",
  "operationLogs",
] as const;

const systemConfigWriteKeys = [
  "systemConfigs",
  "operationLogs",
] as const;

const storeStatusMutationKeys = [
  "storeProfiles",
  "operationLogs",
] as const;

const storeStatusWriteKeys = [
  "storeProfiles",
  "operationLogs",
] as const;

const storeProfileMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const storeProfileWriteKeys = [
  "storeProfiles",
  "operationLogs",
] as const;

const onlineStorefrontMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "services",
  "onlineStorefronts",
  "operationLogs",
] as const;

const onlineStorefrontWriteKeys = [
  "onlineStorefronts",
  "operationLogs",
] as const;

const staffMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const staffWriteKeys = [
  "staff",
  "operationLogs",
] as const;

const staffDeleteMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staffInvites",
  "staff",
  "appointments",
  "orders",
  "commissions",
  "staffShifts",
  "staffUnavailableSlots",
  "customerServiceRecords",
  "customerFollowUps",
  "operationLogs",
] as const;

const staffDeleteWriteKeys = [
  "authUsers",
  "staffInvites",
  "staff",
  "operationLogs",
] as const;

const staffInviteMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "staffInvites",
  "systemConfigs",
] as const;

const staffInviteWriteKeys = [
  "staffInvites",
] as const;

const storeOwnerInviteMutationKeys = [
  "authUsers",
  "storeOwnerInvites",
  "systemConfigs",
] as const;

const storeOwnerInviteWriteKeys = [
  "storeOwnerInvites",
] as const;

const staffScheduleMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "services",
  "appointments",
  "staffUnavailableSlots",
  "staffShifts",
  "operationLogs",
] as const;

const staffUnavailableWriteKeys = [
  "staffUnavailableSlots",
  "operationLogs",
] as const;

const staffShiftWriteKeys = [
  "staffShifts",
] as const;

const onlineBookingConvertMutationKeys = [
  "storeProfiles",
  "authUsers",
  "customers",
  "services",
  "staff",
  "appointments",
  "onlineBookingRequests",
  "staffUnavailableSlots",
  "staffShifts",
] as const;

const approvalMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "approvalRequests",
  "notifications",
  "operationLogs",
] as const;

const approvalCreateWriteKeys = [
  "approvalRequests",
  "notifications",
  "operationLogs",
] as const;

const approvalDecisionWriteKeys = [
  "approvalRequests",
  "operationLogs",
] as const;

const dailyCloseMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "orders",
  "refunds",
  "commissions",
  "memberCardTransactions",
  "dailyCloses",
  "operationLogs",
] as const;

const dailyCloseWriteKeys = [
  "dailyCloses",
  "operationLogs",
] as const;

const commissionSettleMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "commissions",
  "commissionSettlements",
  "operationLogs",
] as const;

const commissionSettleWriteKeys = [
  "commissions",
  "commissionSettlements",
  "operationLogs",
] as const;

const authPasswordMigrationKeys = [
  "authUsers",
] as const;

const registerStoreMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const registerStoreWriteKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "operationLogs",
] as const;

const joinInviteMutationKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "staffInvites",
  "storeOwnerInvites",
  "storeOwnerApplications",
  "operationLogs",
  "notifications",
] as const;

const joinInviteWriteKeys = [
  "authUsers",
  "staff",
  "staffInvites",
  "storeOwnerApplications",
  "operationLogs",
  "notifications",
] as const;

const publicOnlineBookingReadKeys = [
  "storeProfiles",
  "onlineStorefronts",
  "services",
  "staff",
  "appointments",
  "staffUnavailableSlots",
  "staffShifts",
  "onlineBookingRequests",
  "notifications",
] as const;

const publicOnlineBookingWriteKeys = [
  "onlineBookingRequests",
  "notifications",
] as const;

const storeOwnerApplicationDecisionKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "storeOwnerApplications",
  "storeOwnerInvites",
  "operationLogs",
] as const;

const storeOwnerApplicationDecisionWriteKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "storeOwnerApplications",
  "storeOwnerInvites",
  "operationLogs",
] as const;

const allDataKeys = [
  "storeProfiles",
  "onlineStorefronts",
  "authUsers",
  "systemConfigs",
  "staffInvites",
  "storeOwnerInvites",
  "storeOwnerApplications",
  "staff",
  "customers",
  "tagDefinitions",
  "services",
  "products",
  "inventoryBatches",
  "appointments",
  "onlineBookingRequests",
  "staffUnavailableSlots",
  "staffShifts",
  "memberCards",
  "distributors",
  "referralRelations",
  "orders",
  "refunds",
  "commissions",
  "distributionCommissions",
  "commissionSettlements",
  "inventoryLogs",
  "memberCardTransactions",
  "operationLogs",
  "marketingAiRecords",
  "notifications",
  "dailyCloses",
  "approvalRequests",
  "customerServiceRecords",
  "customerSignatures",
  "customerFollowUps",
  "suppliers",
  "purchaseOrders",
  "stocktakes",
] as const satisfies readonly D1DataTableName[];

const marketingAiDataKeys = [
  "storeProfiles",
  "authUsers",
  "staff",
  "systemConfigs",
  "marketingAiRecords",
  "operationLogs",
] as const;

export const onRequest: PagesFunction<Env> = async (context) => {
  const database = new D1BeautyDatabase(context.env.DB);

  try {
    const corsResponse = handleCors(context.request);
    if (corsResponse) return corsResponse;

    const url = new URL(context.request.url);
    const pathname = url.pathname;

    if ((context.request.method === "GET" || context.request.method === "HEAD") && pathname.startsWith("/api/assets/")) {
      return serveR2Asset(context.env, pathname, context.request.method);
    }

    if ((context.request.method === "GET" || context.request.method === "HEAD") && pathname === "/zhurongkftech-app.apk") {
      return serveAndroidApk(context.env, context.request.method);
    }

    if (context.request.method === "GET" && pathname === "/api/health") {
      const schema = await database.checkSchema();
      const clientVersion = url.searchParams.get("clientVersion");
      const manualUpdateCheck = url.searchParams.get("manualUpdateCheck") === "1";
      return sendJson(200, {
        ok: schema.ok,
        service: "yich-system-api",
        ...(shouldExposeAppVersion(clientVersion, manualUpdateCheck) ? { version: pkg.version } : {}),
        runtime: "cloudflare-d1",
        schema,
      });
    }

    await database.seedIfEmpty();

    if (context.request.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(context.request);
      const account = requiredString(body, "account");
      const plainPassword = requiredString(body, "password");

      const loginResult = await loginWithD1(context.env.DB, account, plainPassword, requestClientKey(context.request));

      // Auto-migrate legacy plaintext password to secure hash
      if (loginResult.needsPasswordMigration && loginResult.userIdNeedingMigration) {
        const currentData = await database.readDataTables(authPasswordMigrationKeys);
        const hashed = await hashPassword(plainPassword);
        const migratedUsers = currentData.authUsers.map((u) =>
          u.id === loginResult.userIdNeedingMigration ? { ...u, password: hashed } : u
        );
        await database.replaceTables({ ...currentData, authUsers: migratedUsers }, authPasswordMigrationKeys);
      }

      return sendJson(200, loginResult.session);
    }

    if (context.request.method === "POST" && pathname === "/api/auth/logout") {
      await destroySessionInD1(context.env.DB, context.request.headers.get("Authorization"));
      return sendJson(200, { ok: true });
    }

    if (context.request.method === "POST" && pathname === "/api/auth/register-store") {
      const body = await readJson(context.request);
      const plainPassword = requiredString(body, "password");
      const hashedPassword = await hashPassword(plainPassword);

      const timing = startMutationTiming("register-store");
      const currentData = await database.readDataTables(registerStoreMutationKeys);
      markMutationRead(timing);
      const nextData = registerStore(currentData, {
        storeName: requiredString(body, "storeName"),
        ownerName: requiredStringAny(body, ["ownerName", "name"]),
        phone: requiredString(body, "phone"),
        address: optionalString(body, "address"),
        account: requiredString(body, "account"),
        password: hashedPassword,
      });
      startMutationWrite(timing);
      await database.replaceTables(nextData, registerStoreWriteKeys);
      markMutationWrite(timing);

      const loginResult = await loginWithD1(context.env.DB, requiredString(body, "account"), plainPassword, requestClientKey(context.request));
      return withMutationTiming(sendJson(201, loginResult.session), timing, "full");
    }

    if (context.request.method === "POST" && pathname === "/api/auth/join-invite") {
      const body = await readJson(context.request);
      const plainPassword = requiredString(body, "password");
      const hashedPassword = await hashPassword(plainPassword);
      const inviteCode = requiredString(body, "inviteCode");

      const timing = startMutationTiming("join-invite");
      const currentData = await database.readDataTables(joinInviteMutationKeys);
      markMutationRead(timing);
      const isStoreOwnerInvite = isStoreOwnerInviteCode(currentData, inviteCode);
      const nextData = joinInviteByCode(currentData, {
        inviteCode,
        name: optionalStringAny(body, ["name", "ownerName"]) ?? "",
        password: hashedPassword,
        storeName: optionalString(body, "storeName"),
        phone: optionalString(body, "phone"),
        address: optionalString(body, "address"),
        account: optionalString(body, "account"),
      });
      startMutationWrite(timing);
      await database.replaceTables(nextData, joinInviteWriteKeys);
      markMutationWrite(timing);

      if (isStoreOwnerInvite) {
        const account = optionalString(body, "account");
        const application = [...(nextData.storeOwnerApplications ?? [])].find((item) => {
          if (item.status !== "待审批") return false;
          if (item.inviteCode.trim().toUpperCase() !== inviteCode.trim().toUpperCase()) return false;
          return account ? item.account === account : true;
        });
        return withMutationTiming(sendJson(202, {
          status: "pending_approval",
          message: "门店申请已提交，请等待管理员审批后再登录。",
          applicationId: application?.id,
        }), timing, "full");
      }

      const staffInvite = currentData.staffInvites.find((item) => item.inviteCode.trim().toUpperCase() === inviteCode.trim().toUpperCase());
      const joinedAccount = staffInvite?.account ?? (isStoreStaffInviteCode(currentData, inviteCode) ? optionalString(body, "account") : undefined);
      if (!joinedAccount) throw new Error("邀请账号不存在");
      return withMutationTiming(sendJson(202, {
        status: "pending_approval",
        message: "账号已提交，请等待店长审核通过后再登录。",
      }), timing, "full");
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/public/store/")) {
      const shareCode = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      return sendJson(200, publicStorePayload(await readPublicStorefrontData(database, shareCode), shareCode));
    }

    if (context.request.method === "POST" && pathname === "/api/public/online-booking-requests") {
      const timing = startMutationTiming("public-online-booking-create");
      const body = await readJson(context.request);
      const currentData = await readPublicStorefrontData(database, requiredString(body, "shareCode"), publicOnlineBookingReadKeys);
      markMutationRead(timing);
      const requestedData = createOnlineBookingRequest(currentData, {
        shareCode: requiredString(body, "shareCode"),
        customerName: requiredString(body, "customerName"),
        phone: requiredString(body, "phone"),
        serviceId: requiredString(body, "serviceId"),
        preferredAt: requiredString(body, "preferredAt"),
        note: optionalString(body, "note") ?? "",
      });
      const bookingRequest = requestedData.onlineBookingRequests[0];
      const nextData = addSystemNotification(requestedData, {
        title: "新的线上预约申请",
        desc: `${bookingRequest.customerName} 提交了到店预约意向`,
        view: "appointments",
        targetType: "onlineBookingRequest",
        targetId: bookingRequest.id,
        storeId: bookingRequest.storeId,
        audienceRoles: ["owner", "manager", "frontdesk"],
      });
      startMutationWrite(timing);
      if (bookingRequest.storeId) {
        await database.replaceStoreTables(bookingRequest.storeId, nextData, publicOnlineBookingWriteKeys);
      } else {
        await database.replaceTables(nextData, publicOnlineBookingWriteKeys);
      }
      markMutationWrite(timing);
      return withMutationTiming(sendJson(201, { ok: true }), timing, "scoped");
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/public/customer-signatures/")) {
      const token = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      return sendJson(200, publicSignaturePayload(await readPublicSignatureData(database, token), token));
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/public/customer-signatures/") && pathname.endsWith("/sign")) {
      const token = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const initialSignature = await database.readCustomerSignatureByToken(token);
      const storeId = initialSignature?.storeId ?? (initialSignature ? await database.resolveCustomerSignatureStoreId(initialSignature) : undefined);
      if (!storeId) throw new Error("签名记录未绑定门店，请联系门店重新生成签名链接");
      const lock = { storeId, ownerId: makeId("store-mutation") };
      if (!await acquireStoreMutationLock(database, lock.storeId, lock.ownerId)) {
        throw new Error("本门店正在处理另一笔库存或资金操作，请稍后重试");
      }
      try {
        const signature = await database.readCustomerSignatureByToken(token);
        if (!signature || (signature.storeId && signature.storeId !== storeId)) throw new Error("签名链接已失效");
        const currentData = {
          ...await database.readCustomerSignatureContext(storeId, signature),
          customerSignatures: [signature],
        };
        const nextData = signCustomerSignature(currentData, {
          token,
          signerName: requiredString(body, "signerName"),
          signatureText: requiredString(body, "signatureText"),
        });
        const signedSignature = nextData.customerSignatures.find((item) => item.token === token);
        if (!signedSignature) throw new Error("签名记录更新失败");
        await database.applyStoreTableChanges(storeId, currentData, nextData, customerSignatureWriteKeys);
        return sendJson(201, publicSignaturePayload(nextData, token));
      } finally {
        await database.releaseCheckoutStoreLock(lock.storeId, lock.ownerId);
      }
    }

    const session = await getSessionFromD1(context.env.DB, context.request.headers.get("Authorization"));
    if (!session) {
      return sendJson(401, { error: "请先登录" });
    }

    const storeMutationLocks: Array<{ storeId: string; ownerId: string }> = [];
    if (requiresStoreMutationLock(context.request.method, pathname)) {
      const targetData = session.user.role === "superadmin"
        ? await database.readDataTables(storeMutationTargetKeys)
        : undefined;
      const storeIds = session.user.role === "superadmin" && pathname === "/api/commissions/settle"
        ? targetData!.storeProfiles.map((store) => store.id).filter(Boolean).sort()
        : [session.user.role === "superadmin"
            ? resolveStoreMutationTarget(targetData!, pathname, await readJson(context.request))
            : await resolveSessionStoreId(database, session)];
      for (const storeId of storeIds) {
        const lock = { storeId, ownerId: makeId("store-mutation") };
        const acquired = await acquireStoreMutationLock(database, lock.storeId, lock.ownerId);
        if (!acquired) {
          for (const acquiredLock of [...storeMutationLocks].reverse()) {
            await database.releaseCheckoutStoreLock(acquiredLock.storeId, acquiredLock.ownerId);
          }
          throw new Error("本门店正在处理另一笔库存或资金操作，请稍后重试");
        }
        storeMutationLocks.push(lock);
      }
    }

    try {

    if (context.request.method === "GET" && pathname === "/api/auth/me") {
      return sendJson(200, session);
    }

    if (context.request.method === "POST" && pathname === "/api/account-avatar") {
      const upload = await uploadAccountAvatar(context.request, context.env, session);
      return sendJson(201, upload);
    }

    if (context.request.method === "PATCH" && pathname === "/api/account-profile") {
      const timing = startMutationTiming("account-profile-update");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, accountProfileMutationKeys);
      markMutationRead(timing);
      const updatedData = updateAccountProfile(currentData, {
        userId: session.user.id,
        name: requiredString(body, "name"),
        avatarUrl: optionalString(body, "avatarUrl"),
      });
      const nextData = addOperationLog(updatedData, {
        userId: session.user.id,
        action: "更新账号资料",
        targetType: "authUser",
        targetId: session.user.id,
        summary: `${requiredString(body, "name")} 更新账号资料`,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, accountProfileWriteKeys);
      markMutationWrite(timing);
      const updatedUser = nextData.authUsers.find((user) => user.id === session.user.id);
      if (!updatedUser) throw new Error("账号不存在");
      const nextSession = buildSession(session.token, updatedUser, nextData.systemConfigs);
      return withMutationTiming(sendJson(200, { session: nextSession, data: scopeDataForSession(nextData, nextSession) }), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/auth-users/") && pathname.endsWith("/status")) {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("auth-user-status-update");
      const userId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, authUserMutationKeys);
      markMutationRead(timing);
      assertCanManageAuthUser(currentData, session, userId);
      const nextData = updateAuthUserStatus(currentData, {
        userId,
        status: requiredString(body, "status") as "active" | "disabled" | "pending",
        operatedBy: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, authUserWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/auth-users/") && pathname.endsWith("/password")) {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("auth-user-password-reset");
      const userId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const resetPlainPassword = requiredString(body, "password");
      assertStrongResetPassword(resetPlainPassword);
      const currentData = await readMutationDataForRequest(database, context.request, session, authUserMutationKeys);
      markMutationRead(timing);
      assertCanManageAuthUser(currentData, session, userId);
      const nextData = resetAuthUserPassword(currentData, {
        userId,
        password: await hashPassword(resetPlainPassword),
        operatedBy: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, authUserWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/auth-users/") && pathname.endsWith("/ai-credits")) {
      if (session.user.role !== "superadmin") throw new Error("只有系统管理员可以调整 AI 积分");
      const timing = startMutationTiming("auth-user-ai-credits-update");
      const userId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, authUserMutationKeys);
      markMutationRead(timing);
      const nextData = updateAuthUserAiCredits(currentData, {
        userId,
        credits: optionalNumber(body, "credits") ?? 0,
        operatedBy: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, authUserWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "GET" && pathname === "/api/data") {
      requirePermission(session, "dashboard:view");
      return sendScopedData(context.request, 200, await readDataForRequest(database, context.request, session), session);
    }

    if (context.request.method === "GET" && pathname === "/api/pos/context") {
      requirePermission(session, "pos:manage");
      const storeId = await resolveSessionStoreId(database, session);
      const { dayStart, dayEnd } = requiredPosDayRange(url);
      return sendJson(200, await database.readPosContext(storeId, {
        dayStart,
        dayEnd,
        appointmentId: url.searchParams.get("appointmentId") || undefined,
        signatureId: url.searchParams.get("signatureId") || undefined,
      }));
    }

    if (context.request.method === "GET" && pathname === "/api/pos/cashier-flow") {
      requirePermission(session, "pos:manage");
      const storeId = await resolveSessionStoreId(database, session);
      return sendJson(200, await database.readCashierFlowPage(
        storeId,
        positiveIntegerQuery(url, "page", 1),
        positiveIntegerQuery(url, "pageSize", 50),
      ));
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/pos/cashier-flow/")) {
      requirePermission(session, "pos:manage");
      const storeId = await resolveSessionStoreId(database, session);
      const kind = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const id = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      if (kind !== "order" && kind !== "memberCard") throw new Error("流水类型不正确");
      const detail = await database.readCashierFlowDetail(storeId, kind, id);
      if (!detail) throw new Error("收银流水不存在");
      return sendJson(200, detail);
    }

    if (context.request.method === "GET" && pathname === "/api/usage/r2") {
      requirePermission(session, "settings:view");
      return sendJson(200, await readR2Usage(context.env));
    }

    if (context.request.method === "GET" && pathname === "/api/usage/worker") {
      requirePermission(session, "settings:view");
      return sendJson(200, await readWorkerUsage(context.env));
    }

    if (context.request.method === "GET" && pathname === "/api/data-quality") {
      requirePermission(session, "settings:view");
      return sendJson(200, previewFormalDataCleanup(await database.readData()));
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/chat") {
      assertSuperadminAiTester(session);
      const body = await readJson(context.request);
      const data = await readMarketingAiData(database, session);
      const result = await runAiChatTest(data, body);
      const config = aiGenerationConfigFromData(data).copy;
      const cost = textGenerationCost(config, result.usage);
      const record = aiTestMarketingRecord(data, session, body, {
        kind: "talk",
        provider: result.provider,
        model: result.model,
        text: result.text,
        status: "已完成",
        elapsedMs: result.elapsedMs,
        cost,
        costBreakdown: aiCostBreakdown({ text: cost }),
      });
      await database.appendMarketingAiResult({ record, log: marketingAiOperationLog(session, record) });
      return sendJson(200, { ...result, cost, record });
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/image") {
      assertSuperadminAiTester(session);
      const body = await readJson(context.request);
      const data = await readMarketingAiData(database, session);
      const startedAt = Date.now();
      try {
        const result = await runAiImageTest(data, body);
        let record = aiTestMarketingRecord(data, session, body, {
          kind: "image",
          provider: result.provider,
          model: result.model,
          imageDataUrl: result.imageDataUrl,
          status: "已完成",
          elapsedMs: result.elapsedMs,
          cost: result.cost,
          costBreakdown: aiCostBreakdown({ image: result.cost }),
        });
        if (record.imageDataUrl) {
          const storedImageUrl = await storeMarketingAiImage(context.env, record, record.imageDataUrl);
          record = { ...record, imageDataUrl: storedImageUrl };
        }
        await database.appendMarketingAiResult({ record, log: marketingAiOperationLog(session, record) });
        return sendJson(200, { ...result, imageDataUrl: record.imageDataUrl ?? result.imageDataUrl, record });
      } catch (error) {
        if (isOpenAiImageRuntimeError(error)) {
          const result = aiImageFailureResult(data, body, error, startedAt);
          const record = aiTestMarketingRecord(data, session, body, {
            kind: "image",
            provider: result.provider,
            model: result.model,
            status: "生成失败",
            errorMessage: result.errorMessage,
            text: result.errorMessage,
            elapsedMs: result.elapsedMs,
            cost: result.cost,
            costBreakdown: aiCostBreakdown({ image: result.cost }),
          });
          await database.appendMarketingAiResult({ record, log: marketingAiOperationLog(session, record) });
          return sendJson(200, { ...result, record });
        }
        throw error;
      }
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/video") {
      assertSuperadminAiTester(session);
      return sendJson(200, await runAiVideoTest(await readMarketingAiData(database, session), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/video-status") {
      assertSuperadminAiTester(session);
      return sendJson(200, await runAiVideoStatusTest(await readMarketingAiData(database, session), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-ai/analyze-product-image") {
      requirePermission(session, "marketing:manage");
      const data = await readMarketingAiData(database, session);
      assertMarketingAiAllowed(data, session, "video");
      return sendJson(200, await runMarketingProductImageAnalysis(data, await readJson(context.request)));
    }

    if (context.request.method === "GET" && pathname === "/api/marketing-ai/talk-topics") {
      requirePermission(session, "marketing:manage");
      return sendJson(200, await fetchMarketingTalkTopics());
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-ai/generate") {
      requirePermission(session, "marketing:manage");
      const rawBody = await readJson(context.request);
      const kind = requiredString(rawBody, "kind") as MarketingAiKind;
      const body = normalizeMarketingAiGenerateBody(rawBody, kind);
      const startedAt = Date.now();
      let currentData = await readMarketingAiData(database, session);
      assertMarketingAiGeneratePreflight(currentData, session, kind);
      assertMarketingAiGenerateBodyReady(body, kind);
      const duplicateVideoRecord = findDuplicateMarketingVideoRecord(currentData, session, body);
      if (duplicateVideoRecord) throw new Error("同一账号已经用这张产品图提交过视频生成，请到生成记录查看，不能重复发起以免重复扣积分");
      const locks = await acquireAiGenerationLocks(database, session, kind);
      let pendingRecord: MarketingAiRecord | undefined;
      try {
        currentData = await readMarketingAiData(database, session);
        const lockedDuplicateVideoRecord = findDuplicateMarketingVideoRecord(currentData, session, body);
        if (lockedDuplicateVideoRecord) throw new Error("同一账号已经用这张产品图提交过视频生成，请到生成记录查看，不能重复发起以免重复扣积分");
        pendingRecord = marketingAiRecord(currentData, session, body, {
          kind,
          ...marketingAiPendingProvider(currentData, kind, body),
          status: "生成中",
        });
        await database.upsertMarketingAiRecord(pendingRecord);
        const result = await runMarketingAiGenerate(currentData, session, body);
        const resultVideoUrl = kind === "video" && "videoUrl" in result ? result.videoUrl : undefined;
        const resultProviderStatus = kind === "video" && "status" in result ? result.status : undefined;
        const resultStatus = kind === "video" && !resultVideoUrl ? resultProviderStatus || "任务已提交" : "已完成";
        let record = {
          ...marketingAiRecord(currentData, session, body, { ...result, status: resultStatus }),
          id: pendingRecord.id,
          createdAt: pendingRecord.createdAt,
        };
        let responseImageDataUrl: string | undefined;
        if (record.imageDataUrl) {
          const storedImageUrl = await storeMarketingAiImage(context.env, record, record.imageDataUrl);
          record = { ...record, imageDataUrl: storedImageUrl };
          responseImageDataUrl = storedImageUrl;
        }
        const log = marketingAiOperationLog(session, record);
        await database.appendMarketingAiResult({
          record,
          log,
          consumeCreditUserId: result.billing?.source === "credit" ? session.user.id : undefined,
          consumeCreditAmount: result.billing?.source === "credit" ? result.billing.creditsCharged : undefined,
        });
        return sendJson(200, { ...result, ...(responseImageDataUrl ? { imageDataUrl: responseImageDataUrl } : {}), record });
        } catch (error) {
          if (!pendingRecord) throw error;
        const currentData = await readMarketingAiData(database, session);
        const message = error instanceof Error ? error.message : "AI 生成失败";
        const failureCost = marketingAiFailureCost(currentData, body, kind, error);
        const failureRecord = marketingAiRecord(currentData, session, body, {
          kind,
          ...marketingAiPendingProvider(currentData, kind, body),
          text: kind === "video" ? undefined : message,
          status: "生成失败",
          errorMessage: message,
          elapsedMs: Date.now() - startedAt,
          cost: failureCost,
          costBreakdown: aiCostBreakdown({ image: failureCost }),
        });
        if (pendingRecord) {
          failureRecord.id = pendingRecord.id;
          failureRecord.createdAt = pendingRecord.createdAt;
        }
        await database.appendMarketingAiResult({
          record: failureRecord,
          log: marketingAiOperationLog(session, failureRecord),
        });
        return sendJson(200, {
          kind,
          provider: failureRecord.provider,
          model: failureRecord.model,
          text: kind === "video" ? undefined : message,
          status: "生成失败",
          errorMessage: message,
          cost: failureRecord.cost,
          elapsedMs: failureRecord.elapsedMs,
          record: failureRecord,
        });
      } finally {
        if (locks) await database.releaseAiGenerationLocks(locks);
      }
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-ai/video-status") {
      requirePermission(session, "marketing:manage");
      const body = await readJson(context.request);
      const recordId = requiredTrimmedText(body, "recordId", 120);
      const currentData = await readMarketingAiData(database, session);
      const record = currentData.marketingAiRecords.find((item) => item.id === recordId);
      if (!record || record.kind !== "video") throw new Error("视频生成记录不存在");
      if (session.user.role !== "superadmin" && record.storeId !== sessionStoreId(currentData, session)) {
        throw new Error("只能刷新本门店的视频记录");
      }
      if (!record.taskId) throw new Error("这条视频记录没有任务 ID，无法刷新状态");
      const provider = record.provider === "seedance" || record.provider === "kling" || record.provider === "hailuo" || record.provider === "grok" ? record.provider : undefined;
      if (!provider) throw new Error("视频供应商信息不完整，无法刷新状态");
      const result = await runAiVideoStatusTest(currentData, { provider, taskId: record.taskId });
      const nextRecord: MarketingAiRecord = {
        ...record,
        provider: result.provider,
        model: result.model,
        videoUrl: result.videoUrl || record.videoUrl,
        status: result.videoUrl ? "已完成" : result.status || record.status || "任务已提交",
        errorMessage: record.errorMessage,
        elapsedMs: result.elapsedMs,
      };
      await database.upsertMarketingAiRecord(nextRecord);
      return sendJson(200, { kind: "video", ...result, record: nextRecord });
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-ai/talk-video") {
      requirePermission(session, "marketing:manage");
      const body = await readJson(context.request);
      const currentData = await readMarketingAiData(database, session);
      const result = await saveMarketingTalkVideoRecord(context.env, currentData, session, body);
      await database.appendMarketingAiResult({
        record: result.record,
        log: marketingAiOperationLog(session, result.record),
      });
      return sendJson(200, result);
    }

    if (context.request.method === "POST" && pathname === "/api/data-quality/cleanup") {
      requirePermission(session, "settings:view");
      if (session.user.role !== "owner") {
        return sendJson(403, { error: "当前账号无权限清理正式库数据" });
      }
      const body = await readJson(context.request);
      if (requiredString(body, "confirm") !== "清理非正式数据") {
        return sendJson(400, { error: "确认短语不正确" });
      }
      const result = cleanupFormalData(await database.readData());
      const nextData = addOperationLog(result.data, {
        userId: session.user.id,
        action: "清理非正式数据",
        targetType: "dataQuality",
        targetId: "formal-cleanup",
        summary: `${session.user.name} 清理巡检命中的非正式数据`,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/read")) {
      const timing = startMutationTiming("notification-read");
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const currentData = await readMutationDataForRequest(database, context.request, session, notificationMutationKeys);
      markMutationRead(timing);
      const nextData = markNotificationRead(currentData, { notificationId, userId: session.user.id });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, notificationWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/archive")) {
      const timing = startMutationTiming("notification-archive");
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const currentData = await readMutationDataForRequest(database, context.request, session, notificationMutationKeys);
      markMutationRead(timing);
      const nextData = archiveNotification(currentData, { notificationId, userId: session.user.id });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, notificationWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/notifications/read-all") {
      const timing = startMutationTiming("notification-read-all");
      const currentData = await readMutationDataForRequest(database, context.request, session, notificationMutationKeys);
      markMutationRead(timing);
      const nextData = markAllVisibleNotificationsRead(currentData, {
        userId: session.user.id,
        role: session.user.role,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, notificationWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/system-configs/")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以修改系统配置");
      }
      const timing = startMutationTiming("system-config-update");
      const key = decodeURIComponent(pathname.split("/").at(-1) ?? "") as SystemConfigKey;
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, systemConfigMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(
        currentData,
        session,
        {
          action: "更新系统配置",
          targetType: "systemConfig",
          targetId: key,
          summary: `${session.user.name} 更新系统配置 ${key}`,
        },
        (data) => updateSystemConfig(data, { key, value: requiredString(body, "value"), updatedBy: session.user.id }),
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, systemConfigWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/stores/") && pathname.endsWith("/status")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以管理门店状态");
      }
      const timing = startMutationTiming("store-status-update");
      const storeId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeStatusMutationKeys);
      markMutationRead(timing);
      const nextData = updateStoreStatus(currentData, {
        storeId,
        status: requiredString(body, "status") as "active" | "disabled",
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeStatusWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname === "/api/ai-usage-permissions") {
      requirePermission(session, "settings:view");
      const timing = startMutationTiming("ai-usage-permissions-update");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeProfileMutationKeys);
      markMutationRead(timing);
      const targetStoreId = session.user.role === "superadmin" ? requiredString(body, "storeId") : sessionStoreId(currentData, session);
      const nextData = addOperationLog(
        updateStoreAiUsagePermissions(currentData, {
          storeId: targetStoreId,
          permissions: body.permissions,
        }),
        {
          userId: session.user.id,
          action: "更新AI使用权限",
          targetType: "store",
          targetId: targetStoreId ?? "primary",
          summary: `${session.user.name} 更新门店 AI 使用权限`,
        },
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeProfileWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname === "/api/operational-permissions") {
      requirePermission(session, "settings:view");
      const timing = startMutationTiming("operational-permissions-update");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeProfileMutationKeys);
      markMutationRead(timing);
      const targetStoreId = session.user.role === "superadmin" ? requiredString(body, "storeId") : sessionStoreId(currentData, session);
      const permissions = normalizeStoreOperationalPermissions(body.permissions);
      const nextData = addOperationLog(
        updateStoreOperationalPermissions(currentData, {
          storeId: targetStoreId,
          permissions,
        }),
        {
          userId: session.user.id,
          action: "更新门店权限",
          targetType: "store",
          targetId: targetStoreId ?? "primary",
          summary: `${session.user.name} 更新预约可见范围`,
        },
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeProfileWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname === "/api/store-profile") {
      requirePermission(session, "settings:view");
      const timing = startMutationTiming("store-profile-update");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeProfileMutationKeys);
      markMutationRead(timing);
      const nextData = addOperationLog(
        updateStoreProfile(currentData, {
          storeId: sessionStoreId(currentData, session),
          name: requiredString(body, "name"),
          phone: requiredString(body, "phone"),
          address: optionalString(body, "address") ?? "",
          businessHours: requiredString(body, "businessHours"),
          roomNames: optionalStringArray(body, "roomNames"),
          maintenanceRoomNames: optionalStringArray(body, "maintenanceRoomNames"),
          maintenanceRoomCount: optionalNumber(body, "maintenanceRoomCount"),
        }),
        {
          userId: session.user.id,
          action: "更新门店资料",
          targetType: "store",
          targetId: "primary",
          summary: `${session.user.name} 更新门店基础资料`,
        },
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeProfileWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/staff") {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("staff-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, staffMutationKeys);
      markMutationRead(timing);
      const nextData = addOperationLog(
        addStaffMember(currentData, {
          storeId: sessionStoreId(currentData, session),
          name: requiredString(body, "name"),
          phone: requiredString(body, "phone"),
          role: requiredString(body, "role"),
          baseSalary: optionalNumber(body, "baseSalary"),
          commissionRate: optionalNumber(body, "commissionRate"),
        }),
        {
          userId: session.user.id,
          action: "新增员工",
          targetType: "staff",
          targetId: "latest",
          summary: `${session.user.name} 新增员工 ${requiredString(body, "name")}`,
        },
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff/")) {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("staff-update");
      const staffId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, staffMutationKeys);
      markMutationRead(timing);
      const nextData = addOperationLog(
        updateStaffMember(currentData, {
          staffId,
          name: optionalString(body, "name"),
          phone: optionalString(body, "phone"),
          role: optionalString(body, "role"),
          status: optionalString(body, "status") as "active" | "inactive" | undefined,
          baseSalary: optionalNumber(body, "baseSalary"),
          commissionRate: optionalNumber(body, "commissionRate"),
        }),
        {
          userId: session.user.id,
          action: "更新员工",
          targetType: "staff",
          targetId: staffId,
          summary: `${session.user.name} 更新员工资料`,
        },
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "DELETE" && pathname.startsWith("/api/staff/")) {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("staff-delete");
      const staffId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const currentData = await readMutationDataForRequest(database, context.request, session, staffDeleteMutationKeys);
      markMutationRead(timing);
      assertCanManageStaff(currentData, session, staffId);
      const nextData = deleteStaffMember(currentData, {
        staffId,
        operatedBy: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffDeleteWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/staff-invites") {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("staff-invite-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, staffInviteMutationKeys);
      markMutationRead(timing);
      const nextData = createStaffInvite(currentData, {
        staffId: requiredString(body, "staffId"),
        account: requiredString(body, "account"),
        role: requiredString(body, "role") as UserRole,
        createdBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffInviteWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/store-owner-invites") {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以邀请门店老板");
      }
      const timing = startMutationTiming("store-owner-invite-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeOwnerInviteMutationKeys);
      markMutationRead(timing);
      const nextData = createStoreOwnerInvite(currentData, {
        storeName: requiredString(body, "storeName"),
        ownerName: requiredString(body, "ownerName"),
        phone: requiredString(body, "phone"),
        address: optionalString(body, "address"),
        account: requiredString(body, "account"),
        createdBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeOwnerInviteWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/store-owner-applications/")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以审批门店申请");
      }
      const timing = startMutationTiming("store-owner-application-decision");
      const applicationId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, storeOwnerApplicationDecisionKeys);
      markMutationRead(timing);
      const nextData = decideStoreOwnerApplication(currentData, {
        applicationId,
        userId: session.user.id,
        approved: optionalBoolean(body, "approved") ?? true,
        rejectReason: optionalString(body, "rejectReason"),
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, storeOwnerApplicationDecisionWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff-invites/")) {
      requirePermission(session, "staff:manage");
      const timing = startMutationTiming("staff-invite-revoke");
      const inviteId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const currentData = await readMutationDataForRequest(database, context.request, session, staffInviteMutationKeys);
      markMutationRead(timing);
      const nextData = revokeStaffInvite(currentData, {
        inviteId,
        revokedBy: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffInviteWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/online-storefront") {
      requirePermission(session, "settings:view");
      const timing = startMutationTiming("online-storefront-update");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, onlineStorefrontMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "更新线上店铺",
        targetType: "onlineStorefront",
        targetId: "current",
        summary: `${session.user.name} 更新线上店铺分享配置`,
      }, (data) =>
        upsertOnlineStorefront(data, {
          storeId: sessionStoreId(data, session),
          shareCode: requiredString(body, "shareCode"),
          status: optionalString(body, "status") as "启用" | "停用" | undefined,
          headline: requiredString(body, "headline"),
          description: optionalString(body, "description") ?? "",
          enabledServiceIds: optionalStringArray(body, "enabledServiceIds") ?? [],
        }),
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, onlineStorefrontWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/checkout") {
      requirePermission(session, "pos:manage");
      const timing = startMutationTiming("checkout");
      const body = await readJson(context.request);
      const checkoutRequestId = optionalString(body, "checkoutRequestId");
      const currentData = await readRequiredMutationData(database, session, checkoutMutationKeys);
      const checkoutStoreId = sessionStoreId(currentData, session);
      markMutationRead(timing);
      let checkoutReserved = false;
      try {
        const checkoutAt = nowIso();
        if (checkoutRequestId) {
          checkoutReserved = await database.reserveCheckoutSubmission(checkoutRequestId, checkoutAt);
          if (!checkoutReserved) throw new Error("检测到刚刚已提交相同收银请求，请勿重复提交");
        }
        await assertNoPersistedAppointmentCheckout(database, currentData, checkoutStoreId, body, checkoutAt);
        const checkedOutData = checkoutOrder(currentData, {
          storeId: checkoutStoreId,
          customerId: optionalString(body, "customerId"),
          guestName: optionalString(body, "guestName"),
          guestPhone: optionalString(body, "guestPhone"),
          staffId: requiredString(body, "staffId"),
          collaboratorStaffIds: optionalStringArray(body, "collaboratorStaffIds"),
          serviceId: optionalString(body, "serviceId"),
          serviceIds: optionalStringArray(body, "serviceIds"),
          serviceCardSelections: optionalServiceCardSelections(body),
          productId: optionalString(body, "productId"),
          giftProductId: optionalString(body, "giftProductId"),
          productItems: optionalProductItems(body, "productItems"),
          giftProductItems: optionalProductItems(body, "giftProductItems"),
          discountAmount: optionalNumber(body, "discountAmount"),
          adjustmentReason: optionalString(body, "adjustmentReason"),
          approvalId: optionalString(body, "approvalId"),
          appointmentId: optionalString(body, "appointmentId"),
          payMethod: requiredString(body, "payMethod") as Order["payMethod"],
          cardId: optionalString(body, "cardId"),
          requestedBy: session.user.id,
        });
        const nextData = addOperationLog(
          checkedOutData,
          {
            userId: session.user.id,
            action: "开单收银",
            targetType: "order",
            targetId: "latest",
            summary: `${session.user.name} 完成开单收银`,
          },
        );
        startMutationWrite(timing);
        await persistDataTableChanges(database, session, currentData, nextData, checkoutWriteKeys);
        markMutationWrite(timing);
        return withMutationTiming(sendMutationPatch(context.request, 201, currentData, nextData, session, checkoutResponseKeys), timing, "scoped");
      } catch (caught) {
        if (checkoutRequestId && checkoutReserved) await database.releaseCheckoutSubmission(checkoutRequestId);
        if (isActiveAppointmentUniqueError(caught)) {
          throw new Error("该预约已生成收银单，请勿重复开单");
        }
        throw caught;
      }
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/refund")) {
      requirePermission(session, "pos:manage");
      const timing = startMutationTiming("order-refund");
      const orderId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, orderRefundMutationKeys);
      markMutationRead(timing);
      const nextData = refundOrder(currentData, {
        storeId: sessionStoreId(currentData, session),
        orderId,
        reason: optionalString(body, "reason") ?? "门店退款",
        userId: session.user.id,
        amount: optionalNumber(body, "amount"),
        approvalId: optionalString(body, "approvalId"),
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, orderRefundWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/inventory/adjust") {
      requirePermission(session, "inventory:manage");
      const timing = startMutationTiming("inventory-adjust");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, inventoryAdjustmentMutationKeys);
      markMutationRead(timing);
      const adjustedData = addOperationLog(
        adjustInventory(currentData, {
          storeId: sessionStoreId(currentData, session),
          productId: requiredString(body, "productId"),
          type: requiredString(body, "type") as InventoryLog["type"],
          quantity: requiredNumber(body, "quantity"),
          unitCost: optionalNumber(body, "unitCost"),
          note: optionalString(body, "note"),
          expiryAt: optionalString(body, "expiryAt"),
        }),
        {
          userId: session.user.id,
          action: "库存调整",
          targetType: "product",
          targetId: requiredString(body, "productId"),
          summary: `${session.user.name} ${requiredString(body, "type")} ${requiredNumber(body, "quantity")}`,
        },
      );
      const product = adjustedData.products.find((item) => item.id === requiredString(body, "productId"));
      const nextData = product && product.stock <= product.warningStock
        ? addSystemNotification(adjustedData, {
            title: "库存低于预警值",
            desc: `${product.name} 当前库存 ${product.stock}${product.unit}`,
            view: "inventory",
            targetType: "product",
            targetId: product.id,
            storeId: product.storeId,
            audienceRoles: ["owner", "manager"],
          })
        : adjustedData;
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, inventoryAdjustmentWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/appointments") {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("appointment-create");
      const body = await readJson(context.request);
      const requestedStaffId = requiredString(body, "staffId");
      const baseData = await readRequiredMutationData(database, session, appointmentMutationKeys);
      markMutationRead(timing);
      let appointedData = createAppointment(
        baseData,
        {
          storeId: sessionStoreId(baseData, session),
          customerId: requiredString(body, "customerId"),
          staffId: requestedStaffId,
          serviceId: optionalString(body, "serviceId"),
          serviceIds: optionalStringArray(body, "serviceIds"),
          startAt: requiredString(body, "startAt"),
          endAt: optionalString(body, "endAt"),
          roomName: requiredString(body, "roomName"),
          note: optionalString(body, "note") ?? "",
        },
      );
      const appointment = appointedData.appointments[0];
      const customer = appointedData.customers.find((item) => item.id === appointment.customerId);
      const staff = appointedData.staff.find((item) => item.id === appointment.staffId);
      const service = appointedData.services.find((item) => item.id === appointment.serviceId);
      const serviceNames = (appointment.serviceIds?.length ? appointment.serviceIds : [appointment.serviceId])
        .map((serviceId) => appointedData.services.find((item) => item.id === serviceId)?.name)
        .filter(Boolean)
        .join("、") || "到店确认项目";
      appointedData = addOperationLog(appointedData, {
        userId: session.user.id,
        action: "新增预约",
        targetType: "appointment",
        targetId: appointment.id,
        summary: `${session.user.name} 新增预约：${customer?.name ?? "客户"} · ${staff?.name ?? "服务人员"} · ${serviceNames} · ${shortTimeText(appointment.startAt)}-${shortClockText(appointment.endAt)}`,
      });
      const nextData = addSystemNotification(appointedData, {
        title: "新的到店预约",
        desc: `${customer?.name ?? "客户"} · ${serviceNames || service?.name || "项目"} · ${shortTimeText(appointment.startAt)}`,
        view: "appointments",
        targetType: "appointment",
        targetId: appointment.id,
        audienceRoles: ["owner", "manager", "frontdesk", "therapist"],
        staffId: appointment.staffId,
      });
      startMutationWrite(timing);
      await persistAppointmentMutation(database, baseData, nextData);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 201, baseData, nextData, session, appointmentCreateResponseKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/staff-unavailable-slots") {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("staff-unavailable-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, staffScheduleMutationKeys);
      markMutationRead(timing);
      const nextData = createStaffUnavailableSlot(currentData, {
        storeId: sessionStoreId(currentData, session),
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        reason: optionalString(body, "reason") ?? "不可预约",
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffUnavailableWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/staff-shifts") {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("staff-shift-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, staffScheduleMutationKeys);
      markMutationRead(timing);
      const nextData = createStaffShift(currentData, {
        storeId: sessionStoreId(currentData, session),
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        note: optionalString(body, "note") ?? "门店班次",
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, staffShiftWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/appointments/") && pathname.endsWith("/reschedule")) {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("appointment-reschedule");
      const appointmentId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const requestedStaffId = optionalString(body, "staffId");
      const currentData = await readRequiredMutationData(database, session, appointmentMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "改约",
        targetType: "appointment",
        targetId: appointmentId,
        summary: `${session.user.name} 调整预约时间`,
      }, (data) =>
        rescheduleAppointment(data, {
          appointmentId,
          staffId: requestedStaffId,
          serviceId: optionalString(body, "serviceId"),
          serviceIds: optionalStringArray(body, "serviceIds"),
          startAt: requiredString(body, "startAt"),
          endAt: optionalString(body, "endAt"),
          roomName: optionalString(body, "roomName"),
          note: optionalString(body, "note"),
        }),
      );
      startMutationWrite(timing);
      await persistAppointmentMutation(database, currentData, nextData);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 200, currentData, nextData, session, appointmentUpdateResponseKeys), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/appointments/")) {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("appointment-status-update");
      const appointmentId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const status = requiredString(body, "status") as Appointment["status"];
      const currentData = await readRequiredMutationData(database, session, appointmentMutationKeys);
      markMutationRead(timing);
      if (status === "已取消" && currentData.orders.some((order) => order.appointmentId === appointmentId && order.status !== "已退款")) {
        throw new Error("该预约已有有效收银单，不能取消；如需处理请先退款");
      }
      const nextData = updateData(currentData, session, {
        action: "更新预约状态",
        targetType: "appointment",
        targetId: appointmentId,
        summary: `${session.user.name} 将预约状态改为 ${status}`,
      }, (data) => updateAppointmentStatus(data, { appointmentId, status, reason: optionalString(body, "reason") }));
      startMutationWrite(timing);
      await persistAppointmentMutation(database, currentData, nextData);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 200, currentData, nextData, session, appointmentUpdateResponseKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/online-booking-requests/") && pathname.endsWith("/convert")) {
      requirePermission(session, "appointments:manage");
      const timing = startMutationTiming("online-booking-convert");
      const requestId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await readRequiredMutationData(database, session, onlineBookingConvertMutationKeys);
      markMutationRead(timing);
      const nextData = convertOnlineBookingRequest(currentData, {
        requestId,
        staffId: requiredString(body, "staffId"),
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistAppointmentMutation(database, currentData, nextData);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 200, currentData, nextData, session, onlineBookingConvertResponseKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/customers") {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("customer-create");
      const body = await readJson(context.request);
      const customerPhone = requireMobilePhone(requiredString(body, "phone"));
      const currentData = await readMutationDataForRequest(database, context.request, session, customerMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "新增客户",
        targetType: "customer",
        targetId: "latest",
        summary: `${session.user.name} 新增客户 ${requiredString(body, "name")}`,
      }, (data) => ({
        ...data,
        customers: [
          {
            id: makeId("c"),
            storeId: sessionStoreId(data, session),
            name: requiredString(body, "name"),
            phone: customerPhone,
            level: optionalString(body, "level") ?? "普通会员",
            source: optionalString(body, "source") ?? "门店登记",
            tags: ["新客"],
            lastVisit: nowIso(),
          },
          ...data.customers,
        ],
      }));
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, customerWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/customers/")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("customer-update");
      const customerId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, customerMutationKeys);
      markMutationRead(timing);
      const currentCustomer = currentData.customers.find((customer) => customer.id === customerId);
      if (!currentCustomer) throw new Error("客户不存在");
      const rawPhone = optionalString(body, "phone");
      const nextPhone = rawPhone === undefined ? undefined : requireMobilePhone(rawPhone);
      const nextData = updateData(currentData, session, {
        action: "更新客户资料",
        targetType: "customer",
        targetId: customerId,
        summary: customerUpdateSummary(session.user.name, currentCustomer, body),
      }, (data) => {
        if (!data.customers.some((customer) => customer.id === customerId)) throw new Error("客户不存在");
        return {
          ...data,
          customers: data.customers.map((customer) =>
            customer.id === customerId
              ? {
                  ...customer,
                  name: optionalString(body, "name") ?? customer.name,
                  phone: nextPhone ?? customer.phone,
                  level: optionalString(body, "level") ?? customer.level,
                  source: optionalString(body, "source") ?? customer.source,
                  tags: optionalStringArray(body, "tags") ?? customer.tags,
                  birthday: patchText(body, "birthday", customer.birthday ?? "") || undefined,
                  note: patchText(body, "note", customer.note ?? "") || undefined,
                }
              : customer,
          ),
        };
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, customerWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/tags") {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("tag-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, tagMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "新增标签",
        targetType: "tag",
        targetId: "latest",
        summary: `${session.user.name} 新增${requiredString(body, "scope")}标签 ${requiredString(body, "name")}`,
      }, (data) =>
        createTagDefinition(data, {
          storeId: sessionStoreId(data, session),
          name: requiredString(body, "name"),
          scope: requiredString(body, "scope") as TagScope,
          color: optionalString(body, "color"),
        }),
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, tagWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/tags/")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("tag-update");
      const tagId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, tagMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "更新标签",
        targetType: "tag",
        targetId: tagId,
        summary: `${session.user.name} 更新标签`,
      }, (data) =>
        updateTagDefinition(data, {
          tagId,
          name: optionalString(body, "name"),
          color: optionalString(body, "color"),
          status: optionalString(body, "status") as "启用" | "停用" | undefined,
        }),
      );
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, tagWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/member-cards") {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-open");
      const body = await readJson(context.request);
      const openCardRequestId = optionalString(body, "openCardRequestId");
      const storeId = await resolveSessionStoreId(database, session);
      if (!storeId) throw new Error("请使用已绑定门店的账号开卡");
      if (openCardRequestId) {
        const existingResult = await database.readMemberCardSubmissionResult(openCardRequestId, storeId);
        if (existingResult) {
          markMutationRead(timing);
          return withMutationTiming(sendMemberCardOpenPatch(context.request, 200, existingResult), timing, "scoped");
        }
      }
      const currentData = await database.readMemberCardOpenData(storeId, {
        customerId: optionalString(body, "customerId"),
        customerPhone: optionalString(body, "customerPhone"),
      });
      markMutationRead(timing);
      const nextData = openMemberCard(currentData, {
        storeId,
        customerId: optionalString(body, "customerId"),
        customerName: optionalString(body, "customerName"),
        customerPhone: optionalString(body, "customerPhone"),
        customerBirthday: optionalString(body, "customerBirthday"),
        customerNote: optionalString(body, "customerNote"),
        name: optionalString(body, "name"),
        type: optionalString(body, "type") as "储值卡" | "次数卡" | "套餐卡" | "折扣卡" | undefined,
        balance: optionalNumber(body, "balance"),
        remainingTimes: optionalNumber(body, "remainingTimes"),
        discountRate: optionalNumber(body, "discountRate"),
        benefitText: optionalString(body, "benefitText"),
        serviceId: optionalString(body, "serviceId"),
        serviceIds: optionalStringArray(body, "serviceIds"),
        serviceEntitlements: optionalMemberCardServiceEntitlements(body),
        paidAmount: optionalNumber(body, "paidAmount"),
        payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
        expiresAt: optionalString(body, "expiresAt"),
        note: optionalString(body, "note"),
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      const customer = nextData.customers.find((item) => item.id === nextData.memberCards[0]?.customerId);
      const memberCard = nextData.memberCards[0];
      const transaction = nextData.memberCardTransactions[0];
      const operationLog = nextData.operationLogs[0];
      const signature = nextData.customerSignatures[0];
      if (!customer || !memberCard || !transaction || !operationLog || !signature) throw new Error("开卡数据生成失败");
      const reserved = openCardRequestId
        ? await database.reserveMemberCardSubmission(openCardRequestId, storeId, nowIso())
        : true;
      if (!reserved) {
        const existingResult = openCardRequestId
          ? await database.readMemberCardSubmissionResult(openCardRequestId, storeId)
          : undefined;
        if (existingResult) return withMutationTiming(sendMemberCardOpenPatch(context.request, 200, existingResult), timing, "scoped");
        throw new Error("开卡请求正在处理，请稍后重试");
      }
      startMutationWrite(timing);
      try {
        await database.completeMemberCardOpenMutation({
          requestId: openCardRequestId,
          storeId,
          customer,
          memberCard,
          transaction,
          operationLog,
          signature,
        });
        markMutationWrite(timing);
        if (!openCardRequestId) {
          const legacyData = await readDataForRequest(database, context.request, session);
          return withMutationTiming(sendScopedData(context.request, 201, legacyData, session), timing, "scoped");
        }
        return withMutationTiming(sendMemberCardOpenPatch(context.request, 201, nextData), timing, "scoped");
      } catch (error) {
        if (openCardRequestId) await database.releaseMemberCardSubmission(openCardRequestId, storeId);
        throw error;
      }
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/recharge")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-recharge");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId });
      markMutationRead(timing);
      const nextData = rechargeMemberCard(currentData, {
        memberCardId,
        amount: optionalNumber(body, "amount") ?? 0,
        giftAmount: optionalNumber(body, "giftAmount"),
        times: optionalNumber(body, "times"),
        giftTimes: optionalNumber(body, "giftTimes"),
        paidAmount: optionalNumber(body, "paidAmount"),
        payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
        note: optionalString(body, "note"),
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 201, currentData, nextData, session, memberCardWriteKeys), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/status")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-status");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId });
      markMutationRead(timing);
      const nextData = updateMemberCardStatus(currentData, {
        memberCardId,
        status: requiredString(body, "status") as "正常" | "冻结",
        reason: optionalString(body, "reason") ?? "门店操作",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 200, currentData, nextData, session, memberCardWriteKeys), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/extend")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-extend");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId });
      markMutationRead(timing);
      const nextData = extendMemberCard(currentData, {
        memberCardId,
        expiresAt: requiredString(body, "expiresAt"),
        reason: optionalString(body, "reason") ?? "会员卡延期",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 200, currentData, nextData, session, memberCardWriteKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/transfer")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-transfer");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const toCustomerId = requiredString(body, "toCustomerId");
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId, extraCustomerId: toCustomerId });
      markMutationRead(timing);
      const nextData = transferMemberCard(currentData, {
        memberCardId,
        toCustomerId,
        reason: optionalString(body, "reason") ?? "会员转卡",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 201, currentData, nextData, session, memberCardWriteKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/approvals") {
      requirePermission(session, "pos:manage");
      const timing = startMutationTiming("approval-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, approvalMutationKeys);
      markMutationRead(timing);
      const approvalData = createApprovalRequest(currentData, {
        storeId: sessionStoreId(currentData, session),
        type: requiredString(body, "type") as "改价折扣" | "订单退款",
        targetId: requiredString(body, "targetId"),
        requestedBy: session.user.id,
        amount: requiredNumber(body, "amount"),
        reason: optionalString(body, "reason") ?? "门店审批",
      });
      const approval = approvalData.approvalRequests[0];
      const nextData = addSystemNotification(approvalData, {
        title: "新的审批待处理",
        desc: `${approval.type} · ${approval.reason}`,
        view: "approvals",
        targetType: "approvalRequest",
        targetId: approval.id,
        storeId: approval.storeId,
        audienceRoles: ["owner", "manager", "finance"],
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, approvalCreateWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/approvals/")) {
      requirePermission(session, "approvals:manage");
      const timing = startMutationTiming("approval-decision");
      const approvalId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, approvalMutationKeys);
      markMutationRead(timing);
      const nextData = decideApprovalRequest(currentData, {
        approvalId,
        userId: session.user.id,
        approved: optionalBoolean(body, "approved") ?? true,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, approvalDecisionWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/service-records") {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("service-record-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, serviceRecordMutationKeys);
      markMutationRead(timing);
      const recordData = addCustomerServiceRecord(currentData, {
        customerId: requiredString(body, "customerId"),
        staffId: requiredString(body, "staffId"),
        serviceId: requiredString(body, "serviceId"),
        orderId: optionalString(body, "orderId"),
        skinCondition: optionalString(body, "skinCondition") ?? "",
        beforeNote: optionalString(body, "beforeNote") ?? "",
        careSteps: optionalString(body, "careSteps"),
        productsUsed: optionalString(body, "productsUsed"),
        afterNote: optionalString(body, "afterNote") ?? "",
        customerFeedback: optionalString(body, "customerFeedback"),
        nextCareAdvice: optionalString(body, "nextCareAdvice"),
        nextFollowUpAt: optionalString(body, "nextFollowUpAt"),
      });
      const followUp = recordData.customerFollowUps[0];
      const customer = recordData.customers.find((item) => item.id === followUp.customerId);
      const nextData = addSystemNotification(recordData, {
        title: "服务后回访待跟进",
        desc: `${customer?.name ?? "客户"} · ${shortTimeText(followUp.dueAt)} · ${followUp.method}`,
        view: "customers",
        targetType: "customerFollowUp",
        targetId: followUp.id,
        audienceRoles: ["owner", "manager", "frontdesk", "therapist"],
        staffId: followUp.staffId,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, serviceRecordWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/customer-signatures") {
      requireAnyPermission(session, ["customers:manage", "pos:manage"]);
      const body = await readJson(context.request);
      const customerId = requiredString(body, "customerId");
      const orderId = optionalString(body, "orderId");
      const serviceRecordId = optionalString(body, "serviceRecordId");
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readCustomerSignatureContext(storeId, { customerId, orderId, serviceRecordId });
      const nextData = createCustomerSignature(currentData, {
        customerId,
        serviceRecordId,
        orderId,
        title: optionalString(body, "title"),
        content: optionalString(body, "content"),
        requestedBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      const createdSignature = nextData.customerSignatures[0];
      if (!createdSignature) throw new Error("签名记录创建失败");
      await database.upsertCustomerSignatures([createdSignature]);
      return sendMutationPatch(context.request, 201, currentData, nextData, session, ["customerSignatures"]);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/customer-signatures/") && pathname.endsWith("/sign")) {
      requireAnyPermission(session, ["customers:manage", "pos:manage"]);
      const signatureId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const storeId = await resolveSessionStoreId(database, session);
      const signature = await database.readCustomerSignatureByIdForStore(signatureId, storeId);
      if (!signature) throw new Error("签名记录不存在");
      const currentData = await database.readCustomerSignatureContext(storeId, signature);
      const previousData = { ...currentData, customerSignatures: [signature] };
      const nextData = signCustomerSignature(previousData, {
        token: signature.token,
        signerName: requiredString(body, "signerName"),
        signatureText: requiredString(body, "signatureText"),
      });
      const signedSignature = nextData.customerSignatures.find((item) => item.id === signature.id);
      if (!signedSignature) throw new Error("签名记录更新失败");
      await persistDataTableChanges(database, session, previousData, nextData, customerSignatureWriteKeys);
      return sendMutationPatch(context.request, 201, previousData, nextData, session, customerSignatureWriteKeys);
    }

    if (context.request.method === "POST" && pathname === "/api/follow-ups") {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("follow-up-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, followUpMutationKeys);
      markMutationRead(timing);
      const nextData = addCustomerFollowUp(currentData, {
        customerId: requiredString(body, "customerId"),
        staffId: requiredString(body, "staffId"),
        dueAt: requiredString(body, "dueAt"),
        method: requiredString(body, "method") as "电话" | "微信" | "到店",
        note: optionalString(body, "note") ?? "",
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, followUpWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/follow-ups/")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("follow-up-update");
      const followUpId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, followUpMutationKeys);
      markMutationRead(timing);
      const currentFollowUp = currentData.customerFollowUps.find((item) => item.id === followUpId);
      if (!currentFollowUp) throw new Error("跟进记录不存在");
      const hasEditFields = ["staffId", "dueAt", "method", "note", "reason"].some((key) => hasBodyKey(body, key));
      const shouldComplete = optionalString(body, "status") === "已完成" || !hasEditFields;
      const nextData = shouldComplete
        ? addOperationLog(completeCustomerFollowUp(currentData, { followUpId }), {
            userId: session.user.id,
            action: "完成客户跟进",
            targetType: "customerFollowUp",
            targetId: followUpId,
            summary: `${session.user.name} 完成客户跟进`,
          })
        : addOperationLog(updateCustomerFollowUpRecord(currentData, followUpId, body), {
            userId: session.user.id,
            action: "编辑客户跟进",
            targetType: "customerFollowUp",
            targetId: followUpId,
            summary: followUpUpdateSummary(session.user.name, currentFollowUp, body),
          });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, followUpWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/refund")) {
      requirePermission(session, "customers:manage");
      const timing = startMutationTiming("member-card-refund");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const signatureId = requiredString(body, "signatureId");
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId, signatureId });
      markMutationRead(timing);
      const nextData = refundMemberCard(currentData, {
        memberCardId,
        reason: optionalString(body, "reason") ?? "客户退卡",
        refundAmount: optionalNumber(body, "refundAmount"),
        payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
        signatureId,
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardRefundWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 201, currentData, nextData, session, memberCardRefundWriteKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/void")) {
      requirePermission(session, "customers:manage");
      if (session.user.role !== "owner" && session.user.role !== "manager") {
        throw new Error("只有门店老板或店长可以作废错录开卡");
      }
      const timing = startMutationTiming("member-card-void");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      if (requiredString(body, "confirm") !== "确认作废") throw new Error("请确认作废操作");
      const storeId = await resolveSessionStoreId(database, session);
      const currentData = await database.readMemberCardMutationData(storeId, { memberCardId });
      markMutationRead(timing);
      const nextData = voidMemberCardOpening(currentData, {
        memberCardId,
        reason: requiredString(body, "reason"),
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      startMutationWrite(timing);
      await persistDataTableChanges(database, session, currentData, nextData, memberCardWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendMutationPatch(context.request, 201, currentData, nextData, session, memberCardWriteKeys), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/services") {
      requirePermission(session, "catalog:manage");
      const timing = startMutationTiming("service-create");
      const body = await readJson(context.request);
      const consumables = optionalConsumables(body);
      const currentData = await readMutationDataForRequest(database, context.request, session, serviceCatalogMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "新增服务项目",
        targetType: "service",
        targetId: "latest",
        summary: `${session.user.name} 新增服务项目 ${requiredString(body, "name")}`,
      }, (data) => {
        const storeId = sessionStoreId(data, session);
        const linkedConsumables = consumables.filter((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId);
          if (!product) throw new Error("商品不存在");
          return true;
        });
        return {
          ...data,
          services: [
            {
              id: makeId("v"),
              storeId,
              name: requiredString(body, "name"),
              category: optionalString(body, "category") ?? "自定义项目",
              price: requiredNumber(body, "price"),
              duration: optionalNumber(body, "duration") ?? 60,
              defaultTimes: optionalNumber(body, "defaultTimes") ?? 1,
              consumables: linkedConsumables,
              consumableProductId: linkedConsumables[0]?.productId ?? optionalString(body, "consumableProductId"),
              consumableQty: linkedConsumables[0]?.quantity ?? optionalNumber(body, "consumableQty"),
            },
            ...data.services,
          ],
        };
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, serviceCatalogWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/services/") && pathname.endsWith("/consumables")) {
      requirePermission(session, "catalog:manage");
      const timing = startMutationTiming("service-consumables-update");
      const serviceId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const consumables = optionalConsumables(body);
      const currentData = await readMutationDataForRequest(database, context.request, session, serviceCatalogMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "更新商品耗材",
        targetType: "service",
        targetId: serviceId,
        summary: `${session.user.name} 更新项目使用产品`,
      }, (data) => {
        if (!data.services.some((service) => service.id === serviceId)) throw new Error("服务项目不存在");
        const linkedConsumables = consumables.filter((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId);
          if (!product) throw new Error("商品不存在");
          return true;
        });
        return {
          ...data,
          services: data.services.map((service) =>
            service.id === serviceId
              ? {
                  ...service,
                  consumables: linkedConsumables,
                  consumableProductId: linkedConsumables[0]?.productId,
                  consumableQty: linkedConsumables[0]?.quantity,
                }
              : service,
          ),
        };
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, serviceCatalogWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/services/")) {
      requirePermission(session, "catalog:manage");
      const timing = startMutationTiming("service-update");
      const serviceId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, serviceCatalogMutationKeys);
      markMutationRead(timing);
      const service = currentData.services.find((item) => item.id === serviceId);
      if (!service) throw new Error("服务项目不存在");
      const nextData = updateData(currentData, session, {
        action: "编辑服务项目",
        targetType: "service",
        targetId: serviceId,
        summary: catalogEditSummary(session.user.name, service.name, body),
      }, (data) => updateServiceCatalog(data, {
        serviceId,
        name: optionalString(body, "name"),
        category: optionalString(body, "category"),
        subcategory: optionalString(body, "subcategory"),
        price: optionalNumber(body, "price"),
        duration: optionalNumber(body, "duration"),
        defaultTimes: optionalNumber(body, "defaultTimes"),
        consumables: hasBodyKey(body, "consumables") ? optionalConsumables(body) : undefined,
        status: optionalString(body, "status") as "启用" | "停用" | undefined,
      }));
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, serviceCatalogWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/products") {
      requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
      const timing = startMutationTiming("product-create");
      const body = await readJson(context.request);
      const productId = makeId("p");
      const createdAt = nowIso();
      const name = requiredString(body, "name");
      const stock = requiredNumber(body, "stock");
      const category = optionalString(body, "category") ?? "面护类";
      const subcategory = optionalString(body, "subcategory") ?? "";
      const unit = optionalString(body, "unit") ?? "件";
      const expiryAt = optionalString(body, "expiryAt");
      const stockRule = requireConfirmedProductStockRule({
        serviceStockDeductible: optionalBoolean(body, "serviceStockDeductible"),
        serviceUnit: optionalString(body, "serviceUnit"),
        serviceUnitsPerStockUnit: optionalNumber(body, "serviceUnitsPerStockUnit") ?? optionalNumber(body, "serviceUsesPerUnit"),
      });
      const { serviceStockDeductible, serviceUnit, serviceUnitsPerStockUnit } = stockRule;
      const serviceStockReviewStatus = "confirmed" as const;
      const currentData = await readMutationDataForRequest(database, context.request, session, productCatalogMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "新增商品",
        targetType: "product",
        targetId: productId,
        summary: `${session.user.name} 新增商品 ${name}`,
      }, (data) => ({
        ...data,
        products: [
          {
            id: productId,
            storeId: sessionStoreId(data, session),
            name,
            type: optionalString(body, "type") === "consumable" ? "consumable" : "sale",
            category,
            subcategory,
            unit,
            price: optionalNumber(body, "price") ?? 0,
            cost: optionalNumber(body, "cost") ?? 0,
            stock,
            warningStock: optionalNumber(body, "warningStock") ?? 5,
            shelfLifeMonths: optionalNumber(body, "shelfLifeMonths"),
            expiryAt,
            serviceStockDeductible,
            serviceStockReviewStatus,
            serviceStockReviewedAt: serviceStockReviewStatus === "confirmed" ? createdAt : undefined,
            serviceStockReviewedBy: serviceStockReviewStatus === "confirmed" ? session.user.id : undefined,
            serviceUnit,
            serviceUnitsPerStockUnit,
            serviceUsesPerUnit: serviceUnitsPerStockUnit,
          },
          ...data.products,
        ],
        inventoryLogs: stock > 0
          ? [
              {
                id: makeId("il"),
                storeId: sessionStoreId(data, session),
                productId,
                type: "入库",
                delta: stock,
                stockAfter: stock,
                note: "新增物品首批入库",
                expiryAt,
                createdAt,
              },
              ...data.inventoryLogs,
            ]
          : data.inventoryLogs,
        inventoryBatches: stock > 0
          ? [
              {
                id: makeId("ib"),
                storeId: sessionStoreId(data, session),
                productId,
                source: "首批入库",
                quantityIn: stock,
                remainingQuantity: stock,
                unitCost: optionalNumber(body, "cost") ?? 0,
                expiryAt,
                createdAt,
              },
              ...(data.inventoryBatches ?? []),
            ]
          : (data.inventoryBatches ?? []),
      }));
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, productCatalogWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/products/")) {
      requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
      const timing = startMutationTiming("product-update");
      const productId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, productCatalogMutationKeys);
      markMutationRead(timing);
      const product = currentData.products.find((item) => item.id === productId);
      if (!product) throw new Error("商品不存在");
      const nextData = updateData(currentData, session, {
        action: "编辑商品资料",
        targetType: "product",
        targetId: productId,
        summary: catalogEditSummary(session.user.name, product.name, body),
      }, (data) => updateProductCatalog(data, {
        productId,
        name: optionalString(body, "name"),
        category: optionalString(body, "category"),
        subcategory: optionalString(body, "subcategory"),
        unit: optionalString(body, "unit"),
        price: optionalNumber(body, "price"),
        cost: optionalNumber(body, "cost"),
        warningStock: optionalNumber(body, "warningStock"),
        shelfLifeMonths: optionalNumber(body, "shelfLifeMonths"),
        serviceStockDeductible: optionalBoolean(body, "serviceStockDeductible"),
        serviceStockReviewStatus: optionalBoolean(body, "serviceStockDeductible") === undefined ? undefined : "confirmed",
        serviceStockReviewedAt: optionalBoolean(body, "serviceStockDeductible") === undefined ? undefined : nowIso(),
        serviceStockReviewedBy: optionalBoolean(body, "serviceStockDeductible") === undefined ? undefined : session.user.id,
        serviceUnit: optionalString(body, "serviceUnit"),
        serviceUnitsPerStockUnit: optionalNumber(body, "serviceUnitsPerStockUnit"),
        status: optionalString(body, "status") as "启用" | "停用" | undefined,
      }));
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, productCatalogWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/suppliers") {
      requirePermission(session, "inventory:manage");
      const timing = startMutationTiming("supplier-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, supplierMutationKeys);
      markMutationRead(timing);
      const nextData = addSupplier(currentData, {
        storeId: sessionStoreId(currentData, session),
        name: requiredString(body, "name"),
        phone: optionalString(body, "phone") ?? "",
        contact: optionalString(body, "contact") ?? "",
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, supplierWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/purchase-orders") {
      requirePermission(session, "inventory:manage");
      const timing = startMutationTiming("purchase-order-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, purchaseMutationKeys);
      markMutationRead(timing);
      const nextData = receiveSupplierPurchase(currentData, {
        storeId: sessionStoreId(currentData, session),
        supplierId: optionalString(body, "supplierId"),
        supplierName: optionalString(body, "supplierName"),
        supplierPhone: optionalString(body, "supplierPhone"),
        supplierContact: optionalString(body, "supplierContact"),
        productId: optionalString(body, "productId"),
        productName: optionalString(body, "productName"),
        productPrice: optionalNumber(body, "productPrice"),
        productCategory: optionalString(body, "productCategory"),
        productSubcategory: optionalString(body, "productSubcategory"),
        productUnit: optionalString(body, "productUnit"),
        warningStock: optionalNumber(body, "warningStock"),
        shelfLifeMonths: optionalNumber(body, "shelfLifeMonths"),
        serviceStockDeductible: optionalBoolean(body, "serviceStockDeductible"),
        serviceUnit: optionalString(body, "serviceUnit"),
        serviceUnitsPerStockUnit: optionalNumber(body, "serviceUnitsPerStockUnit"),
        quantity: requiredNumber(body, "quantity"),
        unitCost: requiredNumber(body, "unitCost"),
        expiryAt: optionalString(body, "expiryAt"),
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, purchaseWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/inventory/restock-low") {
      requirePermission(session, "inventory:manage");
      const timing = startMutationTiming("inventory-restock-low");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, restockLowMutationKeys);
      markMutationRead(timing);
      const nextData = restockLowInventory(currentData, {
        storeId: sessionStoreId(currentData, session),
        supplierId: optionalString(body, "supplierId"),
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, restockLowWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/stocktakes") {
      requirePermission(session, "inventory:manage");
      const timing = startMutationTiming("stocktake-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, stocktakeMutationKeys);
      markMutationRead(timing);
      const nextData = createStocktake(currentData, {
        storeId: sessionStoreId(currentData, session),
        productId: requiredString(body, "productId"),
        actualStock: requiredNumber(body, "actualStock"),
        reason: optionalString(body, "reason") ?? "库存盘点",
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, stocktakeWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/commissions/settle") {
      requirePermission(session, "commissions:settle");
      const timing = startMutationTiming("commission-settle");
      const currentData = await readMutationDataForRequest(database, context.request, session, commissionSettleMutationKeys);
      markMutationRead(timing);
      const nextData = updateData(currentData, session, {
        action: "结算提成",
        targetType: "commission",
        targetId: "all",
        summary: `${session.user.name} 结算全部待结算提成`,
      }, (data) => settleCommissions(data, { userId: session.user.id, storeId: sessionStoreId(data, session) }));
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, commissionSettleWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close") {
      requirePermission(session, "reports:view");
      const timing = startMutationTiming("daily-close-create");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, dailyCloseMutationKeys);
      markMutationRead(timing);
      const nextData = createDailyClose(currentData, {
        storeId: sessionStoreId(currentData, session),
        businessDate: optionalString(body, "businessDate") ?? businessDateToday(),
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, dailyCloseWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 201, nextData, session), timing, "scoped");
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close/reverse") {
      requirePermission(session, "reports:view");
      const timing = startMutationTiming("daily-close-reverse");
      const body = await readJson(context.request);
      const currentData = await readMutationDataForRequest(database, context.request, session, dailyCloseMutationKeys);
      markMutationRead(timing);
      const nextData = reverseDailyClose(currentData, {
        storeId: sessionStoreId(currentData, session),
        businessDate: requiredString(body, "businessDate"),
        userId: session.user.id,
      });
      startMutationWrite(timing);
      await persistDataTables(database, session, nextData, dailyCloseWriteKeys);
      markMutationWrite(timing);
      return withMutationTiming(sendScopedData(context.request, 200, nextData, session), timing, "scoped");
    }

      return sendJson(404, { error: "Not found" });
    } finally {
      for (const lock of [...storeMutationLocks].reverse()) {
        await database.releaseCheckoutStoreLock(lock.storeId, lock.ownerId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return sendJson(400, { error: message });
  }
};

function requiresStoreMutationLock(method: string, pathname: string) {
  if (method !== "POST" && method !== "PATCH") return false;
  return pathname === "/api/checkout"
    || pathname === "/api/appointments"
    || pathname.startsWith("/api/appointments/")
    || pathname.startsWith("/api/orders/")
    || pathname.startsWith("/api/member-cards")
    || pathname.startsWith("/api/products")
    || pathname.startsWith("/api/inventory/")
    || pathname === "/api/purchase-orders"
    || pathname === "/api/stocktakes"
    || pathname.startsWith("/api/daily-close")
    || pathname === "/api/commissions/settle"
    || (pathname.startsWith("/api/customer-signatures/") && pathname.endsWith("/sign"));
}

async function acquireStoreMutationLock(database: D1BeautyDatabase, storeId: string, ownerId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await database.acquireCheckoutStoreLock(storeId, ownerId, nowIso())) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function requestClientKey(request: Request) {
  return request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
}

function updateData(
  data: AppData,
  session: UserSession,
  log: { action: string; targetType: string; targetId: string; summary: string },
  updater: (data: AppData) => AppData,
) {
  return addOperationLog(updater(data), { userId: session.user.id, ...log });
}

async function persistData(database: D1BeautyDatabase, session: UserSession, nextData: AppData) {
  if (session.user.role !== "superadmin") {
    const storeId = await resolveSessionStoreId(database, session);
    return database.replaceStoreData(storeId, nextData);
  }
  return database.replaceData(nextData);
}

function persistDataTables(database: D1BeautyDatabase, session: UserSession, nextData: AppData, keys: readonly D1DataTableName[]) {
  if (session.user.role !== "superadmin") {
    const storeId = session.user.storeId ?? sessionStoreId(nextData, session);
    if (!storeId) throw new Error("账号未绑定门店，请联系管理员处理");
    return database.replaceStoreTables(storeId, nextData, keys);
  }
  return database.replaceTables(nextData, keys);
}

function persistDataTableChanges(
  database: D1BeautyDatabase,
  session: UserSession,
  previousData: AppData,
  nextData: AppData,
  keys: readonly D1DataTableName[],
) {
  if (session.user.role !== "superadmin") {
    const storeId = session.user.storeId ?? sessionStoreId(nextData, session) ?? sessionStoreId(previousData, session);
    if (!storeId) throw new Error("账号未绑定门店，请联系管理员处理");
    return database.applyStoreTableChanges(storeId, previousData, nextData, keys);
  }
  return database.applyTableChanges(previousData, nextData, keys);
}

function persistAppointmentMutation(database: D1BeautyDatabase, previousData: AppData, nextData: AppData) {
  const previousCustomers = new Map(previousData.customers.map((customer) => [customer.id, JSON.stringify(customer)]));
  const previousAppointments = new Map(previousData.appointments.map((appointment) => [appointment.id, JSON.stringify(appointment)]));
  const previousOnlineBookingRequests = new Map(previousData.onlineBookingRequests.map((request) => [request.id, JSON.stringify(request)]));
  const previousLogIds = new Set(previousData.operationLogs.map((log) => log.id));
  const previousNotificationIds = new Set((previousData.notifications ?? []).map((notification) => notification.id));
  const changedCustomers = nextData.customers.filter((customer) => previousCustomers.get(customer.id) !== JSON.stringify(customer));
  const changedAppointments = nextData.appointments.filter((appointment) => previousAppointments.get(appointment.id) !== JSON.stringify(appointment));
  const changedOnlineBookingRequests = nextData.onlineBookingRequests.filter((request) => previousOnlineBookingRequests.get(request.id) !== JSON.stringify(request));
  const newOperationLogs = nextData.operationLogs.filter((log) => !previousLogIds.has(log.id));
  const newNotifications = (nextData.notifications ?? []).filter((notification) => !previousNotificationIds.has(notification.id));
  return database.upsertAppointmentMutation({
    customers: changedCustomers,
    appointments: changedAppointments,
    onlineBookingRequests: changedOnlineBookingRequests,
    operationLogs: newOperationLogs,
    notifications: newNotifications,
  });
}

function hasBodyKey(body: JsonBody, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function bodyText(body: JsonBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function patchText(body: JsonBody, key: string, fallback: string) {
  return hasBodyKey(body, key) ? bodyText(body, key) ?? fallback : fallback;
}

function customerUpdateSummary(userName: string, customer: Customer, body: JsonBody) {
  const nextTags = optionalStringArray(body, "tags") ?? customer.tags;
  const changed = [
    patchText(body, "name", customer.name) !== customer.name ? "姓名" : "",
    patchText(body, "phone", customer.phone) !== customer.phone ? "手机号" : "",
    patchText(body, "level", customer.level) !== customer.level ? "会员等级" : "",
    patchText(body, "source", customer.source) !== customer.source ? "来源" : "",
    patchText(body, "birthday", customer.birthday ?? "") !== (customer.birthday ?? "") ? "生日" : "",
    patchText(body, "note", customer.note ?? "") !== (customer.note ?? "") ? "备注" : "",
    nextTags.join("、") !== customer.tags.join("、") ? "标签" : "",
  ].filter(Boolean);
  const reason = bodyText(body, "reason");
  return `${userName} 更新客户资料：${changed.length ? changed.join("、") : "无字段变化"}${reason ? `；原因：${reason}` : ""}`;
}

function followUpUpdateSummary(userName: string, followUp: CustomerFollowUp, body: JsonBody) {
  const changed = [
    patchText(body, "staffId", followUp.staffId) !== followUp.staffId ? "负责人" : "",
    patchText(body, "dueAt", followUp.dueAt) !== followUp.dueAt ? "计划时间" : "",
    patchText(body, "method", followUp.method) !== followUp.method ? "跟进方式" : "",
    patchText(body, "note", followUp.note) !== followUp.note ? "跟进内容" : "",
  ].filter(Boolean);
  const reason = bodyText(body, "reason");
  return `${userName} 编辑客户跟进：${changed.length ? changed.join("、") : "无字段变化"}${reason ? `；原因：${reason}` : ""}`;
}

function catalogEditSummary(userName: string, targetName: string, body: JsonBody) {
  const fieldLabels: Record<string, string> = {
    name: "名称",
    category: "分类",
    subcategory: "小类",
    unit: "单位",
    price: "售价/价格",
    cost: "成本",
    warningStock: "预警库存",
    shelfLifeMonths: "保质期",
    duration: "时长",
    defaultTimes: "可服务次数",
    consumables: "耗材配置",
    serviceStockDeductible: "项目扣减规则",
    status: "状态",
  };
  const changed = Object.keys(fieldLabels).filter((key) => hasBodyKey(body, key)).map((key) => fieldLabels[key]);
  const reason = bodyText(body, "reason");
  return `${userName} 编辑 ${targetName}：${changed.length ? changed.join("、") : "无字段变化"}${reason ? `；原因：${reason}` : ""}`;
}

function updateCustomerFollowUpRecord(data: AppData, followUpId: string, body: JsonBody): AppData {
  return {
    ...data,
    customerFollowUps: data.customerFollowUps.map((item) =>
      item.id === followUpId
        ? {
            ...item,
            staffId: patchText(body, "staffId", item.staffId),
            dueAt: patchText(body, "dueAt", item.dueAt),
            method: patchText(body, "method", item.method) as CustomerFollowUp["method"],
            note: patchText(body, "note", item.note),
          }
        : item,
    ),
  };
}

async function assertNoPersistedAppointmentCheckout(
  database: D1BeautyDatabase,
  data: AppData,
  sessionStoreIdValue: string | undefined,
  body: JsonBody,
  checkoutAt: string,
) {
  const staffId = requiredString(body, "staffId");
  const customerId = optionalString(body, "customerId");
  const storeId = sessionStoreIdValue
    ?? data.staff.find((staff) => staff.id === staffId)?.storeId
    ?? (customerId ? data.customers.find((customer) => customer.id === customerId)?.storeId : undefined);
  if (!storeId) return;

  const explicitAppointmentId = optionalString(body, "appointmentId");
  const serviceIds = normalizeCheckoutServiceIds(optionalString(body, "serviceId"), optionalStringArray(body, "serviceIds"));
  if (explicitAppointmentId && serviceIds.length === 0) {
    throw new Error("预约收银需选择服务项目；仅购买商品请使用商品开单");
  }
  if (explicitAppointmentId) {
    if (await database.hasActiveOrderForAppointment(storeId, explicitAppointmentId)) {
      throw new Error("该预约已生成收银单，请勿重复开单");
    }
    return;
  }

  if (!customerId) return;
  if (serviceIds.length === 0) return;

  const checkedOutAppointments = await database.readCheckedOutAppointmentsForCustomerStaff(storeId, customerId, staffId);
  const hasImplicitConflict = checkedOutAppointments.some((appointment) => appointmentMatchesServiceCheckout(appointment, {
    storeId, customerId, staffId, serviceIds, createdAt: checkoutAt,
  }, data.services));
  if (hasImplicitConflict) {
    throw new Error("匹配到的预约已生成收银单，请勿重复开单");
  }
}

function isActiveAppointmentUniqueError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.includes("idx_orders_unique_active_appointment")
    || message.includes("UNIQUE constraint failed: orders.storeId, orders.appointmentId")
    || message.includes("UNIQUE constraint failed: index 'idx_orders_unique_active_appointment'");
}

function sessionStoreId(data: AppData, session: UserSession) {
  if (session.user.role === "superadmin") return undefined;
  const storeExists = (storeId: string | undefined) => Boolean(storeId && data.storeProfiles.some((store) => store.id === storeId));
  if (storeExists(session.user.storeId)) return session.user.storeId;
  const authUser = data.authUsers.find((user) => user.id === session.user.id);
  if (storeExists(authUser?.storeId)) return authUser?.storeId;
  const staffId = session.user.staffId ?? authUser?.staffId;
  const staff = staffId ? data.staff.find((item) => item.id === staffId) : undefined;
  if (storeExists(staff?.storeId)) return staff?.storeId;
  throw new Error("账号未绑定门店，请联系管理员处理");
}

function assertCanManageAuthUser(data: AppData, session: UserSession, userId: string) {
  if (session.user.role === "superadmin") return;
  const normalizedData = normalizeStoreScopedData(data);
  const user = normalizedData.authUsers.find((item) => item.id === userId);
  if (!user) throw new Error("账号不存在");
  if (user.role === "superadmin" || user.role === "owner") throw new Error("店长只能管理员工账号");
  const currentStoreId = sessionStoreId(data, session);
  const targetStoreId = storeIdForUser(normalizedData, user);
  if (!currentStoreId || !targetStoreId || currentStoreId !== targetStoreId) throw new Error("只能管理本门店员工账号");
}

function assertCanManageStaff(data: AppData, session: UserSession, staffId: string) {
  if (session.user.role === "superadmin") return;
  const normalizedData = normalizeStoreScopedData(data);
  const staff = normalizedData.staff.find((item) => item.id === staffId);
  if (!staff) throw new Error("员工不存在");
  if (staff.role === "老板") throw new Error("不能删除老板档案");
  const linkedUser = normalizedData.authUsers.find((user) => user.staffId === staff.id || staff.accountId === user.id);
  if (linkedUser?.role === "superadmin" || linkedUser?.role === "owner") throw new Error("店长只能管理员工账号");
  const currentStoreId = sessionStoreId(data, session);
  const targetStoreId = staff.storeId ?? (linkedUser ? storeIdForUser(normalizedData, linkedUser) : undefined);
  if (!currentStoreId || !targetStoreId || currentStoreId !== targetStoreId) throw new Error("只能管理本门店员工");
}

function requirePermission(session: UserSession, permission: Permission) {
  if (!session.user.permissions.includes(permission)) {
    throw new Error("当前角色无权执行此操作");
  }
}

function requireAnyPermission(session: UserSession, permissions: Permission[]) {
  if (!permissions.some((permission) => session.user.permissions.includes(permission))) {
    throw new Error("当前角色无权执行此操作");
  }
}

function publicStorePayload(data: AppData, shareCode: string) {
  const storefront = data.onlineStorefronts.find((item) => item.shareCode === shareCode && item.status === "启用");
  if (!storefront) throw new Error("线上店铺不存在或已停用");
  const store = data.storeProfiles.find((item) => item.id === storefront.storeId) ?? data.storeProfiles[0];
  if (store && (store.status ?? "active") !== "active") throw new Error("线上店铺不存在或已停用");
  return {
    store,
    storefront,
    services: data.services.filter((service) => storefront.enabledServiceIds.includes(service.id)),
  };
}

function publicSignaturePayload(data: AppData, token: string) {
  const signature = (data.customerSignatures ?? []).find((item) => item.token === token);
  if (!signature) throw new Error("签名链接不存在");
  const customer = data.customers.find((item) => item.id === signature.customerId);
  const order = signature.orderId ? data.orders.find((item) => item.id === signature.orderId) : undefined;
  const serviceRecord = signature.serviceRecordId ? data.customerServiceRecords.find((item) => item.id === signature.serviceRecordId) : undefined;
  return {
    signature: sanitizePublicSignature(signature),
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2") } : undefined,
    order: order
      ? {
          id: order.id,
          orderNo: order.orderNo,
          paidAmount: order.paidAmount,
          payMethod: order.payMethod,
          createdAt: order.createdAt,
          serviceName: data.services.find((item) => item.id === order.serviceId)?.name ?? "",
        }
      : undefined,
    serviceRecord: serviceRecord
      ? {
          id: serviceRecord.id,
          skinCondition: serviceRecord.skinCondition,
          careSteps: serviceRecord.careSteps,
          afterNote: serviceRecord.afterNote,
          nextCareAdvice: serviceRecord.nextCareAdvice,
          createdAt: serviceRecord.createdAt,
          serviceName: data.services.find((item) => item.id === serviceRecord.serviceId)?.name ?? "",
          staffName: data.staff.find((item) => item.id === serviceRecord.staffId)?.name ?? "",
        }
      : undefined,
  };
}

function sanitizePublicSignature(signature: CustomerSignature) {
  return {
    id: signature.id,
    token: signature.token,
    title: signature.title,
    content: signature.content,
    status: signature.status,
    createdAt: signature.createdAt,
    expiresAt: signature.expiresAt,
    signerName: signature.signerName,
    signatureText: signature.signatureText,
    signedAt: signature.signedAt,
  };
}

function shortTimeText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function shortClockText(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
}

function isStoreOwnerInviteCode(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return Boolean(platformInviteIssuerId(data, normalizedInviteCode))
    || (data.storeOwnerInvites ?? []).some((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode && item.status === "待加入");
}

function scopeDataForSession(data: AppData, session: UserSession): AppData {
  const normalizedData = normalizeStoreScopedData(data);
  const currentStoreId = session.user.role === "superadmin" ? undefined : sessionStoreId(data, session);
  const sessionData = session.user.role === "superadmin"
    ? normalizedData
    : scopeDataToStore(normalizedData, currentStoreId);
  const sanitizedData = {
    ...sessionData,
    authUsers: sessionData.authUsers.map((user) => ({ ...user, password: "" })),
    storeOwnerApplications: (sessionData.storeOwnerApplications ?? []).map((application) => ({ ...application, password: "" })),
    systemConfigs: sanitizeSystemConfigsForRole(sessionData.systemConfigs, session.user.role),
    notifications: (sessionData.notifications ?? []).filter((notification) => notificationVisibleToSession(notification, session)),
    distributors: [],
    referralRelations: [],
    distributionCommissions: [],
    commissionSettlements: sessionData.commissionSettlements.filter((item) => item.type !== "分销佣金"),
  };
  if (session.user.role !== "therapist" || !session.user.staffId) {
    return sanitizedData;
  }

  const staffId = session.user.staffId;
  const appointments = storeStaffCanViewAllAppointments(normalizedData, currentStoreId)
    ? sanitizedData.appointments
    : sanitizedData.appointments.filter((item) => item.staffId === staffId);
  const orders = sanitizedData.orders;
  const orderIds = new Set(orders.map((item) => item.id));
  const appointmentIds = new Set(appointments.map((item) => item.id));

  return {
    ...sanitizedData,
    customers: sanitizedData.customers,
    appointments,
    staffShifts: sanitizedData.staffShifts.filter((item) => item.staffId === staffId),
    staffUnavailableSlots: sanitizedData.staffUnavailableSlots.filter((item) => item.staffId === staffId),
    orders,
    refunds: sanitizedData.refunds.filter((item) => orderIds.has(item.orderId)),
    commissions: sanitizedData.commissions.filter((item) => item.staffId === staffId),
    distributors: [],
    referralRelations: [],
    approvalRequests: [],
    authUsers: sanitizedData.authUsers.filter((item) => item.staffId === staffId || item.id === session.user.id),
    staffInvites: [],
    onlineStorefronts: [],
    onlineBookingRequests: sanitizedData.onlineBookingRequests.filter((item) => item.appointmentId && appointmentIds.has(item.appointmentId)),
    distributionCommissions: [],
    customerServiceRecords: sanitizedData.customerServiceRecords,
    customerSignatures: sanitizedData.customerSignatures ?? [],
    customerFollowUps: sanitizedData.customerFollowUps,
    operationLogs: sanitizedData.operationLogs.filter((item) => item.userId === session.user.id),
    notifications: sanitizedData.notifications.filter((item) => !item.staffId || item.staffId === staffId),
    commissionSettlements: sanitizedData.commissionSettlements.filter((item) =>
      item.commissionIds.some((commissionId) => sanitizedData.commissions.some((commission) => commission.id === commissionId && commission.staffId === staffId)),
    ),
    dailyCloses: [],
  };
}

function notificationVisibleToSession(notification: AppData["notifications"][number], session: UserSession) {
  if (!notification.audienceRoles.includes(session.user.role)) return false;
  if (session.user.role === "therapist" && notification.staffId) return notification.staffId === session.user.staffId;
  return true;
}

function getR2Bucket(env: Env) {
  return env.R2_BUCKET ?? env.YICH_R2 ?? env.ASSETS_BUCKET;
}

function assetUrlForKey(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function assetKeyFromPath(pathname: string) {
  const key = pathname.replace(/^\/api\/assets\/?/, "").split("/").map(decodeURIComponent).join("/");
  if (!key || key.includes("..") || key.startsWith("/")) {
    throw new Error("资源路径不正确");
  }
  return key;
}

async function serveR2Asset(env: Env, pathname: string, method = "GET") {
  const bucket = getR2Bucket(env);
  if (!bucket) return sendJson(404, { error: "资源不存在" });

  const key = assetKeyFromPath(pathname);
  const object = await bucket.get(key);
  if (!object) return sendJson(404, { error: "资源不存在" });

  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename="${encodeURIComponent(key.split("/").at(-1) ?? "poster.png")}"`,
    ...corsHeaders(),
  });
  if (object.writeHttpMetadata) {
    object.writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set("Content-Type", object.httpMetadata.contentType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }

  return new Response(method === "HEAD" ? null : object.body, { headers });
}

async function serveAndroidApk(env: Env, method = "GET") {
  const bucket = getR2Bucket(env);
  if (!bucket) return sendJson(404, { error: "安装包暂不可用" });

  const object = await bucket.get(androidApkR2Key);
  if (!object) return sendJson(404, { error: "安装包暂不可用" });

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="zhurongkftech-app.apk"',
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders(),
  });
  object.writeHttpMetadata?.(headers);
  headers.set("Content-Type", "application/vnd.android.package-archive");
  headers.set("Content-Disposition", 'attachment; filename="zhurongkftech-app.apk"');

  return new Response(method === "HEAD" ? null : object.body, { headers });
}

async function uploadAccountAvatar(request: Request, env: Env, session: UserSession) {
  const bucket = getR2Bucket(env);
  if (!bucket) {
    throw new Error("当前项目未绑定 R2 Bucket，无法上传头像");
  }

  const form = await request.formData();
  const value = form.get("avatar");
  if (!(value instanceof File)) {
    throw new Error("请选择头像图片");
  }
  if (!value.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (value.size > 1_200_000) {
    throw new Error("头像文件过大，请重新上传头像");
  }

  const extension = value.type.includes("png") ? "png" : value.type.includes("webp") ? "webp" : "jpg";
  const key = `avatars/${session.user.id}/${Date.now()}-${makeId("img")}.${extension}`;
  await bucket.put(key, value.stream(), {
    httpMetadata: { contentType: value.type },
    customMetadata: {
      userId: session.user.id,
      uploadedAt: nowIso(),
    },
  });

  return {
    key,
    avatarUrl: assetUrlForKey(key),
    size: value.size,
  };
}

async function saveMarketingTalkVideoRecord(env: Env, data: AppData, session: UserSession, body: JsonBody) {
  const bucket = getR2Bucket(env);
  if (!bucket) throw new Error("当前项目未绑定 R2 Bucket，无法保存口播视频");
  const videoDataUrl = requiredString(body, "videoDataUrl");
  const parsed = await videoDataUrlToBlob(videoDataUrl);
  const maxVideoBytes = 60 * 1024 * 1024;
  if (parsed.blob.size > maxVideoBytes) throw new Error("口播视频不能超过 60MB，请缩短录制后再保存");
  const ratio = "9:16";
  const durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds ?? 0) || 0));
  const topicTitle = marketingCompliantText(optionalString(body, "topicTitle") || "真人口播");
  const scriptText = marketingCompliantText(requiredTrimmedText(body, "scriptText", 2000));
  let transcriptText = marketingCompliantText(optionalString(body, "transcriptText"), "", 3000).trim();
  let transcriptSource: NonNullable<NonNullable<MarketingAiRecord["talkOptimization"]>["transcriptSource"]> = transcriptText && optionalString(body, "transcriptSource") === "browser-speech" ? "browser-speech" : "script-fallback";
  const backendTranscript = await transcribeTalkVideoIfUseful(data, parsed.blob, parsed.contentType, transcriptText, transcriptSource, scriptText);
  if (backendTranscript) {
    transcriptText = backendTranscript.text;
    transcriptSource = "openai-transcription";
  }
  const audioEnhancements = talkAudioEnhancementsFromBody(body);
  const silenceTrim = talkSilenceReportFromBody(body) ?? {
    status: "已保存待复核",
    method: "browser media capture",
    note: "部署端已保存口播素材；如浏览器未返回检测报告，可后续进入剪辑复核",
  };
  const extension = videoExtensionForContentType(parsed.contentType);
  let record = marketingAiRecord(data, session, {
    ...body,
    channel: "真人口播",
    marketingNode: topicTitle,
    marketingGoal: "看词自拍",
    serviceName: "补水修护",
  }, {
    kind: "talk",
    provider: "local",
    model: "browser-media-recorder",
    status: "已完成",
    elapsedMs: 0,
    materialKey: `talk:${Date.now()}:${parsed.blob.size}`,
  });
  const key = `marketing-talk/${record.storeId ?? "platform"}/${record.id}.${extension}`;
  await bucket.put(key, parsed.blob, {
    httpMetadata: { contentType: parsed.contentType },
    customMetadata: {
      recordId: record.id,
      userId: record.createdBy,
      storeId: record.storeId ?? "",
      ratio,
      uploadedAt: nowIso(),
    },
  });
  const originalVideoUrl = assetUrlForKey(key);
  let optimizedVideoUrl: string | undefined;
  let noiseReduction: NonNullable<MarketingAiRecord["talkOptimization"]>["noiseReduction"] = {
    status: audioEnhancements.noiseSuppression ? "采集时已启用" : "未启用",
    method: "browser getUserMedia audio constraints",
    optimizedBy: "browser",
  };
  const uploadedOptimizedDataUrl = optionalString(body, "optimizedVideoDataUrl");
  if (uploadedOptimizedDataUrl) {
    const optimized = await videoDataUrlToBlob(uploadedOptimizedDataUrl);
    if (optimized.blob.size > maxVideoBytes) throw new Error("优化后口播视频不能超过 60MB");
    const optimizedExtension = videoExtensionForContentType(optimized.contentType);
    const optimizedKey = `marketing-talk/${record.storeId ?? "platform"}/${record.id}-optimized.${optimizedExtension}`;
    await bucket.put(optimizedKey, optimized.blob, {
      httpMetadata: { contentType: optimized.contentType },
      customMetadata: {
        recordId: record.id,
        userId: record.createdBy,
        storeId: record.storeId ?? "",
        ratio,
        optimized: "true",
        uploadedAt: nowIso(),
      },
    });
    optimizedVideoUrl = assetUrlForKey(optimizedKey);
    noiseReduction = {
      status: "已优化",
      method: "client optimized upload",
      optimizedBy: "uploaded",
    };
  }
  const talkOptimization: MarketingAiRecord["talkOptimization"] = {
    transcriptText,
    transcriptSource,
    audioEnhancements,
    noiseReduction,
    silenceTrim,
    originalVideoUrl,
    optimizedVideoUrl,
    durationSeconds,
    ratio,
  };
  const text = talkVideoRecordText({
    transcriptText,
    transcriptSource,
    scriptText,
    ratio,
    durationSeconds,
    optimization: talkOptimization,
  });
  record = {
    ...record,
    title: "真人口播",
    text,
    videoUrl: optimizedVideoUrl ?? originalVideoUrl,
    originalVideoUrl,
    optimizedVideoUrl,
    videoResolution: ratio,
    talkOptimization,
  };
  return {
    kind: "talk" as const,
    provider: "local" as const,
    model: "browser-media-recorder",
    text: record.text,
    videoUrl: record.videoUrl,
    status: record.status,
    elapsedMs: 0,
    record,
  };
}

function talkAudioEnhancementsFromBody(body: JsonBody): NonNullable<NonNullable<MarketingAiRecord["talkOptimization"]>["audioEnhancements"]> {
  const value = body.audioEnhancements;
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    echoCancellation: source.echoCancellation === true,
    noiseSuppression: source.noiseSuppression === true,
    autoGainControl: source.autoGainControl === true,
  };
}

async function transcribeTalkVideoIfUseful(
  data: AppData,
  blob: Blob,
  contentType: string,
  currentTranscript: string,
  currentSource: NonNullable<NonNullable<MarketingAiRecord["talkOptimization"]>["transcriptSource"]>,
  scriptText: string,
) {
  if (currentSource === "browser-speech" && currentTranscript.trim() && currentTranscript.trim() !== scriptText.trim()) return undefined;
  if (blob.size > 25 * 1024 * 1024) return undefined;
  const apiKey = openAiTranscriptionApiKey(data);
  if (!apiKey) return undefined;
  try {
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("language", "zh");
    formData.append("response_format", "json");
    formData.append("file", blob, `talk.${videoExtensionForContentType(contentType)}`);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return undefined;
    const text = typeof payload.text === "string" ? marketingCompliantText(payload.text, "", 3000) : "";
    return text.trim() ? { text } : undefined;
  } catch {
    return undefined;
  }
}

function openAiTranscriptionApiKey(data: AppData) {
  const config = aiGenerationConfigFromData(data);
  if (config.copy.provider === "openai" && config.copy.apiKey.trim()) return config.copy.apiKey.trim();
  if (config.image.apiKey.trim()) return config.image.apiKey.trim();
  return "";
}

function talkSilenceReportFromBody(body: JsonBody): NonNullable<MarketingAiRecord["talkOptimization"]>["silenceTrim"] | undefined {
  const value = body.silenceReport;
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const status = typeof source.status === "string" ? marketingCompliantText(source.status, "", 40) : "已检测";
  const method = typeof source.method === "string" ? marketingCompliantText(source.method, "", 80) : "browser-audio-rms";
  const detectedSegments = Number.isFinite(Number(source.detectedSegments)) ? Math.max(0, Math.round(Number(source.detectedSegments))) : undefined;
  const silentSeconds = Number.isFinite(Number(source.silentSeconds)) ? Math.max(0, Math.round(Number(source.silentSeconds) * 10) / 10) : undefined;
  const sampleWindowMs = Number.isFinite(Number(source.sampleWindowMs)) ? Math.max(0, Math.round(Number(source.sampleWindowMs))) : undefined;
  const note = typeof source.note === "string" ? marketingCompliantText(source.note, "", 120) : undefined;
  return { status, method, detectedSegments, silentSeconds, sampleWindowMs, note };
}

function talkVideoRecordText(input: {
  transcriptText: string;
  transcriptSource: "browser-speech" | "openai-transcription" | "script-fallback";
  scriptText: string;
  ratio: "9:16";
  durationSeconds: number;
  optimization?: MarketingAiRecord["talkOptimization"];
}) {
  const silence = input.optimization?.silenceTrim;
  const noise = input.optimization?.noiseReduction;
  const transcriptText = input.transcriptText.trim() || "未识别到语音，未生成字幕";
  const subtitleStatus = input.transcriptSource === "browser-speech"
    ? "已识别语音生成"
    : input.transcriptSource === "openai-transcription"
      ? "已由后端转写生成"
      : "未识别到语音，未生成字幕";
  return [
    "【口播字幕】",
    transcriptText,
    "",
    "【提词脚本】",
    input.scriptText,
    "",
    "【AI优化】",
    `自动字幕：${subtitleStatus}`,
    `口播降噪：${noise?.status ?? "已处理"}（${noise?.method ?? "browser getUserMedia audio constraints"}）`,
    `剪掉停顿：${silence?.status ?? "已检测"}${typeof silence?.detectedSegments === "number" ? `，检测到 ${silence.detectedSegments} 段停顿` : ""}${typeof silence?.silentSeconds === "number" ? `，约 ${silence.silentSeconds} 秒` : ""}`,
    `视频尺寸：${input.ratio}`,
    input.durationSeconds ? `视频时长：${input.durationSeconds}秒` : "",
  ].filter(Boolean).join("\n");
}

async function videoDataUrlToBlob(dataUrl: string) {
  const match = /^data:([^,]*),(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("口播视频格式不正确");
  const contentType = (match[1].split(";")[0] || "").toLowerCase();
  if (!contentType.startsWith("video/")) throw new Error("请上传视频格式的口播素材");
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("口播视频读取失败");
  const blob = await response.blob();
  return { contentType: blob.type || contentType, blob };
}

function videoExtensionForContentType(contentType: string) {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("ogg")) return "ogv";
  return "webm";
}

async function readR2Usage(env: Env): Promise<R2UsageSnapshot> {
  const bucket = getR2Bucket(env);
  const limitBytes = 10 * 1024 * 1024 * 1024;
  if (!bucket) {
    return {
      available: false,
      source: "r2-binding",
      objectCount: 0,
      totalBytes: 0,
      limitBytes,
      prefixes: [],
      updatedAt: nowIso(),
      message: "当前项目未绑定 R2 Bucket，无法读取真实容量。",
    };
  }

  const prefixMap = new Map<string, { objectCount: number; bytes: number }>();
  let cursor: string | undefined;
  let objectCount = 0;
  let totalBytes = 0;

  do {
    const result = await bucket.list({ cursor, limit: 1000 });
    for (const object of result.objects) {
      const bytes = typeof object.size === "number" ? object.size : 0;
      const prefix = object.key.includes("/") ? `${object.key.split("/")[0]}/` : "(根目录)";
      const current = prefixMap.get(prefix) ?? { objectCount: 0, bytes: 0 };
      current.objectCount += 1;
      current.bytes += bytes;
      prefixMap.set(prefix, current);
      objectCount += 1;
      totalBytes += bytes;
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  return {
    available: true,
    source: "r2-binding",
    bucketName: "R2_BUCKET",
    objectCount,
    totalBytes,
    limitBytes,
    prefixes: Array.from(prefixMap, ([prefix, value]) => ({ prefix, ...value })).sort((a, b) => b.bytes - a.bytes),
    updatedAt: nowIso(),
  };
}

async function readWorkerUsage(env: Env): Promise<WorkerUsageSnapshot> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const scriptName = env.CLOUDFLARE_WORKER_SCRIPT_NAME?.trim();
  const windowHours = 24;

  const fallback = (message: string): WorkerUsageSnapshot => ({
    available: false,
    source: "cloudflare-graphql",
    accountId,
    scriptName,
    requests: 0,
    errors: 0,
    subrequests: 0,
    windowHours,
    rows: [],
    updatedAt: nowIso(),
    message,
  });

  if (!accountId || !apiToken) {
    return fallback("Cloudflare Metrics 配置未完成，无法读取真实 Worker 请求量。");
  }

  const now = new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const filter: Record<string, string> = {
    datetime_geq: since.toISOString(),
    datetime_leq: now.toISOString(),
  };
  if (scriptName) filter.scriptName = scriptName;

  const query = `
    query WorkerUsage($accountTag: string!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 100, filter: $filter) {
            dimensions {
              scriptName
              status
            }
            sum {
              requests
              errors
              subrequests
            }
            quantiles {
              cpuTimeP50
              cpuTimeP99
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { accountTag: accountId, filter } }),
    });
    const payload = await response.json() as {
      data?: {
        viewer?: {
          accounts?: Array<{
            workersInvocationsAdaptive?: Array<{
              dimensions?: { scriptName?: string; status?: string };
              sum?: { requests?: number; errors?: number; subrequests?: number };
              quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number };
            }>;
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (!response.ok || payload.errors?.length) {
      const message = payload.errors?.map((item) => item.message).filter(Boolean).join("；") || `Cloudflare Metrics 读取失败(${response.status})`;
      return fallback(message);
    }

    const rows = (payload.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []).map((item) => ({
      scriptName: item.dimensions?.scriptName ?? "未命名 Worker",
      status: item.dimensions?.status ?? "unknown",
      requests: item.sum?.requests ?? 0,
      errors: item.sum?.errors ?? 0,
      subrequests: item.sum?.subrequests ?? 0,
      cpuTimeP50: item.quantiles?.cpuTimeP50,
      cpuTimeP99: item.quantiles?.cpuTimeP99,
    }));
    const requests = rows.reduce((sum, row) => sum + row.requests, 0);
    const errors = rows.reduce((sum, row) => sum + row.errors, 0);
    const subrequests = rows.reduce((sum, row) => sum + row.subrequests, 0);

    return {
      available: true,
      source: "cloudflare-graphql",
      accountId,
      scriptName,
      requests,
      errors,
      subrequests,
      cpuTimeP50: rows.length ? Math.max(...rows.map((row) => row.cpuTimeP50 ?? 0)) : undefined,
      cpuTimeP99: rows.length ? Math.max(...rows.map((row) => row.cpuTimeP99 ?? 0)) : undefined,
      windowHours,
      rows,
      updatedAt: nowIso(),
    };
  } catch (caught) {
    return fallback(caught instanceof Error ? caught.message : "Cloudflare Metrics 读取失败");
  }
}

type AiProviderKey = "openai" | "deepseek" | "seedance" | "kling" | "hailuo" | "grok";
type AiVideoResolution = "480p" | "720p" | "1080p";
type AiVideoAspectRatio = "9:16" | "1:1" | "16:9";
type AiTextModelConfig = {
  enabled: boolean;
  provider: Extract<AiProviderKey, "openai" | "deepseek">;
  model: string;
  apiKey: string;
  inputTokenUsdPerMillion: number;
  outputTokenUsdPerMillion: number;
};
const openAiImageModels = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] as const;
type OpenAiImageModel = typeof openAiImageModels[number];
type AiImageModelConfig = {
  enabled: boolean;
  provider: "openai";
  model: OpenAiImageModel;
  apiKey: string;
  defaultSize: "1024x1024" | "1024x1536" | "1536x1024";
  defaultQuality: "standard" | "high";
  maxImagesPerRequest: number;
  textInputUsdPerMillion: number;
  imageInputUsdPerMillion: number;
  imageOutputUsdPerMillion: number;
};
type AiVideoProviderConfig = {
  provider: Extract<AiProviderKey, "seedance" | "kling" | "hailuo" | "grok">;
  enabled: boolean;
  model: string;
  apiKey: string;
  defaultDurationSeconds: number;
  defaultResolution: AiVideoResolution;
  defaultAspectRatio: AiVideoAspectRatio;
  priceUsdBySpec: Record<string, number>;
};
type AiGenerationConfig = {
  copy: AiTextModelConfig;
  image: AiImageModelConfig;
  video: {
    defaultProvider: AiVideoProviderConfig["provider"];
    providers: AiVideoProviderConfig[];
  };
};
type AiChatMessage = { role: "user" | "assistant"; content: string };
type MarketingAiKind = "copy" | "image" | "video" | "talk";

const providerFetchTimeoutMs = 25_000;
const aiVideoDurations = [5, 10, 15];
const aiVideoResolutions: AiVideoResolution[] = ["480p", "720p", "1080p"];
const aiVideoAspectRatios: AiVideoAspectRatio[] = ["9:16", "1:1", "16:9"];
const defaultSeedanceModel = "doubao-seedance-2-0-fast-260128";
const defaultAiGenerationConfig: AiGenerationConfig = {
  copy: {
    enabled: true,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "",
    inputTokenUsdPerMillion: 0.435,
    outputTokenUsdPerMillion: 0.87,
  },
  image: {
    enabled: true,
    provider: "openai",
    model: "gpt-image-2",
    apiKey: "",
    defaultSize: "1024x1024",
    defaultQuality: "high",
    maxImagesPerRequest: 4,
    textInputUsdPerMillion: 5,
    imageInputUsdPerMillion: 8,
    imageOutputUsdPerMillion: 30,
  },
  video: {
    defaultProvider: "seedance",
    providers: [
      { provider: "seedance", enabled: true, model: defaultSeedanceModel, apiKey: "", defaultDurationSeconds: 5, defaultResolution: AI_VIDEO_PROVIDER_DEFAULT_RESOLUTIONS.seedance, defaultAspectRatio: "9:16", priceUsdBySpec: {} },
      { provider: "kling", enabled: false, model: "kling-v3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: AI_VIDEO_PROVIDER_DEFAULT_RESOLUTIONS.kling, defaultAspectRatio: "9:16", priceUsdBySpec: {} },
      { provider: "hailuo", enabled: false, model: "MiniMax-Hailuo-2.3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: AI_VIDEO_PROVIDER_DEFAULT_RESOLUTIONS.hailuo, defaultAspectRatio: "9:16", priceUsdBySpec: {} },
      { provider: "grok", enabled: false, model: "grok-imagine-video-1.5", apiKey: "", defaultDurationSeconds: 5, defaultResolution: AI_VIDEO_PROVIDER_DEFAULT_RESOLUTIONS.grok, defaultAspectRatio: "9:16", priceUsdBySpec: {} },
    ],
  },
};

function assertSuperadminAiTester(session: UserSession) {
  if (session.user.role !== "superadmin") {
    throw new Error("只有平台 Admin 可以测试 AI 接口");
  }
}

function cloneAiGenerationConfig(config: AiGenerationConfig = defaultAiGenerationConfig): AiGenerationConfig {
  return JSON.parse(JSON.stringify(config)) as AiGenerationConfig;
}

function normalizeAiPrice(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function normalizeOpenAiImageModel(value: unknown, fallback: OpenAiImageModel): OpenAiImageModel {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  return openAiImageModels.includes(model as OpenAiImageModel) ? model as OpenAiImageModel : fallback;
}

function normalizeSeedanceModel(value: unknown, fallback = defaultSeedanceModel) {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  const normalized = model.toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "seedance-2.0" || normalized === "doubao-seedance-2.0" || normalized === "doubao-seedance-2-0") {
    return "doubao-seedance-2-0-260128";
  }
  if (normalized === "seedance-2.0-fast" || normalized === "doubao-seedance-2.0-fast" || normalized === "doubao-seedance-2-0-fast") {
    return defaultSeedanceModel;
  }
  if (normalized === "seedance-1.5-pro" || normalized === "doubao-seedance-1.5-pro" || normalized === "doubao-seedance-1-5-pro") {
    return "doubao-seedance-1-5-pro-250728";
  }
  return model;
}

function normalizeAiGenerationConfig(input: unknown): AiGenerationConfig {
  const fallback = cloneAiGenerationConfig();
  if (!input || typeof input !== "object") return fallback;
  const record = input as Partial<AiGenerationConfig>;
  const copy = record.copy && typeof record.copy === "object" ? record.copy as Partial<AiTextModelConfig> : {};
  const image = record.image && typeof record.image === "object" ? record.image as Partial<AiImageModelConfig> : {};
  const video = record.video && typeof record.video === "object" ? record.video as Partial<AiGenerationConfig["video"]> : {};
  const inputProviders = Array.isArray(video.providers) ? video.providers : [];
  const providers = fallback.video.providers.map((defaultProvider) => {
    const incoming = inputProviders.find((item) => item && typeof item === "object" && (item as Partial<AiVideoProviderConfig>).provider === defaultProvider.provider) as Partial<AiVideoProviderConfig> | undefined;
    return {
      ...defaultProvider,
      ...incoming,
      enabled: typeof incoming?.enabled === "boolean" ? incoming.enabled : defaultProvider.enabled,
      apiKey: typeof incoming?.apiKey === "string" ? incoming.apiKey : defaultProvider.apiKey,
      model: defaultProvider.provider === "seedance"
        ? normalizeSeedanceModel(incoming?.model, defaultProvider.model)
        : typeof incoming?.model === "string" ? incoming.model : defaultProvider.model,
      defaultDurationSeconds: aiVideoDurations.includes(Number(incoming?.defaultDurationSeconds)) ? Number(incoming?.defaultDurationSeconds) : defaultProvider.defaultDurationSeconds,
      defaultResolution: aiVideoResolutions.includes(incoming?.defaultResolution as AiVideoResolution) ? incoming?.defaultResolution as AiVideoResolution : defaultProvider.defaultResolution,
      defaultAspectRatio: aiVideoAspectRatios.includes(incoming?.defaultAspectRatio as AiVideoAspectRatio) ? incoming?.defaultAspectRatio as AiVideoAspectRatio : defaultProvider.defaultAspectRatio,
      priceUsdBySpec: Object.fromEntries(Object.entries(incoming?.priceUsdBySpec ?? defaultProvider.priceUsdBySpec ?? {}).map(([key, value]) => [key, normalizeAiPrice(value)])),
    };
  });
  const defaultProvider = providers.some((provider) => provider.provider === video.defaultProvider)
    ? video.defaultProvider as AiVideoProviderConfig["provider"]
    : fallback.video.defaultProvider;
  return {
    copy: {
      ...fallback.copy,
      ...copy,
      enabled: typeof copy.enabled === "boolean" ? copy.enabled : fallback.copy.enabled,
      provider: copy.provider === "openai" || copy.provider === "deepseek" ? copy.provider : fallback.copy.provider,
      apiKey: typeof copy.apiKey === "string" ? copy.apiKey : fallback.copy.apiKey,
      model: typeof copy.model === "string" ? copy.model : fallback.copy.model,
      inputTokenUsdPerMillion: normalizeAiPrice(copy.inputTokenUsdPerMillion),
      outputTokenUsdPerMillion: normalizeAiPrice(copy.outputTokenUsdPerMillion),
    },
    image: {
      ...fallback.image,
      ...image,
      enabled: typeof image.enabled === "boolean" ? image.enabled : fallback.image.enabled,
      apiKey: typeof image.apiKey === "string" ? image.apiKey : fallback.image.apiKey,
      model: normalizeOpenAiImageModel(image.model, fallback.image.model),
      defaultSize: ["1024x1024", "1024x1536", "1536x1024"].includes(image.defaultSize ?? "") ? image.defaultSize as AiImageModelConfig["defaultSize"] : fallback.image.defaultSize,
      defaultQuality: image.defaultQuality === "standard" || image.defaultQuality === "high" ? image.defaultQuality : fallback.image.defaultQuality,
      maxImagesPerRequest: Math.max(1, Math.min(8, Math.trunc(Number(image.maxImagesPerRequest) || fallback.image.maxImagesPerRequest))),
      textInputUsdPerMillion: normalizeAiPrice(image.textInputUsdPerMillion),
      imageInputUsdPerMillion: normalizeAiPrice(image.imageInputUsdPerMillion),
      imageOutputUsdPerMillion: normalizeAiPrice(image.imageOutputUsdPerMillion),
    },
    video: { defaultProvider, providers },
  };
}

function aiGenerationConfigFromData(data: AppData) {
  const rawValue = data.systemConfigs?.find((item) => item.key === "ai_generation_config")?.value;
  if (!rawValue) return cloneAiGenerationConfig();
  try {
    return normalizeAiGenerationConfig(JSON.parse(rawValue));
  } catch {
    return cloneAiGenerationConfig();
  }
}

function requiredTrimmedText(body: JsonBody, key: string, maxLength: number) {
  const value = requiredString(body, key).trim();
  if (!value) throw new Error(`缺少字段 ${key}`);
  return value.slice(0, maxLength);
}

function optionalAiString(body: JsonBody, key: string, maxLength: number) {
  const value = optionalString(body, key)?.trim();
  return value ? value.slice(0, maxLength) : undefined;
}

function assertAiCapability(enabled: boolean, apiKey: string, model: string, capabilityName: string) {
  if (!enabled) throw new Error(`${capabilityName}能力未启用`);
  if (!apiKey.trim()) throw new Error(`${capabilityName}API Key 未配置`);
  if (!model.trim()) throw new Error(`${capabilityName}模型未配置`);
}

async function readProviderJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

function providerErrorMessage(provider: string, status: number, payload: Record<string, unknown>) {
  const error = payload.error;
  if (typeof error === "string") return friendlyProviderErrorMessage(provider, status, error);
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return friendlyProviderErrorMessage(provider, status, (error as { message: string }).message);
  }
  if (typeof payload.message === "string") return friendlyProviderErrorMessage(provider, status, payload.message);
  if (typeof payload.status_msg === "string") return friendlyProviderErrorMessage(provider, status, payload.status_msg);
  return `${provider} 返回错误(${status})`;
}

function friendlyProviderErrorMessage(provider: string, status: number, message: string) {
  const normalized = message.toLowerCase();
  const requestId = message.match(/request id:\s*([a-z0-9-]+)/i)?.[1];
  if (provider === "Seedance" && normalized.includes("input image") && normalized.includes("real person")) {
    return [
      `Seedance 返回错误(${status})：上传图片可能包含真人/人脸，当前产品视频接口不支持用真人照片做参考图。`,
      "请换成只包含产品、包装、护理场景的图片，或先裁掉人物脸部后重新生成。",
      requestId ? `请求ID：${requestId}` : "",
    ].filter(Boolean).join(" ");
  }
  return `${provider} 返回错误(${status})：${message}`;
}

async function fetchProviderJson(provider: string, url: string, init: RequestInit) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), providerFetchTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await readProviderJson(response);
    if (!response.ok) {
      throw new Error(providerErrorMessage(provider, response.status, payload));
    }
    return { payload, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${provider}调用超时：${Math.round(providerFetchTimeoutMs / 1000)}秒内未返回，请稍后重试或检查供应商状态`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readAiChatHistory(body: JsonBody): AiChatMessage[] {
  const value = body.history;
  if (!Array.isArray(value)) return [];
  return value.slice(-8).flatMap((item): AiChatMessage[] => {
    if (!item || typeof item !== "object") return [];
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return [];
    return [{ role, content: content.trim().slice(0, 2000) }];
  });
}

async function runAiTextCompletion(data: AppData, prompt: string, options: { history?: AiChatMessage[]; systemPrompt: string }) {
  const config = aiGenerationConfigFromData(data).copy;
  assertAiCapability(config.enabled, config.apiKey, config.model, "文案对话");
  const providerName = config.provider === "deepseek" ? "DeepSeek" : "OpenAI";
  const url = config.provider === "deepseek"
    ? "https://api.deepseek.com/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const { payload, elapsedMs } = await fetchProviderJson(providerName, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: options.systemPrompt },
        ...(options.history ?? []),
        { role: "user", content: prompt },
      ],
    }),
  });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: { content?: unknown }; text?: unknown }).message : undefined;
  const text = typeof message?.content === "string"
    ? message.content
    : typeof (choices[0] as { text?: unknown } | undefined)?.text === "string"
      ? (choices[0] as { text: string }).text
      : "";
  if (!text.trim()) throw new Error(`${providerName} 未返回可读内容`);
  return {
    provider: config.provider,
    model: config.model,
    text,
    usage: payload.usage,
    raw: compactAiRawPayload(payload),
    elapsedMs,
  };
}

async function runAiChatTest(data: AppData, body: JsonBody) {
  const prompt = requiredTrimmedText(body, "prompt", 4000);
  return runAiTextCompletion(data, prompt, {
    history: readAiChatHistory(body),
    systemPrompt: "你是祝融坤锋美业门店系统的 AI 测试助手，回答要直接、可执行，聚焦门店经营、营销、文案和员工操作。",
  });
}

function compactProductVideoAnalysisText(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  return marketingCompliantText(
    raw
      .replace(/^["“”'`]+|["“”'`]+$/g, "")
      .replace(/^镜头要求[：:]\s*/g, "")
      .replace(/\n+/g, "；")
      .replace(/\s*；\s*/g, "；"),
    "",
    200,
  );
}

async function runMarketingProductImageAnalysis(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data).image;
  const model = "gpt-4.1-mini";
  assertAiCapability(config.enabled, config.apiKey, model, "图片识别");
  const asset = marketingImageAsset(body, "product", "产品图");
  if (!asset) throw new Error("请先上传产品图");
  const videoTemplate = marketingCompliantText(optionalString(body, "videoTemplate"), "产品质感展示", 80);
  const videoPace = marketingCompliantText(optionalString(body, "videoPace"), "慢推", 40);
  const fallbackDraft = productVideoDraftFromAsset(asset, videoTemplate, videoPace);
  const { payload, elapsedMs } = await fetchProviderJson("OpenAI", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: "你是美业短视频产品图识别助手。只根据用户上传图片识别产品，不要编造节日、护理项目、药品功效或医疗描述。输出一段可直接放入“镜头要求/产品详情”的中文短句，200字以内，必须包含产品品类、颜色/材质/包装特征、适合的视频镜头建议。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请识别这张产品图，并结合视频模板“${videoTemplate}”和镜头节奏“${videoPace}”写成可编辑的镜头要求。不要写标题，不要换行，不要加入图片里没有的品牌名或功效。`,
            },
            { type: "image_url", image_url: { url: asset.dataUrl } },
          ],
        },
      ],
    }),
  });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: { content?: unknown } }).message : undefined;
  const text = compactProductVideoAnalysisText(message?.content) || fallbackDraft;
  return {
    provider: "openai" as const,
    model,
    text,
    usage: payload.usage,
    elapsedMs,
  };
}

function productVideoDraftFromAsset(asset: MarketingImageAsset, videoTemplate: string, videoPace: string) {
  const fileLabel = asset.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  const templateHint = videoTemplate.includes("人物")
    ? "人物自然出镜，手持或使用上传产品，产品和人物动作融合且清晰可辨"
    : videoTemplate.includes("手持")
      ? "手部拿起、展示和轻微转动"
      : videoTemplate.includes("门店")
        ? "门店空间中产品清晰入镜"
        : videoTemplate.includes("快节奏")
          ? "包装、细节和使用氛围快切"
          : "产品静物特写和柔光质感";
  return marketingCompliantText(
    [
      fileLabel && !/^产品\d*$/i.test(fileLabel) ? `产品：${fileLabel}` : "以上传产品图为准",
      templateHint,
      `${videoPace}镜头，保留产品外观、颜色、材质和包装识别点`,
    ].join("；"),
    "",
    200,
  );
}

function marketingRoleGroup(role: UserRole): "owner" | "staff" {
  return role === "owner" || role === "manager" || role === "superadmin" ? "owner" : "staff";
}

function assertMarketingAiAllowed(data: AppData, session: UserSession, capability: AiUsageCapability) {
  const config = aiGenerationConfigFromData(data);
  const platformEnabled = capability === "copy"
    ? config.copy.enabled
    : capability === "image"
      ? config.image.enabled
      : config.video.providers.some((provider) => provider.enabled);
  const capabilityLabel = capability === "copy" ? "文案" : capability === "image" ? "图片" : "视频";
  if (!platformEnabled) throw new Error(`平台未启用 AI ${capabilityLabel}能力`);
  const storeId = sessionStoreId(data, session);
  const store = storeId ? data.storeProfiles.find((item) => item.id === storeId) : undefined;
  const permissions = normalizeStoreAiUsagePermissions(store?.aiUsagePermissions);
  if (!permissions[marketingRoleGroup(session.user.role)][capability]) {
    throw new Error(`当前门店未开放 AI ${capabilityLabel}权限`);
  }
}

function assertMarketingAiGeneratePreflight(data: AppData, session: UserSession, kind: MarketingAiKind) {
  if (!["copy", "image", "video", "talk"].includes(kind)) throw new Error("AI 营销类型不正确");
  const capability: AiUsageCapability = kind === "image" ? "image" : kind === "video" ? "video" : "copy";
  assertMarketingAiAllowed(data, session, capability);
  assertAiFreeQuotaAvailable(data, session.user.id);
}

function assertMarketingAiGenerateBodyReady(body: JsonBody, kind: MarketingAiKind) {
  if (kind !== "video") return;
  if (!optionalString(body, "productImageDataUrl")) throw new Error("请先上传产品图，再生成产品视频");
  if (!marketingCompliantText(optionalString(body, "customRequirement"), "", 1000)) {
    throw new Error("请填写产品详情或镜头要求，避免模型乱生成并浪费积分");
  }
}

function marketingText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

const marketingComplianceReplacements: Array<[RegExp, string]> = [
  [/比医院还有效|替代药物/g, "作为日常护理参考"],
  [/绝对有效/g, "很多客户反馈有感"],
  [/100%见效|百分百见效/g, "做完后更容易感受到"],
  [/100%|百分百/g, "更安心"],
  [/一次见效|立刻见效|马上见效/g, "体验后更有感"],
  [/见效/g, "有感"],
  [/调理疾病|改善疾病/g, "调整状态"],
  [/根治|治愈/g, "改善"],
  [/治疗/g, "调理"],
  [/彻底|永久/g, "持续"],
  [/包治|包好/g, "多数客户反馈不错"],
  [/保证|必定/g, "建议体验"],
  [/无效退款/g, "体验前可先了解"],
  [/中医/g, "东方美学"],
  [/消炎|杀菌/g, "舒缓清洁"],
  [/诊断|处方/g, "评估建议"],
  [/药物|医疗|疾病/g, "日常护理"],
  [/疗效|效果/g, "感受"],
  [/绝对/g, "更"],
  [/三伏灸|三九灸|药灸|泥灸|艾灸|灸/g, "艾草温护"],
  [/药浴/g, "草本浴"],
  [/祛湿|排湿|湿气|湿重|寒湿/g, "清爽轻养"],
  [/舒肝/g, "放松舒缓"],
  [/温补|养阳/g, "温暖护理"],
  [/虚胖/g, "轻盈管理"],
  [/失眠/g, "睡眠状态"],
  [/疼痛/g, "不适"],
  [/炎症/g, "肌肤不适"],
  [/身体状态|痛点/g, "护理需求"],
  [/治/g, "调"],
];

function marketingCompliantString(value: string) {
  return marketingComplianceReplacements
    .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
    .replace(/[ \t]+/g, " ")
    .trim();
}

function marketingCompliantText(value: unknown, fallback = "", maxLength = 120) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return marketingCompliantString(raw.slice(0, maxLength));
}

function marketingPosterSafeText(value: unknown, fallback = "") {
  return marketingCompliantText(value, fallback);
}

function marketingImageSize(posterSize: string | undefined, model?: string) {
  const supportsCustomSize = model === "gpt-image-2" || model === "gpt-image-2-2026-04-21";
  if (supportsCustomSize) {
    if (posterSize?.includes("16:9")) return "1536x864";
    if (posterSize?.includes("9:16")) return "864x1536";
    if (posterSize?.includes("3:4")) return "1152x1536";
  }
  if (posterSize?.includes("16:9")) return "1536x1024";
  if (posterSize?.includes("9:16") || posterSize?.includes("3:4")) return "1024x1536";
  return "1024x1024";
}

type MarketingImageAsset = {
  key: "product" | "model" | "scene";
  label: string;
  name: string;
  dataUrl: string;
  mimeType: string;
};

function marketingImageAssets(body: JsonBody): MarketingImageAsset[] {
  return [
    marketingImageAsset(body, "product", "产品图"),
    marketingImageAsset(body, "model", "模特图"),
    marketingImageAsset(body, "scene", "门店图"),
  ].filter(Boolean) as MarketingImageAsset[];
}

function marketingImageAsset(body: JsonBody, key: MarketingImageAsset["key"], label: string): MarketingImageAsset | undefined {
  const dataUrl = optionalString(body, `${key}ImageDataUrl`);
  if (!dataUrl) return undefined;
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`${label}格式不正确，请上传 PNG、JPG 或 WebP 图片`);
  const base64Bytes = Math.floor(match[2].length * 0.75);
  if (base64Bytes > 8 * 1024 * 1024) throw new Error(`${label}不能超过 8MB`);
  return {
    key,
    label,
    name: marketingText(body[`${key}ImageName`], `${label}.${match[1].includes("png") ? "png" : match[1].includes("webp") ? "webp" : "jpg"}`),
    dataUrl,
    mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
  };
}

function marketingMaterialKeyFromDataUrl(dataUrl: string) {
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `image:${(hash >>> 0).toString(16)}:${dataUrl.length}`;
}

function marketingVideoTemplateKey(body: JsonBody) {
  return marketingCompliantText(optionalString(body, "posterStyle") || optionalString(body, "videoTemplate"), "产品质感展示", 80);
}

function marketingVideoParameterKey(body: JsonBody) {
  const ratio = marketingCompliantText(optionalString(body, "videoRatio"), "9:16", 12);
  const duration = aiVideoDurations.includes(Number(body.videoDuration)) ? Number(body.videoDuration) : 5;
  const resolution = aiVideoResolutions.includes(body.videoResolution as AiVideoResolution) ? body.videoResolution as string : "480p";
  const pace = marketingCompliantText(optionalString(body, "videoPace"), "慢推", 40);
  return `ratio:${ratio}:duration:${duration}:resolution:${resolution}:pace:${pace}`;
}

function marketingMaterialKey(body: JsonBody, kind: MarketingAiKind) {
  if (kind !== "video") return undefined;
  const productImageDataUrl = optionalString(body, "productImageDataUrl");
  return productImageDataUrl ? `${marketingMaterialKeyFromDataUrl(productImageDataUrl)}:template:${marketingVideoTemplateKey(body)}:${marketingVideoParameterKey(body)}` : undefined;
}

function findDuplicateMarketingVideoRecord(data: AppData, session: UserSession, body: JsonBody) {
  const materialKey = marketingMaterialKey(body, "video");
  const productImageDataUrl = optionalString(body, "productImageDataUrl");
  const legacyMaterialKey = productImageDataUrl ? marketingMaterialKeyFromDataUrl(productImageDataUrl) : undefined;
  const templateKey = marketingVideoTemplateKey(body);
  const legacyTemplateMaterialKey = legacyMaterialKey ? `${legacyMaterialKey}:template:${templateKey}` : undefined;
  const legacyDefaultParameterKey = marketingVideoParameterKey(body) === "ratio:9:16:duration:5:resolution:480p:pace:慢推";
  if (!materialKey) return undefined;
  return (data.marketingAiRecords ?? []).find((record) =>
    record.kind === "video"
    && record.createdBy === session.user.id
    && (
      record.materialKey === materialKey
      || (legacyDefaultParameterKey && record.materialKey === legacyTemplateMaterialKey && !record.videoResolution)
      || (legacyDefaultParameterKey && templateKey === "产品质感展示" && !record.videoTemplate && record.materialKey === legacyMaterialKey)
    )
    && record.status !== "生成失败"
    && !isStaleMarketingAiRecord(record)
  );
}

async function marketingImageBlob(asset: MarketingImageAsset) {
  const response = await fetch(asset.dataUrl);
  if (!response.ok) throw new Error(`${asset.label}读取失败`);
  return response.blob();
}

function aiUsageRecord(usage: unknown) {
  return usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
}

function nestedUsageNumber(source: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = source;
    for (const key of path) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "number" && Number.isFinite(current)) return current;
  }
  return 0;
}

function roundAiUsd(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function textGenerationCost(config: AiTextModelConfig, usage: unknown) {
  const record = aiUsageRecord(usage);
  const inputTokens = nestedUsageNumber(record, [["prompt_tokens"], ["input_tokens"]]);
  const explicitOutputTokens = nestedUsageNumber(record, [["completion_tokens"], ["output_tokens"]]);
  const totalTokens = nestedUsageNumber(record, [["total_tokens"]]);
  const outputTokens = explicitOutputTokens || Math.max(0, totalTokens - inputTokens);
  const amountUsd = roundAiUsd(inputTokens / 1_000_000 * config.inputTokenUsdPerMillion + outputTokens / 1_000_000 * config.outputTokenUsdPerMillion);
  return {
    amountUsd,
    currency: "USD" as const,
    basis: inputTokens || outputTokens ? "按文本 token 用量计算" : "供应商未返回 token 用量",
    priceConfigured: config.inputTokenUsdPerMillion > 0 || config.outputTokenUsdPerMillion > 0,
    estimated: false,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    totalTokens: totalTokens || undefined,
  };
}

type ImageCostEstimateInput = {
  prompt?: string;
  size?: string;
  quality?: string;
  assetCount?: number;
  reason?: string;
};

function estimatedImageGenerationCost(config: AiImageModelConfig, input: ImageCostEstimateInput): MarketingAiRecord["cost"] {
  const prompt = input.prompt ?? "";
  const textInputTokens = Math.max(1, Math.ceil(prompt.length / 2));
  const imageInputTokens = Math.max(0, input.assetCount ?? 0) * 1600;
  const size = input.size ?? config.defaultSize;
  const quality = input.quality ?? config.defaultQuality;
  const outputTokens = estimatedImageOutputTokens(config, size, quality);
  const amountUsd = roundAiUsd(
    textInputTokens / 1_000_000 * config.textInputUsdPerMillion
    + imageInputTokens / 1_000_000 * config.imageInputUsdPerMillion
    + outputTokens / 1_000_000 * config.imageOutputUsdPerMillion,
  );
  return {
    amountUsd,
    currency: "USD",
    basis: input.reason ?? `供应商未返回 token 用量，按 ${size} · ${quality} · ${input.assetCount ?? 0} 张参考图预估`,
    priceConfigured: config.textInputUsdPerMillion > 0 || config.imageInputUsdPerMillion > 0 || config.imageOutputUsdPerMillion > 0,
    estimated: true,
    inputTokens: textInputTokens + imageInputTokens,
    outputTokens,
    totalTokens: textInputTokens + imageInputTokens + outputTokens,
  };
}

function estimatedImageOutputTokens(config: AiImageModelConfig, size: string, quality: string) {
  const normalizedQuality = quality === "standard" ? "medium" : quality;
  if (config.model === "gpt-image-2") {
    const isSquare = size === "1024x1024";
    if (normalizedQuality === "low") return isSquare ? 200 : 167;
    if (normalizedQuality === "medium") return isSquare ? 1767 : 1367;
    return isSquare ? 7033 : 5500;
  }
  const legacyTokens: Record<string, Record<string, number>> = {
    low: { "1024x1024": 272, "1024x1536": 408, "1536x1024": 400 },
    medium: { "1024x1024": 1056, "1024x1536": 1584, "1536x1024": 1568 },
    high: { "1024x1024": 4160, "1024x1536": 6240, "1536x1024": 6208 },
  };
  return legacyTokens[normalizedQuality]?.[size] ?? legacyTokens.high["1024x1024"];
}

function imageGenerationCost(config: AiImageModelConfig, usage: unknown, estimate?: ImageCostEstimateInput) {
  const record = aiUsageRecord(usage);
  const textInputTokens = nestedUsageNumber(record, [["text_input_tokens"], ["input_tokens"], ["prompt_tokens"]]);
  const imageInputTokens = nestedUsageNumber(record, [["image_input_tokens"], ["input_tokens_details", "image_tokens"]]);
  const outputTokens = nestedUsageNumber(record, [["image_output_tokens"], ["output_tokens"], ["completion_tokens"]]);
  const totalTokens = nestedUsageNumber(record, [["total_tokens"]]);
  if (!textInputTokens && !imageInputTokens && !outputTokens && estimate) {
    return estimatedImageGenerationCost(config, estimate);
  }
  const amountUsd = roundAiUsd(
    textInputTokens / 1_000_000 * config.textInputUsdPerMillion
    + imageInputTokens / 1_000_000 * config.imageInputUsdPerMillion
    + outputTokens / 1_000_000 * config.imageOutputUsdPerMillion,
  );
  return {
    amountUsd,
    currency: "USD" as const,
    basis: textInputTokens || imageInputTokens || outputTokens ? "按图片生成 token 用量计算" : "供应商未返回 token 用量",
    priceConfigured: config.textInputUsdPerMillion > 0 || config.imageInputUsdPerMillion > 0 || config.imageOutputUsdPerMillion > 0,
    estimated: false,
    inputTokens: (textInputTokens + imageInputTokens) || undefined,
    outputTokens: outputTokens || undefined,
    totalTokens: totalTokens || undefined,
  };
}

function combinedAiGenerationCost(label: string, ...costs: Array<MarketingAiRecord["cost"] | undefined>): MarketingAiRecord["cost"] {
  const availableCosts = costs.filter(Boolean) as NonNullable<MarketingAiRecord["cost"]>[];
  const inputTokens = availableCosts.reduce((total, cost) => total + (cost.inputTokens ?? 0), 0);
  const outputTokens = availableCosts.reduce((total, cost) => total + (cost.outputTokens ?? 0), 0);
  const totalTokens = availableCosts.reduce((total, cost) => total + (cost.totalTokens ?? 0), 0);
  return {
    amountUsd: roundAiUsd(availableCosts.reduce((total, cost) => total + cost.amountUsd, 0)),
    currency: "USD",
    basis: label,
    priceConfigured: availableCosts.some((cost) => cost.priceConfigured),
    estimated: availableCosts.some((cost) => cost.estimated),
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    totalTokens: totalTokens || undefined,
  };
}

function aiCostBreakdown(input: MarketingAiRecord["costBreakdown"]): MarketingAiRecord["costBreakdown"] {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([, cost]) => Boolean(cost))) as MarketingAiRecord["costBreakdown"];
}

function aiBillingForCost(quotaState: ReturnType<typeof assertAiFreeQuotaAvailable>, cost: MarketingAiRecord["cost"]): MarketingAiRecord["billing"] {
  if (quotaState.credits <= 0) return { source: "free" };
  return { source: "credit", chargeCurrency: "CNY", creditsCharged: aiCreditChargeForCost(cost) };
}

function normalizeMarketingAiGenerateBody(body: JsonBody, kind: MarketingAiKind): JsonBody {
  if (kind !== "image" && kind !== "video") return body;
  return {
    ...body,
    productName: undefined,
    serviceName: undefined,
    channel: undefined,
    marketingNode: undefined,
    customerType: undefined,
    lifecycleNode: undefined,
    bodyState: undefined,
    marketingGoal: undefined,
    posterTitle: undefined,
    posterOffer: undefined,
    talkScene: undefined,
    ...(kind === "image" ? { videoScript: undefined } : {}),
  };
}

function marketingPosterStyleSceneDirective(posterStyle: string, hasModelAsset: boolean) {
  if (posterStyle.includes("东方美学")) {
    return "风格场景：参考示例有人物，必须生成一位气质自然的东方审美人物，人物可手持、轻触、使用或在梳妆/护理台旁展示上传产品；人物服装、妆容、背景、花器、屏风、木质或宣纸质感都要服务东方美学氛围；上传产品必须清晰完整地出现在画面核心位置，人物和产品要像真实广告拍摄一样融合。";
  }
  if (posterStyle.includes("轻奢")) {
    return "风格场景：参考示例有人物和护理动作，必须生成高级护理人物、局部手部或专业护理师动作来衬托产品；金属、玻璃、丝绒、柔光等材质要克制高级；上传产品必须作为主角，不能被人物或空间抢走。";
  }
  if (posterStyle.includes("医美") || posterStyle.includes("极简")) {
    return "风格场景：参考示例有人物和仪器动作，必须生成自然真实的人物面部、手部或专业护理动作作为信任感场景；整体保持洁净、专业、极简，像专业品牌大片；上传产品保持清晰、干净、可信。";
  }
  if (posterStyle.includes("国潮") || posterStyle.includes("草本")) {
    return `${hasModelAsset ? "风格场景：参考示例以产品陈列为主；用户上传了模特图时可以让模特轻度参与展示产品，但不要抢主体。" : "风格场景：参考示例没有人物主体，不要强行生成人物；以产品陈列、中式器物、植物、纸纹、木质台面和国潮包装质感为主。"}背景可有东方草本氛围，但不能改变上传产品品类。`;
  }
  if (posterStyle.includes("香氛") || posterStyle.includes("生活")) {
    return `${hasModelAsset ? "风格场景：参考示例以生活产品陈列为主；用户上传了模特图时可以让人物自然出现在生活场景中展示产品。" : "风格场景：参考示例没有人物主体，不要强行生成人物；以居家台面、窗光、香氛、花材、毛巾和植物氛围来承托产品。"}整体要松弛、自然、像真实生活方式大片。`;
  }
  if (posterStyle.includes("沙龙") || posterStyle.includes("高端")) {
    return `${hasModelAsset ? "风格场景：参考示例以高端门店空间和产品陈列为主；用户上传了模特图时可以让人物作为远景或局部动作出现。" : "风格场景：参考示例没有人物主体，不要强行生成人物；以高端美业沙龙空间、镜面、灯光、陈列台和产品静物为主。"}上传产品应像门店主推产品一样被清晰展示。`;
  }
  if (posterStyle.includes("小红书") || posterStyle.includes("种草")) {
    return "风格场景：参考示例有人物、手部试用和拼贴感，必须生成自然人物自拍感、手部试用、手持产品、桌面随拍或多图拼贴；画面要真实、有分享感，像小红书种草内容，上传产品保持清楚可辨。";
  }
  if (posterStyle.includes("节气")) {
    return `${hasModelAsset ? "风格场景：参考示例以产品陈列和节令植物为主；用户上传了模特图时可以让人物作为轻量氛围出现。" : "风格场景：参考示例没有人物主体，不要强行生成人物；以节令植物、自然光、水面、花材、布料和产品静物陈列为主。"}画面保留季节氛围，但不能加入与上传产品无关的节日营销文字。`;
  }
  return `${hasModelAsset ? "风格场景：用户上传了模特图，可以让人物自然展示产品。" : "风格场景：按示例风格生成产品静物或生活场景，不要强行生成人物。"}背景和道具都必须服务产品展示，上传产品保持清晰完整。`;
}

function marketingVideoTemplateDirective(template: string, hasModelAsset: boolean) {
  if (template.includes("质感")) {
    return "视频模板：产品质感展示。以产品静物为主，镜头缓慢推进或轻微环绕，重点表现包装、材质、光影、反光、纹理和高级陈列感；不强行生成人物。";
  }
  if (template.includes("手持") || template.includes("试用")) {
    return "视频模板：手持试用展示。生成自然手部动作，例如拿起产品、打开包装、挤出质地、涂抹或放回台面；手部动作必须服务产品展示，产品始终清楚。";
  }
  if (template.includes("人物") || template.includes("种草")) {
    return `${hasModelAsset ? "视频模板：人物场景种草。优先使用上传模特图的人物特征" : "视频模板：人物场景种草。必须自动生成自然真实的人物"}，人物要手持、试用或近景展示上传产品，产品必须和人物动作融合且清晰可辨；画面像社媒真实分享，包含自拍感、局部试用或生活化陈列；不要变成项目服务广告。`;
  }
  if (template.includes("门店") || template.includes("护理")) {
    return "视频模板：门店护理场景。产品出现在护理床、护理师动作、前台陈列或门店空间中，镜头围绕产品和门店质感展开；不能把产品改成护理项目本身。";
  }
  if (template.includes("品牌") || template.includes("广告")) {
    return "视频模板：高端品牌广告。使用微距、慢动作、柔光、包装特写、材质细节和高级陈列，节奏克制，像品牌大片；不要加入廉价促销字幕。";
  }
  if (template.includes("快节奏") || template.includes("切片")) {
    return "视频模板：社媒快节奏切片。用多个短镜头快速切换，展示包装、质地、手部使用、场景氛围和产品特写；节奏更适合短视频平台，但画面仍要高级干净。";
  }
  return "视频模板：产品短视频。围绕上传产品做稳定、真实、可发布的商业短视频，镜头和人物都必须服务产品展示。";
}

function videoGenerationCost(config: AiVideoProviderConfig, durationSeconds: number, resolution: AiVideoResolution) {
  const specKey = `${durationSeconds}s:${resolution}`;
  const amountUsd = roundAiUsd(config.priceUsdBySpec[specKey] ?? 0);
  return {
    amountUsd,
    currency: "USD" as const,
    basis: `${durationSeconds}秒 · ${resolution}`,
    priceConfigured: amountUsd > 0,
    estimated: false,
  };
}

const marketingTalkNewsQuery = "护肤 OR 美容 OR 皮肤管理 OR 防晒 OR 抗老 OR 面部护理 when:2d";

function xmlTagValue(xml: string, tag: string) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? decodeXmlText(match[1]) : "";
}

function decodeXmlText(value: string) {
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return withoutCdata
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function talkTopicIdFromTitle(title: string, index: number) {
  const slug = title
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `news-${slug || index}`;
}

function newsTitleToTalkTopicTitle(title: string) {
  const compact = title.replace(/\s+-\s+[^-]+$/g, "").replace(/^[\s【】]+|[\s【】]+$/g, "");
  if (!compact) return "今日美业热点怎么跟顾客讲？";
  if (compact.length <= 22) return compact;
  return `${compact.slice(0, 22)}…`;
}

function fallbackTalkTopics(errorMessage?: string) {
  const topics: MarketingTalkTopic[] = [
    {
      id: "fallback-season-care",
      title: "今天顾客问得最多的换季护理",
      description: "结合当天门店咨询，把脸干、泛红、卡粉讲成顾客听得懂的护理建议。",
      tags: ["本地兜底", "门店常见问题"],
    },
    {
      id: "fallback-sunscreen",
      title: "防晒和补水为什么要一起讲？",
      description: "适合把日常护理、防晒习惯和到店补水修护串成短视频口播。",
      tags: ["本地兜底", "日常护理"],
    },
    {
      id: "fallback-home-care",
      title: "在家护肤别踩这3个坑",
      description: "用顾客容易遇到的误区做开场，再自然引导到门店护理建议。",
      tags: ["本地兜底", "口播干货"],
    },
  ];
  return { topics, source: "fallback" as const, fetchedAt: new Date().toISOString(), query: marketingTalkNewsQuery, ...(errorMessage ? { errorMessage } : {}) };
}

async function fetchMarketingTalkTopics() {
  const fetchedAt = new Date().toISOString();
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(marketingTalkNewsQuery)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  try {
    const response = await fetch(rssUrl, {
      headers: {
        "user-agent": "YiCh Beauty System/1.0 (+https://yich-beauty-system-22u.pages.dev)",
        accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!response.ok) throw new Error(`新闻源返回 ${response.status}`);
    const xml = await response.text();
    const seen = new Set<string>();
    const topics: MarketingTalkTopic[] = [];
    const itemMatches = xml.matchAll(/<item\b[\s\S]*?<\/item>/gi);
    for (const [index, match] of Array.from(itemMatches).entries()) {
      const itemXml = match[0];
      const rawTitle = xmlTagValue(itemXml, "title");
      const title = newsTitleToTalkTopicTitle(rawTitle);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      const source = xmlTagValue(itemXml, "source") || "Google News";
      const published = xmlTagValue(itemXml, "pubDate");
      const publishedDate = published ? new Date(published) : undefined;
      const publishedAt = publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : undefined;
      topics.push({
        id: talkTopicIdFromTitle(title, index),
        title,
        description: `来自${source}的近两天新闻线索，适合转成顾客听得懂的护理建议。`,
        tags: ["今日新闻", source.slice(0, 10)],
        source,
        publishedAt,
      });
      if (topics.length >= 5) break;
    }
    if (!topics.length) return fallbackTalkTopics("新闻源暂时没有返回可用选题");
    return { topics, source: "news-rss" as const, fetchedAt, query: marketingTalkNewsQuery };
  } catch (error) {
    const message = error instanceof Error ? error.message : "新闻抓取失败";
    return fallbackTalkTopics(message);
  }
}

function marketingPrompt(body: JsonBody, kind: MarketingAiKind) {
  const storeName = marketingCompliantText(body.storeName, "美业门店");
  const productName = marketingCompliantText(body.productName, "护理产品");
  const serviceName = marketingCompliantText(body.serviceName, "护理项目");
  const audience = marketingCompliantText(body.audience, "目标客户");
  const channel = marketingCompliantText(body.channel, "朋友圈");
  const marketingNode = marketingCompliantText(body.marketingNode, "日常护理节点");
  const customerType = marketingCompliantText(body.customerType, audience);
  const lifecycleNode = marketingCompliantText(body.lifecycleNode, "无明确消费节点");
  const bodyState = marketingCompliantText(body.bodyState, "常规护理需求");
  const marketingGoal = marketingCompliantText(body.marketingGoal, "到店转化");
  const posterStyle = marketingCompliantText(body.posterStyle, "门店品牌风格");
  const customRequirement = marketingCompliantText(optionalString(body, "customRequirement"), "无", 1000);
  const compliance = "合规要求：只写生活美容和日常护理表达；用“调、改善、感受、体验、舒缓、护理建议”这类说法；规避绝对化承诺、专业诊疗表达、机构或药品对比。";
  const nodeContext = `营销节点：${marketingNode}。客户类型：${customerType}。消费节点：${lifecycleNode}。护理需求/文案方向：${bodyState}。营销目的：${marketingGoal}。产品设计图/内容风格：${posterStyle}。`;
  if (kind === "copy") {
    return `请为美业门店生成一套${channel}营销内容。门店：${storeName}。商品：${productName}。项目：${serviceName}。${nodeContext}客群摘要：${audience}。客户自定义要求：${customRequirement}。要求：中文，适合门店员工直接复制发布，包含标题、正文、到店邀约，也要能配合产品设计图标题使用；围绕时间节点和客户当前状态来写，不要把客户身份、护理需求、营销目的混为一类；${compliance}`;
  }
  if (kind === "talk") {
    const talkScene = marketingCompliantText(body.talkScene, `${channel}口播`);
    return `请生成一段美业门店口播脚本。使用场景：${talkScene}。门店：${storeName}。商品：${productName}。项目：${serviceName}。${nodeContext}客群摘要：${audience}。客户自定义要求：${customRequirement}。要求：中文，适合短视频、视频号或直播开场口播；节奏自然，短句，像店长或美容师真人介绍；包含开场钩子、客户感受、项目推荐理由、到店预约引导；${compliance}`;
  }
  if (kind === "image") {
    const posterSize = marketingCompliantText(body.posterSize, "朋友圈 1:1");
    const assets = marketingImageAssets(body);
    const assetSummary = assets.length ? assets.map((asset) => `${asset.label}：${asset.name}`).join("；") : "未上传素材";
    const productDetail = marketingCompliantText(optionalString(body, "customRequirement"), "", 1000);
    const productDetailLine = productDetail ? `用户填写的产品详情/要求：${productDetail}。这些信息只用于理解产品特点、材质、适用场景和画面要求，不要直接照抄成大段海报文字。` : "";
    const hasModelAsset = Boolean(optionalString(body, "modelImageDataUrl"));
    const styleSceneDirective = marketingPosterStyleSceneDirective(posterStyle, hasModelAsset);
    return `基于用户上传的产品图生成一张可直接用于美业门店发布的高端产品设计图。核心任务：以参考产品图片为唯一依据和唯一主体，自动从上传图片中识别产品外观、包装、材质、颜色、名称和卖点，围绕这个上传产品做商业海报设计。门店：${storeName}。尺寸用途：${posterSize}。产品设计图风格：${posterStyle}。${productDetailLine}${styleSceneDirective}参考素材：${assetSummary}。素材使用要求：必须优先保留上传产品的外观、包装、颜色、形状、材质、名称和关键识别点；必须忽略请求里的商品名、项目名、posterTitle、posterOffer、节日节点、渠道、营销目标或任务；不要把产品自动改成其他品类；不要加入任何与上传图片无关的节日名、营销任务、护理项目名、人体部位或服务场景，除非这些元素已经明确出现在上传产品图或用户填写的产品详情中；人物出现与否必须跟所选风格示例一致，不能每个风格都硬塞人物；如果用户额外上传了模特图，优先保持该人物自然真实并与产品互动；如果有门店图，只作为背景质感参考，不能抢产品主体。视觉要求：真实高级美业商业产品海报，不要廉价模板，不要卡通，不要网页 UI 截图，不要水印；画面以产品陈列、干净台面、品牌质感、适当植物/光影/材质为主；不要凭空添加任何营销标题、活动文案或卖点文字；只允许保留或轻微美化上传产品包装上原本可识别的文字，无法识别时宁可不加文字；排版克制、留白高级、手机端一眼能看懂；${compliance}`;
  }
  if (kind === "video") {
    const videoRatio = marketingCompliantText(body.videoRatio, "9:16");
    const videoDuration = Number(body.videoDuration) || 5;
    const videoScript = marketingCompliantText(body.videoScript, "产品静物陈列，镜头缓慢推进，展示产品包装、质感和使用氛围。", 800);
    const assets = marketingImageAssets(body);
    const assetSummary = assets.length ? assets.map((asset) => `${asset.label}：${asset.name}`).join("；") : "未上传素材";
    const productDetail = marketingCompliantText(optionalString(body, "customRequirement"), "", 1000);
    const productDetailLine = productDetail ? `用户填写的产品详情/要求：${productDetail}。这些信息只用于理解产品特点、材质、适用场景和镜头要求，不要生成大段字幕。` : "";
    const hasModelAsset = Boolean(optionalString(body, "modelImageDataUrl"));
    const videoTemplateDirective = marketingVideoTemplateDirective(posterStyle, hasModelAsset);
    return `基于用户上传的产品图生成一条美业门店可发布的产品短视频。核心任务：以上传产品图为唯一产品来源，保持产品外观、包装、颜色、材质、形状和关键识别点，围绕这个产品做图生视频。门店：${storeName}。视频比例：${videoRatio}。时长：${videoDuration}秒。产品视频模板：${posterStyle}。${productDetailLine}${videoTemplateDirective}参考素材：${assetSummary}。镜头要求：${videoScript}。素材使用要求：必须优先展示上传产品图里的真实产品，不要把产品改成其他品类；不要加入任何与上传图片、产品详情或所选视频模板无关的节日名、营销任务、护理项目名、人体部位或服务场景；如果用户额外上传了模特图，优先保持该人物自然真实并与产品互动；如果有门店图，只作为空间氛围参考。视频要求：真实高级商业短视频，镜头稳定，产品始终清晰可辨，不要水印，不要卡通，不要 UI 截图，不要长字幕；可保留产品包装上原有文字，避免新增营销文字；${compliance}`;
  }
  const videoRatio = marketingCompliantText(body.videoRatio, "9:16");
  const videoDuration = Number(body.videoDuration) || 5;
  const videoScript = marketingCompliantText(body.videoScript, "门店护理环境、产品陈列、护理手法和预约引导。");
  const assets = marketingImageAssets(body);
  const assetSummary = assets.length ? assets.map((asset) => `${asset.label}：${asset.name}`).join("；") : "未上传素材";
  return `基于用户上传素材生成美业门店产品展示短视频。门店：${storeName}。商品：${productName}。项目：${serviceName}。${nodeContext}参考素材：${assetSummary}。比例：${videoRatio}。时长：${videoDuration}秒。脚本重点：${videoScript}。画面要专业、真实、干净，优先展示上传产品、模特或门店场景，保持产品外观和包装识别度；适合短视频发布；${compliance}`;
}

function marketingCopyPosterPrompt(body: JsonBody, copyText: string) {
  const safeCopyText = marketingCompliantText(copyText, "节令护理", 800);
  const storeName = marketingCompliantText(body.storeName, "美业门店");
  const channel = marketingCompliantText(body.channel, "朋友圈");
  const posterStyle = marketingPosterSafeText(body.posterStyle, "高端美业风");
  const posterSize = marketingCompliantText(body.posterSize, "朋友圈 1:1");
  const assets = marketingImageAssets(body);
  const assetSummary = assets.length ? assets.map((asset) => `${asset.label}：${asset.name}`).join("；") : "未上传素材";
  return `Create a premium beauty salon promotional poster for social media. Brand/store name: ${storeName}. Channel: ${channel}. Style: ${posterStyle}. Target format: ${posterSize}. Reference assets: ${assetSummary}. Copy reference: ${safeCopyText}. Visual direction: elegant beauty salon interior, soft natural light, clean skincare product display, plants, fragrance diffuser, refined commercial photography, warm modern composition, plenty of negative space, phone-friendly poster layout. Include only short Chinese poster text: main title “节令护理” and subtitle “预约到店体验”. Keep it tasteful, realistic, polished, and uncluttered. Avoid medical claims, absolute promises, hospital comparisons, and medicine replacement wording.`;
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  }[char] ?? char));
}

function compactMarketingLine(value: string, fallback: string, maxLength: number) {
  const compact = value.replace(/[【】#*_`]/g, "").replace(/\s+/g, " ").trim();
  return escapeSvgText((compact || fallback).slice(0, maxLength));
}

function marketingPosterLines(value: string, fallback: string, maxLength: number, lineLength: number, maxLines: number) {
  const compact = value.replace(/[【】#*_`]/g, "").replace(/\s+/g, " ").trim();
  const truncated = (compact || fallback).slice(0, maxLength);
  const lines: string[] = [];
  for (let index = 0; index < truncated.length && lines.length < maxLines; index += lineLength) {
    lines.push(escapeSvgText(truncated.slice(index, index + lineLength)));
  }
  return lines.length ? lines : [escapeSvgText(fallback)];
}

function marketingPosterDataUrl(body: JsonBody, text: string) {
  const marketingNode = marketingCompliantText(body.marketingNode, "节令护理");
  const storeName = marketingCompliantText(body.storeName, "美业门店");
  const serviceName = marketingCompliantText(body.serviceName, "护理项目");
  const marketingGoal = marketingCompliantText(body.marketingGoal, "护理提醒");
  const bodyState = marketingCompliantText(body.bodyState, "护理需求");
  const posterStyle = marketingCompliantText(body.posterStyle, "东方美学风");
  const customRequirement = marketingCompliantText(optionalString(body, "customRequirement"), "", 180);
  const safeText = marketingCompliantText(text, "适合门店朋友圈发布", 360);
  const title = compactMarketingLine(marketingNode, "节令护理", 18);
  const headlineLines = marketingPosterLines(`${marketingNode} · ${marketingGoal}`, "清爽护理提醒", 18, 9, 2);
  const subtitleLines = marketingPosterLines(customRequirement || `${serviceName} · ${bodyState}` || safeText, "适合门店朋友圈发布", 24, 16, 2);
  const footer = compactMarketingLine(`${storeName}｜${marketingGoal}`, "门店护理提醒", 26);
  const wellness = posterStyle.includes("东方") || posterStyle.includes("节气") || posterStyle.includes("草本");
  const background = wellness
    ? `<rect width="900" height="1200" fill="#f7f1e4"/><circle cx="720" cy="210" r="180" fill="#e4d3b4" opacity=".42"/><path d="M70 920 C260 810 380 1010 610 880 C725 815 805 830 865 872" fill="none" stroke="#b89155" stroke-width="6" opacity=".35"/>`
    : `<rect width="900" height="1200" fill="#f7f3ff"/><circle cx="735" cy="210" r="190" fill="#d7c7ff" opacity=".44"/><circle cx="154" cy="960" r="230" fill="#bfe7df" opacity=".34"/>`;
  const accent = wellness ? "#7a5a2b" : "#5c3ab0";
  const headlineSvg = headlineLines.map((line, index) => `<text x="120" y="${350 + index * 88}" fill="#342821" font-size="78" font-weight="900" font-family="PingFang SC, Microsoft YaHei, sans-serif">${line}</text>`).join("");
  const subtitleSvg = subtitleLines.map((line, index) => `<text x="152" y="${612 + index * 40}" fill="#5c5270" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, sans-serif">${line}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  ${background}
  <rect x="72" y="72" width="756" height="1056" rx="34" fill="rgba(255,255,255,.62)" stroke="${accent}" stroke-opacity=".24" stroke-width="3"/>
  <text x="120" y="190" fill="${accent}" font-size="42" font-weight="800" font-family="PingFang SC, Microsoft YaHei, sans-serif">${title}</text>
  ${headlineSvg}
  <rect x="120" y="548" width="660" height="190" rx="24" fill="rgba(255,255,255,.72)" stroke="${accent}" stroke-opacity=".18"/>
  ${subtitleSvg}
  <text x="152" y="706" fill="#5c5270" font-size="26" font-weight="600" font-family="PingFang SC, Microsoft YaHei, sans-serif">结合节气、项目和客户状态生成</text>
  <rect x="120" y="854" width="660" height="1" fill="${accent}" opacity=".24"/>
  <text x="120" y="940" fill="${accent}" font-size="34" font-weight="800" font-family="PingFang SC, Microsoft YaHei, sans-serif">${footer}</text>
  <text x="120" y="1002" fill="#756b84" font-size="24" font-weight="600" font-family="PingFang SC, Microsoft YaHei, sans-serif">到店护理建议 · 合规营销素材</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function runMarketingAiBackgroundTask(
  env: Env,
  database: D1BeautyDatabase,
  session: UserSession,
  body: JsonBody,
  kind: MarketingAiKind,
  pendingRecord: MarketingAiRecord,
  locks: { accountLockId?: string; globalLockId?: string },
  startedAt: number,
) {
  try {
    const currentData = await readMarketingAiData(database, session);
    const result = await runMarketingAiGenerate(currentData, session, body);
    const resultVideoUrl = kind === "video" && "videoUrl" in result ? result.videoUrl : undefined;
    const resultProviderStatus = kind === "video" && "status" in result ? result.status : undefined;
    const resultStatus = kind === "video" && !resultVideoUrl ? resultProviderStatus || "任务已提交" : "已完成";
    let record = {
      ...marketingAiRecord(currentData, session, body, { ...result, status: resultStatus }),
      id: pendingRecord.id,
      createdAt: pendingRecord.createdAt,
    };
    if (record.imageDataUrl) {
      const storedImageUrl = await storeMarketingAiImage(env, record, record.imageDataUrl);
      record = { ...record, imageDataUrl: storedImageUrl };
    }
    await database.appendMarketingAiResult({
      record,
      log: marketingAiOperationLog(session, record),
      consumeCreditUserId: result.billing?.source === "credit" ? session.user.id : undefined,
      consumeCreditAmount: result.billing?.source === "credit" ? result.billing.creditsCharged : undefined,
    });
  } catch (error) {
    const currentData = await readMarketingAiData(database, session);
    const message = error instanceof Error ? error.message : "AI 生成失败";
    const failureCost = marketingAiFailureCost(currentData, body, kind, error);
    const failureRecord = {
      ...marketingAiRecord(currentData, session, body, {
        kind,
        ...marketingAiPendingProvider(currentData, kind, body),
        text: message,
        status: "生成失败",
        errorMessage: message,
        elapsedMs: Date.now() - startedAt,
        cost: failureCost,
        costBreakdown: aiCostBreakdown({ image: failureCost }),
      }),
      id: pendingRecord.id,
      createdAt: pendingRecord.createdAt,
    };
    await database.appendMarketingAiResult({
      record: failureRecord,
      log: marketingAiOperationLog(session, failureRecord),
    });
  } finally {
    await database.releaseAiGenerationLocks(locks);
  }
}

async function runMarketingAiGenerate(data: AppData, session: UserSession, body: JsonBody) {
  const kind = requiredString(body, "kind") as MarketingAiKind;
  const generateBody = normalizeMarketingAiGenerateBody(body, kind);
  if (!["copy", "image", "video", "talk"].includes(kind)) throw new Error("AI 营销类型不正确");
  const requestedCopyOutputMode = optionalString(generateBody, "copyOutputMode");
  const copyOutputMode = requestedCopyOutputMode === "text" || requestedCopyOutputMode === "image" ? requestedCopyOutputMode : "poster";
  const capability: AiUsageCapability = kind === "image" ? "image" : kind === "video" ? "video" : "copy";
  assertMarketingAiAllowed(data, session, capability);
  if (kind === "video" && !optionalString(generateBody, "productImageDataUrl")) throw new Error("请先上传产品图，再生成产品视频");
  if (kind === "video" && !marketingCompliantText(optionalString(generateBody, "customRequirement"), "", 1000)) throw new Error("请填写产品详情或镜头要求，避免模型乱生成并浪费积分");
  const quotaState = assertAiFreeQuotaAvailable(data, session.user.id);
  const prompt = marketingPrompt(generateBody, kind);
  if (kind === "copy" || kind === "talk") {
    const config = aiGenerationConfigFromData(data).copy;
    const result = await runAiTextCompletion(data, prompt, {
      systemPrompt: "你是祝融坤锋美业门店系统的营销助手。输出必须可直接给门店员工使用，中文，具体、自然、合规。只写生活美容和日常护理表达，避免绝对化承诺、专业诊疗表达、机构或药品对比。",
    });
    const safeText = marketingCompliantText(result.text, "", 6000);
    if (kind === "talk") {
      const textCost = textGenerationCost(config, result.usage);
      const billing = aiBillingForCost(quotaState, textCost);
      return { kind, provider: result.provider, model: result.model, text: safeText, usage: result.usage, cost: textCost, costBreakdown: aiCostBreakdown({ text: textCost }), elapsedMs: result.elapsedMs, billing };
    }
    if (copyOutputMode === "text") {
      const textCost = textGenerationCost(config, result.usage);
      const billing = aiBillingForCost(quotaState, textCost);
      return { kind, provider: result.provider, model: result.model, text: safeText, usage: result.usage, cost: textCost, costBreakdown: aiCostBreakdown({ text: textCost }), elapsedMs: result.elapsedMs, billing };
    }
    const imageConfig = aiGenerationConfigFromData(data).image;
    const imageResult = await runAiImageTest(data, {
      ...generateBody,
      prompt: marketingCopyPosterPrompt(generateBody, safeText),
      size: marketingImageSize(optionalString(generateBody, "posterSize"), imageConfig.model),
      quality: "medium",
    });
    const textCost = textGenerationCost(config, result.usage);
    const posterCost = imageResult.cost ?? imageGenerationCost(imageConfig, imageResult.usage);
    const combinedCost = combinedAiGenerationCost("文案生成 + GPT Image 2 产品设计图生成", textCost, posterCost);
    const billing = aiBillingForCost(quotaState, combinedCost);
    return {
      kind,
      provider: `${result.provider}+${imageResult.provider}`,
      model: `${result.model}+${imageResult.model}`,
      text: copyOutputMode === "image" ? undefined : safeText,
      imageDataUrl: imageResult.imageDataUrl,
      revisedPrompt: imageResult.revisedPrompt,
      usage: { text: result.usage, image: imageResult.usage },
      cost: combinedCost,
      costBreakdown: aiCostBreakdown({ text: textCost, image: posterCost }),
      elapsedMs: result.elapsedMs + imageResult.elapsedMs,
      billing,
    };
  }
  if (kind === "image") {
    const config = aiGenerationConfigFromData(data).image;
    const result = await runAiImageTest(data, {
      ...generateBody,
      prompt,
      size: marketingImageSize(optionalString(generateBody, "posterSize"), config.model),
      quality: "medium",
    });
    const imageCost = result.cost ?? imageGenerationCost(config, result.usage);
    const billing = aiBillingForCost(quotaState, imageCost);
    return { kind, provider: result.provider, model: result.model, imageDataUrl: result.imageDataUrl, revisedPrompt: result.revisedPrompt, usage: result.usage, cost: imageCost, costBreakdown: aiCostBreakdown({ image: imageCost }), elapsedMs: result.elapsedMs, billing };
  }
  const config = aiGenerationConfigFromData(data);
  const provider = config.video.providers.find((item) => item.provider === config.video.defaultProvider) ?? config.video.providers[0];
  const durationSeconds = aiVideoDurations.includes(Number(generateBody.videoDuration)) ? Number(generateBody.videoDuration) : provider?.defaultDurationSeconds ?? 5;
  const resolution = aiVideoResolutions.includes(generateBody.videoResolution as AiVideoResolution)
    ? generateBody.videoResolution as AiVideoResolution
    : provider?.defaultResolution ?? DEFAULT_AI_VIDEO_RESOLUTION;
  const result = await runAiVideoTest(data, {
    ...generateBody,
    prompt,
    provider: config.video.defaultProvider,
    durationSeconds,
    resolution,
    aspectRatio: optionalString(generateBody, "videoRatio"),
  });
  const videoCost = provider ? videoGenerationCost(provider, durationSeconds, resolution) : undefined;
  const billing = aiBillingForCost(quotaState, videoCost);
  return { kind, ...result, cost: videoCost, costBreakdown: aiCostBreakdown({ video: videoCost }), billing };
}

function marketingAiPendingProvider(data: AppData, kind: MarketingAiKind, body?: JsonBody) {
  const config = aiGenerationConfigFromData(data);
  if (kind === "image") return { provider: "openai", model: config.image.model };
  if (kind === "copy" && body && optionalString(body, "copyOutputMode") === "text") return { provider: config.copy.provider, model: config.copy.model };
  if (kind === "copy") return { provider: `${config.copy.provider}+openai`, model: `${config.copy.model}+${config.image.model}` };
  if (kind === "talk") return { provider: config.copy.provider, model: config.copy.model };
  const videoProvider = config.video.providers.find((item) => item.provider === config.video.defaultProvider) ?? config.video.providers[0];
  return { provider: videoProvider?.provider, model: videoProvider?.model };
}

function marketingAiFailureCost(data: AppData, body: JsonBody, kind: MarketingAiKind, error: unknown): MarketingAiRecord["cost"] | undefined {
  const generateBody = normalizeMarketingAiGenerateBody(body, kind);
  const message = error instanceof Error ? error.message : "";
  const requestedCopyOutputMode = optionalString(generateBody, "copyOutputMode");
  const copyOutputMode = requestedCopyOutputMode === "text" || requestedCopyOutputMode === "image" ? requestedCopyOutputMode : "poster";
  if (kind === "copy" && copyOutputMode === "text") return undefined;
  if (kind !== "image" && !(kind === "copy" && message.includes("OpenAI"))) return undefined;
  const config = aiGenerationConfigFromData(data).image;
  const prompt = kind === "image"
    ? marketingPrompt(generateBody, "image")
    : marketingCopyPosterPrompt(generateBody, marketingPrompt(generateBody, "copy"));
  const assetCount = (() => {
    try {
      return marketingImageAssets(generateBody).length;
    } catch {
      return 0;
    }
  })();
  return estimatedImageGenerationCost(config, {
    prompt,
    size: marketingImageSize(optionalString(generateBody, "posterSize"), config.model),
    quality: "medium",
    assetCount,
    reason: `${message || "图片生成未返回结果"}，供应商未返回 token 用量，按请求规格预估成本`,
  });
}

function marketingAiRecord(data: AppData, session: UserSession, body: JsonBody, result: {
  kind: MarketingAiRecord["kind"];
  provider?: string;
  model?: string;
  text?: string;
  imageDataUrl?: string;
  videoUrl?: string;
  originalVideoUrl?: string;
  optimizedVideoUrl?: string;
  talkOptimization?: MarketingAiRecord["talkOptimization"];
  taskId?: string;
  status?: string;
  errorMessage?: string;
  elapsedMs?: number;
  materialKey?: string;
  videoResolution?: string;
  cost?: MarketingAiRecord["cost"];
  costBreakdown?: MarketingAiRecord["costBreakdown"];
  billing?: MarketingAiRecord["billing"];
}): MarketingAiRecord {
  const title = {
    copy: "AI获客图文案",
    talk: "AI口播",
    image: "AI产品设计图",
    video: "AI产品视频",
  }[result.kind];
  const safeOptional = (field: string) => {
    const value = optionalString(body, field);
    return value ? marketingCompliantText(value) : undefined;
  };
  const isProductImageRecord = result.kind === "image";
  const materialKey = result.materialKey ?? marketingMaterialKey(body, result.kind);
  const videoTemplate = result.kind === "video" ? marketingVideoTemplateKey(body) : undefined;
  const videoResolution = result.videoResolution ?? (result.kind === "video" && aiVideoResolutions.includes(body.videoResolution as AiVideoResolution)
    ? body.videoResolution as string
    : undefined);
  return {
    id: makeId("mar"),
    storeId: sessionStoreId(data, session),
    kind: result.kind,
    title,
    channel: isProductImageRecord ? undefined : safeOptional("channel"),
    marketingNode: isProductImageRecord ? undefined : safeOptional("marketingNode"),
    customerType: isProductImageRecord ? undefined : safeOptional("customerType"),
    lifecycleNode: isProductImageRecord ? undefined : safeOptional("lifecycleNode"),
    bodyState: isProductImageRecord ? undefined : safeOptional("bodyState"),
    marketingGoal: isProductImageRecord ? undefined : safeOptional("marketingGoal"),
    serviceName: isProductImageRecord ? undefined : safeOptional("serviceName"),
    productName: isProductImageRecord ? undefined : safeOptional("productName"),
    text: result.text ? marketingCompliantText(result.text, "", 6000) : result.text,
    imageDataUrl: result.imageDataUrl,
    videoUrl: result.videoUrl,
    originalVideoUrl: result.originalVideoUrl,
    optimizedVideoUrl: result.optimizedVideoUrl,
    talkOptimization: result.talkOptimization,
    taskId: result.taskId,
    status: result.status,
    errorMessage: result.errorMessage,
    elapsedMs: result.elapsedMs,
    materialKey,
    videoTemplate,
    videoResolution,
    cost: result.cost,
    costBreakdown: result.costBreakdown,
    billing: result.billing,
    provider: result.provider,
    model: result.model,
    createdBy: session.user.id,
    createdByName: session.user.name,
    createdAt: nowIso(),
  };
}

function aiTestMarketingRecord(data: AppData, session: UserSession, body: JsonBody, result: Parameters<typeof marketingAiRecord>[3]): MarketingAiRecord {
  const kindLabel = result.kind === "image" ? "AI图片测试" : result.kind === "talk" ? "AI文案测试" : "AI模型测试";
  return {
    ...marketingAiRecord(data, session, {
      ...body,
      channel: "后台测试",
      marketingNode: kindLabel,
      marketingGoal: "模型连通测试",
    }, result),
    title: kindLabel,
  };
}

function marketingAiOperationLog(session: UserSession, record: MarketingAiRecord): OperationLog {
  const statusText = record.status === "生成失败" ? "失败" : record.status === "生成中" ? "开始生成" : "生成";
  return {
    id: makeId("op"),
    storeId: record.storeId,
    userId: session.user.id,
    action: "生成AI营销素材",
    targetType: "marketingAiRecord",
    targetId: record.id,
    summary: `${session.user.name} ${statusText}${record.title}`,
    createdAt: nowIso(),
  };
}

function aiGenerationLockExpiry() {
  const createdAt = nowIso();
  return {
    createdAt,
    expiresAt: new Date(Date.now() + aiImageGenerationLockTtlMs).toISOString(),
  };
}

function acquireAiGenerationLocks(database: D1BeautyDatabase, session: UserSession, kind: MarketingAiKind) {
  const timestamps = aiGenerationLockExpiry();
  return database.acquireAiGenerationLocks({
    ownerId: session.user.id,
    kind,
    ...timestamps,
    maxGlobalSlots: aiImageGenerationMaxGlobalSlots,
  });
}

async function storeMarketingAiImage(env: Env, record: MarketingAiRecord, imageDataUrl: string) {
  const bucket = getR2Bucket(env);
  if (!bucket) return imageDataUrl;

  try {
    const response = await fetch(imageDataUrl);
    if (!response.ok) return imageDataUrl;
    const blob = await response.blob();
    const contentType = blob.type || response.headers.get("Content-Type") || "image/png";
    if (!contentType.startsWith("image/")) return imageDataUrl;
    const key = `marketing-ai/${record.storeId ?? "platform"}/${record.id}.png`;
    await bucket.put(key, blob, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        recordId: record.id,
        userId: record.createdBy,
        storeId: record.storeId ?? "",
        provider: record.provider ?? "",
        model: record.model ?? "",
        generatedAt: record.createdAt,
      },
    });
    return assetUrlForKey(key);
  } catch {
    return imageDataUrl;
  }
}

async function runAiImageTest(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data).image;
  assertAiCapability(config.enabled, config.apiKey, config.model, "图片生成");
  const prompt = requiredTrimmedText(body, "prompt", 4000);
  const size = optionalAiString(body, "size", 20) ?? config.defaultSize;
  const qualityInput = optionalAiString(body, "quality", 20) ?? config.defaultQuality;
  const quality = qualityInput === "standard" ? "medium" : qualityInput;
  const assets = marketingImageAssets(body);
  const request = assets.length ? await openAiImageEditRequest(config, prompt, size, quality, assets) : {
    url: "https://api.openai.com/v1/images/generations",
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        size,
        quality,
        output_format: "png",
        n: 1,
      }),
    } satisfies RequestInit,
  };
  const { payload, elapsedMs } = await fetchProviderJson("OpenAI", request.url, request.init);
  const output = Array.isArray(payload.data) ? payload.data[0] as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown } | undefined : undefined;
  const b64 = typeof output?.b64_json === "string" ? output.b64_json : undefined;
  if (!b64) throw new Error("OpenAI 未返回 PNG 图片数据");
  return {
    provider: "openai" as const,
    model: config.model,
    imageDataUrl: `data:image/png;base64,${b64}`,
    revisedPrompt: typeof output?.revised_prompt === "string" ? output.revised_prompt : undefined,
    usage: payload.usage,
    cost: imageGenerationCost(config, payload.usage, { prompt, size, quality, assetCount: assets.length }),
    raw: compactAiRawPayload(payload),
    elapsedMs,
  };
}

function isOpenAiImageRuntimeError(error: unknown) {
  return error instanceof Error && (
    error.message.includes("OpenAI调用超时")
    || error.message.includes("OpenAI 未返回图片数据")
    || error.message.includes("OpenAI 未返回 PNG 图片数据")
  );
}

function aiImageFailureResult(data: AppData, body: JsonBody, error: unknown, startedAt: number) {
  const config = aiGenerationConfigFromData(data).image;
  const prompt = optionalString(body, "prompt")?.slice(0, 4000) ?? "";
  const size = optionalAiString(body, "size", 20) ?? config.defaultSize;
  const qualityInput = optionalAiString(body, "quality", 20) ?? config.defaultQuality;
  const quality = qualityInput === "standard" ? "medium" : qualityInput;
  const assetCount = (() => {
    try {
      return marketingImageAssets(body).length;
    } catch {
      return 0;
    }
  })();
  const message = error instanceof Error ? error.message : "OpenAI 图片生成失败";
  return {
    provider: "openai" as const,
    model: config.model,
    status: "生成失败",
    errorMessage: message,
    cost: estimatedImageGenerationCost(config, {
      prompt,
      size,
      quality,
      assetCount,
      reason: `${message}，供应商未返回 token 用量，按请求规格预估成本`,
    }),
    elapsedMs: Date.now() - startedAt,
  };
}

async function openAiImageEditRequest(config: AiImageModelConfig, prompt: string, size: string, quality: string, assets: MarketingImageAsset[]) {
  const form = new FormData();
  form.append("model", config.model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", "1");
  form.append("output_format", "png");
  if (config.model !== "gpt-image-2") {
    form.append("input_fidelity", "high");
  }
  for (const asset of assets.slice(0, 16)) {
    form.append("image[]", await marketingImageBlob(asset), asset.name);
  }
  return {
    url: "https://api.openai.com/v1/images/edits",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    } satisfies RequestInit,
  };
}

async function runAiVideoTest(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data);
  const providerKey = optionalAiString(body, "provider", 20) as AiVideoProviderConfig["provider"] | undefined;
  const activeProvider = config.video.providers.find((provider) => provider.provider === (providerKey ?? config.video.defaultProvider)) ?? config.video.providers[0];
  if (!activeProvider) throw new Error("视频供应商未配置");
  assertAiCapability(activeProvider.enabled, activeProvider.apiKey, activeProvider.model, `${providerLabel(activeProvider.provider)}视频`);
  const prompt = requiredTrimmedText(body, "prompt", 2500);
  const durationSeconds = aiVideoDurations.includes(Number(body.durationSeconds)) ? Number(body.durationSeconds) : activeProvider.defaultDurationSeconds;
  const resolution = aiVideoResolutions.includes(body.resolution as AiVideoResolution) ? body.resolution as AiVideoResolution : activeProvider.defaultResolution;
  const aspectRatio = aiVideoAspectRatios.includes(body.aspectRatio as AiVideoAspectRatio) ? body.aspectRatio as AiVideoAspectRatio : activeProvider.defaultAspectRatio;
  const assets = marketingImageAssets(body);
  if (activeProvider.provider === "hailuo") {
    return createHailuoVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
  }
  if (activeProvider.provider === "grok") {
    return createGrokVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
  }
  if (activeProvider.provider === "kling") {
    return createKlingVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
  }
  return createSeedanceVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
}

async function runAiVideoStatusTest(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data);
  const providerKey = requiredString(body, "provider") as AiVideoProviderConfig["provider"];
  const activeProvider = config.video.providers.find((provider) => provider.provider === providerKey);
  if (!activeProvider) throw new Error("视频供应商未配置");
  assertAiCapability(activeProvider.enabled, activeProvider.apiKey, activeProvider.model, `${providerLabel(activeProvider.provider)}视频`);
  const taskId = requiredTrimmedText(body, "taskId", 200);
  if (activeProvider.provider === "hailuo") return queryHailuoVideoTask(activeProvider, taskId);
  if (activeProvider.provider === "grok") return queryGrokVideoTask(activeProvider, taskId);
  if (activeProvider.provider === "kling") return queryKlingVideoTask(activeProvider, taskId);
  return querySeedanceVideoTask(activeProvider, taskId);
}

async function createSeedanceVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio, assets: MarketingImageAsset[] = []) {
  const normalizedRequest = { duration: durationSeconds, resolution, ratio: aspectRatio, referenceImages: assets.map((asset) => asset.label) };
  const { payload, elapsedMs } = await fetchProviderJson("Seedance", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      content: [
        { type: "text", text: prompt },
        ...assets.map((asset) => ({ type: "image_url", image_url: { url: asset.dataUrl } })),
      ],
      ratio: aspectRatio,
      duration: durationSeconds,
      resolution,
      watermark: false,
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["id", "task_id", "taskId"]),
    status: readFirstString(payload, ["status"]),
    normalizedRequest,
  });
}

async function querySeedanceVideoTask(config: AiVideoProviderConfig, taskId: string) {
  const { payload, elapsedMs } = await fetchProviderJson("Seedance", `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  return videoResult(config, elapsedMs, payload, {
    taskId,
    status: readFirstString(payload, ["status"]),
    videoUrl: readNestedString(payload, [["content", "video_url"], ["content", "videoURL"], ["video_url"], ["videoURL"]]),
  });
}

async function createKlingVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio, assets: MarketingImageAsset[] = []) {
  const normalizedRequest = {
    duration: durationSeconds === 10 ? "10" : "5",
    aspect_ratio: aspectRatio,
    mode: resolution === "1080p" ? "pro" : "std",
    referenceImages: assets.map((asset) => asset.label),
  };
  const firstAsset = assets[0];
  const { payload, elapsedMs } = await fetchProviderJson("Kling", `https://api-singapore.klingai.com/v1/videos/${firstAsset ? "image2video" : "text2video"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: config.model,
      prompt,
      ...(firstAsset ? { image: firstAsset.dataUrl } : {}),
      duration: normalizedRequest.duration,
      aspect_ratio: normalizedRequest.aspect_ratio,
      mode: normalizedRequest.mode,
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["task_id", "taskId", "id", "request_id"]),
    status: readFirstString(payload, ["status", "message"]),
    normalizedRequest,
  });
}

async function queryKlingVideoTask(config: AiVideoProviderConfig, taskId: string) {
  const { payload, elapsedMs } = await fetchProviderJson("Kling", `https://api-singapore.klingai.com/v1/videos/text2video/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  return videoResult(config, elapsedMs, payload, {
    taskId,
    status: readFirstString(payload, ["status", "message"]),
    videoUrl: readNestedString(payload, [["video_url"], ["videoURL"], ["data", "video_url"], ["data", "videoURL"], ["data", "works", "0", "resource", "resource"]]),
  });
}

async function createHailuoVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio, assets: MarketingImageAsset[] = []) {
  const normalizedDuration = durationSeconds >= 10 ? 10 : 6;
  const normalizedResolution = resolution === "1080p" && normalizedDuration === 6 ? "1080P" : "768P";
  const firstAsset = assets[0];
  const normalizedRequest = { duration: normalizedDuration, resolution: normalizedResolution, aspectRatio, referenceImages: assets.map((asset) => asset.label) };
  const { payload, elapsedMs } = await fetchProviderJson("MiniMax", "https://api.minimaxi.com/v1/video_generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      duration: normalizedDuration,
      resolution: normalizedResolution,
      ...(firstAsset ? { first_frame_image: firstAsset.dataUrl } : {}),
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["task_id", "taskId", "id"]),
    status: readFirstString(payload, ["status"]),
    normalizedRequest,
  });
}

async function queryHailuoVideoTask(config: AiVideoProviderConfig, taskId: string) {
  const { payload, elapsedMs } = await fetchProviderJson("MiniMax", `https://api.minimaxi.com/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const fileId = readFirstString(payload, ["file_id", "fileId"]);
  const retrievedVideoUrl = fileId ? await retrieveHailuoVideoUrl(config, fileId) : undefined;
  return videoResult(config, elapsedMs, payload, {
    taskId,
    status: readFirstString(payload, ["status"]),
    fileId,
    videoUrl: retrievedVideoUrl ?? readFirstString(payload, ["video_url", "videoURL"]),
  });
}

async function retrieveHailuoVideoUrl(config: AiVideoProviderConfig, fileId: string) {
  const { payload } = await fetchProviderJson("MiniMax", `https://api.minimaxi.com/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  return readNestedString(payload, [["file", "download_url"], ["file", "downloadUrl"], ["download_url"], ["downloadUrl"], ["data", "file", "download_url"], ["data", "download_url"]]);
}

async function createGrokVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio, assets: MarketingImageAsset[] = []) {
  const firstAsset = assets[0];
  const normalizedResolution = resolution === "1080p" ? "720p" : resolution;
  const normalizedRequest = { duration: durationSeconds, resolution: normalizedResolution, aspectRatio, referenceImages: assets.map((asset) => asset.label) };
  const { payload, elapsedMs } = await fetchProviderJson("Grok Imagine", "https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      ...(firstAsset ? { image: { url: firstAsset.dataUrl } } : {}),
      duration: durationSeconds,
      resolution: normalizedResolution,
      aspect_ratio: aspectRatio,
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["request_id", "requestId", "id"]),
    status: readFirstString(payload, ["status"]),
    normalizedRequest,
  });
}

async function queryGrokVideoTask(config: AiVideoProviderConfig, taskId: string) {
  const { payload, elapsedMs } = await fetchProviderJson("Grok Imagine", `https://api.x.ai/v1/videos/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  return videoResult(config, elapsedMs, payload, {
    taskId,
    status: readFirstString(payload, ["status"]),
    videoUrl: readNestedString(payload, [["video", "url"], ["data", "video", "url"], ["result", "video", "url"], ["url"], ["video_url"], ["videoURL"]]),
  });
}

function videoResult(config: AiVideoProviderConfig, elapsedMs: number, raw: Record<string, unknown>, extras: Partial<{ taskId: string; status: string; videoUrl: string; fileId: string; normalizedRequest: Record<string, unknown> }>) {
  return {
    provider: config.provider,
    model: config.model,
    ...extras,
    raw: compactAiRawPayload(raw),
    elapsedMs,
  };
}

function providerLabel(provider: AiVideoProviderConfig["provider"]) {
  if (provider === "seedance") return "Seedance";
  if (provider === "kling") return "Kling";
  if (provider === "grok") return "Grok Imagine";
  return "海螺";
}

function compactAiRawPayload(payload: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(payload, (key, value) => {
    if (typeof value === "string" && value.length > 1200) {
      return `${value.slice(0, 1200)}...`;
    }
    return value;
  })) as Record<string, unknown>;
}

function readFirstString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  const data = payload.data;
  if (data && typeof data === "object") {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
      if (typeof value === "number") return String(value);
    }
  }
  return undefined;
}

function readNestedString(payload: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let cursor: unknown = payload;
    for (const segment of path) {
      if (Array.isArray(cursor) && /^\d+$/.test(segment)) {
        cursor = cursor[Number(segment)];
      } else if (cursor && typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>)[segment];
      } else {
        cursor = undefined;
      }
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return undefined;
}

function readJson(request: Request): Promise<JsonBody> {
  const cached = requestJsonCache.get(request);
  if (cached) return cached;
  const pending = request.text().then((text) => text ? JSON.parse(text) as JsonBody : {});
  requestJsonCache.set(request, pending);
  return pending;
}

function sendJson(statusCode: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function positiveIntegerQuery(url: URL, key: string, fallback: number) {
  const value = Number.parseInt(url.searchParams.get(key) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requiredPosDayRange(url: URL) {
  const dayStart = url.searchParams.get("dayStart") ?? "";
  const dayEnd = url.searchParams.get("dayEnd") ?? "";
  const startMs = Date.parse(dayStart);
  const endMs = Date.parse(dayEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > 3 * 24 * 60 * 60 * 1000) {
    throw new Error("收银统计日期范围不正确");
  }
  return { dayStart: new Date(startMs).toISOString(), dayEnd: new Date(endMs).toISOString() };
}

type MutationTiming = {
  label: string;
  startedAt: number;
  readMs?: number;
  writeStartedAt?: number;
  writeMs?: number;
};

function startMutationTiming(label: string): MutationTiming {
  return { label, startedAt: Date.now() };
}

function markMutationRead(timing: MutationTiming) {
  timing.readMs = Date.now() - timing.startedAt;
}

function startMutationWrite(timing: MutationTiming) {
  timing.writeStartedAt = Date.now();
}

function markMutationWrite(timing: MutationTiming) {
  if (typeof timing.writeStartedAt === "number") {
    timing.writeMs = Date.now() - timing.writeStartedAt;
  }
}

function withMutationTiming(response: Response, timing: MutationTiming, mode: "full" | "scoped") {
  const totalMs = Date.now() - timing.startedAt;
  const serverTiming = [
    `yich-total;dur=${totalMs}`,
    typeof timing.readMs === "number" ? `yich-read;dur=${timing.readMs}` : "",
    typeof timing.writeMs === "number" ? `yich-write;dur=${timing.writeMs}` : "",
  ].filter(Boolean).join(", ");
  response.headers.set("Server-Timing", serverTiming);
  response.headers.set("X-Yich-Mutation", `${timing.label};mode=${mode};total=${totalMs}`);
  return response;
}

function requestedDataView(request: Request) {
  const requestedView = request.headers.get("X-App-Data-View") ?? new URL(request.url).searchParams.get("view");
  return isViewKey(requestedView) ? requestedView : undefined;
}

function isSliceRequest(request: Request) {
  return request.headers.get("X-App-Data-Mode") === "slice";
}

async function readDataForRequest(database: D1BeautyDatabase, request: Request, session: UserSession) {
  const requestedView = requestedDataView(request);
  let data: AppData;
  if (isSliceRequest(request) && requestedView) {
    const keys = dataKeysForRequest(request, requestedView);
    if (session.user.role !== "superadmin") {
      const storeId = await resolveSessionStoreId(database, session);
      data = await database.readDataTablesForStore(keys, storeId);
    } else {
      data = await database.readDataTables(keys);
    }
  } else if (session.user.role !== "superadmin") {
    const storeId = await resolveSessionStoreId(database, session);
    data = await database.readDataTablesForStore(allDataKeys, storeId);
  } else {
    data = await database.readData();
  }
  return expireStaleMarketingAiRecords(data);
}

async function readMutationDataForRequest(
  database: D1BeautyDatabase,
  request: Request,
  session: UserSession,
  requiredKeys: readonly D1DataTableName[],
) {
  const requestedView = requestedDataView(request);
  if (!isSliceRequest(request) || !requestedView) {
    if (session.user.role === "superadmin") {
      return database.readData();
    }
    const storeId = await resolveSessionStoreId(database, session);
    return database.readDataTablesForStore(allDataKeys, storeId);
  }
  const keys = uniqueDataTableKeys([...requiredKeys, ...dataKeysForRequest(request, requestedView)]);
  if (session.user.role !== "superadmin") {
    const storeId = await resolveSessionStoreId(database, session);
    return database.readDataTablesForStore(keys, storeId);
  }
  return database.readDataTables(keys);
}

async function readRequiredMutationData(
  database: D1BeautyDatabase,
  session: UserSession,
  requiredKeys: readonly D1DataTableName[],
) {
  if (session.user.role !== "superadmin") {
    const storeId = await resolveSessionStoreId(database, session);
    return database.readDataTablesForStore(requiredKeys, storeId);
  }
  return database.readDataTables(requiredKeys);
}

async function readMarketingAiData(database: D1BeautyDatabase, session: UserSession) {
  if (session.user.role === "superadmin") {
    return database.readDataTables(marketingAiDataKeys);
  }
  const storeId = await resolveSessionStoreId(database, session);
  return database.readDataTablesForStore(marketingAiDataKeys, storeId);
}

async function resolveSessionStoreId(database: D1BeautyDatabase, session: UserSession) {
  if (session.user.storeId) return session.user.storeId;
  const identityData = await database.readDataTables(["storeProfiles", "authUsers", "staff"]);
  const storeId = sessionStoreId(identityData, session);
  if (!storeId) throw new Error("账号未绑定门店，请联系管理员处理");
  return storeId;
}

async function readPublicSignatureData(database: D1BeautyDatabase, token: string) {
  const signature = await database.readCustomerSignatureByToken(token);
  if (!signature) return emptyAppData();
  const signatureStoreId = signature ? await database.resolveCustomerSignatureStoreId(signature) : undefined;
  if (signatureStoreId) {
    const data = await database.readCustomerSignatureContext(signatureStoreId, signature);
    return { ...data, customerSignatures: [signature] };
  }
  return emptyAppData();
}

function publicSignatureStoreId(data: AppData, signature: CustomerSignature) {
  if (signature.storeId) return signature.storeId;
  const customerStoreId = data.customers.find((item) => item.id === signature.customerId)?.storeId;
  if (customerStoreId) return customerStoreId;
  const orderStoreId = signature.orderId ? data.orders.find((item) => item.id === signature.orderId)?.storeId : undefined;
  if (orderStoreId) return orderStoreId;
  return signature.serviceRecordId ? data.customerServiceRecords.find((item) => item.id === signature.serviceRecordId)?.storeId : undefined;
}

async function readPublicStorefrontData(
  database: D1BeautyDatabase,
  shareCode: string,
  keys: readonly D1DataTableName[] = ["storeProfiles", "onlineStorefronts", "services"],
) {
  const storefrontIndexData = await database.readDataTables(["onlineStorefronts"]);
  const storefront = storefrontIndexData.onlineStorefronts.find((item) => item.shareCode === shareCode && item.status === "启用");
  if (storefront?.storeId) {
    return database.readDataTablesForStore(uniqueDataTableKeys([...keys, "onlineStorefronts"]), storefront.storeId);
  }
  return database.readDataTables(keys);
}

function uniqueDataTableKeys(keys: readonly D1DataTableName[]) {
  return Array.from(new Set(keys));
}

function sendScopedData(
  request: Request,
  statusCode: number,
  data: AppData,
  session: UserSession,
  options: { responseKeys?: readonly D1DataTableName[]; keepSignatureTextIds?: readonly string[] } = {},
) {
  const scopedData = scopeDataForSession(data, session);
  const responseData = withoutSignatureImages(scopedData, options.keepSignatureTextIds);
  const requestedView = requestedDataView(request);
  if (isSliceRequest(request) && requestedView) {
    return sendJson(
      statusCode,
      options.responseKeys?.length
        ? makeAppDataSliceWithKeys(responseData, requestedView, options.responseKeys)
        : makeAppDataSlice(responseData, requestedView, dataKeysForRequest(request, requestedView)),
    );
  }
  return sendJson(statusCode, responseData);
}

function sendMemberCardOpenPatch(request: Request, statusCode: number, data: AppData) {
  const view = requestedDataView(request) ?? "pos";
  return sendJson(statusCode, makeAppDataPatch({
    customers: data.customers,
    memberCards: data.memberCards,
    memberCardTransactions: data.memberCardTransactions,
    operationLogs: data.operationLogs,
    customerSignatures: withoutSignatureImages(data).customerSignatures,
  }, view));
}

function sendMutationPatch(
  request: Request,
  statusCode: number,
  previousData: AppData,
  nextData: AppData,
  session: UserSession,
  keys: readonly D1DataTableName[],
) {
  if (!isSliceRequest(request)) return sendScopedData(request, statusCode, nextData, session);
  const previousScoped = withoutSignatureImages(scopeDataForSession(previousData, session));
  const nextScoped = withoutSignatureImages(scopeDataForSession(nextData, session));
  const { upserts, deletes } = diffAppData(previousScoped, nextScoped, keys);
  return sendJson(statusCode, makeAppDataPatch(upserts, requestedDataView(request) ?? "dashboard", deletes));
}

function makeAppDataSliceWithKeys(data: AppData, view: ViewKey, keys: readonly D1DataTableName[]) {
  const slice: Partial<AppData> = {};
  for (const key of uniqueDataTableKeys(keys)) {
    slice[key] = data[key] as never;
  }
  return {
    kind: "app-data-slice" as const,
    view,
    data: slice,
    generatedAt: new Date().toISOString(),
  };
}

function dataKeysForRequest(request: Request, view: ViewKey) {
  return dataKeysForView(view, {
    includeLegacyPosData: view === "pos" && !requestSupportsCapability(request, POS_REMOTE_PAGING_CAPABILITY),
  });
}

function requestSupportsCapability(request: Request, capability: string) {
  return (request.headers.get("X-Yich-Capabilities") ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(capability);
}

function withoutSignatureImages(data: AppData, keepSignatureTextIds: readonly string[] = []): AppData {
  const keepIds = new Set(keepSignatureTextIds);
  return {
    ...data,
    customerSignatures: (data.customerSignatures ?? []).map((signature) => {
      if (signature.signatureText && keepIds.has(signature.id)) return signature;
      const { signatureText: _signatureText, ...lightSignature } = signature;
      return lightSignature;
    }),
  };
}

function handleCors(request: Request) {
  if (request.method !== "OPTIONS") return undefined;
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Data-Mode, X-App-Data-View, X-Yich-Capabilities, Cache-Control, Pragma",
  };
}

function requiredString(body: JsonBody, key: string) {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`缺少字段 ${key}`);
  }
  return value;
}

function requiredStringAny(body: JsonBody, keys: string[]) {
  const value = optionalStringAny(body, keys);
  if (!value) {
    throw new Error(`缺少字段 ${keys[0]}`);
  }
  return value;
}

function optionalString(body: JsonBody, key: string) {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringAny(body: JsonBody, keys: string[]) {
  for (const key of keys) {
    const value = optionalString(body, key);
    if (value) return value;
  }
  return undefined;
}

function requiredNumber(body: JsonBody, key: string) {
  const value = body[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`缺少数字字段 ${key}`);
  }
  return value;
}

function optionalNumber(body: JsonBody, key: string) {
  const value = body[key];
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function optionalBoolean(body: JsonBody, key: string) {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(body: JsonBody, key: string) {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function optionalServiceCardSelections(body: JsonBody): ServiceCardSelection[] | undefined {
  const value = body.serviceCardSelections;
  if (!Array.isArray(value)) return undefined;
  const selections = new Map<string, string>();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const serviceId = (item as { serviceId?: unknown }).serviceId;
    const cardId = (item as { cardId?: unknown }).cardId;
    if (typeof serviceId === "string" && serviceId.trim() && typeof cardId === "string" && cardId.trim()) {
      selections.set(serviceId.trim(), cardId.trim());
    }
  });
  const normalized = Array.from(selections, ([serviceId, cardId]) => ({ serviceId, cardId }));
  return normalized.length ? normalized : undefined;
}

function optionalMemberCardServiceEntitlements(body: JsonBody): MemberCard["serviceEntitlements"] {
  const value = body.serviceEntitlements;
  if (!Array.isArray(value)) return undefined;
  const entitlements = value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const serviceId = (item as { serviceId?: unknown }).serviceId;
      const totalTimes = (item as { totalTimes?: unknown }).totalTimes;
      const remainingTimes = (item as { remainingTimes?: unknown }).remainingTimes;
      if (typeof serviceId !== "string" || serviceId.length === 0) return undefined;
      if (typeof totalTimes !== "number" || !Number.isFinite(totalTimes) || totalTimes <= 0) return undefined;
      const nextRemainingTimes = typeof remainingTimes === "number" && Number.isFinite(remainingTimes)
        ? remainingTimes
        : totalTimes;
      return { serviceId, totalTimes, remainingTimes: nextRemainingTimes };
    })
    .filter((item): item is NonNullable<MemberCard["serviceEntitlements"]>[number] => Boolean(item));
  return entitlements.length ? entitlements : undefined;
}

function optionalConsumables(body: JsonBody): ServiceConsumable[] {
  const value = body.consumables;
  if (!Array.isArray(value)) return [];
  const merged = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const productId = (item as { productId?: unknown }).productId;
    const quantity = (item as { quantity?: unknown }).quantity;
    if (typeof productId !== "string" || productId.length === 0) continue;
    const safeQuantity = typeof quantity === "number" && quantity > 0 ? quantity : 0;
    merged.set(productId, Math.max(merged.get(productId) ?? 0, safeQuantity));
  }
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

function optionalProductItems(body: JsonBody, key: string): CheckoutProductItemInput[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  const merged = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const productId = (item as { productId?: unknown }).productId;
    const quantity = (item as { quantity?: unknown }).quantity;
    if (typeof productId !== "string" || productId.length === 0) continue;
    const safeQuantity = typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
    if (safeQuantity <= 0) continue;
    merged.set(productId, (merged.get(productId) ?? 0) + safeQuantity);
  }
  const items = Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
  return items.length ? items : undefined;
}
