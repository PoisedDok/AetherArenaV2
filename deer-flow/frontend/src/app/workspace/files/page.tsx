"use client";

import { DownloadIcon, FilesIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import { useResolvedDisplayName } from "@/core/settings";
import { useThreads } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";
import {
  getFileExtensionDisplayName,
  getFileIcon,
  getFileName,
} from "@/core/utils/files";
import { cn } from "@/lib/utils";

interface FileEntry {
  filepath: string;
  threadId: string;
  threadTitle: string;
  threadUpdatedAt: string | undefined;
}

export default function FilesPage() {
  const { t } = useI18n();
  const appLabel = useResolvedDisplayName();
  const { data: threads } = useThreads();
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = `${t.files.title} - ${appLabel}`;
  }, [appLabel, t.files.title]);

  // Flatten all artifacts from all threads into a single list, most-recent thread first
  const allFiles = useMemo<FileEntry[]>(() => {
    if (!threads) return [];
    const entries: FileEntry[] = [];
    for (const thread of threads) {
      const artifacts = thread.values?.artifacts ?? [];
      for (const filepath of artifacts) {
        entries.push({
          filepath,
          threadId: thread.thread_id,
          threadTitle: titleOfThread(thread),
          threadUpdatedAt: thread.updated_at,
        });
      }
    }
    return entries;
  }, [threads]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return allFiles;
    const q = search.toLowerCase();
    return allFiles.filter(
      (f) =>
        getFileName(f.filepath).toLowerCase().includes(q) ||
        f.threadTitle.toLowerCase().includes(q),
    );
  }, [allFiles, search]);

  const isEmpty = filteredFiles.length === 0;

  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          <header className="flex shrink-0 items-center justify-center pt-8">
            <div className="relative w-full max-w-(--container-width-md)">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-4 size-5 -translate-y-1/2" />
              <Input
                type="search"
                className="h-12 w-full pl-12 text-xl"
                placeholder={t.files.searchFiles}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </header>
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full py-4">
              <div className="mx-auto flex size-full max-w-(--container-width-md) flex-col">
                {isEmpty ? (
                  <EmptyState
                    hasSearch={!!search.trim()}
                    emptyTitle={t.files.emptyTitle}
                    emptyDescription={t.files.emptyDescription}
                  />
                ) : (
                  filteredFiles.map((entry, idx) => (
                    <FileRow key={`${entry.threadId}:${entry.filepath}:${idx}`} entry={entry} linkedChatLabel={t.files.linkedChat} />
                  ))
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

function FileRow({
  entry,
  linkedChatLabel,
}: {
  entry: FileEntry;
  linkedChatLabel: string;
}) {
  const filename = getFileName(entry.filepath);
  const extDisplay = getFileExtensionDisplayName(entry.filepath);

  return (
    <div className="group/file-row flex items-center gap-4 border-b px-4 py-3 transition-colors hover:bg-muted/40">
      {/* Icon */}
      <div className="text-muted-foreground shrink-0">
        {getFileIcon(entry.filepath, "size-8")}
      </div>

      {/* Name + metadata */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{filename}</div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>{extDisplay} file</span>
          {entry.threadUpdatedAt && (
            <>
              <span>·</span>
              <span>{formatTimeAgo(entry.threadUpdatedAt)}</span>
            </>
          )}
        </div>
        {/* Linked chat */}
        <div className="mt-1 flex items-center gap-1">
          <MessageSquareIcon className="text-muted-foreground size-3 shrink-0" />
          <Link
            href={pathOfThread(entry.threadId)}
            className={cn(
              "text-muted-foreground hover:text-foreground truncate text-xs underline-offset-2 hover:underline",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {linkedChatLabel}: {entry.threadTitle}
          </Link>
        </div>
      </div>

      {/* Download action */}
      <div className="shrink-0 opacity-0 transition-opacity group-hover/file-row:opacity-100">
        <a
          href={urlOfArtifact({
            filepath: entry.filepath,
            threadId: entry.threadId,
            download: true,
          })}
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="ghost" size="sm">
            <DownloadIcon className="size-4" />
          </Button>
        </a>
      </div>
    </div>
  );
}

function EmptyState({
  hasSearch,
  emptyTitle,
  emptyDescription,
}: {
  hasSearch: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <FilesIcon className="text-muted-foreground size-12" />
      <div>
        <p className="font-medium">
          {hasSearch ? "No files match your search" : emptyTitle}
        </p>
        {!hasSearch && (
          <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
        )}
      </div>
    </div>
  );
}
