// ---------------------------------------------------------------------------
// DataProvider — the swappable abstraction over the X data source.
// twitterapi.io is the concrete implementation; a MockProvider exists for dev.
// ---------------------------------------------------------------------------

export type ApiEndpoint =
  | "user_info"
  | "user_last_tweets"
  | "advanced_search"
  | "tweets_by_ids"
  | "balance";

export interface RawUserProfile {
  xUserId: string;
  username: string;
  name: string | null;
  followers: number;
  following: number;
  statusesCount: number;
  mediaCount: number;
  favouritesCount: number;
  isBlueVerified: boolean;
  verifiedType: string | null;
  profilePicture: string | null;
  description: string | null;
  location: string | null;
  createdAt: Date | null;
}

export interface RawPostMetrics {
  tweetId: string;
  authorUserId: string | null;
  authorUsername: string | null;
  text: string;
  postedAt: Date;
  lang: string | null;
  isReply: boolean;
  isRetweet: boolean;
  url: string | null;
  viewCount: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
}

export interface CostInfo {
  endpoint: ApiEndpoint;
  itemsReturned: number;
  creditsCharged: number;
}

export interface ProviderResult<T> {
  data: T;
  cost: CostInfo;
}

export interface PageResult<T> {
  data: T[];
  cost: CostInfo;
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface AccountBalance {
  rechargeCredits: number;
  bonusCredits: number;
}

export interface LatestTweetsParams {
  username?: string;
  userId?: string;
  cursor?: string;
  includeReplies?: boolean;
}

export interface SearchParams {
  query: string;
  queryType?: "Latest" | "Top";
  cursor?: string;
}

export interface DataProvider {
  readonly name: string;
  getUserByUsername(username: string): Promise<ProviderResult<RawUserProfile>>;
  getUserLatestTweets(params: LatestTweetsParams): Promise<PageResult<RawPostMetrics>>;
  searchTweets(params: SearchParams): Promise<PageResult<RawPostMetrics>>;
  getTweetsByIds(tweetIds: string[]): Promise<ProviderResult<RawPostMetrics[]>>;
  getBalance?(): Promise<ProviderResult<AccountBalance>>;
}

/** Error carrying the HTTP status so callers can log it and decide on retries. */
export class ProviderError extends Error {
  status: number;
  endpoint: ApiEndpoint;
  constructor(message: string, status: number, endpoint: ApiEndpoint) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.endpoint = endpoint;
  }
}
