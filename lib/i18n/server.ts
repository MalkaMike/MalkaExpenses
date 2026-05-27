import "server-only";
import { cookies } from "next/headers";
import { type Lang, parseLang } from "@/lib/i18n/translations";

/** Read the pf_lang cookie in a Server Component. */
export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  const raw = jar.get("pf_lang")?.value;
  return parseLang(raw);
}
