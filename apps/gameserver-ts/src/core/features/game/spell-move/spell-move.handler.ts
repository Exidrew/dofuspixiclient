import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  SpellListSchema,
  type SpellMoveRequest,
  SpellMoveRequestSchema,
} from "@dofus/proto/spells_pb";
import { SpellsRepository } from "@modules/spells/spells.repository";
import { SpellsService } from "@modules/spells/spells.service";
import { Inject, Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/** Hotbar cells shown by the client banner (positions are 1-based). */
export const SPELL_HOTBAR_SLOTS = 14;

@Injectable()
export class SpellMoveHandler {
  constructor(
    @Inject(SessionRegistry) private readonly sessions: SessionRegistry,
    @Inject(SpellsRepository) private readonly repo: SpellsRepository,
    @Inject(SpellsService) private readonly spells: SpellsService,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(SpellMoveRequestSchema)
  async handle(ctx: HandlerContext, msg: SpellMoveRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    const slot = msg.newSlot;
    if (slot !== -1 && (slot < 1 || slot > SPELL_HOTBAR_SLOTS)) {
      return;
    }

    const moved = await this.repo.moveSpell(
      session.characterId,
      msg.spellId,
      slot
    );

    if (!moved) {
      return;
    }

    const spells = await this.spells.buildSpellList(session.characterId);
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellList",
          value: create(SpellListSchema, { spells }),
        },
      })
    );
  }
}
