import { LoginModule } from "@features/auth/login/login.module";
import { RegisterModule } from "@features/auth/register/register.module";
import { SelectServerModule } from "@features/auth/select-server/select-server.module";
import { ServerListModule } from "@features/auth/server-list/server-list.module";
import { Module } from "@nestjs/common";

// Authd feature bundle. Loaded by AppModule only when MODE=auth.

@Module({
  imports: [LoginModule, RegisterModule, ServerListModule, SelectServerModule],
})
export class AuthModule {}
