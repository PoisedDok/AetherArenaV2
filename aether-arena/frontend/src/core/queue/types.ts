export type QueuePriority = "now" | "next" | "later";

export interface QueuedMessage {
  id: string;
  threadId: string;
  text: string;
  priority: QueuePriority;
  timestamp: number;
  hasAttachments: boolean;
}

export type MessageQueueListener = () => void;

export const MAX_QUEUE_SIZE = 50;
