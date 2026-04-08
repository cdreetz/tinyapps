"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";

type Mode = "normal" | "insert" | "command" | "visual";

interface CursorPos {
  row: number;
  col: number;
}

interface VimTerminalProps {
  onExplainDelta?: (delta: string) => void;
  onExplainStart?: () => void;
  onExplainDone?: () => void;
  onToolCall?: (tool: string, args: Record<string, unknown>) => void;
}

export default function VimTerminal({ onExplainDelta, onExplainStart, onExplainDone, onToolCall }: VimTerminalProps) {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursor, setCursor] = useState<CursorPos>({ row: 0, col: 0 });
  const [mode, setMode] = useState<Mode>("normal");
  const [commandBuffer, setCommandBuffer] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [visualStart, setVisualStart] = useState<CursorPos | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<string[]>(lines);
  linesRef.current = lines;
  const cursorRef = useRef<CursorPos>(cursor);
  cursorRef.current = cursor;
  const ROWS = 24;
  const COLS = 80;

  const callAgent = useCallback(
    async (prompt: string) => {
      setAgentLoading(true);
      setStatusMessage("Agent thinking...");
      onExplainStart?.();

      let currentMode: "insert" | "overwrite" | null = null;
      let currentLineStart = 0; // adjusted 0-based index
      const linesWrittenRef = { current: 0 };
      // Track inserts so we can offset subsequent write_code calls
      const completedInserts: { at: number; count: number }[] = [];

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            buffer: linesRef.current,
            cursor_line: cursorRef.current.row + 1,
          }),
        });

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split("\n\n");
          sseBuffer = parts.pop()!;

          for (const part of parts) {
            const eventMatch = part.match(/^event:\s*(.+)$/m);
            const dataMatch = part.match(/^data:\s*(.+)$/m);
            if (!eventMatch || !dataMatch) continue;

            const eventType = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            switch (eventType) {
              case "meta": {
                currentMode = data.mode;
                // Model gives line_start based on original buffer.
                // Offset by lines previously inserted before this position.
                const originalIdx = (data.line_start as number) - 1;
                let offset = 0;
                for (const ins of completedInserts) {
                  if (ins.at <= originalIdx) {
                    offset += ins.count;
                  }
                }
                currentLineStart = originalIdx + offset;
                linesWrittenRef.current = 0;
                setStatusMessage(`Agent writing (${data.mode} @ line ${data.line_start})...`);
                break;
              }
              case "line": {
                const text: string = data.text;
                const mode_ = currentMode;
                const base = currentLineStart;
                flushSync(() => {
                  setLines((prev) => {
                    const ls = [...prev];
                    const targetRow = base + linesWrittenRef.current;
                    if (mode_ === "insert") {
                      ls.splice(targetRow, 0, text);
                    } else {
                      if (targetRow < ls.length) {
                        ls[targetRow] = text;
                      } else {
                        ls.push(text);
                      }
                    }
                    linesWrittenRef.current++;
                    return ls;
                  });
                });
                break;
              }
              case "write_done":
                if (currentMode === "insert") {
                  completedInserts.push({ at: currentLineStart, count: linesWrittenRef.current });
                }
                currentMode = null;
                currentLineStart = 0;
                linesWrittenRef.current = 0;
                break;
              case "tool_call":
                onToolCall?.(data.tool, data.args);
                break;
              case "explain_delta":
                flushSync(() => {
                  onExplainDelta?.(data.text);
                });
                break;
              case "explain_done":
                onExplainDone?.();
                break;
              case "done":
                setStatusMessage("Agent: done");
                break;
              case "error":
                setStatusMessage(`Agent error: ${data.message}`);
                break;
            }

            // Yield to the browser between events so that each flushSync
            // paint is actually composited on screen. Without this, multiple
            // events that arrive in the same reader.read() chunk would all
            // render in a single paint, defeating the token-by-token effect.
            await new Promise((r) => requestAnimationFrame(r));
          }
        }
      } catch (err) {
        setStatusMessage(`Agent error: ${err}`);
      } finally {
        setAgentLoading(false);
        setTimeout(() => setStatusMessage(""), 3000);
      }
    },
    []
  );

  const clampCol = useCallback(
    (row: number, col: number, ls: string[]) => {
      const maxCol = mode === "insert" ? ls[row].length : Math.max(0, ls[row].length - 1);
      return Math.min(col, maxCol);
    },
    [mode]
  );

  const flash = useCallback((msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(""), 1500);
  }, []);

  const handleNormal = useCallback(
    (key: string, e: KeyboardEvent) => {
      setLines((prev) => {
        const ls = prev.map((l) => l);
        let r = cursor.row;
        let c = cursor.col;

        // Handle pending operator (like d)
        if (pendingKey === "d") {
          setPendingKey(null);
          if (key === "d") {
            // dd - delete line
            if (ls.length === 1) {
              ls[0] = "";
              r = 0;
              c = 0;
            } else {
              ls.splice(r, 1);
              if (r >= ls.length) r = ls.length - 1;
              c = clampCol(r, 0, ls);
            }
            setCursor({ row: r, col: c });
            return ls;
          }
          if (key === "w") {
            // dw - delete word
            const line = ls[r];
            const before = line.slice(0, c);
            let rest = line.slice(c);
            rest = rest.replace(/^[\w]+\s*|^[^\w\s]+\s*|^\s+/, "");
            ls[r] = before + rest;
            c = clampCol(r, c, ls);
            setCursor({ row: r, col: c });
            return ls;
          }
          // Unknown combo, ignore
          setCursor({ row: r, col: c });
          return ls;
        }

        switch (key) {
          // Movement
          case "h":
          case "ArrowLeft":
            c = Math.max(0, c - 1);
            break;
          case "j":
          case "ArrowDown":
            r = Math.min(ls.length - 1, r + 1);
            c = clampCol(r, c, ls);
            break;
          case "k":
          case "ArrowUp":
            r = Math.max(0, r - 1);
            c = clampCol(r, c, ls);
            break;
          case "l":
          case "ArrowRight":
            c = Math.min(Math.max(0, ls[r].length - 1), c + 1);
            break;
          case "0":
            c = 0;
            break;
          case "$":
            c = Math.max(0, ls[r].length - 1);
            break;
          case "^":
            c = ls[r].search(/\S/);
            if (c === -1) c = 0;
            break;
          case "w": {
            const line = ls[r];
            const after = line.slice(c + 1);
            const m = after.match(/(?:^[\w]*\s*|^[^\w\s]*\s*)(\S)?/);
            if (m && m.index !== undefined) {
              const offset = c + 1 + (m.index + m[0].length - (m[1] ? 1 : 0));
              if (offset < line.length) {
                c = offset;
              } else if (r < ls.length - 1) {
                r++;
                c = ls[r].search(/\S/);
                if (c === -1) c = 0;
              } else {
                c = Math.max(0, line.length - 1);
              }
            }
            break;
          }
          case "b": {
            if (c === 0 && r > 0) {
              r--;
              c = Math.max(0, ls[r].length - 1);
            } else {
              const before = ls[r].slice(0, c);
              const m = before.match(/(\S+)\s*$/);
              c = m ? m.index! : 0;
            }
            break;
          }
          case "G":
            r = ls.length - 1;
            c = clampCol(r, 0, ls);
            break;
          case "g":
            // gg handled via pending, simplified: just go to top
            r = 0;
            c = clampCol(r, 0, ls);
            break;

          // Insert modes
          case "i":
            setMode("insert");
            break;
          case "I":
            setMode("insert");
            c = ls[r].search(/\S/);
            if (c === -1) c = 0;
            break;
          case "a":
            setMode("insert");
            c = Math.min(ls[r].length, c + 1);
            break;
          case "A":
            setMode("insert");
            c = ls[r].length;
            break;
          case "o":
            setMode("insert");
            ls.splice(r + 1, 0, "");
            r = r + 1;
            c = 0;
            break;
          case "O":
            setMode("insert");
            ls.splice(r, 0, "");
            c = 0;
            break;

          // Editing
          case "x":
            if (ls[r].length > 0) {
              ls[r] = ls[r].slice(0, c) + ls[r].slice(c + 1);
              c = clampCol(r, c, ls);
            }
            break;
          case "d":
            setPendingKey("d");
            break;
          case "D":
            ls[r] = ls[r].slice(0, c);
            c = clampCol(r, c, ls);
            break;
          case "J":
            if (r < ls.length - 1) {
              const trimmed = ls[r + 1].trimStart();
              ls[r] = ls[r] + (trimmed ? " " + trimmed : "");
              ls.splice(r + 1, 1);
            }
            break;

          // Visual mode
          case "v":
            setMode("visual");
            setVisualStart({ row: r, col: c });
            break;

          // Command mode
          case ":":
            setMode("command");
            setCommandBuffer("");
            break;

          default:
            break;
        }

        setCursor({ row: r, col: c });
        return ls;
      });
    },
    [cursor, clampCol, pendingKey]
  );

  const handleInsert = useCallback(
    (key: string, e: KeyboardEvent) => {
      if (key === "Escape") {
        setMode("normal");
        setCursor((prev) => ({
          ...prev,
          col: Math.max(0, prev.col - 1),
        }));
        return;
      }

      setLines((prev) => {
        const ls = prev.map((l) => l);
        let r = cursor.row;
        let c = cursor.col;

        if (key === "Enter") {
          const before = ls[r].slice(0, c);
          const after = ls[r].slice(c);
          ls[r] = before;
          ls.splice(r + 1, 0, after);
          r++;
          c = 0;
        } else if (key === "Backspace") {
          if (c > 0) {
            ls[r] = ls[r].slice(0, c - 1) + ls[r].slice(c);
            c--;
          } else if (r > 0) {
            c = ls[r - 1].length;
            ls[r - 1] += ls[r];
            ls.splice(r, 1);
            r--;
          }
        } else if (key === "Tab") {
          ls[r] = ls[r].slice(0, c) + "  " + ls[r].slice(c);
          c += 2;
        } else if (key.length === 1) {
          ls[r] = ls[r].slice(0, c) + key + ls[r].slice(c);
          c++;
        }

        setCursor({ row: r, col: c });
        return ls;
      });
    },
    [cursor]
  );

  const handleCommand = useCallback(
    (key: string) => {
      if (key === "Escape") {
        setMode("normal");
        setCommandBuffer("");
        return;
      }
      if (key === "Backspace") {
        if (commandBuffer.length === 0) {
          setMode("normal");
        } else {
          setCommandBuffer((prev) => prev.slice(0, -1));
        }
        return;
      }
      if (key === "Enter") {
        const cmd = commandBuffer.trim();
        if (cmd === "q" || cmd === "q!") {
          setLines([""]);
          setCursor({ row: 0, col: 0 });
          flash("Buffer cleared");
        } else if (cmd === "w") {
          flash(`"[buffer]" ${lines.length}L written`);
        } else if (cmd === "wq") {
          flash(`"[buffer]" ${lines.length}L written`);
        } else if (/^\d+$/.test(cmd)) {
          const target = Math.min(parseInt(cmd) - 1, lines.length - 1);
          setCursor({ row: Math.max(0, target), col: 0 });
        } else if (cmd.startsWith("ai ")) {
          const prompt = cmd.slice(3).trim();
          if (prompt) {
            callAgent(prompt);
          } else {
            flash("Usage: :ai <prompt>");
          }
        } else {
          flash(`E492: Not an editor command: ${cmd}`);
        }
        setMode("normal");
        setCommandBuffer("");
        return;
      }
      if (key.length === 1) {
        setCommandBuffer((prev) => prev + key);
      }
    },
    [commandBuffer, lines.length, flash, callAgent]
  );

  const handleVisual = useCallback(
    (key: string) => {
      if (key === "Escape") {
        setMode("normal");
        setVisualStart(null);
        return;
      }

      setLines((prev) => {
        const ls = prev.map((l) => l);
        let r = cursor.row;
        let c = cursor.col;

        switch (key) {
          case "h":
          case "ArrowLeft":
            c = Math.max(0, c - 1);
            break;
          case "j":
          case "ArrowDown":
            r = Math.min(ls.length - 1, r + 1);
            c = clampCol(r, c, ls);
            break;
          case "k":
          case "ArrowUp":
            r = Math.max(0, r - 1);
            c = clampCol(r, c, ls);
            break;
          case "l":
          case "ArrowRight":
            c = Math.min(Math.max(0, ls[r].length - 1), c + 1);
            break;
          case "d":
          case "x":
            if (visualStart) {
              const startR = Math.min(visualStart.row, r);
              const endR = Math.max(visualStart.row, r);
              ls.splice(startR, endR - startR + 1);
              if (ls.length === 0) ls.push("");
              r = Math.min(startR, ls.length - 1);
              c = clampCol(r, 0, ls);
            }
            setMode("normal");
            setVisualStart(null);
            break;
          default:
            break;
        }

        setCursor({ row: r, col: c });
        return ls;
      });
    },
    [cursor, visualStart, clampCol]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();

      switch (mode) {
        case "normal":
          handleNormal(e.key, e);
          break;
        case "insert":
          handleInsert(e.key, e);
          break;
        case "command":
          handleCommand(e.key);
          break;
        case "visual":
          handleVisual(e.key);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, handleNormal, handleInsert, handleCommand, handleVisual]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const isInVisualSelection = (row: number, col: number) => {
    if (mode !== "visual" || !visualStart) return false;
    const startR = Math.min(visualStart.row, cursor.row);
    const endR = Math.max(visualStart.row, cursor.row);
    const startC = startR === visualStart.row ? visualStart.col : cursor.col;
    const endC = endR === visualStart.row ? visualStart.col : cursor.col;
    if (row < startR || row > endR) return false;
    if (startR === endR) return col >= Math.min(startC, endC) && col <= Math.max(startC, endC);
    if (row === startR) return col >= startC;
    if (row === endR) return col <= endC;
    return true;
  };

  const renderLine = (line: string, rowIdx: number) => {
    const padded = line + " ".repeat(Math.max(0, COLS - line.length));
    const chars = padded.slice(0, COLS).split("");

    return chars.map((ch, colIdx) => {
      const isCursor = rowIdx === cursor.row && colIdx === cursor.col;
      const isVisual = isInVisualSelection(rowIdx, colIdx);

      let className = "";
      if (isCursor) {
        className =
          mode === "insert"
            ? "border-l border-green-400"
            : "bg-gray-300 text-black";
      } else if (isVisual) {
        className = "bg-blue-800 text-white";
      }

      return (
        <span key={colIdx} className={className}>
          {ch}
        </span>
      );
    });
  };

  const visibleLines = lines.slice(0, ROWS - 1);
  const emptyRows = ROWS - 1 - visibleLines.length;

  const modeLabel =
    mode === "insert"
      ? "-- INSERT --"
      : mode === "visual"
        ? "-- VISUAL --"
        : mode === "command"
          ? ":" + commandBuffer
          : "";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="w-[50vw] h-[50vh] bg-[#1e1e2e] border border-[#313244] rounded-lg shadow-2xl flex flex-col overflow-hidden font-mono text-sm outline-none"
    >
      {/* Editor area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {visibleLines.map((line, i) => (
          <div key={i} className="flex whitespace-pre leading-[1.4]">
            <span className="w-8 text-right pr-2 text-[#585b70] select-none shrink-0">
              {i + 1}
            </span>
            <span className="text-[#cdd6f4]">{renderLine(line, i)}</span>
          </div>
        ))}
        {Array.from({ length: emptyRows }).map((_, i) => (
          <div key={`empty-${i}`} className="flex whitespace-pre leading-[1.4]">
            <span className="w-8 text-right pr-2 text-[#585b70] select-none shrink-0">
              ~
            </span>
            <span className="text-[#585b70]"></span>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[#313244] text-[#a6adc8] flex items-center justify-between px-2 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className={mode === "insert" ? "text-green-400 font-bold" : mode === "visual" ? "text-blue-400 font-bold" : ""}>
            {modeLabel}
          </span>
          {agentLoading && (
            <span className="text-yellow-400 animate-pulse">⟳ Agent working...</span>
          )}
        </div>
        <span>
          {statusMessage || `${cursor.row + 1},${cursor.col + 1}`}
        </span>
      </div>

      {/* Bottom info */}
      <div className="h-5 bg-[#181825] text-[#585b70] flex items-center px-2 text-xs shrink-0">
        {mode === "normal" && !statusMessage && (
          <span>Type <kbd className="text-[#a6adc8]">i</kbd> to insert | <kbd className="text-[#a6adc8]">:ai &lt;prompt&gt;</kbd> for agent | <kbd className="text-[#a6adc8]">hjkl</kbd> to move</span>
        )}
      </div>
    </div>
  );
}
