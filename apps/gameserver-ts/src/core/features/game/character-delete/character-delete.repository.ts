import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Inject, Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class CharacterDeleteRepository {
  constructor(
    @Inject(TransactionHost)
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /**
   * Soft-delete a character owned by the account on this server.
   *
   * Scoped by accountId + serverId so a client can never delete another
   * account's character by guessing its id. Only live rows
   * (deletedAt IS NULL) are candidates; returns true when a row was flipped.
   */
  async deleteForAccount(
    playerId: string,
    accountId: string,
    serverId: number
  ): Promise<boolean> {
    const result = await this.txHost.tx
      .updateTable("players")
      .set({ deletedAt: new Date() })
      .where("id", "=", playerId)
      .where("accountId", "=", accountId)
      .where("serverId", "=", serverId)
      .where("deletedAt", "is", null)
      .returning("id")
      .executeTakeFirst();

    return Boolean(result);
  }
}
