import type { AppData } from "./types";

type MutationBody = Record<string, unknown>;

function bodyText(body: MutationBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function bodyTextArray(body: MutationBody, key: string) {
  const value = body[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function lineIds(body: MutationBody, key: string, idKey: string) {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => {
    if (!line || typeof line !== "object") return [];
    const id = (line as Record<string, unknown>)[idKey];
    return typeof id === "string" && id.trim() ? [id.trim()] : [];
  });
}

export function resolveStoreMutationTarget(data: AppData, pathname: string, body: MutationBody) {
  const storeIds = new Set<string>();
  const addStore = (storeId: string | undefined) => {
    const normalized = storeId?.trim();
    if (normalized) storeIds.add(normalized);
  };
  const addCustomer = (id: string) => addStore(data.customers.find((item) => item.id === id)?.storeId);
  const addStaff = (id: string) => addStore(data.staff.find((item) => item.id === id)?.storeId);
  const addService = (id: string) => addStore(data.services.find((item) => item.id === id)?.storeId);
  const addProduct = (id: string) => addStore(data.products.find((item) => item.id === id)?.storeId);
  const addSupplier = (id: string) => addStore(data.suppliers.find((item) => item.id === id)?.storeId);
  const addCard = (id: string) => {
    const card = data.memberCards.find((item) => item.id === id);
    if (!card) return;
    addStore(card.storeId);
    addCustomer(card.customerId);
  };
  const addSignature = (id: string) => {
    const signature = data.customerSignatures.find((item) => item.id === id);
    if (!signature) return;
    addStore(signature.storeId);
    addCustomer(signature.customerId);
    if (signature.orderId) addOrder(signature.orderId);
  };
  const addAppointment = (id: string) => {
    const appointment = data.appointments.find((item) => item.id === id);
    if (!appointment) return;
    addStore(appointment.storeId);
    addCustomer(appointment.customerId);
    addStaff(appointment.staffId);
    (appointment.serviceIds?.length ? appointment.serviceIds : appointment.serviceId ? [appointment.serviceId] : []).forEach(addService);
  };
  const addOrder = (id: string) => {
    const order = data.orders.find((item) => item.id === id);
    if (!order) return;
    addStore(order.storeId);
    addCustomer(order.customerId);
    addStaff(order.staffId);
    if (order.cardId) addCard(order.cardId);
    if (order.appointmentId) addAppointment(order.appointmentId);
    (order.serviceIds?.length ? order.serviceIds : order.serviceId ? [order.serviceId] : []).forEach(addService);
    (order.productItems ?? []).forEach((item) => addProduct(item.productId));
    (order.giftProductItems ?? []).forEach((item) => addProduct(item.productId));
    if (order.productId) addProduct(order.productId);
    if (order.giftProductId) addProduct(order.giftProductId);
  };

  addStore(bodyText(body, "storeId"));
  const customerId = bodyText(body, "customerId");
  const staffId = bodyText(body, "staffId");
  const serviceId = bodyText(body, "serviceId");
  const productId = bodyText(body, "productId");
  const supplierId = bodyText(body, "supplierId");
  const memberCardId = bodyText(body, "memberCardId") || bodyText(body, "cardId");
  const appointmentId = bodyText(body, "appointmentId");
  const orderId = bodyText(body, "orderId");
  if (customerId) addCustomer(customerId);
  if (staffId) addStaff(staffId);
  if (serviceId) addService(serviceId);
  if (productId) addProduct(productId);
  if (supplierId) addSupplier(supplierId);
  if (memberCardId) addCard(memberCardId);
  if (appointmentId) addAppointment(appointmentId);
  if (orderId) addOrder(orderId);
  bodyTextArray(body, "collaboratorStaffIds").forEach(addStaff);
  bodyTextArray(body, "serviceIds").forEach(addService);
  lineIds(body, "productItems", "productId").forEach(addProduct);
  lineIds(body, "giftProductItems", "productId").forEach(addProduct);

  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] === "api" && segments[2]) {
    if (segments[1] === "orders") addOrder(segments[2]);
    if (segments[1] === "appointments") addAppointment(segments[2]);
    if (segments[1] === "products") addProduct(segments[2]);
    if (segments[1] === "member-cards" && segments[2] !== "open") addCard(segments[2]);
    if (segments[1] === "customer-signatures") addSignature(segments[2]);
  }

  if (storeIds.size === 0 && data.storeProfiles.length === 1) addStore(data.storeProfiles[0].id);
  if (storeIds.size === 0) {
    throw new Error("系统管理员执行门店业务时必须明确唯一目标门店");
  }
  if (storeIds.size > 1) {
    throw new Error("系统管理员不能在一次业务操作中混合多个门店的数据");
  }
  return Array.from(storeIds)[0];
}
