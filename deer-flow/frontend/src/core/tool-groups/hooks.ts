import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listToolGroups, updateToolGroup } from "./api";

export function useToolGroups() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tool-groups"],
    queryFn: listToolGroups,
  });
  return { toolGroups: data ?? [], isLoading, error };
}

export function useEnableToolGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupName, enabled }: { groupName: string; enabled: boolean }) =>
      updateToolGroup(groupName, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tool-groups"] });
    },
  });
}
