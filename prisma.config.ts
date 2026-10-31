import { defineConfig } from "prisma/config";

try { process.loadEnvFile(); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "" },
  migrations: { seed: "node --env-file-if-exists=.env --import tsx prisma/seed.ts" },
});
