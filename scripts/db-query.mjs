#!/usr/bin/env node
/**
 * Read-only SQL runner against the production database, via the Supabase
 * Management API (same channel as run-migration.mjs).
 *
 * Exists so audits can inspect live data without a mutation path: the query
 * is rejected unless it is a single SELECT / WITH statement. This is a
 * guard against accident, not a security boundary — the token it uses is
 * privileged, so keep it that way and never widen it to run DDL/DML. Use
 * run-migration.mjs for anything that writes.
 *
 * Usage:
 *   node scripts/db-query.mjs "select count(*) from transactions"
 *   node scripts/db-query.mjs --file path/to/query.sql
 *
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env.local or
 * ~/.claude/secrets.local.env. Never prints credential values.
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

if (!accessToken || !projectRef) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF (.env.local or ~/.claude/secrets.local.env)");
  process.exit(1);
}

const args = process.argv.slice(2);
const sql = args[0] === "--file"
  ? readFileSync(path.resolve(args[1]), "utf8")
  : args[0];

if (!sql) {
  console.error('Usage: node scripts/db-query.mjs "select ..." | --file <query.sql>');
  process.exit(1);
}

// Read-only guard: strip comments, then require a single SELECT/WITH statement.
const stripped = sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .trim()
  .replace(/;\s*$/, "");

if (!/^(select|with)\b/i.test(stripped)) {
  console.error("Refused: only SELECT / WITH queries are allowed here. Use run-migration.mjs to write.");
  process.exit(1);
}
if (stripped.includes(";")) {
  console.error("Refused: multiple statements. Run one query at a time.");
  process.exit(1);
}

const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ query: stripped })
});

const text = await resp.text();
if (!resp.ok) {
  console.error(`Query failed (${resp.status}): ${text}`);
  process.exit(1);
}

console.log(JSON.stringify(JSON.parse(text), null, 2));
