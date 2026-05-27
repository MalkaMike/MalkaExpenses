import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getRole } from "@/lib/auth/admin";
import { AdminBanner } from "@/components/admin-banner";

export const metadata: Metadata = {
  title: "Casa",
  description: "Household finances",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0a0a"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  return (
    <html lang="pt-BR">
      <body data-role={role}>
        <AdminBanner role={role} />
        <main className="min-h-screen pb-24">{children}</main>
      </body>
    </html>
  );
}
