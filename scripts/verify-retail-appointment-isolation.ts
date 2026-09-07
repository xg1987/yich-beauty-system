import assert from "node:assert/strict";
import type { AppData } from "../src/domain/types";

// Shared contract for the Node API and the production-shaped local D1 API.
export async function verifyRetailAppointmentIsolation(
  request: (path: string, options?: { method?: string; body?: unknown }) => Promise<AppData>,
  input: { customerId: string; staffId: string; appointmentId: string; productId: string },
) {
  const before = await request("/api/data");
  const appointment = before.appointments.find((item) => item.id === input.appointmentId)!;
  const customer = before.customers.find((item) => item.id === input.customerId)!;
  const product = before.products.find((item) => item.id === input.productId)!;
  assert.equal(appointment.status, "已完成", "retail regression needs a previously paid service appointment");

  for (const walkin of [false, true]) {
    const body = {
      checkoutRequestId: `retail-isolation-${Date.now()}-${walkin}`,
      customerId: walkin ? undefined : input.customerId,
      guestName: walkin ? customer.name : undefined,
      guestPhone: walkin ? customer.phone : undefined,
      staffId: input.staffId,
      serviceIds: ["", "  "],
      productItems: [{ productId: input.productId, quantity: 1 }],
      payMethod: "微信",
    };
    await assert.rejects(
      () => request("/api/checkout", { method: "POST", body: { ...body, appointmentId: input.appointmentId } }),
      /预约收银需选择服务项目/,
      "retail must reject explicit service-appointment links before any write",
    );
    // Retry the same request ID after a validation error: failed requests must release their lock.
    const after = await request("/api/checkout", { method: "POST", body });
    const order = after.orders[0];
    assert.equal(order.appointmentId, undefined, "retail must not link to the already paid appointment");
    assert.equal(order.customerId, input.customerId, "both member and matched walk-in retain customer identity");
    assert.equal(order.paidAmount, product.price, "retail only charges its products");
    assert.equal(after.products.find((item) => item.id === product.id)?.stock, product.stock - 1, "retail decrements stock exactly once");
    assert.ok(after.customerSignatures.some((item) => item.orderId === order.id && item.status === "待签名"), "retail creates its own signature");
    assert.deepEqual(after.appointments.find((item) => item.id === appointment.id), appointment, "retail must preserve the service appointment");
    for (const checkoutRequestId of [body.checkoutRequestId, `${body.checkoutRequestId}-retry`]) {
      await assert.rejects(
        () => request("/api/checkout", { method: "POST", body: { ...body, checkoutRequestId } }),
        /重复提交/,
        "same and different request IDs must not duplicate a just-created retail order",
      );
    }
    const refunded = await request(`/api/orders/${order.id}/refund`, { method: "POST", body: { reason: "商品与预约隔离回归验证" } });
    assert.equal(refunded.products.find((item) => item.id === product.id)?.stock, product.stock, "retail refund restores its stock");
    assert.deepEqual(refunded.appointments.find((item) => item.id === appointment.id), appointment, "retail refund must not reopen the service appointment");
  }
}
