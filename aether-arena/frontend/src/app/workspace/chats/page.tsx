"use client";

import { Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useResolvedDisplayName } from "@/core/settings";
import { useDeleteThread, useThreads } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

export default function ChatsPage() {
  const { t } = useI18n();
  const appLabel = useResolvedDisplayName();
  const { data: threads } = useThreads();
  const { mutateAsync: deleteThread } = useDeleteThread();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = `${t.pages.chats} - ${appLabel}`;
  }, [appLabel, t.pages.chats]);

  const filteredThreads = useMemo(() => {
    return threads?.filter((thread) => {
      return titleOfThread(thread).toLowerCase().includes(search.toLowerCase());
    });
  }, [threads, search]);

  const toggleSelect = useCallback((threadId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback((threadId?: string) => {
    setIsSelecting(true);
    if (threadId) {
      setSelected(new Set([threadId]));
    }
  }, []);

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelected(new Set());
  }, []);

  const selectAll = useCallback(() => {
    if (!filteredThreads) return;
    setSelected(new Set(filteredThreads.map((t) => t.thread_id)));
  }, [filteredThreads]);

  const allSelected =
    !!filteredThreads?.length &&
    filteredThreads.every((t) => selected.has(t.thread_id));

  const handleDeleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setIsDeleting(true);
    try {
      await Promise.all(
        Array.from(selected).map((threadId) => deleteThread({ threadId })),
      );
      toast.success(`Deleted ${selected.size} chat${selected.size === 1 ? "" : "s"}`);
      cancelSelection();
    } catch {
      toast.error("Failed to delete some chats");
    } finally {
      setIsDeleting(false);
    }
  }, [selected, deleteThread, cancelSelection]);

  // Long-press to enter selection mode on mobile
  const handlePointerDown = useCallback(
    (threadId: string) => {
      if (isSelecting) return;
      longPressTimerRef.current = setTimeout(() => {
        enterSelectionMode(threadId);
      }, 500);
    },
    [isSelecting, enterSelectionMode],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          <header className="flex shrink-0 flex-col items-center gap-3 pt-8">
            <Input
              type="search"
              className="h-12 w-full max-w-(--container-width-md) text-xl"
              placeholder={t.chats.searchChats}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {/* Selection toolbar */}
            {isSelecting && (
              <div className="flex w-full max-w-(--container-width-md) items-center justify-between rounded-lg border px-4 py-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAll();
                      } else {
                        setSelected(new Set());
                      }
                    }}
                  />
                  <span className="text-muted-foreground text-sm">
                    {t.chats.selected(selected.size)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selected.size === 0 || isDeleting}
                    onClick={handleDeleteSelected}
                  >
                    <Trash2 className="size-4" />
                    {t.chats.deleteSelected(selected.size)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelSelection}
                  >
                    <X className="size-4" />
                    {t.chats.cancelSelection}
                  </Button>
                </div>
              </div>
            )}
          </header>
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full py-4">
              <div className="mx-auto flex size-full max-w-(--container-width-md) flex-col">
                {filteredThreads?.map((thread) => {
                  const isSelected = selected.has(thread.thread_id);
                  return (
                    <div
                      key={thread.thread_id}
                      className={cn(
                        "group/chat-row relative flex items-center border-b transition-colors",
                        isSelected && "bg-primary/5",
                        isSelecting && "hover:bg-muted/40",
                      )}
                      onPointerDown={() => handlePointerDown(thread.thread_id)}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    >
                      {/* Checkbox — always in DOM, visible on hover or when selecting */}
                      <div
                        className={cn(
                          "flex shrink-0 items-center pl-4 transition-all duration-150",
                          isSelecting
                            ? "w-10 opacity-100"
                            : "w-0 overflow-hidden opacity-0 group-hover/chat-row:w-10 group-hover/chat-row:opacity-100",
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {
                            if (!isSelecting) enterSelectionMode();
                            toggleSelect(thread.thread_id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>

                      {/* Chat row — link only when not in select mode */}
                      {isSelecting ? (
                        <button
                          type="button"
                          className="flex flex-1 cursor-pointer flex-col gap-2 p-4 text-left"
                          onClick={() => toggleSelect(thread.thread_id)}
                        >
                          <div>{titleOfThread(thread)}</div>
                          {thread.updated_at && (
                            <div className="text-muted-foreground text-sm">
                              {formatTimeAgo(thread.updated_at)}
                            </div>
                          )}
                        </button>
                      ) : (
                        <Link
                          href={pathOfThread(thread.thread_id)}
                          className="flex flex-1 flex-col gap-2 p-4"
                        >
                          <div>{titleOfThread(thread)}</div>
                          {thread.updated_at && (
                            <div className="text-muted-foreground text-sm">
                              {formatTimeAgo(thread.updated_at)}
                            </div>
                          )}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
