import { redirect } from "next/navigation";
import { getMode, isPinConfigured } from "@/lib/auth/mode";
import { UnlockClient } from "./unlock-client";

export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  if ((await getMode()) === "private") redirect("/");
  const configured = await isPinConfigured();
  return <UnlockClient pinConfigured={configured} />;
}
