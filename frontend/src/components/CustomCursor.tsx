import { useEffect, useRef } from 'react'

const HOVER_SELECTOR = 'a, button, [role="button"], input, select, textarea, .cursor-pointer, [data-cursor-hover]'

interface Ripple { x: number; y: number; born: number }

/**
 * Fully custom cursor (native pointer hidden via .custom-cursor-active in
 * index.css): a tight dot pinned exactly to the pointer, a ring that trails
 * with a touch of lag and blooms over interactive elements, an optional
 * text label for anything tagged `data-cursor-text="..."`, and a small
 * expanding ripple on click for tactile feedback.
 */
export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const rippleLayerRef = useRef<HTMLDivElement>(null)

  const target = useRef({ x: -100, y: -100 })
  const ring = useRef({ x: -100, y: -100 })
  const hovering = useRef(false)
  const labelText = useRef<string | null>(null)
  const ripples = useRef<Ripple[]>([])
  const raf = useRef<number>()

  useEffect(() => {
    const isFinePointer = window.matchMedia('(pointer: fine)').matches
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!isFinePointer || reduceMotion) return

    const show = (v: boolean) => {
      const op = v ? '1' : '0'
      if (dotRef.current) dotRef.current.style.opacity = op
      if (ringRef.current) ringRef.current.style.opacity = op
    }

    const onMove = (e: MouseEvent) => {
      target.current.x = e.clientX
      target.current.y = e.clientY
      const hoveredEl = (e.target as Element)?.closest?.(HOVER_SELECTOR) ?? null
      hovering.current = !!hoveredEl
      const text = (hoveredEl as HTMLElement | null)?.dataset?.cursorText ?? null
      if (text !== labelText.current) {
        labelText.current = text
        if (labelRef.current) {
          labelRef.current.textContent = text ?? ''
          labelRef.current.style.opacity = text ? '1' : '0'
        }
      }
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`
      }
      show(true)
    }
    const onLeaveWindow = () => show(false)
    const onDown = (e: MouseEvent) => {
      ringRef.current?.setAttribute('data-pressed', '1')
      ripples.current.push({ x: e.clientX, y: e.clientY, born: performance.now() })
    }
    const onUp = () => ringRef.current?.removeAttribute('data-pressed')

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeaveWindow)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    document.documentElement.classList.add('custom-cursor-active')

    const RIPPLE_MS = 500
    const tick = () => {
      ring.current.x += (target.current.x - ring.current.x) * 0.2
      ring.current.y += (target.current.y - ring.current.y) * 0.2
      if (ringRef.current) {
        const pressed = ringRef.current.getAttribute('data-pressed') === '1'
        const scale = hovering.current ? 1.8 : pressed ? 0.75 : 1
        ringRef.current.style.transform =
          `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%) scale(${scale})`
        ringRef.current.style.borderColor = hovering.current
          ? 'var(--primary)'
          : 'color-mix(in srgb, var(--primary) 70%, transparent)'
        ringRef.current.style.background = hovering.current
          ? 'color-mix(in srgb, var(--primary) 14%, transparent)'
          : 'transparent'
      }
      if (labelRef.current) {
        labelRef.current.style.transform = `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(16px, -50%)`
      }

      // Click ripples — draw as plain divs, prune once past their lifetime.
      const now = performance.now()
      ripples.current = ripples.current.filter(r => now - r.born < RIPPLE_MS)
      if (rippleLayerRef.current) {
        rippleLayerRef.current.innerHTML = ''
        for (const r of ripples.current) {
          const t = (now - r.born) / RIPPLE_MS
          const el = document.createElement('div')
          el.className = 'fixed rounded-full pointer-events-none'
          const size = 8 + t * 46
          Object.assign(el.style, {
            left: `${r.x}px`, top: `${r.y}px`,
            width: `${size}px`, height: `${size}px`,
            transform: 'translate(-50%, -50%)',
            border: '1.5px solid color-mix(in srgb, var(--primary) 80%, transparent)',
            opacity: `${1 - t}`,
          })
          rippleLayerRef.current.appendChild(el)
        }
      }

      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeaveWindow)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      if (raf.current) cancelAnimationFrame(raf.current)
      document.documentElement.classList.remove('custom-cursor-active')
    }
  }, [])

  return (
    <>
      <div ref={rippleLayerRef} className="fixed inset-0 z-[9997] pointer-events-none" />
      <div
        ref={ringRef}
        className="pointer-events-none fixed top-0 left-0 z-[9998] w-7 h-7 rounded-full border opacity-0 transition-[transform,background,border-color,opacity] duration-150 ease-out will-change-transform"
        style={{ boxShadow: '0 0 14px 1px color-mix(in srgb, var(--primary) 25%, transparent)' }}
      />
      <div
        ref={labelRef}
        className="pointer-events-none fixed top-0 left-0 z-[9998] px-2 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap opacity-0 transition-opacity duration-150"
        style={{ background: 'var(--primary)', color: 'white' }}
      />
      <div
        ref={dotRef}
        className="pointer-events-none fixed top-0 left-0 z-[9999] w-1.5 h-1.5 rounded-full opacity-0 transition-opacity duration-150"
        style={{ background: 'var(--primary)', boxShadow: '0 0 6px 1.5px color-mix(in srgb, var(--primary) 65%, transparent)' }}
      />
    </>
  )
}
