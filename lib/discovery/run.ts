import "server-only";
import { assessOpportunities } from "./assessment";
import { discoverHackerNewsGigs } from "./hacker-news";
import { discoverOpenStreetMapBusinesses } from "./openstreetmap";
import { discoverTedTechnicalContracts } from "./ted";
import { sendOpportunityNotifications } from "./notify";
import { researchBusinessWebsites } from "./website-research";
import {
  finishDiscoveryRun,
  getPendingAssessmentRecords,
  getPendingBusinessAssessment,
  getPendingBusinessResearch,
  saveDiscoveredRecords,
  startDiscoveryRun,
} from "@/lib/repository";

export async function runDailyDiscovery() {
  const run = await startDiscoveryRun();
  const errors: Array<Record<string, unknown>> = [];
  const metrics: Record<string, unknown> = {};
  try {
    const [activeResult, businessResult, tedResult] = await Promise.allSettled([
      discoverHackerNewsGigs(),
      discoverOpenStreetMapBusinesses(Number(process.env.OSM_COUNTRIES_PER_RUN ?? 3)),
      discoverTedTechnicalContracts(),
    ]);

    let activeCandidates: Array<Record<string, unknown>> = [];
    let businessCandidates: Array<Record<string, unknown>> = [];
    let tenderCandidates: Array<Record<string, unknown>> = [];
    if (activeResult.status === "fulfilled") {
      activeCandidates = activeResult.value.records;
      errors.push(...activeResult.value.errors);
      metrics.active_gigs_found = activeCandidates.length;
      metrics.hacker_news_queries = activeResult.value.queries;
    } else {
      errors.push({ source: "Hacker News", message: activeResult.reason instanceof Error ? activeResult.reason.message : "Source failed." });
    }
    if (businessResult.status === "fulfilled") {
      businessCandidates = businessResult.value.records;
      errors.push(...businessResult.value.errors);
      metrics.businesses_found = businessCandidates.length;
      metrics.osm_source_records_seen = businessResult.value.sourceRecordsSeen;
      metrics.countries_attempted = businessResult.value.countriesAttempted;
      metrics.countries_completed = businessResult.value.countriesCompleted;
    } else {
      errors.push({ source: "OpenStreetMap", message: businessResult.reason instanceof Error ? businessResult.reason.message : "Source failed." });
    }
    if (tedResult.status === "fulfilled") {
      tenderCandidates = tedResult.value.records;
      metrics.ted_notices_returned = tedResult.value.returned;
      metrics.ted_contracts_found = tenderCandidates.length;
    } else {
      errors.push({ source: "TED Open Data", message: tedResult.reason instanceof Error ? tedResult.reason.message : "Source failed." });
    }

    metrics.new_active_gigs = await saveDiscoveredRecords([...activeCandidates, ...tenderCandidates]);
    metrics.new_business_prospects = await saveDiscoveredRecords(businessCandidates);

    const researchCandidates = await getPendingBusinessResearch(4);
    const research = await researchBusinessWebsites(researchCandidates, 4);
    metrics.websites_researched = research.researched;
    errors.push(...research.errors);

    const maxBatches = Math.min(3, Math.max(1, Number(process.env.GROQ_BATCHES_PER_RUN ?? 2)));
    const activePending = await getPendingAssessmentRecords(maxBatches * 8);
    const businessPending = await getPendingBusinessAssessment(maxBatches * 8);
    const assessmentQueue = Array.from({ length: maxBatches * 8 }, (_, index) =>
      index % 2 === 0 ? activePending[Math.floor(index / 2)] : businessPending[Math.floor(index / 2)],
    ).filter((entry): entry is (typeof activePending)[number] => Boolean(entry));
    const assessment = await assessOpportunities(assessmentQueue, maxBatches);
    metrics.assessment_attempted = assessment.attempted;
    metrics.assessment_matches = assessment.assessed;
    metrics.assessment_rejected = assessment.rejected;
    errors.push(...assessment.errors);

    try {
      const notifications = await sendOpportunityNotifications();
      metrics.notifications_sent = notifications.sent;
      if (notifications.skipped) metrics.notifications_skipped = notifications.skipped;
    } catch (error) {
      errors.push({ source: "ntfy", message: error instanceof Error ? error.message : "Notification delivery failed." });
    }

    const status = errors.length ? "partial" : "completed";
    await finishDiscoveryRun(run.id, status, metrics, errors);
    return { runId: run.id, status, metrics, errors };
  } catch (error) {
    errors.push({ source: "discovery", message: error instanceof Error ? error.message : "Unknown discovery failure." });
    await finishDiscoveryRun(run.id, "failed", metrics, errors).catch(() => undefined);
    throw error;
  }
}

