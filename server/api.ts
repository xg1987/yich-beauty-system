import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  addOperationLog,
  addCustomerFollowUp,
  addCustomerServiceRecord,
  addStaffMember,
  addSupplier,
  adjustInventory,
  convertOnlineBookingRequest,
  checkoutOrder,
  bindReferralRelation,
  createAppointment,
  createOnlineBookingRequest,
  createApprovalRequest,
  createCouponTemplate,
  createDistributor,
  createMarketingActivity,
  createTagDefinition,
  createDailyClose,
  createStaffShift,
  createStaffUnavailableSlot,
  createStaffInvite,
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
  joinStaffInvite,
  issueCustomerCoupon,
  updateTagDefinition,
  updateStaffMember,
  updateMemberCardStatus,
} from "../src/domain/business";
import type { Permission, UserSession } from "../src/domain/auth";
import type { AppData, Appointment, InventoryLog, Order, ServiceConsumable, TagScope, UserRole } from "../src/domain/types";
import { makeId, nowIso } from "../src/domain/utils";
import { getSession, login } from "./auth";
import { BeautyDatabase } from "./database";

type JsonBody = Record<string, unknown>;

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
        sendJson(response, 200, { ok: true, service: "yich-system-api" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(request);
        sendJson(response, 200, login(requiredString(body, "account"), requiredString(body, "password"), database.readData().authUsers));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/register-store") {
        const body = await readJson(request);
        const nextData = registerStore(database.readData(), {
          storeName: requiredString(body, "storeName"),
          ownerName: requiredString(body, "ownerName"),
          phone: requiredString(body, "phone"),
          address: optionalString(body, "address"),
          account: requiredString(body, "account"),
          password: requiredString(body, "password"),
        });
        database.replaceData(nextData);
        sendJson(response, 201, login(requiredString(body, "account"), requiredString(body, "password"), nextData.authUsers));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/join-invite") {
        const body = await readJson(request);
        const nextData = joinStaffInvite(database.readData(), {
          inviteCode: requiredString(body, "inviteCode"),
          name: requiredString(body, "name"),
          password: requiredString(body, "password"),
        });
        database.replaceData(nextData);
        const joinedUser = nextData.authUsers[0];
        sendJson(response, 201, login(joinedUser.account, requiredString(body, "password"), nextData.authUsers));
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/public/store/")) {
        const shareCode = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        sendJson(response, 200, publicStorePayload(database.readData(), shareCode));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/public/online-booking-requests") {
        const body = await readJson(request);
        const nextData = createOnlineBookingRequest(database.readData(), {
          shareCode: requiredString(body, "shareCode"),
          customerName: requiredString(body, "customerName"),
          phone: requiredString(body, "phone"),
          serviceId: requiredString(body, "serviceId"),
          preferredAt: requiredString(body, "preferredAt"),
          note: optionalString(body, "note") ?? "",
        });
        database.replaceData(nextData);
        sendJson(response, 201, { ok: true });
        return;
      }

      const session = getSession(request.headers.authorization);
      if (!session) {
        sendJson(response, 401, { error: "请先登录" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        sendJson(response, 200, session);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/data") {
        requirePermission(session, "dashboard:view");
        sendJson(response, 200, scopeDataForSession(database.readData(), session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff") {
        requirePermission(session, "staff:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          addStaffMember(database.readData(), {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
            shareCode: requiredString(body, "shareCode"),
            status: optionalString(body, "status") as "启用" | "停用" | undefined,
            headline: requiredString(body, "headline"),
            description: optionalString(body, "description") ?? "",
            enabledServiceIds: optionalStringArray(body, "enabledServiceIds") ?? [],
          }),
        );
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checkout") {
        requirePermission(session, "pos:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          checkoutOrder(database.readData(), {
            customerId: requiredString(body, "customerId"),
            staffId: requiredString(body, "staffId"),
            collaboratorStaffIds: optionalStringArray(body, "collaboratorStaffIds"),
            serviceId: requiredString(body, "serviceId"),
            productId: optionalString(body, "productId"),
            discountAmount: optionalNumber(body, "discountAmount"),
            adjustmentReason: optionalString(body, "adjustmentReason"),
            approvalId: optionalString(body, "approvalId"),
            couponId: optionalString(body, "couponId"),
            activityId: optionalString(body, "activityId"),
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
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/refund")) {
        requirePermission(session, "pos:manage");
        const orderId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const nextData = refundOrder(database.readData(), {
          orderId,
          reason: optionalString(body, "reason") ?? "门店退款",
          userId: session.user.id,
          amount: optionalNumber(body, "amount"),
          approvalId: optionalString(body, "approvalId"),
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/inventory/adjust") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          adjustInventory(database.readData(), {
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
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/appointments") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff-unavailable-slots") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const nextData = createStaffUnavailableSlot(database.readData(), {
          staffId: requiredString(body, "staffId"),
          startAt: requiredString(body, "startAt"),
          endAt: requiredString(body, "endAt"),
          reason: optionalString(body, "reason") ?? "不可预约",
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/staff-shifts") {
        requirePermission(session, "appointments:manage");
        const body = await readJson(request);
        const nextData = createStaffShift(database.readData(), {
          staffId: requiredString(body, "staffId"),
          startAt: requiredString(body, "startAt"),
          endAt: requiredString(body, "endAt"),
          note: optionalString(body, "note") ?? "门店班次",
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
            note: optionalString(body, "note"),
          }),
        );
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/member-cards") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
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
        const nextData = updateData(database, session, {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/coupon-templates") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          createCouponTemplate(database.readData(), {
            name: requiredString(body, "name"),
            amount: requiredNumber(body, "amount"),
            minSpend: requiredNumber(body, "minSpend"),
            serviceId: optionalString(body, "serviceId"),
            validDays: requiredNumber(body, "validDays"),
          }),
          {
            userId: session.user.id,
            action: "创建营销券",
            targetType: "couponTemplate",
            targetId: "latest",
            summary: `${session.user.name} 创建营销券 ${requiredString(body, "name")}`,
          },
        );
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/customer-coupons") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          issueCustomerCoupon(database.readData(), {
            templateId: requiredString(body, "templateId"),
            customerId: requiredString(body, "customerId"),
          }),
          {
            userId: session.user.id,
            action: "客户发券",
            targetType: "customerCoupon",
            targetId: "latest",
            summary: `${session.user.name} 给客户发放营销券`,
          },
        );
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/marketing-activities") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = addOperationLog(
          createMarketingActivity(database.readData(), {
            name: requiredString(body, "name"),
            type: requiredString(body, "type") as "拼团" | "秒杀",
            serviceId: requiredString(body, "serviceId"),
            activityPrice: requiredNumber(body, "activityPrice"),
            groupSize: optionalNumber(body, "groupSize"),
            quota: requiredNumber(body, "quota"),
            startsAt: requiredString(body, "startsAt"),
            endsAt: requiredString(body, "endsAt"),
          }),
          {
            userId: session.user.id,
            action: "创建营销活动",
            targetType: "marketingActivity",
            targetId: "latest",
            summary: `${session.user.name} 创建营销活动 ${requiredString(body, "name")}`,
          },
        );
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
          note: optionalString(body, "note"),
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approvals") {
        requirePermission(session, "pos:manage");
        const body = await readJson(request);
        const nextData = createApprovalRequest(database.readData(), {
          type: requiredString(body, "type") as "改价折扣" | "订单退款",
          targetId: requiredString(body, "targetId"),
          requestedBy: session.user.id,
          amount: requiredNumber(body, "amount"),
          reason: optionalString(body, "reason") ?? "门店审批",
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/service-records") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = addCustomerServiceRecord(database.readData(), {
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
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/follow-ups/")) {
        requirePermission(session, "customers:manage");
        const followUpId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const nextData = completeCustomerFollowUp(database.readData(), { followUpId });
        database.replaceData(nextData);
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/services/") && url.pathname.endsWith("/consumables")) {
        requirePermission(session, "catalog:manage");
        const serviceId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const body = await readJson(request);
        const consumables = optionalConsumables(body);
        if (consumables.length === 0) throw new Error("至少配置一个耗材");
        const nextData = updateData(database, session, {
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/products") {
        requirePermission(session, "catalog:manage");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/suppliers") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const nextData = addSupplier(database.readData(), {
          name: requiredString(body, "name"),
          phone: optionalString(body, "phone") ?? "",
          contact: optionalString(body, "contact") ?? "",
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/purchase-orders") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const nextData = receivePurchaseOrder(database.readData(), {
          supplierId: requiredString(body, "supplierId"),
          productId: requiredString(body, "productId"),
          quantity: requiredNumber(body, "quantity"),
          unitCost: requiredNumber(body, "unitCost"),
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/stocktakes") {
        requirePermission(session, "inventory:manage");
        const body = await readJson(request);
        const nextData = createStocktake(database.readData(), {
          productId: requiredString(body, "productId"),
          actualStock: requiredNumber(body, "actualStock"),
          reason: optionalString(body, "reason") ?? "库存盘点",
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/distributors") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/referral-relations") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const nextData = updateData(database, session, {
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
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/distribution-commissions/settle") {
        requirePermission(session, "commissions:settle");
        const nextData = updateData(database, session, {
          action: "结算分销佣金",
          targetType: "distributionCommission",
          targetId: "all",
          summary: `${session.user.name} 结算全部待结算分销佣金`,
        }, (data) => settleDistributionCommissions(data, { userId: session.user.id }));
        sendJson(response, 200, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-close") {
        requirePermission(session, "reports:view");
        const body = await readJson(request);
        const nextData = createDailyClose(database.readData(), {
          businessDate: optionalString(body, "businessDate") ?? new Date().toISOString().slice(0, 10),
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 201, scopeDataForSession(nextData, session));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-close/reverse") {
        requirePermission(session, "reports:view");
        const body = await readJson(request);
        const nextData = reverseDailyClose(database.readData(), {
          businessDate: requiredString(body, "businessDate"),
          userId: session.user.id,
        });
        database.replaceData(nextData);
        sendJson(response, 200, scopeDataForSession(nextData, session));
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
    console.log(`YiCh system API listening on http://localhost:${port}`);
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

function scopeDataForSession(data: AppData, session: UserSession): AppData {
  const sanitizedData = {
    ...data,
    authUsers: data.authUsers.map((user) => ({ ...user, password: "" })),
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
    couponTemplates: [],
    customerCoupons: sanitizedData.customerCoupons.filter((item) => customerIds.has(item.customerId)),
    marketingActivities: sanitizedData.marketingActivities.filter((item) => orders.some((order) => order.activityId === item.id)),
    activityParticipants: sanitizedData.activityParticipants.filter((item) => customerIds.has(item.customerId)),
    distributors: sanitizedData.distributors.filter((item) => item.staffId === staffId || orders.some((order) => order.distributorId === item.id)),
    referralRelations: sanitizedData.referralRelations.filter((item) => customerIds.has(item.customerId)),
    approvalRequests: [],
    authUsers: sanitizedData.authUsers.filter((item) => item.staffId === staffId || item.id === session.user.id),
    staffInvites: [],
    onlineStorefronts: [],
    onlineBookingRequests: sanitizedData.onlineBookingRequests.filter((item) => item.appointmentId && appointmentIds.has(item.appointmentId)),
    distributionCommissions: sanitizedData.distributionCommissions.filter((item) => orderIds.has(item.orderId)),
    customerServiceRecords: sanitizedData.customerServiceRecords.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    customerFollowUps: sanitizedData.customerFollowUps.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    operationLogs: sanitizedData.operationLogs.filter((item) => item.userId === session.user.id),
    commissionSettlements: sanitizedData.commissionSettlements.filter((item) =>
      item.commissionIds.some((commissionId) => sanitizedData.commissions.some((commission) => commission.id === commissionId && commission.staffId === staffId)),
    ),
    dailyCloses: [],
  };
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

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
