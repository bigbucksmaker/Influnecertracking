import { getSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Tune scoring, budget cap, and polling cadence. Applies to the whole team workspace."
      />
      <SettingsForm settings={settings} />
    </>
  );
}
