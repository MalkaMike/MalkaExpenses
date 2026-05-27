import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth/admin";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const role = await getRole();
  const sp = await searchParams;
  if (role !== "public") {
    redirect(sp.next || "/");
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <LoginForm next={sp.next} />
    </div>
  );
}
