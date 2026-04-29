import type { AIMessage } from "@langchain/langgraph-sdk";

export interface Subtask {
  id: string;
  status: "in_progress" | "completed" | "failed";
  subagent_type: string;
  description: string;
  latestMessage?: AIMessage;
  /** Accumulated history of all subtask messages for expandable step viewing */
  messageHistory?: AIMessage[];
  prompt: string;
  result?: string;
  error?: string;
}
