import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  GitCompareArrows,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { truncate } from '@/lib/formatters'
import { elementStyle, relationshipStyle, coverageStyle } from '@/lib/domain-taxonomy'
import type {
  CoverageSummary,
  CrossDocRelationship,
  EvidenceConnection,
  EvidenceItem,
  GraphNode,
} from '@/types/analysis'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TEXT_TRUNCATE_LENGTH = 160

function ConfidencePct({ confidence }: { confidence?: number }) {
  if (confidence === undefined || confidence === null || Number.isNaN(confidence)) return null
  return (
    <span className="text-xs font-medium text-ink-subtle">
      {Math.round(confidence * 100)}% confidence
    </span>
  )
}

function NodeMeta({ node }: { node: GraphNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
      {node.source && (
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {node.source}
        </span>
      )}
      {node.page_number !== undefined && <span>p. {node.page_number}</span>}
      <ConfidencePct confidence={node.confidence} />
    </div>
  )
}

interface ConnectionRowProps {
  connection: EvidenceConnection
  depth?: number
}

function ConnectionRow({ connection, depth = 0 }: ConnectionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { node, rel, direction, connections } = connection
  const relStyle = relationshipStyle(rel)
  const nodeStyle = elementStyle(node.type)
  const hasChildren = !!connections && connections.length > 0

  return (
    <div className={cn('border-l border-border pl-3 dark:border-border-dark', depth > 0 && 'ml-2')}>
      <button
        type="button"
        onClick={() => hasChildren && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-start gap-2 rounded-md py-1.5 text-left text-sm',
          hasChildren && 'cursor-pointer hover:bg-surface-muted dark:hover:bg-surface-dark-muted'
        )}
      >
        {direction === 'in' ? (
          <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        ) : (
          <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('text-[11px] font-medium', relStyle.textClass)}>{relStyle.label}</span>
            <Badge className={cn('text-[10px]', nodeStyle.badgeClass)} variant="outline">
              {nodeStyle.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-ink dark:text-ink-inverted">{truncate(node.text, TEXT_TRUNCATE_LENGTH)}</p>
          <NodeMeta node={node} />
        </div>
        {hasChildren && (
          <span className="mt-0.5 shrink-0 text-ink-subtle">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {hasChildren && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pb-1">
              {connections!.map((child, i) => (
                <ConnectionRow key={`${child.node.id}-${i}`} connection={child} depth={depth + 1} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface EvidenceCardProps {
  node: GraphNode & { connections?: EvidenceConnection[] }
}

export function EvidenceCard({ node }: EvidenceCardProps) {
  const [showFull, setShowFull] = useState(false)
  const [showConnections, setShowConnections] = useState(false)
  const style = elementStyle(node.type)
  const isLong = node.text.length > TEXT_TRUNCATE_LENGTH
  const hasConnections = !!node.connections && node.connections.length > 0

  return (
    <Card className="border-border/80">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge className={style.badgeClass} variant="outline">
            {style.label}
          </Badge>
          <ConfidencePct confidence={node.confidence} />
        </div>
        <p className="text-sm leading-relaxed text-ink dark:text-ink-inverted">
          {showFull ? node.text : truncate(node.text, TEXT_TRUNCATE_LENGTH)}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setShowFull((v) => !v)}
            className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
          >
            {showFull ? 'Show less' : 'Show more'}
          </button>
        )}
        <NodeMeta node={node} />
        {hasConnections && (
          <div className="border-t border-border pt-2 dark:border-border-dark">
            <button
              type="button"
              onClick={() => setShowConnections((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
            >
              {showConnections ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {node.connections!.length} related element{node.connections!.length === 1 ? '' : 's'}
            </button>
            <AnimatePresence initial={false}>
              {showConnections && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-0.5">
                    {node.connections!.map((c, i) => (
                      <ConnectionRow key={`${c.node.id}-${i}`} connection={c} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatBar({
  label,
  value,
  total,
  colorClass,
}: {
  label: string
  value: number
  total: number
  colorClass: string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted dark:text-ink-subtle">{label}</span>
        <span className="font-medium text-ink dark:text-ink-inverted">
          {value} <span className="text-ink-subtle">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted dark:bg-surface-dark-muted">
        <div className={cn('h-full rounded-full', colorClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

interface SummaryCardProps {
  summary: CoverageSummary
}

export function SummaryCard({ summary }: SummaryCardProps) {
  const { requirements, risks } = summary
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Coverage Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Requirements ({requirements.total})
          </p>
          <StatBar
            label={coverageStyle('Covered').label}
            value={requirements.covered}
            total={requirements.total}
            colorClass={coverageStyle('Covered').dotClass}
          />
          <StatBar
            label={coverageStyle('Partially Covered').label}
            value={requirements.partial}
            total={requirements.total}
            colorClass={coverageStyle('Partially Covered').dotClass}
          />
          <StatBar
            label={coverageStyle('Not Covered').label}
            value={requirements.not_covered}
            total={requirements.total}
            colorClass={coverageStyle('Not Covered').dotClass}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Risks ({risks.total})
          </p>
          <StatBar
            label="Mitigated"
            value={risks.mitigated}
            total={risks.total}
            colorClass="bg-success-500"
          />
          <StatBar
            label="Unmitigated"
            value={risks.unmitigated}
            total={risks.total}
            colorClass="bg-danger-500"
          />
        </div>
      </CardContent>
    </Card>
  )
}

interface CrossDocCardProps {
  relationship: CrossDocRelationship
}

export function CrossDocCard({ relationship }: CrossDocCardProps) {
  const rel = relationship
  const relStyle = relationshipStyle(rel.rtype)
  const srcStyle = elementStyle(rel.src_type)
  const tgtStyle = elementStyle(rel.tgt_type)
  const isCrossDoc = rel.src_document_id !== rel.tgt_document_id

  return (
    <Card className="border-border/80">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge className={relStyle.badgeClass} variant="outline">
            {relStyle.label}
          </Badge>
          {isCrossDoc && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-600 dark:text-accent-400">
              <GitCompareArrows className="h-3.5 w-3.5" />
              Cross-document
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          <Badge className={srcStyle.badgeClass} variant="outline">
            {srcStyle.label}
          </Badge>
          <p className="text-sm text-ink dark:text-ink-inverted">{truncate(rel.src_text, TEXT_TRUNCATE_LENGTH)}</p>
          {rel.src_source && <p className="text-xs text-ink-subtle">{rel.src_source}</p>}
        </div>
        <div className="flex items-center gap-2 text-ink-subtle">
          <ArrowDownLeft className="h-4 w-4 rotate-90" />
        </div>
        <div className="space-y-1.5">
          <Badge className={tgtStyle.badgeClass} variant="outline">
            {tgtStyle.label}
          </Badge>
          <p className="text-sm text-ink dark:text-ink-inverted">{truncate(rel.tgt_text, TEXT_TRUNCATE_LENGTH)}</p>
          {rel.tgt_source && <p className="text-xs text-ink-subtle">{rel.tgt_source}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

interface SourcesSectionProps {
  evidence: EvidenceItem[]
}

export function SourcesSection({ evidence }: SourcesSectionProps) {
  const [open, setOpen] = useState(false)
  if (!evidence || evidence.length === 0) return null

  return (
    <Card className="border-border/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-surface-muted dark:text-ink-inverted dark:hover:bg-surface-dark-muted"
      >
        <span>
          {evidence.length} source{evidence.length === 1 ? '' : 's'}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border p-4 dark:border-border-dark">
              {evidence.map((item, i) => {
                if ('kind' in item && item.kind === 'summary') {
                  return <SummaryCard key={i} summary={item} />
                }
                if ('kind' in item && item.kind === 'cross_doc') {
                  return <CrossDocCard key={i} relationship={item} />
                }
                return <EvidenceCard key={(item as GraphNode).id ?? i} node={item as GraphNode & { connections?: EvidenceConnection[] }} />
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
