import clsx from 'clsx'

export default function KMapLogo({ size = 24, className = '' }: { size?: number; className?: string }) {
  const s = size
  // 5-node graph: center + 4 directional nodes
  // viewBox 0 0 48 48
  // center: (24,24), top: (24,6), right: (42,24), bottom: (24,42), left: (6,24)
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={clsx(className)}>
      {/* Edges — draw behind nodes */}
      <line x1="24" y1="6" x2="24" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.5"/>
      <line x1="42" y1="24" x2="24" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.5"/>
      <line x1="24" y1="42" x2="24" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.5"/>
      <line x1="6" y1="24" x2="24" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.5"/>
      <line x1="24" y1="6" x2="42" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
      <line x1="42" y1="24" x2="24" y2="42" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
      <line x1="24" y1="42" x2="6" y2="24" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
      <line x1="6" y1="24" x2="24" y2="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
      {/* Outer nodes */}
      <circle cx="24" cy="6" r="4.5" fill="currentColor"/>
      <circle cx="42" cy="24" r="4.5" fill="currentColor"/>
      <circle cx="24" cy="42" r="4.5" fill="currentColor"/>
      <circle cx="6" cy="24" r="4.5" fill="currentColor"/>
      {/* Center node — slightly larger */}
      <circle cx="24" cy="24" r="5.5" fill="currentColor"/>
    </svg>
  )
}
