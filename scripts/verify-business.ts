import assert from "node:assert/strict";
import {
  addCustomerServiceRecord,
  archiveNotification,
  createCustomerSignature,
  addStaffMember,
  addSupplier,
  adjustInventory,
  checkoutOrder,
  convertOnlineBookingRequest,
  createAppointment,
  createDailyClose,
  createOnlineBookingRequest,
  createStaffShift,
  createStaffInvite,
  createStaffUnavailableSlot,
  createStoreOwnerInvite,
  createStocktake,
  completeCustomerFollowUp,
  createTagDefinition,
  extendMemberCard,
  joinStaffInvite,
  joinInviteByCode,
  signCustomerSignature,
  addSystemNotification,
  calculateMemberCardRefundQuote,
  cleanupFormalData,
  formalDataAudit,
  markAllVisibleNotificationsRead,
  markNotificationRead,
  memberCardCashRefund,
  memberCardCashIn,
  openMemberCard,
  platformInviteCodeForPlatformAdmin,
  platformInviteCodeForUser,
  previewFormalDataCleanup,
  receivePurchaseOrder,
  receiveSupplierPurchase,
  rechargeMemberCard,
  registerStore,
  refundMemberCard,
  refundOrder,
  reportSummary,
  revokeStaffInvite,
  reverseDailyClose,
  restockLowInventory,
  rescheduleAppointment,
  settleCommissions,
  storeStaffInviteCodeForStoreUser,
  transferMemberCard,
  voidMemberCardOpening,
  memberCardVoidEligibility,
  updateAppointmentStatus,
  updateAccountProfile,
  updateAuthUserStatus,
  updateStaffMember,
  updateStoreProfile,
  updateStoreStatus,
  updateSystemConfig,
  updateTagDefinition,
  updateMemberCardStatus,
  upsertOnlineStorefront,
  expireStaleMarketingAiRecords,
  isStaleMarketingAiRecord,
  MARKETING_AI_PENDING_TIMEOUT_MS,
  inviteDefaultDays,
} from "../src/domain/business";
import { buildCashierFlowRecords } from "../src/domain/cashierFlow";
import { testFixtureData } from "../src/domain/testFixture";
import type { AppData, MarketingAiRecord } from "../src/domain/types";
import { money } from "../src/domain/utils";
import { isVersionGreater } from "../src/appUpdate";
import { aggregateMemberCardServiceAvailability, memberCardAvailableServiceIds, memberCardDisplayStatus, memberCardHasAvailableValue } from "../src/app/authenticatedAppHelpers";
import { mergePosRemoteData } from "../src/hooks/usePosRemoteData";

const cloneSeed = (): AppData => structuredClone(testFixtureData);
const fixedNow = () => "2026-05-24T01:00:00.000Z";
let idIndex = 0;
const testId = (prefix: string) => `${prefix}_test_${++idIndex}`;

function productStock(data: AppData, productId: string) {
  const product = data.products.find((item) => item.id === productId);
  assert.ok(product, `missing product ${productId}`);
  return product.stock;
}

function card(data: AppData, cardId: string) {
  const result = data.memberCards.find((item) => item.id === cardId);
  assert.ok(result, `missing card ${cardId}`);
  return result;
}

{
  assert.equal(isVersionGreater("0.1.237", "0.1.236"), true, "higher patch version should be updateable");
  assert.equal(isVersionGreater("0.1.236", "0.1.237"), false, "lower server version should not be updateable");
  assert.equal(isVersionGreater("0.1.237", "0.1.237"), false, "same version should not be updateable");
  assert.equal(isVersionGreater("0.2.0", "0.1.237"), true, "higher minor version should be updateable");
}

{
  const now = new Date("2026-05-24T01:00:00.000Z");
  const stalePendingRecord: MarketingAiRecord = {
    id: "ai_stale_pending",
    storeId: "store_test",
    kind: "copy",
    title: "AI营销内容",
    status: "生成中",
    text: "任务已提交，后台正在生成。",
    createdBy: "u_manager",
    createdByName: "店长",
    createdAt: "2026-05-24T00:48:00.000Z",
  };
  const freshPendingRecord: MarketingAiRecord = {
    ...stalePendingRecord,
    id: "ai_fresh_pending",
    createdAt: new Date(now.getTime() - MARKETING_AI_PENDING_TIMEOUT_MS + 60_000).toISOString(),
  };
  assert.equal(isStaleMarketingAiRecord(stalePendingRecord, now), true, "old pending AI marketing record should be stale");
  assert.equal(isStaleMarketingAiRecord(freshPendingRecord, now), false, "recent pending AI marketing record should keep waiting");
  const reconciled = expireStaleMarketingAiRecords({ ...cloneSeed(), marketingAiRecords: [stalePendingRecord, freshPendingRecord] }, now);
  assert.equal(reconciled.marketingAiRecords[0].status, "生成失败", "stale pending AI marketing record should fail instead of waiting forever");
  assert.match(reconciled.marketingAiRecords[0].errorMessage ?? "", /超过10分钟/, "stale pending AI marketing record should explain timeout");
  assert.equal(reconciled.marketingAiRecords[1].status, "生成中", "fresh pending AI marketing record should remain pending");
}

