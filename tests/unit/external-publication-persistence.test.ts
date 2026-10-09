import { describe, expect, it, vi } from "vitest";
import { searchExternalPublications } from "@/server/evidence/external-publications";
import { buildEvidencePackage } from "@/server/evidence/reranking";
vi.mock("server-only", () => ({}));
describe("publication snapshot audit storage", () => {
  it("persists only bounded metadata when no reusable text is available", async () => {
    const [search] = await searchExternalPublications(
      {
        version: "mock-v1",
        async search() {
          return [
            {
              title: "Metadata-only study",
              authors: ["Author"],
              journal: "Journal",
              publisher: "Publisher",
              year: "2024",
              doi: "10.0000/meta",
              url: "https://doi.org/10.0000/meta",
              fullText: "Text that must not be retained",
              provider: "crossref",
            },
          ];
        },
      },
      ["Claim"],
    );
    const pkg = await buildEvidencePackage(
      {
        original: "Claim",
        normalized: "Claim",
        startSeconds: 0,
        endSeconds: 1,
        claimType: "causal_mechanistic",
      },
      search,
    );
    expect(pkg.evidence).toEqual([]);
    expect(JSON.stringify(pkg)).not.toContain("Text that must not be retained");
    expect(pkg.references?.[0]).toMatchObject({
      doi: "10.0000/meta",
      availability: "metadata_only",
      dataProvider: "crossref",
    });
  });
});
