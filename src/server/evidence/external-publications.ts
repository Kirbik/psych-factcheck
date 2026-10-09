import "server-only";
import { createHash } from "node:crypto";
import type { PublicationReference } from "@/server/ai/providers";
import {
  EvidenceSearchProviderError,
  EUROPE_PMC_PROVIDER_VERSION,
  CROSSREF_PROVIDER_VERSION,
  type EvidenceSearchProvider,
  type SearchedPublication,
} from "./search-provider";
import {
  EVIDENCE_RETRIEVAL_VERSION,
  type EvidenceCandidate,
  type EvidenceSearchResult,
} from "./search";
export const EXTERNAL_EVIDENCE_VERSION = "external-evidence-v2";
const REUSABLE_LICENSE = "https://creativecommons.org/licenses/by/4.0/";
// Stable UUIDv8 identifiers refer to package snapshots, not catalog rows.
function snapshotId(key: string) {
  const h = createHash("sha256").update(key).digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-8" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}
function publicationKey(p: SearchedPublication) {
  return p.doi
    ? "doi:" + p.doi.toLowerCase()
    : "europe-pmc:" + (p.pmcid ?? p.pmid);
}
function publicationUrl(p: SearchedPublication) {
  return p.doi ? "https://doi.org/" + encodeURIComponent(p.doi) : p.url;
}
function toCandidate(
  p: SearchedPublication,
  order: number,
): EvidenceCandidate | null {
  if (
    p.provider !== "europe-pmc" ||
    !p.pmcid ||
    !p.fullText ||
    p.licenseUrl !== REUSABLE_LICENSE ||
    !p.authors.length ||
    !p.publisher ||
    !p.year ||
    !p.fullTextLanguage ||
    ![
      "journal article",
      "research article",
      "review",
      "systematic review",
      "meta-analysis",
    ].includes(p.publicationType?.toLocaleLowerCase() ?? "")
  )
    return null;
  const content = p.fullText.trim().slice(0, 1000);
  if (content.length < 40) return null;
  const key = publicationKey(p);
  const type = p.publicationType?.toLocaleLowerCase();
  return {
    sourceId: snapshotId("source:" + key),
    chunkId: snapshotId("excerpt:" + key + ":" + content),
    chunkKey: "oa-search-excerpt-1",
    content,
    language: p.fullTextLanguage,
    locator: "Europe PMC OA full text, extracted paragraph",
    source: {
      key,
      title: p.title,
      authors: p.authors,
      journal: p.journal,
      publisher: p.publisher,
      doi: p.doi ?? null,
      licenseCode: "CC-BY-4.0",
      licenseUrl: REUSABLE_LICENSE,
      publishedAt: p.year,
      type:
        type === "systematic review"
          ? "systematic_review"
          : type === "meta-analysis"
            ? "meta_analysis"
            : "journal_article",
      canonicalUrl: publicationUrl(p),
    },
    similarity: Math.max(0, 1 - order * 0.05),
    retrievalScoreKind: "provider_search_order",
    attribution: {
      dataProvider: "europe-pmc",
      providerVersion: EUROPE_PMC_PROVIDER_VERSION,
      externalId: p.pmcid,
      availability: "open_access_full_text",
      licenseCode: "CC-BY-4.0",
      licenseUrl: REUSABLE_LICENSE,
    },
  };
}
export async function searchExternalPublications(
  provider: EvidenceSearchProvider,
  claims: readonly string[],
): Promise<readonly EvidenceSearchResult[]> {
  if (claims.length > 100) throw new Error("Too many publication queries");
  const results: EvidenceSearchResult[] = [];
  for (const claim of claims) {
    if (!claim.trim() || claim.length > 1200)
      throw new Error("Invalid publication search claim");
    const warnings: string[] = [];
    let publications: readonly SearchedPublication[];
    try {
      publications = await provider.search(claim);
    } catch (error) {
      if (!(error instanceof EvidenceSearchProviderError)) throw error;
      publications = [];
      warnings.push("external_search_unavailable", error.code);
    }
    const candidates: EvidenceCandidate[] = [];
    const references: PublicationReference[] = [];
    for (const [index, p] of publications.entries()) {
      const candidate = toCandidate(p, index);
      if (
        candidate &&
        !candidates.some((item) => item.chunkId === candidate.chunkId)
      )
        candidates.push(candidate);
      references.push({
        id: p.doi ?? p.pmid ?? p.pmcid ?? p.url,
        title: p.title,
        authors: p.authors,
        year: p.year ?? null,
        doi: p.doi ?? null,
        url: publicationUrl(p),
        dataProvider: p.provider,
        providerVersion:
          p.provider === "europe-pmc"
            ? EUROPE_PMC_PROVIDER_VERSION
            : CROSSREF_PROVIDER_VERSION,
        availability: candidate ? "open_access_full_text" : "metadata_only",
        licenseUrl: p.licenseUrl ?? null,
      });
    }
    if (references.length > candidates.length)
      warnings.push("metadata_only_publications_excluded");
    if (!candidates.length) {
      warnings.push("no_matching_evidence");
      if (references.length) warnings.push("no_reusable_full_text");
    }
    results.push({
      retrievalVersion: EVIDENCE_RETRIEVAL_VERSION,
      provider: "europe-pmc+crossref",
      model: "publication-search",
      filters: {
        sourceStatus: "active",
        language: null,
        sourceTypes: null,
        publishedAfter: null,
        publishedBefore: null,
        limit: 10,
      },
      candidates,
      references: references.slice(0, 20),
      warnings,
      externalSearchVersion: EXTERNAL_EVIDENCE_VERSION + ":" + provider.version,
    });
  }
  return results;
}