function signedRefundSignature(data: AppData, customerId: string, cardName = "尊享储值卡", refundAmount = 500, payMethod = "微信") {
  const created = createCustomerSignature(
    data,
    {
      customerId,
      title: "会员卡退费确认签名",
      content: `本人确认办理${cardName}退费，实退金额${money(refundAmount)}，退款方式${payMethod}，退费后会员卡关闭。`,
      validDays: 1,
      requestedBy: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signature = created.customerSignatures[0];
  return signCustomerSignature(
    created,
    { token: signature.token, signerName: "退费客户", signatureText: "data:image/png;base64,refund" },
    { now: fixedNow },
  );
}

{
  const seed = cloneSeed();
  const appointmentId = "a_service_signature_verify";
  const orderId = "o_service_signature_verify";
  const signatureId = "sig_service_signature_verify";
  const token = "sign_service_signature_verify";
  const signed = signCustomerSignature(
    {
      ...seed,
      appointments: [
        {
          id: appointmentId,
          storeId: "store1",
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: "2026-05-24T02:00:00.000Z",
          endAt: "2026-05-24T03:00:00.000Z",
          roomName: "VIP护理房",
          status: "已到店",
          note: "",
        },
        ...seed.appointments,
      ],
      orders: [
        {
          id: orderId,
          storeId: "store1",
          orderNo: "SO_SERVICE_SIGNATURE_VERIFY",
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          serviceName: "水光护理",
          totalAmount: 398,
          paidAmount: 398,
          discountAmount: 0,
          appointmentId,
          payMethod: "微信",
          status: "已支付",
          createdAt: fixedNow(),
        },
        ...seed.orders,
      ],
      customerSignatures: [
        {
          id: signatureId,
          storeId: "store1",
          token,
          customerId: "c1",
          orderId,
          title: "服务完成确认签名",
          content: "确认本次到店服务无误。",
          status: "待签名",
          requestedBy: "u_manager",
          createdAt: fixedNow(),
          expiresAt: "2026-05-25T01:00:00.000Z",
        },
        ...seed.customerSignatures,
      ],
    },
    { token, signerName: "周女士", signatureText: "data:image/png;base64,service-signature" },
    { now: fixedNow },
  );
  const appointment = signed.appointments.find((item) => item.id === appointmentId);
  assert.equal(appointment?.status, "已完成", "service completion signature should complete linked arrived appointment");
  assert.equal(appointment?.completedAt, fixedNow(), "service completion signature should stamp appointment completion time");
}

{
  const cleanReport = formalDataAudit({
    ...cloneSeed(),
    onlineStorefronts: cloneSeed().onlineStorefronts.map((storefront) => ({ ...storefront, shareCode: "yich-store" })),
    authUsers: cloneSeed().authUsers.map((user) => ({ ...user, account: user.account.replace("@test.local", "@yich.local") })),
  });
  assert.equal(cleanReport.issueCount, 0, "formal data audit should pass clean fixture after formal share code");
  const pollutedReport = formalDataAudit({
    ...cloneSeed(),
    staff: [{ ...cloneSeed().staff[0], id: "s_dirty", name: "验证员工" }, ...cloneSeed().staff],
    authUsers: [{ ...cloneSeed().authUsers[0], id: "u_dirty", account: "dirty@test.local" }, ...cloneSeed().authUsers],
  });
  assert.ok(pollutedReport.issueCount >= 2, "formal data audit should flag verification and test account data");
  const preview = previewFormalDataCleanup({
    ...cloneSeed(),
    staff: [{ ...cloneSeed().staff[0], id: "s_dirty", name: "验证员工" }, ...cloneSeed().staff],
    authUsers: [{ ...cloneSeed().authUsers[0], id: "u_dirty", account: "dirty@test.local", staffId: "s_dirty" }, ...cloneSeed().authUsers],
  });
  assert.ok(preview.removalCounts.some((item) => item.scope === "员工"), "formal cleanup preview should include staff removals");
  const cleaned = cleanupFormalData({
    ...cloneSeed(),
    staff: [{ ...cloneSeed().staff[0], id: "s_dirty", name: "验证员工", accountId: "u_dirty" }, ...cloneSeed().staff],
    authUsers: [{ ...cloneSeed().authUsers[0], id: "u_dirty", account: "dirty@test.local", staffId: "s_dirty" }, ...cloneSeed().authUsers],
    appointments: [{ ...cloneSeed().appointments[0], id: "a_dirty", staffId: "s_dirty" }, ...cloneSeed().appointments],
  });
  assert.ok(!cleaned.data.staff.some((staff) => staff.id === "s_dirty"), "formal cleanup should remove dirty staff");
  assert.ok(!cleaned.data.authUsers.some((user) => user.id === "u_dirty"), "formal cleanup should remove dirty account");
  assert.ok(!cleaned.data.appointments.some((appointment) => appointment.id === "a_dirty"), "formal cleanup should remove dependent appointment");
}

{
  const withNotification = addSystemNotification(
    cloneSeed(),
    {
      title: "新的到店预约",
      desc: "周女士提交到店预约",
      view: "appointments",
      targetType: "appointment",
      targetId: "a1",
      audienceRoles: ["owner", "manager", "frontdesk", "therapist"],
      staffId: "s2",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withNotification.notifications[0].readByUserIds.length, 0, "notification should start unread");
  const oneRead = markNotificationRead(withNotification, { notificationId: withNotification.notifications[0].id, userId: "u_manager" });
  assert.deepEqual(oneRead.notifications[0].readByUserIds, ["u_manager"], "notification should mark one user read");
  const allRead = markAllVisibleNotificationsRead(withNotification, { userId: "u_therapist", role: "therapist", staffId: "s2" });
  assert.ok(allRead.notifications[0].readByUserIds.includes("u_therapist"), "target staff should mark visible notifications read");
  const hiddenRead = markAllVisibleNotificationsRead(withNotification, { userId: "u_other", role: "therapist", staffId: "s9" });
  assert.ok(!hiddenRead.notifications[0].readByUserIds.includes("u_other"), "unrelated therapist should not read hidden notification");
  const archived = archiveNotification(withNotification, { notificationId: withNotification.notifications[0].id, userId: "u_manager" });
  assert.deepEqual(archived.notifications[0].archivedByUserIds, ["u_manager"], "notification should archive for one user");
  const archivedAgain = archiveNotification(archived, { notificationId: withNotification.notifications[0].id, userId: "u_manager" });
  assert.deepEqual(archivedAgain.notifications[0].archivedByUserIds, ["u_manager"], "notification archive should not duplicate user ids");
}

{
  const configured = updateSystemConfig(
    cloneSeed(),
    { key: "invite_default_days", value: "12", updatedBy: "u_superadmin" },
    { now: fixedNow },
  );
  assert.equal(inviteDefaultDays(configured), 12, "system config should update default invite days");
  assert.equal(configured.systemConfigs.find((item) => item.key === "invite_default_days")?.updatedBy, "u_superadmin", "system config should keep updater");
  assert.throws(
    () => updateSystemConfig(cloneSeed(), { key: "invite_default_days", value: "0", updatedBy: "u_superadmin" }),
    /1 到 90/,
    "system config should reject invalid invite days",
  );
  assert.throws(
    () => updateSystemConfig(cloneSeed(), { key: "maintenance_mode", value: "yes", updatedBy: "u_superadmin" }),
    /true 或 false/,
    "system config should reject invalid boolean switches",
  );

  const withNewStaff = addStaffMember(configured, { name: "配置验证员工", phone: "13900009999", role: "员工" }, { idFactory: testId, now: fixedNow });
  const defaultStaffInvite = createStaffInvite(
    withNewStaff,
    {
      staffId: withNewStaff.staff[0].id,
      account: "configured-staff@test.local",
      role: "therapist",
      createdBy: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(defaultStaffInvite.staffInvites[0].expiresAt, "2026-06-05T01:00:00.000Z", "staff invite should use configured default days");
  const defaultOwnerInvite = createStoreOwnerInvite(
    configured,
    {
      storeName: "配置有效期门店",
      ownerName: "配置老板",
      phone: "13900008888",
      account: "configured-owner@test.local",
      createdBy: "u_superadmin",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(defaultOwnerInvite.storeOwnerInvites[0].expiresAt, "2026-06-05T01:00:00.000Z", "store owner invite should use configured default days");
}

{
  const registered = registerStore(
    cloneSeed(),
    {
      storeName: "测试美业门店",
      ownerName: "测试老板",
      phone: "13900000000",
      address: "测试地址",
      account: "boss@test.local",
      password: "secret",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(registered.storeProfiles[0].name, "测试美业门店", "store registration should update store profile");
  assert.notEqual(registered.storeProfiles[0].id, cloneSeed().storeProfiles[0].id, "store registration should create an independent store id");
  assert.equal(registered.storeProfiles.length, cloneSeed().storeProfiles.length + 1, "store registration should keep existing stores");
  assert.equal(registered.authUsers[0].role, "owner", "store registration should create owner account");
  assert.equal(registered.authUsers[0].storeId, registered.storeProfiles[0].id, "owner account should belong to the new store");
  assert.equal(registered.staff[0].accountId, registered.authUsers[0].id, "owner staff should bind account");
  assert.equal(registered.staff[0].storeId, registered.storeProfiles[0].id, "owner staff should belong to the new store");
  const storeStaffInviteCode = storeStaffInviteCodeForStoreUser(registered.authUsers[0], registered.authUsers);
  assert.ok(storeStaffInviteCode, "owner should have a stable staff invite code after registration");
  const joinedByStoreInvite = joinInviteByCode(
    registered,
    { inviteCode: storeStaffInviteCode, name: "门店新员工", account: "store-staff@test.local", password: "secret" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(joinedByStoreInvite.authUsers[0].account, "store-staff@test.local", "store staff invite should create employee login account");
  assert.equal(joinedByStoreInvite.authUsers[0].role, "therapist", "store staff invite should create employee role");
  assert.equal(joinedByStoreInvite.staff[0].role, "员工", "store staff invite should create employee profile");
  assert.throws(
    () =>
      createStaffInvite(
        registered,
        { staffId: registered.staff[0].id, account: "owner-as-staff@test.local", role: "manager", createdBy: "u_manager", validDays: 3 },
        { idFactory: testId, now: fixedNow },
      ),
    /老板账号不走员工邀请码/,
    "owner should not use staff invite flow",
  );
  const ownerProjectServiceCheckout = checkoutOrder(
    registered,
    {
      customerId: "c1",
      staffId: registered.staff[0].id,
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(ownerProjectServiceCheckout.orders[0].staffId, registered.staff[0].id, "owner should be allowed as project service staff for checkout");
  assert.equal(ownerProjectServiceCheckout.orders[0].serviceId, "v1", "owner project service checkout should keep selected service");
  const anonymousProjectServiceCheckout = checkoutOrder(
    registered,
    {
      staffId: registered.staff[0].id,
      serviceId: "v1",
      guestName: "到店新客",
      guestPhone: "13900000001",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.ok(anonymousProjectServiceCheckout.orders[0].customerId, "project service checkout should bind walk-in customer for signature");
  assert.equal(anonymousProjectServiceCheckout.customerSignatures[0].orderId, anonymousProjectServiceCheckout.orders[0].id, "project service checkout should create customer signature");
  assert.throws(
    () =>
      checkoutOrder(
        registered,
        {
          staffId: registered.staff[0].id,
          serviceId: "v1",
          guestName: "手机号错误客",
          guestPhone: "139000000001",
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /客户电话必须为 11 位数字/,
    "checkout should reject overlong walk-in phone",
  );
  const ownerProductCheckout = checkoutOrder(
    registered,
    {
      staffId: registered.staff[0].id,
      productItems: [{ productId: "p4", quantity: 1 }],
      guestName: "商品新客",
      guestPhone: "13900000002",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(ownerProductCheckout.orders[0].staffId, registered.staff[0].id, "owner should be allowed as cashier for product-only checkout");
  assert.equal(ownerProductCheckout.orders[0].paidAmount, 199, "product-only checkout should keep product amount");
  assert.ok(ownerProductCheckout.orders[0].customerId, "product-only checkout should bind walk-in customer for signature");
  assert.equal(ownerProductCheckout.customerSignatures[0].orderId, ownerProductCheckout.orders[0].id, "product-only checkout should create customer signature");
  assert.throws(
    () =>
      checkoutOrder(
        ownerProductCheckout,
        {
          customerId: ownerProductCheckout.orders[0].customerId,
          staffId: registered.staff[0].id,
          productItems: [{ productId: "p4", quantity: 1 }],
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /重复提交/,
    "checkout should reject immediate duplicate product submissions",
  );
  const ownerProductCheckoutLater = checkoutOrder(
    ownerProductCheckout,
    {
      customerId: ownerProductCheckout.orders[0].customerId,
      staffId: registered.staff[0].id,
      productItems: [{ productId: "p4", quantity: 1 }],
      payMethod: "微信",
    },
    { idFactory: testId, now: () => "2026-05-24T01:00:31.000Z" },
  );
  assert.equal(ownerProductCheckoutLater.orders.length, ownerProductCheckout.orders.length + 1, "same product order should be allowed after duplicate window");
  assert.throws(
    () =>
      checkoutOrder(
        {
          ...registered,
          products: registered.products.map((product) => (product.id === "p4" ? { ...product, price: 0 } : product)),
        },
        {
          staffId: registered.staff[0].id,
          productItems: [{ productId: "p4", quantity: 1 }],
          guestName: "零价测试客",
          guestPhone: "13900000003",
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /售价为 0/,
    "product checkout should reject sale products without a price",
  );
  assert.throws(
    () =>
      createAppointment(
        registered,
        {
          customerId: "c1",
          staffId: registered.staff[0].id,
          serviceId: "v1",
          startAt: "2026-05-25T11:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /服务人员不存在或已停用/,
    "owner should not be selected as service staff for appointment",
  );
  assert.throws(
    () =>
      createAppointment(
        registered,
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: "2026-05-23T11:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不能早于当前时间/,
    "appointment creation should reject past time",
  );
  const platformAdmin = cloneSeed().authUsers.find((user) => user.role === "superadmin");
  assert.ok(platformAdmin, "test fixture should include a platform admin");
  const ownerUser = cloneSeed().authUsers.find((user) => user.role === "owner");
  assert.ok(ownerUser, "test fixture should include an owner");
  assert.ok(platformInviteCodeForPlatformAdmin(platformAdmin, cloneSeed().authUsers), "platform admin should have a system invite code");
  assert.equal(platformInviteCodeForPlatformAdmin(ownerUser, cloneSeed().authUsers), undefined, "owner should not have a platform system invite code");
  assert.throws(
    () =>
      joinInviteByCode(
        cloneSeed(),
        {
          inviteCode: "YC8M6P",
          storeName: "固定码门店",
          name: "固定码老板",
          phone: "13900001000",
          address: "固定码地址",
          account: "fixed-owner@test.local",
          password: "secret",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /邀请不存在或已失效/,
    "fixed owner invite code should not be accepted",
  );
  const ownerJoined = joinInviteByCode(
    cloneSeed(),
    {
      inviteCode: platformInviteCodeForUser(platformAdmin, cloneSeed().authUsers),
      storeName: "邀请制门店",
      name: "邀请老板",
      phone: "13900001111",
      address: "邀请地址",
      account: "invited-owner@test.local",
      password: "secret",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(ownerJoined.storeOwnerApplications[0].status, "待审批", "owner invite should create pending application");
  assert.equal(ownerJoined.storeOwnerApplications[0].storeName, "邀请制门店", "owner invite should keep submitted store");
  assert.equal(ownerJoined.storeOwnerApplications[0].account, "invited-owner@test.local", "owner invite should keep submitted account");
  assert.equal(ownerJoined.notifications[0].targetId, ownerJoined.storeOwnerApplications[0].id, "owner invite should notify admin about pending store application");
  assert.ok(ownerJoined.notifications[0].audienceRoles.includes("superadmin"), "owner invite notification should be visible to admin");
  assert.equal(ownerJoined.notifications[0].view, "permissions", "owner invite notification should route to permission approvals");
  assert.equal(ownerJoined.storeProfiles.length, cloneSeed().storeProfiles.length, "owner invite should not create store before approval");
  assert.equal(ownerJoined.authUsers.length, cloneSeed().authUsers.length, "owner invite should not create user before approval");
  const platformInviteCode = platformInviteCodeForUser(platformAdmin, cloneSeed().authUsers);
  const ownerInviteCodes = [platformInviteCode, "BOSS-UNIQUE"];
  const ownerInvite = createStoreOwnerInvite(
    cloneSeed(),
    {
      storeName: "唯一邀请码门店",
      ownerName: "唯一老板",
      phone: "13900002222",
      address: "唯一地址",
      account: "unique-owner@test.local",
      createdBy: platformAdmin.id,
      validDays: 7,
    },
    {
      idFactory: (prefix) => (prefix === "boss" ? ownerInviteCodes.shift() ?? "BOSS-FALLBACK" : testId(prefix)),
      now: fixedNow,
    },
  );
  assert.equal(ownerInvite.storeOwnerInvites[0].inviteCode, "BOSS-UNIQUE", "store owner invite should avoid platform invite code collisions");
  const updatedStore = updateStoreProfile(registered, {
    storeId: "store1",
    name: "测试皮肤管理中心",
    phone: "13900000002",
    address: "测试新地址",
    businessHours: "09:30 - 22:00",
    roomNames: ["护理房 A", "护理房 B", "VIP 房"],
    maintenanceRoomNames: ["护理房 B"],
  });
  const configuredStore = updatedStore.storeProfiles.find((store) => store.id === "store1");
  assert.equal(configuredStore?.name, "测试皮肤管理中心", "store profile should update store name");
  assert.equal(configuredStore?.businessHours, "09:30 - 22:00", "store profile should update business hours");
  assert.deepEqual(configuredStore?.roomNames, ["护理房 A", "护理房 B", "VIP 房"], "store profile should update appointment room names");
  assert.deepEqual(configuredStore?.maintenanceRoomNames, ["护理房 B"], "store profile should update specified maintenance rooms");
  const roomSchedulingStore: AppData = {
    ...updatedStore,
    appointments: [],
    staffShifts: [],
    staffUnavailableSlots: [],
  };
  assert.throws(
    () =>
      createAppointment(
        roomSchedulingStore,
        {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-07-10T02:00:00.000Z",
          roomName: "护理房 B",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /维护中/,
    "appointment should reject rooms marked as maintenance",
  );
  const roomBookedStore = createAppointment(
    roomSchedulingStore,
    {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-07-10T02:00:00.000Z",
      roomName: "护理房 A",
    },
    { idFactory: testId, now: fixedNow },
  );
  const firstRoomAppointmentId = roomBookedStore.appointments[0].id;
  assert.equal(roomBookedStore.appointments[0].endAt, "2026-07-10T03:00:00.000Z", "appointment should derive an end time from service duration when missing");
  const longRoomBookedStore = createAppointment(
    roomSchedulingStore,
    {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-07-10T07:00:00.000Z",
      endAt: "2026-07-10T09:00:00.000Z",
      roomName: "护理房 A",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(longRoomBookedStore.appointments[0].endAt, "2026-07-10T09:00:00.000Z", "appointment should persist explicit end time");
  assert.throws(
    () =>
      createAppointment(
        longRoomBookedStore,
        {
          customerId: "c2",
          staffId: "s1",
          serviceId: "v1",
          startAt: "2026-07-10T08:30:00.000Z",
          endAt: "2026-07-10T09:30:00.000Z",
          roomName: "护理房 A",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /该房间在此时间段已有预约/,
    "appointment should reject conflicts across an explicit time range",
  );
  assert.throws(
    () =>
      createAppointment(
        roomBookedStore,
        {
          customerId: "c2",
          staffId: "s1",
          serviceId: "v1",
          startAt: "2026-07-10T02:30:00.000Z",
          roomName: "护理房 A",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /该房间在此时间段已有预约/,
    "appointment should reject overlapping bookings for the same room",
  );
  const legacyRoomlessStore: AppData = {
    ...roomSchedulingStore,
    appointments: [
      {
        id: "a_legacy_roomless",
        customerId: "c1",
        staffId: "s3",
        serviceId: "v1",
        startAt: "2026-07-10T02:00:00.000Z",
        status: "待确认",
        note: "旧预约未保存房间",
      },
    ],
  };
  assert.throws(
    () =>
      createAppointment(
        legacyRoomlessStore,
        {
          customerId: "c2",
          staffId: "s1",
          serviceId: "v1",
          startAt: "2026-07-10T02:30:00.000Z",
          roomName: "护理房 A",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /该房间在此时间段已有预约/,
    "appointment should reject the room temporarily assigned to a legacy roomless booking",
  );
  const autoRoomFromLegacyStore = createAppointment(
    legacyRoomlessStore,
    {
      customerId: "c2",
      staffId: "s1",
      serviceId: "v1",
      startAt: "2026-07-10T02:30:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(autoRoomFromLegacyStore.appointments[0].roomName, "VIP 房", "appointment should skip maintenance and legacy-occupied rooms when auto-selecting a room");
  const roomBookedAgainStore = createAppointment(
    roomBookedStore,
    {
      customerId: "c2",
      staffId: "s1",
      serviceId: "v1",
      startAt: "2026-07-10T03:00:00.000Z",
      roomName: "护理房 A",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(roomBookedAgainStore.appointments[0].roomName, "护理房 A", "appointment should allow the same room after the prior booking ends");
  const rescheduleConflictStore = createAppointment(
    roomBookedStore,
    {
      customerId: "c2",
      staffId: "s1",
      serviceId: "v1",
      startAt: "2026-07-10T04:00:00.000Z",
      roomName: "护理房 A",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      rescheduleAppointment(
        rescheduleConflictStore,
        {
          appointmentId: firstRoomAppointmentId,
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-07-10T04:30:00.000Z",
          roomName: "护理房 A",
        },
        { now: fixedNow },
      ),
    /该房间在此时间段已有预约/,
    "appointment reschedule should reject overlapping bookings for the same room",
  );
  const disabledStore = updateStoreStatus(updatedStore, { storeId: updatedStore.storeProfiles[0].id, status: "disabled", userId: "u_superadmin" }, { idFactory: testId, now: fixedNow });
  assert.equal(disabledStore.storeProfiles[0].status, "disabled", "admin should disable store");
  assert.equal(disabledStore.operationLogs[0].action, "停用门店", "store status should write operation log");
  const avatarAssetUrl = "/api/assets/avatars/u_manager/test-avatar.jpg";
  const updatedAccount = updateAccountProfile(cloneSeed(), { userId: "u_manager", name: "新主管名", avatarUrl: avatarAssetUrl });
  assert.equal(updatedAccount.authUsers.find((user) => user.id === "u_manager")?.name, "新主管名", "account profile should update auth user name");
  assert.equal(updatedAccount.authUsers.find((user) => user.id === "u_manager")?.avatarUrl, avatarAssetUrl, "account profile should persist uploaded asset avatar URL");
  assert.equal(updatedAccount.staff.find((staff) => staff.id === "s1")?.name, "新主管名", "account profile should sync bound staff name");
  assert.throws(
    () => updateAccountProfile(cloneSeed(), { userId: "u_manager", name: "新主管名", avatarUrl: "data:image/png;base64,AA==" }),
    /头像文件过大/,
    "account profile should reject inline image blobs",
  );
  const disabledAccount = updateAuthUserStatus(cloneSeed(), { userId: "u_frontdesk", status: "disabled", operatedBy: "u_superadmin" });
  assert.equal(disabledAccount.authUsers.find((user) => user.id === "u_frontdesk")?.status, "disabled", "admin should disable account");
  assert.equal(disabledAccount.operationLogs[0].action, "停用账号", "account status should write operation log");
  assert.throws(
    () => updateAuthUserStatus(cloneSeed(), { userId: "u_superadmin", status: "disabled", operatedBy: "u_superadmin" }),
    /不能停用当前登录账号/,
    "admin should not disable current account",
  );
  assert.throws(
    () => updateStoreProfile(updatedStore, { name: "", phone: "13900000002", address: "测试新地址", businessHours: "09:30 - 22:00" }),
    /请输入门店名称/,
    "store profile should reject empty store name",
  );

  const withStaff = addStaffMember(
    cloneSeed(),
    { name: "新员工", phone: "13900000001", role: "员工", baseSalary: 6000, commissionRate: 0.1 },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withStaff.staff[0].name, "新员工", "staff management should create staff");
  const updatedStaff = updateStaffMember(withStaff, { staffId: withStaff.staff[0].id, status: "inactive", baseSalary: 6200 });
  assert.equal(updatedStaff.staff[0].status, "inactive", "staff management should disable staff");
  assert.equal(updatedStaff.staff[0].baseSalary, 6200, "staff management should update salary");
  const editedStaff = updateStaffMember(updatedStaff, {
    staffId: updatedStaff.staff[0].id,
    name: "新主管",
    phone: "13900000009",
    role: "主管",
    commissionRate: 0.18,
  });
  assert.equal(editedStaff.staff[0].name, "新主管", "staff management should update name");
  assert.equal(editedStaff.staff[0].role, "主管", "staff management should update role");
  assert.equal(editedStaff.staff[0].commissionRate, 0.18, "staff management should update commission rate");
  assert.throws(
    () => updateStaffMember(editedStaff, { staffId: editedStaff.staff[0].id, phone: "" }),
    /请输入员工手机号/,
    "staff management should reject empty phone",
  );
  assert.throws(
    () => updateStaffMember(editedStaff, { staffId: editedStaff.staff[0].id, phone: "139000000001" }),
    /员工手机号必须为 11 位数字/,
    "staff management should reject overlong phone",
  );

  const invited = createStaffInvite(
    withStaff,
    { staffId: withStaff.staff[0].id, account: "therapist-new@test.local", role: "therapist", createdBy: "u_manager", validDays: 3 },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(invited.staffInvites[0].status, "待加入", "staff invite should be pending");
  assert.equal(invited.staffInvites[0].expiresAt, "2026-05-27T01:00:00.000Z", "staff invite should persist expiry");
  const joined = joinStaffInvite(
    invited,
        { inviteCode: invited.staffInvites[0].inviteCode, name: "新员工", password: "secret" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(joined.staffInvites[0].status, "已加入", "staff invite should mark joined");
  assert.equal(joined.authUsers[0].account, "therapist-new@test.local", "staff invite should create login account");
  assert.equal(joined.staff[0].accountId, joined.authUsers[0].id, "joined account should bind to staff");

  const expiredInvite = createStaffInvite(
    withStaff,
    { staffId: withStaff.staff[0].id, account: "expired-staff@test.local", role: "therapist", createdBy: "u_manager", validDays: 1 },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      joinStaffInvite(
        expiredInvite,
        { inviteCode: expiredInvite.staffInvites[0].inviteCode, name: "过期员工", password: "secret" },
        { idFactory: testId, now: () => "2026-05-26T01:00:00.000Z" },
      ),
    /邀请码已过期/,
    "staff invite should reject expired code",
  );

  const revoked = revokeStaffInvite(
    expiredInvite,
    { inviteId: expiredInvite.staffInvites[0].id, revokedBy: "u_manager" },
    { now: fixedNow },
  );
  assert.equal(revoked.staffInvites[0].status, "已作废", "staff invite should be revocable");
  assert.equal(revoked.staffInvites[0].revokedBy, "u_manager", "staff invite should preserve revoke operator");
  const withSecondStaff = addStaffMember(
    invited,
    { name: "第二员工", phone: "13900000003", role: "员工", baseSalary: 5000, commissionRate: 0.08 },
    { idFactory: testId, now: fixedNow },
  );
  const staffInviteCodes = [invited.staffInvites[0].inviteCode, platformInviteCode, "JOIN-UNIQUE"];
  const uniqueStaffInvite = createStaffInvite(
    withSecondStaff,
    { staffId: withSecondStaff.staff[0].id, account: "therapist-second@test.local", role: "therapist", createdBy: "u_manager", validDays: 3 },
    {
      idFactory: (prefix) => (prefix === "join" ? staffInviteCodes.shift() ?? "JOIN-FALLBACK" : testId(prefix)),
      now: fixedNow,
    },
  );
  assert.equal(uniqueStaffInvite.staffInvites[0].inviteCode, "JOIN-UNIQUE", "staff invite should avoid existing and platform invite code collisions");
}

{
  const withTag = createTagDefinition(
    cloneSeed(),
    { name: "  熟客  ", scope: "客户", color: "#db2777" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withTag.tagDefinitions[0].name, "熟客", "tag management should create normalized tag");
  assert.equal(withTag.tagDefinitions[0].scope, "客户", "tag management should persist scope");
  assert.equal(withTag.tagDefinitions[0].color, "#db2777", "tag management should persist color");
  assert.throws(
    () => createTagDefinition(withTag, { name: "熟客", scope: "客户" }, { idFactory: testId, now: fixedNow }),
    /标签已存在/,
    "tag management should reject duplicate tags in the same scope",
  );

  const assigned = {
    ...withTag,
    customers: withTag.customers.map((customer) => (customer.id === "c1" ? { ...customer, tags: [...customer.tags, "熟客"] } : customer)),
  };
  const renamed = updateTagDefinition(assigned, { tagId: withTag.tagDefinitions[0].id, name: "稳定复购", status: "停用" });
  assert.equal(renamed.tagDefinitions[0].status, "停用", "tag management should update status");
  assert.ok(renamed.customers.find((customer) => customer.id === "c1")?.tags.includes("稳定复购"), "renaming a tag should update customer tags");
}

{
  const recipeData = {
    ...cloneSeed(),
    services: [
      {
        id: "v_recipe",
        name: "复合耗材护理",
        category: "皮肤管理",
        price: 520,
        duration: 70,
        consumables: [
          { productId: "p3", quantity: 2 },
          { productId: "p4", quantity: 5 },
          { productId: "p2", quantity: 0.5 },
        ],
      },
      ...cloneSeed().services,
    ],
  };
  const checkedOut = checkoutOrder(
    recipeData,
    { customerId: "c1", staffId: "s2", serviceId: "v_recipe", payMethod: "微信" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(checkedOut, "p3"), 7, "service recipe should consume tracked package product");
  assert.equal(productStock(checkedOut, "p4"), 23.5, "service recipe should consume configured product units");
  assert.equal(productStock(checkedOut, "p2"), 12, "service recipe should ignore liquid products");
  assert.equal(checkedOut.inventoryLogs.filter((item) => item.type === "服务消耗").length, 2, "service recipe should log configured product consumables");

  const refunded = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, reason: "配方项目退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(refunded, "p3"), 9, "recipe refund should restore tracked package product");
  assert.equal(productStock(refunded, "p4"), 24, "recipe refund should restore configured product units");
  assert.equal(productStock(refunded, "p2"), 12, "recipe refund should keep ignored liquid products unchanged");
}

{
  const usageData = {
    ...cloneSeed(),
    products: cloneSeed().products.map((product) => (product.id === "p3" ? { ...product, serviceUnit: "片", serviceUnitsPerStockUnit: 5 } : product)),
    services: [
      {
        id: "v_usage",
        name: "按片数扣减护理",
        category: "皮肤管理",
        price: 520,
        duration: 70,
        consumables: [
          { productId: "p3", quantity: 1 },
          { productId: "p2", quantity: 0 },
        ],
      },
      ...cloneSeed().services,
    ],
  };
  const checkedOut = checkoutOrder(
    usageData,
    { customerId: "c1", staffId: "s2", serviceId: "v_usage", payMethod: "微信" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(checkedOut, "p3"), 8.8, "tracked package should deduct service units by package size");
  assert.equal(productStock(checkedOut, "p2"), 12, "zero product usage should not deduct stock");
  assert.equal(checkedOut.inventoryLogs.find((item) => item.type === "服务消耗")?.delta, -0.2, "service log should preserve fractional package deduction");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(data.orders.length, 1, "checkout should create one order");
  assert.equal(data.orders[0].totalAmount, 597, "order total should include service and retail product");
  assert.equal(productStock(data, "p1"), 18, "liquid service product should not reduce stock");
  assert.equal(productStock(data, "p4"), 23, "retail product stock should decrease");
  assert.equal(data.inventoryLogs.length, 1, "only stock-countable products should log");
  const orderCommissions = data.commissions.filter((item) => item.orderId === data.orders[0].id);
  assert.equal(orderCommissions.length, 2, "checkout should create service and sales commissions");
  assert.equal(orderCommissions.find((item) => item.type === "服务提成")?.amount, 48, "service commission should be based on service amount");
  assert.equal(orderCommissions.find((item) => item.type === "销售提成")?.amount, 24, "sales commission should be based on product amount");
  assert.equal(orderCommissions.reduce((sum, item) => sum + item.amount, 0), 72, "commission total should stay consistent");
  assert.equal(orderCommissions[0].rate, 0.12, "commission should persist staff commission rate");
  assert.equal(data.operationLogs.length, 0, "pure business checkout should not require operation log");

  const summary = reportSummary(data);
  assert.equal(summary.revenue, 597, "report revenue should match paid amount");
  assert.equal(summary.serviceCount, 1, "report service count should track paid orders");
  assert.equal(summary.commission, 72, "report commission should aggregate commission records");

  const settled = settleCommissions(data, { userId: "u_manager" }, { idFactory: testId, now: fixedNow });
  assert.equal(settled.commissionSettlements[0].type, "员工提成", "settlement should create staff commission batch");
  assert.equal(settled.commissionSettlements[0].amount, 72, "settlement should summarize pending commission amount");
  assert.ok(settled.commissions.every((item) => item.status === "已结算" && item.settlementId === settled.commissionSettlements[0].id), "settlement should stamp commission records");
}

{
  const customRateData = checkoutOrder(
    {
      ...cloneSeed(),
      staff: cloneSeed().staff.map((staff) => (staff.id === "s2" ? { ...staff, commissionRate: 0.2 } : staff)),
    },
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(customRateData.commissions[0].rate, 0.2, "commission should use staff profile commission rate");
  assert.equal(customRateData.commissions[0].amount, 80, "custom staff rate should change commission amount");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      collaboratorStaffIds: ["s1"],
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );

  const commissions = data.commissions.filter((item) => item.orderId === data.orders[0].id);
  assert.equal(commissions.length, 2, "collaborative checkout should create split commissions");
  assert.deepEqual(
    commissions.map((item) => item.staffId).sort(),
    ["s1", "s2"],
    "split commission should include primary and collaborator staff",
  );
  assert.equal(commissions.reduce((sum, item) => sum + item.amount, 0), 48, "split commissions should preserve total commission");
}

{
  const seed = cloneSeed();
  const checkedOut = checkoutOrder(
    seed,
    {
      customerId: "c3",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].distributorId, undefined, "base checkout should not attach distributor");
  assert.equal(checkedOut.distributors.length, seed.distributors.length, "base checkout should not create distributors");
  assert.equal(checkedOut.referralRelations.length, seed.referralRelations.length, "base checkout should not create referral relations");
  assert.equal(checkedOut.distributionCommissions.length, seed.distributionCommissions.length, "base checkout should not create distribution commissions");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(data, "m1").balance, 2202, "stored-value card should deduct service price");
  assert.equal(productStock(data, "p1"), 18, "member-card checkout should ignore liquid service product stock");
  assert.equal(data.memberCardTransactions[0].type, "消费", "member card checkout should write card transaction");
  assert.equal(data.memberCardTransactions[0].amountDelta, -398, "stored-value transaction should record amount delta");
}

{
  const data = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c3",
      staffId: "s1",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m2",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(data, "m2").remainingTimes, 5, "times card should deduct one use");
  assert.equal(data.memberCardTransactions[0].timesDelta, -1, "times card transaction should record times delta");
}

{
  const blocked = createStaffUnavailableSlot(
    cloneSeed(),
    {
      staffId: "s3",
      startAt: "2026-05-26T02:00:00.000Z",
      endAt: "2026-05-26T03:00:00.000Z",
      reason: "员工培训",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(blocked.staffUnavailableSlots[0].reason, "员工培训", "unavailable slot should be recorded");
  assert.equal(blocked.operationLogs[0].action, "锁定员工时间", "unavailable slot should write operation log");

  assert.throws(
    () =>
      createAppointment(
        blocked,
        {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-05-26T02:15:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不可预约/,
    "appointment creation should reject unavailable staff slot",
  );
}

{
  const configured = upsertOnlineStorefront(
    cloneSeed(),
    {
      shareCode: "yich-online",
      status: "启用",
      headline: "一宸线上预约",
      description: "客户在线提交到店预约意向",
      enabledServiceIds: ["v1"],
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(configured.onlineStorefronts[0].shareCode, "yich-online", "online storefront should save share code");

  const noAvailableStaff = {
    ...configured,
    staffUnavailableSlots: configured.staff.map((staff) => ({
      id: testId("su"),
      staffId: staff.id,
      startAt: "2026-05-30T02:00:00.000Z",
      endAt: "2026-05-30T03:00:00.000Z",
      reason: "线上预约占用校验",
      createdBy: "u_manager",
      createdAt: fixedNow(),
    })),
  };
  assert.throws(
    () =>
      createOnlineBookingRequest(
        noAvailableStaff,
        {
          shareCode: "yich-online",
          customerName: "线上客户",
          phone: "13700000009",
          serviceId: "v1",
          preferredAt: "2026-05-30T02:15:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /暂无可预约服务人员/,
    "online booking should reject a time with no available staff",
  );
  assert.throws(
    () =>
      createOnlineBookingRequest(
        configured,
        {
          shareCode: "yich-online",
          customerName: "线上客户",
          phone: "137000000091",
          serviceId: "v1",
          preferredAt: "2026-05-30T02:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /手机号必须为 11 位数字/,
    "online booking should reject overlong customer phone",
  );

  const requested = createOnlineBookingRequest(
    configured,
    {
      shareCode: "yich-online",
      customerName: "线上客户",
      phone: "13700000009",
      serviceId: "v1",
      preferredAt: "2026-05-30T02:00:00.000Z",
      note: "想咨询补水护理",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(requested.onlineBookingRequests[0].status, "待处理", "online booking request should be pending");

  const converted = convertOnlineBookingRequest(
    requested,
    { requestId: requested.onlineBookingRequests[0].id, staffId: "s3", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(converted.onlineBookingRequests[0].status, "已转预约", "online booking request should convert to appointment");
  assert.equal(converted.appointments[0].customerId, converted.customers[0].id, "converted appointment should bind new customer");
  assert.equal(converted.customers[0].source, "线上预约", "converted online request should create sourced customer");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "客户取消",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(refunded.orders[0].status, "已退款", "refund should update order status");
  assert.equal(refunded.refunds[0].amount, 597, "refund should preserve refund amount");
  assert.equal(productStock(refunded, "p1"), 18, "refund should restore service product stock");
  assert.equal(productStock(refunded, "p4"), 24, "refund should restore retail product stock");
  assert.equal(refunded.commissions[0].status, "已冲销", "refund should reverse commission");
  assert.equal(refunded.operationLogs[0].action, "订单退款", "refund should write operation log");

  const summary = reportSummary(refunded);
  assert.equal(summary.revenue, 0, "refunded order should not count as revenue");
  assert.equal(summary.refundAmount, 597, "report should include refund amount");
  assert.equal(summary.commission, 0, "reversed commission should not count in report");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "会员卡退款",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(refunded, "m1").balance, 2600, "member-card refund should restore balance");
  assert.equal(refunded.memberCardTransactions[0].type, "退款", "member-card refund should write refund transaction");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      productId: "p4",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const refunded = refundOrder(
    checkedOut,
    {
      orderId: checkedOut.orders[0].id,
      reason: "部分退款",
      userId: "u_manager",
      amount: 100,
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(refunded.orders[0].status, "部分退款", "partial refund should keep order open");
  assert.equal(refunded.orders[0].paidAmount, 497, "partial refund should reduce paid amount");
  assert.equal(productStock(refunded, "p1"), 18, "partial refund should keep ignored liquid product stock unchanged");
  assert.equal(productStock(refunded, "p4"), 23, "partial refund should not restore retail stock");
  assert.ok(refunded.commissions[0].amount < checkedOut.commissions[0].amount, "partial refund should reduce commission");
}

{
  const before = cloneSeed();
  const beforePoints = before.customers.find((customer) => customer.id === "c1")?.points ?? 0;
  const opened = openMemberCard(
    before,
    {
      customerId: "c1",
      name: "重复录入套餐卡",
      type: "套餐卡",
      serviceIds: ["v1", "v2"],
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 3, remainingTimes: 3 },
        { serviceId: "v2", totalTimes: 2, remainingTimes: 2 },
      ],
      paidAmount: 1000,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
      staffId: "s1",
    },
    { idFactory: testId, now: fixedNow },
  );
  const openedCard = opened.memberCards[0];
  assert.equal(memberCardVoidEligibility(openedCard, opened.memberCardTransactions).eligible, true, "unused opening should be eligible for void");
  assert.equal(opened.customers.find((customer) => customer.id === "c1")?.points, beforePoints + 100, "opening should award points before correction");

  const voided = voidMemberCardOpening(
    opened,
    { memberCardId: openedCard.id, reason: "重复开卡录入", userId: "u_manager", staffId: "s1" },
    { idFactory: testId, now: fixedNow },
  );
  const correctedCard = card(voided, openedCard.id);
  assert.equal(correctedCard.status, "已作废", "void should mark an erroneous opening as voided");
  assert.equal(correctedCard.remainingTimes, 0, "void should clear card remaining times");
  assert.ok(correctedCard.serviceEntitlements?.every((item) => item.remainingTimes === 0), "void should clear every project entitlement");
  assert.equal(voided.customers.find((customer) => customer.id === "c1")?.points, beforePoints, "void should reverse opening points");
  assert.equal(voided.memberCardTransactions[0].type, "作废", "void should write a dedicated reversal transaction");
  assert.equal(memberCardCashRefund(voided.memberCardTransactions[0]), 1000, "void should reverse recorded opening cash");
  assert.equal(reportSummary(voided).revenue - reportSummary(voided).refundAmount, 0, "void should neutralize erroneous opening net revenue");
  assert.equal(voided.operationLogs[0].action, "开卡错录作废", "void should write an audit log");
  assert.throws(
    () => voidMemberCardOpening(voided, { memberCardId: openedCard.id, reason: "重复再次作废", userId: "u_manager" }),
    /已经作废/,
    "void should be idempotently blocked after completion",
  );

  const spentOpeningPoints = {
    ...opened,
    customers: opened.customers.map((customer) => customer.id === openedCard.customerId ? { ...customer, points: 0 } : customer),
  };
  assert.throws(
    () => voidMemberCardOpening(spentOpeningPoints, { memberCardId: openedCard.id, reason: "积分已经使用", userId: "u_manager" }),
    /赠送积分已被使用/,
    "void should not silently remove points after opening points have already been spent",
  );
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerId: "c1",
      name: "已使用卡",
      type: "次数卡",
      serviceIds: ["v1"],
      serviceEntitlements: [{ serviceId: "v1", totalTimes: 2, remainingTimes: 2 }],
      paidAmount: 398,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
      staffId: "s1",
    },
    { idFactory: testId, now: fixedNow },
  );
  const used = checkoutOrder(
    opened,
    { customerId: "c1", staffId: "s2", serviceId: "v1", payMethod: "会员卡", cardId: opened.memberCards[0].id },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(memberCardVoidEligibility(card(used, opened.memberCards[0].id), used.memberCardTransactions).eligible, false, "used card should not be eligible for void");
  assert.throws(
    () => voidMemberCardOpening(used, { memberCardId: opened.memberCards[0].id, reason: "尝试错录作废", userId: "u_manager" }),
    /已有消费流水/,
    "void should refuse cards with consumption history",
  );
}

{
  assert.throws(
    () =>
      refundMemberCard(
        cloneSeed(),
        {
          memberCardId: "m1",
          reason: "客户退卡",
          refundAmount: 500,
          payMethod: "微信",
          signatureId: "",
          userId: "u_manager",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /请先生成客户退费签名/,
    "member card refund should require customer signature",
  );
  const signedSeed = signedRefundSignature(cloneSeed(), "c1");
  const refundedCard = refundMemberCard(
    signedSeed,
    {
      memberCardId: "m1",
      reason: "客户退卡",
      refundAmount: 500,
      payMethod: "微信",
      signatureId: signedSeed.customerSignatures[0].id,
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(refundedCard, "m1").status, "已退卡", "member card refund should close card");
  assert.equal(card(refundedCard, "m1").balance, 0, "member card refund should clear balance");
  assert.equal(refundedCard.memberCardTransactions[0].type, "退卡", "member card refund should write card transaction");
  assert.equal(refundedCard.memberCardTransactions[0].paidAmount, 500, "member card refund should preserve actual refund amount");
  assert.equal(refundedCard.memberCardTransactions[0].payMethod, "微信", "member card refund should preserve refund payment method");
  assert.equal(memberCardCashRefund(refundedCard.memberCardTransactions[0]), 500, "member card refund should count as cash refund");
  assert.equal(reportSummary(refundedCard).refundAmount, 500, "report should include member card refund amount");
  assert.equal(refundedCard.operationLogs[0].action, "会员退卡", "member card refund should write operation log");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerId: "c1",
      name: "分项目退卡验证",
      type: "套餐卡",
      serviceIds: ["v1", "v2"],
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 2, remainingTimes: 2 },
        { serviceId: "v2", totalTimes: 3, remainingTimes: 3 },
      ],
      paidAmount: 500,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signedRefundSignature(opened, "c1", "分项目退卡验证", 500, "微信");
  const refunded = refundMemberCard(
    signed,
    {
      memberCardId: opened.memberCards[0].id,
      reason: "客户正式退卡",
      refundAmount: 500,
      payMethod: "微信",
      signatureId: signed.customerSignatures[0].id,
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.ok(card(refunded, opened.memberCards[0].id).serviceEntitlements?.every((item) => item.remainingTimes === 0), "formal refund should clear every project entitlement");
}

{
  assert.throws(
    () =>
      checkoutOrder(
        cloneSeed(),
        {
          customerId: "c3",
          staffId: "s1",
          serviceId: "v2",
          payMethod: "会员卡",
          cardId: "m2",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不可用于当前项目/,
    "project-bound times card should reject unmatched service",
  );
}

{
  const seed = cloneSeed();
  const conflictStartAt = seed.appointments.find((appointment) => appointment.staffId === "s2")?.startAt;
  assert.ok(conflictStartAt, "seed should include an existing therapist appointment");
  assert.throws(
    () =>
      createAppointment(
        seed,
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: conflictStartAt,
        },
        { idFactory: testId, now: fixedNow },
      ),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /已有预约/);
      assert.match(message, /小雅/);
      assert.match(message, /周女士/);
      assert.match(message, /小气泡深层清洁/);
      assert.match(message, /护理房 1/);
      return true;
    },
    "appointment creation should reject staff schedule conflict",
  );

  const data = createAppointment(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      serviceIds: ["v1", "v2"],
      startAt: "2026-05-25T02:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(data.appointments[0].staffId, "s3", "non-conflicting appointment should be created");
  assert.deepEqual(data.appointments[0].serviceIds, ["v1", "v2"], "appointment should persist multiple selected services");
  assert.equal(data.appointments[0].updatedAt, fixedNow(), "appointment should stamp update time");

  assert.throws(
    () =>
      updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已完成" }, { now: fixedNow }),
    /不能从已确认改为已完成/,
    "appointment should reject invalid status transition",
  );

  const arrived = updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已到店" }, { now: fixedNow });
  assert.equal(arrived.appointments[0].arrivedAt, fixedNow(), "arrival should keep arrival timestamp");
  const completed = updateAppointmentStatus(arrived, { appointmentId: data.appointments[0].id, status: "已完成" }, { now: fixedNow });
  assert.equal(completed.appointments[0].completedAt, fixedNow(), "completion should keep completion timestamp");
  assert.throws(
    () => rescheduleAppointment(completed, { appointmentId: data.appointments[0].id, startAt: "2026-05-25T04:00:00.000Z" }, { now: fixedNow }),
    /不能改约/,
    "completed appointment should not be rescheduled",
  );

  const rescheduled = rescheduleAppointment(
    data,
    { appointmentId: data.appointments[0].id, staffId: "s3", serviceId: "v2", startAt: "2026-05-25T05:00:00.000Z", note: "改约后到店" },
    { now: fixedNow },
  );
  assert.equal(rescheduled.appointments[0].serviceId, "v2", "reschedule should update service");
  assert.equal(rescheduled.appointments[0].endAt, "2026-05-25T05:45:00.000Z", "reschedule should derive end time from the updated service duration");
  assert.equal(rescheduled.appointments[0].rescheduledAt, fixedNow(), "reschedule should keep audit time");
  assert.throws(
    () => rescheduleAppointment(data, { appointmentId: data.appointments[0].id, staffId: "s2", startAt: conflictStartAt }, { now: fixedNow }),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /已有预约/);
      assert.match(message, /小雅/);
      assert.match(message, /周女士/);
      assert.match(message, /小气泡深层清洁/);
      assert.match(message, /护理房 1/);
      return true;
    },
    "reschedule should reject staff schedule conflict",
  );
  assert.throws(
    () => updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已取消" }, { now: fixedNow }),
    /必须填写原因/,
    "canceling an appointment should require a reason",
  );
  const canceled = updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已取消", reason: "客户临时取消" }, { now: fixedNow });
  assert.equal(canceled.appointments[0].cancelReason, "客户临时取消", "canceling should keep cancel reason");

  assert.throws(
    () =>
      checkoutOrder(
        data,
        {
          customerId: data.appointments[0].customerId,
          staffId: data.appointments[0].staffId,
          serviceId: data.appointments[0].serviceId,
          appointmentId: data.appointments[0].id,
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /只有已到店预约可以直接收银/,
    "appointment checkout should require arrived appointment",
  );

  const arrivedForCheckout = updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已到店" }, { now: fixedNow });
  const appointmentCheckout = checkoutOrder(
    arrivedForCheckout,
    {
      customerId: data.appointments[0].customerId,
      staffId: data.appointments[0].staffId,
      serviceId: "v2",
      appointmentId: data.appointments[0].id,
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(appointmentCheckout.orders[0].appointmentId, data.appointments[0].id, "checkout should link source appointment");
  assert.equal(appointmentCheckout.orders[0].serviceId, "v2", "appointment checkout should allow any selected appointment service");
  assert.equal(appointmentCheckout.appointments[0].status, "已到店", "checkout should keep source appointment waiting for customer signature");
  assert.equal(appointmentCheckout.appointments[0].completedAt, undefined, "checkout should not stamp appointment completion before signature");
  assert.equal(appointmentCheckout.customerSignatures[0].orderId, appointmentCheckout.orders[0].id, "appointment checkout should create a pending customer signature");
  assert.equal(appointmentCheckout.customerSignatures[0].status, "待签名", "appointment checkout signature should start pending");
  const signedAppointmentCheckout = signCustomerSignature(
    appointmentCheckout,
    {
      token: appointmentCheckout.customerSignatures[0].token,
      signerName: "周女士",
      signatureText: "data:image/png;base64,appointment-checkout",
    },
    { now: fixedNow },
  );
  assert.equal(signedAppointmentCheckout.appointments[0].status, "已完成", "service signature should complete source appointment");
  assert.equal(signedAppointmentCheckout.appointments[0].completedAt, fixedNow(), "service signature should stamp appointment completion");
  const implicitAppointmentId = "a_implicit_checkout_verify";
  const implicitAppointmentCheckout = checkoutOrder(
    {
      ...cloneSeed(),
      appointments: [
        {
          id: implicitAppointmentId,
          storeId: "store1",
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: "2026-05-24T00:30:00.000Z",
          endAt: "2026-05-24T01:30:00.000Z",
          roomName: "护理房 1",
          status: "已到店",
          note: "",
        },
        ...cloneSeed().appointments,
      ],
    },
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(implicitAppointmentCheckout.orders[0].appointmentId, implicitAppointmentId, "checkout should infer matching arrived appointment when appointmentId is missing");
  assert.equal(implicitAppointmentCheckout.appointments.find((item) => item.id === implicitAppointmentId)?.status, "已到店", "inferred appointment checkout should keep appointment waiting for signature");
  const signedImplicitAppointmentCheckout = signCustomerSignature(
    implicitAppointmentCheckout,
    {
      token: implicitAppointmentCheckout.customerSignatures[0].token,
      signerName: "周女士",
      signatureText: "data:image/png;base64,implicit-appointment-checkout",
    },
    { now: fixedNow },
  );
  assert.equal(signedImplicitAppointmentCheckout.appointments.find((item) => item.id === implicitAppointmentId)?.status, "已完成", "inferred appointment signature should complete the appointment");
  assert.throws(
    () =>
      checkoutOrder(
        arrivedForCheckout,
        {
          customerId: data.appointments[0].customerId,
          staffId: data.appointments[0].staffId,
          serviceId: "v3",
          appointmentId: data.appointments[0].id,
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /收银信息与预约不一致/,
    "appointment checkout should reject mismatched service",
  );

  const noServiceAppointmentData = createAppointment(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s3",
      startAt: "2026-05-26T02:00:00.000Z",
      endAt: "2026-05-26T03:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(noServiceAppointmentData.appointments[0].serviceId, "", "appointment should allow service to be confirmed at checkout");
  assert.deepEqual(noServiceAppointmentData.appointments[0].serviceIds, [], "appointment should persist an empty service list when service is checkout-confirmed");
  const arrivedNoServiceAppointment = updateAppointmentStatus(noServiceAppointmentData, { appointmentId: noServiceAppointmentData.appointments[0].id, status: "已到店" }, { now: fixedNow });
  const noServiceAppointmentCheckout = checkoutOrder(
    arrivedNoServiceAppointment,
    {
      customerId: noServiceAppointmentData.appointments[0].customerId,
      staffId: noServiceAppointmentData.appointments[0].staffId,
      serviceId: "v2",
      appointmentId: noServiceAppointmentData.appointments[0].id,
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(noServiceAppointmentCheckout.orders[0].serviceId, "v2", "checkout should choose the actual service for a service-empty appointment");
  assert.equal(noServiceAppointmentCheckout.appointments[0].status, "已到店", "checkout should keep a service-empty appointment waiting for signature");
  const signedNoServiceAppointmentCheckout = signCustomerSignature(
    noServiceAppointmentCheckout,
    {
      token: noServiceAppointmentCheckout.customerSignatures[0].token,
      signerName: "周女士",
      signatureText: "data:image/png;base64,no-service-appointment-checkout",
    },
    { now: fixedNow },
  );
  assert.equal(signedNoServiceAppointmentCheckout.appointments[0].status, "已完成", "service-empty appointment signature should complete the appointment");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: () => "2026-05-24T01:00:00.000Z" },
  );
  const closed = createDailyClose(
    checkedOut,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(closed.dailyCloses[0].revenue, 398, "daily close should summarize revenue");
  assert.equal(closed.dailyCloses[0].orderCount, 1, "daily close should count paid orders");
  assert.equal(closed.operationLogs[0].action, "财务日结", "daily close should write operation log");
}

{
  const openedStoredValue = openMemberCard(
    cloneSeed(),
    {
      customerName: "储值卡新客",
      customerPhone: "13800008889",
      type: "储值卡",
      balance: 5200,
      paidAmount: 5200,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(openedStoredValue.memberCards[0].name, "储值卡", "stored-value card should default to generic card name");
  assert.equal(openedStoredValue.memberCards[0].balance, 5200, "stored-value card should store recharge balance");
  const storedValueServicePrice = openedStoredValue.services.find((item) => item.id === "v2")?.price ?? 0;
  const storedValueCheckout = checkoutOrder(
    openedStoredValue,
    {
      customerId: openedStoredValue.customers[0].id,
      staffId: "s2",
      serviceId: "v2",
      payMethod: "会员卡",
      cardId: openedStoredValue.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(storedValueCheckout.memberCards[0].balance, 5200 - storedValueServicePrice, "stored-value card should pay for any store service when balance is enough");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "开卡新客",
      customerPhone: "13800008888",
      name: "测试十次卡",
      type: "次数卡",
      remainingTimes: 10,
      serviceId: "v1",
      paidAmount: 2980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
      staffId: "s2",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(opened.customers[0].phone, "13800008888", "open card should create registered customer");
  assert.equal(opened.memberCards[0].remainingTimes, 10, "open card should create member asset");
  assert.equal(opened.memberCardTransactions[0].paidAmount, 2980, "open card should record paid amount");
  assert.equal(opened.memberCardTransactions[0].payMethod, "微信", "open card should record payment method");
  assert.equal(opened.memberCardTransactions[0].staffId, "s2", "open card should record the handling staff");
  assert.equal(opened.customerSignatures[0].title, "开卡确认签名", "open card should create a customer confirmation signature");
  assert.equal(opened.customerSignatures[0].status, "待签名", "open card signature should wait for customer signing");
  assert.ok(opened.customerSignatures[0].content.includes("测试十次卡"), "open card signature should include card details");
  assert.throws(
    () =>
      openMemberCard(
        cloneSeed(),
        {
          customerName: "开卡新客",
          customerPhone: "138000088881",
          type: "储值卡",
          balance: 300,
          paidAmount: 300,
          payMethod: "微信",
          expiresAt: "2027-12-31",
          userId: "u_manager",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /客户手机号必须为 11 位数字/,
    "open card should reject overlong customer phone",
  );
  assert.equal(buildCashierFlowRecords(opened)[0].staffName, "小雅", "member-card cashier flow should display handling staff");
  assert.equal(memberCardCashIn(opened.memberCardTransactions[0]), 2980, "open card should count as cashier flow income");
  const remoteSignedSignature = {
    ...opened.customerSignatures[0],
    status: "已签名" as const,
    signerName: "远端客户",
    signedAt: fixedNow(),
  };
  const mergedPosData = mergePosRemoteData(opened, {
    orders: [],
    memberCardTransactions: [],
    customers: [],
    memberCards: [],
    appointments: [],
    customerSignatures: [remoteSignedSignature],
    customerServiceRecords: [],
  });
  assert.equal(mergedPosData.customerSignatures[0].status, "已签名", "fresh POS detail should override a stale retained base signature");
  const closed = createDailyClose(
    opened,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(closed.dailyCloses[0].revenue, 2980, "daily close should include member card cash-in");
  assert.equal(closed.dailyCloses[0].wechatAmount, 2980, "daily close should assign member card cash-in to payment method");
  const signedOpened = signedRefundSignature(opened, opened.memberCards[0].customerId, opened.memberCards[0].name, 980, "微信");
  const refundedOpened = refundMemberCard(
    signedOpened,
    { memberCardId: opened.memberCards[0].id, reason: "退预存", refundAmount: 980, payMethod: "微信", signatureId: signedOpened.customerSignatures[0].id, userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  const closedAfterRefund = createDailyClose(
    refundedOpened,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(closedAfterRefund.dailyCloses[0].refundAmount, 980, "daily close should include member card refund amount");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "多项目次卡客户",
      customerPhone: "13800008887",
      name: "多项目护理十次卡",
      type: "次数卡",
      remainingTimes: 10,
      serviceIds: ["v1", "v2"],
      paidAmount: 2980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.deepEqual(opened.memberCards[0].serviceIds, ["v1", "v2"], "times card should allow multiple available services");
  const checkedOutWithSecondService = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v2",
      payMethod: "会员卡",
      cardId: opened.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOutWithSecondService.memberCards[0].remainingTimes, 9, "times card should debit for any selected service");
  const checkedOutWithTwoServices = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceIds: ["v2", "v2"],
      payMethod: "会员卡",
      cardId: opened.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOutWithTwoServices.memberCards[0].remainingTimes, 8, "times card should debit one use per selected service quantity");
  assert.deepEqual(checkedOutWithTwoServices.orders[0].serviceIds, ["v2", "v2"], "order should preserve service quantities as repeated service ids");
  assert.match(checkedOutWithTwoServices.orders[0].serviceName ?? "", /x2/, "order service snapshot should include service quantity");
  assert.equal(checkedOutWithTwoServices.memberCardTransactions[0].timesDelta, -2, "member-card transaction should record service quantity debit");
  const refundedTwoServices = refundOrder(
    checkedOutWithTwoServices,
    {
      orderId: checkedOutWithTwoServices.orders[0].id,
      reason: "多份服务退款",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(refundedTwoServices.memberCards[0].remainingTimes, 10, "refund should restore every debited service quantity");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "用完项目结账客户",
      customerPhone: "13800008886",
      name: "单次体验卡",
      type: "次数卡",
      serviceEntitlements: [{ serviceId: "v1", totalTimes: 1, remainingTimes: 1 }],
      paidAmount: 398,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const cardId = opened.memberCards[0].id;
  const depleted = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(depleted, cardId).remainingTimes, 0, "single-use card should be depleted after checkout");
  assert.deepEqual(memberCardAvailableServiceIds(card(depleted, cardId)), [], "depleted service should not remain available in checkout");
  assert.equal(memberCardHasAvailableValue(card(depleted, cardId)), false, "depleted card should not count as an active customer asset");
  assert.equal(memberCardDisplayStatus(card(depleted, cardId)), "已用完", "depleted card history should be labeled as used up");

  const cashCheckout = checkoutOrder(
    depleted,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: () => "2026-05-24T02:00:00.000Z" },
  );
  const cashSignature = cashCheckout.customerSignatures.find((signature) => signature.orderId === cashCheckout.orders[0].id);
  assert.ok(cashSignature, "cash checkout should create a service signature after the project card is depleted");
  const signedCashCheckout = signCustomerSignature(
    cashCheckout,
    {
      token: cashSignature.token,
      signerName: "用完项目结账客户",
      signatureText: "data:image/png;base64,depleted-card-cash-checkout",
    },
    { idFactory: testId, now: () => "2026-05-24T02:05:00.000Z" },
  );
  assert.equal(
    signedCashCheckout.customerSignatures.find((signature) => signature.id === cashSignature.id)?.status,
    "已签名",
    "depleted project history should not block a later cash checkout signature",
  );
  assert.equal(card(signedCashCheckout, cardId).remainingTimes, 0, "cash checkout should not debit the depleted card again");

  const partiallyAvailableCard = {
    ...card(depleted, cardId),
    remainingTimes: 2,
    serviceEntitlements: [
      { serviceId: "v1", totalTimes: 1, remainingTimes: 0 },
      { serviceId: "v2", totalTimes: 2, remainingTimes: 2 },
    ],
  };
  assert.deepEqual(
    memberCardAvailableServiceIds(partiallyAvailableCard),
    ["v2"],
    "package card should keep only entitlements that still have available times",
  );
  assert.equal(memberCardHasAvailableValue(partiallyAvailableCard), true, "partially available package card should remain an active customer asset");
  assert.equal(memberCardDisplayStatus(partiallyAvailableCard), "正常", "partially available package card should remain normal");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "项目独立次数客户",
      customerPhone: "13800008889",
      name: "面护养生组合卡",
      type: "套餐卡",
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 10, remainingTimes: 10 },
        { serviceId: "v2", totalTimes: 3, remainingTimes: 3 },
      ],
      paidAmount: 3980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(opened.memberCards[0].remainingTimes, 13, "package card should sum per-service entitlement times");
  assert.throws(
    () =>
      checkoutOrder(
        opened,
        {
          customerId: opened.customers[0].id,
          staffId: "s2",
          serviceIds: ["v2", "v2", "v2", "v2"],
          payMethod: "会员卡",
          cardId: opened.memberCards[0].id,
        },
        { idFactory: testId, now: fixedNow },
      ),
    /肩颈舒缓 SPA剩余次数不足/,
    "package card should reject checkout when selected service quantity exceeds that service balance",
  );
  const checkedOutV2 = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v2",
      payMethod: "会员卡",
      cardId: opened.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOutV2.memberCards[0].remainingTimes, 12, "package card should deduct only the used service entitlement");
  assert.deepEqual(
    checkedOutV2.memberCards[0].serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
    [["v1", 10], ["v2", 2]],
    "package card should preserve independent service balances",
  );
  const refundedV2 = refundOrder(
    checkedOutV2,
    {
      orderId: checkedOutV2.orders[0].id,
      reason: "项目卡退款",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.deepEqual(
    refundedV2.memberCards[0].serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
    [["v1", 10], ["v2", 3]],
    "package card refund should restore the used service entitlement",
  );
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "SPA退费客户",
      customerPhone: "13800003980",
      name: "3980元10次SPA",
      type: "次数卡",
      remainingTimes: 10,
      serviceId: "v1",
      paidAmount: 3980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const usedOnce = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: opened.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  const quote = calculateMemberCardRefundQuote(usedOnce.memberCards[0], usedOnce.memberCardTransactions);
  assert.equal(quote.purchasedTimes, 10, "refund quote should keep purchased package times");
  assert.equal(quote.usedTimes, 1, "refund quote should derive used package times");
  assert.equal(quote.unitDeduction, 398, "refund quote should deduct one unit price per used session");
  assert.equal(quote.usedDeduction, 398, "refund quote should show mandatory used-session deduction");
  assert.equal(quote.refundableAmount, 3582, "refund quote should return paid amount minus used-session deduction");
  const signedUsedOnce = signedRefundSignature(usedOnce, usedOnce.memberCards[0].customerId, usedOnce.memberCards[0].name);
  assert.throws(
    () =>
      refundMemberCard(
        signedUsedOnce,
        { memberCardId: usedOnce.memberCards[0].id, reason: "超额退费", refundAmount: 3583, payMethod: "微信", signatureId: signedUsedOnce.customerSignatures[0].id, userId: "u_manager" },
        { idFactory: testId, now: fixedNow },
      ),
    /不能大于扣除已用次数后的可退金额/,
    "member card refund should reject amounts above used-session deduction quote",
  );
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "签名扣卡客户",
      customerPhone: "13800001980",
      name: "面部护理十次卡",
      type: "次数卡",
      remainingTimes: 10,
      serviceId: "v1",
      paidAmount: 1980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "签名扣卡客户",
      signatureText: "data:image/png;base64,abc123",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(signed.memberCards[0].remainingTimes, 9, "service completion signature should deduct one package-card use");
  assert.equal(signed.memberCardTransactions[0].type, "消费", "signature deduction should write a consumption transaction");
  assert.equal(signed.memberCardTransactions[0].timesDelta, -1, "signature deduction should record one used session");
  assert.equal(signed.orders[0].payMethod, "会员卡", "signature deduction should convert the service order to member-card redemption");
  assert.equal(signed.orders[0].cardId, opened.memberCards[0].id, "signature deduction should link the redeemed member card");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "储值签名扣卡客户",
      customerPhone: "13800001983",
      name: "全店储值卡",
      type: "储值卡",
      balance: 5000,
      paidAmount: 5000,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      cardId: opened.memberCards[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].payMethod, "微信", "stored-value service order should keep the original collection method before signature");
  assert.equal(checkedOut.orders[0].cardId, opened.memberCards[0].id, "stored-value service order should persist the planned debit source");
  assert.equal(checkedOut.memberCards[0].balance, 5000, "planned debit source should not deduct before customer signature");
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "储值签名扣卡客户",
      signatureText: "data:image/png;base64,stored-value",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(signed.memberCards[0].balance, 4602, "signature completion should deduct service amount from the selected stored-value card");
  assert.equal(signed.memberCardTransactions[0].amountDelta, -398, "stored-value signature deduction should record amount consumption");
  assert.equal(signed.orders[0].payMethod, "会员卡", "stored-value signature deduction should mark the order as member-card redemption after signing");
}

{
  const firstOpened = openMemberCard(
    cloneSeed(),
    {
      customerName: "重复项目扣卡客户",
      customerPhone: "13800001984",
      name: "泥灸大卡",
      type: "套餐卡",
      serviceEntitlements: [{ serviceId: "v1", totalTimes: 8, remainingTimes: 8 }],
      paidAmount: 2980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const secondOpened = openMemberCard(
    firstOpened,
    {
      customerName: "重复项目扣卡客户",
      customerPhone: "13800001984",
      name: "泥灸小卡",
      type: "套餐卡",
      serviceEntitlements: [{ serviceId: "v1", totalTimes: 2, remainingTimes: 2 }],
      paidAmount: 980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const smallCardId = secondOpened.memberCards[0].id;
  const largeCardId = secondOpened.memberCards[1].id;
  const checkedOut = checkoutOrder(
    secondOpened,
    {
      customerId: secondOpened.customers[0].id,
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      cardId: smallCardId,
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "重复项目扣卡客户",
      signatureText: "data:image/png;base64,one-card-only",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(signed, smallCardId).serviceEntitlements?.[0]?.remainingTimes, 1, "duplicate service should deduct only the selected source card");
  assert.equal(card(signed, largeCardId).serviceEntitlements?.[0]?.remainingTimes, 8, "duplicate service should not deduct other cards that include the same service");
  assert.equal(signed.orders[0].cardId, smallCardId, "order should keep the explicitly selected debit source");
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "多项目签名扣卡客户",
      customerPhone: "13800001981",
      name: "多项目护理卡",
      type: "次数卡",
      remainingTimes: 0,
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 3, remainingTimes: 3 },
        { serviceId: "v2", totalTimes: 2, remainingTimes: 2 },
      ],
      paidAmount: 1980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceIds: ["v1", "v1", "v2"],
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "多项目签名扣卡客户",
      signatureText: "data:image/png;base64,multi-service",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(signed.memberCards[0].remainingTimes, 2, "multi-service signature should deduct every selected service quantity");
  assert.deepEqual(
    signed.memberCards[0].serviceEntitlements?.map((item) => [item.serviceId, item.remainingTimes]),
    [["v1", 1], ["v2", 1]],
    "multi-service signature should debit each service entitlement by quantity",
  );
  assert.equal(signed.memberCardTransactions[0].timesDelta, -3, "multi-service signature transaction should record total debited quantity");
  assert.deepEqual(signed.orders[0].serviceIds, ["v1", "v1", "v2"], "multi-service signature should keep order service quantities");
}

{
  const firstOpened = openMemberCard(
    cloneSeed(),
    {
      customerName: "跨卡项目扣卡客户",
      customerPhone: "13800001985",
      name: "面部护理十次卡",
      type: "次数卡",
      serviceEntitlements: [{ serviceId: "v1", totalTimes: 3, remainingTimes: 3 }],
      paidAmount: 980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const secondOpened = openMemberCard(
    firstOpened,
    {
      customerName: "跨卡项目扣卡客户",
      customerPhone: "13800001985",
      name: "面部护理十次卡",
      type: "次数卡",
      serviceEntitlements: [{ serviceId: "v2", totalTimes: 2, remainingTimes: 2 }],
      paidAmount: 980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const v2CardId = secondOpened.memberCards[0].id;
  const v1CardId = secondOpened.memberCards[1].id;
  const checkedOut = checkoutOrder(
    secondOpened,
    {
      customerId: secondOpened.customers[0].id,
      staffId: "s2",
      serviceIds: ["v1", "v2"],
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "跨卡项目扣卡客户",
      signatureText: "data:image/png;base64,cross-card-services",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(signed, v1CardId).serviceEntitlements?.[0]?.remainingTimes, 2, "cross-card checkout should debit the card that owns v1");
  assert.equal(card(signed, v2CardId).serviceEntitlements?.[0]?.remainingTimes, 1, "cross-card checkout should debit the card that owns v2");
  assert.equal(
    signed.memberCardTransactions.filter((transaction) => transaction.orderId === signed.orders[0].id && transaction.type === "消费").length,
    2,
    "cross-card checkout should write one consumption transaction per debited card",
  );
  const refunded = refundOrder(
    signed,
    {
      orderId: signed.orders[0].id,
      reason: "跨卡项目退款",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(refunded, v1CardId).serviceEntitlements?.[0]?.remainingTimes, 3, "cross-card refund should restore the card that owns v1");
  assert.equal(card(refunded, v2CardId).serviceEntitlements?.[0]?.remainingTimes, 2, "cross-card refund should restore the card that owns v2");
  assert.equal(
    refunded.memberCardTransactions.filter((transaction) => transaction.orderId === signed.orders[0].id && transaction.type === "退款").length,
    2,
    "cross-card refund should write one refund transaction per restored card",
  );
}

{
  const sharedPoolData = cloneSeed();
  sharedPoolData.memberCards = [
    {
      id: "shared_pool_card",
      storeId: sharedPoolData.customers[0].storeId,
      customerId: "c1",
      name: "历史共享项目卡",
      type: "次数卡",
      balance: 0,
      remainingTimes: 11,
      expiresAt: "2026-12-31",
      status: "正常",
      serviceId: "v1",
      serviceIds: ["v1", "v2"],
    },
    {
      id: "dedicated_v1_card",
      storeId: sharedPoolData.customers[0].storeId,
      customerId: "c1",
      name: "面部专用卡",
      type: "次数卡",
      balance: 0,
      remainingTimes: 3,
      expiresAt: "2027-12-31",
      status: "正常",
      serviceId: "v1",
      serviceIds: ["v1"],
    },
  ];
  const serviceIds = [...Array(3).fill("v1"), ...Array(9).fill("v2")];
  const checkedOut = checkoutOrder(
    sharedPoolData,
    {
      customerId: "c1",
      staffId: "s2",
      serviceIds,
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const signed = signCustomerSignature(
    checkedOut,
    {
      token: checkedOut.customerSignatures[0].token,
      signerName: "共享次数客户",
      signatureText: "data:image/png;base64,shared-pool-reallocation",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(
    signed.memberCards.reduce((sum, item) => sum + item.remainingTimes, 0),
    2,
    "shared-pool allocation should reassign earlier services instead of falsely blocking a feasible order",
  );
  assert.equal(card(signed, "dedicated_v1_card").remainingTimes, 0, "shared-pool allocation should consume the constrained service card first");
  assert.equal(card(signed, "shared_pool_card").remainingTimes, 2, "shared-pool allocation should preserve flexible uses for other supported services");
  assert.equal(
    signed.memberCardTransactions
      .filter((transaction) => transaction.orderId === signed.orders[0].id && transaction.type === "消费")
      .reduce((sum, transaction) => sum + transaction.timesDelta, 0),
    -12,
    "shared-pool allocation should debit every selected service exactly once",
  );
}

{
  const duplicateEntitlementData = cloneSeed();
  duplicateEntitlementData.memberCards = [{
    id: "duplicate_entitlement_card",
    storeId: duplicateEntitlementData.customers[0].storeId,
    customerId: "c1",
    name: "历史重复权益卡",
    type: "套餐卡",
    balance: 0,
    remainingTimes: 11,
    expiresAt: "2027-12-31",
    status: "正常",
    serviceId: "v2",
    serviceIds: ["v2", "v2"],
    serviceEntitlements: [
      { serviceId: "v2", totalTimes: 5, remainingTimes: 5 },
      { serviceId: "v2", totalTimes: 6, remainingTimes: 6 },
    ],
  }];
  const availability = aggregateMemberCardServiceAvailability(duplicateEntitlementData.memberCards, duplicateEntitlementData.services);
  assert.deepEqual(memberCardAvailableServiceIds(duplicateEntitlementData.memberCards[0]), ["v2"], "duplicate historical entitlements should expose one selectable service");
  assert.equal(availability[0]?.remainingTimes, 11, "duplicate historical entitlements should aggregate the full remaining balance");
  assert.equal(availability[0]?.sources.length, 1, "duplicate historical entitlements should expose one normalized card source");
  const checkedOut = checkoutOrder(
    duplicateEntitlementData,
    {
      customerId: "c1",
      staffId: "s2",
      serviceIds: Array(9).fill("v2"),
      payMethod: "会员卡",
    },
    { idFactory: testId, now: fixedNow },
  );
  const updatedCard = card(checkedOut, "duplicate_entitlement_card");
  assert.equal(updatedCard.remainingTimes, 2, "duplicate historical entitlements should debit nine uses only once");
  assert.deepEqual(
    updatedCard.serviceEntitlements,
    [{ serviceId: "v2", totalTimes: 11, remainingTimes: 2 }],
    "duplicate historical entitlements should normalize to one balance after mutation",
  );
}

{
  const opened = openMemberCard(
    cloneSeed(),
    {
      customerName: "签名不足客户",
      customerPhone: "13800001982",
      name: "不足项目护理卡",
      type: "套餐卡",
      remainingTimes: 0,
      serviceEntitlements: [
        { serviceId: "v1", totalTimes: 3, remainingTimes: 3 },
        { serviceId: "v2", totalTimes: 1, remainingTimes: 1 },
      ],
      paidAmount: 1980,
      payMethod: "微信",
      expiresAt: "2027-12-31",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    opened,
    {
      customerId: opened.customers[0].id,
      staffId: "s2",
      serviceIds: ["v2", "v2"],
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      signCustomerSignature(
        checkedOut,
        {
          token: checkedOut.customerSignatures[0].token,
          signerName: "签名不足客户",
          signatureText: "data:image/png;base64,insufficient",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /肩颈舒缓 SPA剩余1次，本次需要2次/,
    "signature completion should reject service-card deduction when the selected service balance is insufficient",
  );
}

{
  const lowBalanceData = cloneSeed();
  lowBalanceData.memberCards = lowBalanceData.memberCards.map((item) =>
    item.id === "m1" ? { ...item, balance: 1 } : item,
  );

  assert.throws(
    () =>
      checkoutOrder(
        lowBalanceData,
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          payMethod: "会员卡",
          cardId: "m1",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /余额不足/,
    "stored-value card should reject insufficient balance",
  );
}

{
  const data = adjustInventory(
    cloneSeed(),
    { productId: "p1", type: "入库", quantity: 4, unitCost: 58, note: "采购入库" },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(productStock(data, "p1"), 22, "inbound stock should increase inventory");
  assert.equal(data.products.find((product) => product.id === "p1")?.cost, 58, "manual inbound should update current product cost");
  assert.equal(data.inventoryBatches[0].unitCost, 58, "manual inbound batch should preserve this inbound unit cost");
  assert.equal(data.inventoryLogs[0].delta, 4, "inbound adjustment should log positive delta");
  assert.equal(data.inventoryLogs[0].note, "采购入库", "inventory note should be preserved");
  assert.equal(data.inventoryLogs[0].expiryAt, "2028-05-24", "inbound adjustment should derive expiry from product shelf life");
  assert.equal(data.products.find((product) => product.id === "p1")?.expiryAt, "2028-05-24", "product should keep nearest expiry date");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "会员维护价",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].paidAmount, 348, "service discount should reduce paid amount without approval selection");
  assert.equal(checkedOut.orders[0].discountAmount, 50, "order should persist discount amount");
}

{
  const seed = cloneSeed();
  const productStockBefore = productStock(seed, "p4");
  const giftStockBefore = productStock(seed, "p2");
  const checkedOut = checkoutOrder(
    seed,
    {
      guestName: "陈女士",
      guestPhone: "13800001111",
      staffId: "s2",
      productId: "p4",
      giftProductId: "p2",
      payMethod: "微信",
      discountAmount: 20,
      adjustmentReason: "新客商品优惠",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(checkedOut.orders[0].totalAmount, 199, "product-only checkout should charge selected product only");
  assert.equal(checkedOut.orders[0].paidAmount, 179, "product-only discount should not require approval");
  assert.equal(checkedOut.customers.find((customer) => customer.id === checkedOut.orders[0].customerId)?.name, "陈女士", "product-only checkout should bind walk-in customer for signature");
  assert.equal(checkedOut.customerSignatures[0].orderId, checkedOut.orders[0].id, "product-only checkout should require customer signature");
  assert.equal(checkedOut.orders[0].giftProductId, "p2", "product-only checkout should persist gift product");
  assert.equal(productStock(checkedOut, "p4"), productStockBefore - 1, "product checkout should reduce sold product stock");
  assert.equal(productStock(checkedOut, "p2"), giftStockBefore - 1, "product checkout should reduce gift product stock");
  assert.ok(checkedOut.inventoryLogs.some((item) => item.type === "赠品出库" && item.productId === "p2"), "gift product should create gift inventory log");

  const refunded = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, reason: "商品赠品退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(refunded, "p4"), productStockBefore, "product refund should restore sold product stock");
  assert.equal(productStock(refunded, "p2"), giftStockBefore, "product refund should restore gift product stock");
}

{
  const seed = cloneSeed();
  const p4StockBefore = productStock(seed, "p4");
  const p1StockBefore = productStock(seed, "p1");
  const giftStockBefore = productStock(seed, "p2");
  const checkedOut = checkoutOrder(
    seed,
    {
      guestName: "周女士",
      guestPhone: "13800002222",
      staffId: "s2",
      productItems: [
        { productId: "p4", quantity: 2 },
        { productId: "p1", quantity: 1 },
      ],
      giftProductItems: [{ productId: "p2", quantity: 2 }],
      payMethod: "微信",
      discountAmount: 52,
      adjustmentReason: "多商品 9 折",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(checkedOut.orders[0].totalAmount, 526, "multi-product checkout should sum product quantities");
  assert.equal(checkedOut.orders[0].paidAmount, 474, "multi-product checkout should apply order discount");
  assert.deepEqual(checkedOut.orders[0].productItems?.map((item) => [item.productId, item.quantity, item.amount]), [["p4", 2, 398], ["p1", 1, 128]], "multi-product checkout should persist sale lines");
  assert.deepEqual(checkedOut.orders[0].giftProductItems?.map((item) => [item.productId, item.quantity, item.amount]), [["p2", 2, 0]], "multi-product checkout should persist gift lines");
  assert.equal(productStock(checkedOut, "p4"), p4StockBefore - 2, "multi-product checkout should reduce first product quantity");
  assert.equal(productStock(checkedOut, "p1"), p1StockBefore - 1, "multi-product checkout should reduce second product quantity");
  assert.equal(productStock(checkedOut, "p2"), giftStockBefore - 2, "multi-product checkout should reduce gift quantity");

  const refunded = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, reason: "多商品退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(refunded, "p4"), p4StockBefore, "multi-product refund should restore first product");
  assert.equal(productStock(refunded, "p1"), p1StockBefore, "multi-product refund should restore second product");
  assert.equal(productStock(refunded, "p2"), giftStockBefore, "multi-product refund should restore gifts");
}

{
  const recharged = rechargeMemberCard(
    cloneSeed(),
    { memberCardId: "m1", amount: 100, times: 0, note: "测试充值", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(recharged, "m1").balance, 2700, "member card recharge should increase balance");

  const frozen = updateMemberCardStatus(
    recharged,
    { memberCardId: "m1", status: "冻结", reason: "风控冻结", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(frozen, "m1").status, "冻结", "member card should be frozen");

  const extended = extendMemberCard(
    frozen,
    { memberCardId: "m1", expiresAt: "2028-12-31", reason: "延期", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(extended, "m1").expiresAt, "2028-12-31", "member card should extend expiry");

  const transferred = transferMemberCard(
    extended,
    { memberCardId: "m1", toCustomerId: "c2", reason: "客户转卡", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(card(transferred, "m1").customerId, "c2", "member card should transfer owner");
}

{
  const shifted = createStaffShift(
    cloneSeed(),
    {
      staffId: "s3",
      startAt: "2026-05-28T02:00:00.000Z",
      endAt: "2026-05-28T03:00:00.000Z",
      note: "早班",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      createAppointment(
        shifted,
        {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: "2026-05-28T04:00:00.000Z",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /不在服务人员班次内/,
    "appointment should reject time outside staff shift",
  );
}

{
  const checkedOutForRecord = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  const withRecord = addCustomerServiceRecord(
    checkedOutForRecord,
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: checkedOutForRecord.orders[0].id,
      skinCondition: "敏感偏干",
      beforeNote: "轻微泛红",
      careSteps: "清洁、导入、修护",
      productsUsed: "清洁精华液",
      afterNote: "补水修护",
      customerFeedback: "体验舒适",
      nextCareAdvice: "加强保湿防晒",
      nextFollowUpAt: "2026-05-26T10:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withRecord.customerServiceRecords.length, 1, "service record should be created");
  assert.equal(withRecord.customerServiceRecords[0].orderId, checkedOutForRecord.orders[0].id, "service record should link order");
  assert.equal(withRecord.customerServiceRecords[0].careSteps, "清洁、导入、修护", "service record should persist care steps");
  assert.equal(withRecord.customerServiceRecords[0].productsUsed, "清洁精华液", "service record should persist products used");
  assert.equal(withRecord.customerServiceRecords[0].customerFeedback, "体验舒适", "service record should persist customer feedback");
  assert.equal(withRecord.customerServiceRecords[0].nextCareAdvice, "加强保湿防晒", "service record should persist next care advice");
  assert.equal(withRecord.customers.find((customer) => customer.id === "c1")?.lastVisit, fixedNow(), "service record should update last visit");
  assert.equal(withRecord.customerFollowUps[0].status, "待跟进", "service record should create follow-up");
  assert.match(withRecord.customerFollowUps[0].note, /加强保湿防晒/, "follow-up should use next care advice");
  const withSignature = createCustomerSignature(
    withRecord,
    {
      customerId: "c1",
      serviceRecordId: withRecord.customerServiceRecords[0].id,
      orderId: checkedOutForRecord.orders[0].id,
      requestedBy: "u_frontdesk",
      validDays: 3,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(withSignature.customerSignatures[0].status, "待签名", "customer signature should start pending");
  assert.equal(withSignature.customerSignatures[0].expiresAt, "2026-05-27T01:00:00.000Z", "customer signature should persist expiry");
  assert.throws(
    () => signCustomerSignature(withSignature, { token: withSignature.customerSignatures[0].token, signerName: "周女士", signatureText: `data:image/png;base64,${"A".repeat(120_001)}` }, { now: fixedNow }),
    /签名图片过大/,
    "customer signature should reject oversized image payload",
  );
  const signed = signCustomerSignature(
    withSignature,
    { token: withSignature.customerSignatures[0].token, signerName: "周女士", signatureText: "data:image/png;base64,abc123" },
    { now: fixedNow },
  );
  assert.equal(signed.customerSignatures[0].status, "已签名", "customer signature should be signed");
  assert.equal(signed.customerSignatures[0].signerName, "周女士", "customer signature should persist signer");
  assert.match(signed.customerSignatures[0].signatureText ?? "", /^data:image\/png;base64,/, "customer signature should persist handwritten image data");
  assert.throws(
    () =>
      addCustomerServiceRecord(
        withRecord,
        {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          orderId: checkedOutForRecord.orders[0].id,
          skinCondition: "敏感偏干",
          beforeNote: "重复建档",
          afterNote: "补水修护",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /已生成服务记录/,
    "service record should reject duplicate order record",
  );

  const completed = completeCustomerFollowUp(
    withRecord,
    { followUpId: withRecord.customerFollowUps[0].id },
    { now: fixedNow },
  );
  assert.equal(completed.customerFollowUps[0].status, "已完成", "follow-up should be completed");

  assert.throws(
    () =>
      addCustomerServiceRecord(
        checkedOutForRecord,
        {
          customerId: "c2",
          staffId: "s2",
          serviceId: "v1",
          orderId: checkedOutForRecord.orders[0].id,
          skinCondition: "敏感偏干",
          beforeNote: "轻微泛红",
          afterNote: "补水修护",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /关联订单不属于该客户/,
    "service record should reject an order from another customer",
  );

  const cardCheckout = checkoutOrder(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
    { idFactory: testId, now: fixedNow },
  );
  const cardRecord = addCustomerServiceRecord(
    cardCheckout,
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: cardCheckout.orders[0].id,
      skinCondition: "本次到店服务记录",
      beforeNote: "会员卡扣费服务",
      afterNote: "服务完成",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(cardRecord.customerServiceRecords[0].memberCardTransactionId, cardCheckout.memberCardTransactions[0].id, "service record should link member-card consumption");
  assert.match(cardRecord.customerServiceRecords[0].careSteps, /小气泡/, "service record should derive default care steps from service");
  assert.match(cardRecord.customerServiceRecords[0].productsUsed, /清洁精华液/, "service record should derive used products from service recipe");
}

{
  const withSupplier = addSupplier(cloneSeed(), { name: "测试供应商", phone: "13800000000", contact: "王经理" }, { idFactory: testId });
  const purchased = receivePurchaseOrder(
    withSupplier,
    { supplierId: withSupplier.suppliers[0].id, productId: "p1", quantity: 3, unitCost: 60, expiryAt: "2027-12-31", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(purchased, "p1"), 21, "purchase order should increase stock");
  assert.equal(purchased.inventoryLogs[0].type, "采购入库", "purchase order should log inbound stock");
  assert.equal(purchased.inventoryLogs[0].expiryAt, "2027-12-31", "purchase inventory log should persist expiry date");
  assert.equal(purchased.purchaseOrders[0].expiryAt, "2027-12-31", "purchase order should persist expiry date");

  const newPurchase = receiveSupplierPurchase(
    cloneSeed(),
    {
      supplierName: "来货供应商",
      productName: "新采购面霜",
      productPrice: 198,
      productCategory: "面护类",
      productSubcategory: "膏霜",
      quantity: 7,
      unitCost: 55,
      expiryAt: "2028-06-30",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );
  const newProduct = newPurchase.products.find((product) => product.name === "新采购面霜");
  assert.ok(newProduct, "supplier purchase should create missing product");
  assert.equal(newProduct.stock, 7, "new supplier purchase product stock should equal purchase quantity");
  assert.equal(newProduct.price, 198, "new supplier purchase should persist sales price separately");
  assert.equal(newProduct.cost, 55, "new supplier purchase should persist purchase cost");
  assert.equal(newPurchase.suppliers[0].name, "来货供应商", "new supplier purchase should create missing supplier");
  assert.equal(newPurchase.purchaseOrders[0].quantity, 7, "new supplier purchase order quantity should match inbound quantity");
  assert.equal(newPurchase.inventoryBatches[0].quantityIn, 7, "new supplier purchase batch quantity should match inbound quantity");
  assert.equal(newPurchase.inventoryBatches[0].remainingQuantity, 7, "new supplier purchase batch remaining should match inbound quantity");
  assert.equal(newPurchase.inventoryLogs[0].delta, 7, "new supplier purchase log delta should match inbound quantity");
  assert.equal(newPurchase.inventoryLogs[0].stockAfter, 7, "new supplier purchase stockAfter should match initial stock");

  const lowStockData = {
    ...cloneSeed(),
    suppliers: [],
    products: cloneSeed().products.map((product) => product.id === "p1" ? { ...product, stock: 2, warningStock: 5 } : product),
  };
  const restocked = restockLowInventory(lowStockData, { userId: "u_manager" }, { idFactory: testId, now: fixedNow });
  assert.equal(restocked.suppliers[0].name, "默认供应商", "restock should create a default supplier when none exists");
  assert.equal(restocked.purchaseOrders.length, 1, "restock should create purchase order for low stock item");
  assert.equal(restocked.purchaseOrders[0].quantity, 10, "restock should replenish at least ten units");
  assert.equal(productStock(restocked, "p1"), 12, "restock should update product stock");
  assert.equal(restocked.inventoryLogs[0].type, "采购入库", "restock should write inventory log");
  assert.equal(restocked.operationLogs[0].action, "一键补货", "restock should write operation log");
  assert.throws(
    () => restockLowInventory(cloneSeed(), { userId: "u_manager" }),
    /当前没有需要补货/,
    "restock should reject when there are no low stock items",
  );

  const counted = createStocktake(
    purchased,
    { productId: "p1", actualStock: 19, reason: "盘点差异", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(counted, "p1"), 19, "stocktake should update actual stock");
  assert.equal(counted.stocktakes[0].delta, -2, "stocktake should preserve stock delta");
}

{
  const checkedOut = checkoutOrder(
    cloneSeed(),
    { customerId: "c1", staffId: "s2", serviceId: "v1", payMethod: "微信" },
    { idFactory: testId, now: fixedNow },
  );
  const closed = createDailyClose(
    checkedOut,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.throws(
    () =>
      adjustInventory(
        closed,
        { productId: "p1", type: "入库", quantity: 1 },
        { idFactory: testId, now: fixedNow },
      ),
    /已日结锁账/,
    "daily close should lock same-day inventory changes",
  );
  const reversed = reverseDailyClose(
    closed,
    { businessDate: "2026-05-24", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(reversed.dailyCloses[0].status, "已反结", "reverse daily close should unlock business date");
  const adjusted = adjustInventory(
    reversed,
    { productId: "p1", type: "入库", quantity: 1 },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(adjusted, "p1"), 19, "inventory changes should be allowed after reverse close");
}

console.log("业务规则验证通过：开单、审批、卡项、预约/班次、线上店铺、服务档案、客户签名、回访、人员注册邀请、进销存、日结锁账/反结、退款、提成、报表。");
