import {
  addOperationLog,
  addCustomerFollowUp,
  addCustomerServiceRecord,
  addStaffMember,
  addSupplier,
  adjustInventory,
  checkoutOrder,
  createAppointment,
  createApprovalRequest,
  createCouponTemplate,
  createMarketingActivity,
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
  reverseDailyClose,
  transferMemberCard,
  joinStaffInvite,
  issueCustomerCoupon,
  updateStaffMember,
  updateMemberCardStatus,
} from "../../src/domain/business";
import type { Permission, UserSession } from "../../src/domain/auth";
import type { AppData, Appointment, InventoryLog, Order, UserRole } from "../../src/domain/types";
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
      return sendJson(200, { ok: true, service: "yich-system-api", runtime: "cloudflare-d1" });
    }

    if (context.request.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(context.request);
      return sendJson(200, await loginWithD1(context.env.DB, requiredString(body, "account"), requiredString(body, "password")));
    }

    if (context.request.method === "POST" && pathname === "/api/auth/register-store") {
      const body = await readJson(context.request);
      const nextData = registerStore(await database.readData(), {
        storeName: requiredString(body, "storeName"),
        ownerName: requiredString(body, "ownerName"),
        phone: requiredString(body, "phone"),
        address: optionalString(body, "address"),
        account: requiredString(body, "account"),
        password: requiredString(body, "password"),
      });
      await database.replaceData(nextData);
      return sendJson(201, await loginWithD1(context.env.DB, requiredString(body, "account"), requiredString(body, "password")));
    }

    if (context.request.method === "POST" && pathname === "/api/auth/join-invite") {
      const body = await readJson(context.request);
      const nextData = joinStaffInvite(await database.readData(), {
        inviteCode: requiredString(body, "inviteCode"),
        name: requiredString(body, "name"),
        password: requiredString(body, "password"),
      });
      await database.replaceData(nextData);
      return sendJson(201, await loginWithD1(context.env.DB, nextData.authUsers[0].account, requiredString(body, "password")));
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
      });
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
          couponId: optionalString(body, "couponId"),
          activityId: optionalString(body, "activityId"),
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
      const nextData = addOperationLog(
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
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/appointments") {
      requirePermission(session, "appointments:manage");
      const body = await readJson(context.request);
      const nextData = updateData(await database.readData(), session, {
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
      }, (data) => ({
        ...data,
        appointments: data.appointments.map((item) => (item.id === appointmentId ? { ...item, status } : item)),
      }));
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

    if (context.request.method === "POST" && pathname === "/api/coupon-templates") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        createCouponTemplate(await database.readData(), {
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
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/customer-coupons") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        issueCustomerCoupon(await database.readData(), {
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
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
    }

    if (context.request.method === "POST" && pathname === "/api/marketing-activities") {
      requirePermission(session, "customers:manage");
      const body = await readJson(context.request);
      const nextData = addOperationLog(
        createMarketingActivity(await database.readData(), {
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
      const nextData = createApprovalRequest(await database.readData(), {
        type: requiredString(body, "type") as "改价折扣" | "订单退款",
        targetId: requiredString(body, "targetId"),
        requestedBy: session.user.id,
        amount: requiredNumber(body, "amount"),
        reason: optionalString(body, "reason") ?? "门店审批",
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
      const nextData = addCustomerServiceRecord(await database.readData(), {
        customerId: requiredString(body, "customerId"),
        staffId: requiredString(body, "staffId"),
        serviceId: requiredString(body, "serviceId"),
        orderId: optionalString(body, "orderId"),
        skinCondition: optionalString(body, "skinCondition") ?? "",
        beforeNote: optionalString(body, "beforeNote") ?? "",
        afterNote: optionalString(body, "afterNote") ?? "",
        nextFollowUpAt: optionalString(body, "nextFollowUpAt"),
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
      const nextData = updateData(await database.readData(), session, {
        action: "新增服务项目",
        targetType: "service",
        targetId: "latest",
        summary: `${session.user.name} 新增服务项目 ${requiredString(body, "name")}`,
      }, (data) => ({
        ...data,
        services: [
          {
            id: makeId("v"),
            name: requiredString(body, "name"),
            category: optionalString(body, "category") ?? "自定义项目",
            price: requiredNumber(body, "price"),
            duration: optionalNumber(body, "duration") ?? 60,
            consumableProductId: optionalString(body, "consumableProductId"),
            consumableQty: optionalNumber(body, "consumableQty"),
          },
          ...data.services,
        ],
      }));
      await database.replaceData(nextData);
      return sendJson(201, scopeDataForSession(nextData, session));
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
      }, (data) => ({
        ...data,
        commissions: data.commissions.map((item) => (item.status === "待结算" ? { ...item, status: "已结算" } : item)),
      }));
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
    approvalRequests: [],
    authUsers: sanitizedData.authUsers.filter((item) => item.staffId === staffId || item.id === session.user.id),
    staffInvites: [],
    customerServiceRecords: sanitizedData.customerServiceRecords.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    customerFollowUps: sanitizedData.customerFollowUps.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    operationLogs: sanitizedData.operationLogs.filter((item) => item.userId === session.user.id),
    dailyCloses: [],
  };
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
