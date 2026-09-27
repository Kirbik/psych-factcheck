// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  maybeSingle: vi.fn(),
  request: vi.fn(),
  findOwned: vi.fn(),
  dispatch: vi.fn(),
  reconcile: vi.fn(),
  privileged: vi.fn(),
  workflowRunner: vi.fn(),
}));
vi.mock("@/server/supabase/auth", () => ({
  createServerAuthClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      }),
    }),
  }),
}));
vi.mock("@/server/workflows/repository", () => ({
  workflowRepository: () => ({
    request: mocks.request,
    findOwned: mocks.findOwned,
  }),
}));
vi.mock("@/server/workflows/runtime", () => ({
  operationalRepository: mocks.privileged,
  workflowRunner: mocks.workflowRunner,
}));
vi.mock("@/server/workflows/dispatch", () => ({
  dispatchJob: mocks.dispatch,
  reconcileJob: mocks.reconcile,
}));
import { GET, POST } from "@/app/api/analysis/route";

const contentId = "33333333-3333-4333-8333-333333333333";
const job = {
  id: "44444444-4444-4444-8444-444444444444",
  generation: 1,
  status: "queued",
  stage: "queued",
  attempt: 0,
  error_code: null,
  user_id: "private-owner",
  run_id: "private-run",
};
function post(
  body: unknown = { contentItemId: contentId },
  origin = "http://localhost",
) {
  return POST(
    new Request("http://localhost/api/analysis", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
describe("analysis API trust boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "owner" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: contentId },
      error: null,
    });
    mocks.workflowRunner.mockReturnValue({});
    mocks.request.mockResolvedValue(job);
    mocks.findOwned.mockResolvedValue(job);
    mocks.dispatch.mockResolvedValue(job);
    mocks.reconcile.mockResolvedValue(job);
  });
  it("rejects cross-origin requests before authentication", async () => {
    expect((await post(undefined, "https://elsewhere.test")).status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated callers", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    expect((await post()).status).toBe(401);
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it("rejects unknown input and caller-supplied ownership", async () => {
    expect(
      (await post({ contentItemId: contentId, userId: "victim" })).status,
    ).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not use privileged clients for foreign or absent content", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await post()).status).toBe(404);
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it("reports unavailable honestly without creating a job", async () => {
    mocks.workflowRunner.mockReturnValue(undefined);
    expect((await post()).status).toBe(503);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("passes retry generation and returns only public progress", async () => {
    const response = await post({
      contentItemId: contentId,
      retryGeneration: 1,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.request).toHaveBeenCalledWith(contentId, 1);
    const result = await response.json();
    expect(result.job).not.toHaveProperty("user_id");
    expect(result.job).not.toHaveProperty("run_id");
  });
  it("hides provider diagnostics on ambiguous enqueue failure", async () => {
    mocks.dispatch.mockRejectedValue(new Error("secret-provider-token"));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-provider-token");
  });
  it("GET recovers an existing job without requesting a new one", async () => {
    const response = await GET(
      new Request(`http://localhost/api/analysis?contentItemId=${contentId}`),
    );
    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
