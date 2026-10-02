import type { MessageHandler } from "@/game/network/message-handler";
import type {
  AccountCharacterAdd,
  AccountCharacterDelete,
  AccountCharacterSelected,
  AccountCharactersList,
  AccountCreateAccountResponse,
  AccountLoginResponse,
  AccountSelectServer,
  AccountServersList,
  HandshakeConnectionKey,
} from "@/game/network/protocol";
import { loginActor } from "@/game/machines/actors";
import {
  LoginError,
  RegisterError,
  SelectServerError,
} from "@/game/network/protocol";
import { createLogger } from "@/utils/logger";

const log = createLogger("AuthHandler");

export interface AuthHandlerState {
  connectionKey: string | null;
  ticket: string | null;
  selectedCharacter: AccountCharacterSelected | null;
}

/**
 * Handles the pre-game protobuf flow:
 *   HandshakeConnectionKey (ignored — PBKDF2 replaces Vigenere)
 *   AccountCreateAccountResponse → REGISTER_SUCCESS / REGISTER_FAILURE
 *   AccountLoginResponse   → AUTH_SUCCESS / AUTH_FAILURE
 *   AccountServersList     → SERVERS_RECEIVED
 *   AccountSelectServer    → SERVER_SELECTED
 *   AccountCharactersList  → CHARACTERS_RECEIVED
 *   AccountCharacterAdd    → CREATE_CHARACTER_SUCCESS / CREATE_CHARACTER_FAILURE
 *   AccountCharacterSelected → CHARACTER_LOADED
 */
export class AuthHandler {
  private state: AuthHandlerState = {
    connectionKey: null,
    ticket: null,
    selectedCharacter: null,
  };

  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  getState(): Readonly<AuthHandlerState> {
    return this.state;
  }

  private register(): void {
    this.messageHandler.on(
      "handshakeConnectionKey",
      (payload: HandshakeConnectionKey) => {
        this.state.connectionKey = payload.connectionKey;
        log.debug("Handshake key received");
      }
    );

    this.messageHandler.on(
      "accountCreateAccountResponse",
      (payload: AccountCreateAccountResponse) => {
        if (payload.success) {
          log.info("Signup OK");
          loginActor.send({ type: "REGISTER_SUCCESS" });
          return;
        }
        const reason = describeRegisterError(payload.errorCode);
        log.warn("Signup failed:", reason);
        loginActor.send({ type: "REGISTER_FAILURE", reason });
      }
    );

    this.messageHandler.on("accountLogin", (payload: AccountLoginResponse) => {
      if (payload.success) {
        log.info("Login OK");
        loginActor.send({ type: "AUTH_SUCCESS" });
        return;
      }
      const reason = describeLoginError(payload);
      log.warn("Login failed:", reason);
      loginActor.send({ type: "AUTH_FAILURE", reason });
    });

    this.messageHandler.on(
      "accountServersList",
      (payload: AccountServersList) => {
        log.info(`Servers: ${payload.servers.length}`);
        loginActor.send({
          type: "SERVERS_RECEIVED",
          servers: payload.servers,
        });
      }
    );

    this.messageHandler.on(
      "accountSelectServer",
      (payload: AccountSelectServer) => {
        if (!payload.success) {
          const reason = describeSelectServerError(payload.errorCode);
          log.warn("Server select failed:", reason);
          loginActor.send({ type: "AUTH_FAILURE", reason });
          return;
        }
        this.state.ticket = payload.ticket;
        log.info(`Server selected, ticket acquired`);
        loginActor.send({ type: "SERVER_SELECTED" });
      }
    );

    this.messageHandler.on(
      "accountCharactersList",
      (payload: AccountCharactersList) => {
        log.info(`Characters: ${payload.characters.length}`);
        loginActor.send({
          type: "CHARACTERS_RECEIVED",
          characters: payload.characters,
        });
      }
    );

    this.messageHandler.on(
      "accountCharacterAdd",
      (payload: AccountCharacterAdd) => {
        if (payload.success) {
          log.info("Character created");
          // The server follows up with a fresh accountCharactersList, which
          // drives the real state transition; this is just an early signal.
          loginActor.send({ type: "CREATE_CHARACTER_SUCCESS" });
          return;
        }
        const reason = describeCreateCharacterError(payload.errorCode);
        log.warn("Character creation failed:", reason);
        loginActor.send({ type: "CREATE_CHARACTER_FAILURE", reason });
      }
    );

    this.messageHandler.on(
      "accountCharacterDelete",
      (payload: AccountCharacterDelete) => {
        if (payload.success) {
          log.info("Character deleted");
        } else {
          log.warn("Character deletion failed");
        }
        // The refreshed accountCharactersList follows and drives the grid.
      }
    );

    this.messageHandler.on(
      "accountCharacterSelected",
      (payload: AccountCharacterSelected) => {
        if (!payload.success) {
          log.warn("Character selection failed");
          loginActor.send({
            type: "AUTH_FAILURE",
            reason: "character-select-failed",
          });
          return;
        }
        this.state.selectedCharacter = payload;
        log.info(`Character loaded: ${payload.characterName}`);
        loginActor.send({ type: "CHARACTER_LOADED" });
      }
    );
  }
}

function describeLoginError(payload: AccountLoginResponse): string {
  switch (payload.errorCode) {
    case LoginError.VERSION_MISMATCH:
      return `version mismatch (required: ${payload.requiredVersion})`;
    case LoginError.KICKED:
      return payload.kickMessage || payload.kickTitle || "account kicked";
    case LoginError.INVALID_CREDENTIALS:
      return "invalid credentials";
    case LoginError.BANNED:
      return "account banned";
    case LoginError.ALREADY_ONLINE:
      return "already online";
    case LoginError.MALFORMED:
      return "malformed request";
    case LoginError.BACKEND:
      return "backend error";
    case LoginError.QUEUED:
      return "queued";
    case LoginError.UNSPECIFIED:
      return "unknown error";
    default:
      return `error code: ${payload.errorCode}`;
  }
}

function describeRegisterError(code: RegisterError): string {
  switch (code) {
    case RegisterError.INVALID_USERNAME:
      return "Ce nom de compte est déjà pris ou invalide.";
    case RegisterError.WEAK_PASSWORD:
      return "Mot de passe trop faible (8 caractères minimum).";
    case RegisterError.INVALID_PSEUDO:
      return "Pseudo invalide.";
    case RegisterError.BACKEND:
      return "Erreur serveur, réessaie dans un instant.";
    default:
      return "Inscription impossible.";
  }
}

function describeCreateCharacterError(code: string): string {
  switch (code) {
    case "a":
      return "Ce nom de personnage est déjà utilisé.";
    case "n":
      return "Nom invalide (3 à 20 lettres).";
    case "f":
      return "Tu as atteint le nombre maximum de personnages.";
    case "s":
      return "Abonnement requis.";
    default:
      return "Création impossible, erreur serveur.";
  }
}

function describeSelectServerError(code: SelectServerError): string {
  switch (code) {
    case SelectServerError.DOWN:
      return "server down";
    case SelectServerError.FULL:
      return "server full";
    case SelectServerError.FULL_NON_MEMBER:
      return "non-member queue full";
    case SelectServerError.SHOP:
      return "shop only";
    case SelectServerError.RESTRICTED:
      return "access restricted";
    case SelectServerError.NOT_FOUND:
      return "server not found";
    case SelectServerError.UNKNOWN:
      return "unknown select-server error";
    case SelectServerError.UNSPECIFIED:
    default:
      return "server-select-failed";
  }
}
