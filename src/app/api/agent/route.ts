import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { prompt, buffer, cursor_line } = await req.json();

  const totalLines = (buffer as string[]).length;
  const numberedBuffer = (buffer as string[])
    .map((line: string, i: number) => `${String(i + 1).padStart(3)}: ${line}`)
    .join("\n");

  const systemPrompt = `You are a coding assistant embedded in a vim-like editor. The user will ask you to write or modify code in their buffer.

BUFFER (${totalLines} lines total, cursor on line ${cursor_line}):
\`\`\`
${numberedBuffer || "(empty)"}
\`\`\`

TOOL USAGE RULES:
- Call write_code to write or modify code in the buffer. You may call it MULTIPLE TIMES to write in different locations.
- When making multiple write_code calls, work from bottom to top so earlier inserts don't shift the line numbers of later targets.
- line_start is 1-based (line 1 = first line of the buffer).
- "insert" mode: new lines are ADDED BEFORE line_start, pushing existing lines down. Existing lines are NOT modified or removed.
- "overwrite" mode: lines starting at line_start are REPLACED with your content. Use this to modify existing lines.
- To add code at the end of the buffer, use INSERT at line ${totalLines + 1}.
- Be precise with line numbers. Double-check which line you are targeting.
- Preserve the indentation style already used in the buffer.
- You MUST call BOTH write_code AND explain_code tools together in parallel.
- Always explain what the code does, why you made certain choices, and how it works. Write in a conversational, teacher-like tone.`;

  const encoder = new TextEncoder();

  const result = streamText({
    model: openai.chat("gpt-5.4"),
    system: systemPrompt,
    prompt,
    providerOptions: {
      openai: { parallelToolCalls: true },
    },
    tools: {
      write_code: tool({
        description:
          "Write code into the editor buffer. 'insert' mode adds new lines BEFORE line_start, pushing all existing lines down. 'overwrite' mode replaces existing lines starting at line_start.",
        inputSchema: z.object({
          mode: z.enum(["insert", "overwrite"]),
          line_start: z.number().describe("1-based line number where the write begins."),
          content: z.string().describe("The code/text to write. Multiple lines separated by newlines."),
        }),
      }),
      explain_code: tool({
        description:
          "Explain the code you are writing or modifying. Call this alongside write_code to narrate what the code does, why you made certain choices, and how it works. Write in a conversational, teacher-like tone. Use short paragraphs.",
        inputSchema: z.object({
          explanation: z.string().describe("A clear, conversational explanation of the code being written."),
        }),
      }),
    },
  });

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      // Send 2KB padding comment to force any compression buffers to flush.
      // Turbopack's dev server may gzip-buffer the response; this primes the pipe.
      controller.enqueue(
        encoder.encode(`: ${"x".repeat(2048)}\n\n`)
      );

      // Track per-tool-call streaming state
      const calls = new Map<
        string,
        {
          toolName: string;
          json: string;
          // write_code incremental state
          metaSent: boolean;
          mode: string | null;
          lineStart: number | null;
          contentStarted: boolean;
          contentBuffer: string;
          linesSent: number;
          // explain_code incremental state
          explainStarted: boolean;
          explainBuffer: string;
          explainSent: number;
        }
      >();

      try {
        for await (const event of result.fullStream) {
          switch (event.type) {
            case "tool-input-start": {
              calls.set(event.id, {
                toolName: event.toolName,
                json: "",
                metaSent: false,
                mode: null,
                lineStart: null,
                contentStarted: false,
                contentBuffer: "",
                linesSent: 0,
                explainStarted: false,
                explainBuffer: "",
                explainSent: 0,
              });
              break;
            }

            case "tool-input-delta": {
              const state = calls.get(event.id);
              if (!state) break;

              state.json += event.delta;

              if (state.toolName === "write_code") {
                if (state.mode === null) {
                  const m = state.json.match(/"mode"\s*:\s*"(insert|overwrite)"/);
                  if (m) state.mode = m[1];
                }
                if (state.lineStart === null) {
                  const m = state.json.match(/"line_start"\s*:\s*(\d+)/);
                  if (m) state.lineStart = parseInt(m[1]);
                }

                if (state.mode && state.lineStart !== null) {
                  if (!state.metaSent) {
                    send("meta", { mode: state.mode, line_start: state.lineStart });
                    state.metaSent = true;
                  }

                  const contentMatch = state.json.match(/"content"\s*:\s*"/);
                  if (contentMatch) {
                    const valueStart = contentMatch.index! + contentMatch[0].length;
                    state.contentStarted = true;
                    state.contentBuffer = parsePartialJsonString(
                      state.json.slice(valueStart)
                    );
                  }

                  const lines = state.contentBuffer.split("\n");
                  while (state.linesSent < lines.length - 1) {
                    send("line", { text: lines[state.linesSent] });
                    state.linesSent++;
                  }
                }
              } else if (state.toolName === "explain_code") {
                const explainMatch = state.json.match(/"explanation"\s*:\s*"/);
                if (explainMatch) {
                  const valueStart = explainMatch.index! + explainMatch[0].length;
                  state.explainStarted = true;
                  state.explainBuffer = parsePartialJsonString(
                    state.json.slice(valueStart)
                  );
                }

                if (state.explainBuffer.length > state.explainSent) {
                  send("explain_delta", {
                    text: state.explainBuffer.slice(state.explainSent),
                  });
                  state.explainSent = state.explainBuffer.length;
                }
              }
              break;
            }

            case "tool-call": {
              const state = calls.get(event.toolCallId);

              if (event.toolName === "write_code") {
                const input = event.input as {
                  mode: "insert" | "overwrite";
                  line_start: number;
                  content: string;
                };

                if (state) {
                  const lines = input.content.split("\n");
                  if (!state.metaSent) {
                    send("meta", { mode: input.mode, line_start: input.line_start });
                  }
                  for (let i = state.linesSent; i < lines.length; i++) {
                    send("line", { text: lines[i] });
                  }
                } else {
                  send("meta", { mode: input.mode, line_start: input.line_start });
                  for (const line of input.content.split("\n")) {
                    send("line", { text: line });
                  }
                }

                send("write_done", {});
                send("tool_call", { tool: event.toolName, args: input });
              } else if (event.toolName === "explain_code") {
                const input = event.input as { explanation: string };

                if (state && state.explainSent < input.explanation.length) {
                  send("explain_delta", {
                    text: input.explanation.slice(state.explainSent),
                  });
                } else if (!state) {
                  send("explain_delta", { text: input.explanation });
                }

                send("explain_done", {});
                send("tool_call", { tool: event.toolName, args: input });
              }

              calls.delete(event.toolCallId);
              break;
            }

            case "error":
              send("error", { message: String(event.error) });
              break;
            case "finish":
              send("done", {});
              break;
          }
        }
      } catch (err) {
        send("error", { message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Content-Encoding": "identity",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function parsePartialJsonString(raw: string): string {
  let s = raw;
  const lastQuote = findClosingQuote(s);
  if (lastQuote !== -1) {
    s = s.slice(0, lastQuote);
  }

  return s
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
}

function findClosingQuote(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') return i;
  }
  return -1;
}
