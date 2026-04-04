import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { env } from "@/env";

export interface ArtifactsContextType {
  artifacts: string[];
  setArtifacts: (artifacts: string[]) => void;

  /** write-file: URLs seen in this thread (from write_file/str_replace tool calls) */
  writeFileArtifacts: string[];
  setWriteFileArtifacts: (artifacts: string[]) => void;

  selectedArtifact: string | null;
  autoSelect: boolean;
  select: (artifact: string, autoSelect?: boolean) => void;
  /** Clear the selected artifact and return to the list panel (does NOT close the panel). */
  deselect: () => void;
  /** Close the panel entirely (and clear selection). */
  closePanel: () => void;

  open: boolean;
  autoOpen: boolean;
  setOpen: (open: boolean) => void;
  resetAutoOpen: () => void;
}

const ArtifactsContext = createContext<ArtifactsContextType | undefined>(
  undefined,
);

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [writeFileArtifacts, setWriteFileArtifacts] = useState<string[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [autoSelect, setAutoSelect] = useState(true);
  const [open, setOpen] = useState(
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true",
  );
  const [autoOpen, setAutoOpen] = useState(true);
  const { setOpen: setSidebarOpen } = useSidebar();

  const select = useCallback(
    (artifact: string, autoSelect = false) => {
      setSelectedArtifact(artifact);
      if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true") {
        setSidebarOpen(false);
      }
      if (!autoSelect) {
        setAutoSelect(false);
      }
    },
    [setSidebarOpen, setSelectedArtifact, setAutoSelect],
  );

  // Go back to the list without closing the panel
  const deselect = useCallback(() => {
    setSelectedArtifact(null);
    setAutoSelect(true);
  }, []);

  // Close the panel entirely
  const closePanel = useCallback(() => {
    setSelectedArtifact(null);
    setAutoSelect(false);
    setAutoOpen(false);
    setOpen(false);
  }, []);

  const resetAutoOpen = useCallback(() => {
    setAutoOpen(true);
    setAutoSelect(true);
  }, []);

  const value: ArtifactsContextType = {
    artifacts,
    setArtifacts,

    writeFileArtifacts,
    setWriteFileArtifacts,

    open,
    autoOpen,
    autoSelect,
    setOpen: (isOpen: boolean) => {
      if (!isOpen && autoOpen) {
        setAutoOpen(false);
        setAutoSelect(false);
      }
      setOpen(isOpen);
    },

    selectedArtifact,
    select,
    deselect,
    closePanel,
    resetAutoOpen,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}

export function useArtifacts() {
  const context = useContext(ArtifactsContext);
  if (context === undefined) {
    throw new Error("useArtifacts must be used within an ArtifactsProvider");
  }
  return context;
}
