import { MapsModule } from "@modules/maps/maps.module";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { MonsterMovementService } from "@modules/monsters/monster-movement.service";
import { MonstersRepository } from "@modules/monsters/monsters.repository";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, PlayerPresenceModule],
  providers: [MonstersRepository, MapMonsterService, MonsterMovementService],
  exports: [MonstersRepository, MapMonsterService],
})
export class MonstersModule {}
