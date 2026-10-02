import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type AccountCreateAccount,
  AccountCreateAccountResponseSchema,
  AccountCreateAccountSchema,
  RegisterError,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { RegisterRepository } from "@features/auth/register/register.repository";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isAcceptablePasswordKey,
  isValidPseudo,
  isValidUsername,
} from "@shared/account/account-validation";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";

/**
 * Self-service account creation (authd).
 *
 * The client stretches the password exactly like the login path (PBKDF2 over
 * a username-derived salt) and sends the base64 key. We persist that key as
 * `pwd_hash` and fan out `account_servers` rows so the freshly-created account
 * can immediately see and select the live game servers.
 *
 * Nothing is attached to the session here: after a successful signup the
 * client is expected to log in normally (accountSendIdentity), which keeps a
 * single source of truth for "what does an authenticated session look like".
 */
@Injectable()
export class RegisterHandler {
  private readonly logger = new Logger(RegisterHandler.name);

  constructor(
    @Inject(RegisterRepository) private readonly repo: RegisterRepository,
    @Inject(GatewayFrameService) private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(AccountCreateAccountSchema)
  async handle(ctx: HandlerContext, msg: AccountCreateAccount): Promise<void> {
    const username = msg.username.normalize().trim();
    const pseudo = msg.pseudo.trim() || username;

    if (!isValidUsername(username)) {
      return this.reject(ctx, RegisterError.INVALID_USERNAME);
    }
    if (!isAcceptablePasswordKey(msg.encryptedPassword)) {
      return this.reject(ctx, RegisterError.WEAK_PASSWORD);
    }
    if (!isValidPseudo(pseudo)) {
      return this.reject(ctx, RegisterError.INVALID_PSEUDO);
    }

    try {
      const existing = await this.repo.findByUsername(username);
      if (existing) {
        return this.reject(ctx, RegisterError.INVALID_USERNAME);
      }

      const accountId = await this.repo.insertAccount({
        username,
        pwdHash: msg.encryptedPassword,
        pseudo,
      });

      // Lost the race against a concurrent signup — same outcome for the
      // caller as an explicit duplicate check.
      if (!accountId) {
        return this.reject(ctx, RegisterError.INVALID_USERNAME);
      }

      const serverIds = await this.repo.listOnlineServerIds();
      await this.repo.grantServerAccess(accountId, serverIds);

      this.logger.log(
        `account created: ${username} (id=${accountId}) servers=[${serverIds.join(",")}]`
      );

      this.respond(ctx, true, RegisterError.UNSPECIFIED);
    } catch (err) {
      this.logger.error(`signup failed for ${username}`, err as Error);
      this.reject(ctx, RegisterError.BACKEND);
    }
  }

  private respond(
    ctx: HandlerContext,
    success: boolean,
    errorCode: RegisterError
  ): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountCreateAccountResponse",
          value: create(AccountCreateAccountResponseSchema, {
            success,
            errorCode,
          }),
        },
      })
    );
  }

  private reject(ctx: HandlerContext, errorCode: RegisterError): void {
    this.respond(ctx, false, errorCode);
  }
}
