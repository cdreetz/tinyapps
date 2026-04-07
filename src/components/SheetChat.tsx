"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface SheetSnapshot {
  [key: string]: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

interface SheetChatProps {
  getSheetSnapshot: () => SheetSnapshot;
  onWriteCells: (cells: { row: number; col: string; value: string }[]) => void;
}

export default function SheetChat({ getSheetSnapshot, onWriteCells }: SheetChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = input.trim();
      if (!prompt || isLoading) return;

      setInput("");
      setIsLoading(true);

      const userMsg: Message = { id: Date.now(), role: "user", text: prompt };
      setMessages((prev) => [...prev, userMsg]);

      const assistantId = Date.now() + 1;
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "" }]);

      try {
        const sheet = getSheetSnapshot();
        const res = await fetch("/api/sheets-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, sheet }),
        });

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));

              if (eventType === "text_delta") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, text: m.text + data.text }
                      : m
                  )
                );
              } else if (eventType === "write_cells") {
                onWriteCells(data.cells);
                // Add a note about what was written
                const count = data.cells.length;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId && m.text === ""
                      ? { ...m, text: `Wrote ${count} cell${count !== 1 ? "s" : ""} to the spreadsheet.` }
                      : m
                  )
                );
              } else if (eventType === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, text: `Error: ${data.message}` }
                      : m
                  )
                );
              }
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: `Error: ${String(err)}` }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading, getSheetSnapshot, onWriteCells]
  );

  return (
    <div className="w-[25vw] h-[50vh] bg-[#1e1e2e] border border-[#313244] rounded-lg shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-7 bg-[#313244] text-[#a6adc8] flex items-center px-3 text-xs shrink-0 gap-2 font-mono">
        <span className="text-[#cba6f7] font-bold">CHAT</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <span className="text-[#585b70] italic text-xs font-mono">
            Ask the agent to fill in your spreadsheet...
          </span>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs font-mono whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-[#89b4fa] text-[#1e1e2e]"
                  : "bg-[#313244] text-[#cdd6f4]"
              }`}
            >
              {msg.text || (isLoading ? "..." : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-[#313244] p-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isLoading ? "Thinking..." : "Message the agent..."}
          disabled={isLoading}
          className="w-full bg-[#11111b] text-[#cdd6f4] text-xs font-mono rounded px-3 py-2 outline-none border border-[#313244] focus:border-[#89b4fa] placeholder-[#585b70] disabled:opacity-50"
        />
      </form>
    </div>
  );
}
