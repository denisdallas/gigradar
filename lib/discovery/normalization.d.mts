import type { Country } from "@/lib/countries";

export function htmlToText(value?: string | null): string;
export function normalizeWebsite(value?: string | null): string | null;
export function cleanText(value?: unknown, maxLength?: number): string;
export function classifyOsmCategory(tags?: Record<string, unknown>): string;
export function normalizeOsmBusiness(element: unknown, country: Country): Record<string, unknown> | null;
export function opportunityDedupeKey(sourceName: string, sourceKey: string): string;

