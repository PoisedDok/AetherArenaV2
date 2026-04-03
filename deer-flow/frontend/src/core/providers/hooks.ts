import { useMutation, useQuery } from "@tanstack/react-query";

import {
  fetchOpenRouterModels,
  fetchProviderModels,
  fetchProvidersHealth,
  testProviderKey,
} from "./api";

export function useProvidersHealth() {
  return useQuery({
    queryKey: ["providers-health"],
    queryFn: fetchProvidersHealth,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useTestProviderKey() {
  return useMutation({ mutationFn: testProviderKey });
}

export function useFetchProviderModels() {
  return useMutation({ mutationFn: fetchProviderModels });
}

export function useOpenRouterModels(enabled: boolean) {
  return useQuery({
    queryKey: ["openrouter-models"],
    queryFn: fetchOpenRouterModels,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: false,
  });
}
