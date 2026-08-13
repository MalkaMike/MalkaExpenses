import { serverClient } from "@/lib/supabase/server";
import "server-only";

export type StorageBucket =
  | "nota-fiscais"
  | "medical-documents"
  | "insurance-vault"
  | "claim-attachments";

export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  bytes: Buffer,
  mimeType: string,
  // Overwrite by default, because the importers re-upload the same invoice by
  // its own file name and expect that to be idempotent. Pass false wherever a
  // name collision means two DIFFERENT documents — overwriting there destroys
  // evidence with no trace.
  opts: { upsert?: boolean } = {}
): Promise<void> {
  const sb = serverClient();
  const { error } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType: mimeType,
    upsert: opts.upsert ?? true,
  });
  if (error) throw new Error(`Storage upload [${bucket}/${path}]: ${error.message}`);
}

export async function downloadFile(bucket: StorageBucket, path: string): Promise<Buffer> {
  const sb = serverClient();
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`Storage download [${bucket}/${path}]: ${error?.message ?? "empty response"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function getSignedUrl(
  bucket: StorageBucket,
  path: string,
  ttlSeconds = 3600
): Promise<string> {
  const sb = serverClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(`Storage sign [${bucket}/${path}]: ${error?.message ?? "empty response"}`);
  }
  return data.signedUrl;
}
