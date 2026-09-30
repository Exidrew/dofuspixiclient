import type { GameEnv } from "@shared/config/env.schema";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Typed runtime values the *game* core needs outside of the DI-bound
 * `ConfigService`.
 *
 * IMPORTANT: Bun's runtime does not honour tsconfig `emitDecoratorMetadata`,
 * and `bun --legacy-decorators` does not emit `design:paramtypes` either, so
 * NestJS cannot resolve a constructor parameter from its TypeScript type.
 * Every injected parameter therefore needs an explicit `Inject(<token>)`
 * parameter decorator. Consumers of this class must inject it explicitly,
 * e.g. `@Inject(GameRuntimeConfig) private readonly runtime:
 * GameRuntimeConfig` — a bare typed parameter resolves to `undefined` and
 * crashes at boot (e.g. `runtime.serverId`).
 *
 * Exposing the values through a concrete provider built with
 * `useFactory` + `inject: [ConfigService]` (the form already proven to work
 * under Bun in `db.module.ts` / `events.module.ts`) keeps `ConfigService`'s
 * generic typing out of every handler while giving them a plain injectable
 * class token.
 */
export class GameRuntimeConfig {
  readonly serverId: number;
  readonly langsDir: string;
  readonly defaultLocale: string;

  constructor(serverId: number, langsDir: string, defaultLocale: string) {
    this.serverId = serverId;
    this.langsDir = langsDir;
    this.defaultLocale = defaultLocale;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: GameRuntimeConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService<GameEnv, true>): GameRuntimeConfig =>
        new GameRuntimeConfig(
          config.get("GAME_SERVER_ID", { infer: true }),
          config.get("LANGS_DIR", { infer: true }),
          config.get("DEFAULT_LOCALE", { infer: true })
        ),
    },
  ],
  exports: [GameRuntimeConfig],
})
export class GameRuntimeConfigModule {}
