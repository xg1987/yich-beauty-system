import type { ReactNode } from "react";

type DataTableProps = {
  columns: string[];
  rows: ReactNode[][];
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
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
