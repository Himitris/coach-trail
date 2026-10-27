import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LOCKED_EVENT } from "../api/client";
import { fetchAuthStatus, login } from "../api/endpoints";

/**
 * Verrouillage simple optionnel : sans ACCESS_CODE côté serveur, `locked` est faux et rien ne s'affiche.
 * Le code n'est jamais gardé côté navigateur : le serveur pose un cookie de session HttpOnly.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["auth"], queryFn: fetchAuthStatus, retry: false });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Une réponse « verrouillé » en cours de route (session expirée) ramène à l'écran de code.
  useEffect(() => {
    const onLocked = () => { void queryClient.invalidateQueries({ queryKey: ["auth"] }); };
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => { window.removeEventListener(LOCKED_EVENT, onLocked); };
  }, [queryClient]);

  // Statut illisible (serveur éteint, hors ligne) : on laisse l'interface gérer ses propres erreurs.
  if (status.isPending) return <p role="status" className="lock-loading">Chargement…</p>;
  if (status.isError || !status.data.locked || status.data.authenticated) return <>{children}</>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(code);
      setCode("");
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la connexion.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="lock-screen">
      <form onSubmit={(e) => void submit(e)} aria-label="Verrouillage">
        <h1>Coach Trail</h1>
        <p>Cette appli est protégée par un code d'accès.</p>
        <label>
          Code d'accès
          <input type="password" autoComplete="current-password" autoFocus value={code} onChange={(e) => { setCode(e.target.value); }} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || code === ""}>
          Déverrouiller
        </button>
      </form>
    </main>
  );
}
