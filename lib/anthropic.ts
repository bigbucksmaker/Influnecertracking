import Anthropic from "@anthropic-ai/sdk";

// Model used for niche taxonomy + classification (user chose Sonnet).
export const NICHE_MODEL = "claude-sonnet-5";

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to .env.local (and Vercel).");
  }
  if (!cached) cached = new Anthropic();
  return cached;
}
