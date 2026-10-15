import type { Register } from 'claude-code'

import type { Cat, Item, Snap } from '../types'

const snap = { plugin: 'context-band', key: 'snap' } as const
const isExpanded = { plugin: 'context-band', key: 'isExpanded' } as const

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

    const expanded = (await $.state.get(isExpanded)).value ?? false
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

    const shown = s.cats.filter(c => c.kind !== 'deferred' && c.tokens > 0)
    const deferred = s.cats.filter(c => c.kind === 'deferred' && c.tokens > 0)
    const total = shown.reduce((a, c) => a + c.tokens, 0)
    const pct = Math.min(100, s.percent)
    const alert = s.tokens >= 650_000 ? 'error' : s.tokens >= 500_000 ? 'claude' : s.tokens >= 300_000 ? 'warning' : undefined
    const ink = alert ? 'inverseText' : undefined
    const gaugeColor = alert ? 'inverseText' : pct >= 85 ? 'error' : pct >= 65 ? 'warning' : 'text'

    // Fine bar: a thin SVG where the surface has one, else a one-cell Box bar.
    const bar = (segs: { frac: number; color: string }[], thick: number) => {
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
        return <Svg source={source} alt="Utilisation du contexte" height={thick} />
      }
      return (
        <Box height={1} width="100%" backgroundColor="subtle">
          {segs.map(g => (
            <Box
              flexGrow={Math.max(1, Math.round(g.frac * 1000))}
              backgroundColor={g.color === 'subtle' ? 'subtle' : g.color}
            />
          ))}
        </Box>
      )
    }

    const svgColor = (c: Cat): string => {
      const k = colorOf(c)
      return k === 'subtle' ? 'rgba(128,128,128,0.22)' : k
    }
    const segs = shown
      .filter(c => c.kind !== 'free')
      .map(c => ({ frac: c.tokens / Math.max(1, s.max), color: Svg ? svgColor(c) : colorOf(c) }))

    const header = (
      <Box width="100%" gap={2} alignItems="center">
        <Box flexShrink={0}><Text color={gaugeColor} bold wrap="truncate">{`${fmtPct(s.percent)} utilisé`}</Text></Box>
        <Box flexGrow={1} minWidth={0} overflow="hidden">{bar(segs, 4)}</Box>
        <Box flexShrink={0}><Text color={ink} dimColor wrap="truncate">{`${fmtTokens(s.tokens)} / ${fmtTokens(s.max)}`}</Text></Box>
        <Button key="compact" label="Compacter" hotkey="c" onPress={compact} />
        <Button
          key="toggle"
          label={expanded ? 'Réduire' : 'Étendre'}
          hotkey="e"
          variant="secondary"
          onPress={async () => {
            const cur = await $.state.get(isExpanded)
            await $.state.set(isExpanded, !(cur.value ?? false))
          }}
        />
      </Box>
    )

    const wrap = (children: any) => (
      <Box flexDirection="column" width="100%" backgroundColor={alert}>
        {children}
      </Box>
    )

    if (!expanded) return wrap(header)

    const biggest = Math.max(1, ...shown.map(c => c.tokens))
    const meter = (value: number, of: number, color: string) => (
      <Box flexGrow={1} minWidth={0} overflow="hidden">{bar([{ frac: Math.min(1, value / of), color }], 4)}</Box>
    )

    const row = (label: string, value: number, of: number, color: string, right: string) => (
      <Box gap={1} width="100%">
        <Box width={1} height={1} backgroundColor={color} />
        <Box width={26}><Text color={ink} wrap="truncate-end">{label}</Text></Box>
        {meter(value, of, color)}
        <Box width={16} justifyContent="flex-end"><Text color={ink} dimColor>{right}</Text></Box>
      </Box>
    )

    const blocks: any[] = []

    blocks.push(header)
    blocks.push(
      <Box flexDirection="column" marginTop={1}>
        {[...shown].sort((a, b) => b.tokens - a.tokens).map(c =>
          row(c.name, c.tokens, biggest, colorOf(c), `${fmtTokens(c.tokens)}  ${fmtPct((c.tokens / s.max) * 100)}`),
        )}
      </Box>,
    )

    if (deferred.length > 0) {
      blocks.push(
        <Text color={ink} dimColor>
          {`Différés (hors fenêtre) : ${deferred.map(d => `${d.name} ${fmtTokens(d.tokens)}`).join(' · ')}`}
        </Text>,
      )
    }
    if (s.threshold !== undefined) {
      blocks.push(
        <Text color={ink} dimColor>
          {`Auto-compactage à ${fmtTokens(s.threshold)} (${fmtPct((s.threshold / s.max) * 100)} de la fenêtre)`}
        </Text>,
      )
    }

    const sections: [string, Item[], string][] = [
      ['Serveurs MCP', top(s.servers, 5), '#d99a0b'],
      ['Fichiers mémoire', top(s.memory, 4), '#1aa37a'],
      ['Skills', top(s.skills, 4), '#b4b4ad'],
    ]
    for (const [title, items, color] of sections) {
      if (items.length === 0) continue
      blocks.push(
        <Box flexDirection="column" marginTop={1}>
          <Text color={ink} bold dimColor>{title}</Text>
          {items.map(i =>
            row(i.name, i.tokens, items[0]!.tokens, color, `${fmtTokens(i.tokens)}  ${fmtPct((i.tokens / s.max) * 100)}`),
          )}
        </Box>,
      )
    }

    if (s.rates.length > 0) {
      blocks.push(
        <Box flexDirection="column" marginTop={1}>
          <Text color={ink} bold dimColor>Limites d’utilisation</Text>
          {s.rates.map(r =>
            row(
              r.kind === 'five_hour' ? 'Session 5 h' : r.kind === 'seven_day' ? 'Semaine' : r.kind,
              r.percentUsed,
              100,
              r.percentUsed >= 85 ? 'error' : r.percentUsed >= 65 ? 'warning' : 'success',
              fmtPct(r.percentUsed),
            ),
          )}
        </Box>,
      )
    }

    if (s.cost !== undefined) {
      blocks.push(<Text color={ink} dimColor>{`Coût de la session : $${s.cost.toFixed(2)}`}</Text>)
    }

    return wrap(blocks)
  })
}
