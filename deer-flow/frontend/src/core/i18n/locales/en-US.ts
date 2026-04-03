import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const enUS: Translations = {
  // Locale meta
  locale: {
    localName: "English (US)",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    rename: "Rename",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    version: "Version",
    lastUpdated: "Last updated",
    code: "Code",
    preview: "Preview",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
    export: "Export",
    exportAsMarkdown: "Export as Markdown",
    exportAsJSON: "Export as JSON",
    exportSuccess: "Conversation exported",
  },

  // Welcome
  welcome: {
    greeting: (name: string, hour: number) => {
      const timeGreeting =
        hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      return name ? `${timeGreeting}, ${name}` : `${timeGreeting}!`;
    },
    description:
      "Your assistant can search the web, analyze information, and help you create slides, web pages, and more. Built-in and custom skills extend what it can do.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create your own skill to teach the assistant new workflows. With custom skills, it can search the web, analyze data, and generate slides, web pages, and more.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    addAttachments: "Add attachments",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    reasoningMode: "Reasoning",
    reasoningModeDescription:
      "Reasoning before action, balance between time and accuracy",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    ultraMode: "Ultra",
    ultraModeDescription:
      "Pro mode with subagents to divide work; best for complex multi-step tasks",
    reasoningEffort: "Reasoning Effort",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Retrieval + Direct Output",
    reasoningEffortLow: "Low",
    reasoningEffortLowDescription: "Simple Logic Check + Shallow Deduction",
    reasoningEffortMedium: "Medium",
    reasoningEffortMediumDescription:
      "Multi-layer Logic Analysis + Basic Verification",
    reasoningEffortHigh: "High",
    reasoningEffortHighDescription:
      "Full-dimensional Logic Deduction + Multi-path Verification + Backward Check",
    searchModels: "Search models...",
    selectAgent: "Select agent",
    defaultAgent: "Chat Agent",
    defaultAgentDescription: "Default — main agent system",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    followupLoading: "Generating follow-up questions...",
    followupConfirmTitle: "Send suggestion?",
    followupConfirmDescription:
      "You already have text in the input. Choose how to send it.",
    followupConfirmAppend: "Append & send",
    followupConfirmReplace: "Replace & send",
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    chats: "Chats",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
    files: "Files",
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    chat: "Chat",
    delete: "Delete",
    deleteConfirm:
      "Are you sure you want to delete this agent? This action cannot be undone.",
    deleteSuccess: "Agent deleted",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Let's bootstrap it's **SOUL**.",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
    // creation form
    fieldName: "Name",
    fieldNameReadonly: "Agent name cannot be changed after creation.",
    fieldDescription: "Description",
    fieldDescriptionPlaceholder: "What does this agent do?",
    fieldOptional: "optional",
    fieldTools: "Tools",
    fieldToolsHint: "Select skills and MCP servers this agent can use.",
    toolGroupsSection: "System Tools",
    identityContinue: "Continue",
    toolsStepTitle: "Assign Tools",
    toolsStepHint: "Choose which skills, system tools, and MCP servers this agent can use.",
    configureContinue: "Create Agent",
    // edit dialog
    edit: "Edit",
    editSuccess: "Agent updated",
    editSubtitle: "Edit agent configuration",
    editSectionOverview: "Overview",
    editOverviewHint: "Basic identity and purpose of this agent.",
    editSectionTools: "Tools",
    editToolsHint: "Skills, system tools, and MCP servers available to this agent.",
    editToolsEmpty: "No skills, system tools, or MCP servers configured yet.",
    editSectionSoul: "System Prompt",
    editSoulHint: "The system prompt defines this agent's persona and behaviour.",
    editSoulPlaceholder: "You are a helpful assistant that…",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
  },

  // Workspace
  workspace: {
    settingsAndMore: "Settings and more",
    about: "About",
    defaultDisplayName: "You",
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
  },

  // Chats
  chats: {
    searchChats: "Search chats",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    deleteSelected: (count: number) =>
      `Delete ${count} chat${count === 1 ? "" : "s"}`,
    deleteSelectedConfirm: (count: number) =>
      `Delete ${count} chat${count === 1 ? "" : "s"}? This cannot be undone.`,
    cancelSelection: "Cancel",
    selected: (count: number) => `${count} selected`,
  },

  // Files (artifacts across all chats)
  files: {
    title: "Files",
    searchFiles: "Search files",
    emptyTitle: "No files yet",
    emptyDescription:
      "Files created by the assistant across all your chats will appear here.",
    linkedChat: "From chat",
    allFiles: "All files",
    filterByType: "Filter by type",
  },

  // Page titles (document title)
  pages: {
    appName: "AetherArena v2",
    chats: "Chats",
    newChat: "New chat",
    untitled: "Untitled",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip: "Install skill and make it available here",
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
  },

  subtasks: {
    subtask: "Subtask",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Search actions...",
    noResults: "No results found.",
    actions: "Actions",
    keyboardShortcuts: "Keyboard Shortcuts",
    keyboardShortcutsDescription: "Navigate faster with keyboard shortcuts.",
    openCommandPalette: "Open Command Palette",
    toggleSidebar: "Toggle Sidebar",
  },

  // Settings
  settings: {
    title: "Settings",
    description: "Adjust how the app looks and behaves for you.",
    sections: {
      appearance: "Appearance",
      memory: "Memory",
      tools: "Tools",
      models: "Models",
      skills: "Skills",
      notification: "Notification",
      about: "About",
    },
    memory: {
      title: "Memory",
      description:
        "The assistant can learn from your conversations in the background. Memories help it understand you better and give more relevant answers.",
      empty: "No memory data to display.",
      rawJson: "Raw JSON",
      deleteFact: "Delete",
      editFact: "Edit fact",
      editSection: "Edit",
      saveChanges: "Save",
      deleteFactConfirm: "Delete this memory fact? This cannot be undone.",
      editSectionTitle: "Edit memory section",
      factDeletedSuccess: "Memory fact deleted",
      factUpdatedSuccess: "Memory fact updated",
      sectionUpdatedSuccess: "Memory section updated",
      markdown: {
        overview: "Overview",
        userContext: "User context",
        work: "Work",
        personal: "Personal",
        topOfMind: "Top of mind",
        historyBackground: "History",
        recentMonths: "Recent months",
        earlierContext: "Earlier context",
        longTermBackground: "Long-term background",
        updatedAt: "Updated at",
        facts: "Facts",
        empty: "(empty)",
        table: {
          category: "Category",
          confidence: "Confidence",
          confidenceLevel: {
            veryHigh: "Very high",
            high: "High",
            normal: "Normal",
            unknown: "Unknown",
          },
          content: "Content",
          source: "Source",
          createdAt: "CreatedAt",
          view: "View",
        },
      },
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      autoFollowupTitle: "Follow-up questions",
      autoFollowupDescription:
        "After the assistant replies, suggest short questions you might ask next. Turn off to skip network calls and hide the suggestion chips.",
      autoMemoryTitle: "Conversation memory updates",
      autoMemoryDescription:
        "After the assistant replies, run background work to learn from the chat and refresh stored memory. Turn off to skip those update calls; existing memory can still be read when enabled on the server.",
      displayNameTitle: "Your name in the app",
      displayNameDescription:
        "Shown in the sidebar. Leave blank to use your device account name when available.",
      displayNamePlaceholder: "e.g. Alex",
      glassTitle: "Glass Effect",
      glassDescription:
        "Surface blur and transparency applied to the sidebar, dialogs, and input. Higher settings require more GPU.",
      glassSubtle: "Subtle",
      glassSubtleDescription: "Barely-there frosting. Near-flat with a light haze.",
      glassMedium: "Medium",
      glassMediumDescription: "Balanced depth. Premium glass without distraction.",
      glassFrosted: "Frosted",
      glassFrostedDescription: "Heavy frost — maximum depth, macOS-style vibrancy.",
      glassNone: "None",
      glassNoneDescription: "Flat solid surfaces. No blur or transparency.",
    },
    tools: {
      title: "Tools",
      description: "Manage skills, system tool groups, and MCP server integrations.",
      mcpTitle: "MCP Servers",
    },
    models: {
      title: "Models",
      description:
        "Configured inference providers from the server. Pick your default chat model; changing config still requires editing config.yaml on the backend.",
      loadError: "Could not load models",
      empty: "No models are configured on the server.",
      defaultModelTitle: "Default chat model",
      defaultModelDescription:
        "Used for new messages in the workspace composer. Same setting as the model control in the input area.",
      selectPlaceholder: "Select a model",
      configuredTitle: "Configured models",
      nameKey: "Config name",
      modelIdLabel: "Provider model id",
      providerLabel: "Provider binding",
      endpointLabel: "Endpoint URL",
      capabilitiesThinking: "Thinking",
      capabilitiesReasoning: "Reasoning effort",
      capabilitiesNone: "Standard chat",
      capabilitiesVision: "Vision",
      visionModelTitle: "Vision model",
      visionModelDescription:
        "Used when messages contain images. Select a vision-capable model from your provider. Leave as 'Same as chat model' if your chat model already supports images.",
      visionModelNone: "Same as chat model",
      activeModel: "Active model",
      noneSelected: "None selected",
      localRunning: "Running",
      localNotRunning: "Not running",
      localChecking: "Checking...",
      testKey: "Test Key",
      testKeyPlaceholder: "Paste API key to test...",
      testKeyValid: "Key is valid",
      testKeyInvalid: "Invalid key",
      testKeyTesting: "Testing...",
      testKeyNote: "Keys are tested securely on the backend and never stored. To use this provider, add the key to config.yaml.",
      getApiKey: "Get API key →",
      noModelsConfigured: "No models configured. Add this provider to config.yaml to use it.",
      setAsChat: "Set as chat",
      setAsVision: "Set as vision",
      clearVision: "Clear vision",
      fetchModels: "Load models",
      fetchModelsLoading: "Loading...",
      fetchModelsError: "Failed to load models",
      liveModels: "Available models",
      liveModelsEmpty: "No models found",
      freeLabel: "FREE",
      manualModelPlaceholder: "Enter model ID manually...",
      manualModelAdd: "Add",
      searchModelsPlaceholder: "Search models...",
      keyValidLoadModels: "Key valid — models loaded",
    },
    skills: {
      title: "Agent Skills",
      description:
        "Manage the configuration and enabled status of the agent skills.",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Additional skills can be added by placing skill folders in the custom skills location configured for your setup.",
      emptyButton: "Create Your First Skill",
    },
    notification: {
      title: "Notification",
      description:
        "Completion notifications are sent when the window is not active. Useful for long tasks so you can switch away and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "Notification test",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
  },
};
