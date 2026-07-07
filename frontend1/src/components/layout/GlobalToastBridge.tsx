import { useEffect, useRef } from 'react'
import { useGlobalToastStore, type GlobalToast, type ToastVariant } from '@/store/globalToastStore'
import { toast } from '@/components/ui/use-toast'

const VARIANT_MAP: Record<ToastVariant, 'default' | 'success' | 'warning' | 'destructive'> = {
  default: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
}

// Bridges domain-level global toasts (pipeline completion, synthetic import, etc. — which
// can fire from a store while the user has navigated elsewhere) into the rendered toast queue.
export function GlobalToastBridge() {
  const toasts = useGlobalToastStore((s) => s.toasts)
  const dismiss = useGlobalToastStore((s) => s.dismiss)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    for (const t of toasts) {
      if (seen.current.has(t.id)) continue
      seen.current.add(t.id)
      showToast(t)
      dismiss(t.id)
    }
  }, [toasts, dismiss])

  function showToast(t: GlobalToast) {
    toast({
      variant: VARIANT_MAP[t.variant],
      title: t.workspaceName ? `${t.title} · ${t.workspaceName}` : t.title,
      description: t.description,
    })
  }

  return null
}
