import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sha256 } from "./seed-v0";
import type { EvidenceCandidate } from "./search";
import type {
  EvidenceSearchProvider,
  SearchedPublication,
} from "./search-provider";
import type { PublicationReference } from "@/server/ai/providers";
import {
  EvidenceSearchError,
  EVIDENCE_RETRIEVAL_VERSION,
  type EvidenceSearchResult,
} from "./search";
import { EmbeddingProviderError } from "@/server/ai/openai-embedding-provider";
import { EvidenceSearchProviderError } from "./search-provider";

export const EXTERNAL_EVIDENCE_VERSION = "external-evidence-v1";
const REUSABLE_LICENSE = "https://creativecommons.org/licenses/by/4.0/";

export interface PublicationAttribution {
  readonly dataProvider: "europe-pmc";
  readonly providerVersion: string;
  readonly externalId: string;
  readonly availability: "open_access_full_text";
  readonly licenseCode: "CC-BY-4.0";
  readonly licenseUrl: string;
}

export interface ExternalEvidenceSearchResult {
  readonly candidates: readonly EvidenceCandidate[];
  readonly references: readonly PublicationReference[];
  readonly metadataOnlyCount: number;
  readonly trace: {
    readonly searchVersion: string;
    readonly providers: readonly string[];
  };
}

function sourceKey(publication: SearchedPublication) {
  return publication.doi
    ? `doi:${publication.doi.toLowerCase()}`
    : `europe-pmc:${publication.pmcid ?? publication.pmid}`;
}

function publicationUrl(publication: SearchedPublication) {
  return publication.doi
    ? `https://doi.org/${encodeURIComponent(publication.doi)}`
    : publication.url;
}

function isReusableFullText(publication: SearchedPublication) {
  return (
    publication.provider === "europe-pmc" &&
    publication.pmcid !== undefined &&
    publication.fullText !== undefined &&
    publication.licenseUrl === REUSABLE_LICENSE &&
    publication.authors.length > 0 &&
    publication.publisher.length > 0 &&
    publication.year !== undefined &&
    publication.fullTextLanguage !== undefined &&
    [
      "journal article",
      "research article",
      "review",
      "systematic review",
      "meta-analysis",
    ].includes(publication.publicationType?.toLocaleLowerCase() ?? "")
  );
}

function sourceType(publication: SearchedPublication) {
  switch (publication.publicationType?.toLocaleLowerCase()) {
    case "systematic review":
      return "systematic_review" as const;
    case "meta-analysis":
      return "meta_analysis" as const;
    default:
      return "journal_article" as const;
  }
}

