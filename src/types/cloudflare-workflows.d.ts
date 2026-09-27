declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;

  export interface WorkflowEvent<Payload> {
    payload: Payload;
    instanceId: string;
  }

  export interface WorkflowStepContext {
    attempt: number;
  }

  export interface WorkflowStep {
    do<Result>(
      name: string,
      config: {
        retries: {
          limit: number;
          delay: string | number;
          backoff: "constant" | "linear" | "exponential";
        };
        timeout: string | number;
      },
      callback: (context: WorkflowStepContext) => Promise<Result>,
    ): Promise<Result>;
  }

  export abstract class WorkflowEntrypoint<Environment, Payload> {
    protected env: Environment;

    constructor(context: unknown, environment: Environment);

    abstract run(
      event: WorkflowEvent<Payload>,
      step: WorkflowStep,
    ): Promise<unknown>;
  }
}

declare module "cloudflare:workflows" {
  export class NonRetryableError extends Error {
    constructor(message: string, name?: string);
  }
}
