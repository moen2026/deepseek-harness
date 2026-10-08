// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandMascot } from '../src/BrandMascot.tsx'
import css from '../src/BrandMascot.module.css'

afterEach(cleanup)

describe('BrandMascot', () => {
  it('renders the gradient mark at the default 24px inside its bare hitbox', () => {
    const { container } = render(<BrandMascot />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    const span = container.querySelector('span')!
    expect(span.classList.contains(css.hitbox!)).toBe(true)
    expect(span.classList.length).toBe(1)
    const gradient = svg?.querySelector('linearGradient')
    expect(gradient?.id).toMatch(/^dsh-mascot-/)
    expect(svg?.querySelector('path')?.getAttribute('fill')).toBe(`url(#${gradient?.id})`)
  })

  it('honors the size prop and appends the owner class to the hitbox', () => {
    const { container } = render(<BrandMascot size={44} className="hero-deco" />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('44')
    const span = container.querySelector('span')!
    expect(span.classList.contains(css.hitbox!)).toBe(true)
    expect(span.classList.contains('hero-deco')).toBe(true)
    expect(span.classList.length).toBe(2)
  })

  it('keeps per-instance gradient ids so the mark can appear more than once per page', () => {
    const { container } = render(
      <>
        <BrandMascot />
        <BrandMascot />
      </>,
    )
    const ids = [...container.querySelectorAll('linearGradient')].map(node => node.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).not.toContain(':')
  })
})
