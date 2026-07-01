import type { DataProvider } from "./types";
import { MockProvider } from "./mock";
import { TwitterApiIoProvider } from "./twitterapiio";

export * from "./types";

let cached: DataProvider | null = null;

/** Returns the configured data provider (twitterapi.io by default, mock for dev). */
export function getProvider(): DataProvider {
  if (cached) return cached;
  const which = (process.env.DATA_PROVIDER ?? "twitterapiio").toLowerCase();
  if (which === "mock") {
    cached = new MockProvider();
  } else {
    cached = new TwitterApiIoProvider();
  }
  return cached;
}

/** For tests / explicit overrides. */
export function setProvider(p: DataProvider | null): void {
  cached = p;
}
