import "server-only";

import { z } from "zod";

export const EVIDENCE_SEARCH_PROVIDER_VERSION = "evidence-search-v1";
export const EUROPE_PMC_PROVIDER_VERSION = "europe-pmc-v1";
export const CROSSREF_PROVIDER_VERSION = "crossref-v1";

const articleSchema = z.object({
  title: z.string().trim().min(1).max(1_000),
  doi: z.string().trim().min(1).max(255).optional(),
  pmid: z.string().trim().min(1).max(40).optional(),
  pmcid: z.string().trim().min(1).max(40).optional(),
  authors: z.array(z.string().trim().min(1).max(300)).max(100),
  journal: z.string().trim().max(300),
  publisher: z.string().trim().max(200),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  publicationType: z.string().trim().max(100).optional(),
  crossrefMatched: z.boolean().optional(),
  url: z.url().refine((value) => value.startsWith("https://")),
  licenseUrl: z.url().optional(),
  fullTextUrl: z.url().optional(),
  fullText: z.string().max(100_000).optional(),
  fullTextLanguage: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  provider: z.enum(["europe-pmc", "crossref"]),
});

export type SearchedPublication = z.infer<typeof articleSchema>;

export interface EvidenceSearchProvider {
  readonly version: string;
  search(query: string): Promise<readonly SearchedPublication[]>;
}

export class EvidenceSearchProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EvidenceSearchProviderError";
  }
}

