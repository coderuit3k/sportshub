import { mkdirSync, writeFileSync } from "node:fs";

export async function findVercelProject(token: string, project: string, org?: string, request = fetch) {
  if (!token || !project) throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID are required");
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}`);
  if (org) url.searchParams.set("teamId", org);
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Vercel project lookup failed (HTTP ${response.status}); check token scope and VERCEL_ORG_ID`);
  const result = await response.json() as { id?: string; accountId?: string; name?: string };
  if (result.name !== "sportshub" || !result.id?.startsWith("prj_") || !result.accountId
    || (project.startsWith("prj_") && project !== result.id) || (org && org !== result.accountId)) {
    throw new Error("Vercel project does not match the expected SportsHub project/account");
  }
  return { projectId: result.id, orgId: result.accountId };
}

if (require.main === module) {
  findVercelProject(process.env.VERCEL_TOKEN ?? "", process.env.VERCEL_PROJECT_ID ?? "", process.env.VERCEL_ORG_ID)
    .then((project) => {
      mkdirSync(".vercel", { recursive: true });
      writeFileSync(".vercel/project.json", JSON.stringify(project));
      console.log("Verified Vercel project sportshub; local link metadata written.");
    }).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
