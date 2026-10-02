import { CharacterCreateHandler } from "@features/game/character-create/character-create.handler";
import { CharacterCreateRepository } from "@features/game/character-create/character-create.repository";
import { CharacterListModule } from "@features/game/character-list/character-list.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [CharacterListModule],
  providers: [CharacterCreateHandler, CharacterCreateRepository],
})
export class CharacterCreateModule {}
