import { describe, expect, it, vi } from "vitest";
import { searchExternalPublications } from "@/server/evidence/external-publications";
import {
  EvidenceSearchProviderError,
  type EvidenceSearchProvider,
  type SearchedPublication,
} from "@/server/evidence/search-provider";
import { buildEvidencePackage } from "@/server/evidence/reranking";
import {
  validateEvidencePackage,
  validateEvidenceBoundJudgment,
} from "@/server/ai/judgment";
vi.mock("server-only", () => ({}));
const license = "https://creativecommons.org/licenses/by/4.0/";
const claim = {
  original: "Sleep affects memory.",
  normalized: "Sleep affects memory.",
  startSeconds: 0,
  endSeconds: 3,
  claimType: "causal_mechanistic" as const,
};
export const publication: SearchedPublication = {
  title: "Synthetic sleep study",
  doi: "10.0000/mock",
  pmcid: "PMC12345",
  authors: ["Mock Author"],
  journal: "Mock Journal",
  publisher: "Mock Publisher",
  year: "2024",
  publicationType: "Journal Article",
  fullTextLanguage: "en",
  url: "https://europepmc.org/articles/PMC12345",
  licenseUrl: license,
  fullText:
    "Sleep was associated with memory performance in this synthetic fixture. ".repeat(
      40,
    ),
  provider: "europe-pmc",
};
const provider = (
  search: EvidenceSearchProvider["search"],
): EvidenceSearchProvider => ({ version: "mock-scientific-v1", search });
describe("publication search without a local database", () => {
  it("creates stable bounded licensed snapshots without storing a catalog or embedding queries", async () => {
    const search = vi.fn(async () => [publication]);
    const first = await searchExternalPublications(provider(search), [
      claim.normalized,
    ]);
    const again = await searchExternalPublications(provider(search), [
      claim.normalized,
    ]);
    expect(first).toEqual(again);
    expect(first[0].candidates[0].content).toHaveLength(1000);
    expect(first[0].candidates[0].source).toMatchObject({
      doi: publication.doi,
      publisher: publication.publisher,
      licenseCode: "CC-BY-4.0",
      licenseUrl: license,
    });
    const pkg = validateEvidencePackage(
      await buildEvidencePackage(claim, first[0]),
    );
    expect(pkg).toMatchObject({
      schemaVersion: "evidence-package-v2",
      retrievalVersion: "publication-search-v1",
      rerankingVersion: "evidence-reranking-v2",
    });
    expect(pkg.trace.retrieval).not.toHaveProperty("embeddingVersion");
    expect(pkg.trace.externalSearchVersion).toBe(
      "external-evidence-v2:mock-scientific-v1",
    );
    expect(pkg.evidence[0].text).toHaveLength(1000);
  });
  it.each([undefined, "https://creativecommons.org/licenses/by-nc/4.0/"])(
    "excludes full text with unsuitable license %s",
    async (licenseUrl) => {
      const [result] = await searchExternalPublications(
        provider(async () => [{ ...publication, licenseUrl }]),
        [claim.normalized],
      );
      expect(result.candidates).toEqual([]);
      expect(result.references?.[0].availability).toBe("metadata_only");
      expect(JSON.stringify(result)).not.toContain(publication.fullText!);
    },
  );
  it("never treats Crossref article text as evidence even with a license link", async () => {
    const [result] = await searchExternalPublications(
      provider(async () => [{ ...publication, provider: "crossref" }]),
      [claim.normalized],
    );
    expect(result.candidates).toEqual([]);
    expect(result.references?.[0].dataProvider).toBe("crossref");
  });
  it.each([
    "EVIDENCE_PROVIDER_TIMEOUT",
    "EVIDENCE_PROVIDER_RATE_LIMITED",
    "EVIDENCE_PROVIDER_UNAVAILABLE",
  ])("returns an auditable empty package for %s", async (code) => {
    const [result] = await searchExternalPublications(
      provider(async () => {
        throw new EvidenceSearchProviderError(code, true);
      }),
      [claim.normalized],
    );
    expect(result.warnings).toContain(code);
    const pkg = validateEvidencePackage(
      await buildEvidencePackage(claim, result),
    );
    expect(pkg.coverage).toBe("none");
    expect(() =>
      validateEvidenceBoundJudgment(pkg, {
        verdict: "CONTRADICTED",
        confidence: 0.8,
        explanation: "No paper found.",
        limitations: [],
        citations: [],
      }),
    ).toThrow();
  });
  it("handles an empty API response without inferring a verdict", async () => {
    const [result] = await searchExternalPublications(
      provider(async () => []),
      [claim.normalized],
    );
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain("no_matching_evidence");
  });
  it("changes the excerpt ID when content changes while preserving source identity", async () => {
    const [a] = await searchExternalPublications(
      provider(async () => [publication]),
      [claim.normalized],
    );
    const [b] = await searchExternalPublications(
      provider(async () => [
        {
          ...publication,
          fullText:
            "Different licensed evidence passage from the same publication.",
        },
      ]),
      [claim.normalized],
    );
    expect(a.candidates[0].sourceId).toBe(b.candidates[0].sourceId);
    expect(a.candidates[0].chunkId).not.toBe(b.candidates[0].chunkId);
  });
  it("rejects a publication package whose approved attribution has been removed", async () => {
    const [result] = await searchExternalPublications(
      provider(async () => [publication]),
      [claim.normalized],
    );
    const pkg = await buildEvidencePackage(claim, result);
    expect(() =>
      validateEvidencePackage({
        ...pkg,
        evidence: pkg.evidence.map((item) => ({
          ...item,
          attribution: undefined,
        })),
      }),
    ).toThrow();
  });
  it("preserves independent excerpts so contradictory judgments require actual citations", async () => {
    const [result] = await searchExternalPublications(
      provider(async () => [
        publication,
        {
          ...publication,
          doi: "10.0000/other",
          pmcid: "PMC56789",
          fullText:
            "The other synthetic study reports a contradictory result about sleep and memory.",
        },
      ]),
      [claim.normalized],
    );
    const pkg = validateEvidencePackage(
      await buildEvidencePackage(claim, result),
    );
    expect(pkg.coverage).toBe("multi_source");
    expect(
      validateEvidenceBoundJudgment(pkg, {
        verdict: "OVERSIMPLIFIED",
        confidence: 0.5,
        explanation: "Synthetic studies disagree.",
        limitations: ["Mock evidence only."],
        citations: pkg.evidence.map((item, i) => ({
          chunkId: item.chunkId,
          relation: i ? "contradicts" : "supports",
          rationale: "Received fixture passage.",
        })),
      }).judgment.verdict,
    ).toBe("OVERSIMPLIFIED");
  });
});
