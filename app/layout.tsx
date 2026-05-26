import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getMode } from "@/lib/auth/mode";
import { ModeBanner } from "@/components/mode-banner";

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
  const mode = await getMode();
  return (
    <html lang="pt-BR">
      <body data-mode={mode}>
        <ModeBanner mode={mode} />
        <main className="min-h-screen pb-24">{children}</main>
      </body>
    </html>
  );
}
