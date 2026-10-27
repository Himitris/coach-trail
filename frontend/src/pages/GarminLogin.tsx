import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { garminLogin } from "../api/endpoints";

type Step = { name: "credentials" } | { name: "mfa"; ticket: string } | { name: "done" };

/**
 * Écran de reconnexion Garmin : e-mail + mot de passe, puis code MFA si demandé.
 * Le mot de passe n'est gardé qu'en mémoire le temps de l'envoi puis effacé ; il n'est jamais
 * stocké ni journalisé côté serveur.
 */
export function GarminLogin({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
    await queryClient.invalidateQueries({ queryKey: ["sync-status"] });
  };

  const credentials = useMutation({
    mutationFn: () => garminLogin({ email: email.trim(), password }),
    onSettled: () => { setPassword(""); },
    onSuccess: async (result) => {
      if (result.status === "mfa_required" && result.ticket) {
        setStep({ name: "mfa", ticket: result.ticket });
      } else {
        setStep({ name: "done" });
        await refresh();
      }
    },
  });

  const mfa = useMutation({
    mutationFn: (ticket: string) => garminLogin({ ticket, mfa_code: code.trim() }),
    onSettled: () => { setCode(""); },
    onSuccess: async () => {
      setStep({ name: "done" });
      await refresh();
    },
  });

  if (step.name === "done") {
    return (
      <div className="login-box" role="status">
        <p>Connexion Garmin réussie. Une synchronisation vient d'être lancée.</p>
        <button type="button" className="btn btn-small" onClick={onDone}>
          Fermer
        </button>
      </div>
    );
  }

  const submitCredentials = (event: FormEvent) => {
    event.preventDefault();
    credentials.mutate();
  };

  if (step.name === "mfa") {
    const { ticket } = step;
    return (
      <form
        className="login-box"
        onSubmit={(event) => {
          event.preventDefault();
          mfa.mutate(ticket);
        }}
      >
        <p>Garmin a envoyé un code de vérification (MFA).</p>
        <label htmlFor="garmin-mfa">Code MFA</label>
        <input
          id="garmin-mfa"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(event) => { setCode(event.target.value); }}
        />
        {mfa.isError && <p role="alert" className="form-error">{mfa.error.message}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={mfa.isPending}>
            {mfa.isPending ? "Vérification…" : "Valider le code"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => { setStep({ name: "credentials" }); mfa.reset(); }}
          >
            Recommencer
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="login-box" onSubmit={submitCredentials}>
      <p>Reconnexion à Garmin Connect. Le mot de passe n'est pas conservé.</p>
      <label htmlFor="garmin-email">E-mail Garmin</label>
      <input
        id="garmin-email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => { setEmail(event.target.value); }}
      />
      <label htmlFor="garmin-password">Mot de passe</label>
      <input
        id="garmin-password"
        type="password"
        autoComplete="off"
        required
        value={password}
        onChange={(event) => { setPassword(event.target.value); }}
      />
      {credentials.isError && <p role="alert" className="form-error">{credentials.error.message}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={credentials.isPending}>
          {credentials.isPending ? "Connexion…" : "Se connecter"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Annuler
        </button>
      </div>
    </form>
  );
}
