import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  Handle, Position,
  type Node, type Edge, MarkerType, BackgroundVariant,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import * as d3force from 'd3-force'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, Search, Eye, EyeOff, Zap, Grid, GitBranch, X, ChevronDown, ChevronRight } from 'lucide-react'

import { fetchGraphData, fetchSubgraph, fetchCrossDocRelationships } from '../api/client'
import type { GraphNode, GraphEdge, CrossDocRelationship } from '../types'
import { useTheme } from '../theme/ThemeContext'

// ── Type config ───────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  Requirement: { color: '#6366f1', bg: '#1e1b4b', label: 'REQ' },
  Clause:      { color: '#10b981', bg: '#064e3b', label: 'CLS' },
  Risk:        { color: '#ef4444', bg: '#450a0a', label: 'RSK' },
  Mitigation:  { color: '#f59e0b', bg: '#451a03', label: 'MIT' },
  LD:          { color: '#8b5cf6', bg: '#2e1065', label: 'LD'  },
  Document:    { color: '#64748b', bg: '#0f172a', label: 'DOC' },
}

const EDGE_COLORS: Record<string, string> = {
  COVERS:           '#10b981',
  PARTIALLY_COVERS: '#f59e0b',
  INTRODUCES_RISK:  '#ef4444',
  MITIGATED_BY:     '#8b5cf6',
  LINKED_TO_LD:     '#6366f1',
  CONTRADICTS:      '#f43f5e',
  CONTAINS:         '#475569',
}

const NODE_W = 180
const NODE_H = 72

