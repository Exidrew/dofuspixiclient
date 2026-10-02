import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountCharacterDeleteSchema,
  AccountCharactersListSchema,
  type AccountDeleteCharacter,
  AccountDeleteCharacterSchema,
  CharacterListEntrySchema,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { CharacterDeleteRepository } from "@features/game/character-delete/character-delete.repository";
import {
  CHARACTER_LEVEL_MAX,
  MAX_CHARACTERS_PER_ACCOUNT,
} from "@features/game/character-list/character-list.constants";
import { CharacterListRepository } from "@features/game/character-list/character-list.repository";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { GameRuntimeConfig } from "@shared/config/game-runtime";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const DEFAULT_COLOR = -1;

/**
 * Character deletion (gamed). Handles the `AccountDeleteCharacter` (AD)
 * client message that already existed in the proto but had no server
 * handler.
 *
 * Deletion is a SOFT delete (`players.deleted_at`), matching the column
 * already used by the list/create paths. On success we ack with
 * `accountCharacterDelete { success: true }` AND push a refreshed
 * `accountCharactersList`, so the client's character-select screen updates
 * without a second round-trip.
 */
@Injectable()
export class CharacterDeleteHandler {
  private readonly logger = new Logger(CharacterDeleteHandler.name);
  private readonly gameServerId: number;

  constructor(
    @Inject(GameRuntimeConfig) runtime: GameRuntimeConfig,
    @Inject(CharacterDeleteRepository)
    private readonly repo: CharacterDeleteRepository,
    @Inject(CharacterListRepository)
    private readonly listRepo: CharacterListRepository,
    @Inject(SessionRegistry) private readonly sessions: SessionRegistry,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {
    this.gameServerId = runtime.serverId;
  }

  @MessageHandler(AccountDeleteCharacterSchema)
  async handle(
    ctx: HandlerContext,
    msg: AccountDeleteCharacter
  ): Promise<void> {
    const session = await this.sessions.waitForAuth(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(
        `character-delete: unauthenticated session=${ctx.sessionId}`
      );
      return this.respond(ctx, false);
    }

    const playerId = String(msg.characterId);

    try {
      const deleted = await this.repo.deleteForAccount(
        playerId,
        session.accountId,
        this.gameServerId
      );

      if (!deleted) {
        this.logger.warn(
          `character-delete: not found/owned id=${playerId} account=${session.accountId}`
        );
        return this.respond(ctx, false);
      }

      this.logger.log(
        `character deleted: id=${playerId} account=${session.accountId}`
      );

      this.respond(ctx, true);
      await this.pushCharacters(ctx, session.accountId);
    } catch (err) {
      this.logger.error(`character-delete failed for ${playerId}`, err as Error);
      this.respond(ctx, false);
    }
  }

  private async pushCharacters(
    ctx: HandlerContext,
    accountId: string
  ): Promise<void> {
    const rows = await this.listRepo.listForAccount(
      accountId,
      this.gameServerId
    );

    const characters = rows.map((r) =>
      create(CharacterListEntrySchema, {
        id: r.id,
        name: r.name,
        level: r.level,
        gfxId: r.gfx,
        color1: r.color1 ?? DEFAULT_COLOR,
        color2: r.color2 ?? DEFAULT_COLOR,
        color3: r.color3 ?? DEFAULT_COLOR,
        serverId: r.serverId,
        levelMax: CHARACTER_LEVEL_MAX,
      })
    );

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCharactersList",
          value: create(AccountCharactersListSchema, {
            success: true,
            characterCount: MAX_CHARACTERS_PER_ACCOUNT,
            characters,
          }),
        },
      })
    );
  }

  private respond(ctx: HandlerContext, success: boolean): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCharacterDelete",
          value: create(AccountCharacterDeleteSchema, { success }),
        },
      })
    );
  }
}
