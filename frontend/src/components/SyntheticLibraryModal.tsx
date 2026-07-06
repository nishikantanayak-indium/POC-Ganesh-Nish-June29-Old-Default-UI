import { useEffect, useRef, useState } from 'react'
import { X, FlaskConical, FileText, Check, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { fetchDocumentStore, fetchDocuments } from '../api/client'
import { useSyntheticImportStore } from '../store/syntheticImportStore'
import type { StoreDocument } from '../types'

interface Props {
  workspaceId: string
  onClose: () => void
  onImported: () => void
}

// The id import_synthetic_document() assigns each imported document —
// mirrors backend/services/synthetic_import.py's `f"GEN_{entry.id[:8].upper()}"`.
function importedDocId(storeDocId: string): string {
  return `GEN_${storeDocId.slice(0, 8).toUpperCase()}`
}

// Lets a workspace pull ("import") a document from the shared, cross-workspace
// Synthetic Data Studio document store — on import it's run through the real
// ingestion pipeline (extraction + graph-build), exactly like a real upload,
// so it's tagged `_gen` and behaves identically to real ingested data.
//
// In-flight imports live in useSyntheticImportStore (module scope), not local
// state — closing this modal mid-import used to throw the spinner state away
// even though the fetch itself kept running in the background; now the
// tracking survives the modal unmounting/remounting.
export default function SyntheticLibraryModal({ workspaceId, onClose, onImported }: Props) {
  const [docs, setDocs] = useState<StoreDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [docTypeFilter, setDocTypeFilter] = useState('')
  // What's actually present in this workspace right now — checked live against
  // the graph rather than trusting the store's historical `imported_into` log,
  // which stays stale forever if the workspace is later wiped/reset outside
  // this modal's knowledge.
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    // Reset (not just rely on the initial useRef value) — React 18 StrictMode's
    // dev-mode mount→cleanup→remount cycle runs this cleanup once immediately,
    // and without resetting here `mounted.current` would stay false forever,
    // silently skipping every state update this component ever makes (the
    // exact cause of "Loading…" never clearing).
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const importingIds = useSyntheticImportStore(s => s.importingIds)
  const startImport = useSyntheticImportStore(s => s.start)

  const refreshPresence = () => {
    fetchDocuments(workspaceId)
      .then(list => { if (mounted.current) setPresentIds(new Set(list.map(d => d.id))) })
      .catch(() => { /* ignore — worst case "Added" state is just unavailable */ })
  }

  useEffect(() => {
    setLoading(true)
    fetchDocumentStore(docTypeFilter || undefined)
      .then(list => { if (mounted.current) setDocs(list) })
      .catch(() => { /* the empty-state message covers this */ })
      .finally(() => { if (mounted.current) setLoading(false) })
  }, [docTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Re-sync on mount AND whenever any import starts/finishes (in this
    // modal or a previous instance of it) — this is what makes "Added" and
    // the workspace's element/graph view catch up after reopening the modal
    // mid-import, and it's also the trigger for refreshing the underlying
    // Ingest view once an import completes.
    refreshPresence()
    onImported()
  }, [importingIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = (doc: StoreDocument) => {
    startImport(workspaceId, doc.id, doc.title)
  }

  const docTypes = [...new Set(docs.map(d => d.doc_type))]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-primary" />
            <h2 className="text-base font-semibold text-foreground">Synthetic Data Library</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-card"><X size={16} /></button>
        </div>

        <p className="px-6 pt-3 text-xs text-muted">
          Documents published from Synthetic Data Studio, tagged <span className="font-mono text-primary">_gen</span>.
          Importing runs the document through the same extraction + graph pipeline as a real upload.
        </p>

        {docTypes.length > 0 && (
          <div className="flex items-center gap-1.5 px-6 pt-3 shrink-0">
            <button onClick={() => setDocTypeFilter('')}
              className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border',
                !docTypeFilter ? 'bg-primary text-white border-primary' : 'text-muted border-border hover:text-foreground')}>All</button>
            {docTypes.map(dt => (
              <button key={dt} onClick={() => setDocTypeFilter(dt)}
                className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border',
                  docTypeFilter === dt ? 'bg-primary text-white border-primary' : 'text-muted border-border hover:text-foreground')}>{dt}</button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <p className="text-sm text-muted text-center py-8">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">
              No synthetic documents published yet — generate & publish some from Synthetic Data Studio.
            </p>
          ) : (
            docs.map(doc => {
              const imported = presentIds.has(importedDocId(doc.id))
              const importing = importingIds.has(doc.id)
              return (
                <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-card">
                  <FileText size={14} className="text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{doc.title}</p>
                    <p className="text-[11px] text-muted font-mono">{doc.doc_type} · {doc.industry} · {doc.language}</p>
                  </div>
                  <button onClick={() => handleImport(doc)} disabled={importing || imported}
                    className={clsx('shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-w-[7.5rem] justify-center',
                      imported ? 'text-success bg-success/10 border border-success/30 cursor-default'
                        : 'bg-primary text-white hover:bg-primary/90 disabled:opacity-70')}>
                    {imported ? (
                      <><Check size={12} /> Added</>
                    ) : importing ? (
                      <><Loader2 size={12} className="animate-spin" /> Importing…</>
                    ) : (
                      'Add to workspace'
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </motion.div>
    </div>
  )
}
