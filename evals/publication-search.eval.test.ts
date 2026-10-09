import { describe, expect, it, vi } from "vitest";
import { searchExternalPublications } from "../src/server/evidence/external-publications";
import { buildEvidencePackage } from "../src/server/evidence/reranking";
import {
  validateEvidencePackage,
  validateEvidenceBoundJudgment,
} from "../src/server/ai/judgment";
vi.mock("server-only", () => ({}));
const claim = {
  original: "Sleep affects memory.",
  normalized: "Sleep affects memory.",
  startSeconds: 0,
  endSeconds: 3,
  claimType: "causal_mechanistic" as const,
};
// Synthetic contract cases: neither relevance labels nor verdict-quality ground truth.
describe("publication-search contract v1", () => {
  it.each([
    null,
    "https://creativecommons.org/licenses/by-nc/4.0/",
    "https://creativecommons.org/licenses/by/4.0/",
  ])(
    "gates audit retention on approved publication rights: %s",
    async (license) => {
      const [search] = await searchExternalPublications(
        {
          version: "eval-fixture-v1",
          async search() {
            return [
              {
                provider: "europe-pmc",
                title: "Synthetic study",
                doi: "10.0000/eval",
                pmcid: "PMC10000",
                authors: ["Mock Author"],
                journal: "Mock Journal",
                publisher: "Mock Publisher",
                year: "2024",
                publicationType: "Journal Article",
                url: "https://europepmc.org/articles/PMC10000",
                fullTextLanguage: "en",
                licenseUrl: license ?? undefined,
                fullText:
                  "Sleep affected memory in this synthetic contract fixture.",
              },
            ];
          },
        },
        [claim.normalized],
      );
      const pkg = validateEvidencePackage(
        await buildEvidencePackage(claim, search),
      );
      expect(pkg.evidence).toHaveLength(license?.includes("/by/") ? 1 : 0);
      expect(() =>
        validateEvidenceBoundJudgment(pkg, {
          verdict: "SUPPORTED",
          confidence: 0.7,
          explanation: "Unsupported output.",
          limitations: [],
          citations: [
            {
              chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              relation: "supports",
              rationale: "Fabricated ID.",
            },
          ],
        }),
      ).toThrow();
      if (pkg.evidence.length === 0) {
        expect(
          validateEvidenceBoundJudgment(pkg, {
            verdict: "INSUFFICIENT_EVIDENCE",
            confidence: 0.4,
            explanation: "No usable passage.",
            limitations: ["Coverage limited."],
            citations: [],
          }).judgment.verdict,
        ).toBe("INSUFFICIENT_EVIDENCE");
      }
    },
  );
});
