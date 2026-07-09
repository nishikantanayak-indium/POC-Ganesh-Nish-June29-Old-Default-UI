import { Link } from 'react-router-dom'
import {
  ArrowRight,
  FileEdit,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  MessageSquareText,
  ShieldCheck,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

const FEATURES = [
  {
    icon: UploadCloud,
    title: 'Ingest & extract',
    description: 'Upload contracts, RFPs, and risk sheets — requirements, clauses, risks, and mitigations are extracted automatically.',
  },
  {
    icon: GitBranch,
    title: 'Trace coverage',
    description: 'Follow every requirement through to the clauses that cover it, and see exactly where coverage is partial or missing.',
  },
  {
    icon: ShieldAlert,
    title: 'Surface risk',
    description: 'Identify unmitigated risks, missing liquidated-damages clauses, and contradicting clauses before they become a problem in negotiation.',
  },
  {
    icon: MessageSquareText,
    title: 'Ask in plain English',
    description: 'Query your document set conversationally and get answers grounded in graph evidence, not guesswork.',
  },
  {
    icon: FileEdit,
    title: 'Draft an offer',
    description: 'Generate an evidence-backed offer/proposal in response to an RFP — every section traces to a real requirement, clause, or risk.',
  },
]

const STEPS = [
  { label: 'Upload documents', description: 'Drop in contracts, RFPs, or risk sheets — PDF or DOCX.' },
  { label: 'Build the graph', description: 'Elements and relationships are extracted and linked automatically.' },
  { label: 'Trace, chat, review', description: 'Explore coverage, chase down risk, and ask questions of your corpus.' },
]

function GraphPreview() {
  const nodes = [
    { label: 'Requirement', sub: 'REQ_014', badge: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-200 dark:border-slate-700', x: 8, y: 18 },
    { label: 'Clause', sub: 'CL_009', badge: 'bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-900/30 dark:text-accent-200 dark:border-accent-800', x: 52, y: 8 },
    { label: 'Risk', sub: 'RISK_002', badge: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-700/20 dark:text-danger-400 dark:border-danger-700/40', x: 58, y: 52 },
    { label: 'Mitigation', sub: 'MIT_005', badge: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40', x: 14, y: 68 },
  ]

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-surface-subtle p-4 dark:border-border-dark dark:bg-surface-dark-subtle">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <line x1="18%" y1="26%" x2="55%" y2="16%" stroke="currentColor" className="text-border dark:text-border-dark" strokeWidth="1.5" />
        <line x1="55%" y1="16%" x2="62%" y2="58%" stroke="currentColor" className="text-border dark:text-border-dark" strokeWidth="1.5" />
        <line x1="62%" y1="58%" x2="22%" y2="74%" stroke="currentColor" className="text-border dark:text-border-dark" strokeWidth="1.5" />
      </svg>
      {nodes.map((n) => (
        <div
          key={n.sub}
          className="absolute w-32 rounded-md border border-border bg-surface px-2.5 py-2 shadow-card dark:border-border-dark dark:bg-surface-dark"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <p className="font-mono text-[10px] text-ink-subtle">{n.sub}</p>
          <Badge variant="outline" className={`mt-1 border text-[10px] ${n.badge}`}>
            {n.label}
          </Badge>
        </div>
      ))}
    </div>
  )
}

export function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      {/* Hero */}
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Contract Intelligence Platform
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl dark:text-white">
            Contract<span className="text-accent-600 dark:text-accent-400">IQ</span>
          </h1>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-muted dark:text-ink-subtle">
            Contract intelligence for legal, financial, and procurement teams — trace coverage, surface
            risk, and query your contracts with confidence.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link to="/workspaces">
                Open Workspaces
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/studio">
                Explore Synthetic Studio
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <GraphPreview />
      </div>

      {/* Feature highlights */}
      <div className="mt-24 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
              <f.icon className="h-4.5 w-4.5" />
            </div>
            <h3 className="text-sm font-semibold text-ink dark:text-white">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted dark:text-ink-subtle">{f.description}</p>
          </div>
        ))}
      </div>

      <Separator className="my-16" />

      {/* How it works */}
      <div>
        <h2 className="text-lg font-semibold text-ink dark:text-white">How it works</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.label} className="relative">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-sm font-semibold text-white">
                {i + 1}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink dark:text-white">{s.label}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted dark:text-ink-subtle">{s.description}</p>
            </div>
          ))}
        </div>
      </div>

      <Separator className="my-16" />

      {/* Entry points */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card hoverable className="flex flex-col">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
              <LayoutGrid className="h-5 w-5" />
            </div>
            <CardTitle>Analysis Workspaces</CardTitle>
            <CardDescription>
              Ingest contracts and requirements, build a knowledge graph, and trace coverage, risk, and
              mitigations across documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <Button asChild>
              <Link to="/workspaces">
                Open Workspaces
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card hoverable className="flex flex-col">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200">
              <FlaskConical className="h-5 w-5" />
            </div>
            <CardTitle>Synthetic Data Studio</CardTitle>
            <CardDescription>
              Generate, review, and publish synthetic contract records and documents to expand and
              stress-test your analysis library.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <Button asChild variant="secondary">
              <Link to="/studio">
                Open Studio
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-xs text-ink-subtle dark:border-border-dark">
        <span>© {new Date().getFullYear()} ContractIQ</span>
        <a href="mailto:support@contractiq.app" className="hover:text-ink dark:hover:text-ink-inverted">
          Support
        </a>
      </footer>
    </div>
  )
}
