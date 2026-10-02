import { RegisterHandler } from "@features/auth/register/register.handler";
import { RegisterRepository } from "@features/auth/register/register.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [RegisterHandler, RegisterRepository],
})
export class RegisterModule {}
