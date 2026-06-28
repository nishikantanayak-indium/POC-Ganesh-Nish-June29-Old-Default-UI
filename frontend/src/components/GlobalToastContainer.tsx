import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, XCircle, X, ArrowRight } from 'lucide-react'
import { useGlobalToastStore } from '../store/globalToastStore'

const AUTO_DISMISS_MS = 7000

export default function GlobalToastContainer() {
  const { toasts, remove } = useGlobalToastStore()
  const navigate = useNavigate()
  const params = useParams<{ workspaceId?: string }>()
  const activeWorkspaceId = params.workspaceId

  // Auto-dismiss toasts for the workspace the user is currently viewing
  useEffect(() => {
    toasts.forEach(t => {
      if (t.workspaceId && t.workspaceId === activeWorkspaceId) {
        remove(t.id)
      }
    })
  }, [toasts, activeWorkspaceId, remove])

  // Auto-dismiss all toasts after timeout
  useEffect(() => {
    toasts.forEach(t => {
      const timer = setTimeout(() => remove(t.id), AUTO_DISMISS_MS)
      return () => clearTimeout(timer)
    })
  }, [toasts, remove])

  if (toasts.length === 0) return null

  // Only show toasts for workspaces the user is NOT currently on
  const visible = toasts.filter(t => !t.workspaceId || t.workspaceId !== activeWorkspaceId)
  if (visible.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {visible.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-xl min-w-[280px] max-w-[380px]"
            style={{
              background: 'var(--surface)',
              borderColor: t.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
            }}
          >
            <span className="shrink-0 mt-0.5">
              {t.type === 'success'
                ? <CheckCircle size={15} className="text-success" />
                : <XCircle size={15} className="text-danger" />
              }
            </span>

            <div className="flex-1 min-w-0">
              {t.workspaceName && (
                <p className="text-[11px] font-mono text-muted mb-0.5 truncate">
                  {t.workspaceName}
                </p>
              )}
              <p className="text-xs text-foreground leading-relaxed">{t.msg}</p>
              {t.workspaceId && (
                <button
                  onClick={() => {
                    remove(t.id)
                    navigate(`/workspace/${t.workspaceId}`)
                  }}
                  className="mt-1.5 flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                >
                  Open workspace <ArrowRight size={10} />
                </button>
              )}
            </div>

            <button
              onClick={() => remove(t.id)}
              className="shrink-0 text-muted hover:text-foreground transition-colors mt-0.5"
            >
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
