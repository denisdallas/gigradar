import countryData from "./countries.json";

export type Country = { code: string; name: string; osmCode: string; tedCode: string };
export const COUNTRIES = countryData as Country[];
export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));
export const getCountry = (code: string | null | undefined) =>
  code ? COUNTRY_BY_CODE.get(code.toUpperCase()) : undefined;

export const SKILL_CATEGORIES = [
  "Web development",
  "Mobile app development",
  "Data analytics and engineering",
  "Cybersecurity and digital forensics",
  "Python and scripting",
  "Bots and workflow automation",
  "AI agents and automation",
  "API integrations and webhooks",
  "Backend and databases",
  "Cloud and DevOps",
  "Authorized security testing",
  "Permitted web scraping",
  "E-commerce and WordPress",
  "Debugging and maintenance",
] as const;

export type OpportunityKind = "active_gig" | "business_prospect";
export type OpportunityStatus = "new" | "saved" | "applied" | "ignored";
export type AssessmentStatus = "pending" | "assessed" | "retryable_error" | "rejected";

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  country_code: string | null;
  country_name: string | null;
  title: string;
  organization: string | null;
  summary: string | null;
  category: string | null;
  website_url: string | null;
  source_name: string;
  source_key: string;
  source_url: string;
  source_published_at: string | null;
  evidence: Array<Record<string, unknown>>;
  assessment: Record<string, unknown> | null;
  assessment_status: AssessmentStatus;
  match_score: number | null;
  confidence: "low" | "medium" | "high" | null;
  status: OpportunityStatus;
  notified_at: string | null;
  discovered_at: string;
};

