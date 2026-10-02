import { useState } from "react";

import type { GameClient } from "@/game/game-client";
import { loginActor } from "@/game/machines/actors";

import { AuthButton, AuthField, AuthMessage, AuthShell } from "./auth-shell";

interface Props {
  client: GameClient;
  failureReason: string | null;
  busy: boolean;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const PSEUDO_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/;

export function RegisterScreen({ client, failureReason, busy }: Props) {
  const [username, setUsername] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const usernameValid = USERNAME_RE.test(username);
  const pseudoValid = pseudo.trim() === "" || PSEUDO_RE.test(pseudo.trim());
  const passwordValid = password.length >= 8;
  const confirmValid = confirm === password;

  const canSubmit =
    usernameValid &&
    pseudoValid &&
    passwordValid &&
    confirmValid &&
    !busy &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      await client.createAccount(username, password, pseudo.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Rejoins l'aventure : ton compte restera en mémoire sur ce serveur."
      footer={
        <button
          type="button"
          onClick={() => loginActor.send({ type: "BACK_TO_LOGIN" })}
          className="font-semibold text-[#ffd9a0] underline-offset-2 hover:underline"
        >
          ← J'ai déjà un compte
        </button>
      }
    >
      <form onSubmit={submit}>
        <AuthField
          label="Nom de compte"
          autoFocus
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3 à 32 caractères"
          hint="Lettres, chiffres, tiret et underscore."
          error={
            username && !usernameValid
              ? "3 à 32 caractères (lettres, chiffres, - et _)."
              : null
          }
        />
        <AuthField
          label="Pseudo (affiché)"
          type="text"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          placeholder="Optionnel — par défaut le nom de compte"
          error={pseudo && !pseudoValid ? "Pseudo invalide." : null}
        />
        <AuthField
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8 caractères minimum"
          error={password && !passwordValid ? "8 caractères minimum." : null}
        />
        <AuthField
          label="Confirmer le mot de passe"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={
            confirm && !confirmValid ? "Les mots de passe diffèrent." : null
          }
        />

        {failureReason && <AuthMessage>{failureReason}</AuthMessage>}

        <AuthButton type="submit" disabled={!canSubmit}>
          {submitting || busy ? "Création…" : "Créer mon compte"}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
