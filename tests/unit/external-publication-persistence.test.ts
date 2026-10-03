import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { searchExternalPublications } from "@/server/evidence/external-publications";
import type { EvidenceSearchProvider } from "@/server/evidence/search-provider";

vi.mock("server-only", () => ({}));

function publication(licenseUrl: string, fullText?: string) {
  return {
    title: "Open access study",
    doi: "10.1234/open",
    pmcid: "PMC12345",
    pmid: "12345",
    authors: ["A. Author"],
    journal: "Example Journal",
    publisher: "Example Publisher",
    year: "2024",
    publicationType: "Journal Article",
    fullTextLanguage: "en",
    url: "https://doi.org/10.1234%2Fopen",
    licenseUrl,
    fullText,
    provider: "europe-pmc" as const,
  };
}

function provider(
  result: ReturnType<typeof publication>,
): EvidenceSearchProvider {
  return {
    version: "evidence-search-v1",
    async search() {
      return [result];
    },
  };
}

describe("external publication excerpt persistence", () => {
  it("does not persist article text when the license is unknown or non-reusable", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient<Database>;
    const found = await searchExternalPublications(
      client,
      provider(
        publication(
          "https://creativecommons.org/licenses/by-nc/4.0/",
          "Unlicensed full text that must not be stored.",
        ),
      ),
      ["claim"],
    );

    expect(from).not.toHaveBeenCalled();
    expect(found[0]).toMatchObject({
      candidates: [],
      metadataOnlyCount: 1,
      references: [
        {
          id: "10.1234/open",
          availability: "metadata_only",
          licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
        },
      ],
    });
  });

  it("stores only a bounded attributed excerpt for verified CC BY 4.0", async () => {
    const sourceQuery = {
      upsert: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    sourceQuery.upsert.mockReturnValue(sourceQuery);
    sourceQuery.select.mockReturnValue(sourceQuery);
    sourceQuery.maybeSingle.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        license_code: "CC-BY-4.0",
        license_url: "https://creativecommons.org/licenses/by/4.0/",
      },
      error: null,
    });
    const chunkQuery = {
      upsert: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chunkQuery.upsert.mockReturnValue(chunkQuery);
    chunkQuery.select.mockReturnValue(chunkQuery);
    chunkQuery.maybeSingle.mockResolvedValue({
      data: { id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    const client = {
      from: vi.fn((table: string) =>
        table === "sources" ? sourceQuery : chunkQuery,
      ),
    } as unknown as SupabaseClient<Database>;
    const text = `Verified text ${"evidence. ".repeat(200)}`;

    const [found] = await searchExternalPublications(
      client,
      provider(
        publication("https://creativecommons.org/licenses/by/4.0/", text),
      ),
      ["claim"],
    );

    expect(sourceQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        doi: "10.1234/open",
        license_code: "CC-BY-4.0",
        license_url: "https://creativecommons.org/licenses/by/4.0/",
      }),
      { onConflict: "source_key", ignoreDuplicates: true },
    );
    expect(chunkQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: text.trim().slice(0, 1_000),
        provenance: expect.objectContaining({ excerptLimitCharacters: 1_000 }),
      }),
      { onConflict: "source_id,chunk_key", ignoreDuplicates: true },
    );
    expect(found?.candidates[0]).toMatchObject({
      chunkId: "11111111-1111-4111-8111-111111111111",
      retrievalScoreKind: "provider_search_order",
      attribution: {
        providerVersion: "europe-pmc-v1",
        licenseCode: "CC-BY-4.0",
      },
    });
  });
});
