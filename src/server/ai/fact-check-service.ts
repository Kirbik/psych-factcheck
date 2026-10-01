import type { FactCheckMetadata } from "./fact-check-repository";
import type { VersionedJudgmentProvider } from "./openai-judgment-provider";
import type { EvidencePackage, FactCheckJudgment } from "./providers";

export interface FactCheckServiceRepository {
  getEvidencePackage(
    claimId: string,
    evidencePackageId: string,
  ): Promise<EvidencePackage>;
  save(
    metadata: FactCheckMetadata,
    evidencePackage: EvidencePackage,
    judgment: FactCheckJudgment,
  ): Promise<string>;
}

export function createFactCheckService(
  repository: FactCheckServiceRepository,
  provider: VersionedJudgmentProvider,
) {
  return {
    async judgeAndSave(input: {
      readonly claimId: string;
      readonly evidencePackageId: string;
      readonly jobId: string;
      readonly generation: number;
      readonly runId: string;
    }): Promise<string> {
      const evidencePackage = await repository.getEvidencePackage(
        input.claimId,
        input.evidencePackageId,
      );
      const judgment = await provider.judge(evidencePackage);
      return repository.save(
        {
          ...input,
          judgmentVersion: provider.judgmentVersion,
          provider: provider.provider,
          model: provider.model,
          instructionsVersion: provider.instructionsVersion,
          schemaVersion: provider.schemaVersion,
        },
        evidencePackage,
        judgment,
      );
    },
  };
}
