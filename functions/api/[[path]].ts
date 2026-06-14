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
  receivePurchaseOrder,
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
  transferMemberCard,
  upsertOnlineStorefront,
  joinInviteByCode,
  isStoreStaffInviteCode,
  markAllVisibleNotificationsRead,
  markNotificationRead,
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
  storeIdForUser,
} from "../../src/domain/business";
import { hashPassword } from "../../src/lib/password";
import { requireMobilePhone } from "../../src/domain/phone";

// Read version from package.json at runtime (works in Cloudflare Workers)
import pkg from "../../package.json" with { type: "json" };
import type { Permission, UserSession } from "../../src/domain/auth";
import type { AiUsageCapability, AppData, Appointment, CashPayMethod, Customer, CustomerFollowUp, CustomerSignature, InventoryLog, MarketingAiRecord, MemberCard, Order, R2UsageSnapshot, ServiceConsumable, SystemConfigKey, TagScope, UserRole, WorkerUsageSnapshot } from "../../src/domain/types";
import type { CheckoutProductItemInput } from "../../src/domain/business";
import { dataKeysForView, isViewKey, makeAppDataSlice } from "../../src/domain/dataSlices";
import { normalizeProductServiceUnitsPerStockUnit, productServiceStockDeductible, productServiceUnit } from "../../src/domain/products";
import { makeId, nowIso } from "../../src/domain/utils";
import { D1BeautyDatabase } from "../../src/cloudflare/d1Database";
import { buildSession, getSessionFromD1, loginWithD1 } from "../../src/cloudflare/auth";
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
type PagesFunction<Bindings> = (context: { request: Request; env: Bindings }) => Response | Promise<Response>;

const publicSignatureDataKeys = [
  "customers",
  "orders",
  "services",
  "staff",
  "memberCards",
  "memberCardTransactions",
  "customerServiceRecords",
  "customerSignatures",
] as const;

