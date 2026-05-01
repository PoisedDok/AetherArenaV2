import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    export: string;
    exportAsMarkdown: string;
    exportAsJSON: string;
    exportSuccess: string;
  };

  // Welcome
  welcome: {
    /** Returns time-based greeting with name. Hours are 0-23. */
    greeting: (name: string, hour: number) => string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    createSkillPrompt: string;
    addAttachments: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    searchModels: string;
    selectAgent: string;
    defaultAgent: string;
    defaultAgentDescription: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    files: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepCheckError: string;
    nameStepBootstrapMessage: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
    // creation form
    fieldName: string;
    fieldNameReadonly: string;
    fieldDescription: string;
    fieldDescriptionPlaceholder: string;
    fieldOptional: string;
    fieldTools: string;
    fieldToolsHint: string;
    toolGroupsSection: string;
    identityContinue: string;
    toolsStepTitle: string;
    toolsStepHint: string;
    configureContinue: string;
    // edit dialog
    edit: string;
    editSuccess: string;
    editSubtitle: string;
    editSectionOverview: string;
    editOverviewHint: string;
    editSectionTools: string;
    editToolsHint: string;
    editToolsEmpty: string;
    editSectionSoul: string;
    editSoulHint: string;
    editSoulPlaceholder: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    settingsAndMore: string;
    about: string;
    defaultDisplayName: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
    selectAll: string;
    deselectAll: string;
    deleteSelected: (count: number) => string;
    deleteSelectedConfirm: (count: number) => string;
    cancelSelection: string;
    selected: (count: number) => string;
  };

  // Files (artifacts across all chats)
  files: {
    title: string;
    searchFiles: string;
    emptyTitle: string;
    emptyDescription: string;
    linkedChat: string;
    allFiles: string;
    filterByType: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
    timed_out: string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      appearance: string;
      memory: string;
      compact: string;
      tools: string;
      models: string;
      skills: string;
      notification: string;
      about: string;
    };
    memory: {
      title: string;
      description: string;
      empty: string;
      rawJson: string;
      deleteFact: string;
      editFact: string;
      editSection: string;
      saveChanges: string;
      deleteFactConfirm: string;
      editSectionTitle: string;
      factDeletedSuccess: string;
      factUpdatedSuccess: string;
      sectionUpdatedSuccess: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      autoFollowupTitle: string;
      autoFollowupDescription: string;
      autoMemoryTitle: string;
      autoMemoryDescription: string;
      displayNameTitle: string;
      displayNameDescription: string;
      displayNamePlaceholder: string;
      glassTitle: string;
      glassDescription: string;
      glassSubtle: string;
      glassSubtleDescription: string;
      glassMedium: string;
      glassMediumDescription: string;
      glassFrosted: string;
      glassFrostedDescription: string;
      glassNone: string;
      glassNoneDescription: string;
    };
    tools: {
      title: string;
      description: string;
      mcpTitle: string;
    };
    models: {
      title: string;
      description: string;
      loadError: string;
      empty: string;
      defaultModelTitle: string;
      defaultModelDescription: string;
      selectPlaceholder: string;
      configuredTitle: string;
      nameKey: string;
      modelIdLabel: string;
      providerLabel: string;
      endpointLabel: string;
      capabilitiesThinking: string;
      capabilitiesReasoning: string;
      capabilitiesNone: string;
      capabilitiesVision: string;
      visionModelTitle: string;
      visionModelDescription: string;
      visionModelNone: string;
      // Provider UI
      activeModel: string;
      noneSelected: string;
      localRunning: string;
      localNotRunning: string;
      localChecking: string;
      testKey: string;
      testKeyPlaceholder: string;
      testKeyValid: string;
      testKeyInvalid: string;
      testKeyTesting: string;
      testKeyNote: string;
      getApiKey: string;
      noModelsConfigured: string;
      setAsChat: string;
      setAsVision: string;
      clearVision: string;
      fetchModels: string;
      fetchModelsLoading: string;
      fetchModelsError: string;
      liveModels: string;
      liveModelsEmpty: string;
      freeLabel: string;
      manualModelPlaceholder: string;
      manualModelAdd: string;
      searchModelsPlaceholder: string;
      keyValidLoadModels: string;
    };
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
}
