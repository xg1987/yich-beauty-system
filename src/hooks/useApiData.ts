import { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, setActiveDataScope, type JoinInviteResult } from "../api/client";
import { normalizeUserSession, type UserSession } from "../domain/auth";
import { emptyAppData, isAppDataSlice, isViewKey, type AppDataUpdate } from "../domain/dataSlices";
import type { AppData, ViewKey } from "../domain/types";

const SESSION_KEY = "yich-system-session";
const STORE_NAME_KEY = "yich-store-name";

function initialDataView(): ViewKey {
  const requestedView = new URLSearchParams(window.location.search).get("view");
  return isViewKey(requestedView) ? requestedView : "dashboard";
}

function readSavedSession() {
  const savedSession = localStorage.getItem(SESSION_KEY);
  if (!savedSession) return undefined;
  try {
    return normalizeUserSession(JSON.parse(savedSession) as UserSession);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return undefined;
  }
}

function saveSession(session: UserSession) {
  const normalized = normalizeUserSession(session);
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

export function useApiData() {
  const [session, setSession] = useState<UserSession | undefined>(readSavedSession);
  const [data, setData] = useState<AppData | undefined>();
  const [loading, setLoading] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const mutationPendingRef = useRef(false);
  const dataRef = useRef<AppData | undefined>(undefined);

  const client = useMemo(() => createApiClient(() => session?.token), [session?.token]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!session || data) return;
    void refreshData();
  }, [session?.token]);

  const login = async (account: string, password: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const nextSession = saveSession(await client.login(account, password));
      setSession(nextSession);
      const nextData = await createApiClient(() => nextSession.token).fetchDataSlice(initialDataView());
      setData(mergeAppDataUpdate(undefined, nextData));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const authenticate = async (authAction: () => Promise<UserSession>) => {
    setLoading(true);
    setError(undefined);
    try {
      const nextSession = saveSession(await authAction());
      setSession(nextSession);
      const nextData = await createApiClient(() => nextSession.token).fetchDataSlice(initialDataView());
      setData(mergeAppDataUpdate(undefined, nextData));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "认证失败");
    } finally {
      setLoading(false);
    }
  };

  const joinInvite = async (body: { inviteCode: string; name: string; password: string; storeName?: string; phone?: string; address?: string; account?: string }): Promise<JoinInviteResult> => {
    setLoading(true);
    setError(undefined);
    try {
      return await client.joinInvite(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入门店失败");
      throw caught;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(STORE_NAME_KEY);
    setSession(undefined);
    setData(undefined);
    setError(undefined);
    setLoading(false);
    mutationPendingRef.current = false;
    setMutationPending(false);
  };

  const refreshData = async () => {
    if (!session) return;
    setLoading(true);
    setError(undefined);
    try {
      const nextData = await client.fetchDataSlice(initialDataView());
      setData(mergeAppDataUpdate(undefined, nextData));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "加载数据失败";
      if (message.includes("请先登录")) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(STORE_NAME_KEY);
        setSession(undefined);
        setData(undefined);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const refreshDataView = async (view: ViewKey) => {
    if (!session || !dataRef.current) return;
    setError(undefined);
    try {
      const slice = await client.fetchDataSlice(view);
      setData((current) => mergeAppDataUpdate(current, slice));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刷新页面数据失败");
    }
  };

  const updateActiveDataScope = (view: ViewKey | undefined) => {
    setActiveDataScope(view);
  };

  const runMutation = async (mutation: () => Promise<AppDataUpdate>) => {
    if (mutationPendingRef.current) {
      const duplicateError = new Error("操作正在处理中，请勿重复点击");
      throw duplicateError;
    }
    mutationPendingRef.current = true;
    setLoading(true);
    setMutationPending(true);
    setError(undefined);
    try {
      const update = await mutation();
      const nextData = mergeAppDataUpdate(dataRef.current, update);
      setData(nextData);
      return nextData;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      throw caught;
    } finally {
      mutationPendingRef.current = false;
      setMutationPending(false);
      setLoading(false);
    }
  };

  const updateAccountProfile = async (body: { name: string; avatarUrl?: string }) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.updateAccountProfile(body);
      const nextSession = saveSession(result.session);
      setSession(nextSession);
      setData(result.data);
      return { ...result, session: nextSession };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号资料保存失败");
      throw caught;
    } finally {
      setLoading(false);
    }
  };

  const actions = useMemo(() => ({
    addStaff: client.addStaff,
    updateStaff: client.updateStaff,
    deleteStaff: client.deleteStaff,
    updateStoreProfile: client.updateStoreProfile,
    fetchR2Usage: client.fetchR2Usage,
    fetchWorkerUsage: client.fetchWorkerUsage,
    fetchDataQuality: client.fetchDataQuality,
    cleanupFormalData: client.cleanupFormalData,
    uploadAccountAvatar: client.uploadAccountAvatar,
    updateAuthUserStatus: client.updateAuthUserStatus,
    resetAuthUserPassword: client.resetAuthUserPassword,
    updateSystemConfig: client.updateSystemConfig,
    updateStoreStatus: client.updateStoreStatus,
    createStaffInvite: client.createStaffInvite,
    createStoreOwnerInvite: client.createStoreOwnerInvite,
    decideStoreOwnerApplication: client.decideStoreOwnerApplication,
    revokeStaffInvite: client.revokeStaffInvite,
    updateOnlineStorefront: client.updateOnlineStorefront,
    convertOnlineBookingRequest: client.convertOnlineBookingRequest,
    checkout: client.checkout,
    refundOrder: client.refundOrder,
    adjustInventory: client.adjustInventory,
    addAppointment: client.addAppointment,
    addStaffUnavailableSlot: client.addStaffUnavailableSlot,
    addStaffShift: client.addStaffShift,
    updateAppointmentStatus: client.updateAppointmentStatus,
    rescheduleAppointment: client.rescheduleAppointment,
    addCustomer: client.addCustomer,
    updateCustomer: client.updateCustomer,
    createTag: client.createTag,
    updateTag: client.updateTag,
    openMemberCard: client.openMemberCard,
    refundMemberCard: client.refundMemberCard,
    rechargeMemberCard: client.rechargeMemberCard,
    updateMemberCardStatus: client.updateMemberCardStatus,
    extendMemberCard: client.extendMemberCard,
    transferMemberCard: client.transferMemberCard,
    createApproval: client.createApproval,
    decideApproval: client.decideApproval,
    addServiceRecord: client.addServiceRecord,
    createCustomerSignature: client.createCustomerSignature,
    signCustomerSignature: client.signCustomerSignature,
    addFollowUp: client.addFollowUp,
    completeFollowUp: client.completeFollowUp,
    addService: client.addService,
    updateServiceConsumables: client.updateServiceConsumables,
    addProduct: client.addProduct,
    addSupplier: client.addSupplier,
    receivePurchaseOrder: client.receivePurchaseOrder,
    restockLowInventory: client.restockLowInventory,
    createStocktake: client.createStocktake,
    settleCommissions: client.settleCommissions,
    createDailyClose: client.createDailyClose,
    reverseDailyClose: client.reverseDailyClose,
    markNotificationRead: client.markNotificationRead,
    archiveNotification: client.archiveNotification,
    markAllNotificationsRead: client.markAllNotificationsRead,
  }), [client]);

  return {
    session,
    data,
    loading,
    mutationPending,
    error,
    login,
    registerStore: client.registerStore,
    joinInvite,
    fetchPublicStore: client.fetchPublicStore,
    createPublicBookingRequest: client.createPublicBookingRequest,
    fetchPublicCustomerSignature: client.fetchPublicCustomerSignature,
    signPublicCustomerSignature: client.signPublicCustomerSignature,
    authenticate,
    updateAccountProfile,
    logout,
    refreshData,
    refreshDataView,
    setActiveDataScope: updateActiveDataScope,
    runMutation,
    actions,
  };
}

export type ApiActions = ReturnType<typeof useApiData>["actions"];
export type UseApiDataResult = ReturnType<typeof useApiData>;

function mergeAppDataUpdate(current: AppData | undefined, update: AppDataUpdate): AppData {
  if (!isAppDataSlice(update)) {
    return update;
  }
  if (!current) {
    return {
      ...emptyAppData(),
      ...update.data,
    };
  }
  return {
    ...current,
    ...update.data,
  };
}
