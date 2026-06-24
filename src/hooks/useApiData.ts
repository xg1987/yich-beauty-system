import { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, setActiveDataScope, type JoinInviteResult } from "../api/client";
import { normalizeUserSession, type UserSession } from "../domain/auth";
import { accountAiCredits, roundAiCreditAmount } from "../domain/aiBilling";
import { emptyAppData, isAppDataSlice, isViewKey, type AppDataUpdate } from "../domain/dataSlices";
import type { AppData, ViewKey } from "../domain/types";
import { clearCachedStoreName } from "../lib/storeNameCache";

const SESSION_KEY = "yich-system-session";
let fallbackSession: UserSession | undefined;

function initialDataView(): ViewKey {
  const requestedView = new URLSearchParams(window.location.search).get("view");
  return isViewKey(requestedView) ? requestedView : "dashboard";
}

function readSavedSession() {
  let savedSession: string | null = null;
  try {
    savedSession = localStorage.getItem(SESSION_KEY);
  } catch {
    return fallbackSession;
  }
  if (!savedSession) return undefined;
  try {
    fallbackSession = normalizeUserSession(JSON.parse(savedSession) as UserSession);
    return fallbackSession;
  } catch {
    safeRemoveSavedSession();
    return undefined;
  }
}

function saveSession(session: UserSession) {
  const normalized = normalizeUserSession(session);
  fallbackSession = normalized;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  } catch {
    // Some tablets can exhaust or disable Web Storage. Keep the login usable
    // for the current app session instead of blocking a valid login.
  }
  return normalized;
}

function safeRemoveSavedSession() {
  fallbackSession = undefined;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage cleanup failures; session state is already cleared in memory.
  }
}

function userFacingAuthError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : fallback;
  return /quota.*exceeded|exceeded.*quota|存储|storage/i.test(message)
    ? "平板本地缓存空间已满或被系统限制，请清理浏览器缓存后再试。"
    : message;
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
      setError(userFacingAuthError(caught, "登录失败"));
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
      setError(userFacingAuthError(caught, "认证失败"));
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
    safeRemoveSavedSession();
    clearCachedStoreName(session);
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
        safeRemoveSavedSession();
        clearCachedStoreName(session);
        setSession(undefined);
        setData(undefined);
        setError(undefined);
        return;
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
    ...client,
    generateMarketingAi: async (...args: Parameters<typeof client.generateMarketingAi>) => {
      const result = await client.generateMarketingAi(...args);
      if (result.record) {
        const shouldConsumeCredit = result.record.billing?.source === "credit"
          && result.record.status !== "生成中"
          && result.record.status !== "生成失败";
        setData((current) => current
          ? {
              ...current,
              authUsers: current.authUsers.map((user) => {
                if (user.id !== result.record!.createdBy) return user;
                const credits = accountAiCredits(user.aiCredits);
                const creditCharge = result.record!.billing?.creditsCharged ?? 0;
                return shouldConsumeCredit && credits > 0 && creditCharge > 0
                  ? { ...user, aiCredits: roundAiCreditAmount(Math.max(0, credits - creditCharge)) }
                  : user;
              }),
              marketingAiRecords: [
                result.record!,
                ...(current.marketingAiRecords ?? []).filter((record) => record.id !== result.record!.id),
              ],
            }
          : current);
      }
      return result;
    },
    refreshMarketingVideoStatus: async (...args: Parameters<typeof client.refreshMarketingVideoStatus>) => {
      const result = await client.refreshMarketingVideoStatus(...args);
      if (result.record) {
        setData((current) => current
          ? {
              ...current,
              marketingAiRecords: [
                result.record!,
                ...(current.marketingAiRecords ?? []).filter((record) => record.id !== result.record!.id),
              ],
            }
          : current);
      }
      return result;
    },
    saveMarketingTalkVideo: async (...args: Parameters<typeof client.saveMarketingTalkVideo>) => {
      const result = await client.saveMarketingTalkVideo(...args);
      if (result.record) {
        setData((current) => current
          ? {
              ...current,
              marketingAiRecords: [
                result.record!,
                ...(current.marketingAiRecords ?? []).filter((record) => record.id !== result.record!.id),
              ],
            }
          : current);
      }
      return result;
    },
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
