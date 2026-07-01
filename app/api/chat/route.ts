import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToCoreMessages, wrapLanguageModel, type Message } from "ai";
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

  // claude-sonnet-5 rejects `temperature`, but AI SDK v4 core injects a default of 0
  // (its own source is flagged "TODO v5 remove default 0 for temperature"). Removing
  // our explicit value isn't enough — strip the param in middleware so it never
  // reaches the Anthropic API.
  const model = wrapLanguageModel({
    model: anthropic(ASSISTANT_MODEL),
    middleware: {
      transformParams: async ({ params }) => {
        const next = { ...params };
        delete next.temperature;
        return next;
      },
    },
  });

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages),
    tools: assistantTools,
    maxSteps: 6,
  });

  // Surface the real error to the client (internal tool) instead of the SDK's
  // default masked "An error occurred." — makes failures diagnosable.
  return result.toDataStreamResponse({
    getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
