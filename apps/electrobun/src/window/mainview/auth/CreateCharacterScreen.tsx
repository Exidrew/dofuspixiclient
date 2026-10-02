import { useMemo, useState } from "react";

import type { GameClient } from "@/game/game-client";
import { loginActor } from "@/game/machines/actors";

import { AuthButton, AuthField, AuthMessage, AuthShell } from "./auth-shell";
import { CLASSES, COLOR_PALETTE, colorToCss, DEFAULT_COLORS } from "./classes";

interface Props {
  client: GameClient;
  error: string | null;
  busy: boolean;
}

const NAME_RE = /^[A-Za-z][A-Za-z-]{2,19}$/;

type Slot = 0 | 1 | 2;

export function CreateCharacterScreen({ client, error, busy }: Props) {
  const [name, setName] = useState("");
  const [classId, setClassId] = useState(8); // Iop, the classic starter
  const [sex, setSex] = useState(0);
  const [colors, setColors] = useState<number[]>([...DEFAULT_COLORS]);

  const selected = useMemo(
    () => CLASSES.find((c) => c.id === classId) ?? CLASSES[0],
    [classId]
  );

  const nameValid = NAME_RE.test(name);
  // `busy` is machine-driven (true only while the create request is in
  // flight — state `submittingCharacter`). Previously it was also true in
  // the `creatingCharacter` state, which made the form permanently disabled
  // (button stuck on "Création…") the moment the user opened it.
  const canSubmit = nameValid && !busy;

  const setColor = (slot: Slot, value: number) => {
    setColors((prev) => {
      const next = [...prev];
      next[slot] = value;
      return next;
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    // Flip the machine into `submittingCharacter` first so `busy` becomes
    // true and the button disables while the request is in flight.
    loginActor.send({ type: "SUBMIT_CREATE_CHARACTER" });
    client.createCharacter({
      name: name.trim(),
      classId,
      sex,
      color1: colors[0],
      color2: colors[1],
      color3: colors[2],
    });
    // The server echoes accountCharacterAdd + a fresh list; the machine
    // transitions us back to characterSelect on success, or to
    // createCharacterFailed (which re-enables the form) on error.
  };

  return (
    <AuthShell
      wide
      title="Créer un personnage"
      subtitle="Choisis ta classe, ton apparence et pars à l'aventure."
      footer={
        <button
          type="button"
          onClick={() => loginActor.send({ type: "CANCEL_CREATE_CHARACTER" })}
          className="font-semibold text-[#ffd9a0] underline-offset-2 hover:underline"
        >
          ← Retour à la liste des personnages
        </button>
      }
    >
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-[1fr_16rem]">
        {/* ---- Class picker ---- */}
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#4e4028]">
            Classe
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {CLASSES.map((c) => {
              const active = c.id === classId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClassId(c.id)}
                  className={`group flex flex-col items-center gap-1 rounded-lg border-2 p-2 text-center transition ${
                    active
                      ? "border-[#ff6600] bg-[#fff6e6] shadow-[0_0_0_2px_rgba(255,102,0,0.25)]"
                      : "border-[#4e4028]/25 bg-[#fbf6e4] hover:border-[#4e4028]/60"
                  }`}
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white shadow-inner"
                    style={{ background: c.accent }}
                  >
                    {c.name.slice(0, 2)}
                  </span>
                  <span className="text-[11px] font-semibold text-[#3a3220]">
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-md border-2 border-[#4e4028]/25 bg-[#fbf6e4] p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#3a3220]">
                {selected.name}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                style={{ background: selected.accent }}
              >
                {selected.element}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#5f5338]">{selected.tagline}</p>
          </div>

          {/* ---- Sex ---- */}
          <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-[#4e4028]">
            Sexe
          </h2>
          <div className="flex gap-2">
            {[
              { value: 0, label: "Masculin" },
              { value: 1, label: "Féminin" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSex(opt.value)}
                className={`flex-1 rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition ${
                  sex === opt.value
                    ? "border-[#ff6600] bg-[#fff6e6] text-[#3a3220]"
                    : "border-[#4e4028]/25 bg-[#fbf6e4] text-[#5f5338] hover:border-[#4e4028]/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Preview + name + colors ---- */}
        <div className="flex flex-col">
          <div
            className="mb-3 flex h-40 items-end justify-center rounded-lg border-2 border-[#4e4028]/25"
            style={{
              background:
                "linear-gradient(180deg, #cfe4f5 0%, #eef4ea 55%, #d5cfaa 100%)",
            }}
          >
            {/* Stylised character silhouette tinted by the three colour slots.
                A full animated sprite needs the Vello/WebGPU pipeline which is
                only booted in-game, so the pre-game preview stays CSS-based
                (robust, instant, no GPU dependency). */}
            <svg
              viewBox="0 0 60 100"
              className="h-36 drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)]"
              role="img"
              aria-label={`Aperçu ${selected.name}`}
            >
              <ellipse cx="30" cy="97" rx="18" ry="3" fill="#00000022" />
              {/* legs */}
              <rect
                x="22"
                y="66"
                width="6"
                height="28"
                rx="3"
                fill={cssSlot(colors[1])}
              />
              <rect
                x="32"
                y="66"
                width="6"
                height="28"
                rx="3"
                fill={cssSlot(colors[1])}
              />
              {/* body */}
              <rect
                x="18"
                y="38"
                width="24"
                height="32"
                rx="7"
                fill={cssSlot(colors[1])}
              />
              {/* arms */}
              <rect
                x="12"
                y="42"
                width="6"
                height="22"
                rx="3"
                fill={cssSlot(colors[1])}
              />
              <rect
                x="42"
                y="42"
                width="6"
                height="22"
                rx="3"
                fill={cssSlot(colors[1])}
              />
              {/* head */}
              <circle cx="30" cy="24" r="14" fill={cssSlot(colors[0])} />
              {/* headgear / class accent */}
              <path
                d="M16 20 Q30 2 44 20 L44 14 Q30 -2 16 14 Z"
                fill={selected.accent}
              />
              {/* boots */}
              <rect
                x="21"
                y="92"
                width="8"
                height="5"
                rx="2"
                fill={cssSlot(colors[2])}
              />
              <rect
                x="31"
                y="92"
                width="8"
                height="5"
                rx="2"
                fill={cssSlot(colors[2])}
              />
            </svg>
          </div>

          <AuthField
            label="Nom du personnage"
            autoFocus
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="3 à 20 lettres"
            error={name && !nameValid ? "3 à 20 lettres (sans espaces)." : null}
          />

          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#4e4028]">
            Couleurs
          </h2>
          {(["Peau", "Vêtements", "Cheveux / bottes"] as const).map(
            (slotLabel, slot) => (
              <div key={slotLabel} className="mb-2">
                <span className="mb-1 block text-[11px] text-[#7a6a4a]">
                  {slotLabel}
                </span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    title="Couleur par défaut de la classe"
                    onClick={() => setColor(slot as Slot, -1)}
                    className={`h-6 w-6 rounded-full border-2 text-[10px] leading-none ${
                      colors[slot] === -1
                        ? "border-[#ff6600]"
                        : "border-[#4e4028]/30"
                    }`}
                    style={{
                      background:
                        "repeating-conic-gradient(#fff 0 25%, #bbb 0 50%) 0/8px 8px",
                    }}
                  >
                    ↺
                  </button>
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(slot as Slot, c)}
                      className={`h-6 w-6 rounded-full border-2 transition ${
                        colors[slot] === c
                          ? "border-[#ff6600] scale-110"
                          : "border-[#4e4028]/30 hover:scale-105"
                      }`}
                      style={{ background: colorToCss(c) }}
                      aria-label={`Couleur ${colorToCss(c)}`}
                    />
                  ))}
                </div>
              </div>
            )
          )}

          {error && <AuthMessage>{error}</AuthMessage>}

          <div className="mt-auto pt-2">
            <AuthButton type="submit" disabled={!canSubmit}>
              {busy ? "Création…" : "Créer le personnage"}
            </AuthButton>
          </div>
        </div>
      </form>
    </AuthShell>
  );
}

/** Colour slot → CSS, treating -1 as a neutral "class default" grey. */
function cssSlot(value: number): string {
  return value === -1 ? "#b7a98a" : colorToCss(value);
}
