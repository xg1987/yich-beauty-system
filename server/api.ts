import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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
  createStoreOwnerInvite,
  createStaffInvite,
  createStocktake,
  decideStoreOwnerApplication,
  deleteStaffMember,
  completeCustomerFollowUp,
  decideApprovalRequest,
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
  resetAuthUserPassword,
  settleCommissions,
  updateAppointmentStatus,
  updateAuthUserAiCredits,
  transferMemberCard,
  upsertOnlineStorefront,
  joinInviteByCode,
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
  updateStoreAiUsagePermissions,
  updateStoreOperationalPermissions,
  updateStoreProfile,
  updateStoreStatus,
  updateSystemConfig,
  updateMemberCardStatus,
  platformInviteIssuerId,
  isStoreStaffInviteCode,
  storeIdForUser,
} from "../src/domain/business";
import { hashPassword } from "../src/lib/password";

// Read version from package.json (Node.js ESM)
import pkg from "../package.json" with { type: "json" };
import { normalizeUserSession, type Permission, type UserSession } from "../src/domain/auth";
import { aiCreditChargeForCost, assertAiFreeQuotaAvailable } from "../src/domain/aiBilling";
import { requireMobilePhone } from "../src/domain/phone";
import { normalizeProductServiceUnitsPerStockUnit, productServiceStockDeductible, productServiceUnit } from "../src/domain/products";
import type { AiUsageCapability, AppData, Appointment, CashPayMethod, Customer, CustomerFollowUp, CustomerSignature, InventoryLog, MarketingAiRecord, MemberCard, OperationLog, Order, R2UsageSnapshot, ServiceConsumable, SystemConfigKey, TagScope, UserRole, WorkerUsageSnapshot } from "../src/domain/types";
import type { CheckoutProductItemInput } from "../src/domain/business";
import { dataKeysForView, isViewKey, makeAppDataSlice } from "../src/domain/dataSlices";
import { makeId, nowIso } from "../src/domain/utils";
import { getSession, login, refreshSessionUser } from "./auth";
import { BeautyDatabase } from "./database";

type JsonBody = Record<string, unknown>;
const aiImageGenerationMaxGlobalSlots = 4;
const aiImageGenerationLockTtlMs = 5 * 60 * 1000;
const providerFetchTimeoutMs = 260_000;
type LocalAvatarUpload = {
  buffer: Buffer;
  contentType: string;
  extension: string;
};

const LOCAL_ASSET_ROOT = path.join(process.cwd(), ".local-r2");

