"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page render error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-2xl border border-line p-8 text-center shadow-pop">
        <h1 className="text-lg font-semibold text-fg">This page failed to load</h1>
        <p className="mt-2 text-sm text-subtle">
          A server-side error occurred while rendering. The rest of the app is unaffected.
          {error.digest ? (
            <span className="mt-1 block font-mono text-xs text-subtle">digest: {error.digest}</span>
          ) : null}
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-all hover:border-accent/40 hover:bg-surface-3"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
