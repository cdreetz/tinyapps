import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface SheetSnapshot {
  [key: string]: string;
}

function buildSheetContext(sheet: SheetSnapshot): string {
  const entries = Object.entries(sheet);
  if (entries.length === 0) return "(empty spreadsheet)";

  return entries
    .map(([key, val]) => {
      const [r, c] = key.split(":");
      const colLetter = String.fromCharCode(65 + parseInt(c));
      return `${colLetter}${parseInt(r) + 1}: ${val}`;
    })
    .join("\n");
}

export async function POST(req: Request) {
  const { prompt, sheet } = await req.json();

  const sheetContext = buildSheetContext(sheet || {});

  const systemPrompt = `You are a spreadsheet assistant. The user will ask you to populate, modify, or analyze data in their spreadsheet.

CURRENT SPREADSHEET CONTENTS:
\`\`\`
${sheetContext}
\`\`\`

RULES:
- Use the write_cells tool to write values to cells.
- Rows are 1-based (row 1 = first row). Columns are letters A-Z.
- You can write to multiple cells in a single tool call.
- Always respond with a tool call when the user asks you to write data.
- After writing cells, provide a brief text response describing what you did.`;

  const encoder = new TextEncoder();

  const result = streamText({
    model: openai("gpt-5.4"),
    system: systemPrompt,
    prompt,
    tools: {
      write_cells: tool({
        description:
          "Write values to one or more cells in the spreadsheet. Each cell is specified by its row (1-based) and column (A-Z letter), along with the value to write.",
        inputSchema: z.object({
          cells: z.array(
            z.object({
              row: z.number().describe("1-based row number."),
              col: z.string().describe("Column letter (A-Z)."),
              value: z.string().describe("The value to write into the cell."),
            })
          ),
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

      try {
        for await (const event of result.fullStream) {
          switch (event.type) {
            case "tool-call": {
              if (event.toolName === "write_cells") {
                const input = event.input as {
                  cells: { row: number; col: string; value: string }[];
                };
                send("write_cells", { cells: input.cells });
              }
              break;
            }
            case "text-delta":
              send("text_delta", { text: event.text });
              break;
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
      "X-Accel-Buffering": "no",
    },
  });
}
