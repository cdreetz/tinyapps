"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type CellType = "text" | "number" | "formula";

interface CellContent {
  raw: string;
  display: string;
}

interface CellMetadata {
  type: CellType;
  row: number;
  col: number;
}

interface Cell {
  content: CellContent;
  metadata: CellMetadata;
}

const ROWS = 50;
const COLS = 26;

function colLabel(col: number): string {
  return String.fromCharCode(65 + col);
}

export type { Cell, CellType, CellContent, CellMetadata };

export function cellKey(row: number, col: number) {
  return `${row}:${col}`;
}

interface SpreadsheetProps {
  data: Record<string, Cell>;
  onCellChange: (row: number, col: number, value: string) => void;
}

export default function Spreadsheet({ data, onCellChange }: SpreadsheetProps) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCellClick = useCallback((row: number, col: number) => {
    setSelected({ row, col });
    setEditing(null);
  }, []);

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    setSelected({ row, col });
    setEditing({ row, col });
  }, []);

  const handleCellChange = useCallback(
    (row: number, col: number, value: string) => {
      onCellChange(row, col, value);
    },
    [onCellChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selected) return;

      if (editing) {
        if (e.key === "Enter") {
          setEditing(null);
          setSelected({ row: Math.min(selected.row + 1, ROWS - 1), col: selected.col });
        } else if (e.key === "Tab") {
          e.preventDefault();
          setEditing(null);
          setSelected({ row: selected.row, col: Math.min(selected.col + 1, COLS - 1) });
        } else if (e.key === "Escape") {
          setEditing(null);
        }
        return;
      }

      // Navigation in non-editing mode
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelected((s) => s ? { row: Math.max(s.row - 1, 0), col: s.col } : s);
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelected((s) => s ? { row: Math.min(s.row + 1, ROWS - 1), col: s.col } : s);
      } else if (e.key === "ArrowLeft" || e.key === "h") {
        e.preventDefault();
        setSelected((s) => s ? { row: s.row, col: Math.max(s.col - 1, 0) } : s);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        setSelected((s) => s ? { row: s.row, col: Math.min(s.col + 1, COLS - 1) } : s);
      } else if (e.key === "Enter" || e.key === "F2") {
        setEditing(selected);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleCellChange(selected.row, selected.col, "");
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Start typing into the cell
        handleCellChange(selected.row, selected.col, "");
        setEditing(selected);
      }
    },
    [selected, editing, handleCellChange]
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  return (
    <div
      className="w-[50vw] h-[50vh] bg-[#1e1e2e] border border-[#313244] rounded-lg shadow-2xl flex flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header bar */}
      <div className="h-7 bg-[#313244] text-[#a6adc8] flex items-center px-3 text-xs shrink-0 gap-2 font-mono">
        <span className="text-[#a6e3a1] font-bold">SHEETS</span>
        {selected && (
          <span className="text-[#89b4fa]">
            {colLabel(selected.col)}{selected.row + 1}
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse w-max">
          <thead>
            <tr>
              {/* Row number header */}
              <th className="sticky top-0 left-0 z-20 w-10 min-w-10 h-6 bg-[#313244] border-b border-r border-[#45475a] text-[#585b70] text-xs font-mono" />
              {Array.from({ length: COLS }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 w-24 min-w-24 h-6 bg-[#313244] border-b border-r border-[#45475a] text-[#a6adc8] text-xs font-mono text-center"
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r}>
                {/* Row number */}
                <td className="sticky left-0 z-10 w-10 min-w-10 h-6 bg-[#313244] border-b border-r border-[#45475a] text-[#585b70] text-xs font-mono text-center select-none">
                  {r + 1}
                </td>
                {Array.from({ length: COLS }, (_, c) => {
                  const isSelected = selected?.row === r && selected?.col === c;
                  const isEditing = editing?.row === r && editing?.col === c;
                  const cell = data[cellKey(r, c)];
                  const value = cell?.content.raw || "";
                  const display = cell?.content.display || "";

                  return (
                    <td
                      key={c}
                      className={`w-24 min-w-24 h-6 border-b border-r text-xs font-mono px-1 cursor-cell ${
                        isSelected
                          ? "border-[#89b4fa] border-2 bg-[#1e1e2e]"
                          : "border-[#313244] bg-[#1e1e2e]"
                      }`}
                      onClick={() => handleCellClick(r, c)}
                      onDoubleClick={() => handleCellDoubleClick(r, c)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="w-full h-full bg-transparent text-[#cdd6f4] outline-none text-xs font-mono"
                          value={value}
                          onChange={(e) => handleCellChange(r, c, e.target.value)}
                          onBlur={() => setEditing(null)}
                        />
                      ) : (
                        <span className="text-[#cdd6f4] truncate block">
                          {display}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
