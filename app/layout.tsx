import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, Manrope, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getRole } from "@/lib/auth/admin";
import { getLang } from "@/lib/i18n/server";
import { LangProvider } from "@/lib/i18n/context";
import { AdminBanner } from "@/components/admin-banner";
import { BottomNav } from "@/components/bottom-nav";
import { SwRegister } from "@/components/sw-register";

// Serene Financial type system (from Stitch design)
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap"
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Casa",
  description: "Suas finanças, juntos",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#faf9f7"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [role, lang] = await Promise.all([getRole(), getLang()]);
  const fontVars = [inter.variable, manrope.variable, jetbrainsMono.variable].join(" ");
  return (
    <html lang={lang === "en" ? "en" : "pt-BR"} className={fontVars}>
      <body
        data-role={role}
        className="font-sans"
        style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" }}
      >
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
                background: "#ffffff",
                color: "#1a1c1b",
                border: "1px solid #e9e8e6",
                borderRadius: "0.75rem",
                fontFamily: "var(--font-inter)"
              }
            }}
          />
        </LangProvider>
      </body>
    </html>
  );
}
