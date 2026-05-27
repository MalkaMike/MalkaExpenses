"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type Lang, parseLang } from "@/lib/i18n/translations";

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "pt",
  setLang: () => {}
});

export function LangProvider({
  initialLang,
  children
}: {
  initialLang: Lang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // Sync with cookie on mount (in case cookie was set server-side)
  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("pf_lang="))
      ?.split("=")[1];
    if (cookie) setLangState(parseLang(cookie));
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    document.cookie = `pf_lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  }

  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  return useContext(LangCtx);
}
