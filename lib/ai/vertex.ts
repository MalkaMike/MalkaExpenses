import "server-only";
import { GoogleGenAI } from "@google/genai";

// ============================================================================
// Vertex AI client wrapper. Uses Application Default Credentials on local
// dev (gcloud auth) and a service-account JSON in Vercel
// (GOOGLE_APPLICATION_CREDENTIALS_JSON env var, inline).
// ============================================================================

let _client: GoogleGenAI | null = null;

export function vertex(): GoogleGenAI {
  if (_client) return _client;

  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
  if (!project) {
    throw new Error("GOOGLE_VERTEX_PROJECT env var not set");
  }

  // If a JSON credential blob is provided, parse it and pass explicitly.
  // Otherwise fall back to ADC (gcloud auth on local dev).
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credsJson) {
    let credentials: object;
    try {
      credentials = JSON.parse(credsJson);
    } catch (e) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON: ${(e as Error).message}`
      );
    }
    _client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: { credentials }
    });
  } else {
    _client = new GoogleGenAI({
      vertexai: true,
      project,
      location
    });
  }
  return _client;
}

export const FLASH_MODEL = "gemini-2.5-flash";
export const PRO_MODEL = "gemini-2.5-pro";
