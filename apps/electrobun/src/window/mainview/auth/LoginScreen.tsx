import { useState } from "react";

import type { GameClient } from "@/game/game-client";
import { loginActor } from "@/game/machines/actors";

import { AuthButton, AuthField, AuthMessage, AuthShell } from "./auth-shell";

interface Props {
  client: GameClient;
  failureReason: string | null;
  busy: boolean;
  /** Set when the user just registered — drives the success banner. */
  registrationSucceeded: boolean;
}

export function LoginScreen({
  client,
  failureReason,
  busy,
  registrationSucceeded,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await client.login(username, password);
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = busy || submitting || !username || !password;

  return (
    <AuthShell
      title="Dofus Remastered"
      subtitle="Connecte-toi pour rejoindre le monde."
      footer={
        <button
          type="button"
          onClick={() => loginActor.send({ type: "START_REGISTER" })}
          className="font-semibold text-[#ffd9a0] underline-offset-2 hover:underline"
        >
          Pas encore de compte ? Créer un compte
        </button>
      }
    >
      {registrationSucceeded && !failureReason && (
        <div className="mb-3 rounded-md border-2 border-[#4cae4c]/50 bg-[#e6f6e6] px-3 py-2 text-sm text-[#2f6b2f]">
          Compte créé ! Tu peux maintenant te connecter.
        </div>
      )}

      <form onSubmit={submit}>
        <AuthField
          label="Nom de compte"
          autoFocus
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <AuthField
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {failureReason && <AuthMessage>{failureReason}</AuthMessage>}

        <AuthButton type="submit" disabled={disabled}>
          {submitting ? "Connexion…" : busy ? "Connexion…" : "Se connecter"}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
