import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Opportunity, OpportunityStatus } from "@/lib/countries";

export type DashboardSummary = {
  activeGigs: number;
  businessProspects: number;
  saved: number;
  applied: number;
  ignored: number;
  countries: Array<{ code: string; count: number }>;
  latestRun: {
    status: string;
    started_at: string;
    completed_at: string | null;
    metrics: Record<string, unknown>;
    errors: Array<Record<string, unknown>>;
  } | null;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data, error } = await getSupabaseAdmin().rpc("gigradar_dashboard_summary");
  if (error) throw new Error(`Could not load GigRadar summary: ${error.message}`);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    activeGigs: Number(row.active_gigs ?? 0),
    businessProspects: Number(row.business_prospects ?? 0),
    saved: Number(row.saved ?? 0),
    applied: Number(row.applied ?? 0),
    ignored: Number(row.ignored ?? 0),
    countries: Array.isArray(row.countries) ? row.countries as DashboardSummary["countries"] : [],
    latestRun: (row.latest_run ?? null) as DashboardSummary["latestRun"],
  };
}

export async function listOpportunities(options: {
  kind?: "active_gig" | "business_prospect";
  country?: string;
  status?: OpportunityStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<Opportunity[]> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  let query = getSupabaseAdmin()
    .from("opportunities")
    .select("*")
    .eq("assessment_status", "assessed")
    .order("discovered_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.kind) query = query.eq("kind", options.kind);
  if (options.country) query = query.eq("country_code", options.country.toUpperCase());
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load opportunities: ${error.message}`);
  return (data ?? []) as Opportunity[];
}

export async function updateOpportunityStatus(id: string, status: OpportunityStatus) {
  const { data, error } = await getSupabaseAdmin()
    .from("opportunities")
    .update({ status })
    .eq("id", id)
    .select("id,status")
    .single();
  if (error) throw new Error(`Could not update opportunity: ${error.message}`);
  return data as { id: string; status: OpportunityStatus };
}

export async function startDiscoveryRun() {
  const { data, error } = await getSupabaseAdmin()
    .from("discovery_runs")
    .insert({ status: "running", metrics: {}, errors: [] })
    .select("id,started_at")
    .single();
  if (error) throw new Error(`Could not start discovery run: ${error.message}`);
  return data as { id: string; started_at: string };
}

export async function finishDiscoveryRun(
  id: string,
  status: "completed" | "partial" | "failed",
  metrics: Record<string, unknown>,
  errors: Array<Record<string, unknown>>,
) {
  const { error } = await getSupabaseAdmin()
    .from("discovery_runs")
    .update({ status, metrics, errors, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not finish discovery run: ${error.message}`);
}

export async function getDiscoveryState(key: string): Promise<unknown> {
  const { data, error } = await getSupabaseAdmin()
    .from("discovery_state")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Could not load discovery state: ${error.message}`);
  return data?.value;
}

export async function setDiscoveryState(key: string, value: unknown) {
  const { error } = await getSupabaseAdmin()
    .from("discovery_state")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Could not save discovery state: ${error.message}`);
}

export async function saveDiscoveredRecords(records: Array<Record<string, unknown>>) {
  if (!records.length) return 0;
  let inserted = 0;
  const supabase = getSupabaseAdmin();
  for (let start = 0; start < records.length; start += 250) {
    const batch = records.slice(start, start + 250);
    const { data, error } = await supabase
      .from("opportunities")
      .upsert(batch, { onConflict: "source_name,source_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Could not save discovered records: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function getPendingAssessmentRecords(limit: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("opportunities")
    .select("*")
    .in("assessment_status", ["pending", "retryable_error"])
    .eq("kind", "active_gig")
    .order("source_published_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Could not load pending assessments: ${error.message}`);
  return (data ?? []) as Opportunity[];
}

export async function getPendingBusinessResearch(limit: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("opportunities")
    .select("*")
    .eq("kind", "business_prospect")
    .in("assessment_status", ["pending", "retryable_error"])
    .not("website_url", "is", null)
    .order("discovered_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 40));
  if (error) throw new Error(`Could not load prospects for research: ${error.message}`);
  return ((data ?? []) as Opportunity[]).filter((opportunity) =>
    !(opportunity.evidence ?? []).some((item) => item.source === "Business website" || item.source === "Business website research attempt"),
  );
}

export async function getPendingBusinessAssessment(limit: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("opportunities")
    .select("*")
    .eq("kind", "business_prospect")
    .in("assessment_status", ["pending", "retryable_error"])
    .not("website_url", "is", null)
    .order("discovered_at", { ascending: true })
    .limit(Math.min(Math.max(limit * 4, 20), 200));
  if (error) throw new Error(`Could not load researched prospects: ${error.message}`);
  return ((data ?? []) as Opportunity[])
    .filter((opportunity) => (opportunity.evidence ?? []).some((item) =>
      item.source === "Business website" && typeof item.visible_text === "string" && item.visible_text.length >= 80,
    ))
    .slice(0, limit);
}

export async function appendOpportunityEvidence(id: string, evidence: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("opportunities").select("evidence").eq("id", id).single();
  if (error) throw new Error(`Could not load prospect evidence: ${error.message}`);
  const current = Array.isArray(data.evidence) ? data.evidence : [];
  const { error: updateError } = await supabase
    .from("opportunities")
    .update({ evidence: [...current, evidence] })
    .eq("id", id);
  if (updateError) throw new Error(`Could not save prospect research: ${updateError.message}`);
}

export async function saveAssessment(input: {
  opportunityId: string;
  model: string;
  outcome: "assessed" | "rejected" | "retryable_error";
  score?: number | null;
  assessment?: Record<string, unknown> | null;
  errorCode?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const { error: historyError } = await supabase.from("assessment_history").insert({
    opportunity_id: input.opportunityId,
    model: input.model,
    outcome: input.outcome,
    score: input.score ?? null,
    assessment: input.assessment ?? null,
    error_code: input.errorCode ?? null,
  });
  if (historyError) throw new Error(`Could not save assessment history: ${historyError.message}`);
  const { error } = await supabase.from("opportunities").update({
    assessment_status: input.outcome,
    assessment: input.assessment ?? null,
    match_score: input.score ?? null,
    confidence: input.assessment?.confidence ?? null,
  }).eq("id", input.opportunityId);
  if (error) throw new Error(`Could not save assessment: ${error.message}`);
}

export async function listUnnotifiedMatches(minScore: number, limit = 20) {
  const { data, error } = await getSupabaseAdmin()
    .from("opportunities")
    .select("id,kind,title,organization,country_code,country_name,summary,source_url,match_score,assessment")
    .eq("assessment_status", "assessed")
    .is("notified_at", null)
    .gte("match_score", minScore)
    .neq("status", "ignored")
    .order("match_score", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load notification candidates: ${error.message}`);
  return data ?? [];
}

export async function markNotified(ids: string[]) {
  if (!ids.length) return;
  const { error } = await getSupabaseAdmin()
    .from("opportunities")
    .update({ notified_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(`Could not mark notified records: ${error.message}`);
}

