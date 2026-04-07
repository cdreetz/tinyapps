"use client";

import { useEffect, useRef } from "react";

interface ExplainPanelProps {
  text: string;
  isStreaming: boolean;
}

export default function ExplainPanel({ text, isStreaming }: ExplainPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div className="w-[22vw] h-[50vh] bg-[#1e1e2e] border border-[#313244] rounded-lg shadow-2xl flex flex-col overflow-hidden font-mono text-sm">
      {/* Header */}
      <div className="h-7 bg-[#313244] text-[#a6adc8] flex items-center px-3 text-xs shrink-0 gap-2">
        <span className="text-[#cba6f7] font-bold">EXPLAIN</span>
        {isStreaming && (
          <span className="text-yellow-400 animate-pulse">streaming...</span>
        )}
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 text-[#cdd6f4] text-xs leading-relaxed whitespace-pre-wrap"
      >
        {text || (
          <span className="text-[#585b70] italic">
            Agent explanations will appear here when you use :ai
          </span>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 bg-[#cba6f7] animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}
