import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountLoginResponseSchema,
  type AccountSendIdentity,
  AccountSendIdentitySchema,
  LoginError,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { LoginRepository } from "@features/auth/login/login.repository";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class LoginHandler {
  private readonly logger = new Logger(LoginHandler.name);

  constructor(
    @Inject(LoginRepository) private readonly repo: LoginRepository,
    @Inject(SessionRegistry) private readonly sessions: SessionRegistry,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(AccountSendIdentitySchema)
  async handle(ctx: HandlerContext, msg: AccountSendIdentity): Promise<void> {
    const account = await this.repo.findByUsername(msg.username);

    if (!account) {
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    if (account.isBanned) {
      return this.reject(ctx, LoginError.BANNED);
    }

    // DEV ONLY: password verification disabled on purpose — any password is
    // accepted so the client can log in ("test"/"test") without depending on
    // a working password algorithm/hash in the DB.
    this.logger.warn(
      `password check DISABLED for ${msg.username} (account=${account.id})`
    );

    const session = this.sessions.get(ctx.sessionId);

    const addr = session?.remoteAddr;
    await this.repo.markLoggedIn(
      account.id,
      addr && addr !== "unknown" ? addr : null
    );

    this.sessions.attachAccount(ctx.sessionId, account.id);

    this.logger.log(
      `login ok: ${msg.username} → account=${account.id} session=${ctx.sessionId}`
    );

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountLogin",
          value: create(AccountLoginResponseSchema, {
            success: true,
            isAuthorized: true,
          }),
        },
      })
    );
  }

  private reject(ctx: HandlerContext, errorCode: LoginError): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountLogin",
          value: create(AccountLoginResponseSchema, {
            success: false,
            errorCode,
          }),
        },
      })
    );
  }
}
