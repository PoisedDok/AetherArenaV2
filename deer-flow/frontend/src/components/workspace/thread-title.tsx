import type { BaseStream } from "@langchain/langgraph-sdk";
import { useEffect } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useResolvedDisplayName } from "@/core/settings";
import type { AgentThreadState } from "@/core/threads";

import { useThreadChat } from "./chats";
import { FlipDisplay } from "./flip-display";

export function ThreadTitle({
  threadId,
  thread,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const { t } = useI18n();
  const appLabel = useResolvedDisplayName();
  const { isNewThread } = useThreadChat();
  useEffect(() => {
    let _title = t.pages.untitled;

    if (thread.values?.title) {
      _title = thread.values.title;
    } else if (isNewThread) {
      _title = t.pages.newChat;
    }
    if (thread.isThreadLoading) {
      document.title = `${t.common.loading} - ${appLabel}`;
    } else {
      document.title = `${_title} - ${appLabel}`;
    }
  }, [
    appLabel,
    isNewThread,
    t.common.loading,
    t.pages.newChat,
    t.pages.untitled,
    thread.isThreadLoading,
    thread.values,
  ]);

  if (!thread.values?.title) {
    return null;
  }
  return (
    <FlipDisplay uniqueKey={threadId}>
      {thread.values.title ?? "Untitled"}
    </FlipDisplay>
  );
}
