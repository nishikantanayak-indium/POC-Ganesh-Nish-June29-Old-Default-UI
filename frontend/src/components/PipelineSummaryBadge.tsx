import type { PipelineSummary } from '../types'

export default function PipelineSummaryBadge({ summary }: { summary: PipelineSummary }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30 text-xs font-mono">
      <span className="text-success font-semibold">✓ Done</span>
      <span className="text-muted">{summary.documents} docs</span>
      <span className="text-muted">{summary.elements} elements</span>
      <span className="text-muted">{summary.nodes} nodes</span>
      <span className="text-muted">{summary.elapsed}s</span>
    </div>
  )
}
