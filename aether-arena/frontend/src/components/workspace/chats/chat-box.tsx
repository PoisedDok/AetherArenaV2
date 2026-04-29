import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { getBackendBaseURL } from "@/core/config";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { ArtifactFileDetail, useArtifacts } from "../artifacts";
import { useThread } from "../messages/context";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };

// ── Tree node types ─────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// ── Directory Tree Component ─────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  threadId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  threadId: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.type === "dir";
  const hasChildren = isDir && (node.children?.length ?? 0) > 0;

  const downloadHref = !isDir
    ? urlOfArtifact({ filepath: node.path, threadId, download: true })
    : undefined;

  return (
    <>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
          "hover:bg-accent",
          isDir ? "text-foreground font-medium" : "text-foreground/80",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (isDir) {
            setExpanded((v) => !v);
          } else {
            onSelect(node.path);
          }
        }}
      >
        {/* Expand/collapse chevron for dirs */}
        {isDir ? (
          <span className="text-muted-foreground size-3.5 shrink-0">
            {hasChildren ? (
              expanded ? (
                <ChevronLeftIcon className="size-3 rotate-90 transition-transform" />
              ) : (
                <ChevronRightIcon className="size-3 transition-transform" />
              )
            ) : (
              <span className="size-3 block" />
            )}
          </span>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}

        {/* Icon */}
        {isDir ? (
          expanded && hasChildren ? (
            <FolderOpenIcon className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
          )
        ) : (
          <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}

        {/* Name */}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {/* Download for files */}
        {downloadHref && (
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground ml-auto opacity-0 transition-opacity group-hover:opacity-100"
          >
            <DownloadIcon className="size-3" />
          </a>
        )}
      </div>

      {/* Children */}
      {isDir && expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              threadId={threadId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DirectoryPanel({
  threadId,
  onClose,
  onSelect,
}: {
  threadId: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/artifacts-tree`,
      );
      if (res.ok) {
        const data = (await res.json()) as { tree: TreeNode[] };
        setTree(data.tree ?? []);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  const isEmpty = !loading && tree.length === 0;

  return (
    <div className="flex size-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">Workspace</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void fetchTree()}
            title="Refresh"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 grow overflow-y-auto py-2 pr-1">
        {loading ? (
          <div className="text-muted-foreground flex size-full items-center justify-center py-8 text-xs">
            Loading…
          </div>
        ) : isEmpty ? (
          <div className="text-muted-foreground flex size-full items-center justify-center py-8 text-xs">
            No files yet
          </div>
        ) : (
          tree.map((node) => (
            <TreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              threadId={threadId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── ChatBox ──────────────────────────────────────────────────────────────────

const ChatBox: React.FC<{ children: React.ReactNode; threadId: string }> = ({
  children,
  threadId,
}) => {
  const { thread } = useThread();
  const threadIdRef = useRef(threadId);
  const layoutRef = useRef<GroupImperativeHandle>(null);

  const {
    artifacts,
    open: artifactsOpen,
    setArtifacts,
    setWriteFileArtifacts,
    select: selectArtifact,
    deselect,
    closePanel,
    selectedArtifact,
    resetAutoOpen,
  } = useArtifacts();

  // Track all write_file/str_replace paths seen in this thread so the Artifacts
  // button stays visible even after streaming ends (when selectedArtifact is cleared).
  const messages = thread.messages;
  const messagesKey = messages.map((m) => m.id).join(",");
  useEffect(() => {
    const urls: string[] = [];
    for (const msg of messages) {
      if (msg.type !== "ai") continue;
      for (const tc of msg.tool_calls ?? []) {
        if (
          (tc.name === "write_file" || tc.name === "str_replace") &&
          typeof tc.args?.path === "string"
        ) {
          const url = new URL(
            `write-file:${tc.args.path}?message_id=${msg.id}&tool_call_id=${tc.id}`,
          ).toString();
          if (!urls.includes(url)) urls.push(url);
        }
      }
    }
    setWriteFileArtifacts(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesKey]);

  // Reset auto-open at the start of each new streaming response
  const wasLoading = useRef(false);
  useEffect(() => {
    if (thread.isLoading && !wasLoading.current) {
      resetAutoOpen();
    }
    wasLoading.current = thread.isLoading;
  }, [thread.isLoading, resetAutoOpen]);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    if (threadIdRef.current !== threadId) {
      threadIdRef.current = threadId;
      deselect();
    }

    setArtifacts(thread.values.artifacts);

    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (thread?.values?.artifacts?.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(thread.values.artifacts[0]!);
      }
    }
  }, [
    threadId,
    autoSelectFirstArtifact,
    deselect,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
    thread.values.artifacts,
  ]);

  const artifactPanelOpen = useMemo(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && (artifacts?.length ?? 0) > 0;
    }
    return artifactsOpen;
  }, [artifactsOpen, artifacts]);

  useEffect(() => {
    if (layoutRef.current) {
      if (artifactPanelOpen) {
        layoutRef.current.setLayout(OPEN_MODE);
      } else {
        layoutRef.current.setLayout(CLOSE_MODE);
      }
    }
  }, [artifactPanelOpen]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={{ chat: 100, artifacts: 0 }}
      groupRef={layoutRef}
    >
      <ResizablePanel className="relative" defaultSize={100} id="chat">
        {children}
      </ResizablePanel>
      <ResizableHandle
        className={cn(
          "opacity-33 hover:opacity-100",
          !artifactPanelOpen && "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        className={cn(
          "transition-all duration-300 ease-in-out",
          !artifactsOpen && "opacity-0",
        )}
        id="artifacts"
      >
        <div
          className={cn(
            "h-full transition-transform duration-300 ease-in-out",
            artifactPanelOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          {selectedArtifact ? (
            <div className="flex size-full flex-col">
              {/* Back bar */}
              <div className="flex shrink-0 items-center border-b px-2 py-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                  onClick={deselect}
                >
                  <ChevronLeftIcon className="size-3.5" />
                  Workspace
                </Button>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <ArtifactFileDetail
                  className="size-full"
                  filepath={selectedArtifact}
                  threadId={threadId}
                />
              </div>
            </div>
          ) : (
            <DirectoryPanel
              threadId={threadId}
              onClose={closePanel}
              onSelect={(path) => {
                selectArtifact(path);
              }}
            />
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export { ChatBox };
