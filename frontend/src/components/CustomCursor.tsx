import { useEffect, useRef } from 'react'

const HOVER_SELECTOR = 'a, button, [role="button"], input, select, textarea, .cursor-pointer, [data-cursor-hover]'

/**
 * Minimal custom cursor (native pointer hidden via .custom-cursor-active in
 * index.css): a single small dot pinned to the pointer that grows a touch and
 * softens over interactive elements.
 *
 * Deliberately restrained — no ring, no glow, no ripples — so it reads as a
 * refined product detail rather than a novelty. The outer element tracks the
 * pointer instantly (no transition, so position never lags); the inner element
 * animates only scale/opacity for the hover and press states.
 */
export default function CustomCursor() {
  const posRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const isFinePointer = window.matchMedia('(pointer: fine)').matches
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!isFinePointer || reduceMotion) return

    let hovering = false
    let pressed = false

    const paintDot = () => {
      const el = dotRef.current
      if (!el) return
      el.style.transform = `scale(${pressed ? 0.8 : hovering ? 1.6 : 1})`
      el.style.opacity = hovering ? '0.55' : '0.85'
    }

    const onMove = (e: MouseEvent) => {
      hovering = !!(e.target as Element)?.closest?.(HOVER_SELECTOR)
      if (posRef.current) {
        posRef.current.style.transform =
          `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`
        posRef.current.style.visibility = 'visible'
      }
      paintDot()
    }
    const onLeaveWindow = () => {
      if (posRef.current) posRef.current.style.visibility = 'hidden'
    }
    const onDown = () => { pressed = true; paintDot() }
    const onUp = () => { pressed = false; paintDot() }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeaveWindow)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    document.documentElement.classList.add('custom-cursor-active')

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeaveWindow)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.documentElement.classList.remove('custom-cursor-active')
    }
  }, [])

  return (
    <div
      ref={posRef}
      className="pointer-events-none fixed top-0 left-0 z-[9999] will-change-transform"
      style={{ visibility: 'hidden' }}
    >
      <div
        ref={dotRef}
        className="w-2 h-2 rounded-full transition-[transform,opacity] duration-150 ease-out"
        style={{ background: 'var(--primary)', opacity: 0.85 }}
      />
    </div>
  )
}
