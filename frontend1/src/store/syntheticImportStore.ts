import { create } from 'zustand'
import { importSyntheticDocument } from '@/api/workspaces'
import { useGlobalToastStore } from './globalToastStore'

interface ImportJob {
  storeDocumentId: string
  workspaceId: string
  status: 'importing' | 'done' | 'error'
}

interface SyntheticImportState {
  jobs: Record<string, ImportJob>
  startImport: (workspaceId: string, workspaceName: string, storeDocumentId: string, title: string) => void
}

export const useSyntheticImportStore = create<SyntheticImportState>((set, get) => ({
  jobs: {},

  startImport: (workspaceId, workspaceName, storeDocumentId, title) => {
    if (get().jobs[storeDocumentId]?.status === 'importing') return

    set((state) => ({
      jobs: { ...state.jobs, [storeDocumentId]: { storeDocumentId, workspaceId, status: 'importing' } },
    }))

    importSyntheticDocument(workspaceId, storeDocumentId)
      .then(() => {
        set((state) => ({
          jobs: { ...state.jobs, [storeDocumentId]: { storeDocumentId, workspaceId, status: 'done' } },
        }))
        useGlobalToastStore.getState().push({
          title: 'Document imported',
          description: `"${title}" was added and processed into the workspace.`,
          variant: 'success',
          workspaceId,
          workspaceName,
        })
      })
      .catch((err) => {
        set((state) => ({
          jobs: { ...state.jobs, [storeDocumentId]: { storeDocumentId, workspaceId, status: 'error' } },
        }))
        useGlobalToastStore.getState().push({
          title: 'Import failed',
          description: err instanceof Error ? err.message : `Could not import "${title}".`,
          variant: 'danger',
          workspaceId,
          workspaceName,
        })
      })
  },
}))

export const useImportStatus = (storeDocumentId: string) =>
  useSyntheticImportStore((state) => state.jobs[storeDocumentId]?.status)
