import { create } from "@bufbuild/protobuf";
import { DofusPathfinding, getDirection } from "@dofus/grid";
import {
  ActionMovementSchema,
  GameActionSchema,
  GameActionType,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * Periodic roleplay wander for monster groups, mirroring the canonical
 * 1.29 behaviour where idle groups take a few steps around their spawn
 * cell from time to time.
 *
 * Design notes:
 *   - We only tick maps that actually have at least one player on them —
 *     there is nobody to animate otherwise, and it keeps the A* cost
 *     proportional to live maps.
 *   - A group is kept static while ANY player stands on ITS cell (the
 *     hover/click panel would otherwise fight a moving sprite) and while
 *     it is currently the target of an in-flight PvM trigger.
 *   - The path is computed server-side with the same `DofusPathfinding`
 *     the client uses, then truncated to a short prefix so groups amble
 *     instead of teleporting across the map.
 *   - We broadcast a standard `gameAction`/ACTION_MOVEMENT frame — the
 *     exact same frame the client already handles for player moves
 *     (MapHandler.handleActorPath → moveWorldActor). No new client code.
 */
@Injectable()
export class MonsterMovementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonsterMovementService.name);

  /** How often we attempt to move one group per live map. */
  private static readonly TICK_MS = 4000;
  /** Chance a given map's group actually moves on a tick. */
  private static readonly MOVE_CHANCE = 0.6;
  /** Upper bound on how far a group ambles in one move. */
  private static readonly MAX_STEPS = 6;
  /** Minimum distance we try to reach (so a move is actually visible). */
  private static readonly MIN_STEPS = 2;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(MapMonsterService) private readonly mapMonsters: MapMonsterService,
    @Inject(MapCacheService) private readonly mapCache: MapCacheService,
    @Inject(PlayerPresenceService)
    private readonly presence: PlayerPresenceService,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {}

  onModuleInit(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.warn(
          `wander tick failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }, MonsterMovementService.TICK_MS);
    // Don't keep the process alive on our account (dev hot-reload, tests).
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One movement pass across every map that currently holds a group. */
  async tick(): Promise<void> {
    for (const mapId of this.mapMonsters.activeMapIds()) {
      const sessions = this.presence.sessionsOnMap(mapId);
      if (sessions.length === 0) {
        continue;
      }

      if (Math.random() > MonsterMovementService.MOVE_CHANCE) {
        continue;
      }

      await this.wanderOneGroup(mapId, sessions);
    }
  }

  private async wanderOneGroup(
    mapId: number,
    sessions: string[]
  ): Promise<void> {
    const groups = this.mapMonsters.groupsOnMap(mapId);
    if (groups.length === 0) {
      return;
    }

    const walkable = this.mapMonsters.walkableCells(mapId);
    if (walkable.length === 0) {
      return;
    }

    const map = await this.mapCache.load(mapId);
    if (!map) {
      return;
    }

    const occupied = new Set(this.presence.onMap(mapId).map((p) => p.cellId));
    const groupCells = new Set(groups.map((g) => g.cellId));

    // Prefer a group nobody is standing next to and that isn't parked on
    // a cell a player occupies.
    const candidates = groups.filter((g) => !occupied.has(g.cellId));
    const group =
      candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]!
        : undefined;
    if (!group) {
      return;
    }

    const pathfinding = new DofusPathfinding(map.width, map.height, walkable);
    // Never route THROUGH another group — treat every other live group's
    // cell as occupied so two groups don't stack on the same tile.
    for (const cell of groupCells) {
      if (cell !== group.cellId) {
        pathfinding.addOccupied(cell);
      }
    }

    const path = this.buildWanderPath(pathfinding, group.cellId, walkable);
    if (!path || path.length < 2) {
      return;
    }

    const endCell = path[path.length - 1]!;
    const prev = path[path.length - 2]!;
    const direction = getDirection(prev, endCell, map.width);

    // Commit server-side FIRST so a PvM trigger racing the broadcast sees
    // the group at its new cell.
    this.mapMonsters.moveGroup(group.id, endCell, direction);

    this.frames.broadcast(
      sessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 0,
            actionType: GameActionType.ACTION_MOVEMENT,
            spriteId: String(group.id),
            rawParams: "",
            actionData: {
              case: "movement",
              value: create(ActionMovementSchema, { pathCells: path }),
            },
          }),
        },
      })
    );
  }

  /**
   * Pick a random reachable destination 2..MAX_STEPS away and return the
   * truncated path (`[startCell, ...steps]`). Returns null when the group
   * is boxed in / no candidate resolved.
   */
  private buildWanderPath(
    pathfinding: DofusPathfinding,
    startCell: number,
    walkable: number[]
  ): number[] | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const target = walkable[Math.floor(Math.random() * walkable.length)]!;
      if (target === startCell) {
        continue;
      }

      const full = pathfinding.findPath(startCell, target);
      // findPath returns [startCell, ..., target]; a single-element path
      // means start === target (already filtered) so require >= 3 to get
      // at least MIN_STEPS of visible motion before truncating.
      if (!full || full.length < MonsterMovementService.MIN_STEPS + 1) {
        continue;
      }

      const len = Math.min(full.length, MonsterMovementService.MAX_STEPS + 1);
      return full.slice(0, len);
    }

    return null;
  }
}
