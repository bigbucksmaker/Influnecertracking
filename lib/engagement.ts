export interface EngagementCounts {
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
}

/**
 * Total engagements for a post = likes + reposts + replies + quotes + bookmarks.
 * Centralized so the definition stays consistent across ingest, scoring, and mocks.
 */
export function engagementsOf(m: EngagementCounts): number {
  return (
    (m.likeCount || 0) +
    (m.retweetCount || 0) +
    (m.replyCount || 0) +
    (m.quoteCount || 0) +
    (m.bookmarkCount || 0)
  );
}
