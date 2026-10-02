import { describe, expect, mock, test } from "bun:test";

import type { MapMonsterService } from "@modules/monsters/map-monster.service";
import { MonsterMovementService } from "@modules/monsters/monster-movement.service";

/**
 * Minimal fakes — we only care about the movement loop's decision logic
 * (which maps/groups move, the broadcast shape, and the server-side
 * commit), not the DB / presence plumbing.
 */
function makeMap(width = 15, height = 17) {
  const count = width * height + (width - 1) * (height - 1);
  const cells = Array.from({ length: count }, (_, id) => ({
    id,
    walkable: true,
    movement: 1,
  }));
  return { id: 10300, width, height, cells };
}

function build(opts: {
  groups: Array<{ id: number; cellId: number; direction: number }>;
  sessions?: string[];
  presenceCells?: number[];
}) {
  const walkable = Array.from({ length: 479 }, (_, i) => i);

  const moveGroup = mock((_id: number, _cell: number, _dir: number) => {});
  const broadcast = mock(
    (_sessions: readonly string[], _message: unknown) => {}
  );

  const mapMonsters = {
    activeMapIds: () => [10300],
    groupsOnMap: () => opts.groups,
    walkableCells: () => walkable,
    moveGroup,
  } as unknown as MapMonsterService;

  const presence = {
    sessionsOnMap: () => opts.sessions ?? ["session-a"],
    onMap: () => (opts.presenceCells ?? []).map((cellId) => ({ cellId })),
  };

  const service = new MonsterMovementService(
    mapMonsters,
    { load: async () => makeMap() } as never,
    presence as never,
    { broadcast } as never
  );

  return { service, moveGroup, broadcast };
}

describe("MonsterMovementService", () => {
  test("does nothing when no player is on the map", async () => {
    const { service, broadcast, moveGroup } = build({
      groups: [{ id: -1, cellId: 100, direction: 1 }],
      sessions: [],
    });

    await service.tick();

    expect(broadcast).not.toHaveBeenCalled();
    expect(moveGroup).not.toHaveBeenCalled();
  });

  test("wanders a group and commits its new cell + broadcasts a movement", async () => {
    // Force the probabilistic gate to always fire for this test.
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const { service, broadcast, moveGroup } = build({
        groups: [{ id: -1, cellId: 100, direction: 1 }],
      });

      await service.tick();

      expect(moveGroup).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledTimes(1);

      const [, message] = broadcast.mock.calls[0] as unknown as [
        readonly string[],
        { payload: { case: string } },
      ];
      expect(message.payload.case).toBe("gameAction");
    } finally {
      Math.random = originalRandom;
    }
  });

  test("skips a group a player is standing on", async () => {
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const { service, broadcast } = build({
        groups: [{ id: -1, cellId: 100, direction: 1 }],
        presenceCells: [100],
      });

      await service.tick();

      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      Math.random = originalRandom;
    }
  });
});
