import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
// Browser-safe (no Worker/child_process) ELK bundle — required for Vite/browser bundling.
import ELK from 'elkjs/lib/elk.bundled.js'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import { GitBranch, Layers, Loader2, Minus, Plus, Search, Sparkles, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { elementStyle, relationshipStyle } from '@/lib/domain-taxonomy'
import { getCrossDocRelationships, getGraphData, getSubgraph } from '@/api/graph'
import type { CrossDocRelationship, ElementType, GraphData, GraphEdge, GraphNode, RelationshipType } from '@/types/analysis'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Hex color maps — React Flow renders edges as raw SVG, so Tailwind utility
// classes (which resolve at build time to CSS, not JS-readable values) can't
// be used for `stroke`. These mirror the semantic tokens in domain-taxonomy.ts
// (danger/success/warning/info/slate/accent) as literal hex values.
// ---------------------------------------------------------------------------
const ELEMENT_HEX: Record<ElementType, string> = {
  Document: '#94a3b8', // slate-400
  Requirement: '#334155', // slate-700
  Clause: '#3d8678', // accent-500
  Risk: '#dc2626', // danger-500
  Mitigation: '#16a34a', // success-500
  LD: '#d97706', // warning-500
}

const RELATIONSHIP_HEX: Record<RelationshipType, string> = {
  CONTAINS: '#94a3b8', // slate-400
  COVERS: '#16a34a', // success-500
  PARTIALLY_COVERS: '#d97706', // warning-500
  INTRODUCES_RISK: '#dc2626', // danger-500
  MITIGATED_BY: '#16a34a', // success-500
  LINKED_TO_LD: '#d97706', // warning-500
  CONTRADICTS: '#b91c1c', // danger-600
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 72
// Bounding-circle radius of a node card (+padding) — a floor for the d3-force
// collide force so cards never visually overlap even at low spacing values.
const NODE_SAFE_RADIUS = Math.sqrt((NODE_WIDTH / 2) ** 2 + (NODE_HEIGHT / 2) ** 2) + 8

// ---------------------------------------------------------------------------
// Graph merge helper — dedupes nodes by id and edges by (src, rtype, tgt).
// ---------------------------------------------------------------------------
function edgeKey(e: GraphEdge) {
  return `${e.src}__${e.rtype}__${e.tgt}`
}

function mergeGraphData(base: GraphData, incoming: GraphData): GraphData {
  const nodeMap = new Map(base.nodes.map((n) => [n.id, n]))
  incoming.nodes.forEach((n) => nodeMap.set(n.id, n))
  const edgeMap = new Map(base.edges.map((e) => [edgeKey(e), e]))
  incoming.edges.forEach((e) => edgeMap.set(edgeKey(e), e))
  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) }
}

// ---------------------------------------------------------------------------
// Layout engines
// ---------------------------------------------------------------------------
const elk = new ELK()

const DEFAULT_SPACING = 1
const MIN_SPACING = 0.5
const MAX_SPACING = 2.5
const SPACING_STEP = 0.25

async function computeElkLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  spacing: number,
): Promise<Record<string, { x: number; y: number }>> {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(Math.round(60 * spacing)),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(90 * spacing)),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges
      .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.tgt))
      .map((e, i) => ({ id: `e${i}`, sources: [e.src], targets: [e.tgt] })),
  }

  const layouted = await elk.layout(elkGraph)
  const positions: Record<string, { x: number; y: number }> = {}
  for (const child of layouted.children ?? []) {
    positions[child.id as string] = { x: child.x ?? 0, y: child.y ?? 0 }
  }
  return positions
}

interface ForceSimNode extends SimulationNodeDatum {
  id: string
}

