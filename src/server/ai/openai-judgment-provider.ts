import { z } from "zod";
import {
  FACT_CHECK_JUDGMENT_MODEL,
  FACT_CHECK_JUDGMENT_SCHEMA_VERSION,
  FACT_CHECK_JUDGMENT_VERSION,
  FactCheckJudgmentError,
  parseJudgmentOutput,
  validateEvidencePackage,
  validateEvidenceBoundJudgment,
} from "./judgment";
import {
  FACT_CHECK_JUDGMENT_INSTRUCTIONS,
  FACT_CHECK_JUDGMENT_INSTRUCTIONS_VERSION,
} from "./prompts/fact-check-judgment-v1";
import type { EvidencePackage, JudgmentProvider } from "./providers";

const responseContentSchema = z
  .object({ type: z.string(), text: z.string().optional() })
  .passthrough();
const responsesApiSchema = z
  .object({
    output: z
      .array(
        z
          .object({
            type: z.string(),
            content: z.array(responseContentSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function outputJsonSchema(allowedChunkIds: readonly string[]) {
  const citationChunkIdSchema = allowedChunkIds.length
    ? { type: "string", enum: [...allowedChunkIds] }
    : { type: "string", format: "uuid" };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict",
      "confidence",
      "explanation",
      "limitations",
      "citations",
    ],
    properties: {
      verdict: {
        type: "string",
        enum: [
          "SUPPORTED",
          "MOSTLY_SUPPORTED",
          "OVERSIMPLIFIED",
          "INSUFFICIENT_EVIDENCE",
          "CONTRADICTED",
          "UNVERIFIABLE",
        ],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      explanation: { type: "string", minLength: 1, maxLength: 4_000 },
      limitations: {
        type: "array",
        maxItems: 8,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      citations: {
        type: "array",
        maxItems: allowedChunkIds.length ? 5 : 0,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["chunk_id", "relation", "rationale"],
          properties: {
            chunk_id: citationChunkIdSchema,
            relation: {
              type: "string",
              enum: ["supports", "qualifies", "contradicts"],
            },
            rationale: { type: "string", minLength: 1, maxLength: 600 },
          },
        },
      },
    },
  };
}

function outputText(payload: unknown) {
  const response = responsesApiSchema.safeParse(payload);
  if (!response.success) return null;
  for (const item of response.data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

export class JudgmentProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "JudgmentProviderError";
  }
}

export interface VersionedJudgmentProvider extends JudgmentProvider {
  readonly provider: "openai";
  readonly model: string;
  readonly judgmentVersion: string;
  readonly instructionsVersion: string;
  readonly schemaVersion: string;
}

export function createOpenAIJudgmentProvider(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): VersionedJudgmentProvider {
  return {
    provider: "openai",
    model: FACT_CHECK_JUDGMENT_MODEL,
    judgmentVersion: FACT_CHECK_JUDGMENT_VERSION,
    instructionsVersion: FACT_CHECK_JUDGMENT_INSTRUCTIONS_VERSION,
    schemaVersion: FACT_CHECK_JUDGMENT_SCHEMA_VERSION,
    async judge(evidencePackage: EvidencePackage) {
      if (!apiKey) {
        throw new JudgmentProviderError("OPENAI_NOT_CONFIGURED", false);
      }

      let input: EvidencePackage;
      try {
        input = validateEvidencePackage(evidencePackage);
      } catch (error) {
        if (error instanceof FactCheckJudgmentError) {
          throw new JudgmentProviderError(error.code, false);
        }
        throw new JudgmentProviderError(
          "FACT_CHECK_EVIDENCE_PACKAGE_INVALID",
          false,
        );
      }

      let response: Response;
      try {
        response = await fetcher("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: FACT_CHECK_JUDGMENT_MODEL,
            store: false,
            max_output_tokens: 4_000,
            instructions: FACT_CHECK_JUDGMENT_INSTRUCTIONS,
            input: JSON.stringify(input),
            text: {
              format: {
                type: "json_schema",
                name: "fact_check_judgment",
                strict: true,
                schema: outputJsonSchema(
                  input.evidence.map((item) => item.chunkId),
                ),
              },
            },
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch {
        throw new JudgmentProviderError("OPENAI_UNAVAILABLE", true);
      }
      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500;
        throw new JudgmentProviderError(
          retryable ? "OPENAI_UNAVAILABLE" : "OPENAI_REQUEST_REJECTED",
          retryable,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new JudgmentProviderError("FACT_CHECK_RESPONSE_INVALID", false);
      }
      const text = outputText(payload);
      if (!text) {
        throw new JudgmentProviderError(
          "FACT_CHECK_RESPONSE_MISSING_OUTPUT",
          false,
        );
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw new JudgmentProviderError("FACT_CHECK_OUTPUT_NOT_JSON", false);
      }
      try {
        return validateEvidenceBoundJudgment(
          input,
          parseJudgmentOutput(decoded),
        ).judgment;
      } catch (error) {
        if (error instanceof FactCheckJudgmentError) {
          throw new JudgmentProviderError(error.code, false);
        }
        throw new JudgmentProviderError("FACT_CHECK_JUDGMENT_INVALID", false);
      }
    },
  };
}
