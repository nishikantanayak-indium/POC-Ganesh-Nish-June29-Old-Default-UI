import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, XCircle, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export interface ToastItem {
  id: string
  msg: string
  type: 'success' | 'error'
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((msg: string, type: 'success' | 'error') => {
    const id = `toast-${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, msg, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

// ── Single toast ──────────────────────────────────────────────────────────────

function ToastBubble({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.type === 'error' ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [toast.id, toast.type, onDismiss])

  const isSuccess = toast.type === 'success'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.92 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl shadow-xl border max-w-sm
        ${isSuccess
          ? 'bg-[#0f1a13] border-success/25 text-success'
          : 'bg-[#1a0f0f] border-danger/25 text-danger'}
      `}
    >
      <div className="shrink-0 mt-0.5">
        {isSuccess
          ? <CheckCircle2 size={15} />
          : <XCircle size={15} />
        }
      </div>
      <p className="text-xs font-mono leading-relaxed flex-1">{toast.msg}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
      >
        <X size={12} />
      </button>
    </motion.div>
  )
}

// ── Toast container ───────────────────────────────────────────────────────────

export function ToastContainer({ toasts, onDismiss }: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastBubble toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
