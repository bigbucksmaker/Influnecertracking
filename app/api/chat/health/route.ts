import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, wrapLanguageModel } from "ai";
import { requireUser } from "@/lib/api";
import { assistantTools } from "@/lib/assistant/tools";
import { ASSISTANT_MODEL } from "@/lib/assistant/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Ask diagnostics. Open /api/chat/health in the browser while signed in.
 * Runs the exact same wrapped model twice — once plain, once forced through a
 * tool call (the path that has been hanging) — with hard timeouts, and
 * returns the real error strings instead of silence.
 */
export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const report: Record<string, unknown> = {
    model: ASSISTANT_MODEL,
    anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    at: new Date().toISOString(),
  };

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

  // 1) Plain text — verifies key, model id, and basic reachability.
  const t0 = Date.now();
  try {
    const r = await generateText({
      model,
      prompt: "Reply with the single word: ok",
      abortSignal: AbortSignal.timeout(20_000),
    });
    report.plainText = { ok: true, text: r.text.slice(0, 40), ms: Date.now() - t0 };
  } catch (e) {
    report.plainText = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 };
  }

  // 2) Forced tool call — the exact path Ask hangs on.
  const t1 = Date.now();
  try {
    const r = await generateText({
      model,
      tools: { listNiches: assistantTools.listNiches },
      toolChoice: "required",
      maxSteps: 2,
      prompt: "Call the listNiches tool.",
      abortSignal: AbortSignal.timeout(45_000),
    });
    report.toolCall = {
      ok: true,
      steps: r.steps.length,
      toolCalls: r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
      text: r.text.slice(0, 80),
      ms: Date.now() - t1,
    };
  } catch (e) {
    report.toolCall = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t1 };
  }

  // 3) Full toolset dry run — catches a single bad tool schema poisoning the set.
  const t2 = Date.now();
  try {
    const r = await generateText({
      model,
      tools: assistantTools,
      maxSteps: 1,
      prompt: "Reply with the single word: ok. Do not call any tools.",
      abortSignal: AbortSignal.timeout(30_000),
    });
    report.fullToolset = { ok: true, text: r.text.slice(0, 40), ms: Date.now() - t2 };
  } catch (e) {
    report.fullToolset = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t2 };
  }

  return NextResponse.json(report);
}
