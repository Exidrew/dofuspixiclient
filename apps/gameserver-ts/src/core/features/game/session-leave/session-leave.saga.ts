import type { Session } from "@shared/gateway-adapter/session-registry";
import { create } from "@bufbuild/protobuf";
import {
  GameMovementSchema,
  SpriteMovementEntry_Operation,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

type SessionClosedPayload = {
  session: Session;
  reason: string;
};

@Injectable()
export class SessionLeaveSaga implements OnModuleInit {
  private readonly logger = new Logger(SessionLeaveSaga.name);

  constructor(
    @Inject(PlayerPresenceService)
    private readonly presence: PlayerPresenceService,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2
  ) {}

  // Imperative subscription instead of NestJS' legacy `@OnEvent` decorator:
  // that decorator reads `descriptor.value` and breaks under Bun's Stage-3 /
  // ES decorator transpilation (TypeError at module load). See login.handshake.ts
  // for the full explanation.
  onModuleInit(): void {
    this.events.on("session.closed", (payload: SessionClosedPayload) =>
      this.onSessionClosed(payload)
    );
  }

  onSessionClosed({ session, reason }: SessionClosedPayload) {
    const player = this.presence.leaveBySession(session.sessionId);

    if (!player) {
      return;
    }

    const peers = this.presence.sessionsOnMap(player.mapId);

    if (peers.length > 0) {
      this.frames.broadcast(
        peers,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, {
              entries: [
                toSpriteEntry(player, SpriteMovementEntry_Operation.REMOVE),
              ],
            }),
          },
        })
      );
    }

    this.logger.log(
      `leave: character=${player.characterId} map=${player.mapId} reason=${reason}`
    );
  }
}
