import { create } from 'zustand';
import type { BusinessTemplate } from '@workstation/types';
import { useWorkflowStore } from '@workstation/state/workflowStore';

type TemplateSessionState = {
  selectedTemplate: BusinessTemplate | null;
  launcherOpen: boolean;
  currentFile: string | null;
  uploadError: string | null;
  analysisError: string | null;
  openLauncher: (template: BusinessTemplate) => void;
  dismissLauncher: () => void;
  setCurrentFile: (fileName: string | null) => void;
  setUploadError: (message: string | null) => void;
  setAnalysisError: (message: string | null) => void;
  /** Clear launcher + temp file/analysis/form state and workflow session. */
  resetCurrentTemplate: () => void;
};

export const useTemplateSessionStore = create<TemplateSessionState>((set) => ({
  selectedTemplate: null,
  launcherOpen: false,
  currentFile: null,
  uploadError: null,
  analysisError: null,

  openLauncher: (template) =>
    set({
      selectedTemplate: template,
      launcherOpen: true,
      uploadError: null,
      analysisError: null,
    }),

  dismissLauncher: () =>
    set({
      selectedTemplate: null,
      launcherOpen: false,
    }),

  setCurrentFile: (currentFile) => set({ currentFile }),
  setUploadError: (uploadError) => set({ uploadError }),
  setAnalysisError: (analysisError) => set({ analysisError }),

  resetCurrentTemplate: () => {
    set({
      selectedTemplate: null,
      launcherOpen: false,
      currentFile: null,
      uploadError: null,
      analysisError: null,
    });
    useWorkflowStore.getState().resetAll();
  },
}));
