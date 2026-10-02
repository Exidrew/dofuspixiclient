import { assign, setup } from "xstate";

import type { CharacterListEntry, ServerEntry } from "@/game/network/protocol";

export interface LoginContext {
  username: string;
  servers: ServerEntry[];
  selectedServerId: number | null;
  characters: CharacterListEntry[];
  selectedCharacterId: number | null;
  failureReason: string | null;
  /** Whether the last signup attempt succeeded (drives RegisterScreen copy). */
  registrationSucceeded: boolean;
  /** Error shown on the create-character screen, null when clear. */
  createCharacterError: string | null;
}

export type LoginMachineEvent =
  | { type: "START_LOGIN"; username: string }
  | { type: "AUTH_SUCCESS" }
  | { type: "AUTH_FAILURE"; reason: string }
  | { type: "SERVERS_RECEIVED"; servers: ServerEntry[] }
  | { type: "SELECT_SERVER"; serverId: number }
  | { type: "SERVER_SELECTED" }
  | { type: "CHARACTERS_RECEIVED"; characters: CharacterListEntry[] }
  | { type: "SELECT_CHARACTER"; characterId: number }
  | { type: "CHARACTER_LOADED" }
  | { type: "START_REGISTER" }
  | { type: "REGISTER_SUCCESS" }
  | { type: "REGISTER_FAILURE"; reason: string }
  | { type: "BACK_TO_LOGIN" }
  | { type: "OPEN_CREATE_CHARACTER" }
  | { type: "CANCEL_CREATE_CHARACTER" }
  | { type: "SUBMIT_CREATE_CHARACTER" }
  | { type: "CREATE_CHARACTER_SUCCESS" }
  | { type: "CREATE_CHARACTER_FAILURE"; reason: string }
  | { type: "LOGOUT" };

/**
 *   idle ──START_LOGIN──> authenticating ──AUTH_SUCCESS──> waitingServers
 *     │                        │ AUTH_FAILURE
 *     │                        ▼
 *     │                     failed
 *     │
 *     ├──START_REGISTER──> registering ──REGISTER_SUCCESS──> registered
 *     │                        │ REGISTER_FAILURE
 *     │                        ▼
 *     │                    registerFailed
 *     │
 *   waitingServers ──SERVERS_RECEIVED──> serverSelect
 *                            SELECT_SERVER
 *                            ▼
 *                         selectingServer ──SERVER_SELECTED──> waitingCharacters
 *                                                                  │ CHARACTERS_RECEIVED
 *                                                                  ▼
 *                                                              characterSelect
 *                     ┌───────────────────────┬──────────────────────┐
 *                     SELECT_CHARACTER   OPEN_CREATE_CHARACTER   CANCEL…
 *                     ▼                       ▼
 *             loadingCharacter         creatingCharacter ──SUBMIT_CREATE_CHARACTER──> submittingCharacter
 *                     │ CHARACTER_LOADED         │ CREATE_CHARACTER_FAILURE                │ CREATE_CHARACTER_SUCCESS / CHARACTERS_RECEIVED
 *                     ▼                           ▼                                          ▼
 *                  inGame                  createCharacterFailed ──OPEN_CREATE_CHARACTER──> creatingCharacter      characterSelect
 */
