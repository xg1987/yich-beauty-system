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
  settleCommissions,
  updateAppointmentStatus,
  transferMemberCard,
  upsertOnlineStorefront,
  joinInviteByCode,
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
import { normalizeProductServiceUnitsPerStockUnit, productServiceStockDeductible, productServiceUnit } from "../src/domain/products";
import type { AppData, Appointment, CashPayMethod, CustomerSignature, InventoryLog, Order, R2UsageSnapshot, ServiceConsumable, SystemConfigKey, TagScope, UserRole, WorkerUsageSnapshot } from "../src/domain/types";
import type { CheckoutProductItemInput } from "../src/domain/business";
import { isViewKey, makeAppDataSlice } from "../src/domain/dataSlices";
import { makeId, nowIso } from "../src/domain/utils";
import { getSession, login, refreshSessionUser } from "./auth";
import { BeautyDatabase } from "./database";

type JsonBody = Record<string, unknown>;
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
        sendJson(response, 200, {
          ok: true,
          service: "yich-system-api",
          version: pkg.version,
        });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/assets/")) {
        await serveLocalAsset(response, url.pathname);
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
          ownerName: requiredString(body, "ownerName"),
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
          name: requiredString(body, "name"),
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
          message: "员工账号已提交，请等待店长审核通过后再登录。",
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
        database.replaceData(nextData);
        const updatedUser = nextData.authUsers.find((user) => user.id === session.user.id);
        if (!updatedUser) throw new Error("账号不存在");
        const nextSession = refreshSessionUser(session.token, updatedUser, nextData.systemConfigs);
        sendJson(response, 200, { session: nextSession, data: scopeDataForSession(nextData, nextSession) });
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/auth-users/") && url.pathname.endsWith("/status")) {
        if (session.user.role !== "superadmin") {
          throw new Error("只有平台 Admin 可以管理账号状态");
        }
        const userId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = updateAuthUserStatus(database.readData(), {
          userId,
          status: requiredString(body, "status") as "active" | "disabled",
          operatedBy: session.user.id,
        });
        database.replaceData(nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/data") {
        requirePermission(session, "dashboard:view");
        sendScopedData(request, response, 200, database.readData(), session);
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
        database.replaceData(nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/notifications/") && url.pathname.endsWith("/read")) {
        const notificationId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const nextData = markNotificationRead(database.readData(), { notificationId, userId: session.user.id });
        database.replaceData(nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/notifications/") && url.pathname.endsWith("/archive")) {
        const notificationId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const nextData = archiveNotification(database.readData(), { notificationId, userId: session.user.id });
        database.replaceData(nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/notifications/read-all") {
        const nextData = markAllVisibleNotificationsRead(database.readData(), {
          userId: session.user.id,
          role: session.user.role,
          staffId: session.user.staffId,
        });
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/appointments") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const appointedData = updateData(database, session, {
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/appointments/") && url.pathname.endsWith("/reschedule")) {
        requirePermission(session, "appointments:manage");
        const appointmentId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        database.replaceData(nextData);
        sendScopedData(request, response, 200, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/customers") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
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
              phone: requiredString(body, "phone"),
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
        const nextData = updateData(database, session, {
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
        database.replaceData(nextData);
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
          userId: session.user.id,
        });
        database.replaceData(nextData);
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
        });
        database.replaceData(nextData);
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
        });
        database.replaceData(nextData);
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
        });
        database.replaceData(nextData);
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
        });
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/customer-signatures") {
        requirePermission(session, "customers:manage");
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
        sendScopedData(request, response, 201, nextData, session);
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/follow-ups/")) {
        requirePermission(session, "customers:manage");
        const followUpId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const nextData = completeCustomerFollowUp(database.readData(), { followUpId });
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
        database.replaceData(nextData);
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
  database.replaceData(nextData);
  return nextData;
}

function sessionStoreId(data: AppData, session: UserSession) {
  return storeIdForUser(normalizeStoreScopedData(data), session.user);
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
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
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

async function serveLocalAsset(response: ServerResponse, pathname: string) {
  const key = assetKeyFromPath(pathname);
  const filePath = localAssetPath(key);
  try {
    const buffer = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeForAsset(key),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(buffer);
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

function sendScopedData(request: IncomingMessage, response: ServerResponse, statusCode: number, data: AppData, session: UserSession) {
  const scopedData = scopeDataForSession(data, session);
  if (request.headers["x-app-data-mode"] === "slice") {
    const requestedView = stringHeader(request.headers["x-app-data-view"]) ?? new URL(request.url ?? "/", "http://localhost").searchParams.get("view");
    if (isViewKey(requestedView)) {
      sendJson(response, statusCode, makeAppDataSlice(scopedData, requestedView));
      return;
    }
  }
  sendJson(response, statusCode, scopedData);
}

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-App-Data-Mode, X-App-Data-View");
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
