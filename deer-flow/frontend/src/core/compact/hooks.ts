import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type CompactConfig, loadCompactConfig, updateCompactConfig } from "./api";

export function useCompactConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["compact-config"],
    queryFn: loadCompactConfig,
  });
  return { config: data ?? null, isLoading, error };
}

export function useUpdateCompactConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CompactConfig>) => updateCompactConfig(patch),
    onSuccess: (updated) => {
      qc.setQueryData(["compact-config"], updated);
    },
  });
}
