import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
import { Toaster } from "sonner";
import { getRole } from "@/lib/auth/admin";
import { getLang } from "@/lib/i18n/server";
import { LangProvider } from "@/lib/i18n/context";
import { AdminBanner } from "@/components/admin-banner";
import { BottomNav } from "@/components/bottom-nav";
import { SwRegister } from "@/components/sw-register";

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
  const [role, lang] = await Promise.all([getRole(), getLang()]);
  return (
    <html lang={lang === "en" ? "en" : "pt-BR"} className={geist.variable}>
      <body data-role={role} style={{ fontFamily: "var(--font-geist), ui-sans-serif, system-ui, sans-serif" }}>
        <LangProvider initialLang={lang}>
          <SwRegister />
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
        </LangProvider>
      </body>
    </html>
  );
}
