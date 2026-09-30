import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verdicts } from "../src/types/fact-check";
import { screeningReasonCodes } from "../src/server/ai/video-screening";

const verdictSchema = z.enum(verdicts);

const fixtureSchema = z.array(
  z.object({
    id: z.string().min(1),
    claim: z.string().min(1),
    expectedVerdicts: z.array(verdictSchema).min(1),
    forbiddenVerdicts: z.array(verdictSchema),
    synthetic: z.literal(true),
  }),
);

const screeningFixtureSchema = z.array(
  z.object({
    id: z.string().min(1),
    sampleText: z.string().min(1),
    expectedDecision: z.enum(["relevant", "unrelated", "uncertain"]),
    expectedReasonCode: z.enum(screeningReasonCodes),
    expectedDisposition: z.enum(["skip_transcription", "continue_transcription"]),
    failureMode: z.enum(["false_positive", "false_negative_guard", "true_positive"]),
    synthetic: z.literal(true),
  }).strict(),
);

describe("synthetic eval fixtures", () => {
  it("have the documented shape", () => {
    const fixtureUrl = new URL(
      "./fixtures/synthetic-cases.json",
      import.meta.url,
    );
    const fixtures: unknown = JSON.parse(
      readFileSync(fileURLToPath(fixtureUrl), "utf8"),
    );

    expect(fixtureSchema.parse(fixtures)).toHaveLength(1);
  });

  it("rejects verdicts outside the documented taxonomy", () => {
    expect(
      fixtureSchema.safeParse([
        {
          id: "invalid-verdict",
          claim: "A synthetic claim",
          expectedVerdicts: ["UNKNOWN"],
          forbiddenVerdicts: [],
          synthetic: true,
        },
      ]).success,
    ).toBe(false);
  });

  it("documents synthetic false-positive and false-negative screening cases", () => {
    const fixtureUrl = new URL(
      "./fixtures/video-screening-cases.json",
      import.meta.url,
    );
    const fixtures: unknown = JSON.parse(
      readFileSync(fileURLToPath(fixtureUrl), "utf8"),
    );

    expect(screeningFixtureSchema.parse(fixtures)).toHaveLength(3);
    expect(screeningFixtureSchema.parse(fixtures).map((item) => item.failureMode)).toEqual([
      "false_positive",
      "false_negative_guard",
      "true_positive",
    ]);
  });
});
