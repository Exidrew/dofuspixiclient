import type { GameClient } from "@/game/game-client";
import type { ServerEntry } from "@/game/network/protocol";

import { AuthShell } from "./auth-shell";

interface Props {
  client: GameClient;
  servers: ServerEntry[];
  busy: boolean;
}

const STATE_LABELS: Record<number, string> = {
  0: "Hors ligne",
  1: "En ligne",
  2: "Sauvegarde",
};

const STATE_DOT: Record<number, string> = {
  0: "#b3261e",
  1: "#4cae4c",
  2: "#e0a030",
};

export function ServerSelectScreen({ client, servers, busy }: Props) {
  return (
    <AuthShell
      title="Choisir un serveur"
      subtitle="Sélectionne le monde sur lequel jouer."
    >
      {servers.length === 0 ? (
        <div className="rounded-md border-2 border-[#4e4028]/25 bg-[#fbf6e4] px-3 py-6 text-center text-sm text-[#7a6a4a]">
          Aucun serveur disponible.
        </div>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => {
            const disabled = busy || !s.isSelectable;
            return (
              <li key={s.serverId}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => client.selectServer(s.serverId)}
                  className="flex w-full items-center justify-between rounded-md border-2 border-[#4e4028]/30 bg-[#fbf6e4] px-4 py-3 text-left transition hover:border-[#ff6600] hover:bg-[#fff6e6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: STATE_DOT[s.state] ?? "#888" }}
                    />
                    <span className="font-semibold text-[#3a3220]">
                      Serveur #{s.serverId}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-[#7a6a4a]">
                    <span>
                      {s.characterCount} perso
                      {s.characterCount > 1 ? "s" : ""}
                    </span>
                    <span>{STATE_LABELS[s.state] ?? `état ${s.state}`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </AuthShell>
  );
}