function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  spacing: number,
): Record<string, { x: number; y: number }> {
  const simNodes: ForceSimNode[] = nodes.map((n) => ({ id: n.id }))
  const nodeIds = new Set(simNodes.map((n) => n.id))
  const simLinks = edges
    .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.tgt))
    .map((e) => ({ source: e.src, target: e.tgt }))

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<ForceSimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(130 * spacing)
        .strength(0.6),
    )
    .force('charge', forceManyBody().strength(-180 * spacing))
    .force('center', forceCenter(500, 350))
    .force('collide', forceCollide(Math.max(NODE_SAFE_RADIUS, (NODE_WIDTH / 2 + 8) * spacing)).strength(1))
    .stop()

  const TICKS = 300
  for (let i = 0; i < TICKS; i++) simulation.tick()

  const positions: Record<string, { x: number; y: number }> = {}
  simNodes.forEach((n) => {
    positions[n.id] = { x: n.x ?? 0, y: n.y ?? 0 }
  })
  return positions
}

type LayoutMode = 'structured' | 'organic'

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------
interface GraphNodeRFData {
  node: GraphNode
  highlighted: boolean
  matched: boolean
  dimmed: boolean
  expanding: boolean
  [key: string]: unknown
}

type RFNode = Node<GraphNodeRFData, 'graphNode'>

