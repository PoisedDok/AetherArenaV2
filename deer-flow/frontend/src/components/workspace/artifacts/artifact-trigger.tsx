import { FilesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";

import { useArtifacts } from "./context";

export const ArtifactTrigger = () => {
  const { t } = useI18n();
  const {
    artifacts,
    writeFileArtifacts,
    selectedArtifact,
    select,
    setOpen: setArtifactsOpen,
  } = useArtifacts();

  // Show if there are persisted artifacts (from present_files) OR any write_file
  // tool calls were made in this thread (even if present_files was never called).
  const hasAnything =
    (artifacts && artifacts.length > 0) ||
    (writeFileArtifacts && writeFileArtifacts.length > 0);

  if (!hasAnything) {
    return null;
  }

  const handleClick = () => {
    // If nothing is currently selected but we have write-file artifacts, re-select the last one
    if (!selectedArtifact && writeFileArtifacts.length > 0) {
      select(writeFileArtifacts[writeFileArtifacts.length - 1]!);
    }
    setArtifactsOpen(true);
  };

  return (
    <Tooltip content="Show artifacts of this conversation">
      <Button
        className="text-muted-foreground hover:text-foreground"
        variant="ghost"
        onClick={handleClick}
      >
        <FilesIcon />
        {t.common.artifacts}
      </Button>
    </Tooltip>
  );
};
