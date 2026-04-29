import { createContext, useCallback, useContext, useState } from "react";

import type { Subtask } from "./types";

export interface SubtaskContextValue {
  tasks: Record<string, Subtask>;
  setTasks: (tasks: Record<string, Subtask>) => void;
}

export const SubtaskContext = createContext<SubtaskContextValue>({
  tasks: {},
  setTasks: () => {
    /* noop */
  },
});

export function SubtasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Record<string, Subtask>>({});
  return (
    <SubtaskContext.Provider value={{ tasks, setTasks }}>
      {children}
    </SubtaskContext.Provider>
  );
}

export function useSubtaskContext() {
  const context = useContext(SubtaskContext);
  if (context === undefined) {
    throw new Error(
      "useSubtaskContext must be used within a SubtaskContext.Provider",
    );
  }
  return context;
}

export function useSubtask(id: string) {
  const { tasks } = useSubtaskContext();
  return tasks[id];
}

export function useUpdateSubtask() {
  const { tasks, setTasks } = useSubtaskContext();
  const updateSubtask = useCallback(
    (task: Partial<Subtask> & { id: string }) => {
      const existing = tasks[task.id];
      // Accumulate messageHistory: append latestMessage only when genuinely new
      let newHistory = existing?.messageHistory ?? [];
      if (task.latestMessage) {
        const lastHistoryId = newHistory.length > 0
          ? newHistory[newHistory.length - 1]?.id
          : undefined;
        // Only append if this message isn't already the last entry (avoid SSE duplicates)
        if (task.latestMessage.id !== lastHistoryId) {
          newHistory = [...newHistory, task.latestMessage];
        }
      }
      tasks[task.id] = { ...existing, ...task, messageHistory: newHistory } as Subtask;
      setTasks({ ...tasks });
    },
    [tasks, setTasks],
  );
  return updateSubtask;
}
