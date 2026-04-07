import { NextRequest } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const client = new OpenAI();

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "write_code",
    description:
      "Write code into the editor buffer. 'insert' mode adds new lines BEFORE line_start, pushing all existing lines down (no existing lines are removed). 'overwrite' mode replaces existing lines starting at line_start with the provided content. line_start is 1-based.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["insert", "overwrite"],
          description:
            "insert = add new lines at line_start, pushing existing content down. overwrite = replace lines starting at line_start.",
        },
        line_start: {
          type: "number",
          description: "1-based line number where the write begins.",
        },
        content: {
          type: "string",
          description:
            "The code/text to write. Multiple lines separated by newlines.",
        },
      },
      required: ["mode", "line_start", "content"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "explain_code",
    description:
      "Explain the code you are writing or modifying. Call this alongside write_code to narrate what the code does, why you made certain choices, and how it works. Write in a conversational, teacher-like tone. Use short paragraphs.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description:
            "A clear, conversational explanation of the code being written.",
        },
      },
      required: ["explanation"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function POST(req: NextRequest) {
  const { prompt, buffer, cursor_line } = await req.json();

  const totalLines = buffer.length;
  const numberedBuffer = buffer
    .map((line: string, i: number) => `${String(i + 1).padStart(3)}: ${line}`)
    .join("\n");

  const systemPrompt = `You are a coding assistant embedded in a vim-like editor. The user will ask you to write or modify code in their buffer.

BUFFER (${totalLines} lines total, cursor on line ${cursor_line}):
\`\`\`
${numberedBuffer || "(empty)"}
\`\`\`

TOOL USAGE RULES:
- You MUST call BOTH write_code AND explain_code tools together in parallel.
- You may call write_code MULTIPLE TIMES in a single response if you need to write code in different places in the file. For example, adding an import at line 1 and a function at line 20 should be two separate write_code calls.
- When making multiple write_code calls, work from bottom to top so earlier inserts don't shift the line numbers of later targets.
- line_start is 1-based (line 1 = first line of the buffer).
- "insert" mode: new lines are ADDED BEFORE line_start, pushing existing lines down. Existing lines are NOT modified or removed.
- "overwrite" mode: lines starting at line_start are REPLACED with your content. Use this to modify existing lines.
- To add a docstring inside a function that starts on line N, use INSERT at line N+1 (the line AFTER the def).
- To add code at the end of the buffer, use INSERT at line ${totalLines + 1}.
- Be precise with line numbers. Double-check which line you are targeting.
- Preserve the indentation style already used in the buffer.`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        const response = await client.responses.create({
          model: "gpt-5.4",
          instructions: systemPrompt,
          input: [{ role: "user", content: prompt }],
          tools,
          stream: true,
        });

        // Track per-tool-call state by output_index
        const calls: Map<
          number,
          {
            tool: "write_code" | "explain_code";
            args: string;
            // write_code state
            mode: string | null;
            line_start: number | null;
            contentStarted: boolean;
            contentBuffer: string;
            linesSent: number;
            // explain_code state
            explainStarted: boolean;
            explainBuffer: string;
            explainSent: number;
          }
        > = new Map();

        for await (const event of response) {
          if (event.type === "response.output_item.added") {
            const item = event.item;
            if (
              item.type === "function_call" &&
              (item.name === "write_code" || item.name === "explain_code")
            ) {
              calls.set(event.output_index, {
                tool: item.name,
                args: "",
                mode: null,
                line_start: null,
                contentStarted: false,
                contentBuffer: "",
                linesSent: 0,
                explainStarted: false,
                explainBuffer: "",
                explainSent: 0,
              });
            }
          }

          if (event.type === "response.function_call_arguments.delta") {
            const state = calls.get(event.output_index);
            if (!state) continue;

            state.args += event.delta;

            if (state.tool === "write_code") {
              if (state.mode === null) {
                const modeMatch = state.args.match(/"mode"\s*:\s*"(insert|overwrite)"/);
                if (modeMatch) state.mode = modeMatch[1];
              }
              if (state.line_start === null) {
                const lineMatch = state.args.match(/"line_start"\s*:\s*(\d+)/);
                if (lineMatch) state.line_start = parseInt(lineMatch[1]);
              }

              if (state.mode && state.line_start !== null) {
                if (!state.contentStarted) {
                  const contentIdx = state.args.indexOf('"content":"');
                  if (contentIdx !== -1) {
                    state.contentStarted = true;
                    send("meta", { mode: state.mode, line_start: state.line_start });
                    const afterKey = state.args.slice(contentIdx + '"content":"'.length);
                    state.contentBuffer = parsePartialJsonString(afterKey);
                  }
                } else {
                  const contentIdx = state.args.indexOf('"content":"');
                  const afterKey = state.args.slice(contentIdx + '"content":"'.length);
                  state.contentBuffer = parsePartialJsonString(afterKey);
                }

                const lines = state.contentBuffer.split("\n");
                while (state.linesSent < lines.length - 1) {
                  send("line", { text: lines[state.linesSent] });
                  state.linesSent++;
                }
              }
            } else if (state.tool === "explain_code") {
              if (!state.explainStarted) {
                const idx = state.args.indexOf('"explanation":"');
                if (idx !== -1) {
                  state.explainStarted = true;
                  const afterKey = state.args.slice(idx + '"explanation":"'.length);
                  state.explainBuffer = parsePartialJsonString(afterKey);
                }
              } else {
                const idx = state.args.indexOf('"explanation":"');
                const afterKey = state.args.slice(idx + '"explanation":"'.length);
                state.explainBuffer = parsePartialJsonString(afterKey);
              }

              if (state.explainBuffer.length > state.explainSent) {
                const delta = state.explainBuffer.slice(state.explainSent);
                send("explain_delta", { text: delta });
                state.explainSent = state.explainBuffer.length;
              }
            }
          }

          if (event.type === "response.function_call_arguments.done") {
            const state = calls.get(event.output_index);
            if (!state) continue;

            // Emit debug tool_call event with final parsed args
            try {
              const parsedArgs = JSON.parse(state.args);
              send("tool_call", { tool: state.tool, args: parsedArgs });
            } catch {
              send("tool_call", { tool: state.tool, args: { _raw: state.args } });
            }

            if (state.tool === "write_code") {
              const lines = state.contentBuffer.split("\n");
              if (state.linesSent < lines.length) {
                send("line", { text: lines[state.linesSent] });
                state.linesSent++;
              }
              send("write_done", { output_index: event.output_index });
            } else if (state.tool === "explain_code") {
              if (state.explainBuffer.length > state.explainSent) {
                const delta = state.explainBuffer.slice(state.explainSent);
                send("explain_delta", { text: delta });
              }
              send("explain_done", {});
            }
          }
        }

        send("done", {});
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
      "Cache-Control": "no-cache, no-transform",
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
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\")
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
