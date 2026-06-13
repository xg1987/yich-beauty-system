import { ClipboardList } from "lucide-react";
import { FormEvent, useState } from "react";
import { PageHero } from "../../components/layout/PageHero";
import { DataTable } from "../../components/ui/DataTable";
import type { UserSession } from "../../domain/auth";
import type { AppData } from "../../domain/types";
import { shortDate } from "../../domain/utils";

type OperationLogsProps = {
  data: AppData;
  session: UserSession;
};

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename: string, columns: Array<string | number>, rows: Array<Array<string | number>>) {
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function nameOf(collection: Array<{ id: string; name: string }>, id: string) {
  return collection.find((item) => item.id === id)?.name ?? "";
}

function searchInputSync(setValue: (value: string) => void) {
  const sync = (event: FormEvent<HTMLInputElement>) => setValue(event.currentTarget.value);
  return {
    onInput: sync,
    onChange: sync,
    onCompositionEnd: sync,
  };
}

export default function OperationLogs({ data, session: _session }: OperationLogsProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const logs = [...(data.operationLogs ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((log) => {
      const matchesSearch =
        !searchTerm ||
        log.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.action.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesAction = !actionFilter || log.action === actionFilter;
      return matchesSearch && matchesAction;
    });

  const uniqueActions = Array.from(new Set((data.operationLogs ?? []).map((log) => log.action)));

  const exportLogs = () => {
    downloadCsvFile(
      `操作日志_${new Date().toISOString().slice(0, 10)}.csv`,
      ["时间", "操作人", "动作", "对象类型", "摘要"],
      logs.map((log) => [
        log.createdAt,
        nameOf(data.staff, data.authUsers.find((user) => user.id === log.userId)?.staffId ?? "") || "系统",
        log.action,
        log.targetType,
        log.summary,
      ]),
    );
  };

  return (
    <div className="page-stack operation-logs-page">
      <PageHero
        icon={<ClipboardList size={15} />}
        eyebrow="系统记录"
        title="操作日志"
        stats={[
          { label: "总记录数", value: `${data.operationLogs?.length ?? 0} 条`, hint: "已记录操作", icon: <ClipboardList size={18} /> },
        ]}
      />

      <div className="panel">
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="搜索操作内容或动作..."
            value={searchTerm}
            {...searchInputSync(setSearchTerm)}
            style={{ flex: 1, minWidth: "240px" }}
          />
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="">所有动作</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <button onClick={exportLogs}>导出 CSV</button>
        </div>

        {logs.length === 0 ? (
          <p className="empty">暂无操作记录</p>
        ) : (
          <DataTable
            columns={["时间", "操作人", "动作", "对象类型", "摘要"]}
            rows={logs.slice(0, 100).map((log) => [
              shortDate(log.createdAt),
              nameOf(data.staff, data.authUsers.find((user) => user.id === log.userId)?.staffId ?? "") || "系统",
              log.action,
              log.targetType,
              log.summary,
            ])}
          />
        )}

        {logs.length > 100 && (
          <p style={{ marginTop: "12px", color: "var(--yich-muted)", fontSize: "13px" }}>
            仅显示最近 100 条记录
          </p>
        )}
      </div>
    </div>
  );
}
