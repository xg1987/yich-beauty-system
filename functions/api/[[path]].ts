import {
  addOperationLog,
  addSystemNotification,
  addCustomerFollowUp,
  addCustomerServiceRecord,
  createCustomerSignature,
  signCustomerSignature,
  addStaffMember,
  addSupplier,
  accountForInvite,
  adjustInventory,
  bindReferralRelation,
  cleanupFormalData,
  convertOnlineBookingRequest,
  checkoutOrder,
  createAppointment,
  createOnlineBookingRequest,
  createApprovalRequest,
  createDistributor,
  createTagDefinition,
  createDailyClose,
  createStaffShift,
  createStaffUnavailableSlot,
  createStaffInvite,
  createStoreOwnerInvite,
  createStocktake,
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
  rescheduleAppointment,
  settleDistributionCommissions,
  settleCommissions,
  updateAppointmentStatus,
  transferMemberCard,
  upsertOnlineStorefront,
  joinInviteByCode,
  markAllVisibleNotificationsRead,
  markNotificationRead,
  previewFormalDataCleanup,
  updateTagDefinition,
  updateStaffMember,
  updateStoreProfile,
  updateMemberCardStatus,
} from "../../src/domain/business";
import { hashPassword } from "../../src/lib/password";

// Read version from package.json at runtime (works in Cloudflare Workers)
import pkg from "../../package.json" with { type: "json" };
import type { Permission, UserSession } from "../../src/domain/auth";
import type { AppData, Appointment, CustomerSignature, InventoryLog, Order, ServiceConsumable, TagScope, UserRole } from "../../src/domain/types";
import { makeId, nowIso } from "../../src/domain/utils";
import { D1BeautyDatabase } from "../../src/cloudflare/d1Database";
import { getSessionFromD1, loginWithD1 } from "../../src/cloudflare/auth";
import type { D1DatabaseBinding } from "../../src/cloudflare/d1Types";

type Env = {
  DB: D1DatabaseBinding;
};

