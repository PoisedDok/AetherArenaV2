import type { Message } from "@langchain/langgraph-sdk";

import {
  extractContentFromMessage,
  extractReasoningContentFromMessage,
  extractTextFromMessage,
  hasContent,
  hasToolCalls,
  stripUploadedFilesTag,
} from "../messages/utils";

import type { AgentThread } from "./types";
import { titleOfThread } from "./utils";

function formatMessageContent(message: Message): string {
  const text = extractContentFromMessage(message);
  if (!text) return "";
  return stripUploadedFilesTag(text);
}

/** Build a map from tool_call_id → tool result text for quick lookup. */
function buildToolResultMap(messages: Message[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    if (msg.type === "tool" && msg.tool_call_id) {
      map.set(msg.tool_call_id, extractTextFromMessage(msg));
    }
  }
  return map;
}

export function formatThreadAsMarkdown(
  thread: AgentThread,
  messages: Message[],
): string {
  const title = titleOfThread(thread);
  const createdAt = thread.created_at
    ? new Date(thread.created_at).toLocaleString()
    : "Unknown";

  const lines: string[] = [
    `# ${title}`,
    "",
    `*Exported on ${new Date().toLocaleString()} · Created ${createdAt}*`,
    "",
    "---",
    "",
  ];

  const toolResultMap = buildToolResultMap(messages);

  for (const message of messages) {
    if (message.name === "todo_reminder") continue;

    if (message.type === "human") {
      const content = formatMessageContent(message);
      if (content) {
        lines.push(`## 🧑 User`, "", content, "", "---", "");
      }
    } else if (message.type === "ai") {
      const reasoning = extractReasoningContentFromMessage(message);
      const content = formatMessageContent(message);
      const calls = message.tool_calls ?? [];

      if (!content && calls.length === 0 && !reasoning) continue;

      lines.push(`## 🤖 Assistant`);

      if (reasoning) {
        lines.push(
          "",
          "<details>",
          "<summary>Thinking</summary>",
          "",
          reasoning,
          "",
          "</details>",
        );
      }

      for (const call of calls) {
        const args = call.args as Record<string, unknown>;
        const description =
          typeof args.description === "string" ? args.description : null;
        const label = description ?? call.name;

        lines.push("", `### 🔧 \`${call.name}\` — ${label}`);

        // Show the most useful arg per tool type
        if (call.name === "bash" && typeof args.command === "string") {
          lines.push("", "```bash", args.command, "```");
        } else if (
          (call.name === "write_file" || call.name === "str_replace") &&
          typeof args.path === "string"
        ) {
          lines.push("", `**Path:** \`${args.path}\``);
          if (typeof args.content === "string") {
            const lang = args.path.split(".").pop() ?? "";
            lines.push("", `\`\`\`${lang}`, args.content, "```");
          }
        } else if (call.name === "read_file" && typeof args.path === "string") {
          lines.push("", `**Path:** \`${args.path}\``);
        } else if (
          call.name === "web_search" &&
          typeof args.query === "string"
        ) {
          lines.push("", `**Query:** ${args.query}`);
        } else if (call.name === "web_fetch" && typeof args.url === "string") {
          lines.push("", `**URL:** ${args.url}`);
        } else if (
          call.name === "present_files" &&
          Array.isArray(args.filepaths)
        ) {
          lines.push(
            "",
            (args.filepaths as string[])
              .map((f) => `- \`${f}\``)
              .join("\n"),
          );
        }

        // Append tool result if available
        if (call.id) {
          const result = toolResultMap.get(call.id);
          if (result && result !== "OK" && result !== "Successfully presented files") {
            const trimmed = result.length > 2000 ? result.slice(0, 2000) + "\n…(truncated)" : result;
            lines.push("", "<details>", "<summary>Output</summary>", "", "```", trimmed, "```", "", "</details>");
          }
        }
      }

      if (content && hasContent(message) && !hasToolCalls(message)) {
        lines.push("", content);
      } else if (content && hasContent(message)) {
        // AI replied with both tool calls and a text response
        lines.push("", "---", "", content);
      }

      lines.push("", "---", "");
    }
    // tool messages are folded into their AI message above — skip standalone rendering
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function formatThreadAsJSON(
  thread: AgentThread,
  messages: Message[],
): string {
  const exportData = {
    title: titleOfThread(thread),
    thread_id: thread.thread_id,
    created_at: thread.created_at,
    exported_at: new Date().toISOString(),
    messages: messages.map((msg) => ({
      type: msg.type,
      id: msg.id,
      content: typeof msg.content === "string" ? msg.content : msg.content,
      ...(msg.type === "ai" && msg.tool_calls?.length
        ? { tool_calls: msg.tool_calls }
        : {}),
    })),
  };
  return JSON.stringify(exportData, null, 2);
}

function sanitizeFilename(name: string): string {
  return (
    name.replace(/[^\p{L}\p{N}_\- ]/gu, "").trim() || "conversation"
  );
}

export function downloadAsFile(
  content: string,
  filename: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportThreadAsMarkdown(
  thread: AgentThread,
  messages: Message[],
) {
  const markdown = formatThreadAsMarkdown(thread, messages);
  const filename = `${sanitizeFilename(titleOfThread(thread))}.md`;
  downloadAsFile(markdown, filename, "text/markdown;charset=utf-8");
}

export function exportThreadAsJSON(thread: AgentThread, messages: Message[]) {
  const json = formatThreadAsJSON(thread, messages);
  const filename = `${sanitizeFilename(titleOfThread(thread))}.json`;
  downloadAsFile(json, filename, "application/json;charset=utf-8");
}
