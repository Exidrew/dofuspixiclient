import { useState, useSyncExternalStore } from "react";

import { spellsStore } from "@/game/stores/spells-store";

import { Panel } from "../components/Panel";

interface SpellsPanelProps {
  onClose: () => void;
  zoom?: number;
}

/**
 * Spells panel: 250x390
 * Filter buttons + spell list + boost points footer.
 *
 * The spell list is now live: it renders every spell the player knows
 * (from `spellsStore`, hydrated by the SpellList frame on world entry),
 * shows the current hotbar slot, and each row is draggable. Dropping a
 * row on the action bar (BannerReact) sends an `SM` (spell move) which
 * the server swaps into place.
 */
export function SpellsPanel({ onClose, zoom = 1 }: SpellsPanelProps) {
  const [activeFilter, setActiveFilter] = useState(0);
  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot
  );

  const p = (n: number) => Math.round(n * zoom);

  const filterColors = [
    "#888888",
    "#996633",
    "#3399ff",
    "#ff6633",
    "#669933",
    "#cccccc",
    "#ffcc00",
  ];

  // Sort by hotbar slot so the panel mirrors the action bar, then by id
  // for the unslotted spells (position = -1).
  const sorted = [...spells].sort((a, b) => {
    const ap = a.position >= 1 ? a.position : Number.POSITIVE_INFINITY;
    const bp = b.position >= 1 ? b.position : Number.POSITIVE_INFINITY;
    if (ap !== bp) {
      return ap - bp;
    }
    return a.spellId - b.spellId;
  });

  const contentHeight = 390 - 22; // excluding title bar
  const listY = p(6 + 14 + 18 + 4 + 14 + 14); // filters + section + column headers
  const rowH = p(20);
  const footerY = contentHeight - p(16);

  return (
    <Panel title="Sorts" width={250} height={390} onClose={onClose} zoom={zoom}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          fontSize: p(11),
        }}
      >
        {/* Filter type label */}
        <div
          style={{
            position: "absolute",
            left: p(6),
            top: p(6),
            fontSize: p(10),
            fontWeight: "bold",
            color: "var(--dofus-text-dark, #514a3c)",
          }}
        >
          Type
        </div>

        {/* Filter buttons row */}
        <div
          style={{
            position: "absolute",
            left: p(6),
            top: p(20),
            display: "flex",
            flexWrap: "wrap",
            gap: p(4),
            width: p(240),
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((idx) => (
            <button
              type="button"
              key={`filter-${idx}`}
              onClick={() => setActiveFilter(idx)}
              style={{
                width: p(18),
                height: p(18),
                borderRadius: p(2),
                border: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                background:
                  idx === activeFilter
                    ? filterColors[idx]
                    : "var(--dofus-bar-bg, #514a3c)",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* Spell list section header */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: p(44),
            width: "100%",
            height: p(14),
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(3)}px ${p(8)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
          }}
        >
          Liste des sorts
        </div>

        {/* Column headers */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: p(58),
            width: "100%",
            height: p(14),
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(2)}px ${p(6)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Nom</span>
          <span>Niveau</span>
        </div>

        {/* Spell list rows */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: listY,
            width: "100%",
            height: footerY - listY,
            overflow: "auto",
          }}
        >
          {sorted.length === 0 && (
            <div
              style={{
                padding: `${p(6)}px ${p(8)}px`,
                fontSize: p(10),
                color: "var(--dofus-text-dark, #514a3c)",
              }}
            >
              Aucun sort connu.
            </div>
          )}
          {sorted.map((spell, i) => (
            <button
              type="button"
              key={spell.spellId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/spell-id", String(spell.spellId));
                e.dataTransfer.effectAllowed = "move";
              }}
              style={{
                position: "relative",
                height: rowH,
                padding: `${p(2)}px ${p(6)}px`,
                borderBottom: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                background:
                  i % 2 === 1
                    ? "var(--dofus-bg-alt, #c9bda5)"
                    : "var(--dofus-bg, #d5cfaa)",
                fontSize: p(10),
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "grab",
                boxSizing: "border-box",
                gap: p(4),
              }}
              title="Glissez ce sort sur la barre d'action"
            >
              <img
                src="/themes/classic/assets/panels/spells/spell-slot-background.svg"
                alt=""
                style={{ width: p(18), height: p(18), flexShrink: 0 }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--dofus-text-dark, #514a3c)",
                }}
              >
                {spell.name}
              </span>
              {spell.position >= 1 && (
                <span
                  style={{
                    fontSize: p(9),
                    fontWeight: "bold",
                    color: "#e87a0d",
                    flexShrink: 0,
                  }}
                >
                  {spell.position}
                </span>
              )}
              <span
                style={{
                  flexShrink: 0,
                  color: "var(--dofus-text-dark, #514a3c)",
                }}
              >
                {spell.level}
              </span>
            </button>
          ))}
        </div>

        {/* Footer: boost points */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: footerY,
            width: "100%",
            height: contentHeight - footerY,
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(4)}px`,
            textAlign: "center",
            fontSize: p(11),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Points de boost : 0
        </div>
      </div>
    </Panel>
  );
}
