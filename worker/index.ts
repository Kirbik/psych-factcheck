import handler from "vinext/server/fetch-handler";

type WorkerExecutionContext = {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerEnvironment = Record<string, unknown>;

function withUtf8ContentType(response: Response) {
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("text/x-component") || contentType.includes("charset=")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", `${contentType}; charset=utf-8`);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const worker = {
  async fetch(
    request: Request,
    environment: WorkerEnvironment,
    context: WorkerExecutionContext,
  ) {
    const response = await handler.fetch(request, environment, context);
    return withUtf8ContentType(response);
  },
};

export default worker;
