import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApiServer } from "../server/api";
import { BeautyDatabase } from "../server/database";
import { defaultSystemConfigs, platformInviteCodeForUser } from "../src/domain/business";
import { testFixtureData } from "../src/domain/testFixture";
import type { AppDataSlice } from "../src/domain/dataSlices";
import type { AppData, WorkerUsageSnapshot } from "../src/domain/types";

const tempDir = mkdtempSync(join(tmpdir(), "beauty-api-"));
const database = new BeautyDatabase(join(tempDir, "test.sqlite"));
database.replaceData(testFixtureData);
const server = createApiServer(database);
const futureDate = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
const futureIso = (daysFromNow: number, time: string) => `${futureDate(daysFromNow)}T${time}:00.000Z`;

try {
  const baseUrl = await listen(server);

  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert.equal(health.ok, true, "health check should pass");

  await assert.rejects(() => request<AppData>(baseUrl, "/api/data"), /请先登录/, "protected data endpoint should require login");

  const session = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "manager@test.local", password: "test-password" },
  });
  assert.equal(session.user.roleName, "主管", "login API should return role session");

  const frontdeskSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "frontdesk@test.local", password: "test-password" },
  });
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/inventory/adjust", {
        method: "POST",
        token: frontdeskSession.token,
        body: { productId: "p1", type: "入库", quantity: 1 },
      }),
    /无权/,
    "frontdesk should not adjust inventory",
  );

  const initialData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(initialData.customers.length, 3, "test fixture should seed customers");
  assert.equal(initialData.orders.length, 0, "seed should start without orders");
  for (const config of defaultSystemConfigs()) {
    assert.ok(initialData.systemConfigs.some((item) => item.key === config.key), `API data should include normalized system config ${config.key}`);
  }
  assert.ok(initialData.authUsers.every((user) => user.password === ""), "API data should not expose passwords");
  const posSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=pos", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "pos" },
  });
  assert.equal(posSlice.kind, "app-data-slice", "data slice API should return slice marker");
  assert.equal(posSlice.view, "pos", "data slice API should echo requested view");
  assert.ok(posSlice.data.orders, "POS slice should include orders");
  assert.ok(posSlice.data.products, "POS slice should include products");
  assert.equal("storeOwnerApplications" in posSlice.data, false, "POS slice should omit unrelated platform application data");
  assert.ok(JSON.stringify(posSlice).length < JSON.stringify(initialData).length, "view slice should be smaller than full AppData");
  const appointmentSlice = await request<AppDataSlice>(baseUrl, "/api/data?view=appointments", {
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "appointments" },
  });
  assert.ok(appointmentSlice.data.customerSignatures, "appointments slice should include service signatures for workflow columns");
  const customerMutationSlice = await request<AppDataSlice>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "customers" },
    body: { name: "分片验证客户", phone: "13900000001" },
  });
  assert.equal(customerMutationSlice.kind, "app-data-slice", "mutation with slice header should return AppData slice");
  assert.equal(customerMutationSlice.view, "customers", "mutation slice should use active view");
  assert.ok(customerMutationSlice.data.customers?.some((customer) => customer.name === "分片验证客户"), "mutation slice should include updated customers");
  assert.equal("purchaseOrders" in customerMutationSlice.data, false, "customer mutation slice should omit inventory purchase orders");
  const settingsAppointmentSlice = await request<AppDataSlice>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    headers: { "X-App-Data-Mode": "slice", "X-App-Data-View": "settings" },
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(44, "02:00"),
      endAt: futureIso(44, "03:00"),
      roomName: "护理房 1",
      note: "管理中心预约分片验证",
    },
  });
  assert.equal(settingsAppointmentSlice.kind, "app-data-slice", "settings appointment mutation should return AppData slice");
  assert.equal(settingsAppointmentSlice.view, "settings", "settings mutation slice should use management-center view");
  assert.equal(settingsAppointmentSlice.data.appointments?.[0]?.status, "已确认", "manual appointments should enter waiting-arrival column after saving");
  assert.ok(settingsAppointmentSlice.data.staffShifts, "settings slice should include staff shifts for schedule modal");
  assert.ok(settingsAppointmentSlice.data.customerSignatures, "settings slice should include customer signatures for refund signing");
  assert.ok(settingsAppointmentSlice.data.memberCards, "settings slice should include member cards for refund card refresh");
  assert.ok(settingsAppointmentSlice.data.refunds, "settings slice should include refunds for refund record refresh");

  const adminSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "admin@test.local", password: "test-password" },
  });
  assert.equal(adminSession.user.roleName, "系统管理员", "admin login should return platform admin session");
  await assert.rejects(
    () =>
      request<{ session: { user: { name: string; avatarUrl?: string } }; data: AppData }>(baseUrl, "/api/account-profile", {
        method: "PATCH",
        token: adminSession.token,
        body: { name: "API 管理员", avatarUrl: "data:image/png;base64,AA==" },
      }),
    /头像文件过大/,
    "account profile API should reject inline avatar blobs",
  );
  const avatarForm = new FormData();
  avatarForm.set("avatar", new Blob([Buffer.from("avatar-test")], { type: "image/png" }), "avatar.png");
  const uploadedAvatar = await requestForm<{ avatarUrl: string; key: string; size: number }>(baseUrl, "/api/account-avatar", {
    method: "POST",
    token: adminSession.token,
    body: avatarForm,
  });
  assert.match(uploadedAvatar.avatarUrl, /^\/api\/assets\/avatars\/u_superadmin\//, "account avatar API should return asset URL");
  const usageAfterAvatar = await request<{ objectCount: number; totalBytes: number; prefixes: Array<{ prefix: string; objectCount: number; bytes: number }> }>(
    baseUrl,
    "/api/usage/r2",
    { token: adminSession.token },
  );
  assert.ok(usageAfterAvatar.objectCount > 0, "R2 usage API should include uploaded avatar objects");
  assert.ok(usageAfterAvatar.totalBytes >= uploadedAvatar.size, "R2 usage API should include uploaded avatar bytes");
  assert.ok(usageAfterAvatar.prefixes.some((item) => item.prefix === "avatars/" && item.objectCount > 0), "R2 usage API should group avatars under avatars/");
  const workerUsage = await request<WorkerUsageSnapshot>(baseUrl, "/api/usage/worker", { token: adminSession.token });
  assert.equal(workerUsage.source, "cloudflare-graphql", "worker usage API should use Cloudflare Metrics source");
  assert.equal(typeof workerUsage.requests, "number", "worker usage API should return request count");
  assert.equal(typeof workerUsage.errors, "number", "worker usage API should return error count");
  assert.equal(workerUsage.windowHours, 24, "worker usage API should report the 24 hour metrics window");
  const afterAccountProfile = await request<{ session: { user: { name: string; avatarUrl?: string } }; data: AppData }>(baseUrl, "/api/account-profile", {
    method: "PATCH",
    token: adminSession.token,
    body: { name: "API 管理员", avatarUrl: uploadedAvatar.avatarUrl },
  });
  assert.equal(afterAccountProfile.session.user.name, "API 管理员", "account profile API should update session name");
  assert.equal(afterAccountProfile.session.user.avatarUrl, uploadedAvatar.avatarUrl, "account profile API should update session avatar");
  assert.equal(afterAccountProfile.data.authUsers.find((user) => user.id === "u_superadmin")?.name, "API 管理员", "account profile API should persist user name");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/auth-users/u_superadmin/status", {
        method: "PATCH",
        token: adminSession.token,
        body: { status: "disabled" },
      }),
    /不能停用当前登录账号/,
    "admin should not disable current account",
  );
  const afterDisableFrontdesk = await request<AppData>(baseUrl, "/api/auth-users/u_frontdesk/status", {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "disabled" },
  });
  assert.equal(afterDisableFrontdesk.authUsers.find((user) => user.id === "u_frontdesk")?.status, "disabled", "admin should disable account");
  assert.equal(afterDisableFrontdesk.operationLogs[0].action, "停用账号", "account status API should write operation log");
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "frontdesk@test.local", password: "test-password" },
      }),
    /账号或密码不正确/,
    "disabled account should not login",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/system-configs/invite_default_days", {
        method: "PATCH",
        token: session.token,
        body: { value: "10" },
      }),
    /只有平台 Admin/,
    "manager should not update platform system config",
  );
  const afterSystemConfig = await request<AppData>(baseUrl, "/api/system-configs/invite_default_days", {
    method: "PATCH",
    token: adminSession.token,
    body: { value: "10" },
  });
  assert.equal(
    afterSystemConfig.systemConfigs.find((item) => item.key === "invite_default_days")?.value,
    "10",
    "admin should update system config",
  );
  assert.equal(afterSystemConfig.operationLogs[0].action, "更新系统配置", "system config API should write operation log");
  const ownerInviteWithDefaultDays = await request<AppData>(baseUrl, "/api/store-owner-invites", {
    method: "POST",
    token: adminSession.token,
    body: {
      storeName: "API 配置有效期门店",
      ownerName: "配置有效期老板",
      phone: "13900007777",
      account: "api-configured-owner@test.local",
    },
  });
  const ownerInvite = ownerInviteWithDefaultDays.storeOwnerInvites[0];
  assert.ok(ownerInvite.expiresAt, "store owner invite API should persist expiry");
  assert.equal(
    Math.round((+new Date(ownerInvite.expiresAt ?? "") - +new Date(ownerInvite.createdAt)) / 86400000),
    10,
    "store owner invite API should use configured default days",
  );
  const afterAdminCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: adminSession.token,
    body: { name: "Admin 代建客户", phone: "13600000000" },
  });
  assert.ok(afterAdminCustomer.customers.some((customer) => customer.name === "Admin 代建客户"), "admin should operate customer business with permission template");
  assert.equal(afterAdminCustomer.operationLogs[0].action, "新增客户", "admin business writes should be audited");

  database.replaceData({
    ...database.readData(),
    authUsers: [
      {
        id: "u_legacy_phone_admin",
        name: "后台Admin",
        account: "13827445244",
        password: "legacy-admin-password",
        role: "owner",
        roleName: "老板",
        status: "active",
        createdAt: new Date().toISOString(),
      },
      ...database.readData().authUsers,
    ],
  });
  const phoneAdminSession = await request<{ token: string; user: { role: string; roleName: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "13827445244", password: "legacy-admin-password" },
  });
  assert.equal(phoneAdminSession.user.role, "superadmin", "legacy phone admin account should enter platform admin shell");
  assert.equal(phoneAdminSession.user.roleName, "系统管理员", "legacy phone admin account should show platform admin role name");
  const afterPhoneAdminAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: phoneAdminSession.token,
    body: { customerId: "c1", staffId: "s1", serviceId: "v1", startAt: futureIso(3, "10:00"), roomName: "护理房 1", note: "手机号 Admin 代预约" },
  });
  assert.ok(
    afterPhoneAdminAppointment.appointments.some((appointment) => appointment.note === "手机号 Admin 代预约"),
    "legacy phone admin account should operate business with platform permissions",
  );

  await assert.rejects(
    () =>
      request<{ status: string }>(baseUrl, "/api/auth/join-invite", {
        method: "POST",
        body: {
          inviteCode: "YC8M6P",
          name: "固定码老板",
          storeName: "固定码门店",
          phone: "13900001000",
          address: "固定码地址",
          account: "fixed-invited-owner@test.local",
          password: "secret",
        },
      }),
    /邀请不存在或已失效/,
    "fixed owner invite code should not submit an application",
  );

  const platformAdmin = testFixtureData.authUsers.find((user) => user.role === "superadmin");
  assert.ok(platformAdmin, "test fixture should include a platform admin");
  const invitedOwnerResult = await request<{ status: string; message: string; applicationId?: string }>(baseUrl, "/api/auth/join-invite", {
    method: "POST",
    body: {
      inviteCode: platformInviteCodeForUser(platformAdmin, testFixtureData.authUsers),
      name: "API 老板",
      storeName: "API 邀请门店",
      phone: "13900001111",
      address: "API 邀请地址",
      account: "api-invited-owner@test.local",
      password: "secret",
    },
  });
  assert.equal(invitedOwnerResult.status, "pending_approval", "owner invite should wait for approval");
  assert.ok(invitedOwnerResult.applicationId, "owner invite should return application id");
  const dataAfterOwnerApplication = await request<AppData>(baseUrl, "/api/data", { token: adminSession.token });
  assert.ok(
    dataAfterOwnerApplication.storeOwnerApplications.some((application) => application.id === invitedOwnerResult.applicationId && application.status === "待审批"),
    "owner invite should create a pending application record",
  );
  assert.ok(
    dataAfterOwnerApplication.notifications.some(
      (notification) =>
        notification.targetId === invitedOwnerResult.applicationId &&
        notification.targetType === "storeOwnerApplication" &&
        notification.view === "permissions" &&
        notification.audienceRoles.includes("superadmin"),
    ),
    "owner invite should notify admin about pending store application",
  );
  assert.ok(
    dataAfterOwnerApplication.authUsers.every((user) => user.account !== "api-invited-owner@test.local"),
    "owner invite should not create owner account before approval",
  );

  const afterStoreProfile = await request<AppData>(baseUrl, "/api/store-profile", {
    method: "PATCH",
    token: session.token,
    body: {
      name: "API 皮肤管理中心",
      phone: "13900000002",
      address: "API 新地址",
      businessHours: "09:30 - 22:00",
      roomNames: ["护理房 1", "护理房 2", "API 护理房 1", "API 护理房 2"],
      maintenanceRoomNames: ["API 护理房 2"],
    },
  });
  assert.equal(afterStoreProfile.storeProfiles[0].name, "API 皮肤管理中心", "store profile API should update store name");
  assert.equal(afterStoreProfile.storeProfiles[0].businessHours, "09:30 - 22:00", "store profile API should update business hours");
  assert.deepEqual(afterStoreProfile.storeProfiles[0].roomNames, ["护理房 1", "护理房 2", "API 护理房 1", "API 护理房 2"], "store profile API should update room names");
  assert.deepEqual(afterStoreProfile.storeProfiles[0].maintenanceRoomNames, ["API 护理房 2"], "store profile API should update specified maintenance rooms");
  const afterStoreDisabled = await request<AppData>(baseUrl, `/api/stores/${afterStoreProfile.storeProfiles[0].id}/status`, {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "disabled" },
  });
  assert.equal(afterStoreDisabled.storeProfiles.find((store) => store.id === afterStoreProfile.storeProfiles[0].id)?.status, "disabled", "admin should disable store");
  assert.equal(afterStoreDisabled.operationLogs[0].action, "停用门店", "store status API should write operation log");
  await assert.rejects(
    () => request<{ storefront: { shareCode: string } }>(baseUrl, "/api/public/store/yich-store"),
    /线上店铺不存在或已停用/,
    "disabled store should hide public storefront",
  );
  const afterStoreEnabled = await request<AppData>(baseUrl, `/api/stores/${afterStoreProfile.storeProfiles[0].id}/status`, {
    method: "PATCH",
    token: adminSession.token,
    body: { status: "active" },
  });
  assert.equal(afterStoreEnabled.storeProfiles.find((store) => store.id === afterStoreProfile.storeProfiles[0].id)?.status, "active", "admin should re-enable store");

  const publicStore = await request<{ storefront: { shareCode: string }; services: Array<{ id: string }> }>(baseUrl, "/api/public/store/yich-store");
  assert.equal(publicStore.storefront.shareCode, "yich-store", "public store API should expose enabled storefront");
  assert.ok(publicStore.services.some((service) => service.id === "v1"), "public store API should expose enabled services");

  for (const staffId of ["s1", "s2", "s3"]) {
    await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
      method: "POST",
      token: session.token,
      body: {
        staffId,
        startAt: futureIso(45, "02:00"),
        endAt: futureIso(45, "03:00"),
        reason: "API 线上预约占用校验",
      },
    });
  }
  await assert.rejects(
    () =>
      request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
        method: "POST",
        body: {
          shareCode: "yich-store",
          customerName: "API 冲突客户",
          phone: "13700000018",
          serviceId: "v1",
          preferredAt: futureIso(45, "02:15"),
        },
      }),
    /暂无可预约服务人员/,
    "public booking API should reject a time with no available staff",
  );

  await request<{ ok: boolean }>(baseUrl, "/api/public/online-booking-requests", {
    method: "POST",
    body: {
      shareCode: "yich-store",
      customerName: "API 线上客户",
      phone: "13700000008",
      serviceId: "v1",
      preferredAt: futureIso(30, "02:00"),
      note: "线上预约申请",
    },
  });
  const afterPublicRequest = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(afterPublicRequest.onlineBookingRequests[0].status, "待处理", "public booking request should be visible to manager");
  const onlineBookingNotification = afterPublicRequest.notifications.find((notification) => notification.targetType === "onlineBookingRequest");
  assert.ok(onlineBookingNotification, "public booking should create a notification");
  assert.equal(onlineBookingNotification.view, "appointments", "public booking notification should route to appointments");
  const afterPublicConvert = await request<AppData>(baseUrl, `/api/online-booking-requests/${afterPublicRequest.onlineBookingRequests[0].id}/convert`, {
    method: "POST",
    token: session.token,
    body: { staffId: "s3" },
  });
  assert.equal(afterPublicConvert.onlineBookingRequests[0].status, "已转预约", "online booking request API should convert to appointment");
  assert.equal(afterPublicConvert.customers[0].source, "线上预约", "converted online request should create customer source");

  const afterOnlineStorefront = await request<AppData>(baseUrl, "/api/online-storefront", {
    method: "POST",
    token: session.token,
    body: {
      shareCode: "api-online-store",
      status: "启用",
      headline: "API 线上门店",
      description: "API 线上预约",
      enabledServiceIds: ["v1", "v2"],
    },
  });
  assert.equal(afterOnlineStorefront.onlineStorefronts[0].shareCode, "api-online-store", "online storefront API should update share code");

  const afterServiceWithConsumable = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: { name: "API 耗材绑定护理", category: "皮肤管理", price: 398, duration: 60, consumableProductId: "p4", consumableQty: 2 },
  });
  const serviceRecipeId = afterServiceWithConsumable.services[0].id;
  assert.equal(afterServiceWithConsumable.services[0].consumableProductId, "p4", "service API should persist consumable product");
  assert.equal(afterServiceWithConsumable.services[0].consumableQty, 2, "service API should persist consumable quantity");
  const afterServiceRecipe = await request<AppData>(baseUrl, `/api/services/${serviceRecipeId}/consumables`, {
    method: "PATCH",
    token: session.token,
    body: { consumables: [{ productId: "p4", quantity: 2 }, { productId: "p3", quantity: 1 }] },
  });
  assert.deepEqual(afterServiceRecipe.services[0].consumables, [
    { productId: "p4", quantity: 2 },
    { productId: "p3", quantity: 1 },
  ], "service recipe API should persist multiple consumables");
  const afterServiceWithProductsOnly = await request<AppData>(baseUrl, "/api/services", {
    method: "POST",
    token: session.token,
    body: { name: "API 使用商品护理", category: "皮肤管理", price: 298, duration: 45, defaultTimes: 10, consumables: [{ productId: "p4", quantity: 0 }, { productId: "p3", quantity: 0 }] },
  });
  assert.deepEqual(afterServiceWithProductsOnly.services[0].consumables, [
    { productId: "p4", quantity: 0 },
    { productId: "p3", quantity: 0 },
  ], "service API should persist product-only usage configuration");

  const registeredSession = await request<{ token: string; user: { roleName: string } }>(baseUrl, "/api/auth/register-store", {
    method: "POST",
    body: {
      storeName: "API 测试门店",
      ownerName: "API 老板",
      phone: "13900000000",
      address: "API 地址",
      account: "api-boss@test.local",
      password: "secret",
    },
  });
  assert.equal(registeredSession.user.roleName, "老板", "register store API should login owner");

  const afterStaff = await request<AppData>(baseUrl, "/api/staff", {
    method: "POST",
    token: session.token,
    body: { name: "API 新员工", phone: "13900000001", role: "员工", baseSalary: 6000, commissionRate: 0.1 },
  });
  const apiStaffId = afterStaff.staff[0].id;
  assert.equal(afterStaff.staff[0].name, "API 新员工", "staff API should create staff");
  const afterStaffUpdate = await request<AppData>(baseUrl, `/api/staff/${apiStaffId}`, {
    method: "PATCH",
    token: session.token,
    body: { name: "API 主管", phone: "13900000009", role: "主管", status: "inactive", baseSalary: 6200, commissionRate: 0.18 },
  });
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.status, "inactive", "staff API should disable staff");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.name, "API 主管", "staff API should update staff name");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.role, "主管", "staff API should update staff role");
  assert.equal(afterStaffUpdate.staff.find((item) => item.id === apiStaffId)?.commissionRate, 0.18, "staff API should update commission rate");

  const afterInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
    method: "POST",
    token: session.token,
    body: { staffId: apiStaffId, account: "api-staff@test.local", role: "therapist", validDays: 3 },
  });
  assert.equal(afterInvite.staffInvites[0].status, "待加入", "staff invite API should create invite");
  assert.ok(afterInvite.staffInvites[0].expiresAt, "staff invite API should persist expiry");
  const joinedStaffResult = await request<{ status: string; message: string }>(baseUrl, "/api/auth/join-invite", {
    method: "POST",
    body: { inviteCode: afterInvite.staffInvites[0].inviteCode, name: "API 新员工", password: "secret" },
  });
  assert.equal(joinedStaffResult.status, "pending_approval", "join invite API should wait for staff approval");
  assert.match(joinedStaffResult.message, /店长审核/, "join invite API should explain staff approval");
  const dataAfterStaffJoin = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  const joinedStaffUser = dataAfterStaffJoin.authUsers.find((user) => user.account === "api-staff@test.local");
  assert.ok(joinedStaffUser, "staff invite join should create a pending auth user");
  assert.equal(joinedStaffUser.status, "pending", "joined staff user should wait for manager approval");
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "api-staff@test.local", password: "wrong-secret" },
      }),
    /账号或密码不正确/,
    "pending staff login with wrong password should keep generic credential error",
  );
  await assert.rejects(
    () =>
      request<{ token: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { account: "api-staff@test.local", password: "secret" },
      }),
    /等待店长审批/,
    "pending staff login should explain approval status",
  );
  const afterApproveStaffUser = await request<AppData>(baseUrl, `/api/auth-users/${joinedStaffUser.id}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "active" },
  });
  assert.equal(afterApproveStaffUser.authUsers.find((user) => user.id === joinedStaffUser.id)?.status, "active", "manager should approve own-store staff account");
  const afterStaffPasswordReset = await request<AppData>(baseUrl, `/api/auth-users/${joinedStaffUser.id}/password`, {
    method: "PATCH",
    token: session.token,
    body: { password: "new-secret" },
  });
  assert.equal(afterStaffPasswordReset.operationLogs[0].action, "重置账号密码", "staff password reset should write operation log");
  const approvedStaffSession = await request<{ token: string; user: { role: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "api-staff@test.local", password: "new-secret" },
  });
  assert.equal(approvedStaffSession.user.role, "therapist", "approved staff should login with reset password");

  const afterRevocableStaff = await request<AppData>(baseUrl, "/api/staff", {
    method: "POST",
    token: session.token,
    body: { name: "API 待作废员工", phone: "13900000008", role: "前台", baseSalary: 5000, commissionRate: 0.05 },
  });
  const afterRevocableInvite = await request<AppData>(baseUrl, "/api/staff-invites", {
    method: "POST",
    token: session.token,
    body: { staffId: afterRevocableStaff.staff[0].id, account: "api-revoke-staff@test.local", role: "frontdesk", validDays: 7 },
  });
  const afterInviteRevoked = await request<AppData>(baseUrl, `/api/staff-invites/${afterRevocableInvite.staffInvites[0].id}`, {
    method: "PATCH",
    token: session.token,
  });
  assert.equal(afterInviteRevoked.staffInvites.find((item) => item.id === afterRevocableInvite.staffInvites[0].id)?.status, "已作废", "staff invite API should revoke pending invite");
  const afterDeleteRevocableStaff = await request<AppData>(baseUrl, `/api/staff/${afterRevocableStaff.staff[0].id}`, {
    method: "DELETE",
    token: session.token,
  });
  assert.equal(afterDeleteRevocableStaff.staff.some((item) => item.id === afterRevocableStaff.staff[0].id), false, "staff API should delete staff without business records");
  assert.equal(afterDeleteRevocableStaff.operationLogs[0].action, "删除员工", "staff delete API should write operation log");

  const afterCustomer = await request<AppData>(baseUrl, "/api/customers", {
    method: "POST",
    token: session.token,
    body: { name: "李女士", phone: "13600000004" },
  });
  assert.equal(afterCustomer.customers[0].name, "李女士", "customer API should create a customer");
  const afterCustomerTags = await request<AppData>(baseUrl, `/api/customers/${afterCustomer.customers[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { level: "VIP", source: "转介绍", tags: ["敏感肌", "高消费"] },
  });
  assert.equal(afterCustomerTags.customers[0].level, "VIP", "customer API should update member level");
  assert.deepEqual(afterCustomerTags.customers[0].tags, ["敏感肌", "高消费"], "customer API should update tags");
  const afterTag = await request<AppData>(baseUrl, "/api/tags", {
    method: "POST",
    token: session.token,
    body: { name: "API 熟客", scope: "客户", color: "#db2777" },
  });
  assert.equal(afterTag.tagDefinitions[0].name, "API 熟客", "tag API should create tag definition");
  const afterTagStatus = await request<AppData>(baseUrl, `/api/tags/${afterTag.tagDefinitions[0].id}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "停用" },
  });
  assert.equal(afterTagStatus.tagDefinitions[0].status, "停用", "tag API should update tag status");
  const conflictStartAt = initialData.appointments.find((appointment) => appointment.staffId === "s2")?.startAt;
  assert.ok(conflictStartAt, "test fixture should include existing therapist appointment");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          startAt: conflictStartAt,
          roomName: "护理房 1",
          note: "冲突预约",
        },
      }),
    /已有预约/,
    "appointment API should reject staff time conflicts",
  );

  const afterAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(31, "02:00"),
      endAt: futureIso(31, "03:30"),
      roomName: "护理房 1",
      note: "API 预约",
    },
  });
  assert.equal(afterAppointment.appointments[0].status, "已确认", "appointment API should create confirmed appointment");
  assert.equal(afterAppointment.appointments[0].endAt, futureIso(31, "03:30"), "appointment API should persist explicit end time");
  const appointmentId = afterAppointment.appointments[0].id;
  assert.equal(afterAppointment.notifications[0].targetId, appointmentId, "appointment API should create a target notification");
  const afterNotificationRead = await request<AppData>(baseUrl, `/api/notifications/${afterAppointment.notifications[0].id}/read`, {
    method: "PATCH",
    token: session.token,
  });
  assert.ok(afterNotificationRead.notifications.find((item) => item.id === afterAppointment.notifications[0].id)?.readByUserIds.includes("u_manager"), "notification API should mark one item read");
  const afterNotificationArchive = await request<AppData>(baseUrl, `/api/notifications/${afterAppointment.notifications[0].id}/archive`, {
    method: "PATCH",
    token: session.token,
  });
  assert.ok(
    afterNotificationArchive.notifications.find((item) => item.id === afterAppointment.notifications[0].id)?.archivedByUserIds?.includes("u_manager"),
    "notification API should archive one item for current user",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: "已完成" },
      }),
    /不能从已确认改为已完成/,
    "appointment API should reject invalid status transitions",
  );
  const afterArrive = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  assert.ok(afterArrive.appointments.find((item) => item.id === appointmentId)?.arrivedAt, "appointment API should stamp arrival");
  const afterComplete = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已完成" },
  });
  assert.ok(afterComplete.appointments.find((item) => item.id === appointmentId)?.completedAt, "appointment API should stamp completion");

  const afterSecondAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      startAt: futureIso(32, "05:00"),
      endAt: futureIso(32, "06:00"),
      roomName: "护理房 1",
      note: "API 改约测试",
    },
  });
  const secondAppointmentId = afterSecondAppointment.appointments[0].id;
  const afterReschedule = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}/reschedule`, {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      serviceId: "v2",
      startAt: futureIso(32, "06:00"),
      endAt: futureIso(32, "07:00"),
      roomName: "护理房 2",
      note: "API 已改约",
    },
  });
  assert.equal(afterReschedule.appointments[0].serviceId, "v2", "appointment API should reschedule service");
  assert.equal(afterReschedule.appointments[0].endAt, futureIso(32, "07:00"), "appointment API should reschedule end time");
  assert.ok(afterReschedule.appointments[0].rescheduledAt, "appointment API should stamp reschedule time");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}`, {
        method: "PATCH",
        token: session.token,
        body: { status: "已取消" },
      }),
    /必须填写原因/,
    "appointment API should require cancel reason",
  );
  const afterCancel = await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(secondAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已取消", reason: "客户临时取消" },
  });
  assert.equal(afterCancel.appointments[0].cancelReason, "客户临时取消", "appointment API should keep cancel reason");

  const afterUnavailableSlot = await request<AppData>(baseUrl, "/api/staff-unavailable-slots", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: futureIso(33, "02:00"),
      endAt: futureIso(33, "03:00"),
      reason: "API 员工培训",
    },
  });
  assert.equal(afterUnavailableSlot.staffUnavailableSlots[0].reason, "API 员工培训", "unavailable slot API should create staff block");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: futureIso(33, "02:15"),
          roomName: "护理房 1",
          note: "不可预约冲突",
        },
      }),
    /不可预约/,
    "appointment API should reject unavailable staff slots",
  );

  const afterShift = await request<AppData>(baseUrl, "/api/staff-shifts", {
    method: "POST",
    token: session.token,
    body: {
      staffId: "s3",
      startAt: futureIso(34, "02:00"),
      endAt: futureIso(34, "03:00"),
      note: "API 早班",
    },
  });
  assert.equal(afterShift.staffShifts[0].note, "API 早班", "staff shift API should create shift");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/appointments", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v1",
          startAt: futureIso(34, "04:00"),
          roomName: "护理房 1",
          note: "班次外预约",
        },
      }),
    /不在服务人员班次内/,
    "appointment API should reject time outside shift",
  );

  const afterApprovalRequest = await request<AppData>(baseUrl, "/api/approvals", {
    method: "POST",
    token: session.token,
    body: { type: "改价折扣", targetId: "manual", amount: 50, reason: "API 会员维护价" },
  });
  const discountApprovalId = afterApprovalRequest.approvalRequests[0].id;
  assert.equal(afterApprovalRequest.notifications[0].targetId, discountApprovalId, "approval request should create notification");
  assert.ok(afterApprovalRequest.notifications[0].audienceRoles.includes("finance"), "approval notification should include finance");
  const afterApprovalDecision = await request<AppData>(baseUrl, `/api/approvals/${discountApprovalId}`, {
    method: "PATCH",
    token: session.token,
    body: { approved: true },
  });
  assert.equal(afterApprovalDecision.approvalRequests[0].status, "已通过", "approval API should approve request");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/distributors", {
        method: "POST",
        token: session.token,
        body: { type: "客户", customerId: afterCustomer.customers[0].id, rate: 0.07 },
      }),
    /Not found/,
    "base API should not expose distributor creation",
  );
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/referral-relations", {
        method: "POST",
        token: session.token,
        body: { distributorId: "disabled", customerId: "c3" },
      }),
    /Not found/,
    "base API should not expose referral binding",
  );

  const afterDiscountCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
      discountAmount: 50,
      adjustmentReason: "API 会员维护价",
      approvalId: discountApprovalId,
    },
  });
  assert.equal(afterDiscountCheckout.orders[0].paidAmount, 348, "approved discount checkout should reduce paid amount");
  assert.equal(afterDiscountCheckout.orders[0].discountAmount, 50, "discount checkout should persist adjustment");

  const afterCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      checkoutRequestId: "api-checkout-multi-1",
      customerId: "c1",
      staffId: "s2",
      serviceId: serviceRecipeId,
      productItems: [{ productId: "p4", quantity: 2 }],
      giftProductItems: [{ productId: "p2", quantity: 2 }],
      payMethod: "微信",
    },
  });
  assert.equal(afterCheckout.orders.length, 2, "checkout API should create another order");
  assert.equal(afterCheckout.orders[0].totalAmount, 796, "checkout API should calculate multi-product total");
  assert.deepEqual(afterCheckout.orders[0].productItems?.map((item) => [item.productId, item.quantity]), [["p4", 2]], "checkout API should persist sale item lines");
  assert.equal(afterCheckout.orders[0].giftProductId, "p2", "checkout API should persist gift product");
  assert.deepEqual(afterCheckout.orders[0].giftProductItems?.map((item) => [item.productId, item.quantity]), [["p2", 2]], "checkout API should persist gift item lines");
  assert.equal(afterCheckout.products.find((item) => item.id === "p1")?.stock, 18, "checkout API should not consume liquid service product stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p3")?.stock, 8, "checkout API should consume configured package service stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p2")?.stock, 10, "checkout API should consume gift stock");
  assert.equal(afterCheckout.products.find((item) => item.id === "p4")?.stock, 21.8, "checkout API should consume retail stock and configured service stock with package conversion");
  const checkoutCommissions = afterCheckout.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id);
  assert.equal(checkoutCommissions.length, 2, "checkout API should create service and sales commissions");
  assert.equal(checkoutCommissions.find((item) => item.type === "服务提成")?.amount, 48, "checkout API should create service commission");
  assert.equal(checkoutCommissions.find((item) => item.type === "销售提成")?.amount, 48, "checkout API should create sales commission");
  assert.equal(checkoutCommissions[0].rate, 0.12, "checkout API should persist staff commission rate");
  assert.equal(afterCheckout.operationLogs[0].action, "开单收银", "checkout API should write operation log");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          checkoutRequestId: "api-checkout-multi-1",
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          productItems: [{ productId: "p4", quantity: 1 }],
          payMethod: "微信",
        },
      }),
    /重复提交/,
    "checkout API should reject duplicate request ids even when order details differ",
  );

  const afterRefund = await request<AppData>(baseUrl, `/api/orders/${afterCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 测试退款" },
  });
  const refundedOrder = afterRefund.orders.find((item) => item.id === afterCheckout.orders[0].id);
  assert.ok(refundedOrder, "refunded order should still exist");
  assert.equal(refundedOrder.status, "已退款", "refund API should update order status");
  assert.equal(afterRefund.refunds[0].amount, 796, "refund API should write refund record");
  assert.equal(afterRefund.products.find((item) => item.id === "p1")?.stock, 18, "refund API should keep liquid service product stock untouched");
  assert.equal(afterRefund.products.find((item) => item.id === "p3")?.stock, 9, "refund API should restore this order's package service stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p2")?.stock, 12, "refund API should restore gift stock");
  assert.equal(afterRefund.products.find((item) => item.id === "p4")?.stock, 24, "refund API should restore retail stock");
  assert.ok(afterRefund.commissions.filter((item) => item.orderId === afterCheckout.orders[0].id).every((item) => item.status === "已冲销"), "refund API should reverse commission");
  assert.equal(afterRefund.distributionCommissions.length, 0, "base API should not expose distribution commissions");

  const afterPartialCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const afterPartialRefund = await request<AppData>(baseUrl, `/api/orders/${afterPartialCheckout.orders[0].id}/refund`, {
    method: "POST",
    token: session.token,
    body: { reason: "API 部分退款", amount: 100 },
  });
  const partialRefundOrder = afterPartialRefund.orders.find((item) => item.id === afterPartialCheckout.orders[0].id);
  assert.ok(partialRefundOrder, "partial refund order should still exist");
  assert.equal(partialRefundOrder.status, "部分退款", "partial refund API should keep partial status");
  assert.equal(partialRefundOrder.paidAmount, 298, "partial refund API should reduce paid amount");

  const afterSplitCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      collaboratorStaffIds: ["s1"],
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const splitCommissions = afterSplitCheckout.commissions.filter((item) => item.orderId === afterSplitCheckout.orders[0].id);
  assert.equal(splitCommissions.length, 2, "checkout API should create collaborator commissions");
  assert.equal(splitCommissions.reduce((sum, item) => sum + item.amount, 0), 48, "split commission API should preserve total amount");

  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c3",
          staffId: "s1",
          serviceId: "v2",
          payMethod: "会员卡",
          cardId: "m2",
        },
      }),
    /不可用于当前项目/,
    "project-bound times card should reject unmatched service through API",
  );

  const afterCardCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "会员卡",
      cardId: "m1",
    },
  });
  assert.equal(afterCardCheckout.memberCards.find((item) => item.id === "m1")?.balance, 2202, "member card API should deduct balance");
  assert.equal(afterCardCheckout.memberCardTransactions[0].type, "消费", "member card API should write transaction");

  const afterOpenCard = await request<AppData>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { customerId: "c2", type: "储值卡", balance: 500, remainingTimes: 0, paidAmount: 500, payMethod: "微信", expiresAt: "2027-12-31" },
  });
  const apiCardId = afterOpenCard.memberCards[0].id;
  assert.equal(afterOpenCard.memberCards[0].name, "储值卡", "open stored-value card API should default card name");
  assert.equal(afterOpenCard.memberCardTransactions[0].paidAmount, 500, "open card API should persist paid amount");
  assert.equal(afterOpenCard.memberCardTransactions[0].payMethod, "微信", "open card API should persist payment method");
  assert.equal(afterOpenCard.memberCardTransactions[0].staffId, "s1", "open card API should persist current staff");
  const afterOpenPackageCard = await request<AppData>(baseUrl, "/api/member-cards", {
    method: "POST",
    token: session.token,
    body: { customerId: "c2", name: "API 套餐卡", type: "套餐卡", balance: 0, remainingTimes: 5, serviceIds: ["v1", "v2"], paidAmount: 1200, payMethod: "支付宝", expiresAt: "2027-12-31" },
  });
  const packageCard = afterOpenPackageCard.memberCards[0];
  assert.equal(packageCard.type, "套餐卡", "package card API should persist package type");
  assert.deepEqual(packageCard.serviceIds, ["v1", "v2"], "package card API should persist multiple services");
  const afterPackageCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c2",
      staffId: "s2",
      serviceId: "v2",
      payMethod: "会员卡",
      cardId: packageCard.id,
    },
  });
  assert.equal(afterPackageCheckout.memberCards.find((item) => item.id === packageCard.id)?.remainingTimes, 4, "package card should be usable by any selected package service");
  const afterRecharge = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/recharge`, {
    method: "POST",
    token: session.token,
    body: { amount: 100, paidAmount: 100, payMethod: "微信", note: "API 充值" },
  });
  assert.equal(afterRecharge.memberCards.find((item) => item.id === apiCardId)?.balance, 600, "recharge API should increase balance");
  const afterFreeze = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "冻结", reason: "API 冻结" },
  });
  assert.equal(afterFreeze.memberCards.find((item) => item.id === apiCardId)?.status, "冻结", "status API should freeze card");
  const afterUnfreeze = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/status`, {
    method: "PATCH",
    token: session.token,
    body: { status: "正常", reason: "API 解冻" },
  });
  assert.equal(afterUnfreeze.memberCards.find((item) => item.id === apiCardId)?.status, "正常", "status API should unfreeze card");
  const afterExtend = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/extend`, {
    method: "PATCH",
    token: session.token,
    body: { expiresAt: "2028-12-31", reason: "API 延期" },
  });
  assert.equal(afterExtend.memberCards.find((item) => item.id === apiCardId)?.expiresAt, "2028-12-31", "extend API should update expiry");
  const afterTransfer = await request<AppData>(baseUrl, `/api/member-cards/${apiCardId}/transfer`, {
    method: "POST",
    token: session.token,
    body: { toCustomerId: "c3", reason: "API 转卡" },
  });
  assert.equal(afterTransfer.memberCards.find((item) => item.id === apiCardId)?.customerId, "c3", "transfer API should update card owner");

  const refundSignatureData = await request<AppData>(baseUrl, "/api/customer-signatures", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      title: "会员卡退费确认签名",
      content: "本人确认办理尊享储值卡退费，实退金额¥100，退款方式银行卡，退费后会员卡关闭。",
      validDays: 1,
    },
  });
  const refundSignature = refundSignatureData.customerSignatures[0];
  await request<AppData>(baseUrl, `/api/customer-signatures/${refundSignature.id}/sign`, {
    method: "POST",
    token: session.token,
    body: { signerName: "周女士", signatureText: "data:image/png;base64,refund-api" },
  });
  const afterCardRefund = await request<AppData>(baseUrl, "/api/member-cards/m1/refund", {
    method: "POST",
    token: session.token,
    body: { reason: "API 退卡", refundAmount: 100, payMethod: "银行卡", signatureId: refundSignature.id },
  });
  assert.equal(afterCardRefund.memberCards.find((item) => item.id === "m1")?.status, "已退卡", "member card refund API should close card");
  assert.equal(afterCardRefund.memberCardTransactions[0].type, "退卡", "member card refund API should write transaction");
  assert.equal(afterCardRefund.memberCardTransactions[0].paidAmount, 100, "member card refund API should persist actual refund amount");
  assert.equal(afterCardRefund.memberCardTransactions[0].payMethod, "银行卡", "member card refund API should persist refund payment method");

  const afterInventory = await request<AppData>(baseUrl, "/api/inventory/adjust", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", type: "入库", quantity: 2, note: "API 入库", expiryAt: "2027-08-01" },
  });
  assert.equal(afterInventory.products.find((item) => item.id === "p1")?.stock, 20, "inventory API should increase liquid product stock without service deduction");
  assert.equal(afterInventory.inventoryLogs[0].note, "API 入库", "inventory API should persist note");
  assert.equal(afterInventory.inventoryLogs[0].expiryAt, "2027-08-01", "inventory API should persist expiry date");

  const afterRecordCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      payMethod: "微信",
    },
  });
  const afterServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: afterRecordCheckout.orders[0].id,
      skinCondition: "敏感偏干",
      beforeNote: "API 服务前",
      careSteps: "API 清洁、导入、修护",
      productsUsed: "API 清洁精华液",
      afterNote: "API 服务后",
      customerFeedback: "API 体验舒适",
      nextCareAdvice: "API 加强保湿防晒",
      nextFollowUpAt: futureIso(35, "10:00"),
    },
  });
  assert.equal(afterServiceRecord.customerServiceRecords.length, 1, "service record API should create record");
  assert.equal(afterServiceRecord.customerServiceRecords[0].orderId, afterRecordCheckout.orders[0].id, "service record API should link order");
  assert.equal(afterServiceRecord.customerServiceRecords[0].careSteps, "API 清洁、导入、修护", "service record API should persist care steps");
  assert.equal(afterServiceRecord.customerServiceRecords[0].productsUsed, "API 清洁精华液", "service record API should persist products used");
  assert.equal(afterServiceRecord.customerServiceRecords[0].customerFeedback, "API 体验舒适", "service record API should persist customer feedback");
  assert.equal(afterServiceRecord.customerServiceRecords[0].nextCareAdvice, "API 加强保湿防晒", "service record API should persist next care advice");
  assert.match(afterServiceRecord.customerFollowUps[0].note, /API 加强保湿防晒/, "service record API follow-up should use next care advice");
  assert.equal(afterServiceRecord.notifications[0].targetId, afterServiceRecord.customerFollowUps[0].id, "service record should create follow-up notification");
  const afterSignature = await request<AppData>(baseUrl, "/api/customer-signatures", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      serviceRecordId: afterServiceRecord.customerServiceRecords[0].id,
      orderId: afterRecordCheckout.orders[0].id,
      title: "API 客户服务确认",
      content: "API 确认内容",
      validDays: 3,
    },
  });
  assert.equal(afterSignature.customerSignatures[0].status, "待签名", "customer signature API should create pending signature");
  const signatureToken = afterSignature.customerSignatures[0].token;
  const publicSignature = await request<{ signature: { status: string }; customer: { phone: string } }>(baseUrl, `/api/public/customer-signatures/${signatureToken}`);
  assert.equal(publicSignature.signature.status, "待签名", "public signature API should expose pending signature");
  assert.match(publicSignature.customer.phone, /\*\*\*\*/, "public signature API should mask phone");
  const signedSignature = await request<{ signature: { status: string; signerName: string; signatureText?: string } }>(baseUrl, `/api/public/customer-signatures/${signatureToken}/sign`, {
    method: "POST",
    body: { signerName: "周女士", signatureText: "data:image/png;base64,api123" },
  });
  assert.equal(signedSignature.signature.status, "已签名", "public signature API should sign signature");
  assert.equal(signedSignature.signature.signerName, "周女士", "public signature API should persist signer");
  assert.match(signedSignature.signature.signatureText ?? "", /^data:image\/png;base64,/, "public signature API should persist handwritten image data");
  const afterAllNotificationsRead = await request<AppData>(baseUrl, "/api/notifications/read-all", {
    method: "POST",
    token: session.token,
  });
  assert.ok(afterAllNotificationsRead.notifications.every((item) => item.readByUserIds.includes("u_manager")), "notification API should mark visible notifications read");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/service-records", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s2",
          serviceId: "v1",
          orderId: afterRecordCheckout.orders[0].id,
          skinCondition: "敏感偏干",
          beforeNote: "API 重复建档",
          afterNote: "API 服务后",
        },
      }),
    /已生成服务记录/,
    "service record API should reject duplicate order record",
  );
  const afterCardServiceRecord = await request<AppData>(baseUrl, "/api/service-records", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s2",
      serviceId: "v1",
      orderId: afterCardCheckout.orders[0].id,
      skinCondition: "会员卡到店服务",
      beforeNote: "API 会员卡服务前",
      afterNote: "API 会员卡服务后",
    },
  });
  assert.equal(afterCardServiceRecord.customerServiceRecords[0].memberCardTransactionId, afterCardCheckout.memberCardTransactions[0].id, "service record API should link member-card consumption");
  assert.match(afterCardServiceRecord.customerServiceRecords[0].productsUsed, /清洁精华液/, "service record API should derive used products");
  const followUpId = afterServiceRecord.customerFollowUps[0].id;
  const afterFollowUpDone = await request<AppData>(baseUrl, `/api/follow-ups/${followUpId}`, {
    method: "PATCH",
    token: session.token,
  });
  assert.equal(afterFollowUpDone.customerFollowUps[0].status, "已完成", "follow-up API should complete follow-up");

  const afterSupplier = await request<AppData>(baseUrl, "/api/suppliers", {
    method: "POST",
    token: session.token,
    body: { name: "API 供应商", phone: "13800000000", contact: "王经理" },
  });
  const supplierId = afterSupplier.suppliers[0].id;
  const afterPurchase = await request<AppData>(baseUrl, "/api/purchase-orders", {
    method: "POST",
    token: session.token,
    body: { supplierId, productId: "p1", quantity: 3, unitCost: 60, expiryAt: "2028-01-31" },
  });
  assert.equal(afterPurchase.inventoryLogs[0].type, "采购入库", "purchase API should create inbound inventory log");
  assert.equal(afterPurchase.inventoryLogs[0].expiryAt, "2028-01-31", "purchase API should persist expiry date");
  const afterLowStockProduct = await request<AppData>(baseUrl, "/api/products", {
    method: "POST",
    token: session.token,
    body: { name: "API 低库存面膜", type: "consumable", category: "面护类", subcategory: "面膜", stock: 1, warningStock: 5, unit: "盒", price: 30, cost: 12, shelfLifeMonths: 18, expiryAt: "2027-11-30", serviceUnit: "片", serviceUnitsPerStockUnit: 20 },
  });
  const lowStockProductId = afterLowStockProduct.products[0].id;
  assert.equal(afterLowStockProduct.products[0].category, "面护类", "product API should persist category");
  assert.equal(afterLowStockProduct.products[0].subcategory, "面膜", "product API should persist subcategory");
  assert.equal(afterLowStockProduct.products[0].expiryAt, "2027-11-30", "product API should persist first-batch expiry");
  assert.equal(afterLowStockProduct.products[0].serviceStockDeductible, true, "product API should default intake products to stock deduction");
  assert.equal(afterLowStockProduct.products[0].serviceUnit, "片", "product API should persist service unit");
  assert.equal(afterLowStockProduct.products[0].serviceUnitsPerStockUnit, 20, "product API should persist package quantity");
  assert.equal(afterLowStockProduct.inventoryLogs[0].expiryAt, "2027-11-30", "product API should create first-batch inventory log with expiry");
  const afterRestock = await request<AppData>(baseUrl, "/api/inventory/restock-low", {
    method: "POST",
    token: session.token,
    body: { supplierId },
  });
  assert.ok(afterRestock.purchaseOrders.some((order) => order.productId === lowStockProductId), "restock API should create purchase order for low stock product");
  assert.ok((afterRestock.products.find((product) => product.id === lowStockProductId)?.stock ?? 0) > 5, "restock API should replenish stock above warning line");
  assert.equal(afterRestock.operationLogs[0].action, "一键补货", "restock API should write operation log");
  const afterStocktake = await request<AppData>(baseUrl, "/api/stocktakes", {
    method: "POST",
    token: session.token,
    body: { productId: "p1", actualStock: 20, reason: "API 盘点" },
  });
  assert.equal(afterStocktake.stocktakes[0].actualStock, 20, "stocktake API should create stocktake record");

  const afterDailyClose = await request<AppData>(baseUrl, "/api/daily-close", {
    method: "POST",
    token: session.token,
    body: { businessDate: new Date().toISOString().slice(0, 10) },
  });
  assert.equal(afterDailyClose.dailyCloses.length, 1, "daily close API should create daily close record");
  assert.ok(afterDailyClose.dailyCloses[0].revenue >= 398, "daily close should summarize revenue");
  const afterCommissionSettlement = await request<AppData>(baseUrl, "/api/commissions/settle", {
    method: "POST",
    token: session.token,
  });
  assert.equal(afterCommissionSettlement.commissionSettlements[0].type, "员工提成", "commission settle API should create settlement batch");
  assert.ok(afterCommissionSettlement.commissions.every((item) => item.status !== "待结算"), "commission settle API should settle pending commissions");
  assert.ok(afterCommissionSettlement.commissions.some((item) => item.settlementId === afterCommissionSettlement.commissionSettlements[0].id), "commission settle API should stamp settlement id");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/inventory/adjust", {
        method: "POST",
        token: session.token,
        body: { productId: "p1", type: "入库", quantity: 1 },
      }),
    /已日结锁账/,
    "daily close should lock same-day inventory API",
  );
  const afterReverseClose = await request<AppData>(baseUrl, "/api/daily-close/reverse", {
    method: "POST",
    token: session.token,
    body: { businessDate: new Date().toISOString().slice(0, 10) },
  });
  assert.equal(afterReverseClose.dailyCloses[0].status, "已反结", "reverse close API should unlock business day");

  const therapistSession = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { account: "therapist@test.local", password: "test-password" },
  });
  const therapistData = await request<AppData>(baseUrl, "/api/data", { token: therapistSession.token });
  assert.ok(therapistData.customers.some((item) => item.id === "c3"), "therapist should see same-store customers handled by other staff");
  assert.ok(therapistData.customerServiceRecords.every((item) => item.storeId === "store1"), "therapist should receive same-store customer service records");
  assert.ok(therapistData.appointments.every((item) => item.staffId === "s2"), "therapist should only see own appointments");
  assert.ok(therapistData.orders.every((item) => item.staffId === "s2"), "therapist should only see own orders");
  assert.ok(therapistData.staffUnavailableSlots.every((item) => item.staffId === "s2"), "therapist should only see own unavailable slots");
  assert.equal(therapistData.dailyCloses.length, 0, "therapist should not receive daily close data");

  const persistedData = await request<AppData>(baseUrl, "/api/data", { token: session.token });
  assert.equal(persistedData.orders.length, 7, "API data should persist across requests");
  assert.equal(persistedData.refunds.length, 2, "API data should persist refunds");
  assert.equal(persistedData.distributionCommissions.length, 0, "base API should not expose distribution commissions");
  assert.ok(persistedData.operationLogs.length >= 4, "API data should persist operation logs");

  const afterArrivedAppointment = await request<AppData>(baseUrl, "/api/appointments", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v1",
      serviceIds: ["v1", "v2"],
      startAt: futureIso(36, "08:00"),
      endAt: futureIso(36, "09:00"),
      roomName: "护理房 1",
      note: "API 预约收银",
    },
  });
  const checkoutAppointmentId = afterArrivedAppointment.appointments[0].id;
  assert.deepEqual(afterArrivedAppointment.appointments[0].serviceIds, ["v1", "v2"], "appointment API should persist multiple services");
  await request<AppData>(baseUrl, `/api/appointments/${encodeURIComponent(checkoutAppointmentId)}`, {
    method: "PATCH",
    token: session.token,
    body: { status: "已到店" },
  });
  const afterAppointmentCheckout = await request<AppData>(baseUrl, "/api/checkout", {
    method: "POST",
    token: session.token,
    body: {
      customerId: "c1",
      staffId: "s3",
      serviceId: "v2",
      appointmentId: checkoutAppointmentId,
      payMethod: "微信",
    },
  });
  assert.equal(afterAppointmentCheckout.orders[0].appointmentId, checkoutAppointmentId, "checkout API should link arrived appointment");
  assert.equal(afterAppointmentCheckout.orders[0].serviceId, "v2", "checkout API should allow one of appointment services");
  assert.equal(afterAppointmentCheckout.appointments.find((item) => item.id === checkoutAppointmentId)?.status, "已完成", "checkout API should complete appointment");
  assert.equal(afterAppointmentCheckout.customerSignatures[0].orderId, afterAppointmentCheckout.orders[0].id, "checkout API should create pending signature after service checkout");
  await assert.rejects(
    () =>
      request<AppData>(baseUrl, "/api/checkout", {
        method: "POST",
        token: session.token,
        body: {
          customerId: "c1",
          staffId: "s3",
          serviceId: "v3",
          appointmentId: checkoutAppointmentId,
          payMethod: "微信",
        },
      }),
    /只有已到店预约可以直接收银|收银信息与预约不一致/,
    "checkout API should reject invalid appointment checkout",
  );

  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/reset", { method: "POST", token: session.token }),
    /Not found/,
    "formal API should not expose a reset endpoint",
  );

  const dataQuality = await request<{ issueCount: number; removalCounts: Array<{ scope: string; count: number }> }>(baseUrl, "/api/data-quality", { token: session.token });
  assert.ok(dataQuality.issueCount > 0, "data quality API should preview fixture cleanup issues");
  assert.ok(dataQuality.removalCounts.length > 0, "data quality API should include cleanup removal counts");
  await assert.rejects(
    () => request<AppData>(baseUrl, "/api/data-quality/cleanup", { method: "POST", token: registeredSession.token, body: { confirm: "错误确认" } }),
    /确认短语不正确/,
    "data cleanup API should require exact confirmation phrase",
  );
  const afterFormalCleanup = await request<AppData>(baseUrl, "/api/data-quality/cleanup", {
    method: "POST",
    token: registeredSession.token,
    body: { confirm: "清理非正式数据" },
  });
  assert.ok(afterFormalCleanup.staff.every((staff) => !staff.name.includes("验证")), "data cleanup API should remove verification staff");
  assert.ok(afterFormalCleanup.authUsers.every((user) => !user.account.includes("@test.local")), "data cleanup API should remove test accounts");

  console.log("API/SQLite 验证通过：健康检查、注册/邀请、登录鉴权、人员管理、权限、客户、预约/班次、审批改价、开单、退款、卡项、档案跟进、客户签名、进销存、日结反结、数据范围、持久化、正式接口边界。");
} finally {
  await close(server);
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
}

function listen(server: Server) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法获取测试 API 地址"));
        return;
      }
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request<T>(baseUrl: string, path: string, options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(isErrorPayload(data) ? data.error : `HTTP ${response.status}`);
  }
  return data as T;
}

async function requestForm<T>(baseUrl: string, path: string, options: { method?: string; body: FormData; token?: string }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body,
  });
  const data = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(isErrorPayload(data) ? data.error : `HTTP ${response.status}`);
  }
  return data as T;
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string";
}
