"use client";

import { useState, useCallback } from "react";
import VimTerminal from "@/components/VimTerminal";
import ExplainPanel from "@/components/ExplainPanel";
import DebugPanel, { ToolCallEntry } from "@/components/DebugPanel";

export default function Home() {
  const [explainText, setExplainText] = useState("");
  const [isExplaining, setIsExplaining] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);

  const handleExplainStart = useCallback(() => {
    setExplainText("");
    setIsExplaining(true);
  }, []);

  const handleExplainDelta = useCallback((delta: string) => {
    setExplainText((prev) => prev + delta);
  }, []);

  const handleExplainDone = useCallback(() => {
    setIsExplaining(false);
  }, []);

  const handleToolCall = useCallback((tool: string, args: Record<string, unknown>) => {
    setToolCalls((prev) => [
      ...prev,
      { id: Date.now(), tool, args, timestamp: Date.now() },
    ]);
  }, []);

  return (
    <div className="h-screen w-screen flex items-center justify-center gap-4 bg-[#11111b]">
      <DebugPanel toolCalls={toolCalls} />
      <VimTerminal
        onExplainStart={handleExplainStart}
        onExplainDelta={handleExplainDelta}
        onExplainDone={handleExplainDone}
        onToolCall={handleToolCall}
      />
      <ExplainPanel text={explainText} isStreaming={isExplaining} />
    </div>
  );
}
