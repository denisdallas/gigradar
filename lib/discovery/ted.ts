import "server-only";
import { COUNTRIES, type Country } from "@/lib/countries";
import { cleanText } from "./normalization.mjs";

type TedNotice = Record<string, unknown>;

function firstText(value: unknown, preferredLanguage = "eng"): string {
  if (typeof value === "string" || typeof value === "number") return cleanText(String(value), 700);
  if (Array.isArray(value)) return firstText(value[0], preferredLanguage);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstText(record[preferredLanguage] ?? Object.values(record)[0], preferredLanguage);
  }
  return "";
}

function readCountry(value: unknown): string {
  if (Array.isArray(value)) return readCountry(value[0]);
  return typeof value === "string" ? value.toUpperCase() : "";
}

function extractCountry(notice: TedNotice): Country | undefined {
  const tedCode = readCountry(notice["buyer-country"]);
  return COUNTRIES.find((country) => country.tedCode === tedCode);
}

function queryDate(now: Date) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizePublishedDate(value: unknown) {
  const raw = firstText(value);
  const dateValue = raw.replace(/^(\d{4}-\d{2}-\d{2})([+-]\d{2}:\d{2})$/, "$1T00:00:00$2");
  const parsed = dateValue ? new Date(dateValue) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

export async function discoverTedTechnicalContracts(now = new Date()) {
  const countries = COUNTRIES.map((country) => `buyer-country=${country.tedCode}`).join(" OR ");
  const query = `(${countries}) AND (classification-cpv=72* OR classification-cpv=48*) AND notice-type=cn-standard AND publication-date>=${queryDate(now)} SORT BY publication-date DESC`;
  const response = await fetch("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": "GigRadar/2.0 (+https://github.com/denisdallas/gigradar)" },
    body: JSON.stringify({
      query,
      fields: [
        "publication-number",
        "publication-date",
        "notice-title",
        "notice-type",
        "buyer-name",
        "buyer-country",
        "deadline-receipt-tender-date-lot",
        "estimated-value-proc",
        "estimated-value-cur-proc",
        "classification-cpv",
      ],
      page: 1,
      limit: 100,
      paginationMode: "PAGE_NUMBER",
      scope: "ACTIVE",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TED Search API returned HTTP ${response.status}.`);
  const payload = await response.json() as { notices?: TedNotice[] };
  const records: Array<Record<string, unknown>> = [];
  for (const notice of payload.notices ?? []) {
    const publicationNumber = firstText(notice["publication-number"]);
    const country = extractCountry(notice);
    const type = firstText(notice["notice-type"]);
    if (!publicationNumber || !country || !type.startsWith("cn")) continue;
    const title = firstText(notice["notice-title"]);
    if (!title) continue;
    const buyer = firstText(notice["buyer-name"]);
    const cpv = Array.isArray(notice["classification-cpv"])
      ? notice["classification-cpv"].map((value) => String(value)).slice(0, 8)
      : [];
    const amount = firstText(notice["estimated-value-proc"]);
    const currency = firstText(notice["estimated-value-cur-proc"]);
    const deadline = firstText(notice["deadline-receipt-tender-date-lot"]);
    const sourceUrl = `https://ted.europa.eu/en/notice/${encodeURIComponent(publicationNumber)}`;
    const published = normalizePublishedDate(notice["publication-date"]);
    records.push({
      kind: "active_gig",
      country_code: country.code,
      country_name: country.name,
      title,
      organization: buyer || null,
      summary: ["Active public procurement call for a technical service.", amount ? `Published estimated value: ${amount} ${currency}.` : "The contract value was not included in the search result.", deadline ? `Bid deadline: ${deadline}.` : ""].filter(Boolean).join(" "),
      category: "Public technical procurement",
      website_url: null,
      source_name: "TED Open Data",
      source_key: publicationNumber,
      source_url: sourceUrl,
      source_published_at: published,
      evidence: [{
        source: "TED Open Data",
        source_url: sourceUrl,
        publication_number: publicationNumber,
        notice_type: type,
        buyer: buyer || null,
        buyer_country: country.name,
        publication_date: published,
        bid_deadline: deadline || null,
        estimated_value: amount || null,
        estimated_value_currency: currency || null,
        classification_cpv: cpv,
        payment_basis: "An active public procurement call for competition; contract terms and eligibility remain in the source notice.",
      }],
      status: "new",
      assessment_status: "pending",
    });
  }
  return { records, returned: (payload.notices ?? []).length };
}

