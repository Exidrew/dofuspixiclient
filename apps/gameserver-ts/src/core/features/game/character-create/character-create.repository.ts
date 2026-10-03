import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Inject, Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import {
  breedSpellRange,
  breedStarterAttack,
} from "@shared/account/account-validation";

export interface NewCharacterInput {
  accountId: string;
  serverId: number;
  name: string;
  class: number;
  sex: number;
  gfx: number;
  color1: number;
  color2: number;
  color3: number;
  mapId: number;
  cellId: number;
}

/**
 * Minimal starter stats so a fresh level-1 character can actually fight.
 * AP (6) and MP (3) are NOT stored here — they are hardcoded Dofus 1.29 base
 * values applied by `Fighter.fromPlayer` / `Runner.refreshFighter` and shown
 * by `StatsService.sendStats`. These six elemental characteristics give every
 * spell a non-zero damage roll (see `calculateDamage`: stat scales the dice).
 * A small uniform spread (all 6) keeps every breed playable regardless of its
 * element while staying trivially re-specable with level-up points.
 */
const STARTER_STATS = {
  strength: 6,
  vitality: 6,
  wisdom: 6,
  intelligence: 6,
  chance: 6,
  agility: 6,
} as const;

@Injectable()
export class CharacterCreateRepository {
  constructor(
    @Inject(TransactionHost)
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /** Live character count for the account on this server (cap check). */
  async countCharacters(accountId: string, serverId: number): Promise<number> {
    const rows = await this.txHost.tx
      .selectFrom("players")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("accountId", "=", accountId)
      .where("serverId", "=", serverId)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
    return Number(rows?.count ?? 0);
  }

  /** Case-insensitive name clash on the same server (uq_players_server_name). */
  async nameTaken(serverId: number, name: string): Promise<boolean> {
    const row = await this.txHost.tx
      .selectFrom("players")
      .select("id")
      .where("serverId", "=", serverId)
      .where("name", "ilike", name)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * Insert the whole character graph in one transaction:
   *   players + player_stats + player_colors + player_spells.
   *
   * `player_stats` is required (INNER JOIN in the select-character path) and
   * `player_colors` too (client renders the three tint slots). Starter spells
   * come from `class_starter_spells` when seeded; otherwise we fall back to the
   * canonical per-breed spell-id range filtered by existing templates.
   */
  async create(input: NewCharacterInput): Promise<string> {
    return this.txHost.withTransaction(async () => {
      const tx = this.txHost.tx;

      const player = await tx
        .insertInto("players")
        .values({
          accountId: input.accountId,
          serverId: input.serverId,
          name: input.name,
          sex: input.sex,
          class: input.class,
          gfx: input.gfx,
          level: 1,
          experience: "0",
          kamas: "0",
          statsPoints: 0,
          spellPoints: 0,
          life: 55,
          energy: 10000,
          mapId: input.mapId,
          cellId: input.cellId,
          direction: 3,
          savepointMapId: input.mapId,
          savepointCellId: input.cellId,
          channels: 0,
          alignment: 0,
          alignmentValue: 0,
          alignmentGrade: 0,
          pvpEnabled: false,
          restrictions: "0",
          // 1000 is the schema default and the canonical ladder baseline;
          // stated explicitly because the Kysely type marks the column as
          // non-optional (SQL has a DEFAULT but the type does not).
          mmr: 1000,
          koliseumPoints: 0,
          activeTitleId: 0,
          mountXpShare: 0,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const playerId = String(player.id);

      await tx
        .insertInto("playerStats")
        .values({
          playerId,
          strength: STARTER_STATS.strength,
          vitality: STARTER_STATS.vitality,
          wisdom: STARTER_STATS.wisdom,
          intelligence: STARTER_STATS.intelligence,
          chance: STARTER_STATS.chance,
          agility: STARTER_STATS.agility,
        })
        .onConflict((oc) => oc.column("playerId").doNothing())
        .execute();

      await tx
        .insertInto("playerColors")
        .values({
          playerId,
          color1: input.color1,
          color2: input.color2,
          color3: input.color3,
        })
        .onConflict((oc) => oc.column("playerId").doNothing())
        .execute();

      const spells = await this.resolveStarterSpells(input.class);
      if (spells.length > 0) {
        await tx
          .insertInto("playerSpells")
          .values(
            spells.map((s) => ({
              playerId,
              spellId: s.spellId,
              level: s.level,
              position: s.position,
            }))
          )
          .onConflict((oc) => oc.columns(["playerId", "spellId"]).doNothing())
          .execute();
      }

      return playerId;
    });
  }

  /**
   * Prefer the explicit `class_starter_spells` table (positions 1..N). When
   * empty — nothing seeds it today — fall back to the breed's canonical
   * spell-id range, keeping only ids that actually exist in `spell_templates`
   * so the client never references a missing spell.
   */
  private async resolveStarterSpells(
    classId: number
  ): Promise<Array<{ spellId: number; level: number; position: number }>> {
    const starters = await this.txHost.tx
      .selectFrom("classStarterSpells")
      .select(["spellId", "level", "position"])
      .where("classId", "=", classId)
      .orderBy("position", "asc")
      .execute();

    if (starters.length > 0) {
      return starters.map((s) => ({
        spellId: s.spellId,
        level: s.level ?? 1,
        position: s.position ?? -1,
      }));
    }

    const range = breedSpellRange(classId);
    if (!range) {
      return [];
    }

    const templates = await this.txHost.tx
      .selectFrom("spellTemplates")
      .select("id")
      .where("id", ">=", range.lo)
      .where("id", "<=", range.hi)
      .orderBy("id", "asc")
      .execute();

    // Pin the breed's canonical level-1 attack to position 1 so a fresh
    // character can attack immediately even before the spell book is opened.
    const attack = breedStarterAttack(classId);
    const ordered = attack
      ? [
          ...templates.filter((t) => t.id === attack),
          ...templates.filter((t) => t.id !== attack),
        ]
      : templates;

    return ordered.map((t, i) => ({
      spellId: t.id,
      level: 1,
      position: i + 1,
    }));
  }
}
