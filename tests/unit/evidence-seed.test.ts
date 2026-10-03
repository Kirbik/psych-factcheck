// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evidenceSeedSchema,
  evidenceSeedV0,
  sha256,
  toImportRows,
} from "@/server/evidence/seed-v0";

describe("Evidence Base v0 seed", () => {
  it("contains traceable sources and licensed evidence chunks", () => {
    expect(evidenceSeedV0.sources).toHaveLength(21);
    expect(evidenceSeedV0.chunks).toHaveLength(33);
    expect(
      evidenceSeedV0.sources.find(
        (source) => source.doi === "10.1177/1948550619887702",
      ),
    ).toMatchObject({
      licenseCode: "CC-BY-NC-4.0",
      publishedAt: "2020-04-03",
    });
    expect(
      evidenceSeedV0.chunks.every((chunk) =>
        evidenceSeedV0.sources.some(
          (source) =>
            source.sourceKey === chunk.sourceKey &&
            (source.licenseCode === "CC-BY-4.0" ||
              source.licenseCode === "CC-BY-3.0" ||
              source.rightsPermission !== undefined),
        ),
      ),
    ).toBe(true);
    expect(
      evidenceSeedV0.sources.find(
        (source) => source.doi === "10.1186/s13643-021-01719-0",
      ),
    ).toMatchObject({
      sourceType: "meta_analysis",
      licenseCode: "CC-BY-4.0",
      topicTags: ["romantic_relationships", "couple_communication"],
    });
    expect(
      evidenceSeedV0.chunks.every((chunk) =>
        evidenceSeedV0.sources.some(
          (source) => source.sourceKey === chunk.sourceKey,
        ),
      ),
    ).toBe(true);
  });

  it("rejects duplicate identifiers, missing source links, and mismatched DOI keys", () => {
    const duplicateDoi = structuredClone(evidenceSeedV0);
    duplicateDoi.sources[1]!.doi = duplicateDoi.sources[0]!.doi;
    expect(evidenceSeedSchema.safeParse(duplicateDoi).success).toBe(false);

    const unknownSource = structuredClone(evidenceSeedV0);
    unknownSource.chunks[0]!.sourceKey = "doi:10.0000/missing";
    expect(evidenceSeedSchema.safeParse(unknownSource).success).toBe(false);

    const mismatchedKey = structuredClone(evidenceSeedV0);
    mismatchedKey.sources[0]!.sourceKey = "doi:10.0000/wrong";
    expect(evidenceSeedSchema.safeParse(mismatchedKey).success).toBe(false);

    const copyrightedChunk = structuredClone(evidenceSeedV0);
    copyrightedChunk.chunks[0]!.sourceKey = "isbn:5-88782-394-1";
    expect(evidenceSeedSchema.safeParse(copyrightedChunk).success).toBe(false);
  });

  it("keeps books metadata-only and records permission for restricted passages", () => {
    const rows = toImportRows(evidenceSeedV0);
    const books = rows.sources.filter((source) =>
      source.source_key.startsWith("isbn:"),
    );
    expect(books).toHaveLength(4);
    expect(books.every((source) => source.doi === null)).toBe(true);
    expect(
      rows.chunks.some((chunk) =>
        books.some((source) => source.source_key === chunk.source_key),
      ),
    ).toBe(false);
    const noncommercial = rows.sources.filter(
      (source) => source.license_code === "CC-BY-NC-4.0",
    );
    expect(noncommercial).toHaveLength(3);
    expect(
      noncommercial.filter((source) =>
        Object.hasOwn(source.provenance, "rights_permission"),
      ),
    ).toHaveLength(3);
    expect(
      rows.chunks.some(
        (chunk) => chunk.source_key === "doi:10.17759/sps.2021120109",
      ),
    ).toBe(true);
    expect(
      rows.chunks.some(
        (chunk) => chunk.source_key === "doi:10.17759/sps.2017080104",
      ),
    ).toBe(true);
    expect(
      rows.chunks.some(
        (chunk) => chunk.source_key === "doi:10.1177/1948550619887702",
      ),
    ).toBe(true);
    expect(
      rows.chunks.some(
        (chunk) => chunk.source_key === "doi:10.21638/spbu16.2024.107",
      ),
    ).toBe(true);
    expect(
      rows.sources.find(
        (source) => source.source_key === "doi:10.21638/spbu16.2024.107",
      ),
    ).toMatchObject({
      license_code: "ALL-RIGHTS-RESERVED",
      provenance: {
        chunks_permitted: true,
        rights_status: "permission_confirmed",
      },
    });
  });

  it("exports repeatable records with content hashes", () => {
    const rows = toImportRows(evidenceSeedV0);
    expect(rows.sources[0]).toMatchObject({
      source_key: evidenceSeedV0.sources[0]!.sourceKey,
      doi: evidenceSeedV0.sources[0]!.doi,
      license_code: "CC-BY-4.0",
    });
    expect(rows.chunks[0]!.content_sha256).toBe(
      sha256(rows.chunks[0]!.content),
    );
    expect(rows.chunks.map((chunk) => chunk.chunk_key)).toEqual(
      toImportRows(evidenceSeedV0).chunks.map((chunk) => chunk.chunk_key),
    );
  });
});
