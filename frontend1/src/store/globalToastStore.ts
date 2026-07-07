import { create } from 'zustand'

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger'

export interface GlobalToast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  workspaceId?: string
  workspaceName?: string
  createdAt: number
}

interface GlobalToastState {
  toasts: GlobalToast[]
  push: (toast: Omit<GlobalToast, 'id' | 'createdAt'>) => void
  dismiss: (id: string) => void
}

let counter = 0

export const useGlobalToastStore = create<GlobalToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: `toast-${++counter}`, createdAt: Date.now() }],
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
