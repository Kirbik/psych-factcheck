import { describe, expect, it, vi } from "vitest";
import {
  EvidenceSearchError,
  type EvidenceSearchResult,
} from "@/server/evidence/search";
import { EvidenceSearchProviderError } from "@/server/evidence/search-provider";
import {
  searchEvidenceWithProviders,
  type ExternalEvidenceSearchResult,
} from "@/server/evidence/external-publications";

vi.mock("server-only", () => ({}));

const localResult: EvidenceSearchResult = {
  retrievalVersion: "evidence-retrieval-v2",
  provider: "openai",
  model: "text-embedding-3-small",
  embeddingVersion: "embedding-v1",
  filters: {
    sourceStatus: "active",
    language: null,
    sourceTypes: null,
    publishedAfter: null,
    publishedBefore: null,
    limit: 10,
  },
  candidates: [],
  warnings: ["no_matching_evidence"],
};

const metadataOnlyResult: ExternalEvidenceSearchResult = {
  candidates: [],
  metadataOnlyCount: 1,
  references: [
    {
      id: "10.1234/example",
      title: "Metadata only result",
      authors: ["A. Author"],
      year: "2024",
      doi: "10.1234/example",
      url: "https://doi.org/10.1234%2Fexample",
      dataProvider: "crossref",
      providerVersion: "crossref-v1",
      availability: "metadata_only",
      licenseUrl: null,
    },
  ],
  trace: { searchVersion: "external-evidence-v1", providers: ["crossref"] },
};

describe("optional live publication retrieval", () => {
  it("continues with live metadata when local RAG is unavailable", async () => {
    const results = await searchEvidenceWithProviders(
      ["claim"],
      async () => {
        throw new EvidenceSearchError("EVIDENCE_SEARCH_FAILED");
      },
      async () => [metadataOnlyResult],
    );

    expect(results[0]).toMatchObject({
      provider: "unavailable",
      candidates: [],
      references: [{ availability: "metadata_only", doi: "10.1234/example" }],
      warnings: [
        "local_retrieval_unavailable",
        "metadata_only_publications_excluded",
        "no_reusable_full_text",
      ],
      externalSearchVersion: "external-evidence-v1",
    });
  });

  it("keeps local results when public APIs time out or rate limit", async () => {
    const externalSearch = vi.fn(async () => {
      throw new EvidenceSearchProviderError(
        "EVIDENCE_PROVIDER_UNAVAILABLE",
        true,
      );
    });
    const [result] = await searchEvidenceWithProviders(
      ["claim"],
      async () => [localResult],
      externalSearch,
    );

    expect(result).toMatchObject({
      provider: "openai",
      candidates: [],
      warnings: ["no_matching_evidence", "external_search_unavailable"],
      references: [],
    });
  });
});
