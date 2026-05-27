import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { getRole } from "@/lib/auth/admin";
import { AdminBanner } from "@/components/admin-banner";
import { BottomNav } from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "Casa",
  description: "Suas finanças, juntos",
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
        <BottomNav role={role} />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "rgb(var(--card))",
              color: "rgb(var(--fg))",
              border: "1px solid rgb(var(--border))"
            }
          }}
        />
      </body>
    </html>
  );
}
