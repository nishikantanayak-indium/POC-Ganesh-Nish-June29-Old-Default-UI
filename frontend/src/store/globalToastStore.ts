import { create } from 'zustand'

export interface GlobalToast {
  id: string
  msg: string
  type: 'success' | 'error'
  workspaceId?: string
  workspaceName?: string
}

interface GlobalToastState {
  toasts: GlobalToast[]
  add: (msg: string, type: GlobalToast['type'], workspaceId?: string, workspaceName?: string) => void
  remove: (id: string) => void
}

export const useGlobalToastStore = create<GlobalToastState>((set) => ({
  toasts: [],
  add: (msg, type, workspaceId, workspaceName) =>
    set(s => ({
      toasts: [
        ...s.toasts,
        { id: `gt-${Date.now()}`, msg, type, workspaceId, workspaceName },
      ],
    })),
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
