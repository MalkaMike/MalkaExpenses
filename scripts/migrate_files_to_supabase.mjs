/**
 * migrate_files_to_supabase.mjs
 *
 * One-time migration: uploads private/ files to Supabase Storage and updates
 * storage_bucket + storage_path on nota_fiscais and medical_documents rows.
 *
 * Usage:
 *   node scripts/migrate_files_to_supabase.mjs
 *
 * Prerequisites:
 *   - Create buckets in Supabase dashboard (ALL private, no public access):
 *       nota-fiscais, medical-documents, insurance-vault, claim-attachments
 *   - .env.local must have NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   - Run: node scripts/migrate_files_to_supabase.mjs
 *
 * Idempotent: rows that already have storage_path set are skipped.
 * The script does NOT delete local private/ files — that's a manual step after
 * verifying the migration succeeded (checksums logged to console).
 */

import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Load .env.local — no dotenv dep needed
try {
  const raw = readFileSync(".env.local", "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env.local missing — rely on actual process env */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CWD = process.cwd();

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function mimeForExt(ext) {
  return ext === "pdf" ? "application/pdf"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "png" ? "image/png"
    : ext === "heic" ? "image/heic"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";
}

async function uploadToStorage(bucket, storagePath, bytes, mimeType) {
  const { error } = await sb.storage.from(bucket).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed [${bucket}/${storagePath}]: ${error.message}`);
}

// ── Migrate nota_fiscais ──────────────────────────────────────────────────────

async function migrateNotaFiscais() {
  console.log("\n📄  Migrating nota_fiscais…");

  // Fetch rows that have NOT yet been migrated
  const { data: rows, error } = await sb
    .from("nota_fiscais")
    .select("id, file_name, file_path")
    .is("storage_path", null)
    .order("created_at", { ascending: true });

  if (error) { console.error("  DB error:", error.message); return; }
  console.log(`  ${rows.length} rows to migrate`);

  let ok = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    // Derive disk path: file_path might be "private/nota-fiscais/nota_xxx.pdf"
    // or we can use file_name directly from private/nota-fiscais/
    const localPath = row.file_path
      ? join(CWD, row.file_path)
      : join(CWD, "private", "nota-fiscais", row.file_name);

    let bytes;
    try {
      bytes = await readFile(localPath);
    } catch {
      console.warn(`  ⚠  file not found on disk: ${localPath} — skipping`);
      skipped++;
      continue;
    }

    const storagePath = row.file_name; // just the filename, no subdirectory
    const mime = mimeForExt(row.file_name.split(".").pop()?.toLowerCase() ?? "pdf");
    const checksum = sha256hex(bytes);

    try {
      await uploadToStorage("nota-fiscais", storagePath, bytes, mime);
      const { error: upErr } = await sb
        .from("nota_fiscais")
        .update({ storage_bucket: "nota-fiscais", storage_path: storagePath })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      console.log(`  ✓  ${row.file_name}  sha256=${checksum.slice(0, 12)}…  (${bytes.length} bytes)`);
      ok++;
    } catch (e) {
      console.error(`  ✗  ${row.file_name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`  → nota_fiscais: ${ok} migrated, ${skipped} skipped (no local file), ${failed} failed`);
}

// ── Migrate medical_documents ─────────────────────────────────────────────────

async function migrateMedicalDocuments() {
  console.log("\n🩺  Migrating medical_documents…");

  const { data: rows, error } = await sb
    .from("medical_documents")
    .select("id, file_path")
    .is("storage_path", null)
    .not("file_path", "is", null)
    .order("created_at", { ascending: true });

  if (error) { console.error("  DB error:", error.message); return; }
  console.log(`  ${rows.length} rows to migrate`);

  let ok = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    if (!row.file_path) { skipped++; continue; }

    const localPath = join(CWD, row.file_path);
    let bytes;
    try {
      bytes = await readFile(localPath);
    } catch {
      console.warn(`  ⚠  file not found on disk: ${localPath} — skipping`);
      skipped++;
      continue;
    }

    const fileName = basename(row.file_path);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
    const mime = mimeForExt(ext);
    const checksum = sha256hex(bytes);

    try {
      await uploadToStorage("medical-documents", fileName, bytes, mime);
      const { error: upErr } = await sb
        .from("medical_documents")
        .update({ storage_bucket: "medical-documents", storage_path: fileName })
        .eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      console.log(`  ✓  ${fileName}  sha256=${checksum.slice(0, 12)}…  (${bytes.length} bytes)`);
      ok++;
    } catch (e) {
      console.error(`  ✗  ${fileName}: ${e.message}`);
      failed++;
    }
  }

  console.log(`  → medical_documents: ${ok} migrated, ${skipped} skipped, ${failed} failed`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀  Supabase Storage migration");
  console.log(`    Project: ${SUPABASE_URL}`);
  console.log("    Buckets required (create in dashboard if absent):");
  console.log("      nota-fiscais  medical-documents  insurance-vault  claim-attachments\n");

  await migrateNotaFiscais();
  await migrateMedicalDocuments();

  console.log("\n✅  Migration complete.");
  console.log("    Verify PDFs load in the app, then you can safely remove private/ from the server.");
  console.log("    (Keep local copies for your own backup — Supabase has its own backups too.)");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
