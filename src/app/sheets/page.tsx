"use client";

import { useState, useCallback, useRef } from "react";
import Spreadsheet, { Cell, CellType, cellKey } from "@/components/Spreadsheet";
import SheetChat from "@/components/SheetChat";

export default function SheetsPage() {
  const [data, setData] = useState<Record<string, Cell>>({});
  const dataRef = useRef(data);
  dataRef.current = data;

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setData((prev) => {
      const next = { ...prev };
      if (value === "") {
        delete next[cellKey(row, col)];
      } else {
        const type: CellType = value.startsWith("=")
          ? "formula"
          : isNaN(Number(value))
            ? "text"
            : "number";
        next[cellKey(row, col)] = {
          content: { raw: value, display: value },
          metadata: { type, row, col },
        };
      }
      return next;
    });
  }, []);

  const getSheetSnapshot = useCallback(() => {
    const snapshot: Record<string, string> = {};
    for (const [key, cell] of Object.entries(dataRef.current)) {
      snapshot[key] = cell.content.raw;
    }
    return snapshot;
  }, []);

  const handleWriteCells = useCallback(
    (cells: { row: number; col: string; value: string }[]) => {
      for (const cell of cells) {
        const colIndex = cell.col.toUpperCase().charCodeAt(0) - 65;
        const rowIndex = cell.row - 1; // API is 1-based, internal is 0-based
        handleCellChange(rowIndex, colIndex, cell.value);
      }
    },
    [handleCellChange]
  );

  return (
    <div className="h-screen w-screen flex items-center justify-center gap-4 bg-[#11111b]">
      <Spreadsheet data={data} onCellChange={handleCellChange} />
      <SheetChat getSheetSnapshot={getSheetSnapshot} onWriteCells={handleWriteCells} />
    </div>
  );
}
