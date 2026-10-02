import { z } from "zod";
import {
  claimTypes,
  type ClaimExtractionResult,
  type TranscriptSegment,
} from "./providers";
import { CLAIM_EXTRACTION_INSTRUCTIONS_VERSION } from "./prompts/claim-extraction-v2";

export const CLAIM_EXTRACTION_VERSION = "claim-extraction-v1";
export const CLAIM_EXTRACTION_SCHEMA_VERSION = "claim-extraction-schema-v1";
export const CLAIM_EXTRACTION_MODEL = "gpt-4o-mini";
export const MAX_CLAIM_TRANSCRIPT_CHARACTERS = 100_000;
export const claimTypeSchema = z.enum(claimTypes);

export const transcriptSegmentsSchema = z.array(
  z
    .object({
      startSeconds: z.number().finite().nonnegative(),
      endSeconds: z.number().finite().nonnegative(),
      text: z.string().refine((value) => value.trim().length > 0),
    })
    .strict()
    .refine((segment) => segment.endSeconds >= segment.startSeconds),
);

export const claimExtractionOutputSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            source_text: z.string().trim().min(1).max(1_200),
            normalized_text: z.string().trim().min(1).max(1_200),
            claim_type: claimTypeSchema,
            start_segment_index: z.number().int().nonnegative(),
            end_segment_index: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const claimExtractionResultSchema = z
  .object({
    extractionVersion: z.literal(CLAIM_EXTRACTION_VERSION),
    provider: z.literal("openai"),
    model: z.literal(CLAIM_EXTRACTION_MODEL),
    instructionsVersion: z.literal(CLAIM_EXTRACTION_INSTRUCTIONS_VERSION),
    schemaVersion: z.literal(CLAIM_EXTRACTION_SCHEMA_VERSION),
    claims: z.array(
      z
        .object({
          original: z.string().min(1).max(1_200),
          normalized: z.string().min(1).max(1_200),
          startSeconds: z.number().finite().nonnegative(),
          endSeconds: z.number().finite().nonnegative(),
          claimType: claimTypeSchema,
        })
        .strict(),
    ),
  })
  .strict();

export function transcriptCharacterCount(
  transcript: readonly TranscriptSegment[],
) {
  return transcript.reduce((total, segment) => total + segment.text.length, 0);
}

export type { ClaimExtractionResult };
