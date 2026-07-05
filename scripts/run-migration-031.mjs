#!/usr/bin/env node
/**
 * Applies migration 0031_merchant_research.sql via Supabase Management API.
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from ~/.claude/secrets.local.env
 * Run: node scripts/run-migration-031.mjs
 */
import { readFileSync } from "fs";
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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!accessToken || !projectRef) {
  const ref = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in secrets.local.env");
  if (ref) {
    const sqlPath = path.resolve(__dir, "../db/migrations/0031_merchant_research.sql");
    console.log(`\nApply manually at: https://supabase.com/dashboard/project/${ref}/sql/new`);
    console.log(`SQL file: ${sqlPath}`);
  }
  process.exit(1);
}

const sql = readFileSync(path.resolve(__dir, "../db/migrations/0031_merchant_research.sql"), "utf8");

console.log(`Applying migration to project ${projectRef}...`);

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

const result = await resp.json();
console.log("✅  Migration 0031_merchant_research applied successfully");
console.log("Table created: merchant_research");
if (result?.length) console.log("Result:", result);
