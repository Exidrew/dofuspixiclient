import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  SpellListSchema,
  type SpellMoveRequest,
  SpellMoveRequestSchema,
} from "@dofus/proto/spells_pb";
import { SpellsService } from "@modules/spells/spells.service";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * Handles `SM` — the client dropping a spell onto a hotbar slot.
 *
 * The canonical Dofus 1.29 client sends `<spellId>|<newSlot>` when the
 * player drags a spell from the spellbook into the action bar (or moves
 * one slot to another). Before this handler, the message was parsed by
 * the gateway but had no consumer, so dragging a spell was a no-op and
 * the bar never reflected the player's choice — the spellbar was locked
 * to whatever `player_spells.position` the migrations had seeded.
 *
 * Semantics: swap with any spell already occupying the target slot so
 * neither is lost (matches the official behaviour and item-move). After
 * the update we re-emit the whole SpellList so the client resynchronises
 * without needing a dedicated SpellMove frame.
 */
@Injectable()
export class SpellMoveHandler {
  private readonly logger = new Logger(SpellMoveHandler.name);

  constructor(
    @Inject(SessionRegistry) private readonly sessions: SessionRegistry,
    @Inject(SpellsService) private readonly spells: SpellsService,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(SpellMoveRequestSchema)
  async handle(ctx: HandlerContext, msg: SpellMoveRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const playerId = String(session.characterId);

    // Positions are 1-based end-to-end (class_starter_spells seeds them
    // 1..N, the Dofus `SM` wire slot is 1..N, and player_spells stores
    // 1..N). The client sends the clicked hotbar index + 1, so no
    // conversion is needed here.
    const newSlot = msg.newSlot;
    if (newSlot < 1) {
      return;
    }

    const updates = await this.spells.moveSpell(playerId, msg.spellId, newSlot);
    if (updates.length === 0) {
      this.logger.debug(
        `spell-move ignored: spell ${msg.spellId} not known by ${playerId}`
      );
      return;
    }

    // Re-emit the full spell list so the client rebuilds the bar with the
    // new positions — no dedicated SpellMove frame is wired client-side.
    const list = await this.spells.buildSpellList(playerId);
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellList",
          value: create(SpellListSchema, { spells: list }),
        },
      })
    );
  }
}
