// ---------------------------------------------------------------------------
// X "For You" algorithm knowledge — distilled from the open-source release
// (github.com/xai-org/x-algorithm, May 2026 update).
//
// What's public: the full scoring STRUCTURE — which engagement predictions
// enter the Weighted Scorer, the filters, and the diversity attenuation.
// What's NOT public: the 2026 weight VALUES (the `params` module is stripped
// from the release). The relativities below are the last publicly released
// coefficients (the 2023 open-source drop) and are used as DIRECTIONAL
// magnitudes only — every consumer of these numbers must label them as such.
// ---------------------------------------------------------------------------

/** Observable-by-us engagement signals with last-public relative weights. */
export const SIGNAL_RELATIVITIES = {
  like: 0.5,
  retweet: 1.0,
  quote: 1.0, // scored separately from retweet in the 2026 structure
  reply: 13.5,
} as const;

export interface SignalCounts {
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
}

/**
 * Signal-weighted engagement: engagement counted the way the ranker values it
 * (directional 2023 relativities — replies dominate, likes are the cheapest
 * signal). Use for MIX comparisons, never as an absolute "algo score".
 */
export function signalWeightedEngagement(c: SignalCounts): number {
  return (
    c.likes * SIGNAL_RELATIVITIES.like +
    c.retweets * SIGNAL_RELATIVITIES.retweet +
    c.quotes * SIGNAL_RELATIVITIES.quote +
    c.replies * SIGNAL_RELATIVITIES.reply
  );
}

/**
 * Structural facts from the released code, for grounding report
 * recommendations. Structure is current (May 2026 release); magnitudes where
 * mentioned are the last-public (2023) coefficients, directional only.
 */
export const ALGO_CONTEXT = `X "For You" ranking structure (from the open-source release; weight values are stripped from the 2026 code — relativities cited are the last-public 2023 coefficients, directional only):
- The final score is a weighted sum of predicted engagement probabilities: favorite, reply, repost, quote, click, quoted_click, profile_click, photo_expand, video quality view (only for videos above a minimum duration), share (incl. via DM / copy-link), dwell, follow_author — minus not_interested, block, mute, report.
- quoted_click is its own scored prediction: quote tweets carry a ranked pathway INTO the quoted post. This is the mechanism that makes roster QTs amplify a launch post.
- RepostDeduplicationFilter: plain reposts dedupe against the original and do not rank as separate feed items. Quote tweets DO rank as their own items. QTs are the amplification unit; RTs are far weaker.
- Author Diversity Scorer attenuates repeated authors in a feed: many DISTINCT creators amplifying beats one account posting repeatedly.
- Replies were weighted ~27x a like in the last public coefficients; likes are the cheapest positive signal. Comment-bait that produces real replies moves ranking more than like-farming.
- AgeFilter is a hard freshness gate: amplification is worth most in the first hours; late QTs fight the age cutoff.
- Videos above the minimum duration get an extra scored channel (video quality views) that text posts lack.
- Negative signals (not_interested, mute, block, report) carry negative weights: engagement-bait that triggers "not interested" actively suppresses distribution.`;
