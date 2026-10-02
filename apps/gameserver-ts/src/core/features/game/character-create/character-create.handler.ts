import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountCharacterAddSchema,
  AccountCharactersListSchema,
  type AccountCreateCharacter,
  AccountCreateCharacterSchema,
  CharacterListEntrySchema,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { CharacterCreateRepository } from "@features/game/character-create/character-create.repository";
import {
  CHARACTER_LEVEL_MAX,
  MAX_CHARACTERS_PER_ACCOUNT,
} from "@features/game/character-list/character-list.constants";
import { CharacterListRepository } from "@features/game/character-list/character-list.repository";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  gfxForClass,
  isValidCharacterName,
  isValidClassId,
  isValidSex,
} from "@shared/account/account-validation";
import { GameRuntimeConfig } from "@shared/config/game-runtime";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// Legacy Dofus 1.29 AA error codes (see AccountCharacterAdd.error_code).
const ERR_NAME_TAKEN = "a";
const ERR_BAD_NAME = "n";
const ERR_FULL = "f";
const ERR_BACKEND = "e";

const DEFAULT_COLOR = -1;
const DEFAULT_MAP_ID = 10300;
const DEFAULT_CELL_ID = 319;

/**
 * Character creation (gamed). Handles the `AccountCreateCharacter` (AA)
 * client message that already existed in the proto but had no server handler.
 *
 * On success we ack with `accountCharacterAdd { success: true }` AND push a
 * refreshed `accountCharactersList`, so the client's character-select screen
 * updates without a second round-trip.
 */
@Injectable()
export class CharacterCreateHandler {
  private readonly logger = new Logger(CharacterCreateHandler.name);
  private readonly gameServerId: number;

  constructor(
    @Inject(GameRuntimeConfig) runtime: GameRuntimeConfig,
    @Inject(CharacterCreateRepository)
    private readonly repo: CharacterCreateRepository,
    @Inject(CharacterListRepository)
    private readonly listRepo: CharacterListRepository,
    @Inject(SessionRegistry) private readonly sessions: SessionRegistry,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {
    this.gameServerId = runtime.serverId;
  }

  @MessageHandler(AccountCreateCharacterSchema)
  async handle(
    ctx: HandlerContext,
    msg: AccountCreateCharacter
  ): Promise<void> {
    const session = await this.sessions.waitForAuth(ctx.sessionId);

    if (!session?.accountId) {
      this.logger.warn(
        `character-create: unauthenticated session=${ctx.sessionId}`
      );
      return this.reject(ctx, ERR_BACKEND);
    }

    const name = msg.name.normalize().trim();

    if (!isValidCharacterName(name)) {
      return this.reject(ctx, ERR_BAD_NAME);
    }
    if (!isValidClassId(msg.classId) || !isValidSex(msg.sex)) {
      return this.reject(ctx, ERR_BAD_NAME);
    }

    try {
      const count = await this.repo.countCharacters(
        session.accountId,
        this.gameServerId
      );
      if (count >= MAX_CHARACTERS_PER_ACCOUNT) {
        return this.reject(ctx, ERR_FULL);
      }

      if (await this.repo.nameTaken(this.gameServerId, name)) {
        return this.reject(ctx, ERR_NAME_TAKEN);
      }

      const playerId = await this.repo.create({
        accountId: session.accountId,
        serverId: this.gameServerId,
        name,
        class: msg.classId,
        sex: msg.sex,
        gfx: gfxForClass(msg.classId),
        color1: msg.color1,
        color2: msg.color2,
        color3: msg.color3,
        mapId: DEFAULT_MAP_ID,
        cellId: DEFAULT_CELL_ID,
      });

      this.logger.log(
        `character created: ${name} (id=${playerId}) class=${msg.classId} account=${session.accountId}`
      );

      this.respond(ctx, true, "");
      await this.pushCharacters(ctx, session.accountId);
    } catch (err) {
      this.logger.error(`character-create failed for ${name}`, err as Error);
      // Unique-constraint race → surface as "name taken", not a backend error.
      const code =
        err instanceof Error &&
        /uq_players_server_name|duplicate key/i.test(err.message)
          ? ERR_NAME_TAKEN
          : ERR_BACKEND;
      this.reject(ctx, code);
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

  private reject(ctx: HandlerContext, errorCode: string): void {
    this.respond(ctx, false, errorCode);
  }

  private respond(
    ctx: HandlerContext,
    success: boolean,
    errorCode: string
  ): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCharacterAdd",
          value: create(AccountCharacterAddSchema, { success, errorCode }),
        },
      })
    );
  }
}
