import { describe, expect, test } from "bun:test";

import { SpellsService } from "@modules/spells/spells.service";

/**
 * Minimal in-memory stand-in for SpellsRepository, implementing only the
 * three methods `SpellsService.moveSpell` calls.
 */
function fakeRepo(initial: { spellId: number; position: number }[]) {
  const rows = initial.map((r) => ({ ...r, level: 1 }));
  return {
    rows,
    async playerHasSpell(_playerId: string, spellId: number) {
      return rows.some((r) => r.spellId === spellId);
    },
    async findByPlayer(_playerId: string) {
      return rows.map((r) => ({ ...r }));
    },
    async setSpellPosition(_playerId: string, spellId: number, position: number) {
      const row = rows.find((r) => r.spellId === spellId);
      if (row) {
        row.position = position;
      }
    },
  };
}

function fakeLangs() {
  return { getSpellSync: () => undefined };
}

describe("SpellsService.moveSpell", () => {
  test("moves a spell into an empty slot", async () => {
    const repo = fakeRepo([
      { spellId: 1, position: 1 },
      { spellId: 3, position: -1 },
    ]);
    const svc = new SpellsService(repo as never, fakeLangs() as never);

    const updates = await svc.moveSpell("p", 3, 5);

    expect(updates).toEqual([{ spellId: 3, position: 5 }]);
    expect(repo.rows.find((r) => r.spellId === 3)?.position).toBe(5);
  });

  test("swaps with the spell already in the target slot", async () => {
    const repo = fakeRepo([
      { spellId: 1, position: 1 },
      { spellId: 3, position: 2 },
    ]);
    const svc = new SpellsService(repo as never, fakeLangs() as never);

    const updates = await svc.moveSpell("p", 3, 1);

    expect(updates).toEqual([
      { spellId: 3, position: 1 },
      { spellId: 1, position: 2 },
    ]);
    expect(repo.rows.find((r) => r.spellId === 3)?.position).toBe(1);
    expect(repo.rows.find((r) => r.spellId === 1)?.position).toBe(2);
  });

  test("rejects an unknown spell", async () => {
    const repo = fakeRepo([{ spellId: 1, position: 1 }]);
    const svc = new SpellsService(repo as never, fakeLangs() as never);

    const updates = await svc.moveSpell("p", 999, 3);

    expect(updates).toEqual([]);
  });

  test("rejects an invalid slot", async () => {
    const repo = fakeRepo([{ spellId: 3, position: 1 }]);
    const svc = new SpellsService(repo as never, fakeLangs() as never);

    expect(await svc.moveSpell("p", 3, 0)).toEqual([]);
    expect(await svc.moveSpell("p", 3, -1)).toEqual([]);
  });

  test("is a no-op when the spell is already in the slot", async () => {
    const repo = fakeRepo([{ spellId: 3, position: 4 }]);
    const svc = new SpellsService(repo as never, fakeLangs() as never);

    const updates = await svc.moveSpell("p", 3, 4);

    expect(updates).toEqual([{ spellId: 3, position: 4 }]);
    expect(repo.rows.find((r) => r.spellId === 3)?.position).toBe(4);
  });
});