type JsonBody = Record<string, unknown>;
type PagesFunction<Bindings> = (context: { request: Request; env: Bindings }) => Response | Promise<Response>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const database = new D1BeautyDatabase(context.env.DB);

  try {
    const corsResponse = handleCors(context.request);
    if (corsResponse) return corsResponse;

    await database.seedIfEmpty();

    const url = new URL(context.request.url);
    const pathname = url.pathname;

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

      const nextData = joinInviteByCode(await database.readData(), {
        inviteCode,
        name: requiredString(body, "name"),
        password: hashedPassword,
      });
      await database.replaceData(nextData);

      const joinedAccount = accountForInvite(nextData, inviteCode);
      if (!joinedAccount) throw new Error("邀请账号不存在");
      const loginResult = await loginWithD1(context.env.DB, joinedAccount, plainPassword);
      return sendJson(201, loginResult.session);
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

    if (context.request.method === "GET" && pathname === "/api/data") {
      requirePermission(session, "dashboard:view");
      return sendJson(200, scopeDataForSession(await database.readData(), session));
    }

    if (context.request.method === "GET" && pathname === "/api/data-quality") {
      requirePermission(session, "settings:view");
      return sendJson(200, previewFormalDataCleanup(await database.readData()));
    }

    if (context.request.method === "POST" && pathname === "/api/data-quality/cleanup") {
      requirePermission(session, "settings:view");
      if (session.user.role !== "owner") {
        return sendJson(403, { error: "只有老板账号可以清理正式库数据" });
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
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/read")) {
      const notificationId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const nextData = markNotificationRead(await database.readData(), { notificationId, userId: session.user.id });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/notifications/read-all") {
      const nextData = markAllVisibleNotificationsRead(await database.readData(), {
        userId: session.user.id,
        role: session.user.role,
        staffId: session.user.staffId,
      });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "PATCH" && pathname === "/api/store-profile") {
      requirePermission(session, "settings:view");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        updateStoreProfile(await database.readData(), {
          name: requiredString(body, "name"),
          phone: requiredString(body, "phone"),
          address: optionalString(body, "address") ?? "",
          businessHours: requiredString(body, "businessHours"),
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
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/staff") {
      requirePermission(session, "staff:manage");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        addStaffMember(await database.readData(), {
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/staff-invites/")) {
      requirePermission(session, "staff:manage");
      const inviteId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const nextData = revokeStaffInvite(await database.readData(), {
        inviteId,
        revokedBy: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
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
          shareCode: requiredString(body, "shareCode"),
          status: optionalString(body, "status") as "启用" | "停用" | undefined,
          headline: requiredString(body, "headline"),
          description: optionalString(body, "description") ?? "",
          enabledServiceIds: optionalStringArray(body, "enabledServiceIds") ?? [],
        }),
      );
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/checkout") {
      requirePermission(session, "pos:manage");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        checkoutOrder(await database.readData(), {
          customerId: requiredString(body, "customerId"),
          staffId: requiredString(body, "staffId"),
          collaboratorStaffIds: optionalStringArray(body, "collaboratorStaffIds"),
          serviceId: requiredString(body, "serviceId"),
          productId: optionalString(body, "productId"),
          discountAmount: optionalNumber(body, "discountAmount"),
          adjustmentReason: optionalString(body, "adjustmentReason"),
          approvalId: optionalString(body, "approvalId"),
          distributorId: optionalString(body, "distributorId"),
          appointmentId: optionalString(body, "appointmentId"),
          payMethod: requiredString(body, "payMethod") as Order["payMethod"],
          cardId: optionalString(body, "cardId"),
        }),
        {
          userId: session.user.id,
          action: "开单收银",
          targetType: "order",
          targetId: "latest",
          summary: `${session.user.name} 完成开单收银`,
        },
      );
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/orders/") && pathname.endsWith("/refund")) {
      requirePermission(session, "pos:manage");
      const orderId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = refundOrder(await database.readData(), {
        orderId,
        reason: optionalString(body, "reason") ?? "门店退款",
        userId: session.user.id,
        amount: optionalNumber(body, "amount"),
        approvalId: optionalString(body, "approvalId"),
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/inventory/adjust") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const adjustedData = addOperationLog(
        adjustInventory(await database.readData(), {
          productId: requiredString(body, "productId"),
          type: requiredString(body, "type") as InventoryLog["type"],
          quantity: requiredNumber(body, "quantity"),
          note: optionalString(body, "note"),
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
            audienceRoles: ["owner", "manager"],
          })
        : adjustedData;
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
          customerId: requiredString(body, "customerId"),
          staffId: requiredString(body, "staffId"),
          serviceId: requiredString(body, "serviceId"),
          startAt: requiredString(body, "startAt"),
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
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/staff-unavailable-slots") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const nextData = createStaffUnavailableSlot(await database.readData(), {
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        reason: optionalString(body, "reason") ?? "不可预约",
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/staff-shifts") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const nextData = createStaffShift(await database.readData(), {
        staffId: requiredString(body, "staffId"),
        startAt: requiredString(body, "startAt"),
        endAt: requiredString(body, "endAt"),
        note: optionalString(body, "note") ?? "门店班次",
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
          note: optionalString(body, "note"),
        }),
      );
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/member-cards") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const remainingTimes = optionalNumber(body, "remainingTimes") ?? 0;
      const serviceIds = optionalStringArray(body, "serviceIds") ?? [];
      const requestedType = optionalString(body, "type");
      const cardType = requestedType === "套餐卡" || requestedType === "次数卡" || requestedType === "储值卡"
        ? requestedType
        : remainingTimes > 0 && serviceIds.length > 1
          ? "套餐卡"
          : remainingTimes > 0
            ? "次数卡"
            : "储值卡";
      const balance = cardType === "储值卡" ? requiredNumber(body, "balance") : 0;
      const cardId = makeId("m");
      const createdAt = nowIso();
      const nextData = updateData(await database.readData(), session, {
        action: "开卡",
        targetType: "memberCard",
        targetId: cardId,
        summary: `${session.user.name} 为客户开卡 ${requiredString(body, "name")}`,
      }, (data) => ({
        ...data,
        memberCards: [
          {
            id: cardId,
            customerId: requiredString(body, "customerId"),
            name: requiredString(body, "name"),
            type: cardType,
            balance,
            remainingTimes,
            expiresAt: optionalString(body, "expiresAt") ?? "2027-12-31",
            status: "正常",
            serviceId: cardType === "次数卡" ? optionalString(body, "serviceId") : undefined,
            serviceIds: cardType === "套餐卡" ? serviceIds : undefined,
          },
          ...data.memberCards,
        ],
        memberCardTransactions: [
          {
            id: makeId("mt"),
            memberCardId: cardId,
            type: "开卡",
            amountDelta: balance,
            timesDelta: remainingTimes,
            balanceAfter: balance,
            remainingTimesAfter: remainingTimes,
            note: requiredString(body, "name"),
            createdAt,
          },
          ...data.memberCardTransactions,
        ],
      }));
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
        note: optionalString(body, "note"),
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/approvals") {
      requirePermission(session, "pos:manage");
      const body = await readJson(context.request);
      const approvalData = createApprovalRequest(await database.readData(), {
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
        audienceRoles: ["owner", "manager", "finance"],
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/follow-ups/")) {
      requirePermission(session, "customers:manage");
      const followUpId = decodeURIComponent(pathname.split("/").at(-1) ?? "");
      const nextData = completeCustomerFollowUp(await database.readData(), { followUpId });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname.startsWith("/api/member-cards/") && pathname.endsWith("/refund")) {
      requirePermission(session, "customers:manage");
      const memberCardId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const nextData = refundMemberCard(await database.readData(), {
        memberCardId,
        reason: optionalString(body, "reason") ?? "客户退卡",
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
        consumables.forEach((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId && candidate.type === "consumable");
          if (!product) throw new Error("耗材不存在");
        });
        return {
          ...data,
          services: [
            {
              id: makeId("v"),
              name: requiredString(body, "name"),
              category: optionalString(body, "category") ?? "自定义项目",
              price: requiredNumber(body, "price"),
              duration: optionalNumber(body, "duration") ?? 60,
              consumables,
              consumableProductId: consumables[0]?.productId ?? optionalString(body, "consumableProductId"),
              consumableQty: consumables[0]?.quantity ?? optionalNumber(body, "consumableQty"),
            },
            ...data.services,
          ],
        };
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "PATCH" && pathname.startsWith("/api/services/") && pathname.endsWith("/consumables")) {
      requirePermission(session, "catalog:manage");
      const serviceId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
      const body = await readJson(context.request);
      const consumables = optionalConsumables(body);
      if (consumables.length === 0) throw new Error("至少配置一个耗材");
      const nextData = updateData(await database.readData(), session, {
        action: "更新项目配方",
        targetType: "service",
        targetId: serviceId,
        summary: `${session.user.name} 更新项目耗材配方`,
      }, (data) => {
        if (!data.services.some((service) => service.id === serviceId)) throw new Error("服务项目不存在");
        consumables.forEach((item) => {
          const product = data.products.find((candidate) => candidate.id === item.productId && candidate.type === "consumable");
          if (!product) throw new Error("耗材不存在");
        });
        return {
          ...data,
          services: data.services.map((service) =>
            service.id === serviceId
              ? {
                  ...service,
                  consumables,
                  consumableProductId: consumables[0]?.productId,
                  consumableQty: consumables[0]?.quantity,
                }
              : service,
          ),
        };
      });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/products") {
      requirePermission(session, "catalog:manage");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
        action: "新增商品耗材",
        targetType: "product",
        targetId: "latest",
        summary: `${session.user.name} 新增商品/耗材 ${requiredString(body, "name")}`,
      }, (data) => ({
        ...data,
        products: [
          {
            id: makeId("p"),
            name: requiredString(body, "name"),
            type: optionalString(body, "type") === "sale" ? "sale" : "consumable",
            unit: optionalString(body, "unit") ?? "件",
            price: optionalNumber(body, "price") ?? 0,
            cost: optionalNumber(body, "cost") ?? 0,
            stock: requiredNumber(body, "stock"),
            warningStock: optionalNumber(body, "warningStock") ?? 5,
          },
          ...data.products,
        ],
      }));
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/suppliers") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const nextData = addSupplier(await database.readData(), {
        name: requiredString(body, "name"),
        phone: optionalString(body, "phone") ?? "",
        contact: optionalString(body, "contact") ?? "",
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/purchase-orders") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const nextData = receivePurchaseOrder(await database.readData(), {
        supplierId: requiredString(body, "supplierId"),
        productId: requiredString(body, "productId"),
        quantity: requiredNumber(body, "quantity"),
        unitCost: requiredNumber(body, "unitCost"),
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/stocktakes") {
      requirePermission(session, "inventory:manage");
      const body = await readJson(context.request);
      const nextData = createStocktake(await database.readData(), {
        productId: requiredString(body, "productId"),
        actualStock: requiredNumber(body, "actualStock"),
        reason: optionalString(body, "reason") ?? "库存盘点",
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/distributors") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
        action: "新增分销员",
        targetType: "distributor",
        targetId: "latest",
        summary: `${session.user.name} 新增分销员`,
      }, (data) =>
        createDistributor(data, {
          type: requiredString(body, "type") as "客户" | "员工",
          customerId: optionalString(body, "customerId"),
          staffId: optionalString(body, "staffId"),
          name: optionalString(body, "name"),
          phone: optionalString(body, "phone"),
          rate: requiredNumber(body, "rate"),
        }),
      );
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/referral-relations") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
        action: "绑定分销客户",
        targetType: "referral",
        targetId: requiredString(body, "customerId"),
        summary: `${session.user.name} 绑定分销客户`,
      }, (data) =>
        bindReferralRelation(data, {
          distributorId: requiredString(body, "distributorId"),
          customerId: requiredString(body, "customerId"),
          source: optionalString(body, "source") as "手工绑定" | "邀请码" | undefined,
        }),
      );
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/distribution-commissions/settle") {
      requirePermission(session, "commissions:settle");
      const nextData = updateData(await database.readData(), session, {
        action: "结算分销佣金",
        targetType: "distributionCommission",
        targetId: "all",
        summary: `${session.user.name} 结算全部待结算分销佣金`,
      }, (data) => settleDistributionCommissions(data, { userId: session.user.id }));
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close") {
      requirePermission(session, "reports:view");
      const body = await readJson(context.request);
      const nextData = createDailyClose(await database.readData(), {
        businessDate: optionalString(body, "businessDate") ?? new Date().toISOString().slice(0, 10),
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/daily-close/reverse") {
      requirePermission(session, "reports:view");
      const body = await readJson(context.request);
      const nextData = reverseDailyClose(await database.readData(), {
        businessDate: requiredString(body, "businessDate"),
        userId: session.user.id,
      });
      await database.replaceData(nextData);
      return sendJson(200, scopeDataForSession(nextData, session));
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

function requirePermission(session: UserSession, permission: Permission) {
  if (!session.user.permissions.includes(permission)) {
    throw new Error("当前角色无权执行此操作");
  }
}

function publicStorePayload(data: AppData, shareCode: string) {
  const storefront = data.onlineStorefronts.find((item) => item.shareCode === shareCode && item.status === "启用");
  if (!storefront) throw new Error("线上店铺不存在或已停用");
  const store = data.storeProfiles.find((item) => item.id === storefront.storeId) ?? data.storeProfiles[0];
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

function scopeDataForSession(data: AppData, session: UserSession): AppData {
  const sanitizedData = {
    ...data,
    authUsers: data.authUsers.map((user) => ({ ...user, password: "" })),
    notifications: (data.notifications ?? []).filter((notification) => notificationVisibleToSession(notification, session)),
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
    distributors: sanitizedData.distributors.filter((item) => item.staffId === staffId || orders.some((order) => order.distributorId === item.id)),
    referralRelations: sanitizedData.referralRelations.filter((item) => customerIds.has(item.customerId)),
    approvalRequests: [],
    authUsers: sanitizedData.authUsers.filter((item) => item.staffId === staffId || item.id === session.user.id),
    staffInvites: [],
    onlineStorefronts: [],
    onlineBookingRequests: sanitizedData.onlineBookingRequests.filter((item) => item.appointmentId && appointmentIds.has(item.appointmentId)),
    distributionCommissions: sanitizedData.distributionCommissions.filter((item) => orderIds.has(item.orderId)),
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

function handleCors(request: Request) {
  if (request.method !== "OPTIONS") return undefined;
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    if (typeof productId !== "string" || productId.length === 0 || typeof quantity !== "number" || quantity <= 0) continue;
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}
