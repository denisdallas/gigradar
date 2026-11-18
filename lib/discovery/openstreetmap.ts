import "server-only";
import { COUNTRIES, type Country } from "@/lib/countries";
import { getDiscoveryState, setDiscoveryState } from "@/lib/repository";
import { normalizeOsmBusiness } from "./normalization.mjs";

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const USER_AGENT = "GigRadar/2.0 (+https://github.com/denisdallas/gigradar)";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeQuery(country: Country) {
  const iso = country.osmCode;
  return `[out:json][timeout:35][maxsize:268435456];
area["ISO3166-1"="${iso}"][admin_level=2]->.country;
(
  nwr["name"]["shop"](area.country);
  nwr["name"]["office"](area.country);
  nwr["name"]["craft"](area.country);
  nwr["name"]["tourism"~"hotel|guest_house|hostel|motel|apartment|camp_site"](area.country);
  nwr["name"]["amenity"~"restaurant|cafe|bar|fast_food|dentist|doctors|clinic|veterinary|school|college|language_school|car_rental|marketplace"](area.country);
  nwr["name"]["healthcare"~"doctor|dentist|clinic|physiotherapist"](area.country);
);
out center tags;`;
}

async function fetchCountryBusinesses(country: Country) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 38_000);
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: makeQuery(country) }),
      cache: "no-store",
      signal: controller.signal,
    });
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 20_000_000) throw new Error("OpenStreetMap response exceeded the 20 MB safety limit.");
    if (!response.ok) throw new Error(`OpenStreetMap returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 20_000_000) throw new Error("OpenStreetMap response exceeded the 20 MB safety limit.");
    const payload = JSON.parse(text) as { elements?: unknown[] };
    if (!Array.isArray(payload.elements)) throw new Error("OpenStreetMap returned an unexpected response.");
    return payload.elements;
  } finally {
    clearTimeout(timeout);
  }
}

export type OSMResult = {
  records: Array<Record<string, unknown>>;
  countriesAttempted: string[];
  countriesCompleted: string[];
  errors: Array<Record<string, unknown>>;
  sourceRecordsSeen: number;
};

export async function discoverOpenStreetMapBusinesses(perRun = 3): Promise<OSMResult> {
  const records: Array<Record<string, unknown>> = [];
  const countriesAttempted: string[] = [];
  const countriesCompleted: string[] = [];
  const errors: Array<Record<string, unknown>> = [];
  let sourceRecordsSeen = 0;

  const rawCursor = await getDiscoveryState("osm_country_cursor");
  const cursorValue = typeof rawCursor === "number" ? rawCursor : Number(rawCursor ?? 0);
  const start = Number.isFinite(cursorValue) ? ((Math.trunc(cursorValue) % COUNTRIES.length) + COUNTRIES.length) % COUNTRIES.length : 0;
  const countryCount = Math.min(Math.max(Math.trunc(perRun), 1), 5, COUNTRIES.length);

  for (let offset = 0; offset < countryCount; offset += 1) {
    const countryIndex = (start + offset) % COUNTRIES.length;
    const country = COUNTRIES[countryIndex];
    countriesAttempted.push(country.code);
    try {
      const elements = await fetchCountryBusinesses(country);
      sourceRecordsSeen += elements.length;
      for (const element of elements.slice(0, 5000)) {
        const record = normalizeOsmBusiness(element, country);
        if (!record) continue;
        records.push({
          ...record,
          status: "new",
          assessment_status: "pending",
          evidence: record.evidence,
        });
      }
      countriesCompleted.push(country.code);
      await setDiscoveryState("osm_country_cursor", (countryIndex + 1) % COUNTRIES.length);
    } catch (error) {
      errors.push({
        source: "OpenStreetMap",
        country: country.code,
        message: error instanceof Error ? error.message : "Unknown OpenStreetMap error.",
      });
      // Retain this country as the next retry point, then stop to avoid hammering a busy public server.
      await setDiscoveryState("osm_country_cursor", countryIndex);
      break;
    }
    if (offset < countryCount - 1) await pause(4_000);
  }

  return { records, countriesAttempted, countriesCompleted, errors, sourceRecordsSeen };
}

