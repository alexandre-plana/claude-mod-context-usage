import type { Register } from 'claude-code'

import type { Cat, Item, Snap } from '../types'

const snap = { plugin: 'context-band', key: 'snap' } as const

const COLORS: Record<string, string> = {
  messages: '#3b82f6',
  'system tools': '#e8622c',
  'memory files': '#1aa37a',
  'mcp tools': '#d99a0b',
  skills: '#b4b4ad',
  'custom agents': '#9d9d96',
  'system prompt': '#85857f',
  'mcp server instructions': '#6f6f6a',
}

const colorOf = (c: Cat): string => {
  if (c.kind === 'free') return 'subtle'
  if (c.kind === 'buffer') return '#5b5b57'
  return COLORS[c.name.toLowerCase()] ?? '#8a8a85'
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

const fmtPct = (p: number): string => `${p.toFixed(1).replace('.', ',')} %`.replace(',0 %', ' %')

const top = (items: Item[], n: number): Item[] =>
  [...items].sort((a, b) => b.tokens - a.tokens).slice(0, n)

const base = (path: string): string => path.split(/[\\/]/).pop() ?? path

function build(u: any): Snap | null {
  if (!u) return null
  const b = u.context.breakdown
  const max = b?.rawMaxTokens ?? u.context.window
  const tokens = b?.totalTokens ?? u.context.tokens ?? 0
  const perServer = new Map<string, number>()
  for (const t of b?.mcpTools ?? []) {
    if (t.isLoaded) perServer.set(t.serverName, (perServer.get(t.serverName) ?? 0) + t.tokens)
  }
  return {
    tokens,
    window: u.context.window,
    max,
    percent: b?.percentage ?? u.context.percent ?? (max ? (tokens / max) * 100 : 0),
    cats: (b?.categories ?? []).map((c: Cat) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    threshold: b?.autoCompactThreshold,
    servers: [...perServer].map(([name, t]) => ({ name, tokens: t })),
    memory: (b?.memoryFiles ?? []).map((m: any) => ({ name: base(m.path), tokens: m.tokens })),
    skills: (b?.skills?.skillFrontmatter ?? []).map((s: any) => ({ name: s.name, tokens: s.tokens })),
    rates: (u.rateLimits ?? []).map((r: any) => ({ kind: r.kind, percentUsed: r.percentUsed })),
    cost: u.cost?.usd,
  }
}

let last = 0

function due(force: boolean): boolean {
  const now = Date.now()
  if (!force && now - last < 1500) return false
  last = now
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const first = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (first) await $.state.set(snap, first)
    $.clock.every(5000, async () => {
      const tick = due(false) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
      if (tick) await $.state.set(snap, tick)
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    const fresh = due(false) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (fresh) await $.state.set(snap, fresh)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const fresh = due(false) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (fresh) await $.state.set(snap, fresh)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const fresh = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (fresh) await $.state.set(snap, fresh)
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    const fresh = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (fresh) await $.state.set(snap, fresh)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = (await $.state.get(snap)).value ?? null
    if (e.props.hasSurvey || s === null) return next(e)

    const table: any = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Svg = table.Svg

    const compact = async () => {
      try {
        $.ui.toast('Compactage du contexte…')
        await $.session.compact()
        const fresh = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
        if (fresh) await $.state.set(snap, fresh)
      } catch {
        $.ui.toast('Compactage impossible pendant qu’un tour est en cours.')
      }
    }

    const shown = s.cats.filter(c => c.kind !== 'deferred' && c.kind !== 'free' && c.tokens > 0)

    // Fine bar: a thin SVG where the surface has one, else a one-cell Box bar.
    const segs = shown.map(c => ({
      frac: c.tokens / Math.max(1, s.max),
      color: colorOf(c),
    }))
    const thick = 4
    let bar: any
    if (Svg) {
      let x = 0
      const rects = segs
        .map(g => {
          const w = Math.max(0, g.frac) * 1000
          const r = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${thick}" fill="${g.color}"/>`
          x += w
          return r
        })
        .join('')
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${thick}" viewBox="0 0 1000 ${thick}" preserveAspectRatio="none"><rect width="1000" height="${thick}" rx="2" fill="rgba(128,128,128,0.22)"/>${rects}</svg>`
      bar = <Svg source={source} alt="Utilisation du contexte" height={thick} />
    } else {
      bar = (
        <Box height={1} width="100%" backgroundColor="subtle">
          {segs.map(g => (
            <Box flexGrow={Math.max(1, Math.round(g.frac * 1000))} backgroundColor={g.color} />
          ))}
        </Box>
      )
    }

    return (
      <Box width="100%" gap={2} alignItems="center">
        <Box flexShrink={0}><Text bold wrap="truncate">{`${fmtPct(s.percent)} utilisé`}</Text></Box>
        <Box flexGrow={1} minWidth={0} overflow="hidden">{bar}</Box>
        <Box flexShrink={0}><Text dimColor wrap="truncate">{`${fmtTokens(s.tokens)} / ${fmtTokens(s.max)}`}</Text></Box>
        <Button key="compact" label="Compacter" hotkey="c" onPress={compact} />
      </Box>
    )
  })
}
