import { useMemo, useState, useSyncExternalStore } from "react";

import { type SpellEntry, spellsStore } from "@/game/stores/spells-store";

import { Panel } from "../components/Panel";
import {
  getSpellDragData,
  isSpellDrag,
  SpellIconMount,
  setSpellDragData,
} from "./SpellIcon";

/** Hotbar cells in the main banner (positions are 1-based). */
const HOTBAR_SLOTS = 14;

interface SpellsPanelProps {
  onClose: () => void;
  zoom?: number;
  /** Move a spell to hotbar slot 1..14, or -1 to remove it from the bar. */
  onMoveSpell?: (spellId: number, slot: number) => void;
}

/**
 * Spells panel: 250x390
 * Filter buttons + the character's spell book. Rows can be dragged onto the
 * banner hotbar (or double-clicked to fill the first free slot); dropping a
 * hotbar spell back on the list removes it from the bar.
 */
export function SpellsPanel({
  onClose,
  zoom = 1,
  onMoveSpell,
}: SpellsPanelProps) {
  const [activeFilter, setActiveFilter] = useState(0);
  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot
  );
  const sorted = useMemo(
    () => [...spells].sort((a, b) => a.spellId - b.spellId),
    [spells]
  );

  const equipInFirstFreeSlot = (spell: SpellEntry) => {
    if (!onMoveSpell || spell.position > 0) {
      return;
    }
    const used = new Set(spells.map((s) => s.position));
    for (let slot = 1; slot <= HOTBAR_SLOTS; slot++) {
      if (!used.has(slot)) {
        onMoveSpell(spell.spellId, slot);
        return;
      }
    }
  };

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

  const contentHeight = 390 - 22; // excluding title bar
  const colHeaderY = p(6 + 14 + 14 + 4); // label(6) + filters(18+4) + section header(14) + spacing(4)
  const listY = colHeaderY + p(14);
  const rowH = p(18);
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
            top: colHeaderY,
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
        <ul
          aria-label="Liste des sorts"
          onDragOver={(e) => {
            if (!isSpellDrag(e) || !onMoveSpell) {
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            const spellId = getSpellDragData(e);
            if (spellId === null || !onMoveSpell) {
              return;
            }
            e.preventDefault();
            if (
              (spellsStore.getSnapshot().byId.get(spellId)?.position ?? -1) > 0
            ) {
              onMoveSpell(spellId, -1);
            }
          }}
          style={{
            position: "absolute",
            left: 0,
            top: listY,
            width: "100%",
            height: footerY - listY,
            overflow: "auto",
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {sorted.length === 0 && (
            <li
              style={{
                padding: p(8),
                fontSize: p(10),
                color: "var(--dofus-text-dark, #514a3c)",
              }}
            >
              Aucun sort.
            </li>
          )}
          {sorted.map((spell, i) => (
            <li
              key={spell.spellId}
              draggable
              title={spell.description || spell.name}
              onDragStart={(e) => setSpellDragData(e, spell.spellId)}
              onDoubleClick={() => equipInFirstFreeSlot(spell)}
              style={{
                position: "relative",
                height: rowH,
                padding: `${p(1)}px ${p(6)}px`,
                borderBottom: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                background:
                  i % 2 === 1
                    ? "var(--dofus-bg-alt, #c9bda5)"
                    : "var(--dofus-bg, #d5cfaa)",
                fontSize: p(10),
                display: "flex",
                alignItems: "center",
                gap: p(6),
                cursor: "grab",
                userSelect: "none",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  position: "relative",
                  flex: "none",
                  width: p(16),
                  height: p(16),
                }}
              >
                <SpellIconMount spellId={spell.spellId} label={spell.name} />
              </div>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--dofus-text-dark, #514a3c)",
                  fontWeight: spell.position > 0 ? "bold" : "normal",
                }}
              >
                {spell.name || `Sort ${spell.spellId}`}
              </span>
              <span style={{ flex: "none" }}>{spell.level}</span>
            </li>
          ))}
        </ul>

        {/* Footer: drag-and-drop hint */}
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
            fontSize: p(9),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Glisse un sort dans la barre (ou double-clic)
        </div>
      </div>
    </Panel>
  );
}
