// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evidenceSeedSchema,
  evidenceSeedV0,
  sha256,
  toImportRows,
} from "@/server/evidence/seed-v0";

describe("Evidence Base v0 seed", () => {
  it("contains ten traceable sources and twenty-three linked licensed chunks", () => {
    expect(evidenceSeedV0.sources).toHaveLength(10);
    expect(evidenceSeedV0.chunks).toHaveLength(23);
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
            source.licenseCode.startsWith("CC-BY-") &&
            source.licenseCode !== "CC-BY-NC-4.0",
        ),
      ),
    ).toBe(true);
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
