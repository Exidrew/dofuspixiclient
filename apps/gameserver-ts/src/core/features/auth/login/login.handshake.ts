import type { Session } from "@shared/gateway-adapter/session-registry";
import { create } from "@bufbuild/protobuf";
import { HandshakeConnectionKeySchema } from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

@Injectable()
export class LoginHandshake implements OnModuleInit {
  private readonly logger = new Logger(LoginHandshake.name);

  constructor(
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2
  ) {}

  // NOTE: subscription is done imperatively in onModuleInit instead of with
  // NestJS' legacy `@OnEvent` decorator. `@OnEvent` is a legacy decorator
  // ((target, key, descriptor) => ...) that reads `descriptor.value`; when Bun
  // transpiles under the Stage-3 / ES decorator semantics (which happens when
  // `--legacy-decorators` is not in effect, e.g. the gateway boot path), the
  // decorator is invoked as `(value, context)`, `descriptor` is undefined and
  // the module throws `TypeError: undefined is not an object (evaluating
  // 'descriptor.value')` at load time. Subscribing explicitly on the injected
  // EventEmitter2 has identical behaviour (NestJS' emitter delegates to
  // EventEmitter2) while being independent of decorator transpilation.
  onModuleInit(): void {
    this.events.on("session.opened", (session: Session) =>
      this.onSessionOpened(session)
    );
  }

  onSessionOpened(session: Session): void {
    const key = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    this.frames.broadcast(
      [session.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "handshakeConnectionKey",
          value: create(HandshakeConnectionKeySchema, {
            connectionKey: key,
          }),
        },
      })
    );

    this.logger.log(`Sent connection key to session=${session.sessionId}`);
  }
}