export const onRequest: PagesFunction<Env> = async (context) => {
  const database = new D1BeautyDatabase(context.env.DB);

  try {
    const corsResponse = handleCors(context.request);
    if (corsResponse) return corsResponse;

    await database.seedIfEmpty();

    const url = new URL(context.request.url);
    const pathname = url.pathname;

    if (context.request.method === "GET" && pathname.startsWith("/api/assets/")) {
      return serveR2Asset(context.env, pathname);
    }

    if (context.request.method === "GET" && pathname === "/api/health") {
      return sendJson(200, {
        ok: true,
        service: "yich-system-api",
        version: pkg.version,
        runtime: "cloudflare-d1",
      });
    }

    if (context.request.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(context.request);
      const account = requiredString(body, "account");
      const plainPassword = requiredString(body, "password");

      const loginResult = await loginWithD1(context.env.DB, account, plainPassword);

      // Auto-migrate legacy plaintext password to secure hash
      if (loginResult.needsPasswordMigration && loginResult.userIdNeedingMigration) {
        const currentData = await database.readData();
        const hashed = await hashPassword(plainPassword);
        const migratedUsers = currentData.authUsers.map((u) =>
          u.id === loginResult.userIdNeedingMigration ? { ...u, password: hashed } : u
        );
        await database.replaceData({ ...currentData, authUsers: migratedUsers });
      }

      return sendJson(200, loginResult.session);
    }

    if (context.request.method === "POST" && pathname === "/api/auth/register-store") {
      const body = await readJson(context.request);
      const plainPassword = requiredString(body, "password");
      const hashedPassword = await hashPassword(plainPassword);

      const nextData = registerStore(await database.readData(), {
        storeName: requiredString(body, "storeName"),
        ownerName: requiredStringAny(body, ["ownerName", "name"]),
        phone: requiredString(body, "phone"),
        address: optionalString(body, "address"),
        account: requiredString(body, "account"),
        password: hashedPassword,
      });
      await database.replaceData(nextData);

      const loginResult = await loginWithD1(context.env.DB, requiredString(body, "account"), plainPassword);
      return sendJson(201, loginResult.session);
    }

    if (context.request.method === "POST" && pathname === "/api/auth/join-invite") {
      const body = await readJson(context.request);
      const plainPassword = requiredString(body, "password");
      const hashedPassword = await hashPassword(plainPassword);
      const inviteCode = requiredString(body, "inviteCode");

      const currentData = await database.readData();
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
      await database.replaceData(nextData);

      if (isStoreOwnerInvite) {
        const account = optionalString(body, "account");
        const application = [...(nextData.storeOwnerApplications ?? [])].find((item) => {
          if (item.status !== "待审批") return false;
          if (item.inviteCode.trim().toUpperCase() !== inviteCode.trim().toUpperCase()) return false;
          return account ? item.account === account : true;
        });
        return sendJson(202, {
          status: "pending_approval",
          message: "门店申请已提交，请等待管理员审批后再登录。",
          applicationId: application?.id,
        });
      }

      const staffInvite = currentData.staffInvites.find((item) => item.inviteCode.trim().toUpperCase() === inviteCode.trim().toUpperCase());
      const joinedAccount = staffInvite?.account ?? (isStoreStaffInviteCode(currentData, inviteCode) ? optionalString(body, "account") : undefined);
      if (!joinedAccount) throw new Error("邀请账号不存在");
      return sendJson(202, {
        status: "pending_approval",
        message: "账号已提交，请等待店长审核通过后再登录。",
      });
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/public/store/")) {
      const shareCode = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      return sendJson(200, publicStorePayload(await database.readData(), shareCode));
    }

    if (context.request.method === "POST" && pathname === "/api/public/online-booking-requests") {
      const body = await readJson(context.request);
      const requestedData = createOnlineBookingRequest(await database.readData(), {
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
      await database.replaceData(nextData);
      return sendJson(201, { ok: true });
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/public/customer-signatures/")) {
      const token = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      return sendJson(200, publicSignaturePayload(await database.readDataTables(publicSignatureDataKeys), token));
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/public/customer-signatures/") && pathname.endsWith("/sign")) {
      const token = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = signCustomerSignature(await database.readDataTables(publicSignatureDataKeys), {
        token,
        signerName: requiredString(body, "signerName"),
        signatureText: requiredString(body, "signatureText"),
      });
      await database.replacePublicSignatureData(nextData);
      return sendJson(201, publicSignaturePayload(nextData, token));
    }

    const session = await getSessionFromD1(context.env.DB, context.request.headers.get("Authorization"));
    if (!session) {
      return sendJson(401, { error: "请先登录" });
    }

    if (context.request.method === "GET" && pathname === "/api/auth/me") {
      return sendJson(200, session);
    }

    if (context.request.method === "POST" && pathname === "/api/account-avatar") {
      const upload = await uploadAccountAvatar(context.request, context.env, session);
      return sendJson(201, upload);
    }

    if (context.request.method === "PATCH" && pathname === "/api/account-profile") {
      const body = await readJson(context.request);
      const updatedData = updateAccountProfile(await database.readData(), {
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
      await persistData(database, session, nextData);
      const updatedUser = nextData.authUsers.find((user) => user.id === session.user.id);
      if (!updatedUser) throw new Error("账号不存在");
      const nextSession = buildSession(session.token, updatedUser, nextData.systemConfigs);
      return sendJson(200, { session: nextSession, data: scopeDataForSession(nextData, nextSession) });
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/auth-users/") && pathname.endsWith("/status")) {
      requirePermission(session, "staff:manage");
      const userId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      assertCanManageAuthUser(currentData, session, userId);
      const nextData = updateAuthUserStatus(currentData, {
        userId,
        status: requiredString(body, "status") as "active" | "disabled" | "pending",
        operatedBy: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/auth-users/") && pathname.endsWith("/password")) {
      requirePermission(session, "staff:manage");
      const userId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      assertCanManageAuthUser(currentData, session, userId);
      const nextData = resetAuthUserPassword(currentData, {
        userId,
        password: await hashPassword(requiredString(body, "password")),
        operatedBy: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "GET" && pathname === "/api/data") {
      requirePermission(session, "dashboard:view");
      return sendScopedData(context.request, 200, await readDataForRequest(database, context.request, session), session);
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
      return sendJson(200, await runAiChatTest(await database.readData(), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/image") {
      assertSuperadminAiTester(session);
      return sendJson(200, await runAiImageTest(await database.readData(), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/video") {
      assertSuperadminAiTester(session);
      return sendJson(200, await runAiVideoTest(await database.readData(), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/ai-test/video-status") {
      assertSuperadminAiTester(session);
      return sendJson(200, await runAiVideoStatusTest(await database.readData(), await readJson(context.request)));
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-ai/generate") {
      requirePermission(session, "marketing:manage");
      const currentData = await database.readData();
      const body = await readJson(context.request);
      const result = await runMarketingAiGenerate(currentData, session, body);
      const record = marketingAiRecord(currentData, session, body, result);
      const nextData = addOperationLog(
        {
          ...currentData,
          marketingAiRecords: [record, ...(currentData.marketingAiRecords ?? [])],
        },
        {
          userId: session.user.id,
          action: "生成AI营销内容",
          targetType: "marketingAiRecord",
          targetId: record.id,
          summary: `${session.user.name} 生成${record.title}`,
        },
      );
      await persistData(database, session, nextData);
      return sendJson(200, { ...result, record });
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
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const nextData = markNotificationRead(await database.readData(), { notificationId, userId: session.user.id });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/archive")) {
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const nextData = archiveNotification(await database.readData(), { notificationId, userId: session.user.id });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/notifications/read-all") {
      const nextData = markAllVisibleNotificationsRead(await database.readData(), {
        userId: session.user.id,
        role: session.user.role,
        staffId: session.user.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/system-configs/")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以修改系统配置");
      }
      const key = decodeURIComponent(pathname.split("/").at(-1) ?? "") as SystemConfigKey;
      const body = await readJson(context.request);
      const nextData = updateData(
        await database.readData(),
        session,
        {
          action: "更新系统配置",
          targetType: "systemConfig",
          targetId: key,
          summary: `${session.user.name} 更新系统配置 ${key}`,
        },
        (data) => updateSystemConfig(data, { key, value: requiredString(body, "value"), updatedBy: session.user.id }),
      );
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/stores/") && pathname.endsWith("/status")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以管理门店状态");
      }
      const storeId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = updateStoreStatus(await database.readData(), {
        storeId,
        status: requiredString(body, "status") as "active" | "disabled",
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname === "/api/ai-usage-permissions") {
      requirePermission(session, "settings:view");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname === "/api/operational-permissions") {
      requirePermission(session, "settings:view");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname === "/api/store-profile") {
      requirePermission(session, "settings:view");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/staff") {
      requirePermission(session, "staff:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff/")) {
      requirePermission(session, "staff:manage");
      const staffId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        updateStaffMember(await database.readData(), {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "DELETE" && pathname.startsWith("/api/staff/")) {
      requirePermission(session, "staff:manage");
      const staffId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const currentData = await database.readData();
      assertCanManageStaff(currentData, session, staffId);
      const nextData = deleteStaffMember(currentData, {
        staffId,
        operatedBy: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/staff-invites") {
      requirePermission(session, "staff:manage");
      const body = await readJson(context.request);
      const nextData = createStaffInvite(await database.readData(), {
        staffId: requiredString(body, "staffId"),
        account: requiredString(body, "account"),
        role: requiredString(body, "role") as UserRole,
        createdBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/store-owner-invites") {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以邀请门店老板");
      }
      const body = await readJson(context.request);
      const nextData = createStoreOwnerInvite(await database.readData(), {
        storeName: requiredString(body, "storeName"),
        ownerName: requiredString(body, "ownerName"),
        phone: requiredString(body, "phone"),
        address: optionalString(body, "address"),
        account: requiredString(body, "account"),
        createdBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/store-owner-applications/")) {
      if (session.user.role !== "superadmin") {
        throw new Error("只有平台 Admin 可以审批门店申请");
      }
      const applicationId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const nextData = decideStoreOwnerApplication(await database.readData(), {
        applicationId,
        userId: session.user.id,
        approved: optionalBoolean(body, "approved") ?? true,
        rejectReason: optionalString(body, "rejectReason"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff-invites/")) {
      requirePermission(session, "staff:manage");
      const inviteId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const nextData = revokeStaffInvite(await database.readData(), {
        inviteId,
        revokedBy: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/online-storefront") {
      requirePermission(session, "settings:view");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/checkout") {
      requirePermission(session, "pos:manage");
      const body = await readJson(context.request);
      const checkoutRequestId = optionalString(body, "checkoutRequestId");
      const currentData = await database.readData();
      const checkedOutData = checkoutOrder(currentData, {
        storeId: sessionStoreId(currentData, session),
        customerId: optionalString(body, "customerId"),
        guestName: optionalString(body, "guestName"),
        guestPhone: optionalString(body, "guestPhone"),
        staffId: requiredString(body, "staffId"),
        collaboratorStaffIds: optionalStringArray(body, "collaboratorStaffIds"),
        serviceId: optionalString(body, "serviceId"),
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
      const checkoutReserved = checkoutRequestId ? await database.reserveCheckoutSubmission(checkoutRequestId, nowIso()) : true;
      if (!checkoutReserved) {
        throw new Error("检测到刚刚已提交相同收银请求，请勿重复提交");
      }
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/refund")) {
      requirePermission(session, "pos:manage");
      const orderId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = refundOrder(currentData, {
        storeId: sessionStoreId(currentData, session),
        orderId,
        reason: optionalString(body, "reason") ?? "门店退款",
        userId: session.user.id,
        amount: optionalNumber(body, "amount"),
        approvalId: optionalString(body, "approvalId"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/inventory/adjust") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const adjustedData = addOperationLog(
        adjustInventory(currentData, {
          storeId: sessionStoreId(currentData, session),
          productId: requiredString(body, "productId"),
          type: requiredString(body, "type") as InventoryLog["type"],
          quantity: requiredNumber(body, "quantity"),
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/appointments") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const requestedStaffId = requiredString(body, "staffId");
      const appointedData = updateData(await database.readData(), session, {
        action: "新增预约",
        targetType: "appointment",
        targetId: "latest",
        summary: `${session.user.name} 新增预约`,
      }, (data) =>
        createAppointment(data, {
          storeId: sessionStoreId(data, session),
          customerId: requiredString(body, "customerId"),
          staffId: requestedStaffId,
          serviceId: requiredString(body, "serviceId"),
          serviceIds: optionalStringArray(body, "serviceIds"),
          startAt: requiredString(body, "startAt"),
          endAt: optionalString(body, "endAt"),
          roomName: requiredString(body, "roomName"),
          note: optionalString(body, "note") ?? "",
        }),
      );
      const appointment = appointedData.appointments[0];
      const customer = appointedData.customers.find((item) => item.id === appointment.customerId);
      const service = appointedData.services.find((item) => item.id === appointment.serviceId);
      const serviceNames = (appointment.serviceIds?.length ? appointment.serviceIds : [appointment.serviceId])
        .map((serviceId) => appointedData.services.find((item) => item.id === serviceId)?.name)
        .filter(Boolean)
        .join("、");
      const nextData = addSystemNotification(appointedData, {
        title: "新的到店预约",
        desc: `${customer?.name ?? "客户"} · ${serviceNames || service?.name || "项目"} · ${shortTimeText(appointment.startAt)}`,
        view: "appointments",
        targetType: "appointment",
        targetId: appointment.id,
        audienceRoles: ["owner", "manager", "frontdesk", "therapist"],
        staffId: appointment.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/staff-unavailable-slots") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = createStaffUnavailableSlot(currentData, {
        storeId: sessionStoreId(currentData, session),
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        reason: optionalString(body, "reason") ?? "不可预约",
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/staff-shifts") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = createStaffShift(currentData, {
        storeId: sessionStoreId(currentData, session),
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        note: optionalString(body, "note") ?? "门店班次",
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/appointments/") && pathname.endsWith("/reschedule")) {
      requirePermission(session, "appointments:manage");
      const appointmentId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const requestedStaffId = optionalString(body, "staffId");
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/appointments/")) {
      requirePermission(session, "appointments:manage");
      const appointmentId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const status = requiredString(body, "status") as Appointment["status"];
      const nextData = updateData(await database.readData(), session, {
        action: "更新预约状态",
        targetType: "appointment",
        targetId: appointmentId,
        summary: `${session.user.name} 将预约状态改为 ${status}`,
      }, (data) => updateAppointmentStatus(data, { appointmentId, status, reason: optionalString(body, "reason") }));
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/online-booking-requests/") && pathname.endsWith("/convert")) {
      requirePermission(session, "appointments:manage");
      const requestId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = convertOnlineBookingRequest(await database.readData(), {
        requestId,
        staffId: requiredString(body, "staffId"),
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/customers") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const customerPhone = requireMobilePhone(requiredString(body, "phone"));
      const nextData = updateData(await database.readData(), session, {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/customers/")) {
      requirePermission(session, "customers:manage");
      const customerId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/tags") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/tags/")) {
      requirePermission(session, "customers:manage");
      const tagId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/member-cards") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = openMemberCard(currentData, {
        storeId: sessionStoreId(currentData, session),
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/recharge")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = rechargeMemberCard(await database.readData(), {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/status")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = updateMemberCardStatus(await database.readData(), {
        memberCardId,
        status: requiredString(body, "status") as "正常" | "冻结",
        reason: optionalString(body, "reason") ?? "门店操作",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/extend")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = extendMemberCard(await database.readData(), {
        memberCardId,
        expiresAt: requiredString(body, "expiresAt"),
        reason: optionalString(body, "reason") ?? "会员卡延期",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/transfer")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = transferMemberCard(await database.readData(), {
        memberCardId,
        toCustomerId: requiredString(body, "toCustomerId"),
        reason: optionalString(body, "reason") ?? "会员转卡",
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/approvals") {
      requirePermission(session, "pos:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/approvals/")) {
      requirePermission(session, "approvals:manage");
      const approvalId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const nextData = decideApprovalRequest(await database.readData(), {
        approvalId,
        userId: session.user.id,
        approved: optionalBoolean(body, "approved") ?? true,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/service-records") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const recordData = addCustomerServiceRecord(await database.readData(), {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/customer-signatures") {
      requireAnyPermission(session, ["customers:manage", "pos:manage"]);
      const body = await readJson(context.request);
      const nextData = createCustomerSignature(await database.readData(), {
        customerId: requiredString(body, "customerId"),
        serviceRecordId: optionalString(body, "serviceRecordId"),
        orderId: optionalString(body, "orderId"),
        title: optionalString(body, "title"),
        content: optionalString(body, "content"),
        requestedBy: session.user.id,
        validDays: optionalNumber(body, "validDays"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/customer-signatures/") && pathname.endsWith("/sign")) {
      requireAnyPermission(session, ["customers:manage", "pos:manage"]);
      const signatureId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const signature = currentData.customerSignatures.find((item) => item.id === signatureId);
      if (!signature) throw new Error("签名记录不存在");
      const nextData = signCustomerSignature(currentData, {
        token: signature.token,
        signerName: requiredString(body, "signerName"),
        signatureText: requiredString(body, "signatureText"),
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/follow-ups") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = addCustomerFollowUp(await database.readData(), {
        customerId: requiredString(body, "customerId"),
        staffId: requiredString(body, "staffId"),
        dueAt: requiredString(body, "dueAt"),
        method: requiredString(body, "method") as "电话" | "微信" | "到店",
        note: optionalString(body, "note") ?? "",
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/follow-ups/")) {
      requirePermission(session, "customers:manage");
      const followUpId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/refund")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = refundMemberCard(await database.readData(), {
        memberCardId,
        reason: optionalString(body, "reason") ?? "客户退卡",
        refundAmount: optionalNumber(body, "refundAmount"),
        payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
        signatureId: requiredString(body, "signatureId"),
        userId: session.user.id,
        staffId: session.user.staffId,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/services") {
      requirePermission(session, "catalog:manage");
      const body = await readJson(context.request);
      const consumables = optionalConsumables(body);
      const nextData = updateData(await database.readData(), session, {
        action: "新增服务项目",
        targetType: "service",
        targetId: "latest",
        summary: `${session.user.name} 新增服务项目 ${requiredString(body, "name")}`,
      }, (data) => {
        const storeId = sessionStoreId(data, session);
        const stockConsumables = consumables.filter((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId);
          if (!product) throw new Error("商品不存在");
          return productServiceStockDeductible(product);
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
              consumables: stockConsumables,
              consumableProductId: stockConsumables[0]?.productId ?? optionalString(body, "consumableProductId"),
              consumableQty: stockConsumables[0]?.quantity ?? optionalNumber(body, "consumableQty"),
            },
            ...data.services,
          ],
        };
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/services/") && pathname.endsWith("/consumables")) {
      requirePermission(session, "catalog:manage");
      const serviceId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const consumables = optionalConsumables(body);
      const nextData = updateData(await database.readData(), session, {
        action: "更新商品耗材",
        targetType: "service",
        targetId: serviceId,
        summary: `${session.user.name} 更新项目使用产品`,
      }, (data) => {
        if (!data.services.some((service) => service.id === serviceId)) throw new Error("服务项目不存在");
        const stockConsumables = consumables.filter((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId);
          if (!product) throw new Error("商品不存在");
          return productServiceStockDeductible(product);
        });
        return {
          ...data,
          services: data.services.map((service) =>
            service.id === serviceId
              ? {
                  ...service,
                  consumables: stockConsumables,
                  consumableProductId: stockConsumables[0]?.productId,
                  consumableQty: stockConsumables[0]?.quantity,
                }
              : service,
          ),
        };
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/services/")) {
      requirePermission(session, "catalog:manage");
      const serviceId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/products") {
      requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
      const body = await readJson(context.request);
      const productId = makeId("p");
      const createdAt = nowIso();
      const name = requiredString(body, "name");
      const stock = requiredNumber(body, "stock");
      const category = optionalString(body, "category") ?? "面护类";
      const subcategory = optionalString(body, "subcategory") ?? "";
      const unit = optionalString(body, "unit") ?? "件";
      const expiryAt = optionalString(body, "expiryAt");
      const serviceStockDeductible = productServiceStockDeductible({
        name,
        category,
        subcategory,
        unit,
        serviceStockDeductible: optionalBoolean(body, "serviceStockDeductible"),
        serviceUnitsPerStockUnit: optionalNumber(body, "serviceUnitsPerStockUnit") ?? optionalNumber(body, "serviceUsesPerUnit"),
        serviceUnit: optionalString(body, "serviceUnit"),
      });
      const serviceUnit = serviceStockDeductible
        ? productServiceUnit({ name, category, subcategory, unit, serviceStockDeductible, serviceUnit: optionalString(body, "serviceUnit") })
        : undefined;
      const serviceUnitsPerStockUnit = serviceStockDeductible
        ? normalizeProductServiceUnitsPerStockUnit(optionalNumber(body, "serviceUnitsPerStockUnit") ?? optionalNumber(body, "serviceUsesPerUnit"))
        : undefined;
      const nextData = updateData(await database.readData(), session, {
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
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/products/")) {
      requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
      const productId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const currentData = await database.readData();
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
        serviceUnit: optionalString(body, "serviceUnit"),
        serviceUnitsPerStockUnit: optionalNumber(body, "serviceUnitsPerStockUnit"),
        status: optionalString(body, "status") as "启用" | "停用" | undefined,
      }));
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/suppliers") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = addSupplier(currentData, {
        storeId: sessionStoreId(currentData, session),
        name: requiredString(body, "name"),
        phone: optionalString(body, "phone") ?? "",
        contact: optionalString(body, "contact") ?? "",
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/purchase-orders") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = receivePurchaseOrder(currentData, {
        storeId: sessionStoreId(currentData, session),
        supplierId: requiredString(body, "supplierId"),
        productId: requiredString(body, "productId"),
        quantity: requiredNumber(body, "quantity"),
        unitCost: requiredNumber(body, "unitCost"),
        expiryAt: optionalString(body, "expiryAt"),
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/inventory/restock-low") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = restockLowInventory(currentData, {
        storeId: sessionStoreId(currentData, session),
        supplierId: optionalString(body, "supplierId"),
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/stocktakes") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = createStocktake(currentData, {
        storeId: sessionStoreId(currentData, session),
        productId: requiredString(body, "productId"),
        actualStock: requiredNumber(body, "actualStock"),
        reason: optionalString(body, "reason") ?? "库存盘点",
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/commissions/settle") {
      requirePermission(session, "commissions:settle");
      const nextData = updateData(await database.readData(), session, {
        action: "结算提成",
        targetType: "commission",
        targetId: "all",
        summary: `${session.user.name} 结算全部待结算提成`,
      }, (data) => settleCommissions(data, { userId: session.user.id }));
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close") {
      requirePermission(session, "reports:view");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = createDailyClose(currentData, {
        storeId: sessionStoreId(currentData, session),
        businessDate: optionalString(body, "businessDate") ?? new Date().toISOString().slice(0, 10),
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close/reverse") {
      requirePermission(session, "reports:view");
      const body = await readJson(context.request);
      const currentData = await database.readData();
      const nextData = reverseDailyClose(currentData, {
        storeId: sessionStoreId(currentData, session),
        businessDate: requiredString(body, "businessDate"),
        userId: session.user.id,
      });
      await persistData(database, session, nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    return sendJson(404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return sendJson(400, { error: message });
  }
};

function updateData(
  data: AppData,
  session: UserSession,
  log: { action: string; targetType: string; targetId: string; summary: string },
  updater: (data: AppData) => AppData,
) {
  return addOperationLog(updater(data), { userId: session.user.id, ...log });
}

function persistData(database: D1BeautyDatabase, session: UserSession, nextData: AppData) {
  if (session.user.role !== "superadmin" && session.user.storeId) {
    return database.replaceStoreData(session.user.storeId, nextData);
  }
  return database.replaceData(nextData);
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
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
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

async function serveR2Asset(env: Env, pathname: string) {
  const bucket = getR2Bucket(env);
  if (!bucket) return sendJson(404, { error: "资源不存在" });

  const object = await bucket.get(assetKeyFromPath(pathname));
  if (!object) return sendJson(404, { error: "资源不存在" });

  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    ...corsHeaders(),
  });
  if (object.writeHttpMetadata) {
    object.writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set("Content-Type", object.httpMetadata.contentType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }

  return new Response(object.body, { headers });
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

type AiProviderKey = "openai" | "deepseek" | "seedance" | "kling" | "hailuo";
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
type AiImageModelConfig = {
  enabled: boolean;
  provider: "openai";
  model: string;
  apiKey: string;
  defaultSize: "1024x1024" | "1024x1536" | "1536x1024";
  defaultQuality: "standard" | "high";
  maxImagesPerRequest: number;
  textInputUsdPerMillion: number;
  imageInputUsdPerMillion: number;
  imageOutputUsdPerMillion: number;
};
type AiVideoProviderConfig = {
  provider: Extract<AiProviderKey, "seedance" | "kling" | "hailuo">;
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

const aiVideoDurations = [5, 10, 15];
const aiVideoResolutions: AiVideoResolution[] = ["480p", "720p", "1080p"];
const aiVideoAspectRatios: AiVideoAspectRatio[] = ["9:16", "1:1", "16:9"];
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
      { provider: "seedance", enabled: true, model: "seedance-2.0", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "720p", defaultAspectRatio: "9:16", priceUsdBySpec: {} },
      { provider: "kling", enabled: false, model: "kling-v3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "720p", defaultAspectRatio: "9:16", priceUsdBySpec: {} },
      { provider: "hailuo", enabled: false, model: "MiniMax-Hailuo-2.3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "720p", defaultAspectRatio: "9:16", priceUsdBySpec: {} },
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
      model: typeof incoming?.model === "string" ? incoming.model : defaultProvider.model,
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
      model: typeof image.model === "string" ? image.model : fallback.image.model,
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
  if (typeof error === "string") return `${provider} 返回错误(${status})：${error}`;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return `${provider} 返回错误(${status})：${(error as { message: string }).message}`;
  }
  if (typeof payload.message === "string") return `${provider} 返回错误(${status})：${payload.message}`;
  if (typeof payload.status_msg === "string") return `${provider} 返回错误(${status})：${payload.status_msg}`;
  return `${provider} 返回错误(${status})`;
}

async function fetchProviderJson(provider: string, url: string, init: RequestInit) {
  const startedAt = Date.now();
  const response = await fetch(url, init);
  const payload = await readProviderJson(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(provider, response.status, payload));
  }
  return { payload, elapsedMs: Date.now() - startedAt };
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

function marketingText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function marketingImageSize(posterSize: string | undefined) {
  if (posterSize?.includes("16:9")) return "1536x1024";
  if (posterSize?.includes("9:16") || posterSize?.includes("3:4")) return "1024x1536";
  return "1024x1024";
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

function imageGenerationCost(config: AiImageModelConfig, usage: unknown) {
  const record = aiUsageRecord(usage);
  const textInputTokens = nestedUsageNumber(record, [["text_input_tokens"], ["input_tokens"], ["prompt_tokens"]]);
  const imageInputTokens = nestedUsageNumber(record, [["image_input_tokens"], ["input_tokens_details", "image_tokens"]]);
  const outputTokens = nestedUsageNumber(record, [["image_output_tokens"], ["output_tokens"], ["completion_tokens"]]);
  const totalTokens = nestedUsageNumber(record, [["total_tokens"]]);
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

function marketingPrompt(body: JsonBody, kind: MarketingAiKind) {
  const storeName = marketingText(body.storeName, "美业门店");
  const productName = marketingText(body.productName, "护理产品");
  const serviceName = marketingText(body.serviceName, "护理项目");
  const audience = marketingText(body.audience, "目标客户");
  const channel = marketingText(body.channel, "朋友圈");
  const marketingNode = marketingText(body.marketingNode, "日常护理节点");
  const customerType = marketingText(body.customerType, audience);
  const lifecycleNode = marketingText(body.lifecycleNode, "无明确消费节点");
  const bodyState = marketingText(body.bodyState, "常规护理需求");
  const marketingGoal = marketingText(body.marketingGoal, "到店转化");
  const posterStyle = marketingText(body.posterStyle, "门店品牌风格");
  const customRequirement = optionalString(body, "customRequirement");
  const nodeContext = `营销节点：${marketingNode}。客户类型：${customerType}。消费节点：${lifecycleNode}。身体状态/文案痛点：${bodyState}。营销目的：${marketingGoal}。海报/内容风格：${posterStyle}。`;
  if (kind === "copy") {
    return `请为美业门店生成一套${channel}营销内容。门店：${storeName}。商品：${productName}。项目：${serviceName}。${nodeContext}客群摘要：${audience}。客户自定义要求：${customRequirement || "无"}。要求：中文，适合门店员工直接复制发布，包含标题、正文、到店邀约，也要能配合海报标题使用；围绕时间节点和客户当前状态来写，不要把客户身份、身体状态、营销目的混为一类；不要虚假承诺，不要夸大医疗效果。`;
  }
  if (kind === "talk") {
    const customerName = marketingText(body.customerName, audience);
    const talkScene = marketingText(body.talkScene, "复购邀约");
    return `请生成一段美业门店私聊话术。客户：${customerName}。场景：${talkScene}。商品：${productName}。项目：${serviceName}。${nodeContext}要求：自然、短句、像真人微信沟通，包含问候、推荐理由和预约引导；先基于客户消费节点和身体状态给出关怀，再自然推荐项目，不要夸大效果。`;
  }
  if (kind === "image") {
    const posterSize = marketingText(body.posterSize, "朋友圈 1:1");
    const posterTitle = marketingText(body.posterTitle, "到店护理礼遇");
    const posterOffer = marketingText(body.posterOffer, "限时体验价");
    const productImageName = marketingText(body.productImageName, "未上传产品图");
    const sceneImageName = marketingText(body.sceneImageName, "未上传场景图");
    return `生成一张高端美业门店营销海报，中文标题：${posterTitle}，活动信息：${posterOffer}，商品：${productName}，项目：${serviceName}，门店：${storeName}，尺寸用途：${posterSize}。${nodeContext}参考素材名称：产品图 ${productImageName}，场景图 ${sceneImageName}。画面要干净、专业，适合手机端传播；如果是中医养生或节气海报风格，可使用宣纸、草药、药灸、温和调理等视觉元素；避免医疗承诺。`;
  }
  const videoRatio = marketingText(body.videoRatio, "9:16");
  const videoDuration = Number(body.videoDuration) || 5;
  const videoScript = marketingText(body.videoScript, "门店护理环境、产品陈列、护理手法和预约引导。");
  return `生成美业门店宣传短视频。门店：${storeName}。商品：${productName}。项目：${serviceName}。${nodeContext}比例：${videoRatio}。时长：${videoDuration}秒。脚本重点：${videoScript}。画面要专业、真实、干净，适合短视频发布，避免医疗承诺。`;
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
  const marketingNode = marketingText(body.marketingNode, "夏季祛湿");
  const storeName = marketingText(body.storeName, "美业门店");
  const serviceName = marketingText(body.serviceName, "护理项目");
  const marketingGoal = marketingText(body.marketingGoal, "护理提醒");
  const bodyState = marketingText(body.bodyState, "身体状态");
  const posterStyle = marketingText(body.posterStyle, "中医养生风");
  const customRequirement = optionalString(body, "customRequirement");
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const title = compactMarketingLine(marketingNode, "夏季祛湿", 18);
  const headlineLines = marketingPosterLines(lines[0] ?? `${marketingNode} · ${marketingGoal}`, "把寒湿慢慢排出去", 18, 9, 2);
  const subtitleLines = marketingPosterLines(customRequirement || `${serviceName} · ${bodyState}`, "适合门店朋友圈发布", 24, 16, 2);
  const footer = compactMarketingLine(`${storeName}｜${marketingGoal}`, "门店护理提醒", 26);
  const wellness = posterStyle.includes("中医") || posterStyle.includes("节气");
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

async function runMarketingAiGenerate(data: AppData, session: UserSession, body: JsonBody) {
  const kind = requiredString(body, "kind") as MarketingAiKind;
  if (!["copy", "image", "video", "talk"].includes(kind)) throw new Error("AI 营销类型不正确");
  const capability: AiUsageCapability = kind === "image" ? "image" : kind === "video" ? "video" : "copy";
  assertMarketingAiAllowed(data, session, capability);
  const prompt = marketingPrompt(body, kind);
  if (kind === "copy" || kind === "talk") {
    const config = aiGenerationConfigFromData(data).copy;
    const result = await runAiTextCompletion(data, prompt, {
      systemPrompt: "你是祝融坤锋美业门店系统的营销助手。输出必须可直接给门店员工使用，中文，具体、自然、合规，禁止夸大医疗效果。",
    });
    return { kind, provider: result.provider, model: result.model, text: result.text, imageDataUrl: kind === "copy" ? marketingPosterDataUrl(body, result.text) : undefined, usage: result.usage, cost: textGenerationCost(config, result.usage), elapsedMs: result.elapsedMs };
  }
  if (kind === "image") {
    const config = aiGenerationConfigFromData(data).image;
    const result = await runAiImageTest(data, { prompt, size: marketingImageSize(optionalString(body, "posterSize")) });
    return { kind, provider: result.provider, model: result.model, imageDataUrl: result.imageDataUrl, revisedPrompt: result.revisedPrompt, usage: result.usage, cost: imageGenerationCost(config, result.usage), elapsedMs: result.elapsedMs };
  }
  const config = aiGenerationConfigFromData(data);
  const provider = config.video.providers.find((item) => item.provider === config.video.defaultProvider) ?? config.video.providers[0];
  const durationSeconds = aiVideoDurations.includes(Number(body.videoDuration)) ? Number(body.videoDuration) : provider?.defaultDurationSeconds ?? 5;
  const resolution = provider?.defaultResolution ?? "720p";
  const result = await runAiVideoTest(data, {
    prompt,
    provider: config.video.defaultProvider,
    durationSeconds,
    aspectRatio: optionalString(body, "videoRatio"),
  });
  return { kind, ...result, cost: provider ? videoGenerationCost(provider, durationSeconds, resolution) : undefined };
}

function marketingAiRecord(data: AppData, session: UserSession, body: JsonBody, result: {
  kind: MarketingAiRecord["kind"];
  provider?: string;
  model?: string;
  text?: string;
  imageDataUrl?: string;
  videoUrl?: string;
  taskId?: string;
  status?: string;
  cost?: MarketingAiRecord["cost"];
}): MarketingAiRecord {
  const title = {
    copy: "AI营销内容",
    talk: "私聊话术",
    image: "AI海报",
    video: "AI视频",
  }[result.kind];
  return {
    id: makeId("mar"),
    storeId: sessionStoreId(data, session),
    kind: result.kind,
    title,
    channel: optionalString(body, "channel"),
    marketingNode: optionalString(body, "marketingNode"),
    customerType: optionalString(body, "customerType"),
    lifecycleNode: optionalString(body, "lifecycleNode"),
    bodyState: optionalString(body, "bodyState"),
    marketingGoal: optionalString(body, "marketingGoal"),
    serviceName: optionalString(body, "serviceName"),
    productName: optionalString(body, "productName"),
    text: result.text,
    imageDataUrl: result.imageDataUrl,
    videoUrl: result.videoUrl,
    taskId: result.taskId,
    status: result.status,
    cost: result.cost,
    provider: result.provider,
    model: result.model,
    createdBy: session.user.id,
    createdByName: session.user.name,
    createdAt: nowIso(),
  };
}

async function runAiImageTest(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data).image;
  assertAiCapability(config.enabled, config.apiKey, config.model, "图片生成");
  const prompt = requiredTrimmedText(body, "prompt", 4000);
  const size = optionalAiString(body, "size", 20) ?? config.defaultSize;
  const qualityInput = optionalAiString(body, "quality", 20) ?? config.defaultQuality;
  const quality = qualityInput === "standard" ? "medium" : qualityInput;
  const { payload, elapsedMs } = await fetchProviderJson("OpenAI", "https://api.openai.com/v1/images/generations", {
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
      n: 1,
    }),
  });
  const output = Array.isArray(payload.data) ? payload.data[0] as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown } | undefined : undefined;
  const b64 = typeof output?.b64_json === "string" ? output.b64_json : undefined;
  const imageUrl = typeof output?.url === "string" ? output.url : undefined;
  if (!b64 && !imageUrl) throw new Error("OpenAI 未返回图片数据");
  return {
    provider: "openai" as const,
    model: config.model,
    imageDataUrl: b64 ? `data:image/png;base64,${b64}` : imageUrl,
    revisedPrompt: typeof output?.revised_prompt === "string" ? output.revised_prompt : undefined,
    usage: payload.usage,
    raw: compactAiRawPayload(payload),
    elapsedMs,
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
  if (activeProvider.provider === "hailuo") {
    return createHailuoVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio);
  }
  if (activeProvider.provider === "kling") {
    return createKlingVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio);
  }
  return createSeedanceVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio);
}

async function runAiVideoStatusTest(data: AppData, body: JsonBody) {
  const config = aiGenerationConfigFromData(data);
  const providerKey = requiredString(body, "provider") as AiVideoProviderConfig["provider"];
  const activeProvider = config.video.providers.find((provider) => provider.provider === providerKey);
  if (!activeProvider) throw new Error("视频供应商未配置");
  assertAiCapability(activeProvider.enabled, activeProvider.apiKey, activeProvider.model, `${providerLabel(activeProvider.provider)}视频`);
  const taskId = requiredTrimmedText(body, "taskId", 200);
  if (activeProvider.provider === "hailuo") return queryHailuoVideoTask(activeProvider, taskId);
  if (activeProvider.provider === "kling") return queryKlingVideoTask(activeProvider, taskId);
  return querySeedanceVideoTask(activeProvider, taskId);
}

async function createSeedanceVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio) {
  const normalizedRequest = { duration: durationSeconds, resolution, ratio: aspectRatio };
  const { payload, elapsedMs } = await fetchProviderJson("Seedance", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      content: [{ type: "text", text: prompt }],
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

async function createKlingVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio) {
  const normalizedRequest = {
    duration: durationSeconds === 10 ? "10" : "5",
    aspect_ratio: aspectRatio,
    mode: resolution === "1080p" ? "pro" : "std",
  };
  const { payload, elapsedMs } = await fetchProviderJson("Kling", "https://api-singapore.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: config.model,
      prompt,
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

async function createHailuoVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio) {
  const normalizedDuration = durationSeconds >= 10 ? 10 : 6;
  const normalizedResolution = resolution === "1080p" && normalizedDuration === 6 ? "1080P" : "768P";
  const normalizedRequest = { duration: normalizedDuration, resolution: normalizedResolution, aspectRatio };
  const { payload, elapsedMs } = await fetchProviderJson("MiniMax", "https://api.minimax.io/v1/video_generation", {
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
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["task_id", "taskId", "id"]),
    status: readFirstString(payload, ["status"]),
    normalizedRequest,
  });
}

async function queryHailuoVideoTask(config: AiVideoProviderConfig, taskId: string) {
  const { payload, elapsedMs } = await fetchProviderJson("MiniMax", `https://api.minimax.io/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  return videoResult(config, elapsedMs, payload, {
    taskId,
    status: readFirstString(payload, ["status"]),
    fileId: readFirstString(payload, ["file_id", "fileId"]),
    videoUrl: readFirstString(payload, ["video_url", "videoURL"]),
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

async function readJson(request: Request): Promise<JsonBody> {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as JsonBody;
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

function requestedDataView(request: Request) {
  const requestedView = request.headers.get("X-App-Data-View") ?? new URL(request.url).searchParams.get("view");
  return isViewKey(requestedView) ? requestedView : undefined;
}

function isSliceRequest(request: Request) {
  return request.headers.get("X-App-Data-Mode") === "slice";
}

function readDataForRequest(database: D1BeautyDatabase, request: Request, session: UserSession) {
  const requestedView = requestedDataView(request);
  if (isSliceRequest(request) && requestedView) {
    if (session.user.role !== "superadmin" && session.user.storeId) {
      return database.readDataTablesForStore(dataKeysForView(requestedView), session.user.storeId);
    }
    return database.readDataTables(dataKeysForView(requestedView));
  }
  return database.readData();
}

function sendScopedData(request: Request, statusCode: number, data: AppData, session: UserSession) {
  const scopedData = scopeDataForSession(data, session);
  const requestedView = requestedDataView(request);
  if (isSliceRequest(request) && requestedView) {
    return sendJson(statusCode, makeAppDataSlice(scopedData, requestedView));
  }
  return sendJson(statusCode, scopedData);
}

function handleCors(request: Request) {
  if (request.method !== "OPTIONS") return undefined;
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Data-Mode, X-App-Data-View, Cache-Control, Pragma",
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