const europeResponseSchema = z.object({
  resultList: z.object({
    result: z.array(z.record(z.string(), z.unknown())).max(25),
  }),
});
const crossrefResponseSchema = z.object({
  message: z.object({
    items: z.array(z.record(z.string(), z.unknown())).max(25),
  }),
});

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function paragraphExcerpt(xml: string) {
  const paragraphs = [...xml.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((match) =>
      decodeXml(match[1]!.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((paragraph) => paragraph.length >= 80 && paragraph.length <= 4_000);
  return paragraphs[0]?.slice(0, 1_000);
}

async function request(
  fetcher: typeof fetch,
  url: string,
  accept = "application/json",
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: accept, "User-Agent": "psych-factcheck/0.1" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new EvidenceSearchProviderError("EVIDENCE_PROVIDER_TIMEOUT", true);
  }
  if (
    response.status === 429 ||
    response.status === 408 ||
    response.status >= 500
  )
    throw new EvidenceSearchProviderError(
      "EVIDENCE_PROVIDER_UNAVAILABLE",
      true,
    );
  if (!response.ok)
    throw new EvidenceSearchProviderError("EVIDENCE_PROVIDER_REJECTED", false);
  return response;
}

function normalizeEuropeArticle(raw: Record<string, unknown>) {
  const title = text(raw.title);
  const doi = text(raw.doi)?.toLowerCase();
  const pmcid = text(raw.pmcid);
  const pmid = text(raw.pmid);
  const year = text(raw.firstPublicationDate)?.slice(0, 4) ?? text(raw.pubYear);
  const authorString = text(raw.authorString);
  const publicationTypeRaw = raw.pubTypeList as
    { pubType?: unknown[] } | undefined;
  const publicationType = publicationTypeRaw?.pubType
    ?.map(text)
    .find((value): value is string => Boolean(value));
  const authors = authorString
    ? authorString
        .split(/,\s*/)
        .map((author) => author.trim())
        .filter(Boolean)
    : [];
  if (!title || (!doi && !pmid && !pmcid) || !year) return null;
  const link = (
    raw.fullTextUrlList as
      { fullTextUrl?: Array<Record<string, unknown>> } | undefined
  )?.fullTextUrl?.find(
    (item) => item.availability === "Open access" && item.site === "Europe PMC",
  )?.url;
  return {
    title,
    doi,
    pmid,
    pmcid,
    authors,
    journal: text(raw.journalTitle) ?? "",
    publisher: "",
    year,
    publicationType,
    url: doi
      ? `https://doi.org/${encodeURIComponent(doi)}`
      : `https://europepmc.org/article/MED/${pmid ?? pmcid}`,
    fullTextUrl: typeof link === "string" ? link : undefined,
    provider: "europe-pmc" as const,
  };
}

function normalizeCrossrefArticle(raw: Record<string, unknown>) {
  const title = Array.isArray(raw.title) ? text(raw.title[0]) : undefined;
  const doi = text(raw.DOI)?.toLowerCase();
  const authors = Array.isArray(raw.author)
    ? raw.author
        .slice(0, 100)
        .map((entry) => {
          const author = entry as Record<string, unknown>;
          return [text(author.given), text(author.family)]
            .filter(Boolean)
            .join(" ");
        })
        .filter(Boolean)
    : [];
  const issued = raw.issued as { "date-parts"?: unknown[][] } | undefined;
  const yearValue = issued?.["date-parts"]?.[0]?.[0];
  const year = typeof yearValue === "number" ? String(yearValue) : undefined;
  if (!title || !doi || !year) return null;
  const license = Array.isArray(raw.license)
    ? raw.license
        .map((item) => (item as Record<string, unknown>).URL)
        .find((item) => typeof item === "string")
    : undefined;
  return {
    title,
    doi,
    authors,
    journal: Array.isArray(raw["container-title"])
      ? (text(raw["container-title"][0]) ?? "")
      : "",
    publisher: text(raw.publisher) ?? "",
    year,
    url: `https://doi.org/${encodeURIComponent(doi)}`,
    licenseUrl: typeof license === "string" ? license : undefined,
    provider: "crossref" as const,
  };
}

export function createEvidenceSearchProvider(
  fetcher: typeof fetch = fetch,
): EvidenceSearchProvider {
  return {
    version: EVIDENCE_SEARCH_PROVIDER_VERSION,
    async search(query) {
      if (!query.trim() || query.length > 1_200)
        throw new EvidenceSearchProviderError(
          "EVIDENCE_SEARCH_INPUT_INVALID",
          false,
        );
      const encoded = encodeURIComponent(query);
      const europeUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encoded}&format=json&pageSize=10&resultType=core`;
      const crossrefUrl = `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=10`;
      const [europeResponse, crossrefResponse] = await Promise.all([
        request(fetcher, europeUrl),
        request(fetcher, crossrefUrl),
      ]);
      let europeRaw: unknown;
      let crossrefRaw: unknown;
      try {
        [europeRaw, crossrefRaw] = await Promise.all([
          europeResponse.json(),
          crossrefResponse.json(),
        ]);
      } catch {
        throw new EvidenceSearchProviderError(
          "EVIDENCE_PROVIDER_RESPONSE_INVALID",
          false,
        );
      }
      const europe = europeResponseSchema.safeParse(europeRaw);
      const crossref = crossrefResponseSchema.safeParse(crossrefRaw);
      if (!europe.success || !crossref.success)
        throw new EvidenceSearchProviderError(
          "EVIDENCE_PROVIDER_RESPONSE_INVALID",
          false,
        );

      const crossrefByDoi = new Map<
        string,
        ReturnType<typeof normalizeCrossrefArticle>
      >();
      for (const row of crossref.data.message.items) {
        const article = normalizeCrossrefArticle(row);
        if (article) crossrefByDoi.set(article.doi!, article);
      }
      const normalized: SearchedPublication[] = [];
      for (const row of europe.data.resultList.result.slice(0, 5)) {
        const article = normalizeEuropeArticle(row);
        if (!article) continue;
        const crossrefRecord = article.doi
          ? crossrefByDoi.get(article.doi)
          : undefined;
        let fullText: string | undefined;
        let fullTextLanguage: string | undefined;
        let licenseUrl: string | undefined;
        if (article.pmcid && article.fullTextUrl) {
          const xmlUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(article.pmcid)}/fullTextXML`;
          const xmlResponse = await request(fetcher, xmlUrl, "application/xml");
          const xml = await xmlResponse.text();
          const articleLicenses = [
            ...xml.matchAll(
              /<license\b[^>]*(?:xlink:)?href=["']([^"']+)["'][^>]*>/gi,
            ),
          ].map((match) => match[1]!);
          const uniqueLicenses = [...new Set(articleLicenses)];
          licenseUrl =
            uniqueLicenses.length === 1 ? uniqueLicenses[0] : undefined;
          if (
            licenseUrl === "https://creativecommons.org/licenses/by/4.0/" ||
            licenseUrl === "http://creativecommons.org/licenses/by/4.0/"
          ) {
            if (
              [
                "journal article",
                "research article",
                "review",
                "systematic review",
                "meta-analysis",
              ].includes(article.publicationType?.toLocaleLowerCase() ?? "")
            ) {
              fullText = paragraphExcerpt(xml);
              fullTextLanguage = xml.match(
                /<article\b[^>]*\bxml:lang=["']([a-z]{2}(?:-[A-Z]{2})?)["']/i,
              )?.[1];
            }
          }
        }
        const merged = {
          ...article,
          authors: article.authors.length
            ? article.authors
            : (crossrefRecord?.authors ?? []),
          journal: article.journal || crossrefRecord?.journal || "",
          publisher: crossrefRecord?.publisher || article.publisher,
          licenseUrl: licenseUrl ?? crossrefRecord?.licenseUrl,
          fullText,
          fullTextLanguage,
          crossrefMatched: Boolean(crossrefRecord),
        };
        const parsed = articleSchema.safeParse(merged);
        if (parsed.success) normalized.push(parsed.data);
      }
      for (const article of crossrefByDoi.values()) {
        if (!article || normalized.some((item) => item.doi === article.doi))
          continue;
        const parsed = articleSchema.safeParse(article);
        if (parsed.success) normalized.push(parsed.data);
      }
      return normalized.slice(0, 20);
    },
  };
}
