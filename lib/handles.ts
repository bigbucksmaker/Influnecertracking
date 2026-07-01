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