async function storeLicensedExcerpt(
  client: SupabaseClient<Database>,
  publication: SearchedPublication,
  resultOrder: number,
) {
  if (!isReusableFullText(publication)) return null;
  const key = sourceKey(publication);
  const publishedAt = `${publication.year}-01-01`;
  const { data: source, error: sourceError } = await client
    .from("sources")
    .upsert(
      {
        source_key: key,
        title: publication.title,
        authors: [...publication.authors],
        journal: publication.journal || "",
        publisher: publication.publisher,
        published_at: publishedAt,
        doi: publication.doi ?? null,
        canonical_url: publicationUrl(publication),
        source_type: sourceType(publication),
        status: "active",
        license_code: "CC-BY-4.0",
        license_url: REUSABLE_LICENSE,
        provenance: {
          provider: "europe-pmc",
          providerVersion: "europe-pmc-v1",
          externalId: publication.pmcid,
          availability: "open_access_full_text",
          publicationYearPrecision: "year",
          crossrefMatched: publication.crossrefMatched ?? false,
        },
      },
      { onConflict: "source_key", ignoreDuplicates: true },
    )
    .select("id, license_code, license_url")
    .maybeSingle();
  if (sourceError) throw new Error("External source persistence failed");
  const sourceRecord =
    source ??
    (
      await client
        .from("sources")
        .select("id, license_code, license_url")
        .eq("source_key", key)
        .maybeSingle()
    ).data;
  if (
    !sourceRecord ||
    sourceRecord.license_code !== "CC-BY-4.0" ||
    sourceRecord.license_url !== REUSABLE_LICENSE
  )
    return null;

  const content = publication.fullText!.trim().slice(0, 1_000);
  if (content.length < 40) return null;
  const { data: chunk, error: chunkError } = await client
    .from("evidence_chunks")
    .upsert(
      {
        source_id: sourceRecord.id,
        chunk_key: "oa-search-excerpt-1",
        content,
        locator: "Europe PMC OA full text, extracted paragraph",
        language: publication.fullTextLanguage!,
        content_sha256: sha256(content),
        provenance: {
          provider: "europe-pmc",
          externalId: publication.pmcid,
          licenseUrl: REUSABLE_LICENSE,
          excerptLimitCharacters: 1_000,
          retention: "minimum-audit-excerpt",
        },
      },
      { onConflict: "source_id,chunk_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (chunkError) throw new Error("External excerpt persistence failed");
  const chunkRecord =
    chunk ??
    (
      await client
        .from("evidence_chunks")
        .select("id")
        .eq("source_id", sourceRecord.id)
        .eq("chunk_key", "oa-search-excerpt-1")
        .maybeSingle()
    ).data;
  if (!chunkRecord) throw new Error("External excerpt persistence failed");

  const year = publication.year!;
  const candidate: EvidenceCandidate = {
    chunkId: chunkRecord.id,
    sourceId: sourceRecord.id,
    chunkKey: "oa-search-excerpt-1",
    content,
    language: publication.fullTextLanguage!,
    locator: "Europe PMC OA full text, extracted paragraph",
    source: {
      key,
      title: publication.title,
      authors: [...publication.authors],
      journal: publication.journal,
      publishedAt: publishedAt,
      type: sourceType(publication),
      canonicalUrl: publicationUrl(publication),
    },
    similarity: Math.max(0, 1 - resultOrder * 0.05),
    retrievalScoreKind: "provider_search_order",
  };
  return {
    ...candidate,
    attribution: {
      dataProvider: "europe-pmc" as const,
      providerVersion: "europe-pmc-v1",
      externalId: publication.pmcid!,
      availability: "open_access_full_text" as const,
      licenseCode: "CC-BY-4.0" as const,
      licenseUrl: REUSABLE_LICENSE,
    },
    publishedYear: year,
  };
}

export async function searchExternalPublications(
  client: SupabaseClient<Database>,
  provider: EvidenceSearchProvider,
  claims: readonly string[],
): Promise<readonly ExternalEvidenceSearchResult[]> {
  const results: ExternalEvidenceSearchResult[] = [];
  for (const claim of claims) {
    const publications = await provider.search(claim);
    const candidates = [];
    const references: PublicationReference[] = publications.map(
      (publication) => ({
        id:
          publication.doi ??
          publication.pmid ??
          publication.pmcid ??
          publication.url,
        title: publication.title,
        authors: publication.authors,
        year: publication.year ?? null,
        doi: publication.doi ?? null,
        url: publicationUrl(publication),
        dataProvider: publication.provider,
        providerVersion:
          publication.provider === "europe-pmc"
            ? "europe-pmc-v1"
            : "crossref-v1",
        availability: isReusableFullText(publication)
          ? "open_access_full_text"
          : "metadata_only",
        licenseUrl: publication.licenseUrl ?? null,
      }),
    );
    let metadataOnlyCount = 0;
    for (const [resultOrder, publication] of publications.entries()) {
      if (!isReusableFullText(publication)) {
        metadataOnlyCount += 1;
        continue;
      }
      const candidate = await storeLicensedExcerpt(
        client,
        publication,
        resultOrder,
      );
      if (candidate) candidates.push(candidate);
      else metadataOnlyCount += 1;
    }
    results.push({
      candidates,
      references,
      metadataOnlyCount,
      trace: {
        searchVersion: EXTERNAL_EVIDENCE_VERSION,
        providers: ["europe-pmc", "crossref"],
      },
    });
  }
  return results;
}

export async function searchEvidenceWithProviders(
  claims: readonly string[],
  localSearch: () => Promise<readonly EvidenceSearchResult[]>,
  externalSearch: () => Promise<readonly ExternalEvidenceSearchResult[]>,
): Promise<
  readonly (EvidenceSearchResult & {
    readonly references: readonly PublicationReference[];
    readonly externalSearchVersion: string;
  })[]
> {
  let local: readonly EvidenceSearchResult[];
  try {
    local = await localSearch();
  } catch (error) {
    if (!(
      error instanceof EvidenceSearchError ||
      error instanceof EmbeddingProviderError
    ))
      throw error;
    local = claims.map(() => ({
      retrievalVersion: EVIDENCE_RETRIEVAL_VERSION,
      provider: "unavailable",
      model: "unavailable",
      embeddingVersion: "unavailable",
      filters: {
        sourceStatus: "active" as const,
        language: null,
        sourceTypes: null,
        publishedAfter: null,
        publishedBefore: null,
        limit: 10,
      },
      candidates: [],
      warnings: ["local_retrieval_unavailable"],
    }));
  }

  let remote: readonly ExternalEvidenceSearchResult[];
  try {
    remote = await externalSearch();
  } catch (error) {
    if (!(error instanceof EvidenceSearchProviderError)) throw error;
    return local.map((result) => ({
      ...result,
      warnings: [...result.warnings, "external_search_unavailable"],
      references: [],
      externalSearchVersion: EXTERNAL_EVIDENCE_VERSION,
    }));
  }

  return local.map((result, index) => {
    const external = remote[index];
    if (!external)
      return {
        ...result,
        references: [],
        externalSearchVersion: EXTERNAL_EVIDENCE_VERSION,
      };
    const warnings = [...result.warnings];
    if (external.metadataOnlyCount > 0)
      warnings.push("metadata_only_publications_excluded");
    if (external.candidates.length === 0 && external.references.length > 0)
      warnings.push("no_reusable_full_text");
    return {
      ...result,
      candidates: [...result.candidates, ...external.candidates],
      warnings,
      references: external.references,
      externalSearchVersion: external.trace.searchVersion,
    };
  });
}
