/**
 * Parse a free-form blob (commas, newlines, spaces, @handles, or profile URLs)
 * into a clean, de-duplicated list of valid X usernames (lowercased, no @).
 */
export function parseHandles(input: string): string[] {
  if (!input) return [];
  const tokens = input.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const raw of tokens) {
    let h = raw;
    // pull username out of a profile URL
    const urlMatch = /(?:twitter\.com|x\.com)\/(@?[A-Za-z0-9_]+)/i.exec(h);
    if (urlMatch) h = urlMatch[1];
    h = h.replace(/^@/, "").toLowerCase();
    // strip any trailing query/path junk
    h = h.split(/[/?#]/)[0];
    if (isValidHandle(h)) out.add(h);
  }
  return [...out];
}

export function isValidHandle(h: string): boolean {
  return /^[a-z0-9_]{1,15}$/.test(h);
}

/**
 * Extract a tweet id from a tweet URL or a raw id.
 * Accepts x.com/twitter.com status URLs, a bare numeric id, or (for the mock
 * provider) a non-numeric id token. Returns null if nothing id-like is found.
 */
export function parseTweetId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  // status URL → numeric id
  const url = /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/i.exec(s);
  if (url) return url[1];
  // bare numeric id
  if (/^\d{5,25}$/.test(s)) return s;
  // long digit run inside some other path
  const digits = /\/(\d{5,25})(?:[/?#]|$)/.exec(s);
  if (digits) return digits[1];
  // fallback: a single bare token (covers mock ids like "mock-alice-1234")
  if (/^[A-Za-z0-9_-]{3,60}$/.test(s)) return s;
  return null;
}
