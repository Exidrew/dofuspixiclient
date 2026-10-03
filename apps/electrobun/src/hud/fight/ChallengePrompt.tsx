import { useSyncExternalStore } from "react";

import { challengeStore } from "@/game/stores/challenge-store";

interface ChallengePromptProps {
  onAccept: () => void;
  onRefuse: () => void;
}

/**
 * Modal-ish prompt shown when another player challenges the local character
 * to a duel (GA 900 addressed to us). Accept → GA 901, Refuse → GA 902.
 *
 * Styled with the same classic HUD palette as the fight overlays (neutral
 * Tailwind + the action-popout menu tokens) so it reads as part of the game
 * chrome rather than a debug dialog.
 */
export function ChallengePrompt({ onAccept, onRefuse }: ChallengePromptProps) {
  const { incoming } = useSyncExternalStore(
    challengeStore.subscribe,
    challengeStore.getSnapshot
  );

  if (!incoming) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto fixed left-1/2 top-24 z-1000 -translate-x-1/2"
      style={{ pointerEvents: "auto" }}
    >
      <div className="min-w-[220px] border border-action-popout-menu-border bg-action-popout-menu-fg px-3 py-2 font-bitmini6 text-[9px] text-white shadow-lg">
        <div className="mb-2">
          <span className="text-action-popout-menu-static-text">
            {incoming.challengerName}
          </span>{" "}
          vous défie en duel !
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="cursor-pointer border border-action-popout-menu-border px-2 py-0.5 hover:bg-action-popout-menu-static-bg"
            onClick={onAccept}
          >
            Accepter
          </button>
          <button
            type="button"
            className="cursor-pointer border border-action-popout-menu-border px-2 py-0.5 hover:bg-action-popout-menu-static-bg"
            onClick={onRefuse}
          >
            Refuser
          </button>
        </div>
      </div>
    </div>
  );
}