function GraphNodeCard({ data, selected }: NodeProps<RFNode>) {
  const { node, highlighted, matched, dimmed, expanding } = data
  const style = elementStyle(node.type)
  return (
    <div
      className={cn(
        'w-[220px] rounded-md border border-border bg-surface px-3 py-2 shadow-sm transition-all dark:border-border-dark dark:bg-surface-dark-subtle',
        selected && 'ring-2 ring-accent-500',
        highlighted && !selected && 'ring-2 ring-warning-500',
        matched && 'ring-2 ring-accent-400',
        dimmed && 'opacity-30',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-slate-400" />
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dotClass)} />
          <span className="truncate font-mono text-[10px] text-ink-subtle">{node.id}</span>
        </div>
        {expanding && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-500" />}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink dark:text-ink-inverted">{node.text}</p>
      <Badge variant="outline" className={cn('mt-1.5 border text-[10px]', style.badgeClass)}>
        {style.label}
      </Badge>
    </div>
  )
}

const nodeTypes = { graphNode: GraphNodeCard }

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function NodeDetailPanel({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const style = elementStyle(node.type)
  return (
    <Card className="absolute right-3 top-3 z-10 w-80 shadow-popover">
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <Badge variant="outline" className={cn('border', style.badgeClass)}>
            {style.label}
          </Badge>
          <CardTitle className="mt-2 break-all font-mono text-xs font-medium text-ink-muted dark:text-ink-subtle">
            {node.id}
          </CardTitle>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-sm leading-relaxed text-ink dark:text-ink-inverted">{node.text}</p>
        <Separator />
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Source</dt>
            <dd className="truncate text-right text-ink-muted dark:text-ink-subtle">{node.source ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Document</dt>
            <dd className="truncate text-right text-ink-muted dark:text-ink-subtle">{node.document_id ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Page</dt>
            <dd className="text-right text-ink-muted dark:text-ink-subtle">{node.page_number ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Confidence</dt>
            <dd className="text-right text-ink-muted dark:text-ink-subtle">
              {node.confidence !== undefined && node.confidence !== null ? `${Math.round(node.confidence * 100)}%` : '—'}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] text-ink-subtle">Double-click the node on canvas to expand its neighborhood.</p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Cross-doc relationships panel
// ---------------------------------------------------------------------------
function CrossDocPanel({
  workspaceId,
  onClose,
  onSelect,
}: {
  workspaceId: string
  onClose: () => void
  onSelect: (rel: CrossDocRelationship) => void
}) {
  const [typeFilter, setTypeFilter] = useState<'All' | RelationshipType>('All')
  const { data, isLoading } = useQuery({
    queryKey: ['workspace', workspaceId, 'cross-doc'],
    queryFn: () => getCrossDocRelationships(workspaceId),
  })

  const relationships = data?.relationships ?? []
  const types = useMemo(
    () => Array.from(new Set(relationships.map((r) => r.rtype))),
    [relationships],
  )
  const filtered = typeFilter === 'All' ? relationships : relationships.filter((r) => r.rtype === typeFilter)

  return (
    <Card className="absolute right-3 top-3 z-10 flex h-[calc(100%-1.5rem)] w-96 flex-col shadow-popover">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GitBranch className="h-4 w-4 text-accent-600 dark:text-accent-400" />
          Cross-Document Relationships
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTypeFilter('All')}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
              typeFilter === 'All'
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200'
                : 'border-border text-ink-muted hover:bg-surface-muted dark:border-border-dark dark:text-ink-subtle',
            )}
          >
            All ({relationships.length})
          </button>
          {types.map((t) => {
            const style = relationshipStyle(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  typeFilter === t ? style.badgeClass : 'border-border text-ink-muted hover:bg-surface-muted dark:border-border-dark dark:text-ink-subtle',
                )}
              >
                {style.label}
              </button>
            )
          })}
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          {isLoading ? (
            <div className="space-y-2 pr-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-subtle">No cross-document relationships found.</p>
          ) : (
            <ul className="space-y-2 pr-2">
              {filtered.map((rel, i) => {
                const style = relationshipStyle(rel.rtype)
                return (
                  <li key={`${rel.src_id}-${rel.rtype}-${rel.tgt_id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(rel)}
                      className="w-full rounded-md border border-border p-2.5 text-left text-xs transition-colors hover:bg-surface-muted dark:border-border-dark dark:hover:bg-surface-dark-muted"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={cn('border text-[10px]', style.badgeClass)}>
                          {style.label}
                        </Badge>
                        <span className="text-[10px] text-ink-subtle">{Math.round(rel.conf * 100)}%</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-ink-muted dark:text-ink-subtle">
                        <span className="font-medium text-ink dark:text-ink-inverted">{rel.src_text}</span>
                        <span className="mx-1 text-ink-subtle">({rel.src_type} · {rel.src_doc})</span>
                        →{' '}
                        <span className="font-medium text-ink dark:text-ink-inverted">{rel.tgt_text}</span>
                        <span className="mx-1 text-ink-subtle">({rel.tgt_type} · {rel.tgt_doc})</span>
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main canvas + controls
// ---------------------------------------------------------------------------
interface KnowledgeGraphProps {
  workspaceId: string
  refreshKey?: number | string
}

function KnowledgeGraphInner({ workspaceId, refreshKey }: KnowledgeGraphProps) {
  const queryClient = useQueryClient()
  const rf = useReactFlow()

  const [showContains, setShowContains] = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('structured')
  const [spacing, setSpacing] = useState(DEFAULT_SPACING)
  const [merged, setMerged] = useState<GraphData>({ nodes: [], edges: [] })
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [layoutLoading, setLayoutLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [expandingId, setExpandingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [crossDocOpen, setCrossDocOpen] = useState(false)
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set())
  const [highlightedEdgeKey, setHighlightedEdgeKey] = useState<string | null>(null)

  const graphQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'graph', showContains],
    queryFn: () => getGraphData(workspaceId, showContains),
  })

  // Refetch when refreshKey changes (skip the initial mount).
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'graph'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'cross-doc'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Sync merged local state (which also accumulates expanded subgraphs) with fresh fetches.
  useEffect(() => {
    if (graphQuery.data) {
      setMerged(graphQuery.data)
      setSelectedNode(null)
      setHighlightedNodeIds(new Set())
      setHighlightedEdgeKey(null)
    }
  }, [graphQuery.data])

  // Recompute layout whenever the graph or the layout engine changes.
  useEffect(() => {
    if (merged.nodes.length === 0) {
      setPositions({})
      return
    }
    let cancelled = false
    setLayoutLoading(true)
    const run = async () => {
      const pos =
        layoutMode === 'structured'
          ? await computeElkLayout(merged.nodes, merged.edges, spacing)
          : computeForceLayout(merged.nodes, merged.edges, spacing)
      if (!cancelled) {
        setPositions(pos)
        setLayoutLoading(false)
      }
    }
    run().catch(() => {
      if (!cancelled) setLayoutLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [merged, layoutMode, spacing])

  // Fit view once a fresh layout has settled.
  useEffect(() => {
    if (!layoutLoading && Object.keys(positions).length > 0) {
      const id = window.setTimeout(
        () => rf.fitView({ duration: 300, padding: 0.15, minZoom: 0.5, maxZoom: 1.5 }),
        30,
      )
      return () => window.clearTimeout(id)
    }
  }, [layoutLoading, positions, rf])

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return merged.nodes.filter((n) => n.id.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
  }, [search, merged.nodes])
  const searchMatchIds = useMemo(() => new Set(searchMatches.map((n) => n.id)), [searchMatches])
  const isSearching = search.trim().length > 0

  const rfNodes: RFNode[] = useMemo(
    () =>
      merged.nodes.map((n) => ({
        id: n.id,
        type: 'graphNode',
        position: positions[n.id] ?? { x: 0, y: 0 },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: {
          node: n,
          highlighted: highlightedNodeIds.has(n.id),
          matched: isSearching && searchMatchIds.has(n.id),
          dimmed: isSearching && !searchMatchIds.has(n.id),
          expanding: expandingId === n.id,
        },
      })),
    [merged.nodes, positions, highlightedNodeIds, searchMatchIds, isSearching, expandingId],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      merged.edges.map((e, i) => {
        const color = RELATIONSHIP_HEX[e.rtype] ?? RELATIONSHIP_HEX.CONTAINS
        const isHighlighted = highlightedEdgeKey === edgeKey(e)
        const dimmed = highlightedEdgeKey !== null && !isHighlighted
        return {
          id: `${edgeKey(e)}__${i}`,
          source: e.src,
          target: e.tgt,
          style: {
            stroke: color,
            strokeWidth: isHighlighted ? 3 : 1.5,
            opacity: dimmed ? 0.2 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          label: relationshipStyle(e.rtype).label,
          labelStyle: { fontSize: 10, fill: color, fontWeight: 500 },
          labelBgStyle: { fillOpacity: 0.85 },
        }
      }),
    [merged.edges, highlightedEdgeKey],
  )

  const handleNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedNode(node.data.node)
  }, [])

  // Persist manual drag repositioning into `positions` so nodes stay where the
  // user left them across re-renders (rfNodes reads from `positions[n.id]`).
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const moved = changes.filter(
      (c): c is NodeChange & { type: 'position'; position: { x: number; y: number } } =>
        c.type === 'position' && !!c.position,
    )
    if (moved.length === 0) return
    setPositions((prev) => {
      const next = { ...prev }
      for (const change of moved) next[change.id] = change.position
      return next
    })
  }, [])

  const handleNodeDoubleClick = useCallback(
    async (_: unknown, node: RFNode) => {
      const graphNode = node.data.node
      setExpandingId(graphNode.id)
      try {
        const sub = await getSubgraph(workspaceId, graphNode.id)
        setMerged((prev) => mergeGraphData(prev, sub))
      } catch (err) {
        console.error('Failed to expand node neighborhood', err)
      } finally {
        setExpandingId(null)
      }
    },
    [workspaceId],
  )

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (searchMatches.length === 0) return
    rf.fitView({ nodes: searchMatches.map((n) => ({ id: n.id })), duration: 400, padding: 0.3 })
  }

  function handleCrossDocSelect(rel: CrossDocRelationship) {
    const nodeIds = new Set(merged.nodes.map((n) => n.id))
    setHighlightedNodeIds(new Set([rel.src_id, rel.tgt_id]))
    setHighlightedEdgeKey(`${rel.src_id}__${rel.rtype}__${rel.tgt_id}`)
    const present = [rel.src_id, rel.tgt_id].filter((id) => nodeIds.has(id))
    if (present.length > 0) {
      rf.fitView({ nodes: present.map((id) => ({ id })), duration: 400, padding: 0.35 })
    }
  }

  const isLoading = graphQuery.isLoading
  const isEmpty = !isLoading && merged.nodes.length === 0

  return (
    <div className="relative h-[calc(100vh-260px)] min-h-[600px] w-full overflow-hidden rounded-lg border border-border bg-surface-subtle dark:border-border-dark dark:bg-surface-dark">
      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <Card className="flex items-center gap-1 p-1 shadow-popover">
          <Button
            variant={layoutMode === 'structured' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setLayoutMode('structured')}
          >
            <Layers className="mr-1 h-3.5 w-3.5" />
            Structured
          </Button>
          <Button
            variant={layoutMode === 'organic' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setLayoutMode('organic')}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Organic
          </Button>
        </Card>

        <Card className="flex items-center gap-1 p-1 shadow-popover">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={spacing <= MIN_SPACING}
                onClick={() => setSpacing((s) => Math.max(MIN_SPACING, +(s - SPACING_STEP).toFixed(2)))}
                aria-label="Decrease node spacing"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move nodes closer together</TooltipContent>
          </Tooltip>
          <span className="w-10 shrink-0 text-center text-[11px] font-medium text-ink-muted dark:text-ink-subtle">
            {Math.round((spacing / DEFAULT_SPACING) * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={spacing >= MAX_SPACING}
                onClick={() => setSpacing((s) => Math.min(MAX_SPACING, +(s + SPACING_STEP).toFixed(2)))}
                aria-label="Increase node spacing"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Spread nodes further apart</TooltipContent>
          </Tooltip>
        </Card>

        <form onSubmit={handleSearchSubmit}>
          <Card className="flex items-center gap-1.5 px-2 py-1 shadow-popover">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search node id or text…"
              className="h-6 w-52 border-none p-0 text-xs shadow-none focus-visible:ring-0"
            />
            {isSearching && (
              <>
                <span className="shrink-0 text-[10px] text-ink-subtle">{searchMatches.length}</span>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="shrink-0 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </Card>
        </form>

        <Card className="flex items-center gap-2 px-3 py-1.5 shadow-popover">
          <Checkbox
            id="show-contains"
            checked={showContains}
            onCheckedChange={(checked) => setShowContains(checked === true)}
          />
          <label htmlFor="show-contains" className="cursor-pointer text-xs text-ink-muted dark:text-ink-subtle">
            Show CONTAINS edges
          </label>
        </Card>

        <Button
          variant={crossDocOpen ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs shadow-popover"
          onClick={() => setCrossDocOpen((v) => !v)}
        >
          <GitBranch className="mr-1.5 h-3.5 w-3.5" />
          Cross-Doc
        </Button>

        {layoutLoading && (
          <Card className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-ink-muted shadow-popover dark:text-ink-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Computing layout…
          </Card>
        )}
      </div>

      {/* Canvas */}
      {isLoading ? (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
            <p className="text-sm text-ink-muted dark:text-ink-subtle">Loading knowledge graph…</p>
          </div>
        </div>
      ) : isEmpty ? (
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-sm text-center">
            <GitBranch className="mx-auto h-8 w-8 text-ink-subtle" />
            <p className="mt-3 text-sm font-medium text-ink dark:text-ink-inverted">No graph data yet</p>
            <p className="mt-1 text-xs text-ink-muted dark:text-ink-subtle">
              Ingest a document into this workspace to build its knowledge graph.
            </p>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          nodesDraggable
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={() => setSelectedNode(null)}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#94a3b8" gap={24} size={1} className="opacity-40" />
          <Controls className="!shadow-popover [&_button]:!border-border [&_button]:!bg-surface [&_button]:dark:!border-border-dark [&_button]:dark:!bg-surface-dark-subtle [&_button]:dark:!fill-ink-inverted" />
          <MiniMap
            pannable
            zoomable
            onClick={(_, pos) => rf.setCenter(pos.x, pos.y, { zoom: 1.4, duration: 500 })}
            className="!bg-surface dark:!bg-surface-dark-subtle [&_.react-flow__minimap-svg]:cursor-pointer"
            maskColor="rgba(148, 163, 184, 0.15)"
            nodeColor={(n) => {
              const data = (n as RFNode).data
              return data?.node ? ELEMENT_HEX[data.node.type] ?? '#94a3b8' : '#94a3b8'
            }}
          />
        </ReactFlow>
      )}

      {selectedNode && !crossDocOpen && (
        <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {crossDocOpen && (
        <CrossDocPanel
          workspaceId={workspaceId}
          onClose={() => setCrossDocOpen(false)}
          onSelect={handleCrossDocSelect}
        />
      )}
    </div>
  )
}

export function KnowledgeGraph({ workspaceId, refreshKey }: KnowledgeGraphProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphInner workspaceId={workspaceId} refreshKey={refreshKey} />
    </ReactFlowProvider>
  )
}