// ── Custom node ───────────────────────────────────────────────────────────────
function ElementNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  const cfg = TYPE_CONFIG[d.type as string] ?? TYPE_CONFIG.Document
  return (
    <>
      <Handle type="target" position={Position.Left}
        style={{ background: cfg.color, width: 7, height: 7, border: 'none' }} />
      <div style={{
        background: cfg.bg,
        border: `1.5px solid ${cfg.color}55`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 8,
        padding: '6px 10px',
        width: NODE_W,
        minHeight: NODE_H,
        cursor: 'grab',
        userSelect: 'none',
        boxShadow: `0 0 0 1px ${cfg.color}11`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.8,
            color: cfg.color, fontFamily: 'monospace',
            background: `${cfg.color}20`, padding: '1px 5px', borderRadius: 3,
            flexShrink: 0,
          }}>
            {cfg.label}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.id as string}
          </span>
        </div>
        <p style={{
          fontSize: 10, color: '#94a3b8', lineHeight: 1.4, margin: 0,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {((d.text as string) ?? '').slice(0, 70)}
          {((d.text as string) ?? '').length > 70 ? '…' : ''}
        </p>
        {typeof d.source === 'string' && d.source && (
          <p style={{ fontSize: 9, color: '#475569', marginTop: 4, fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.source}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right}
        style={{ background: cfg.color, width: 7, height: 7, border: 'none' }} />
    </>
  )
}

const nodeTypes = { element: ElementNode }

// ── Force-directed layout ─────────────────────────────────────────────────────
function applyForceLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes

  type SimNode = d3force.SimulationNodeDatum & { id: string; rfIndex: number }
  type SimLink = d3force.SimulationLinkDatum<SimNode>

  const simNodes: SimNode[] = nodes.map((n, i) => ({
    id: n.id,
    rfIndex: i,
    x: (Math.random() - 0.5) * 800,
    y: (Math.random() - 0.5) * 600,
  }))

  const idToSim = new Map(simNodes.map(n => [n.id, n]))

  const simLinks: SimLink[] = edges
    .filter(e => idToSim.has(e.source) && idToSim.has(e.target))
    .map(e => ({
      source: idToSim.get(e.source)!,
      target: idToSim.get(e.target)!,
    }))

  const sim = d3force.forceSimulation(simNodes)
    .force('link', d3force.forceLink<SimNode, SimLink>(simLinks).distance(250).strength(0.65))
    .force('charge', d3force.forceManyBody().strength(-520))
    .force('collide', d3force.forceCollide(115))
    .force('center', d3force.forceCenter(0, 0))
    .force('x', d3force.forceX(0).strength(0.03))
    .force('y', d3force.forceY(0).strength(0.03))
    .stop()

  // Run synchronously for enough ticks to reach stable state
  for (let i = 0; i < 300; i++) sim.tick()

  return nodes.map((n, i) => {
    const s = simNodes[i]
    return { ...n, position: { x: (s.x ?? 0) - NODE_W / 2, y: (s.y ?? 0) - NODE_H / 2 } }
  })
}

// ── Dagre fallback layout (LR) ────────────────────────────────────────────────
import dagre from 'dagre'

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', ranksep: 160, nodesep: 75, edgesep: 35 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

// ── Converters ────────────────────────────────────────────────────────────────
function toRFNodes(raw: GraphNode[]): Node[] {
  return raw.map(n => ({
    id: n.id,
    type: 'element',
    data: { id: n.id, type: n.type, text: n.text, source: n.source, document_id: n.document_id },
    position: { x: 0, y: 0 },
  }))
}

function toRFEdges(raw: GraphEdge[]): Edge[] {
  return raw.map((e, i) => {
    const color = EDGE_COLORS[e.rtype] ?? '#475569'
    return {
      id: `e${i}-${e.src}-${e.tgt}`,
      source: e.src,
      target: e.tgt,
      type: 'smoothstep',
      label: e.rtype.replace(/_/g, ' '),
      labelStyle: { fill: '#cbd5e1', fontSize: 10, fontWeight: 500, fontFamily: 'monospace' },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      animated: e.rtype === 'INTRODUCES_RISK',
      data: { rtype: e.rtype, conf: e.conf, ev: e.ev },
    }
  })
}

// ── Cross-document sidebar ────────────────────────────────────────────────────

function CrossDocSidebar({
  workspaceId,
  onHighlight,
  onClose,
}: {
  workspaceId: string
  onHighlight: (srcId: string | null, tgtId: string | null) => void
  onClose: () => void
}) {
  const [rows, setRows]             = useState<CrossDocRelationship[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [relFilter, setRelFilter]   = useState('All')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchCrossDocRelationships(workspaceId)
      .then(setRows)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [workspaceId])

  const relTypes = useMemo(
    () => ['All', ...Array.from(new Set(rows.map(r => r.rtype)))],
    [rows],
  )

  const filtered = useMemo(() => {
    let list = rows
    if (relFilter !== 'All') list = list.filter(r => r.rtype === relFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.src_id.toLowerCase().includes(q) ||
        r.tgt_id.toLowerCase().includes(q) ||
        r.ev.toLowerCase().includes(q) ||
        r.src_doc.toLowerCase().includes(q) ||
        r.tgt_doc.toLowerCase().includes(q),
      )
    }
    return list
  }, [rows, relFilter, search])

  return (
    <div className="w-full h-full flex flex-col border-l border-border bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">Cross-Document</span>
          {!loading && (
            <span className="text-[10px] font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
              {rows.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
          <X size={13} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-danger text-xs text-center">{error}</p>
        </div>
      ) : (
        <>
          {/* Rel type filter */}
          <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0 overflow-x-auto">
            {relTypes.map(r => (
              <button
                key={r}
                onClick={() => setRelFilter(r)}
                style={relFilter === r && r !== 'All' ? {
                  color: EDGE_COLORS[r] ?? 'var(--primary)',
                  borderColor: `${EDGE_COLORS[r] ?? 'var(--primary)'}55`,
                  background: `${EDGE_COLORS[r] ?? 'var(--primary)'}18`,
                } : {}}
                className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                  relFilter === r && r === 'All'
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : relFilter !== r
                    ? 'text-muted border-border hover:text-foreground'
                    : ''
                }`}
              >
                {r === 'All' ? 'All' : r.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border shrink-0">
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
              <Search size={11} className="text-muted shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IDs, docs, evidence…"
                className="bg-transparent text-xs text-foreground placeholder-muted outline-none w-full"
              />
            </div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-muted text-xs text-center mt-8 px-4">
                {rows.length === 0
                  ? 'No cross-document relationships found.\nIngest multiple documents to see links.'
                  : 'No matches for current filter'}
              </p>
            ) : (
              filtered.map((row, i) => {
                const color   = EDGE_COLORS[row.rtype] ?? '#6366f1'
                const srcCfg  = TYPE_CONFIG[row.src_type] ?? TYPE_CONFIG.Document
                const tgtCfg  = TYPE_CONFIG[row.tgt_type] ?? TYPE_CONFIG.Document
                const isOpen  = expandedIdx === i
                return (
                  <div key={i} className="border-b border-border last:border-0">
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-card transition-colors"
                      onClick={() => {
                        const next = isOpen ? null : i
                        setExpandedIdx(next)
                        onHighlight(next !== null ? row.src_id : null, next !== null ? row.tgt_id : null)
                      }}
                    >
                      {/* Rel badge + conf */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span
                          style={{ color, borderColor: `${color}44`, background: `${color}18` }}
                          className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border font-mono"
                        >
                          {row.rtype.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-mono text-muted ml-auto">
                          {(row.conf * 100).toFixed(0)}%
                        </span>
                        {isOpen
                          ? <ChevronDown size={10} className="text-muted" />
                          : <ChevronRight size={10} className="text-muted" />
                        }
                      </div>
                      {/* src → tgt */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          style={{ color: srcCfg.color, background: `${srcCfg.color}18`, borderColor: `${srcCfg.color}44` }}
                          className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border"
                        >
                          {row.src_id}
                        </span>
                        <span className="text-muted text-[10px]">→</span>
                        <span
                          style={{ color: tgtCfg.color, background: `${tgtCfg.color}18`, borderColor: `${tgtCfg.color}44` }}
                          className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border"
                        >
                          {row.tgt_id}
                        </span>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] font-mono">
                          <span className="text-muted/60">from</span>
                          <span className="text-muted truncate" title={row.src_doc}>{row.src_doc}</span>
                          <span className="text-muted/60">to</span>
                          <span className="text-muted truncate" title={row.tgt_doc}>{row.tgt_doc}</span>
                        </div>
                        {row.ev && (
                          <p className="text-[11px] text-muted/80 leading-relaxed bg-card rounded-lg p-2">
                            {row.ev}
                          </p>
                        )}
                        {row.src_text && (
                          <p className="text-[10px] text-muted/60 leading-relaxed line-clamp-2">
                            <span className="text-muted/40 font-mono">src: </span>{row.src_text}
                          </p>
                        )}
                        {row.tgt_text && (
                          <p className="text-[10px] text-muted/60 leading-relaxed line-clamp-2">
                            <span className="text-muted/40 font-mono">tgt: </span>{row.tgt_text}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border shrink-0">
            <span className="text-[10px] text-muted font-mono">
              {filtered.length} of {rows.length} relationships
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Clickable minimap (must be inside ReactFlow context to use useReactFlow) ──
function ClickableMiniMap() {
  const { setCenter } = useReactFlow()
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return (
    <MiniMap
      pannable
      zoomable
      onClick={(_, pos) => setCenter(pos.x, pos.y, { zoom: 1.4, duration: 500 })}
      nodeColor={n => TYPE_CONFIG[(n.data as Record<string, unknown>).type as string]?.color ?? '#334155'}
      maskColor={dark ? 'rgba(9,9,15,0.82)' : 'rgba(200,204,220,0.72)'}
      style={{
        background: dark ? '#111118' : '#ffffff',
        border: `1px solid ${dark ? '#252535' : '#d8ddf0'}`,
        cursor: 'pointer',
      }}
    />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function KnowledgeGraph({ workspaceId, refreshKey }: { workspaceId: string; refreshKey: number }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showContains, setShowContains] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Record<string, unknown> | null>(null)
  const [subgraphId, setSubgraphId]     = useState('')
  const [subgraphLoading, setSubgraphLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'full' | 'sub'>('full')
  const [layoutMode, setLayoutMode] = useState<'force' | 'dagre'>('force')
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [showCrossDoc, setShowCrossDoc]           = useState(false)
  const [crossDocPair, setCrossDocPair]           = useState<[string, string] | null>(null)
  const layoutModeRef = useRef(layoutMode)
  layoutModeRef.current = layoutMode

  const applyLayout = useCallback((ns: Node[], es: Edge[]) => {
    return layoutModeRef.current === 'force' ? applyForceLayout(ns, es) : applyDagreLayout(ns, es)
  }, [])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchGraphData(workspaceId, showContains)
      const rfNodes = toRFNodes(data.nodes)
      const rfEdges = toRFEdges(data.edges)
      setNodes(applyLayout(rfNodes, rfEdges))
      setEdges(rfEdges)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [showContains, setNodes, setEdges, applyLayout])

  useEffect(() => { loadGraph() }, [loadGraph, refreshKey])

  const handleExploreSubgraph = async () => {
    if (!subgraphId.trim()) return
    setSubgraphLoading(true)
    try {
      const data = await fetchSubgraph(workspaceId, subgraphId.trim())
      const rfNodes = toRFNodes(data.nodes)
      const rfEdges = toRFEdges(data.edges)
      setNodes(applyLayout(rfNodes, rfEdges))
      setEdges(rfEdges)
      setViewMode('sub')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubgraphLoading(false)
    }
  }

  const handleNodeDoubleClick = useCallback(async (_event: React.MouseEvent, node: Node) => {
    try {
      const clickedPos = node.position
      const data = await fetchSubgraph(workspaceId, node.id)
      const newRFNodes = toRFNodes(data.nodes).map(n => ({
        ...n,
        position: { x: clickedPos.x + 320, y: clickedPos.y + (Math.random() - 0.5) * 200 },
      }))
      const newRFEdges = toRFEdges(data.edges)
      setNodes(prev => {
        const existingIds = new Set(prev.map(n => n.id))
        return [...prev, ...newRFNodes.filter(n => !existingIds.has(n.id))]
      })
      setEdges(prev => {
        const existingIds = new Set(prev.map(e => e.id))
        return [...prev, ...newRFEdges.filter(e => !existingIds.has(e.id))]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setNodes, setEdges])

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    nodes.forEach(n => {
      const t = (n.data as Record<string, unknown>).type as string
      c[t] = (c[t] ?? 0) + 1
    })
    return c
  }, [nodes])

  const displayEdges = useMemo(() => {
    if (!highlightedNodeId && !crossDocPair) return edges
    return edges.map(e => {
      let connected = false
      if (highlightedNodeId) {
        connected = e.source === highlightedNodeId || e.target === highlightedNodeId
      } else if (crossDocPair) {
        connected = (e.source === crossDocPair[0] && e.target === crossDocPair[1])
          || (e.source === crossDocPair[1] && e.target === crossDocPair[0])
      }
      return {
        ...e,
        style: {
          ...(e.style ?? {}),
          opacity: connected ? 1 : 0.08,
          strokeWidth: connected ? 3 : 1,
        },
      }
    })
  }, [edges, highlightedNodeId, crossDocPair])

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.entries(typeCounts).map(([type, count]) => {
            const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.Document
            return (
              <span key={type}
                style={{ borderColor: `${cfg.color}55`, color: cfg.color }}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border whitespace-nowrap">
                {type.replace('Requirement', 'Req').replace('Mitigation', 'Mit')}: {count}
              </span>
            )
          })}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-slate-600 text-slate-500 whitespace-nowrap">
            edges: {edges.length}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {/* Layout toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => { setLayoutMode('force'); loadGraph() }}
              title="Force-directed layout"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${
                layoutMode === 'force' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'
              }`}
            >
              <Zap size={11} /> Force
            </button>
            <button
              onClick={() => { setLayoutMode('dagre'); loadGraph() }}
              title="Hierarchical layout"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border-l border-border transition-colors ${
                layoutMode === 'dagre' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-white'
              }`}
            >
              <Grid size={11} /> Hierarchy
            </button>
          </div>

          <button
            onClick={() => setShowContains(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-foreground transition-colors"
          >
            {showContains ? <Eye size={12} /> : <EyeOff size={12} />}
            CONTAINS
          </button>

          <button
            onClick={() => { setShowCrossDoc(v => !v); setCrossDocPair(null) }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
              showCrossDoc
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'border-border text-muted hover:text-foreground'
            }`}
          >
            <GitBranch size={12} />
            Cross-Doc
          </button>

          <div className="flex items-center gap-1">
            <input
              value={subgraphId}
              onChange={e => setSubgraphId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleExploreSubgraph()}
              placeholder="node id…"
              className="w-28 px-2.5 py-1.5 rounded-lg text-xs bg-card border border-border text-foreground placeholder-muted outline-none focus:border-primary font-mono"
            />
            <button
              onClick={handleExploreSubgraph}
              disabled={subgraphLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs bg-card border border-border text-muted hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Search size={11} />
              Explore
            </button>
          </div>

          {viewMode === 'sub' && (
            <button
              onClick={() => { setViewMode('full'); loadGraph() }}
              className="px-2.5 py-1.5 rounded-lg text-xs bg-card border border-border text-muted hover:text-foreground transition-colors"
            >
              ← Full
            </button>
          )}

          <button onClick={loadGraph} title="Re-layout"
            className="p-1.5 rounded-lg border border-border text-muted hover:text-foreground transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Graph canvas + optional sidebar */}
      <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-bg/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-muted text-sm">
                {layoutMode === 'force' ? 'Running force simulation…' : 'Laying out graph…'}
              </p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-danger text-sm max-w-md text-center">
              {error}
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            setSelectedNode(node.data as Record<string, unknown>)
            setHighlightedNodeId(node.id)
          }}
          onPaneClick={() => {
            setSelectedNode(null)
            setHighlightedNodeId(null)
            setCrossDocPair(null)
          }}
          onNodeDoubleClick={handleNodeDoubleClick}
          nodesDraggable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          panOnScroll={false}
          selectNodesOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.3 }}
          minZoom={0.05}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#1a1a2e" />
          <Controls showInteractive={false} />
          <ClickableMiniMap />
        </ReactFlow>

        {/* Node detail panel */}
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute top-4 right-4 w-72 bg-surface border border-border rounded-xl p-4 shadow-2xl z-20"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <span style={{ color: TYPE_CONFIG[selectedNode.type as string]?.color ?? '#64748b' }}
                  className="text-xs font-mono font-bold uppercase tracking-widest">
                  {selectedNode.type as string}
                </span>
                <p className="text-foreground font-semibold font-mono text-sm mt-0.5">
                  {selectedNode.id as string}
                </p>
              </div>
              <button onClick={() => setSelectedNode(null)}
                className="text-muted hover:text-foreground text-xl leading-none transition-colors">
                ×
              </button>
            </div>
            <p className="text-muted text-xs leading-relaxed mb-3">{selectedNode.text as string}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-border font-mono">{selectedNode.source as string}</p>
              {(selectedNode.page_number as number | undefined) != null && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-border/20 text-slate-500">
                  p.{selectedNode.page_number as number}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 font-mono mt-1">{selectedNode.document_id as string}</p>
          </motion.div>
        )}
      </div>

      {/* Cross-doc sidebar */}
      <AnimatePresence>
        {showCrossDoc && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden shrink-0 h-full"
          >
            <CrossDocSidebar
              workspaceId={workspaceId}
              onHighlight={(src, tgt) => setCrossDocPair(src && tgt ? [src, tgt] : null)}
              onClose={() => { setShowCrossDoc(false); setCrossDocPair(null) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      </div>{/* end graph+sidebar flex row */}

      {/* Edge legend */}
      <div className="flex items-center gap-5 px-4 py-2 border-t border-border bg-surface shrink-0 overflow-x-auto">
        {Object.entries(EDGE_COLORS).filter(([k]) => k !== 'CONTAINS').map(([rel, color]) => (
          <div key={rel} className="flex items-center gap-1.5 shrink-0">
            <div style={{ background: color }} className="w-5 h-0.5 rounded-full" />
            <span className="text-xs text-muted font-mono">{rel.replace(/_/g, ' ')}</span>
          </div>
        ))}
        <div className="ml-auto text-xs text-slate-600 font-mono shrink-0">
          drag freely · scroll to zoom · dbl-click to expand
        </div>
      </div>
    </div>
  )
}
