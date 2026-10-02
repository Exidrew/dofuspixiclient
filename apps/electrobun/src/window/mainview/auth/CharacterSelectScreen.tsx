import { useState } from "react";

import type { GameClient } from "@/game/game-client";
import type { CharacterListEntry } from "@/game/network/protocol";
import { loginActor } from "@/game/machines/actors";

import { AuthShell } from "./auth-shell";
import { classFromGfx, colorToCss } from "./classes";

interface Props {
  client: GameClient;
  characters: CharacterListEntry[];
  busy: boolean;
}

const MAX_CHARACTERS = 5;

export function CharacterSelectScreen({ client, characters, busy }: Props) {
  const canCreate = !busy && characters.length < MAX_CHARACTERS;

  // Id of the character awaiting a delete confirmation, null when none.
  // Using an inline confirmation (instead of window.confirm) keeps the flow
  // inside the custom auth shell and works uniformly across platforms.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const confirmDelete = (id: number) => {
    client.deleteCharacter(id);
    setPendingDelete(null);
  };

  return (
    <AuthShell
      wide
      title="Tes personnages"
      subtitle="Choisis un héros ou crées-en un nouveau."
    >
      {characters.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-[#4e4028]/30 bg-[#fbf6e4] px-3 py-8 text-center text-sm text-[#7a6a4a]">
          Aucun personnage sur ce serveur. Crée ton premier héros !
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {characters.map((c) => {
            const id = Number(c.id);
            const cls = classFromGfx(c.gfxId);
            const accent = cls?.accent ?? "#514a3c";
            const skin = colorToCss(c.color1 >= 0 ? c.color1 : 0xf5d6b0);
            const cloth = colorToCss(c.color2 >= 0 ? c.color2 : 0x4a90d9);
            const confirming = pendingDelete === id;
            return (
              <li key={c.id} className="relative">
                <button
                  type="button"
                  disabled={busy || c.isDead || confirming}
                  onClick={() => client.selectCharacter(id)}
                  className="group flex w-full flex-col items-center gap-2 rounded-lg border-2 border-[#4e4028]/30 bg-[#fbf6e4] p-3 text-center transition hover:border-[#ff6600] hover:bg-[#fff6e6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {/* Colour-tinted avatar built from the character's real
                      colour slots (no GPU sprite needed pre-game). */}
                  <span
                    className="relative flex h-16 w-16 items-end justify-center overflow-hidden rounded-full"
                    style={{
                      background:
                        "linear-gradient(180deg,#cfe4f5,#eef4ea 60%,#d5cfaa)",
                    }}
                  >
                    <svg
                      viewBox="0 0 60 100"
                      className="h-14"
                      role="img"
                      aria-label={`Aperçu de ${c.name}`}
                    >
                      <title>{`Aperçu de ${c.name}`}</title>
                      <rect
                        x="22"
                        y="66"
                        width="6"
                        height="28"
                        rx="3"
                        fill={cloth}
                      />
                      <rect
                        x="32"
                        y="66"
                        width="6"
                        height="28"
                        rx="3"
                        fill={cloth}
                      />
                      <rect
                        x="18"
                        y="38"
                        width="24"
                        height="32"
                        rx="7"
                        fill={cloth}
                      />
                      <rect
                        x="12"
                        y="42"
                        width="6"
                        height="22"
                        rx="3"
                        fill={cloth}
                      />
                      <rect
                        x="42"
                        y="42"
                        width="6"
                        height="22"
                        rx="3"
                        fill={cloth}
                      />
                      <circle cx="30" cy="24" r="14" fill={skin} />
                      <path
                        d="M16 20 Q30 2 44 20 L44 14 Q30 -2 16 14 Z"
                        fill={accent}
                      />
                    </svg>
                  </span>

                  <span className="w-full truncate font-semibold text-[#3a3220]">
                    {c.name}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-[#7a6a4a]">
                    <span
                      className="rounded-full px-1.5 py-0.5 font-semibold text-white"
                      style={{ background: accent }}
                    >
                      {cls?.name ?? `gfx ${c.gfxId}`}
                    </span>
                    <span>Niv. {c.level}</span>
                  </span>
                  {c.isDead && (
                    <span className="text-[11px] font-semibold text-[#b3261e]">
                      Mort
                    </span>
                  )}
                </button>

                {/* Delete affordance: a small button in the card's corner that
                    flips the card into an inline confirmation state. */}
                {!confirming ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingDelete(id)}
                    title={`Supprimer ${c.name}`}
                    aria-label={`Supprimer ${c.name}`}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#4e4028]/30 bg-[#fbf6e4] text-xs font-bold text-[#b3261e] shadow-sm transition hover:border-[#b3261e] hover:bg-[#b3261e] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✕
                  </button>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-[#b3261e]/60 bg-[#fbf6e4]/95 p-2 text-center">
                    <span className="text-xs font-semibold text-[#3a3220]">
                      Supprimer {c.name} ?
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => confirmDelete(id)}
                        className="rounded-md bg-[#b3261e] px-3 py-1 text-xs font-semibold text-white shadow-[0_2px_0_#7d1a15] transition hover:bg-[#cf2f26] active:translate-y-px active:shadow-none"
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(null)}
                        className="rounded-md border border-[#4e4028]/30 bg-white px-3 py-1 text-xs font-semibold text-[#4e4028] transition hover:bg-[#f0ead6]"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-[#7a6a4a]">
          {characters.length} / {MAX_CHARACTERS} personnages
        </span>
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => loginActor.send({ type: "OPEN_CREATE_CHARACTER" })}
          className="rounded-md bg-[#ff6600] px-4 py-2 text-sm font-semibold text-white shadow-[0_3px_0_#b34700] transition hover:bg-[#ff7a1f] active:translate-y-px active:shadow-[0_1px_0_#b34700] disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Nouveau personnage
        </button>
      </div>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={() => loginActor.send({ type: "LOGOUT" })}
          className="text-xs text-[#4e4028] underline-offset-2 hover:underline"
        >
          Se déconnecter
        </button>
      </div>
    </AuthShell>
  );
}
