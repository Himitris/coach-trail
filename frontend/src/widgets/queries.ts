import type { QueryClient } from "@tanstack/react-query";

/** Après une saisie ou une modification du programme, tout ce qui en dépend est relu. */
export function invalidateTraining(queryClient: QueryClient): Promise<void> {
  return Promise.all(
    ["plan", "entries", "metrics", "activities"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  ).then(() => undefined);
}

export const REFRESH_MS = 5 * 60_000;
