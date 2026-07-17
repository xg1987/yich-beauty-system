import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CashierFlowDetailResult,
  CashierFlowListItem,
  CashierFlowPageResult,
  CashierFlowRelatedData,
  PosContextResult,
} from "../domain/cashierFlow";
import type { AppData } from "../domain/types";

export const POS_CASHIER_FLOW_PAGE_SIZE = 50;

type PosContextParams = {
  dayStart: string;
  dayEnd: string;
  appointmentId?: string;
  signatureId?: string;
};

type UsePosRemoteDataOptions = {
  active: boolean;
  initialAppointmentId?: string;
  initialSignatureId?: string;
  fetchPosContext: (params: PosContextParams) => Promise<PosContextResult>;
  fetchCashierFlowPage: (page: number, pageSize: number) => Promise<CashierFlowPageResult>;
  fetchCashierFlowDetail: (kind: CashierFlowListItem["kind"], id: string) => Promise<CashierFlowDetailResult>;
};

type CashierFlowRecordIdentity = Pick<CashierFlowListItem, "kind" | "id">;

type SelectCashierFlowRecord = {
  (record: CashierFlowListItem): void;
  (kind: CashierFlowListItem["kind"], id: string): void;
};

function requestError(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function recordKey(record: CashierFlowRecordIdentity) {
  return `${record.kind}:${record.id}`;
}

const POS_REMOTE_RELATED_KEYS = [
  "orders",
  "memberCardTransactions",
  "customers",
  "memberCards",
  "appointments",
  "customerSignatures",
  "customerServiceRecords",
] as const satisfies readonly (keyof CashierFlowRelatedData)[];

export function mergePosRemoteData(
  base: AppData,
  ...remote: Array<CashierFlowRelatedData | undefined>
): AppData {
  const sources = remote.filter((data): data is CashierFlowRelatedData => Boolean(data));
  if (sources.length === 0) return base;
  const next = { ...base };
  POS_REMOTE_RELATED_KEYS.forEach((key) => {
    const rowsById = new Map<string, { id: string }>(
      (base[key] as Array<{ id: string }>).map((row) => [row.id, row]),
    );
    sources.forEach((data) => {
      (data[key] as Array<{ id: string }>).forEach((row) => rowsById.set(row.id, row));
    });
    next[key] = Array.from(rowsById.values()) as never;
  });
  return next;
}

export function usePosRemoteData({
  active,
  initialAppointmentId,
  initialSignatureId,
  fetchPosContext,
  fetchCashierFlowPage,
  fetchCashierFlowDetail,
}: UsePosRemoteDataOptions) {
  const [context, setContext] = useState<PosContextResult>();
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string>();
  const contextRequestIdRef = useRef(0);

  const [requestedPage, setRequestedPage] = useState(1);
  const [pageResult, setPageResult] = useState<CashierFlowPageResult>();
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [pageRevision, setPageRevision] = useState(0);
  const pageRequestIdRef = useRef(0);

  const [selectedRecord, setSelectedRecord] = useState<CashierFlowListItem>();
  const [selectedRecordKey, setSelectedRecordKey] = useState<string>();
  const [detail, setDetail] = useState<CashierFlowDetailResult>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const selectedIdentityRef = useRef<CashierFlowRecordIdentity | undefined>(undefined);
  const detailRequestIdRef = useRef(0);

  const refreshContext = useCallback(async () => {
    const requestId = ++contextRequestIdRef.current;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(24, 0, 0, 0);
    setContext(undefined);
    setContextLoading(true);
    setContextError(undefined);
    try {
      const nextContext = await fetchPosContext({
        dayStart: dayStart.toISOString(),
        dayEnd: dayEnd.toISOString(),
        appointmentId: initialAppointmentId,
        signatureId: initialSignatureId,
      });
      if (contextRequestIdRef.current !== requestId) return;
      setContext(nextContext);
    } catch (caught) {
      if (contextRequestIdRef.current !== requestId) return;
      setContextError(requestError(caught, "收银数据加载失败"));
    } finally {
      if (contextRequestIdRef.current === requestId) setContextLoading(false);
    }
  }, [fetchPosContext, initialAppointmentId, initialSignatureId]);

  useEffect(() => {
    void refreshContext();
    return () => {
      contextRequestIdRef.current += 1;
    };
  }, [refreshContext]);

  useEffect(() => () => {
    detailRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!active) {
      pageRequestIdRef.current += 1;
      setPageLoading(false);
      return;
    }

    const requestId = ++pageRequestIdRef.current;
    let disposed = false;
    setPageLoading(true);
    setPageError(undefined);
    void fetchCashierFlowPage(requestedPage, POS_CASHIER_FLOW_PAGE_SIZE)
      .then((nextPage) => {
        if (disposed || pageRequestIdRef.current !== requestId) return;
        setPageResult(nextPage);
        if (nextPage.page !== requestedPage) setRequestedPage(nextPage.page);
      })
      .catch((caught) => {
        if (disposed || pageRequestIdRef.current !== requestId) return;
        setPageError(requestError(caught, "收银流水加载失败"));
      })
      .finally(() => {
        if (!disposed && pageRequestIdRef.current === requestId) setPageLoading(false);
      });

    return () => {
      disposed = true;
      if (pageRequestIdRef.current === requestId) pageRequestIdRef.current += 1;
    };
  }, [active, fetchCashierFlowPage, pageRevision, requestedPage]);

  const clearDetail = useCallback(() => {
    detailRequestIdRef.current += 1;
    selectedIdentityRef.current = undefined;
    setSelectedRecord(undefined);
    setSelectedRecordKey(undefined);
    setDetail(undefined);
    setDetailLoading(false);
    setDetailError(undefined);
  }, []);

  const loadDetail = useCallback((identity: CashierFlowRecordIdentity, record?: CashierFlowListItem) => {
    const requestId = ++detailRequestIdRef.current;
    selectedIdentityRef.current = identity;
    setSelectedRecord(record);
    setSelectedRecordKey(recordKey(identity));
    setDetail(undefined);
    setDetailLoading(true);
    setDetailError(undefined);
    void fetchCashierFlowDetail(identity.kind, identity.id)
      .then((nextDetail) => {
        if (detailRequestIdRef.current !== requestId) return;
        setDetail(nextDetail);
        setSelectedRecord(nextDetail.record);
      })
      .catch((caught) => {
        if (detailRequestIdRef.current !== requestId) return;
        setDetailError(requestError(caught, "流水详情加载失败"));
      })
      .finally(() => {
        if (detailRequestIdRef.current === requestId) setDetailLoading(false);
      });
  }, [fetchCashierFlowDetail]);

  const selectRecord = useCallback(((recordOrKind: CashierFlowListItem | CashierFlowListItem["kind"], id?: string) => {
    if (typeof recordOrKind !== "string") {
      loadDetail(recordOrKind, recordOrKind);
      return;
    }
    if (!id) return;
    const record = pageResult?.items.find((item) => item.kind === recordOrKind && item.id === id);
    loadDetail({ kind: recordOrKind, id }, record);
  }) as SelectCashierFlowRecord, [loadDetail, pageResult?.items]);

  const retryDetail = useCallback(() => {
    const identity = selectedIdentityRef.current;
    if (!identity) return;
    loadDetail(identity, selectedRecord);
  }, [loadDetail, selectedRecord]);

  const changePage = useCallback((page: number) => {
    const pageCount = Math.max(1, pageResult?.pageCount ?? Number.MAX_SAFE_INTEGER);
    const normalizedPage = Number.isFinite(page) ? Math.floor(page) : 1;
    const nextPage = Math.min(pageCount, Math.max(1, normalizedPage));
    clearDetail();
    if (nextPage === requestedPage) {
      setPageRevision((revision) => revision + 1);
      return;
    }
    setRequestedPage(nextPage);
  }, [clearDetail, pageResult?.pageCount, requestedPage]);

  const invalidatePage = useCallback(() => {
    clearDetail();
    setPageRevision((revision) => revision + 1);
  }, [clearDetail]);

  return {
    context,
    contextLoading,
    contextError,
    refreshContext,
    pageResult,
    pageLoading,
    pageError,
    requestedPage,
    invalidatePage,
    changePage,
    selectedRecord,
    selectedRecordKey,
    detail,
    detailLoading,
    detailError,
    selectRecord,
    clearDetail,
    retryDetail,
  };
}
