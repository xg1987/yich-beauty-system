import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../api/client";
import type { UserSession } from "../domain/auth";
import type { AppData } from "../domain/types";

const SESSION_KEY = "yich-system-session";

export function useApiData() {
  const savedSession = localStorage.getItem(SESSION_KEY);
  const [session, setSession] = useState<UserSession | undefined>(
    savedSession ? (JSON.parse(savedSession) as UserSession) : undefined,
  );
  const [data, setData] = useState<AppData | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const client = useMemo(() => createApiClient(() => session?.token), [session?.token]);

  useEffect(() => {
    if (!session || data) return;
    void refreshData();
  }, [session?.token]);

  const login = async (account: string, password: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const nextSession = await client.login(account, password);
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      const nextData = await createApiClient(() => nextSession.token).fetchData();
      setData(nextData);
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
      const nextSession = await authAction();
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      const nextData = await createApiClient(() => nextSession.token).fetchData();
      setData(nextData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "认证失败");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(undefined);
    setData(undefined);
  };

  const refreshData = async () => {
    if (!session) return;
    setLoading(true);
    setError(undefined);
    try {
      setData(await client.fetchData());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "加载数据失败";
      if (message.includes("请先登录")) {
        localStorage.removeItem(SESSION_KEY);
        setSession(undefined);
        setData(undefined);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const runMutation = async (mutation: () => Promise<AppData>) => {
    setLoading(true);
    setError(undefined);
    try {
      const nextData = await mutation();
      setData(nextData);
      return nextData;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      throw caught;
    } finally {
      setLoading(false);
    }
  };

  const actions = {
    addStaff: client.addStaff,
    updateStaff: client.updateStaff,
    createStaffInvite: client.createStaffInvite,
    checkout: client.checkout,
    refundOrder: client.refundOrder,
    adjustInventory: client.adjustInventory,
    addAppointment: client.addAppointment,
    addStaffUnavailableSlot: client.addStaffUnavailableSlot,
    addStaffShift: client.addStaffShift,
    updateAppointmentStatus: client.updateAppointmentStatus,
    addCustomer: client.addCustomer,
    updateCustomer: client.updateCustomer,
    openMemberCard: client.openMemberCard,
    createCouponTemplate: client.createCouponTemplate,
    issueCustomerCoupon: client.issueCustomerCoupon,
    refundMemberCard: client.refundMemberCard,
    rechargeMemberCard: client.rechargeMemberCard,
    updateMemberCardStatus: client.updateMemberCardStatus,
    extendMemberCard: client.extendMemberCard,
    transferMemberCard: client.transferMemberCard,
    createApproval: client.createApproval,
    decideApproval: client.decideApproval,
    addServiceRecord: client.addServiceRecord,
    addFollowUp: client.addFollowUp,
    completeFollowUp: client.completeFollowUp,
    addService: client.addService,
    addProduct: client.addProduct,
    addSupplier: client.addSupplier,
    receivePurchaseOrder: client.receivePurchaseOrder,
    createStocktake: client.createStocktake,
    settleCommissions: client.settleCommissions,
    createDailyClose: client.createDailyClose,
    reverseDailyClose: client.reverseDailyClose,
  };

  return {
    session,
    data,
    loading,
    error,
    login,
    registerStore: client.registerStore,
    joinInvite: client.joinInvite,
    authenticate,
    logout,
    refreshData,
    runMutation,
    actions,
  };
}

export type ApiActions = ReturnType<typeof useApiData>["actions"];
