import { describe, expect, it, vi } from "vitest";
import { createEvidenceSearchProvider } from "@/server/evidence/search-provider";

vi.mock("server-only", () => ({}));

const europeItem = {
  title: "A study of memory and stress",
  doi: "10.1234/example",
  pmcid: "PMC12345",
  pmid: "12345",
  authorString: "A. Author, B. Author",
  journalTitle: "Example Journal",
  pubYear: "2024",
  pubTypeList: { pubType: ["Journal Article"] },
  fullTextUrlList: {
    fullTextUrl: [
      {
        availability: "Open access",
        site: "Europe PMC",
        url: "https://europepmc.org/articles/PMC12345",
      },
    ],
  },
};
const crossrefItem = {
  DOI: "10.1234/example",
  title: ["A study of memory and stress"],
  author: [{ given: "A.", family: "Author" }],
  publisher: "Example Publisher",
  "container-title": ["Example Journal"],
  issued: { "date-parts": [[2024]] },
  license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }],
};

function fetcherFor(licenseUrl: string, onFetch = vi.fn()) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    onFetch(url);
    if (url.includes("europepmc/webservices/rest/search"))
      return Response.json({ resultList: { result: [europeItem] } });
    if (url.includes("api.crossref.org"))
      return Response.json({ message: { items: [crossrefItem] } });
    return new Response(
      `<article xml:lang="en"><license xlink:href="${licenseUrl}"/><p>${"Stress was associated with memory performance in this study. ".repeat(4)}</p></article>`,
      { headers: { "Content-Type": "application/xml" } },
    );
  }) as typeof fetch;
}

describe("Europe PMC and Crossref evidence search provider", () => {
  it("normalizes verified CC-BY OA metadata and returns only a bounded full-text excerpt", async () => {
    const fetcher = fetcherFor("https://creativecommons.org/licenses/by/4.0/");
    const provider = createEvidenceSearchProvider(fetcher);
    const results = await provider.search("stress and memory claim");

    expect(provider.version).toBe("evidence-search-v1");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      doi: "10.1234/example",
      pmcid: "PMC12345",
      title: "A study of memory and stress",
      authors: ["A. Author", "B. Author"],
      publisher: "Example Publisher",
      crossrefMatched: true,
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      provider: "europe-pmc",
    });
    expect(results[0]?.fullText?.length).toBeLessThanOrEqual(1_000);
    expect(results[0]?.fullText).toContain("Stress was associated");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not return full text with an unknown or non-reusable license", async () => {
    for (const license of [
      "https://creativecommons.org/licenses/by-nc/4.0/",
      "https://example.org/terms",
    ]) {
      const results = await createEvidenceSearchProvider(
        fetcherFor(license),
      ).search("claim");
      expect(results[0]).toMatchObject({ provider: "europe-pmc" });
      expect(results[0]?.fullText).toBeUndefined();
      expect(results[0]?.licenseUrl).toBe(license);
    }
  });

  it("rejects ambiguous full-text license declarations", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("europepmc/webservices/rest/search"))
        return Response.json({ resultList: { result: [europeItem] } });
      if (url.includes("api.crossref.org"))
        return Response.json({ message: { items: [crossrefItem] } });
      return new Response(
        `<article xml:lang="en"><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/><license xlink:href="https://creativecommons.org/licenses/by-nc/4.0/"/><p>${"Mixed rights terms in this paragraph. ".repeat(4)}</p></article>`,
      );
    }) as typeof fetch;
    const [record] =
      await createEvidenceSearchProvider(fetcher).search("claim");
    expect(record?.fullText).toBeUndefined();
  });

  it("keeps Crossref-only hits as metadata and links", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("europepmc/webservices/rest/search"))
        return Response.json({ resultList: { result: [] } });
      return Response.json({ message: { items: [crossrefItem] } });
    }) as typeof fetch;
    const [record] =
      await createEvidenceSearchProvider(fetcher).search("claim");
    expect(record).toMatchObject({
      doi: "10.1234/example",
      provider: "crossref",
      url: "https://doi.org/10.1234%2Fexample",
    });
    expect(record?.fullText).toBeUndefined();
  });

  it("does not classify an untyped Europe PMC record as a journal article", async () => {
    const preprint = { ...europeItem, pubTypeList: { pubType: ["Preprint"] } };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("europepmc/webservices/rest/search"))
        return Response.json({ resultList: { result: [preprint] } });
      if (url.includes("api.crossref.org"))
        return Response.json({ message: { items: [crossrefItem] } });
      return new Response(
        `<article xml:lang="en"><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/><p>${"Open access research passage. ".repeat(4)}</p></article>`,
      );
    }) as typeof fetch;
    const [record] =
      await createEvidenceSearchProvider(fetcher).search("claim");
    expect(record?.fullText).toBeUndefined();
    expect(record?.provider).toBe("europe-pmc");
  });

  it("maps timeouts and rate limits to retryable provider errors and handles empty results", async () => {
    const emptyFetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("europepmc/webservices/rest/search")
        ? Response.json({ resultList: { result: [] } })
        : Response.json({ message: { items: [] } }),
    ) as typeof fetch;
    await expect(
      createEvidenceSearchProvider(emptyFetcher).search("claim"),
    ).resolves.toEqual([]);

    const limitedFetcher = vi.fn(
      async () => new Response(null, { status: 429 }),
    ) as typeof fetch;
    await expect(
      createEvidenceSearchProvider(limitedFetcher).search("claim"),
    ).rejects.toMatchObject({
      code: "EVIDENCE_PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    const timeoutFetcher = vi.fn(async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    await expect(
      createEvidenceSearchProvider(timeoutFetcher).search("claim"),
    ).rejects.toMatchObject({
      code: "EVIDENCE_PROVIDER_TIMEOUT",
      retryable: true,
    });
  });
});
