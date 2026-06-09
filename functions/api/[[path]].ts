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
  normalizeStoreScopedData,
  openMemberCard,
  previewFormalDataCleanup,
  scopeDataToStore,
  updateTagDefinition,
  updateStaffMember,
  updateAccountProfile,
  updateAuthUserStatus,
  resetAuthUserPassword,
  updateStoreProfile,
  updateStoreStatus,
  updateSystemConfig,
  updateMemberCardStatus,
  platformInviteIssuerId,
  storeIdForUser,
} from "../../src/domain/business";
import { hashPassword } from "../../src/lib/password";

// Read version from package.json at runtime (works in Cloudflare Workers)
import pkg from "../../package.json" with { type: "json" };
import type { Permission, UserSession } from "../../src/domain/auth";
import type { AppData, Appointment, CashPayMethod, CustomerSignature, InventoryLog, Order, R2UsageSnapshot, ServiceConsumable, SystemConfigKey, TagScope, UserRole, WorkerUsageSnapshot } from "../../src/domain/types";
import type { CheckoutProductItemInput } from "../../src/domain/business";
import { isViewKey, makeAppDataSlice } from "../../src/domain/dataSlices";
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
        ownerName: requiredString(body, "ownerName"),
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
        name: requiredString(body, "name"),
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
        message: "员工账号已提交，请等待店长审核通过后再登录。",
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
        audienceRoles: ["owner", "manager", "frontdesk"],
      });
      await database.replaceData(nextData);
      return sendJson(201, { ok: true });
    }

    if (context.request.method === "GET" && pathname.startsWith("/api/public/customer-signatures/")) {
      const token = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      return sendJson(200, publicSignaturePayload(await database.readData(), token));
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/public/customer-signatures/") && pathname.endsWith("/sign")) {
      const token = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = signCustomerSignature(await database.readData(), {
        token,
        signerName: requiredString(body, "signerName"),
        signatureText: requiredString(body, "signatureText"),
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "GET" && pathname === "/api/data") {
      requirePermission(session, "dashboard:view");
      return sendScopedData(context.request, 200, await database.readData(), session);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/read")) {
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const nextData = markNotificationRead(await database.readData(), { notificationId, userId: session.user.id });
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/archive")) {
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const nextData = archiveNotification(await database.readData(), { notificationId, userId: session.user.id });
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/notifications/read-all") {
      const nextData = markAllVisibleNotificationsRead(await database.readData(), {
        userId: session.user.id,
        role: session.user.role,
        staffId: session.user.staffId,
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff-invites/")) {
      requirePermission(session, "staff:manage");
      const inviteId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const nextData = revokeStaffInvite(await database.readData(), {
        inviteId,
        revokedBy: session.user.id,
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/appointments") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const appointedData = updateData(await database.readData(), session, {
        action: "新增预约",
        targetType: "appointment",
        targetId: "latest",
        summary: `${session.user.name} 新增预约`,
      }, (data) =>
        createAppointment(data, {
          storeId: sessionStoreId(data, session),
          customerId: requiredString(body, "customerId"),
          staffId: requiredString(body, "staffId"),
          serviceId: requiredString(body, "serviceId"),
          startAt: requiredString(body, "startAt"),
          endAt: optionalString(body, "endAt"),
          roomName: requiredString(body, "roomName"),
          note: optionalString(body, "note") ?? "",
        }),
      );
      const appointment = appointedData.appointments[0];
      const customer = appointedData.customers.find((item) => item.id === appointment.customerId);
      const service = appointedData.services.find((item) => item.id === appointment.serviceId);
      const nextData = addSystemNotification(appointedData, {
        title: "新的到店预约",
        desc: `${customer?.name ?? "客户"} · ${service?.name ?? "项目"} · ${shortTimeText(appointment.startAt)}`,
        view: "appointments",
        targetType: "appointment",
        targetId: appointment.id,
        audienceRoles: ["owner", "manager", "frontdesk", "therapist"],
        staffId: appointment.staffId,
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/appointments/") && pathname.endsWith("/reschedule")) {
      requirePermission(session, "appointments:manage");
      const appointmentId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
        action: "改约",
        targetType: "appointment",
        targetId: appointmentId,
        summary: `${session.user.name} 调整预约时间`,
      }, (data) =>
        rescheduleAppointment(data, {
          appointmentId,
          staffId: optionalString(body, "staffId"),
          serviceId: optionalString(body, "serviceId"),
          startAt: requiredString(body, "startAt"),
          endAt: optionalString(body, "endAt"),
          roomName: optionalString(body, "roomName"),
          note: optionalString(body, "note"),
        }),
      );
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 200, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/customers") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
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
            phone: requiredString(body, "phone"),
            level: optionalString(body, "level") ?? "普通会员",
            source: optionalString(body, "source") ?? "门店登记",
            tags: ["新客"],
            lastVisit: nowIso(),
          },
          ...data.customers,
        ],
      }));
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/customers/")) {
      requirePermission(session, "customers:manage");
      const customerId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
        action: "更新客户标签",
        targetType: "customer",
        targetId: customerId,
        summary: `${session.user.name} 更新客户资料`,
      }, (data) => {
        if (!data.customers.some((customer) => customer.id === customerId)) throw new Error("客户不存在");
        return {
          ...data,
          customers: data.customers.map((customer) =>
            customer.id === customerId
              ? {
                  ...customer,
                  name: optionalString(body, "name") ?? customer.name,
                  phone: optionalString(body, "phone") ?? customer.phone,
                  level: optionalString(body, "level") ?? customer.level,
                  source: optionalString(body, "source") ?? customer.source,
                  tags: optionalStringArray(body, "tags") ?? customer.tags,
                }
              : customer,
          ),
        };
      });
      await database.replaceData(nextData);
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
          name: requiredString(body, "name"),
          scope: requiredString(body, "scope") as TagScope,
          color: optionalString(body, "color"),
        }),
      );
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
        name: optionalString(body, "name"),
        type: optionalString(body, "type") as "储值卡" | "次数卡" | "套餐卡" | "折扣卡" | undefined,
        balance: optionalNumber(body, "balance"),
        remainingTimes: optionalNumber(body, "remainingTimes"),
        discountRate: optionalNumber(body, "discountRate"),
        benefitText: optionalString(body, "benefitText"),
        serviceId: optionalString(body, "serviceId"),
        serviceIds: optionalStringArray(body, "serviceIds"),
        paidAmount: optionalNumber(body, "paidAmount"),
        payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
        expiresAt: optionalString(body, "expiresAt"),
        note: optionalString(body, "note"),
        userId: session.user.id,
      });
      await database.replaceData(nextData);
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
      });
      await database.replaceData(nextData);
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
      });
      await database.replaceData(nextData);
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
      });
      await database.replaceData(nextData);
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
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "POST" && pathname === "/api/customer-signatures") {
      requirePermission(session, "customers:manage");
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/follow-ups/")) {
      requirePermission(session, "customers:manage");
      const followUpId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const nextData = completeCustomerFollowUp(await database.readData(), { followUpId });
      await database.replaceData(nextData);
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
      });
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
      return sendScopedData(context.request, 201, nextData, session);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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
      await database.replaceData(nextData);
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

