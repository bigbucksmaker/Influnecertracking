import { getAccountsOverview, getAllTags } from "@/lib/accounts";
import { AccountsManager } from "@/components/AccountsManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [accounts, tags] = await Promise.all([getAccountsOverview(), getAllTags()]);
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
