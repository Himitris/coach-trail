import { useQuery } from "@tanstack/react-query";
import { fetchSources } from "../api/endpoints";

/** État des sources (lecture de la base locale) : badge d'en-tête et page « Sources ». */
export function useSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
