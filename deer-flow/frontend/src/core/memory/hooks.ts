import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteMemoryFact,
  loadMemory,
  loadMemoryConfig,
  updateMemoryFact,
  updateMemoryModelName,
  updateMemorySection,
} from "./api";

export function useMemory() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory"],
    queryFn: () => loadMemory(),
  });
  return { memory: data ?? null, isLoading, error };
}

export function useDeleteMemoryFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (factId: string) => deleteMemoryFact(factId),
    onSuccess: (updated) => {
      qc.setQueryData(["memory"], updated);
    },
  });
}

export function useUpdateMemoryFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ factId, content }: { factId: string; content: string }) =>
      updateMemoryFact(factId, content),
    onSuccess: (updated) => {
      qc.setQueryData(["memory"], updated);
    },
  });
}

export function useUpdateMemorySection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ section, summary }: { section: string; summary: string }) =>
      updateMemorySection(section, summary),
    onSuccess: (updated) => {
      qc.setQueryData(["memory"], updated);
    },
  });
}

export function useMemoryConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory-config"],
    queryFn: () => loadMemoryConfig(),
  });
  return { config: data ?? null, isLoading, error };
}

export function useUpdateMemoryModelName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelName: string | null) => updateMemoryModelName(modelName),
    onSuccess: (updated) => {
      qc.setQueryData(["memory-config"], updated);
    },
  });
}