function sessionStoreId(data: AppData, session: UserSession) {
  return storeIdForUser(normalizeStoreScopedData(data), session.user);
}

function assertCanManageAuthUser(data: AppData, session: UserSession, userId: string) {
  if (session.user.role === "superadmin") return;
  const normalizedData = normalizeStoreScopedData(data);
  const user = normalizedData.authUsers.find((item) => item.id === userId);
  if (!user) throw new Error("账号不存在");
  if (user.role === "superadmin" || user.role === "owner") throw new Error("店长只能管理员工账号");
  const currentStoreId = sessionStoreId(normalizedData, session);
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
  const currentStoreId = sessionStoreId(normalizedData, session);
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
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function isStoreOwnerInviteCode(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return Boolean(platformInviteIssuerId(data, normalizedInviteCode))
    || (data.storeOwnerInvites ?? []).some((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode && item.status === "待加入");
}

function scopeDataForSession(data: AppData, session: UserSession): AppData {
  const normalizedData = normalizeStoreScopedData(data);
  const currentStoreId = storeIdForUser(normalizedData, session.user);
  const sessionData = session.user.role === "superadmin"
    ? normalizedData
    : scopeDataToStore(normalizedData, currentStoreId);
  const sanitizedData = {
    ...sessionData,
    authUsers: sessionData.authUsers.map((user) => ({ ...user, password: "" })),
    storeOwnerApplications: (sessionData.storeOwnerApplications ?? []).map((application) => ({ ...application, password: "" })),
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
  const appointments = sanitizedData.appointments.filter((item) => item.staffId === staffId);
  const orders = sanitizedData.orders.filter((item) => item.staffId === staffId);
  const orderIds = new Set(orders.map((item) => item.id));
  const appointmentIds = new Set(appointments.map((item) => item.id));
  const customerIds = new Set([...appointments.map((item) => item.customerId), ...orders.map((item) => item.customerId)]);

  return {
    ...sanitizedData,
    customers: sanitizedData.customers.filter((item) => customerIds.has(item.id)),
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
    customerServiceRecords: sanitizedData.customerServiceRecords.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    customerSignatures: (sanitizedData.customerSignatures ?? []).filter((item) => customerIds.has(item.customerId)),
    customerFollowUps: sanitizedData.customerFollowUps.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
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

function sendScopedData(request: Request, statusCode: number, data: AppData, session: UserSession) {
  const scopedData = scopeDataForSession(data, session);
  if (request.headers.get("X-App-Data-Mode") === "slice") {
    const requestedView = request.headers.get("X-App-Data-View") ?? new URL(request.url).searchParams.get("view");
    if (isViewKey(requestedView)) {
      return sendJson(statusCode, makeAppDataSlice(scopedData, requestedView));
    }
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Data-Mode, X-App-Data-View",
  };
}

function requiredString(body: JsonBody, key: string) {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`缺少字段 ${key}`);
  }
  return value;
}

function optionalString(body: JsonBody, key: string) {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
