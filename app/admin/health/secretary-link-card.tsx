import { getRole } from "@/lib/auth/admin";
import { secretaryLinkPath } from "@/lib/auth/secretary-link";
import { CopyLinkButton } from "./copy-link-button";

/**
 * Shows the secretary's sign-in link so Mickael can send it to Celina.
 *
 * Admin only — Ayelet (health) has no reason to hand out access. The link is
 * derived at render from MODE_COOKIE_SECRET, so it lives nowhere else: not in
 * git, not in an env var, not in a note.
 */
export async function SecretaryLinkCard() {
  if ((await getRole()) !== "admin") return null;

  const path = secretaryLinkPath();

  return (
    <section className="mb-5 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        Acesso da Celina
      </p>
      <p className="text-[11px] text-on-surface-variant">
        Este link entra direto, sem senha, e vale 90 dias. Mande para ela e não publique em
        nenhum outro lugar — quem tiver o link vê os reembolsos de saúde da família.
      </p>
      <CopyLinkButton path={path} />
      <p className="text-[10px] text-on-surface-variant">
        Para invalidar o link atual, troque a constante VERSION em lib/auth/secretary-link.ts
        e publique — todo link antigo para de funcionar na hora.
      </p>
    </section>
  );
}
