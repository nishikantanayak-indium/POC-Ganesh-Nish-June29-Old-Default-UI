import React, { useEffect, useState } from 'react'
import { Database, ArrowUpCircle, Rocket, GitBranch, Check } from 'lucide-react'
import clsx from 'clsx'
import {
  promoteVersion, publishVersion, fetchLineage, fetchWorkspaces, createWorkspace,
} from '../../api/client'
import type { StudioVersion, LineageEdge, Workspace } from '../../types'

interface Props {
  projectId: string
  versions: StudioVersion[]
  onReloadVersions: () => Promise<void>
  onToast: (msg: string, type: 'success' | 'error') => void
}

function VersionCard({ version, workspaces, onPromote, onPublish, busy }: {
  version: StudioVersion
  workspaces: Workspace[]
  onPromote: (id: string) => void
  onPublish: (id: string, wsId: string, wsName: string) => void
  busy: boolean
}) {
  const [wsId, setWsId] = useState('')
  const [newWsName, setNewWsName] = useState('')
  const isMain = version.status === 'main'
  const s = version.stats

  const doPublish = () => {
    if (wsId === '__new__') {
      if (!newWsName.trim()) return
      onPublish(version.id, '__new__', newWsName.trim())
    } else if (wsId) {
      onPublish(version.id, wsId, workspaces.find(w => w.id === wsId)?.name ?? 'workspace')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-foreground">v{version.version_no}</span>
        <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded border',
          isMain ? 'text-primary bg-primary/10 border-primary/30' : 'text-warning bg-warning/10 border-warning/30')}>
          {version.status}
        </span>
        {version.note && <span className="text-xs text-muted">· {version.note}</span>}
        <span className="ml-auto text-[10px] font-mono text-muted/60">{new Date(version.created_at).toLocaleString()}</span>
      </div>

      {s && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
          {[
            ['staged', s.staged], ['rejected', s.rejected], ['dups', s.duplicates],
            ['rels', s.relationships], ['docs', s.documents],
            ['diversity', s.distribution?.diversity_score ?? 0],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-card border border-border px-2 py-1.5 text-center">
              <div className="text-sm font-mono font-semibold text-foreground">{v}</div>
              <div className="text-[9px] text-muted uppercase tracking-wide">{k}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onPromote(version.id)} disabled={isMain || busy}
          className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border',
            isMain ? 'text-success border-success/30 bg-success/10 cursor-default'
                   : 'text-foreground border-border hover:border-primary/40 hover:text-primary')}>
          {isMain ? <><Check size={12} /> Promoted to main</> : <><ArrowUpCircle size={12} /> Promote to main</>}
        </button>

        <div className="flex items-center gap-1.5">
          <select value={wsId} onChange={e => setWsId(e.target.value)}
            className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary">
            <option value="">Publish to…</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            <option value="__new__">➕ New workspace…</option>
          </select>
          {wsId === '__new__' && (
            <input value={newWsName} onChange={e => setNewWsName(e.target.value)} placeholder="workspace name"
              className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary w-40" />
          )}
          <button onClick={doPublish} disabled={!wsId || busy || (wsId === '__new__' && !newWsName.trim())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-40">
            <Rocket size={12} /> Publish
          </button>
        </div>
        {!isMain && <span className="text-[11px] text-muted/60">Tip: promote after SME review, then publish to Analysis.</span>}
      </div>
    </div>
  )
}

export default function DatasetsTab({ projectId, versions, onReloadVersions, onToast }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [lineage, setLineage] = useState<LineageEdge[]>([])
  const [busy, setBusy] = useState(false)

  const loadAux = async () => {
    try { setWorkspaces(await fetchWorkspaces()) } catch { /* ignore */ }
    try { setLineage(await fetchLineage(projectId)) } catch { /* ignore */ }
  }
  useEffect(() => { loadAux() }, [projectId, versions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromote = async (id: string) => {
    setBusy(true)
    try { await promoteVersion(id); await onReloadVersions(); await loadAux(); onToast('Version promoted to main', 'success') }
    catch (err: unknown) { onToast(err instanceof Error ? err.message : 'Promote failed', 'error') }
    finally { setBusy(false) }
  }

  const handlePublish = async (versionId: string, wsId: string, wsName: string) => {
    setBusy(true)
    try {
      let targetId = wsId
      if (wsId === '__new__') { const ws = await createWorkspace(wsName, 'Published from Synthetic Data Studio'); targetId = ws.id }
      const res = await publishVersion(versionId, targetId)
      await loadAux()
      onToast(`Published ${res.elements ?? 0} elements → ${wsName} (${res.nodes ?? 0} nodes, ${res.edges ?? 0} edges)`, 'success')
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
              <VersionCard key={v.id} version={v} workspaces={workspaces} onPromote={handlePromote} onPublish={handlePublish} busy={busy} />
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
