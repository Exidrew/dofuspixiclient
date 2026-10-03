import { ExternalStore } from "@/game/stores/game-store";

/**
 * A pending PvP duel invitation received from another player.
 *
 * The server broadcasts ACTION_CHALLENGE_PROPOSAL (900) to everyone on the
 * map with the challenger's sprite id (`spriteId`) and the target's character
 * id (`rawParams`). We only surface the prompt when the target is US.
 */
export interface PendingChallenge {
  /** Challenger's character id (as a string). */
  challengerCharacterId: string;
  /** Challenger's display name, best-effort (from the world actor renderer). */
  challengerName: string;
}

export interface ChallengeState {
  [key: string]: unknown;
  /** Incoming duel invitation addressed to the local player, or null. */
  incoming: PendingChallenge | null;
  /**
   * Transient banner text for the local player (e.g. "Défi refusé", "En
   * combat..."). Auto-cleared by the caller.
   */
  notice: string | null;
}

const initialState: ChallengeState = {
  incoming: null,
  notice: null,
};

export const challengeStore = new ExternalStore<ChallengeState>(initialState);

export function setIncomingChallenge(challenge: PendingChallenge | null): void {
  challengeStore.setState({ incoming: challenge });
}

export function setChallengeNotice(notice: string | null): void {
  challengeStore.setState({ notice });
}

export function clearChallenge(): void {
  challengeStore.setState({ incoming: null });
}
