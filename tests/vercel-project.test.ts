import { expect, it, vi } from "vitest";
import { findVercelProject } from "../scripts/vercel-project";

it("discovers the account from the exact project without logging the token", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "prj_test", accountId: "team_test", name: "sportshub" })));
  await expect(findVercelProject("private-token", "prj_test", undefined, request)).resolves.toEqual({ projectId: "prj_test", orgId: "team_test" });
  expect(request.mock.calls[0][0].pathname).toBe("/v9/projects/prj_test");
});

it("fails closed for missing credentials, denied access and the wrong project", async () => {
  const denied = vi.fn().mockResolvedValue(new Response("PRIVATE_PROVIDER_PAYLOAD", { status: 403 }));
  await expect(findVercelProject("", "prj_test", undefined, denied)).rejects.toThrow("are required");
  expect(denied).not.toHaveBeenCalled();
  await expect(findVercelProject("private-token", "prj_test", undefined, denied)).rejects.toThrow("HTTP 403");
  const wrong = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "prj_other", accountId: "team_test", name: "other" })));
  await expect(findVercelProject("private-token", "prj_test", undefined, wrong)).rejects.toThrow("does not match");
});
