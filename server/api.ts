import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  addOperationLog,
  addCustomerFollowUp,
  addCustomerServiceRecord,
  addSupplier,
  adjustInventory,
  checkoutOrder,
  createAppointment,
  createApprovalRequest,
  createDailyClose,
  createStaffShift,
  createStaffUnavailableSlot,
  createStocktake,
  completeCustomerFollowUp,
  decideApprovalRequest,
  extendMemberCard,
  receivePurchaseOrder,
  rechargeMemberCard,
  refundMemberCard,
  refundOrder,
  reverseDailyClose,
  transferMemberCard,
  updateMemberCardStatus,
} from "../src/domain/business";
import type { Permission, UserSession } from "../src/domain/auth";
import type { AppData, Appointment, InventoryLog, Order } from "../src/domain/types";
import { makeId, nowIso } from "../src/domain/utils";
import { demoLoginAccounts, getSession, login } from "./auth";
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

      if (request.method === "GET" && url.pathname === "/api/auth/demo-users") {
        sendJson(response, 200, demoLoginAccounts());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(request);
        sendJson(response, 200, login(requiredString(body, "account"), requiredString(body, "password")));
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

      if (request.method === "POST" && url.pathname === "/api/reset") {
        requirePermission(session, "settings:view");
        database.reset();
        sendJson(response, 200, scopeDataForSession(database.readData(), session));
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
        }, (data) => ({
          ...data,
          appointments: data.appointments.map((item) => (item.id === appointmentId ? { ...item, status } : item)),
        }));
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

      if (request.method === "POST" && url.pathname === "/api/member-cards") {
        requirePermission(session, "customers:manage");
        const body = await readJson(request);
        const remainingTimes = optionalNumber(body, "remainingTimes") ?? 0;
        const balance = remainingTimes > 0 ? 0 : requiredNumber(body, "balance");
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
              type: remainingTimes > 0 ? "次数卡" : "储值卡",
              balance,
              remainingTimes,
              expiresAt: optionalString(body, "expiresAt") ?? "2027-12-31",
              status: "正常",
              serviceId: optionalString(body, "serviceId"),
              serviceIds: optionalStringArray(body, "serviceIds"),
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
          afterNote: optionalString(body, "afterNote") ?? "",
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
        const nextData = updateData(database, session, {
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
            },
            ...data.services,
          ],
        }));
        sendJson(response, 201, scopeDataForSession(nextData, session));
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
        }, (data) => ({
          ...data,
          commissions: data.commissions.map((item) => (item.status === "待结算" ? { ...item, status: "已结算" } : item)),
        }));
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

function scopeDataForSession(data: AppData, session: UserSession): AppData {
  if (session.user.role !== "therapist" || !session.user.staffId) {
    return data;
  }

  const staffId = session.user.staffId;
  const appointments = data.appointments.filter((item) => item.staffId === staffId);
  const orders = data.orders.filter((item) => item.staffId === staffId);
  const orderIds = new Set(orders.map((item) => item.id));
  const customerIds = new Set([...appointments.map((item) => item.customerId), ...orders.map((item) => item.customerId)]);

  return {
    ...data,
    customers: data.customers.filter((item) => customerIds.has(item.id)),
    appointments,
    staffShifts: data.staffShifts.filter((item) => item.staffId === staffId),
    staffUnavailableSlots: data.staffUnavailableSlots.filter((item) => item.staffId === staffId),
    orders,
    refunds: data.refunds.filter((item) => orderIds.has(item.orderId)),
    commissions: data.commissions.filter((item) => item.staffId === staffId),
    approvalRequests: [],
    customerServiceRecords: data.customerServiceRecords.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    customerFollowUps: data.customerFollowUps.filter((item) => item.staffId === staffId || customerIds.has(item.customerId)),
    operationLogs: data.operationLogs.filter((item) => item.userId === session.user.id),
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
