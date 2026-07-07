import { Link } from 'react-router-dom'
import { ArrowRight, FlaskConical, LayoutGrid, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-16 max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-navy-200 bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700 dark:border-navy-700 dark:bg-navy-900/40 dark:text-navy-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          Contract Intelligence Platform
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl dark:text-white">
          ContractIQ
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted dark:text-ink-subtle">
          Contract intelligence for legal, financial, and procurement teams — trace coverage, surface
          risk, and query your contracts with confidence.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card hoverable className="flex flex-col">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-navy-50 text-navy-700 dark:bg-navy-900/40 dark:text-navy-200">
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
    </div>
  )
}
