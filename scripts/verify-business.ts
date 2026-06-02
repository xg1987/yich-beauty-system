import assert from "node:assert/strict";
import {
  addCustomerServiceRecord,
  archiveNotification,
  createCustomerSignature,
  addStaffMember,
  addSupplier,
  adjustInventory,
  bindReferralRelation,
  checkoutOrder,
  convertOnlineBookingRequest,
  createAppointment,
  createApprovalRequest,
  createDistributor,
  createDailyClose,
  createOnlineBookingRequest,
  createStaffShift,
  createStaffInvite,
  createStaffUnavailableSlot,
  createStoreOwnerInvite,
  createStocktake,
  completeCustomerFollowUp,
  createTagDefinition,
  decideApprovalRequest,
  extendMemberCard,
  joinStaffInvite,
  joinInviteByCode,
  signCustomerSignature,
  addSystemNotification,
  cleanupFormalData,
  formalDataAudit,
  markAllVisibleNotificationsRead,
  markNotificationRead,
  platformInviteCodeForPlatformAdmin,
  platformInviteCodeForUser,
  previewFormalDataCleanup,
  receivePurchaseOrder,
  rechargeMemberCard,
  registerStore,
  refundMemberCard,
  refundOrder,
  reportSummary,
  revokeStaffInvite,
  reverseDailyClose,
  restockLowInventory,
  rescheduleAppointment,
  settleDistributionCommissions,
  settleCommissions,
  transferMemberCard,
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
  inviteDefaultDays,
} from "../src/domain/business";
import { testFixtureData } from "../src/domain/testFixture";
import type { AppData } from "../src/domain/types";

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
  assert.equal(registered.authUsers[0].role, "owner", "store registration should create owner account");
  assert.equal(registered.staff[0].accountId, registered.authUsers[0].id, "owner staff should bind account");
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
  assert.throws(
    () =>
      checkoutOrder(
        registered,
        {
          customerId: "c1",
          staffId: registered.staff[0].id,
          serviceId: "v1",
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /服务员工不存在或已停用/,
    "owner should not be selected as service staff for checkout",
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
    /服务员工不存在或已停用/,
    "owner should not be selected as service staff for appointment",
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
    name: "测试皮肤管理中心",
    phone: "13900000002",
    address: "测试新地址",
    businessHours: "09:30 - 22:00",
    roomNames: ["护理房 A", "护理房 B", "VIP 房"],
  });
  assert.equal(updatedStore.storeProfiles[0].name, "测试皮肤管理中心", "store profile should update store name");
  assert.equal(updatedStore.storeProfiles[0].businessHours, "09:30 - 22:00", "store profile should update business hours");
  assert.deepEqual(updatedStore.storeProfiles[0].roomNames, ["护理房 A", "护理房 B", "VIP 房"], "store profile should update appointment room names");
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
          { productId: "p1", quantity: 2 },
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
  assert.equal(productStock(checkedOut, "p1"), 16, "service recipe should consume first product");
  assert.equal(productStock(checkedOut, "p2"), 11.5, "service recipe should consume second product");
  assert.equal(checkedOut.inventoryLogs.filter((item) => item.type === "服务消耗").length, 2, "service recipe should log each consumable");

  const refunded = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, reason: "配方项目退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(refunded, "p1"), 18, "recipe refund should restore first product");
  assert.equal(productStock(refunded, "p2"), 12, "recipe refund should restore second product");
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
  assert.equal(productStock(data, "p1"), 17, "service consumable stock should decrease");
  assert.equal(productStock(data, "p4"), 23, "retail product stock should decrease");
  assert.equal(data.inventoryLogs.length, 2, "service and retail stock changes should both log");
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
  const distributorCreated = createDistributor(
    cloneSeed(),
    { type: "员工", staffId: "s3", rate: 0.06 },
    { idFactory: testId, now: fixedNow },
  );
  const distributorId = distributorCreated.distributors[0].id;
  assert.equal(distributorCreated.distributors[0].name, "阿宁", "distributor should inherit staff profile");

  const relationBound = bindReferralRelation(
    distributorCreated,
    { distributorId, customerId: "c3" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(relationBound.referralRelations[0].status, "有效", "referral relation should bind customer to distributor");

  const checkedOut = checkoutOrder(
    relationBound,
    {
      customerId: "c3",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].distributorId, distributorId, "checkout should use referral distributor");
  assert.equal(checkedOut.distributionCommissions[0].amount, 24, "checkout should create distribution commission");
  assert.equal(checkedOut.distributionCommissions[0].status, "待结算", "distribution commission should wait settlement");
  const settledDistribution = settleDistributionCommissions(checkedOut, { userId: "u_manager" }, { idFactory: testId, now: fixedNow });
  assert.equal(settledDistribution.commissionSettlements[0].type, "分销佣金", "settlement should create distribution commission batch");
  assert.equal(settledDistribution.distributionCommissions[0].settlementId, settledDistribution.commissionSettlements[0].id, "distribution settlement should stamp commission records");

  const partialRefund = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, amount: 100, reason: "客户部分退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(partialRefund.distributionCommissions[0].amount, 18, "partial refund should reduce distribution commission");

  const fullRefund = refundOrder(
    checkedOut,
    { orderId: checkedOut.orders[0].id, reason: "客户全额退款", userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(fullRefund.distributionCommissions[0].status, "已冲销", "full refund should reverse distribution commission");
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
  assert.equal(productStock(data, "p1"), 17, "member-card checkout should still consume stock");
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
    /暂无可预约员工/,
    "online booking should reject a time with no available staff",
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
  assert.equal(productStock(refunded, "p1"), 18, "refund should restore service consumable stock");
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
  assert.equal(productStock(refunded, "p1"), 17, "partial refund should not restore service stock");
  assert.equal(productStock(refunded, "p4"), 23, "partial refund should not restore retail stock");
  assert.ok(refunded.commissions[0].amount < checkedOut.commissions[0].amount, "partial refund should reduce commission");
}

{
  const refundedCard = refundMemberCard(
    cloneSeed(),
    {
      memberCardId: "m1",
      reason: "客户退卡",
      userId: "u_manager",
    },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(card(refundedCard, "m1").status, "已退卡", "member card refund should close card");
  assert.equal(card(refundedCard, "m1").balance, 0, "member card refund should clear balance");
  assert.equal(refundedCard.memberCardTransactions[0].type, "退卡", "member card refund should write card transaction");
  assert.equal(refundedCard.operationLogs[0].action, "会员退卡", "member card refund should write operation log");
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
    /已有预约/,
    "appointment creation should reject staff schedule conflict",
  );

  const data = createAppointment(
    cloneSeed(),
    {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: "2026-05-25T02:00:00.000Z",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(data.appointments[0].staffId, "s3", "non-conflicting appointment should be created");
  assert.equal(data.appointments[0].updatedAt, fixedNow(), "appointment should stamp update time");

  assert.throws(
    () =>
      updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已完成" }, { now: fixedNow }),
    /不能从待确认改为已完成/,
    "appointment should reject invalid status transition",
  );

  const confirmed = updateAppointmentStatus(data, { appointmentId: data.appointments[0].id, status: "已确认" }, { now: fixedNow });
  const arrived = updateAppointmentStatus(confirmed, { appointmentId: data.appointments[0].id, status: "已到店" }, { now: fixedNow });
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
  assert.equal(rescheduled.appointments[0].rescheduledAt, fixedNow(), "reschedule should keep audit time");
  assert.throws(
    () => rescheduleAppointment(data, { appointmentId: data.appointments[0].id, staffId: "s2", startAt: conflictStartAt }, { now: fixedNow }),
    /已有预约/,
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
      serviceId: data.appointments[0].serviceId,
      appointmentId: data.appointments[0].id,
      payMethod: "微信",
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(appointmentCheckout.orders[0].appointmentId, data.appointments[0].id, "checkout should link source appointment");
  assert.equal(appointmentCheckout.appointments[0].status, "已完成", "checkout should complete source appointment");
  assert.equal(appointmentCheckout.appointments[0].completedAt, fixedNow(), "checkout should stamp appointment completion");
  assert.throws(
    () =>
      checkoutOrder(
        arrivedForCheckout,
        {
          customerId: data.appointments[0].customerId,
          staffId: data.appointments[0].staffId,
          serviceId: "v2",
          appointmentId: data.appointments[0].id,
          payMethod: "微信",
        },
        { idFactory: testId, now: fixedNow },
      ),
    /收银信息与预约不一致/,
    "appointment checkout should reject mismatched service",
  );
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
    { productId: "p1", type: "入库", quantity: 4, note: "采购入库" },
    { idFactory: testId, now: fixedNow },
  );

  assert.equal(productStock(data, "p1"), 22, "inbound stock should increase inventory");
  assert.equal(data.inventoryLogs[0].delta, 4, "inbound adjustment should log positive delta");
  assert.equal(data.inventoryLogs[0].note, "采购入库", "inventory note should be preserved");
}

{
  assert.throws(
    () =>
      checkoutOrder(
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
      ),
    /需要审批/,
    "discount checkout should require approved request",
  );

  const requested = createApprovalRequest(
    cloneSeed(),
    { type: "改价折扣", targetId: "manual", requestedBy: "u_frontdesk", amount: 50, reason: "会员维护价" },
    { idFactory: testId, now: fixedNow },
  );
  const approved = decideApprovalRequest(
    requested,
    { approvalId: requested.approvalRequests[0].id, userId: "u_manager", approved: true },
    { idFactory: testId, now: fixedNow },
  );
  const checkedOut = checkoutOrder(
    approved,
    {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "会员维护价",
      approvalId: approved.approvalRequests[0].id,
    },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(checkedOut.orders[0].paidAmount, 348, "approved discount should reduce paid amount");
  assert.equal(checkedOut.orders[0].discountAmount, 50, "order should persist discount amount");
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
    /不在员工班次内/,
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
    { supplierId: withSupplier.suppliers[0].id, productId: "p1", quantity: 3, unitCost: 60, userId: "u_manager" },
    { idFactory: testId, now: fixedNow },
  );
  assert.equal(productStock(purchased, "p1"), 21, "purchase order should increase stock");
  assert.equal(purchased.inventoryLogs[0].type, "采购入库", "purchase order should log inbound stock");

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
  assert.equal(productStock(adjusted, "p1"), 18, "inventory changes should be allowed after reverse close");
}

console.log("业务规则验证通过：开单、审批、卡项、预约/班次、线上店铺、服务档案、客户签名、回访、人员注册邀请、进销存、日结锁账/反结、退款、提成、报表。");