export const loginMachine = setup({
  types: {
    context: {} as LoginContext,
    events: {} as LoginMachineEvent,
  },
  actions: {
    storeUsername: assign(({ event }) =>
      event.type === "START_LOGIN" ? { username: event.username } : {}
    ),
    storeServers: assign(({ event }) =>
      event.type === "SERVERS_RECEIVED" ? { servers: event.servers } : {}
    ),
    selectServer: assign(({ event }) =>
      event.type === "SELECT_SERVER" ? { selectedServerId: event.serverId } : {}
    ),
    storeCharacters: assign(({ event }) =>
      event.type === "CHARACTERS_RECEIVED"
        ? { characters: event.characters }
        : {}
    ),
    selectCharacter: assign(({ event }) =>
      event.type === "SELECT_CHARACTER"
        ? { selectedCharacterId: event.characterId }
        : {}
    ),
    storeFailure: assign(({ event }) =>
      event.type === "AUTH_FAILURE" ? { failureReason: event.reason } : {}
    ),
    storeRegisterFailure: assign(({ event }) => {
      if (event.type === "REGISTER_FAILURE") {
        return { failureReason: event.reason, registrationSucceeded: false };
      }
      if (event.type === "START_REGISTER") {
        return { failureReason: null };
      }
      if (event.type === "REGISTER_SUCCESS") {
        return { failureReason: null, registrationSucceeded: true };
      }
      return {};
    }),
    storeCreateCharacterError: assign(({ event }) => {
      if (event.type === "CREATE_CHARACTER_FAILURE") {
        return { createCharacterError: event.reason };
      }
      if (
        event.type === "OPEN_CREATE_CHARACTER" ||
        event.type === "CREATE_CHARACTER_SUCCESS"
      ) {
        return { createCharacterError: null };
      }
      return {};
    }),
    reset: assign(() => ({
      username: "",
      servers: [],
      selectedServerId: null,
      characters: [],
      selectedCharacterId: null,
      failureReason: null,
      registrationSucceeded: false,
      createCharacterError: null,
    })),
  },
}).createMachine({
  id: "login",
  initial: "idle",
  context: {
    username: "",
    servers: [],
    selectedServerId: null,
    characters: [],
    selectedCharacterId: null,
    failureReason: null,
    registrationSucceeded: false,
    createCharacterError: null,
  },
  states: {
    idle: {
      on: {
        START_LOGIN: { target: "authenticating", actions: "storeUsername" },
        START_REGISTER: {
          target: "registering",
          actions: "storeRegisterFailure",
        },
      },
    },
    authenticating: {
      on: {
        AUTH_SUCCESS: { target: "waitingServers" },
        AUTH_FAILURE: { target: "failed", actions: "storeFailure" },
        START_REGISTER: {
          target: "registering",
          actions: "storeRegisterFailure",
        },
      },
    },
    registering: {
      on: {
        REGISTER_SUCCESS: {
          target: "registered",
          actions: "storeRegisterFailure",
        },
        REGISTER_FAILURE: {
          target: "registerFailed",
          actions: "storeRegisterFailure",
        },
        BACK_TO_LOGIN: { target: "idle", actions: "reset" },
      },
    },
    registered: {
      on: {
        BACK_TO_LOGIN: {
          target: "idle",
          actions: assign(({ context }) => ({
            username: context.username,
            registrationSucceeded: true,
            failureReason: null,
          })),
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    registerFailed: {
      on: {
        START_REGISTER: {
          target: "registering",
          actions: "storeRegisterFailure",
        },
        BACK_TO_LOGIN: { target: "idle", actions: "reset" },
      },
    },
    waitingServers: {
      on: {
        SERVERS_RECEIVED: { target: "serverSelect", actions: "storeServers" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    serverSelect: {
      on: {
        SELECT_SERVER: {
          target: "selectingServer",
          actions: "selectServer",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    selectingServer: {
      on: {
        SERVER_SELECTED: { target: "waitingCharacters" },
        AUTH_FAILURE: { target: "serverSelect", actions: "storeFailure" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    waitingCharacters: {
      on: {
        CHARACTERS_RECEIVED: {
          target: "characterSelect",
          actions: "storeCharacters",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    characterSelect: {
      on: {
        // The fresh list pushed right after a successful creation (or a
        // reconnect) must refresh the grid even once we're already back on
        // this screen.
        CHARACTERS_RECEIVED: {
          target: "characterSelect",
          actions: "storeCharacters",
        },
        SELECT_CHARACTER: {
          target: "loadingCharacter",
          actions: "selectCharacter",
        },
        OPEN_CREATE_CHARACTER: {
          target: "creatingCharacter",
          actions: "storeCreateCharacterError",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    creatingCharacter: {
      on: {
        // The form is filled in and the user pressed "Créer le personnage".
        // The request is in flight from here on — the screen disables the
        // submit button while `submittingCharacter` is active.
        SUBMIT_CREATE_CHARACTER: { target: "submittingCharacter" },
        CANCEL_CREATE_CHARACTER: { target: "characterSelect" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    submittingCharacter: {
      on: {
        // The server echoes the refreshed character list on success; we
        // accept either explicit success or the list itself as the signal.
        CREATE_CHARACTER_SUCCESS: {
          target: "characterSelect",
          actions: "storeCreateCharacterError",
        },
        CHARACTERS_RECEIVED: {
          target: "characterSelect",
          actions: ["storeCharacters", "storeCreateCharacterError"],
        },
        CREATE_CHARACTER_FAILURE: {
          target: "createCharacterFailed",
          actions: "storeCreateCharacterError",
        },
        CANCEL_CREATE_CHARACTER: { target: "characterSelect" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    createCharacterFailed: {
      on: {
        OPEN_CREATE_CHARACTER: {
          target: "creatingCharacter",
          actions: "storeCreateCharacterError",
        },
        CANCEL_CREATE_CHARACTER: { target: "characterSelect" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    loadingCharacter: {
      on: {
        CHARACTER_LOADED: { target: "inGame" },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    inGame: {
      on: {
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
    failed: {
      on: {
        START_LOGIN: { target: "authenticating", actions: "storeUsername" },
        START_REGISTER: {
          target: "registering",
          actions: "storeRegisterFailure",
        },
        LOGOUT: { target: "idle", actions: "reset" },
      },
    },
  },
});

export type LoginMachine = typeof loginMachine;
