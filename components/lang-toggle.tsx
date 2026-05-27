"use client";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";

/** PT | EN pill toggle. Sets pf_lang cookie and triggers a server re-render. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  const router = useRouter();

  function toggle() {
    const next = lang === "pt" ? "en" : "pt";
    setLang(next);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-semibold tracking-wider border border-border text-muted hover:text-fg hover:border-fg/30 transition select-none"
      aria-label="Mudar idioma"
    >
      <span className={lang === "pt" ? "text-fg" : "text-muted"}>PT</span>
      <span className="mx-0.5 text-border">|</span>
      <span className={lang === "en" ? "text-fg" : "text-muted"}>EN</span>
    </button>
  );
}
