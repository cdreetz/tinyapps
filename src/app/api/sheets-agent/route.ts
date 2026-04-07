import { NextRequest } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const client = new OpenAI();

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "write_cells",
    description:
      "Write values to one or more cells in the spreadsheet. Each cell is specified by its row (1-based) and column (A-Z letter), along with the value to write.",
    parameters: {
      type: "object",
      properties: {
        cells: {
          type: "array",
          description: "Array of cells to write to.",
          items: {
            type: "object",
            properties: {
              row: {
                type: "number",
                description: "1-based row number.",
              },
              col: {
                type: "string",
                description: "Column letter (A-Z).",
              },
              value: {
                type: "string",
                description: "The value to write into the cell.",
              },
            },
            required: ["row", "col", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["cells"],
      additionalProperties: false,
    },
    strict: true,
  },
];

interface CellData {
  row: number;
  col: string;
  value: string;
}

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

export async function POST(req: NextRequest) {
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

        const calls: Map<
          number,
          {
            tool: string;
            args: string;
          }
        > = new Map();

        let textBuffer = "";

        for await (const event of response) {
          // Stream text output
          if (event.type === "response.output_text.delta") {
            textBuffer += event.delta;
            send("text_delta", { text: event.delta });
          }

          if (event.type === "response.output_item.added") {
            const item = event.item;
            if (item.type === "function_call" && item.name === "write_cells") {
              calls.set(event.output_index, { tool: item.name, args: "" });
            }
          }

          if (event.type === "response.function_call_arguments.delta") {
            const state = calls.get(event.output_index);
            if (!state) continue;
            state.args += event.delta;
          }

          if (event.type === "response.function_call_arguments.done") {
            const state = calls.get(event.output_index);
            if (!state) continue;

            try {
              const parsed = JSON.parse(state.args);
              const cells: CellData[] = parsed.cells || [];
              send("write_cells", { cells });
            } catch {
              send("error", { message: "Failed to parse write_cells args" });
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
