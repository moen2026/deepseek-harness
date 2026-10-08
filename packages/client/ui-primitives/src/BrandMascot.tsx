import { useId } from 'react'
import type { IconProps } from './icons/props.ts'
import css from './BrandMascot.module.css'

/**
 * The "D" brand mascot: a gradient body, a white face counter, and two eyes.
 * Decorative (aria-hidden). Static at rest; hovering the mark bobs, sways and
 * breathes the body while the eyes blink (the motion lives in the co-located
 * CSS module, gated to hover + prefers-reduced-motion: no-preference). The
 * mark sits in a padded hitbox so the pointer need not land exactly on the
 * glyph to start the motion. The gradient id is per-instance, so the mark can
 * appear more than once per page.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement (on the hitbox).
 * @returns the mascot svg wrapped in its hover hitbox.
 */
export function BrandMascot({ size = 24, className }: IconProps) {
  const grad = `dsh-mascot-${useId().replace(/:/g, '')}`
  return (
    <span className={className === undefined ? css.hitbox : `${css.hitbox} ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className={css.mascot}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={grad} x1="88%" y1="8%" x2="12%" y2="96%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="42%" stopColor="#2563eb" />
            <stop offset="74%" stopColor="#3b5bdb" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <path
          d="M26 14H56C78 14 92 30 92 50C92 70 78 86 56 86H26C20 86 16 82 16 76V24C16 18 20 14 26 14Z"
          fill={`url(#${grad})`}
        />
        <path
          d="M40 32H54C66 32 74 40 74 50C74 60 66 68 54 68H40C37 68 35 66 35 63V37C35 34 37 32 40 32Z"
          fill="#ffffff"
        />
        <rect className={css.eye} x={44} y={42} width={8} height={18} rx={4} fill="#1e40af" />
        <rect className={css.eye} x={58} y={42} width={8} height={18} rx={4} fill="#1e40af" />
      </svg>
    </span>
  )
}
