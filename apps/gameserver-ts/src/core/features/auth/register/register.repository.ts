import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Inject, Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * Persistence for the self-service account signup flow.
 *
 * `accounts.username` is UNIQUE (migration 0001) so the insert is the
 * authoritative "already taken" check — we never rely on a SELECT-then-INSERT
 * race. `pwd_hash` stores the PBKDF2 key the client already derived (see
 * apps/electrobun/src/game/auth/pbkdf2.ts); the salt is deterministic on the
 * lowercase username, matching what the login path would recompute.
 */
@Injectable()
export class RegisterRepository {
  constructor(
    @Inject(TransactionHost)
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByUsername(username: string) {
    return this.txHost.tx
      .selectFrom("accounts")
      .select(["id", "username"])
      .where("username", "=", username)
      .executeTakeFirst();
  }

  /** Returns the new account id, or null when the username is already taken. */
  async insertAccount(input: {
    username: string;
    pwdHash: string;
    pseudo: string;
  }): Promise<string | null> {
    const row = await this.txHost.tx
      .insertInto("accounts")
      .values({
        username: input.username,
        pwdHash: input.pwdHash,
        pseudo: input.pseudo,
        community: 0,
        isAdmin: false,
        isBanned: false,
        question: "",
        answer: "",
        lastLoginAt: null,
        lastLoginIp: null,
      })
      .onConflict((oc) => oc.column("username").doNothing())
      .returning("id")
      .executeTakeFirst();

    return row ? String(row.id) : null;
  }

  /**
   * Every ONLINE game server the fresh account should be able to reach.
   * Without an account_servers row the server list comes back empty and the
   * player can never select a server, so we fan out one row per live server.
   */
  listOnlineServerIds(): Promise<number[]> {
    return this.txHost.tx
      .selectFrom("gameServers")
      .select("id")
      .where("state", "=", 1)
      .execute()
      .then((rows) => rows.map((r) => r.id));
  }

  async grantServerAccess(
    accountId: string,
    serverIds: number[]
  ): Promise<void> {
    if (serverIds.length === 0) {
      return;
    }
    await this.txHost.tx
      .insertInto("accountServers")
      .values(
        serverIds.map((serverId) => ({
          accountId,
          serverId,
          characterCount: 0,
        }))
      )
      .onConflict((oc) => oc.columns(["accountId", "serverId"]).doNothing())
      .execute();
  }
}
