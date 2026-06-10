import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  HOUSEHOLD_PASSWORD_HASH: z.string().min(20),
  MODE_COOKIE_SECRET: z.string().min(32),
  ADMIN_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(480), // 8 hours
  // Optional — set to enable Ayelet (health_admin) and Celina (secretary) logins.
  // Generate hash: node -e "const b=require('bcryptjs');console.log(b.hashSync('password',10))"
  HEALTH_PASSWORD_HASH: z.string().optional(),
  CELINA_PASSWORD_HASH: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENAI_API_KEY: z.string().optional(),
  // Vercel cron auth — sent as `Authorization: Bearer <CRON_SECRET>` on
  // scheduled runs. Routes fail CLOSED when unset (lib/auth/cron.ts).
  // No min-length here: the value is "sensitive" in Vercel (unreadable via API),
  // and a failed parse would crash the whole app at boot.
  CRON_SECRET: z.string().optional(),
  // Gmail OAuth for nota fiscal lookup (admin only)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("Casa")
});

export const env = schema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  HOUSEHOLD_PASSWORD_HASH: process.env.HOUSEHOLD_PASSWORD_HASH,
  MODE_COOKIE_SECRET: process.env.MODE_COOKIE_SECRET,
  ADMIN_TIMEOUT_MINUTES: process.env.ADMIN_TIMEOUT_MINUTES,
  HEALTH_PASSWORD_HASH: process.env.HEALTH_PASSWORD_HASH,
  CELINA_PASSWORD_HASH: process.env.CELINA_PASSWORD_HASH,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME
});

export type Env = z.infer<typeof schema>;
