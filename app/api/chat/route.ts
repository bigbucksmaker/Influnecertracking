import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToCoreMessages, type Message } from "ai";
import { requireUser } from "@/lib/api";
import { assistantTools } from "@/lib/assistant/tools";
import { SYSTEM_PROMPT, ASSISTANT_MODEL } from "@/lib/assistant/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await requireUser();
  if ("error" in user) return user.error;

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const { messages } = (await req.json()) as { messages: Message[] };

  const result = streamText({
    model: anthropic(ASSISTANT_MODEL),
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages),
    tools: assistantTools,
    maxSteps: 6,
    temperature: 0.2,
  });

  return result.toDataStreamResponse();
}
