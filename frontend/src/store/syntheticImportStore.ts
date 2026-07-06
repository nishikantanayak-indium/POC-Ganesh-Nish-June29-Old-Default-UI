import { create } from 'zustand'
import { importSyntheticDocument } from '../api/client'
import { useGlobalToastStore } from './globalToastStore'

// Tracks in-flight synthetic-document imports at module scope (not component
// state) so the spinner/status survives closing and reopening
// SyntheticLibraryModal mid-import — the fetch itself already keeps running
// regardless of the modal's mount state; only the UI tracking was getting
// thrown away with the component before this store existed.

interface SyntheticImportState {
  importingIds: Set<string>                    // store_document_id currently importing
  importingByWorkspace: Record<string, number> // workspaceId -> count of in-flight imports
  start: (workspaceId: string, storeDocumentId: string, title: string) => void
}

export const useSyntheticImportStore = create<SyntheticImportState>((set, get) => ({
  importingIds: new Set(),
  importingByWorkspace: {},

  start: (workspaceId, storeDocumentId, title) => {
    if (get().importingIds.has(storeDocumentId)) return
    set(s => ({
      importingIds: new Set(s.importingIds).add(storeDocumentId),
      importingByWorkspace: {
        ...s.importingByWorkspace,
        [workspaceId]: (s.importingByWorkspace[workspaceId] ?? 0) + 1,
      },
    }))

    importSyntheticDocument(workspaceId, storeDocumentId)
      .then(res => {
        useGlobalToastStore.getState().add(
          `Imported "${res.title}" — ${res.elements} elements added`, 'success', workspaceId,
        )
      })
      .catch((err: unknown) => {
        useGlobalToastStore.getState().add(
          err instanceof Error ? err.message : `Import of "${title}" failed`, 'error', workspaceId,
        )
      })
      .finally(() => {
        set(s => {
          const next = new Set(s.importingIds)
          next.delete(storeDocumentId)
          return {
            importingIds: next,
            importingByWorkspace: {
              ...s.importingByWorkspace,
              [workspaceId]: Math.max(0, (s.importingByWorkspace[workspaceId] ?? 1) - 1),
            },
          }
        })
      })
  },
}))
