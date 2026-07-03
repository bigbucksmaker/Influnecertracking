import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToCoreMessages, wrapLanguageModel, type Message } from "ai";
import { requireUser } from "@/lib/api";
import { assistantTools } from "@/lib/assistant/tools";
import { SYSTEM_PROMPT, ASSISTANT_MODEL } from "@/lib/assistant/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Six tool steps against a cold Neon can legitimately exceed 60s; when Vercel
// kills the function mid-stream the widget hangs on the typing dots forever.
// Vercel Pro allows 300s — give the chain room to finish.
export const maxDuration = 300;

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
    // Nothing is allowed to hang invisibly: if the provider or a tool stalls,
    // abort fires and the error surfaces in the widget instead of endless dots.
    abortSignal: AbortSignal.timeout(120_000),
  });

  // Surface the real error to the client (internal tool) instead of the SDK's
  // default masked "An error occurred." — and log it server-side so Vercel's
  // function logs always hold the truth. See also /api/chat/health.
  return result.toDataStreamResponse({
    getErrorMessage: (error) => {
      console.error("[ask] stream error:", error);
      return error instanceof Error ? error.message : String(error);
    },
  });
}
