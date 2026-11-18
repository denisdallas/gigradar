import Dashboard from "@/app/ui/dashboard";
import { COUNTRIES } from "@/lib/countries";
import { getDashboardSummary, type DashboardSummary } from "@/lib/repository";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

const emptySummary = (): DashboardSummary => ({
  activeGigs: 0,
  businessProspects: 0,
  saved: 0,
  applied: 0,
  ignored: 0,
  countries: COUNTRIES.map((country) => ({ code: country.code, count: 0 })),
  latestRun: null,
});

export const dynamic = "force-dynamic";

export default async function Home() {
  let summary = emptySummary();
  let databaseError: string | null = null;
  let configured = isSupabaseConfigured();
  if (configured) {
    try {
      summary = await getDashboardSummary();
    } catch (error) {
      databaseError = error instanceof Error ? error.message : "The database could not be reached.";
    }
  }
  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date()).toUpperCase();
  return <Dashboard initialSummary={summary} databaseConfigured={configured} databaseError={databaseError} todayLabel={todayLabel} />;
}

