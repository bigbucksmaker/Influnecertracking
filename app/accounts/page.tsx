import { getAllTags } from "@/lib/accounts";
import { cachedAccountsOverview } from "@/lib/cache";
import { AccountsManager } from "@/components/AccountsManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function AccountsPage() {
  const [accounts, tags] = await Promise.all([cachedAccountsOverview(), getAllTags()]);
  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Shared list of tracked X accounts. Add, tag by niche, pause, or remove."
      />
      <AccountsManager initialAccounts={accounts} allTags={tags} />
    </>
  );
}
