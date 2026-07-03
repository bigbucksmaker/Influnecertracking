import { notFound } from "next/navigation";
import { getLaunchReport } from "@/lib/launch-report";
import { LaunchReportView } from "@/components/LaunchReportView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function LaunchReportPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id, reportId } = await params;
  const report = await getLaunchReport(reportId);
  if (!report || report.trackerId !== id) notFound();
  return <LaunchReportView report={report} />;
}
