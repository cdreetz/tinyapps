"use client";

import { useEffect, useRef } from "react";

export interface ToolCallEntry {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

interface DebugPanelProps {
  toolCalls: ToolCallEntry[];
}

export default function DebugPanel({ toolCalls }: DebugPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls]);

  return (
    <div className="w-[22vw] h-[50vh] bg-[#1e1e2e] border border-[#313244] rounded-lg shadow-2xl flex flex-col overflow-hidden font-mono text-xs">
      {/* Header */}
      <div className="h-7 bg-[#313244] text-[#a6adc8] flex items-center px-3 text-xs shrink-0 gap-2">
        <span className="text-[#f38ba8] font-bold">DEBUG</span>
        <span className="text-[#585b70]">{toolCalls.length} call{toolCalls.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {toolCalls.length === 0 && (
          <span className="text-[#585b70] italic text-xs">
            Tool calls will appear here
          </span>
        )}
        {toolCalls.map((call) => (
          <div key={call.id} className="border border-[#313244] rounded p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className={call.tool === "write_code" ? "text-[#a6e3a1]" : "text-[#cba6f7]"}>
                {call.tool}
              </span>
              <span className="text-[#585b70]">
                {new Date(call.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <pre className="text-[#cdd6f4] whitespace-pre-wrap break-all leading-relaxed">
              {Object.entries(call.args).map(([key, val]) => {
                const display = typeof val === "string" && val.length > 120
                  ? val.slice(0, 120) + "..."
                  : JSON.stringify(val);
                return (
                  <div key={key}>
                    <span className="text-[#89b4fa]">{key}</span>
                    <span className="text-[#585b70]">: </span>
                    <span>{display}</span>
                  </div>
                );
              })}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
