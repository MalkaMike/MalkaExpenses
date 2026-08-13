"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";

/**
 * Anything that throws while this screen renders lands here instead of blanking
 * the whole app with "Application error: a client-side exception has occurred".
 *
 * The common cause is not a bug in the page: a tab left open across a deploy
 * asks for a JavaScript chunk that no longer exists, the request 404s, and
 * React unmounts everything. The user cannot act on the default message. This
 * one says what to do, and reloading from the server fixes exactly that case.
 */
export default function QueueError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the real error visible to whoever opens the console — swallowing it
    // would leave the next person with the same blank screen and no clue.
    console.error("[reembolsos] erro na tela:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-ap-card border border-hairline bg-white p-6">
        <h1 className="text-ap-subheading font-semibold text-carbon">
          A tela não carregou
        </h1>
        <p className="mt-2 text-ap-body-sm text-ash">
          Quase sempre isso acontece quando a página ficou aberta enquanto uma versão nova
          subiu. Recarregar resolve.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-1.5 rounded-ap-pill bg-apple-blue px-4 py-2.5 text-ap-body-sm text-white transition hover:opacity-90"
          >
            <RotateCw size={14} /> Recarregar a página
          </button>
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 rounded-ap-pill border border-link-blue px-4 py-2.5 text-ap-body-sm text-link-blue transition hover:bg-link-blue/5"
          >
            Tentar de novo sem recarregar
          </button>
        </div>
        {error.digest && (
          <p className="mt-4 font-mono text-ap-caption text-ash">código: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
