import { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, setActiveDataScope, type JoinInviteResult } from "../api/client";
import { normalizeUserSession, type UserSession } from "../domain/auth";
import { accountAiCredits, roundAiCreditAmount } from "../domain/aiBilling";
import { emptyAppData, isAppDataPatch, isAppDataSlice, isViewKey, type AppDataSlice, type AppDataUpdate } from "../domain/dataSlices";
import type { AppData, ViewKey } from "../domain/types";
import { clearCachedStoreName } from "../lib/storeNameCache";

const SESSION_KEY = "yich-system-session";
const INITIAL_DATA_RETRY_DELAYS_MS = [800, 1_800, 3_500, 6_000];
const INITIAL_DATA_OFFLINE_WAIT_MS = 12_000;
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isTransientInitialLoadError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (message.includes("请先登录")) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /Failed to fetch|Load failed|NetworkError|Network request failed|The Internet connection appears to be offline|超时|timeout|服务暂时不可用|HTTP 5\d\d/i.test(message);
}

async function waitForNetworkOrDelay(delayMs: number) {
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    await sleep(delayMs);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("online", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, Math.max(delayMs, INITIAL_DATA_OFFLINE_WAIT_MS));
    window.addEventListener("online", finish, { once: true });
  });
}

async function fetchInitialDataSliceWithRetry(fetchDataSlice: (view: ViewKey) => Promise<AppDataSlice>) {
  const view = initialDataView();
  let lastError: unknown;

  for (let attempt = 0; attempt <= INITIAL_DATA_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchDataSlice(view);
    } catch (caught) {
      lastError = caught;
      if (!isTransientInitialLoadError(caught) || attempt === INITIAL_DATA_RETRY_DELAYS_MS.length) {
        throw caught;
      }
      await waitForNetworkOrDelay(INITIAL_DATA_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("加载数据失败");
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
      const nextData = await fetchInitialDataSliceWithRetry(createApiClient(() => nextSession.token).fetchDataSlice);
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
      const nextData = await fetchInitialDataSliceWithRetry(createApiClient(() => nextSession.token).fetchDataSlice);
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
    // Best-effort server-side revocation so the bearer token can't be reused;
    // never block or fail the local logout on a network error.
    if (session) {
      void client.logout().catch(() => {});
    }
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
      const nextData = await fetchInitialDataSliceWithRetry(client.fetchDataSlice);
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

  useEffect(() => {
    if (!session || data || !error || loading) return;

    const recover = () => {
      void refreshData();
    };
    const recoverWhenVisible = () => {
      if (document.visibilityState === "visible") recover();
    };
    const retryTimer = window.setTimeout(recover, 8_000);

    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recoverWhenVisible);
    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
    };
  }, [session?.token, Boolean(data), error, loading]);

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
  if (isAppDataPatch(update)) {
    const base = current ?? emptyAppData();
    const next = { ...base };
    for (const [rawKey, rawRows] of Object.entries(update.upserts)) {
      const key = rawKey as keyof AppData;
      if (!Array.isArray(rawRows)) continue;
      const currentRows = base[key] as Array<{ id: string }>;
      const patchRows = rawRows as Array<{ id: string }>;
      const patchById = new Map(patchRows.map((row) => [row.id, row]));
      const existingIds = new Set(currentRows.map((row) => row.id));
      const newRows = patchRows.filter((row) => !existingIds.has(row.id));
      next[key] = [
        ...newRows,
        ...currentRows.map((row) => patchById.get(row.id) ?? row),
      ] as never;
    }
    return next;
  }
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
