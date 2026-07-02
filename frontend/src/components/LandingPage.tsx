import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Network, GitBranch, MessageSquare, ArrowRight, FlaskConical,
  Sparkles, ShieldCheck, Database, CheckCircle2,
} from 'lucide-react'
import KnowledgeMapLogo from './KnowledgeMapLogo'
import ThemeToggle from './ThemeToggle'

interface Area {
  key: string
  icon: React.ReactNode
  title: string
  blurb: string
  bullets: { icon: React.ReactNode; text: string }[]
  cta: string
  route: string
}

const AREAS: Area[] = [
  {
    key: 'analysis',
    icon: <Network size={18} className="text-primary" />,
    title: 'Analysis',
    blurb: 'Turn real RFPs, risk sheets & contracts into a queryable knowledge graph.',
    bullets: [
      { icon: <Sparkles size={13} />,      text: 'GPT-4o extraction → typed knowledge graph' },
      { icon: <GitBranch size={13} />,     text: 'Requirement → clause coverage & risk traceability' },
      { icon: <MessageSquare size={13} />, text: 'Natural-language Q&A over the graph' },
    ],
    cta: 'Open Analysis',
    route: '/workspaces',
  },
  {
    key: 'studio',
    icon: <FlaskConical size={18} className="text-primary" />,
    title: 'Synthetic Data Studio',
    blurb: 'Generate, validate, quality-check & SME-review synthetic contract data.',
    bullets: [
      { icon: <Sparkles size={13} />,    text: 'Generate clauses, requirements, risks & whole contracts' },
      { icon: <ShieldCheck size={13} />, text: 'Schema · label · duplicate · realism · diversity checks' },
      { icon: <Database size={13} />,    text: 'SME review → versioned datasets → publish to Analysis' },
    ],
    cta: 'Open Studio',
    route: '/studio',
  },
]

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-20"><ThemeToggle /></div>

      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(to right, #6366f1 1px, transparent 1px), linear-gradient(to bottom, #6366f1 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
      }} />
      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-purple-600/8 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center text-center max-w-4xl w-full"
      >
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, duration: 0.4 }}
          className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mb-6 shadow-lg shadow-primary/10"
        >
          <KnowledgeMapLogo size={36} className="text-primary" />
        </motion.div>

        {/* Title */}
        <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="text-5xl font-bold text-foreground tracking-tight mb-2">
          ContractIQ
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
          className="text-lg text-muted font-mono mb-2">
          Contract Intelligence Platform
        </motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="text-slate-400 text-sm max-w-xl mb-10 leading-relaxed">
          Two capabilities, one platform — <span className="text-foreground">analyze</span> real procurement
          documents as a knowledge graph, and <span className="text-foreground">generate</span> validated,
          SME-reviewed synthetic datasets that publish straight back into it.
        </motion.p>

        {/* Two co-equal product areas */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mb-10"
        >
          {AREAS.map(area => (
            <button
              key={area.key}
              onClick={() => navigate(area.route)}
              className="group flex flex-col text-left gap-3 p-6 rounded-2xl bg-surface border border-border hover:border-primary/50 hover:shadow-[0_4px_32px_rgba(99,102,241,0.12)] transition-all active:scale-[0.99]"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  {area.icon}
                </div>
                <span className="font-semibold text-foreground text-base">{area.title}</span>
                <ArrowRight size={16} className="ml-auto text-muted group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="text-xs text-muted leading-relaxed">{area.blurb}</p>
              <ul className="space-y-1.5 mt-1">
                {area.bullets.map((b, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="text-primary shrink-0">{b.icon}</span>{b.text}
                  </li>
                ))}
              </ul>
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                {area.cta} <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </motion.div>

        {/* Unified flow strip */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="flex items-center flex-wrap justify-center gap-2 text-[11px] font-mono text-muted mb-8"
        >
          {['Generate', 'Validate', 'Quality', 'SME Review', 'Publish', 'Analyze'].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-2">
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-card border border-border">
                <CheckCircle2 size={11} className="text-primary" />{s}
              </span>
              {i < arr.length - 1 && <span className="text-border">→</span>}
            </span>
          ))}
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
          className="text-xs text-slate-700 font-mono">
          Neo4j · Qdrant · MinIO · GPT-4o · BGE-M3 · FastAPI · React
        </motion.p>
      </motion.div>
    </div>
  )
}
