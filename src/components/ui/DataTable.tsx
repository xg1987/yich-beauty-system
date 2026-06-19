import type { ReactNode } from "react";

type DataTableProps = {
  columns: string[];
  rows: DataTableRow[];
};

type DataTableRow = ReactNode[] | {
  cells: ReactNode[];
  className?: string;
  dataAttributes?: Record<string, string>;
  key?: string;
};

export function DataTable({ columns, rows }: DataTableProps) {
  if (rows.length === 0) return <p className="empty">暂无数据</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const cells = Array.isArray(row) ? row : row.cells;
            return (
              <tr
                key={Array.isArray(row) ? index : row.key ?? index}
                className={Array.isArray(row) ? undefined : row.className}
                {...(Array.isArray(row) ? undefined : row.dataAttributes)}
              >
                {cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
