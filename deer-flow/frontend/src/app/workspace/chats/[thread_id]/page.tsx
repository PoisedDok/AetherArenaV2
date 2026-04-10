"use client";

import { useCallback, useEffect, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ArtifactTrigger } from "@/components/workspace/artifacts";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { ExportTrigger } from "@/components/workspace/export-trigger";
import { GuruWidget } from "@/components/workspace/guru/GuruWidget";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { getGuru } from "@/core/guru/guru";
import { getGuruIntroContext } from "@/core/guru/prompt";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  useSpecificChatMode();

  const { showNotification } = useNotification();

  const [lastStreamError, setLastStreamError] = useState(false);

  const [thread, sendMessage, isUploading, retryStream] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: () => {
      setLastStreamError(false);
      // ! Important: Never use next.js router for navigation in this case, otherwise it will cause the thread to re-mount and lose all states. Use native history API instead.
      history.replaceState(null, "", `/workspace/chats/${threadId}`);
    },
    onThreadCreated: () => {
      setIsNewThread(false);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  // Sync local error state with the SDK's immutable error property.
  // Once error is set we track it locally so we can clear it on a successful submit.
  useEffect(() => {
    if (thread.error) {
      setLastStreamError(true);
    }
  }, [thread.error]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (lastStreamError) {
        void retryStream(message.text);
        return;
      }

      const guru = getGuru();
      const guruIntro = guru ? getGuruIntroContext(guru.name, guru.species) : null;
      void sendMessage(threadId, message, guruIntro ?? undefined);
    },
    [lastStreamError, sendMessage, threadId, retryStream],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex shrink-0 flex-col",
              isNewThread
                ? "bg-transparent backdrop-blur-none"
                : "glass-header shadow-xs",
            )}
          >
            <div className="flex h-12 items-center px-4">
              <div className="flex w-full items-center text-sm font-medium">
                <ThreadTitle threadId={threadId} thread={thread} />
              </div>

              {/* Conditionally render right-side header actions ONLY if it's NOT a new thread */}
              {!isNewThread && (
                <div className="flex items-center">
                  <ExportTrigger threadId={threadId} />
                  <ArtifactTrigger />
                </div>
              )}
            </div>

            {/* Todos panel hanging below the title bar */}
            {!isNewThread && (
              <TodoList
                todos={thread.values.todos ?? []}
                hidden={!thread.values.todos || thread.values.todos.length === 0}
                className="rounded-none border-x-0 border-t-0 border-b"
              />
            )}
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList
                className={cn("size-full", !isNewThread && "pt-12")}
                threadId={threadId}
                thread={thread}
                paddingBottom={24}
              />
            </div>
            <div className="z-30 flex shrink-0 flex-col items-center px-4 pb-4">
              <div
                className={cn(
                  "w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
                <div className="relative">
                  {/* Conditionally render Guru only if it's NOT a new thread */}
                  {!isNewThread && (
                    <div className="absolute bottom-full left-1 z-40 pb-1 pointer-events-auto">
                      <GuruWidget />
                    </div>
                  )}
                  <InputBox
                    className={cn("bg-background/5 w-full")}
                    isNewThread={isNewThread}
                    threadId={threadId}
                    autoFocus={isNewThread}
                    status={
                      thread.isLoading
                        ? "streaming"
                        : lastStreamError
                          ? "error"
                          : "ready"
                    }
                    context={settings.context}
                    extraHeader={
                      isNewThread && <Welcome />
                    }
                    disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" || isUploading}
                    onContextChange={(context) => setSettings("context", context)}
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                    onRetry={() => retryStream()}
                  />
                </div>
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}