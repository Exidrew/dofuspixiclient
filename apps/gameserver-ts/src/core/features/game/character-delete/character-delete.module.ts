import { CharacterDeleteHandler } from "@features/game/character-delete/character-delete.handler";
import { CharacterDeleteRepository } from "@features/game/character-delete/character-delete.repository";
import { CharacterListModule } from "@features/game/character-list/character-list.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [CharacterListModule],
  providers: [CharacterDeleteHandler, CharacterDeleteRepository],
})
export class CharacterDeleteModule {}
