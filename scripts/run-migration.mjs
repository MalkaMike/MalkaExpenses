#!/usr/bin/env node
/**
 * Generic migration runner — applies db/migrations/<file>.sql via the
 * Supabase Management API. Replaces the per-migration copy-paste scripts
 * (run-migration-014/031/032/033/034.mjs).
 *
 * Usage: node scripts/run-migration.mjs 0035_perf_aggregates_and_hardening.sql
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env.local or
 * ~/.claude/secrets.local.env.
 */
import { readFileSync, existsSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import * as os from "os";
import * as path from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

function loadEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).replace(/^['"]|['"]$/g, "").trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file may not exist */ }
}

loadEnv(path.resolve(__dir, "../.env.local"));
loadEnv(path.resolve(os.homedir(), ".claude/secrets.local.env"));

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!accessToken || !projectRef) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in secrets.local.env");
  process.exit(1);
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node scripts/run-migration.mjs <migration-file.sql>");
  process.exit(1);
}

const sqlPath = path.resolve(__dir, "../db/migrations", path.basename(fileArg));
if (!existsSync(sqlPath)) {
  console.error(`Migration file not found: ${sqlPath}`);
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
console.log(`Applying ${path.basename(sqlPath)} to project ${projectRef}...`);

const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`
  },
  body: JSON.stringify({ query: sql })
});

if (!resp.ok) {
  const text = await resp.text();
  console.error(`Migration failed (${resp.status}): ${text}`);
  process.exit(1);
}

console.log(`✅  ${path.basename(sqlPath)} applied successfully`);
