import React, { useEffect, useState } from 'react'
import {
  Database, ArrowUpCircle, Rocket, GitBranch, Check, Lock, Copy, Download,
  ChevronDown, ChevronRight, FileText, FileCode, Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {
  promoteVersion, publishDocumentsToStore, cloneVersion, deleteVersion, fetchLineage,
  fetchVersionDocuments, exportUrls,
} from '../../api/client'
import type { StudioVersion, LineageEdge, SyntheticDocumentT } from '../../types'

interface Props {
  projectId: string
  versions: StudioVersion[]
  onReloadVersions: () => Promise<void>
  onSelectVersion: (id: string) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

function VersionCard({ version, onPromote, onPublish, onClone, onDelete, busy }: {
  version: StudioVersion
  onPromote: (id: string) => void
  onPublish: (id: string) => void
  onClone: (id: string) => void
  onDelete: (id: string) => void
  busy: boolean
}) {
  const [showExport, setShowExport] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [docs, setDocs] = useState<SyntheticDocumentT[]>([])
  const isMain = version.status === 'main'
  const s = version.stats
  const pubs = s?.published_to_store ?? []
  // Only staged + SME-approved documents are published; if there are none,
  // publishing would fail — so the control is disabled with an explanation.
  const sc = version.status_counts ?? {}
  const publishable = (sc['staged'] ?? 0) + (sc['sme_approved'] ?? 0)

  const toggleExport = async () => {
    const next = !showExport
    setShowExport(next)
    if (next && docs.length === 0) {
      try { setDocs(await fetchVersionDocuments(version.id)) } catch { /* ignore */ }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm font-semibold text-foreground">v{version.version_no}</span>
        <span className={clsx('flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border',
          isMain ? 'text-primary bg-primary/10 border-primary/30' : 'text-warning bg-warning/10 border-warning/30')}>
          {isMain && <Lock size={9} />}{isMain ? 'main · frozen' : 'staging'}
        </span>
        {pubs.length > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border text-success bg-success/10 border-success/30">
            published ×{pubs.length}
          </span>
        )}
        {s?.cloned_from_version_no && <span className="text-[10px] text-muted/60">cloned from v{s.cloned_from_version_no}</span>}
        {version.note && <span className="text-xs text-muted">· {version.note}</span>}
        <span className="ml-auto text-[10px] font-mono text-muted/60">{new Date(version.created_at).toLocaleString()}</span>
      </div>

      {s && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
          {([
            ['staged', s.staged ?? 0], ['rejected', s.rejected ?? 0], ['dups', s.duplicates ?? 0],
            ['rels', s.relationships ?? 0], ['docs', s.documents ?? 0],
            ['diversity', s.distribution?.diversity_score ?? 0],
          ] as [string, number][]).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-card border border-border px-2 py-1.5 text-center">
              <div className="text-sm font-mono font-semibold text-foreground">{v}</div>
              <div className="text-[9px] text-muted uppercase tracking-wide">{k}</div>
            </div>
          ))}
        </div>
      )}

      {(() => {
        const sc = version.status_counts ?? {}
        const unrev = sc['staged'] ?? 0
        const appr = sc['sme_approved'] ?? 0
        const rej = sc['sme_rejected'] ?? 0
        const total = unrev + appr + rej
        if (total === 0) return null
        return (
          <div className="flex items-center gap-3 mb-3 text-[11px] font-mono">
            <span className="text-muted">SME review:</span>
            <span className="text-warning">{unrev} unreviewed</span>
            <span className="text-success">{appr} approved</span>
            <span className="text-danger">{rej} rejected</span>
            <span className="text-muted/60">· {Math.round(((appr + rej) / total) * 100)}% reviewed</span>
          </div>
        )
      })()}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onPromote(version.id)} disabled={isMain || busy}
          className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border',
            isMain ? 'text-success border-success/30 bg-success/10 cursor-default'
                   : 'text-foreground border-border hover:border-primary/40 hover:text-primary')}>
          {isMain ? <><Check size={12} /> Promoted to main</> : <><ArrowUpCircle size={12} /> Promote to main</>}
        </button>

        <button onClick={() => onClone(version.id)} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-foreground hover:border-primary/40 hover:text-primary">
          <Copy size={12} /> {isMain ? 'Clone to edit' : 'Clone'}
        </button>

        {publishable === 0 ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border bg-card/50" title="No approved or staged documents">
            <Rocket size={12} /> Nothing to publish
          </span>
        ) : (
          <button onClick={() => onPublish(version.id)} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
            title="Push accepted documents into the shared document store, tagged _gen">
            <Rocket size={12} /> Publish to store {publishable > 0 && <span className="opacity-70">({publishable})</span>}
          </button>
        )}

        <button onClick={toggleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted hover:text-foreground">
          {showExport ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Download size={12} /> Export
        </button>

        {confirmDelete ? (
          <span className="ml-auto flex items-center gap-1.5">
            <button onClick={() => { setConfirmDelete(false); onDelete(version.id) }} disabled={busy}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30">
              Delete v{version.version_no}?
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-foreground">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} disabled={busy}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted hover:text-danger hover:border-danger/40">
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>

      {!isMain && <p className="text-[11px] text-muted/60 mt-2">Tip: SME-review & promote to main, then publish to Analysis. Main versions are frozen — clone to make further changes.</p>}

      {/* Export panel */}
      {showExport && (
        <div className="mt-3 rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <ExportLink href={exportUrls.records(version.id)} icon={<FileCode size={12} />} label="records.jsonl" />
            <ExportLink href={exportUrls.relationships(version.id)} icon={<FileCode size={12} />} label="relationships.jsonl" />
            <ExportLink href={exportUrls.bundle(version.id)} icon={<Download size={12} />} label="bundle.zip" />
          </div>
          {docs.length > 0 && (
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted/60 uppercase tracking-widest">Draft documents</p>
              {docs.map(d => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <FileText size={12} className="text-muted shrink-0" />
                  <span className="text-foreground truncate flex-1">{d.title}</span>
                  <ExportLink href={exportUrls.docMd(version.id, d.id)} icon={<FileCode size={11} />} label=".md" small />
                  <ExportLink href={exportUrls.docDocx(version.id, d.id)} icon={<FileText size={11} />} label=".docx" small />
                </div>
              ))}
            </div>
          )}
          {docs.length === 0 && <p className="text-[11px] text-muted/50">No composite draft documents in this version.</p>}
        </div>
      )}
    </div>
  )
}

function ExportLink({ href, icon, label, small }: { href: string; icon: React.ReactNode; label: string; small?: boolean }) {
  return (
    <a href={href} download
      className={clsx('inline-flex items-center gap-1.5 rounded-lg border border-border text-muted hover:text-primary hover:border-primary/40 transition-colors',
        small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs font-medium')}>
      {icon}{label}
    </a>
  )
}

export default function DatasetsTab({ projectId, versions, onReloadVersions, onSelectVersion, onToast }: Props) {
  const [lineage, setLineage] = useState<LineageEdge[]>([])
  const [busy, setBusy] = useState(false)

  const loadAux = async () => {
    try { setLineage(await fetchLineage(projectId)) } catch { /* ignore */ }
  }
  useEffect(() => { loadAux() }, [projectId, versions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromote = async (id: string) => {
    setBusy(true)
    try { await promoteVersion(id); await onReloadVersions(); await loadAux(); onToast('Version promoted to main', 'success') }
    catch (err: unknown) { onToast(err instanceof Error ? err.message : 'Promote failed', 'error') }
    finally { setBusy(false) }
  }

  const handleClone = async (id: string) => {
    setBusy(true)
    try {
      const res = await cloneVersion(id)
      await onReloadVersions(); await loadAux()
      onSelectVersion(res.version_id)   // switch every tab to the new editable clone
      onToast(`Cloned to v${res.version_no} (staging) — now the active version. Re-review in SME, then promote.`, 'success')
    } catch (err: unknown) { onToast(err instanceof Error ? err.message : 'Clone failed', 'error') }
    finally { setBusy(false) }
  }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await deleteVersion(id)
      await onReloadVersions(); await loadAux()
      onToast('Version deleted', 'success')
    } catch (err: unknown) { onToast(err instanceof Error ? err.message : 'Delete failed', 'error') }
    finally { setBusy(false) }
  }

  const handlePublish = async (versionId: string) => {
    setBusy(true)
    try {
      const res = await publishDocumentsToStore(versionId)
      await onReloadVersions(); await loadAux()
      onToast(`Published ${res.published} document${res.published === 1 ? '' : 's'} to the store (tagged _gen)`, 'success')
    } catch (err: unknown) { onToast(err instanceof Error ? err.message : 'Publish failed', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Datasets</h3>
          <span className="text-xs text-muted">versions · promotion · publication · lineage</span>
        </div>

        {versions.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No versions yet — generate one in the Generate tab.</p>
        ) : (
          <div className="space-y-2">
            {versions.map(v => (
              <VersionCard key={v.id} version={v} onPromote={handlePromote} onPublish={handlePublish} onClone={handleClone} onDelete={handleDelete} busy={busy} />
            ))}
          </div>
        )}

        {lineage.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
              <GitBranch size={11} /> Lineage
            </p>
            <div className="space-y-1 font-mono text-[11px]">
              {lineage.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-muted truncate max-w-[38%]">{e.from}</span>
                  <span className="text-primary shrink-0">──{e.type}──▶</span>
                  <span className="text-foreground truncate max-w-[38%]">{e.to}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