export function createApiServer(database = new BeautyDatabase()) {
  database.seedIfEmpty();

  return createServer(async (request, response) => {
    try {
      setCorsHeaders(response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        const clientVersion = url.searchParams.get("clientVersion");
        const manualUpdateCheck = url.searchParams.get("manualUpdateCheck") === "1";
        sendJson(response, 200, {
          ok: true,
          service: "yich-system-api",
          ...(!clientVersion || manualUpdateCheck ? { version: pkg.version } : {}),
        });
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/api/assets/")) {
        await serveLocalAsset(response, url.pathname, request.method);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(request);
        const account = requiredString(body, "account");
        const plainPassword = requiredString(body, "password");

        const currentData = database.readData();
        const loginResult = await login(account, plainPassword, currentData.authUsers, currentData.systemConfigs);

        // Auto-migrate legacy plaintext password to bcrypt hash on successful login
        if (loginResult.needsPasswordMigration && loginResult.userIdNeedingMigration) {
          const currentData = database.readData();
          const hashed = await hashPassword(plainPassword);
          const migratedUsers = currentData.authUsers.map((u) =>
            u.id === loginResult.userIdNeedingMigration ? { ...u, password: hashed } : u
          );
          const migratedData = { ...currentData, authUsers: migratedUsers };
          database.replaceData(migratedData);
        }

        sendJson(response, 200, loginResult.session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/register-store") {
        const body = await readJson(request);
        const plainPassword = requiredString(body, "password");
        const hashedPassword = await hashPassword(plainPassword);

        const nextData = registerStore(database.readData(), {
          storeName: requiredString(body, "storeName"),
          ownerName: requiredStringAny(body, ["ownerName", "name"]),
          phone: requiredString(body, "phone"),
          address: optionalString(body, "address"),
          account: requiredString(body, "account"),
          password: hashedPassword,
        });
        database.replaceData(nextData);

        // New registration is always hashed, no legacy migration needed
        const loginResult = await login(requiredString(body, "account"), plainPassword, nextData.authUsers);
        sendJson(response, 201, loginResult.session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/join-invite") {
        const body = await readJson(request);
        const plainPassword = requiredString(body, "password");
        const hashedPassword = await hashPassword(plainPassword);
        const inviteCode = requiredString(body, "inviteCode");

        const currentData = database.readData();
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
        database.replaceData(nextData);

        if (isStoreOwnerInvite) {
          const account = optionalString(body, "account");
          const application = [...(nextData.storeOwnerApplications ?? [])].find((item) => {
            if (item.status !== "待审批") return false;
            if (item.inviteCode.trim().toUpperCase() !== inviteCode.trim().toUpperCase()) return false;
            return account ? item.account === account : true;
          });
          sendJson(response, 202, {
            status: "pending_approval",
            message: "门店申请已提交，请等待管理员审批后再登录。",
            applicationId: application?.id,
          });
          return;
        }

        const staffInvite = currentData.staffInvites.find((item) => item.inviteCode.trim().toUpperCase() === inviteCode.trim().toUpperCase());
        const joinedAccount = staffInvite?.account ?? (isStoreStaffInviteCode(currentData, inviteCode) ? optionalString(body, "account") : undefined);
        if (!joinedAccount) throw new Error("邀请账号不存在");
        sendJson(response, 202, {
          status: "pending_approval",
          message: "账号已提交，请等待店长审核通过后再登录。",
        });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/public/store/")) {
        const shareCode = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        sendJson(response, 200, publicStorePayload(database.readData(), shareCode));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/public/online-booking-requests") {
        const body = await readJson(request);
        const requestedData = createOnlineBookingRequest(database.readData(), {
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
        database.replaceData(nextData);
        sendJson(response, 201, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/public/customer-signatures/")) {
        const token = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        sendJson(response, 200, publicSignaturePayload(database.readData(), token));
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/public/customer-signatures/") && url.pathname.endsWith("/sign")) {
        const token = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = signCustomerSignature(database.readData(), {
          token,
          signerName: requiredString(body, "signerName"),
          signatureText: requiredString(body, "signatureText"),
        });
        database.replaceData(nextData);
        sendJson(response, 201, publicSignaturePayload(nextData, token));
        return;
      }

      let session = getSession(request.headers.authorization);
      if (!session) {
        sendJson(response, 401, { error: "请先登录" });
        return;
      }
      session = normalizeUserSession(session, database.readData().systemConfigs);

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        sendJson(response, 200, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/account-avatar") {
        sendJson(response, 200, await saveLocalAccountAvatar(request, session.user.id));
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/account-profile") {
        const body = await readJson(request);
        const updatedData = updateAccountProfile(database.readData(), {
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
        persistData(database, session, nextData);
        const updatedUser = nextData.authUsers.find((user) => user.id === session.user.id);
        if (!updatedUser) throw new Error("账号不存在");
        const nextSession = refreshSessionUser(session.token, updatedUser, nextData.systemConfigs);
        sendJson(response, 200, { session: nextSession, data: scopeDataForSession(nextData, nextSession) });
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/auth-users/") && url.pathname.endsWith("/status")) {
        requirePermission(session, "staff:manage");
        const userId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        assertCanManageAuthUser(currentData, session, userId);
        const nextData = updateAuthUserStatus(currentData, {
          userId,
          status: requiredString(body, "status") as "active" | "disabled" | "pending",
          operatedBy: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/auth-users/") && url.pathname.endsWith("/password")) {
        requirePermission(session, "staff:manage");
        const userId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        assertCanManageAuthUser(currentData, session, userId);
        const nextData = resetAuthUserPassword(currentData, {
          userId,
          password: await hashPassword(requiredString(body, "password")),
          operatedBy: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/auth-users/") && url.pathname.endsWith("/ai-credits")) {
        if (session.user.role !== "superadmin") throw new Error("只有系统管理员可以调整 AI 积分");
        const userId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = updateAuthUserAiCredits(currentData, {
          userId,
          credits: optionalNumber(body, "credits") ?? 0,
          operatedBy: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/data") {
        requirePermission(session, "dashboard:view");
        sendScopedData(request, response, 200, readDataForRequest(database, request, session), session);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/usage/r2") {
        requirePermission(session, "settings:view");
        sendJson(response, 200, await readLocalR2Usage());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/usage/worker") {
        requirePermission(session, "settings:view");
        sendJson(response, 200, await readLocalWorkerUsage());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/data-quality") {
        requirePermission(session, "settings:view");
        sendJson(response, 200, previewFormalDataCleanup(database.readData()));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/marketing-ai/analyze-product-image") {
        requirePermission(session, "marketing:manage");
        const currentData = database.readData();
        assertMarketingAiAllowed(currentData, session, "video");
        sendJson(response, 200, await runMarketingProductImageAnalysis(currentData, await readJson(request)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/marketing-ai/generate") {
        requirePermission(session, "marketing:manage");
        const body = await readJson(request);
        const kind = requiredString(body, "kind") as MarketingAiKind;
        const startedAt = Date.now();
        const currentData = database.readData();
        assertMarketingAiGeneratePreflight(currentData, session, kind);
        const locks = database.acquireAiGenerationLocks({
          ownerId: session.user.id,
          kind,
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + aiImageGenerationLockTtlMs).toISOString(),
          maxGlobalSlots: aiImageGenerationMaxGlobalSlots,
        });
        let pendingRecord: MarketingAiRecord | undefined;
        try {
          pendingRecord = marketingAiRecord(currentData, session, body, {
            kind,
            ...marketingAiPendingProvider(currentData, kind, body),
            status: "生成中",
          });
          database.upsertMarketingAiRecord(pendingRecord);
          const result = await runMarketingAiGenerate(currentData, session, body);
          const record = {
            ...marketingAiRecord(currentData, session, body, { ...result, status: "已完成" }),
            id: pendingRecord.id,
            createdAt: pendingRecord.createdAt,
          };
          database.appendMarketingAiResult({
            record,
            log: marketingAiOperationLog(session, record),
            consumeCreditUserId: result.billing?.source === "credit" ? session.user.id : undefined,
            consumeCreditAmount: result.billing?.source === "credit" ? result.billing.creditsCharged : undefined,
          });
          sendJson(response, 200, { ...result, record });
          return;
        } catch (error) {
          if (!pendingRecord) throw error;
          const currentData = database.readData();
          const message = error instanceof Error ? error.message : "AI 生成失败";
          const failureCost = marketingAiFailureCost(currentData, body, kind, error);
          const failureRecord = marketingAiRecord(currentData, session, body, {
            kind,
            ...marketingAiPendingProvider(currentData, kind, body),
            text: message,
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
          database.appendMarketingAiResult({
            record: failureRecord,
            log: marketingAiOperationLog(session, failureRecord),
          });
          sendJson(response, 200, {
            kind,
            provider: failureRecord.provider,
            model: failureRecord.model,
            text: message,
            status: "生成失败",
            errorMessage: message,
            cost: failureRecord.cost,
            elapsedMs: failureRecord.elapsedMs,
            record: failureRecord,
          });
          return;
        } finally {
          if (locks) database.releaseAiGenerationLocks(locks);
        }
      }

      if (request.method === "POST" && url.pathname === "/api/data-quality/cleanup") {
        requirePermission(session, "settings:view");
        if (session.user.role !== "owner") {
          sendJson(response, 403, { error: "当前账号无权限清理正式库数据" });
          return;
        }
        const body = await readJson(request);
        if (requiredString(body, "confirm") !== "清理非正式数据") {
          sendJson(response, 400, { error: "确认短语不正确" });
          return;
        }
        const result = cleanupFormalData(database.readData());
        const nextData = addOperationLog(result.data, {
          userId: session.user.id,
          action: "清理非正式数据",
          targetType: "dataQuality",
          targetId: "formal-cleanup",
          summary: `${session.user.name} 清理巡检命中的非正式数据`,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/notifications/") && url.pathname.endsWith("/read")) {
        const notificationId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const nextData = markNotificationRead(database.readData(), { notificationId, userId: session.user.id });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/notifications/") && url.pathname.endsWith("/archive")) {
        const notificationId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const nextData = archiveNotification(database.readData(), { notificationId, userId: session.user.id });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/notifications/read-all") {
        const nextData = markAllVisibleNotificationsRead(database.readData(), {
          userId: session.user.id,
          role: session.user.role,
          staffId: session.user.staffId,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/system-configs/")) {
        if (session.user.role !== "superadmin") {
          throw new Error("只有平台 Admin 可以修改系统配置");
        }
        const key = decodeURIComponent(url.pathname.split("/").at(-1) ?? "") as SystemConfigKey;
        const body = await readJson(request);
        const nextData = updateData(
          database,
          session,
          {
            action: "更新系统配置",
            targetType: "systemConfig",
            targetId: key,
            summary: `${session.user.name} 更新系统配置 ${key}`,
          },
          (data) => updateSystemConfig(data, { key, value: requiredString(body, "value"), updatedBy: session.user.id }),
        );
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/stores/") && url.pathname.endsWith("/status")) {
        if (session.user.role !== "superadmin") {
          throw new Error("只有平台 Admin 可以管理门店状态");
        }
        const storeId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = updateStoreStatus(database.readData(), {
          storeId,
          status: requiredString(body, "status") as "active" | "disabled",
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/store-profile") {
        requirePermission(session, "settings:view");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/ai-usage-permissions") {
        requirePermission(session, "settings:view");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/operational-permissions") {
        requirePermission(session, "settings:view");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff") {
        requirePermission(session, "staff:manage");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/staff/")) {
        requirePermission(session, "staff:manage");
        const staffId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const nextData = addOperationLog(
          updateStaffMember(database.readData(), {
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "DELETE" && url.pathname.startsWith("/api/staff/")) {
        requirePermission(session, "staff:manage");
        const staffId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const currentData = database.readData();
        assertCanManageStaff(currentData, session, staffId);
        const nextData = deleteStaffMember(currentData, {
          staffId,
          operatedBy: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff-invites") {
        requirePermission(session, "staff:manage");
        const body = await readJson(request);
        const nextData = createStaffInvite(database.readData(), {
          staffId: requiredString(body, "staffId"),
          account: requiredString(body, "account"),
          role: requiredString(body, "role") as UserRole,
          createdBy: session.user.id,
          validDays: optionalNumber(body, "validDays"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/store-owner-invites") {
        if (session.user.role !== "superadmin") {
          throw new Error("只有平台 Admin 可以邀请门店老板");
        }
        const body = await readJson(request);
        const nextData = createStoreOwnerInvite(database.readData(), {
          storeName: requiredString(body, "storeName"),
          ownerName: requiredString(body, "ownerName"),
          phone: requiredString(body, "phone"),
          address: optionalString(body, "address"),
          account: requiredString(body, "account"),
          createdBy: session.user.id,
          validDays: optionalNumber(body, "validDays"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/store-owner-applications/")) {
        if (session.user.role !== "superadmin") {
          throw new Error("只有平台 Admin 可以审批门店申请");
        }
        const applicationId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const nextData = decideStoreOwnerApplication(database.readData(), {
          applicationId,
          userId: session.user.id,
          approved: optionalBoolean(body, "approved") ?? true,
          rejectReason: optionalString(body, "rejectReason"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/staff-invites/")) {
        requirePermission(session, "staff:manage");
        const inviteId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const nextData = revokeStaffInvite(database.readData(), {
          inviteId,
          revokedBy: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/online-storefront") {
        requirePermission(session, "settings:view");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checkout") {
        requirePermission(session, "pos:manage");
        const body = await readJson(request);
        const checkoutRequestId = optionalString(body, "checkoutRequestId");
        const currentData = database.readData();
        const checkedOutData = checkoutOrder(currentData, {
          storeId: sessionStoreId(currentData, session),
          customerId: optionalString(body, "customerId"),
          guestName: optionalString(body, "guestName"),
          guestPhone: optionalString(body, "guestPhone"),
          staffId: requiredString(body, "staffId"),
          collaboratorStaffIds: optionalStringArray(body, "collaboratorStaffIds"),
          serviceId: optionalString(body, "serviceId"),
          serviceIds: optionalStringArray(body, "serviceIds"),
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
        if (checkoutRequestId && !database.reserveCheckoutSubmission(checkoutRequestId, nowIso())) {
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/refund")) {
        requirePermission(session, "pos:manage");
        const orderId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = refundOrder(currentData, {
          storeId: sessionStoreId(currentData, session),
          orderId,
          reason: optionalString(body, "reason") ?? "门店退款",
          userId: session.user.id,
          amount: optionalNumber(body, "amount"),
          approvalId: optionalString(body, "approvalId"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/inventory/adjust") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/appointments") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const requestedStaffId = requiredString(body, "staffId");
        const baseData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff-unavailable-slots") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = createStaffUnavailableSlot(currentData, {
          storeId: sessionStoreId(currentData, session),
          staffId: requiredString(body, "staffId"),
          startAt: requiredString(body, "startAt"),
          endAt: requiredString(body, "endAt"),
          reason: optionalString(body, "reason") ?? "不可预约",
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff-shifts") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = createStaffShift(currentData, {
          storeId: sessionStoreId(currentData, session),
          staffId: requiredString(body, "staffId"),
          startAt: requiredString(body, "startAt"),
          endAt: requiredString(body, "endAt"),
          note: optionalString(body, "note") ?? "门店班次",
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/appointments/") && url.pathname.endsWith("/reschedule")) {
        requirePermission(session, "appointments:manage");
        const appointmentId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const requestedStaffId = optionalString(body, "staffId");
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/appointments/")) {
        requirePermission(session, "appointments:manage");
        const appointmentId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const status = requiredString(body, "status") as Appointment["status"];
        const nextData = updateData(database, session, {
          action: "更新预约状态",
          targetType: "appointment",
          targetId: appointmentId,
          summary: `${session.user.name} 将预约状态改为 ${status}`,
        }, (data) => updateAppointmentStatus(data, { appointmentId, status, reason: optionalString(body, "reason") }));
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/online-booking-requests/") && url.pathname.endsWith("/convert")) {
        requirePermission(session, "appointments:manage");
        const requestId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = convertOnlineBookingRequest(database.readData(), {
          requestId,
          staffId: requiredString(body, "staffId"),
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/customers") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const customerPhone = requireMobilePhone(requiredString(body, "phone"));
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/customers/")) {
        requirePermission(session, "customers:manage");
        const customerId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const currentCustomer = currentData.customers.find((customer) => customer.id === customerId);
        if (!currentCustomer) throw new Error("客户不存在");
        const rawPhone = optionalString(body, "phone");
        const nextPhone = rawPhone === undefined ? undefined : requireMobilePhone(rawPhone);
        const summary = customerUpdateSummary(session.user.name, currentCustomer, body);
        const nextData = updateData(database, session, {
          action: "更新客户资料",
          targetType: "customer",
          targetId: customerId,
          summary,
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/tags") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/tags/")) {
        requirePermission(session, "customers:manage");
        const tagId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/member-cards") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/member-cards/") && url.pathname.endsWith("/refund")) {
        requirePermission(session, "customers:manage");
        const memberCardId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = refundMemberCard(database.readData(), {
          memberCardId,
          reason: optionalString(body, "reason") ?? "客户退卡",
          refundAmount: optionalNumber(body, "refundAmount"),
          payMethod: optionalString(body, "payMethod") as CashPayMethod | undefined,
          signatureId: requiredString(body, "signatureId"),
          userId: session.user.id,
          staffId: session.user.staffId,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/member-cards/") && url.pathname.endsWith("/recharge")) {
        requirePermission(session, "customers:manage");
        const memberCardId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = rechargeMemberCard(database.readData(), {
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/member-cards/") && url.pathname.endsWith("/status")) {
        requirePermission(session, "customers:manage");
        const memberCardId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = updateMemberCardStatus(database.readData(), {
          memberCardId,
          status: requiredString(body, "status") as "正常" | "冻结",
          reason: optionalString(body, "reason") ?? "门店操作",
          userId: session.user.id,
          staffId: session.user.staffId,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/member-cards/") && url.pathname.endsWith("/extend")) {
        requirePermission(session, "customers:manage");
        const memberCardId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = extendMemberCard(database.readData(), {
          memberCardId,
          expiresAt: requiredString(body, "expiresAt"),
          reason: optionalString(body, "reason") ?? "会员卡延期",
          userId: session.user.id,
          staffId: session.user.staffId,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/member-cards/") && url.pathname.endsWith("/transfer")) {
        requirePermission(session, "customers:manage");
        const memberCardId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = transferMemberCard(database.readData(), {
          memberCardId,
          toCustomerId: requiredString(body, "toCustomerId"),
          reason: optionalString(body, "reason") ?? "会员转卡",
          userId: session.user.id,
          staffId: session.user.staffId,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approvals") {
        requirePermission(session, "pos:manage");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/approvals/")) {
        requirePermission(session, "approvals:manage");
        const approvalId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const nextData = decideApprovalRequest(database.readData(), {
          approvalId,
          userId: session.user.id,
          approved: optionalBoolean(body, "approved") ?? true,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/service-records") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const recordData = addCustomerServiceRecord(database.readData(), {
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/customer-signatures") {
        requireAnyPermission(session, ["customers:manage", "pos:manage"]);
        const body = await readJson(request);
        const nextData = createCustomerSignature(database.readData(), {
          customerId: requiredString(body, "customerId"),
          serviceRecordId: optionalString(body, "serviceRecordId"),
          orderId: optionalString(body, "orderId"),
          title: optionalString(body, "title"),
          content: optionalString(body, "content"),
          requestedBy: session.user.id,
          validDays: optionalNumber(body, "validDays"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/customer-signatures/") && url.pathname.endsWith("/sign")) {
        requireAnyPermission(session, ["customers:manage", "pos:manage"]);
        const signatureId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const signature = currentData.customerSignatures.find((item) => item.id === signatureId);
        if (!signature) throw new Error("签名记录不存在");
        const nextData = signCustomerSignature(currentData, {
          token: signature.token,
          signerName: requiredString(body, "signerName"),
          signatureText: requiredString(body, "signatureText"),
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/follow-ups") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = addCustomerFollowUp(database.readData(), {
          customerId: requiredString(body, "customerId"),
          staffId: requiredString(body, "staffId"),
          dueAt: requiredString(body, "dueAt"),
          method: requiredString(body, "method") as "电话" | "微信" | "到店",
          note: optionalString(body, "note") ?? "",
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/follow-ups/")) {
        requirePermission(session, "customers:manage");
        const followUpId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
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
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/services") {
        requirePermission(session, "catalog:manage");
        const body = await readJson(request);
        const consumables = optionalConsumables(body);
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/services/") && url.pathname.endsWith("/consumables")) {
        requirePermission(session, "catalog:manage");
        const serviceId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const consumables = optionalConsumables(body);
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/services/")) {
        requirePermission(session, "catalog:manage");
        const serviceId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const service = currentData.services.find((item) => item.id === serviceId);
        if (!service) throw new Error("服务项目不存在");
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/products") {
        requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
        const body = await readJson(request);
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
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/products/")) {
        requireAnyPermission(session, ["catalog:manage", "inventory:manage"]);
        const productId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const body = await readJson(request);
        const currentData = database.readData();
        const product = currentData.products.find((item) => item.id === productId);
        if (!product) throw new Error("商品不存在");
        const nextData = updateData(database, session, {
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
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/suppliers") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = addSupplier(currentData, {
          storeId: sessionStoreId(currentData, session),
          name: requiredString(body, "name"),
          phone: optionalString(body, "phone") ?? "",
          contact: optionalString(body, "contact") ?? "",
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/purchase-orders") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = receivePurchaseOrder(currentData, {
          storeId: sessionStoreId(currentData, session),
          supplierId: requiredString(body, "supplierId"),
          productId: requiredString(body, "productId"),
          quantity: requiredNumber(body, "quantity"),
          unitCost: requiredNumber(body, "unitCost"),
          expiryAt: optionalString(body, "expiryAt"),
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/inventory/restock-low") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = restockLowInventory(currentData, {
          storeId: sessionStoreId(currentData, session),
          supplierId: optionalString(body, "supplierId"),
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/stocktakes") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = createStocktake(currentData, {
          storeId: sessionStoreId(currentData, session),
          productId: requiredString(body, "productId"),
          actualStock: requiredNumber(body, "actualStock"),
          reason: optionalString(body, "reason") ?? "库存盘点",
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/commissions/settle") {
        requirePermission(session, "commissions:settle");
        const nextData = updateData(database, session, {
          action: "结算提成",
          targetType: "commission",
          targetId: "all",
          summary: `${session.user.name} 结算全部待结算提成`,
        }, (data) => settleCommissions(data, { userId: session.user.id }));
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-close") {
        requirePermission(session, "reports:view");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = createDailyClose(currentData, {
          storeId: sessionStoreId(currentData, session),
          businessDate: optionalString(body, "businessDate") ?? new Date().toISOString().slice(0, 10),
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-close/reverse") {
        requirePermission(session, "reports:view");
        const body = await readJson(request);
        const currentData = database.readData();
        const nextData = reverseDailyClose(currentData, {
          storeId: sessionStoreId(currentData, session),
          businessDate: requiredString(body, "businessDate"),
          userId: session.user.id,
        });
        persistData(database, session, nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(response, 400, { error: message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  createApiServer().listen(port, () => {
    console.log(`Zhurong Kunfeng system API listening on http://localhost:${port}`);
  });
}

function updateData(
  database: BeautyDatabase,
  session: UserSession,
  log: { action: string; targetType: string; targetId: string; summary: string },
  updater: (data: AppData) => AppData,
) {
  const nextData = addOperationLog(updater(database.readData()), { userId: session.user.id, ...log });
  persistData(database, session, nextData);
  return nextData;
}

function persistData(database: BeautyDatabase, session: UserSession, nextData: AppData) {
  if (session.user.role !== "superadmin" && session.user.storeId) {
    database.replaceStoreData(session.user.storeId, nextData);
    return;
  }
  database.replaceData(nextData);
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

function isStoreOwnerInviteCode(data: AppData, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  return Boolean(platformInviteIssuerId(data, normalizedInviteCode))
    || (data.storeOwnerInvites ?? []).some((item) => item.inviteCode.trim().toUpperCase() === normalizedInviteCode && item.status === "待加入");
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

async function serveLocalAsset(response: ServerResponse, pathname: string, method = "GET") {
  const key = assetKeyFromPath(pathname);
  const filePath = localAssetPath(key);
  try {
    const buffer = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeForAsset(key),
      "Content-Disposition": `inline; filename="${encodeURIComponent(key.split("/").at(-1) ?? "poster.png")}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(method === "HEAD" ? undefined : buffer);
  } catch {
    sendJson(response, 404, { error: "资源不存在" });
  }
}

async function saveLocalAccountAvatar(request: IncomingMessage, userId: string) {
  const upload = await parseAvatarUpload(request);
  if (upload.buffer.length > 1_200_000) throw new Error("头像文件过大，请重新上传头像");

  const key = `avatars/${userId}/${Date.now()}-${makeId("img")}.${upload.extension}`;
  const filePath = localAssetPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, upload.buffer);

  return {
    key,
    avatarUrl: assetUrlForKey(key),
    size: upload.buffer.length,
  };
}

async function readLocalR2Usage(): Promise<R2UsageSnapshot> {
  const limitBytes = 10 * 1024 * 1024 * 1024;
  const prefixMap = new Map<string, { objectCount: number; bytes: number }>();
  let objectCount = 0;
  let totalBytes = 0;

  const files = await listLocalAssetFiles(LOCAL_ASSET_ROOT);
  for (const filePath of files) {
    const relativePath = path.relative(LOCAL_ASSET_ROOT, filePath).split(path.sep).join("/");
    const info = await stat(filePath);
    const prefix = relativePath.includes("/") ? `${relativePath.split("/")[0]}/` : "(根目录)";
    const current = prefixMap.get(prefix) ?? { objectCount: 0, bytes: 0 };
    current.objectCount += 1;
    current.bytes += info.size;
    prefixMap.set(prefix, current);
    objectCount += 1;
    totalBytes += info.size;
  }

  return {
    available: true,
    source: "r2-binding",
    bucketName: "local-dev-assets",
    objectCount,
    totalBytes,
    limitBytes,
    prefixes: Array.from(prefixMap, ([prefix, value]) => ({ prefix, ...value })).sort((a, b) => b.bytes - a.bytes),
    updatedAt: nowIso(),
  };
}

async function readLocalWorkerUsage(): Promise<WorkerUsageSnapshot> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const scriptName = process.env.CLOUDFLARE_WORKER_SCRIPT_NAME?.trim();
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
    ? "真人自然手持或近景展示"
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

function marketingImageSize(posterSize: string | undefined) {
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
    const posterTitle = marketingCompliantText(body.posterTitle, "到店护理礼遇");
    const posterOffer = marketingCompliantText(body.posterOffer, "限时体验价");
    const assets = marketingImageAssets(body);
    const assetSummary = assets.length ? assets.map((asset) => `${asset.label}：${asset.name}`).join("；") : "未上传素材";
    return `基于用户上传的产品图、模特图或门店图，生成一张可直接用于美业门店发布的高端中文产品设计图。主题：${posterTitle}。行动信息：${posterOffer}。门店：${storeName}。项目：${serviceName}。商品：${productName}。尺寸用途：${posterSize}。${nodeContext}参考素材：${assetSummary}。素材使用要求：保留上传产品的外观、包装、颜色和关键卖点；如果有模特图，保持人物自然真实，不改变身份特征；如果有门店图，延续门店环境质感。视觉要求：真实高级美业/东方美学商业产品设计图，不要廉价模板，不要卡通，不要网页 UI 截图，不要水印；画面要有真实质感的护理环境、草本元素、温润水疗、护肤产品或干净门店场景，留出清晰文字安全区；中文文字只保留一个主标题和一行短副标题，标题控制在 4 到 8 个汉字，不要生成长段小字，不要出现“标题备选”“占位”“示例”等字样；排版克制、留白高级、手机端一眼能看懂；${compliance}`;
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
  database: BeautyDatabase,
  session: UserSession,
  body: JsonBody,
  kind: MarketingAiKind,
  pendingRecord: MarketingAiRecord,
  locks: { accountLockId?: string; globalLockId?: string },
  startedAt: number,
) {
  try {
    const currentData = database.readData();
    const result = await runMarketingAiGenerate(currentData, session, body);
    const record = {
      ...marketingAiRecord(currentData, session, body, { ...result, status: "已完成" }),
      id: pendingRecord.id,
      createdAt: pendingRecord.createdAt,
    };
    database.appendMarketingAiResult({
      record,
      log: marketingAiOperationLog(session, record),
      consumeCreditUserId: result.billing?.source === "credit" ? session.user.id : undefined,
      consumeCreditAmount: result.billing?.source === "credit" ? result.billing.creditsCharged : undefined,
    });
  } catch (error) {
    const currentData = database.readData();
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
    database.appendMarketingAiResult({
      record: failureRecord,
      log: marketingAiOperationLog(session, failureRecord),
    });
  } finally {
    database.releaseAiGenerationLocks(locks);
  }
}

async function runMarketingAiGenerate(data: AppData, session: UserSession, body: JsonBody) {
  const kind = requiredString(body, "kind") as MarketingAiKind;
  if (!["copy", "image", "video", "talk"].includes(kind)) throw new Error("AI 营销类型不正确");
  const requestedCopyOutputMode = optionalString(body, "copyOutputMode");
  const copyOutputMode = requestedCopyOutputMode === "text" || requestedCopyOutputMode === "image" ? requestedCopyOutputMode : "poster";
  const capability: AiUsageCapability = kind === "image" ? "image" : kind === "video" ? "video" : "copy";
  assertMarketingAiAllowed(data, session, capability);
  const quotaState = assertAiFreeQuotaAvailable(data, session.user.id);
  const prompt = marketingPrompt(body, kind);
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
      prompt: marketingCopyPosterPrompt(body, safeText),
      size: marketingImageSize(optionalString(body, "posterSize")),
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
    const result = await runAiImageTest(data, { prompt, size: marketingImageSize(optionalString(body, "posterSize")) });
    const imageCost = result.cost ?? imageGenerationCost(config, result.usage);
    const billing = aiBillingForCost(quotaState, imageCost);
    return { kind, provider: result.provider, model: result.model, imageDataUrl: result.imageDataUrl, revisedPrompt: result.revisedPrompt, usage: result.usage, cost: imageCost, costBreakdown: aiCostBreakdown({ image: imageCost }), elapsedMs: result.elapsedMs, billing };
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
  const message = error instanceof Error ? error.message : "";
  const requestedCopyOutputMode = optionalString(body, "copyOutputMode");
  const copyOutputMode = requestedCopyOutputMode === "text" || requestedCopyOutputMode === "image" ? requestedCopyOutputMode : "poster";
  if (kind === "copy" && copyOutputMode === "text") return undefined;
  if (kind !== "image" && !(kind === "copy" && message.includes("OpenAI"))) return undefined;
  const config = aiGenerationConfigFromData(data).image;
  const prompt = kind === "image"
    ? marketingPrompt(body, "image")
    : marketingCopyPosterPrompt(body, marketingPrompt(body, "copy"));
  const assetCount = (() => {
    try {
      return marketingImageAssets(body).length;
    } catch {
      return 0;
    }
  })();
  return estimatedImageGenerationCost(config, {
    prompt,
    size: marketingImageSize(optionalString(body, "posterSize")),
    quality: config.defaultQuality,
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
  taskId?: string;
  status?: string;
  errorMessage?: string;
  elapsedMs?: number;
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
  return {
    id: makeId("mar"),
    storeId: sessionStoreId(data, session),
    kind: result.kind,
    title,
    channel: safeOptional("channel"),
    marketingNode: safeOptional("marketingNode"),
    customerType: safeOptional("customerType"),
    lifecycleNode: safeOptional("lifecycleNode"),
    bodyState: safeOptional("bodyState"),
    marketingGoal: safeOptional("marketingGoal"),
    serviceName: safeOptional("serviceName"),
    productName: safeOptional("productName"),
    text: result.text ? marketingCompliantText(result.text, "", 6000) : result.text,
    imageDataUrl: result.imageDataUrl,
    videoUrl: result.videoUrl,
    taskId: result.taskId,
    status: result.status,
    errorMessage: result.errorMessage,
    elapsedMs: result.elapsedMs,
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
  if (activeProvider.provider === "kling") {
    return createKlingVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
  }
  return createSeedanceVideoTask(activeProvider, prompt, durationSeconds, resolution, aspectRatio, assets);
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

async function createHailuoVideoTask(config: AiVideoProviderConfig, prompt: string, durationSeconds: number, resolution: AiVideoResolution, aspectRatio: AiVideoAspectRatio, assets: MarketingImageAsset[] = []) {
  const normalizedDuration = durationSeconds >= 10 ? 10 : 6;
  const normalizedResolution = resolution === "1080p" && normalizedDuration === 6 ? "1080P" : "768P";
  const firstAsset = assets[0];
  const normalizedRequest = { duration: normalizedDuration, resolution: normalizedResolution, aspectRatio, referenceImages: assets.map((asset) => asset.label) };
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
      ...(firstAsset ? { first_frame_image: firstAsset.dataUrl } : {}),
    }),
  });
  return videoResult(config, elapsedMs, payload, {
    taskId: readFirstString(payload, ["task_id", "taskId", "id"]),
    status: readFirstString(payload, ["status"]),
    normalizedRequest,
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

async function listLocalAssetFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listLocalAssetFiles(entryPath) : Promise.resolve([entryPath]);
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

async function parseAvatarUpload(request: IncomingMessage): Promise<LocalAvatarUpload> {
  const contentType = request.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] ?? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("请选择头像图片");

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${boundary}`);
  let offset = 0;
  while (offset < body.length) {
    const partStart = body.indexOf(delimiter, offset);
    if (partStart === -1) break;
    const headerStart = partStart + delimiter.length + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;

    const header = body.subarray(headerStart, headerEnd).toString("utf-8");
    const nextPart = body.indexOf(delimiter, headerEnd + 4);
    if (nextPart === -1) break;
    const content = body.subarray(headerEnd + 4, Math.max(headerEnd + 4, nextPart - 2));
    if (/name="avatar"/.test(header)) {
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() ?? "image/jpeg";
      if (!type.startsWith("image/")) throw new Error("请选择图片文件");
      return {
        buffer: content,
        contentType: type,
        extension: type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg",
      };
    }
    offset = nextPart;
  }

  throw new Error("请选择头像图片");
}

function localAssetPath(key: string) {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
  return path.join(LOCAL_ASSET_ROOT, normalized);
}

function assetKeyFromPath(pathname: string) {
  return decodeURIComponent(pathname.replace(/^\/api\/assets\//, ""));
}

function assetUrlForKey(key: string) {
  return `/api/assets/${encodeURIComponent(key).replaceAll("%2F", "/")}`;
}

function contentTypeForAsset(key: string) {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function readJson(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as JsonBody;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readDataForRequest(database: BeautyDatabase, request: IncomingMessage, session: UserSession) {
  if (!isSliceRequest(request)) return expireStaleMarketingAiRecords(database.readData());
  const requestedView = requestedDataView(request);
  if (!requestedView) return expireStaleMarketingAiRecords(database.readData());
  const data = session.user.role !== "superadmin" && session.user.storeId
    ? database.readDataTablesForStore(dataKeysForView(requestedView), session.user.storeId)
    : database.readDataTables(dataKeysForView(requestedView));
  return expireStaleMarketingAiRecords(data);
}

function sendScopedData(request: IncomingMessage, response: ServerResponse, statusCode: number, data: AppData, session: UserSession) {
  const scopedData = scopeDataForSession(data, session);
  if (isSliceRequest(request)) {
    const requestedView = requestedDataView(request);
    if (requestedView) {
      sendJson(response, statusCode, makeAppDataSlice(scopedData, requestedView));
      return;
    }
  }
  sendJson(response, statusCode, scopedData);
}

function isSliceRequest(request: IncomingMessage) {
  return request.headers["x-app-data-mode"] === "slice";
}

function requestedDataView(request: IncomingMessage) {
  const requestedView = stringHeader(request.headers["x-app-data-view"]) ?? new URL(request.url ?? "/", "http://localhost").searchParams.get("view");
  return isViewKey(requestedView) ? requestedView : undefined;
}

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-App-Data-Mode, X-App-Data-View, Cache-Control, Pragma");
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
