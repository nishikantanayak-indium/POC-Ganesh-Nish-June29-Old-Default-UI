import { useEffect, useState } from 'react'
import { X, FlaskConical, FileText, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { fetchDocumentStore, importSyntheticDocument } from '../api/client'
import type { StoreDocument } from '../types'

interface Props {
  workspaceId: string
  onClose: () => void
  onImported: () => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

// Lets a workspace pull ("import") a document from the shared, cross-workspace
// Synthetic Data Studio document store — on import it's run through the real
// ingestion pipeline (extraction + graph-build), exactly like a real upload,
// so it's tagged `_gen` and behaves identically to real ingested data.
export default function SyntheticLibraryModal({ workspaceId, onClose, onImported, onToast }: Props) {
  const [docs, setDocs] = useState<StoreDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [docTypeFilter, setDocTypeFilter] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetchDocumentStore(docTypeFilter || undefined)
      .then(setDocs)
      .catch(() => onToast('Could not load the synthetic document store', 'error'))
      .finally(() => setLoading(false))
  }, [docTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = async (doc: StoreDocument) => {
    setImportingId(doc.id)
    try {
      const res = await importSyntheticDocument(workspaceId, doc.id)
      setImportedIds(prev => new Set([...prev, doc.id]))
      onToast(`Imported "${res.title}" — ${res.elements} elements added`, 'success')
      onImported()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally { setImportingId(null) }
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
              const imported = importedIds.has(doc.id) || doc.imported_into.some(i => i.workspace_id === workspaceId)
              return (
                <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-card">
                  <FileText size={14} className="text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{doc.title}</p>
                    <p className="text-[11px] text-muted font-mono">{doc.doc_type} · {doc.industry} · {doc.language}</p>
                  </div>
                  <button onClick={() => handleImport(doc)} disabled={importingId === doc.id || imported}
                    className={clsx('shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                      imported ? 'text-success bg-success/10 border border-success/30 cursor-default'
                        : 'bg-primary text-white hover:bg-primary/90 disabled:opacity-50')}>
                    {imported ? <><Check size={12} /> Added</> : importingId === doc.id ? 'Importing…' : 'Add to workspace'}
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
