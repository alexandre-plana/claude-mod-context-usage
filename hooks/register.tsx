import type { Register } from 'claude-code'

import type { Cat, Item, Snap } from '../types'

const snap = { plugin: 'context-band', key: 'snap' } as const

const MIN = 300_000
const MAX = 1_000_000
const STEP = 100_000
let lastAuto = 0
let busy = '' // '' | 'turn' | 'compact' : état de chargement affiché dans la bande
let autoAt = 0 // seuil de compactage automatique (0 = désactivé), gardé aussi dans $.store

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
    autoAt,
    busy,
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
    const saved = Number(await $.store.get('threshold'))
    if (saved === 0 || (saved >= MIN && saved <= MAX)) autoAt = saved
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

    // Compactage automatique : une fois le tour fini, si le seuil est atteint.
    const limit = autoAt
    const used = fresh?.tokens ?? (await $.state.get(snap)).value?.tokens ?? 0
    if (limit > 0 && used >= limit && Date.now() - lastAuto > 60_000) {
      lastAuto = Date.now()
      $.clock.after(1500, async () => {
        try {
          $.ui.toast(`Contexte à ${fmtTokens(used)} : compactage automatique…`)
          busy = 'compact'
          const cur = (await $.state.get(snap)).value
          if (cur) await $.state.set(snap, { ...cur, busy })
          try {
            await $.session.compact()
          } catch {
            await $.command.run({ command: 'compact' })
          }
        } catch (err: any) {
          busy = ''
          $.ui.toast(`Compactage automatique impossible : ${String(err?.message ?? err).slice(0, 160)}`)
        }
      })
    }
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    busy = ''
    const fresh = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
    if (fresh) await $.state.set(snap, fresh)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = (await $.state.get(snap)).value ?? null
    if (e.props.hasSurvey || s === null) return next(e)

    const table: any = $.ui.resolve(e)
    const { Box, Text, Button, Select } = table
    const Svg = table.Svg

    const compact = async () => {
      if (busy) return
      try {
        $.ui.toast('Compactage du contexte…')
        busy = 'compact'
        await $.state.set(snap, { ...s, busy })
        try {
          const res: any = await $.session.compact()
          if (res?.skip) $.ui.toast(`Compactage refusé : ${res.skip}`)
        } catch {
          // Session sans accès direct (app desktop / SDK) : on lance la commande /compact.
          await $.command.run({ command: 'compact' })
        }
        busy = ''
        const fresh = due(true) ? build(await $.session.usage({ breakdown: 'summary' }).catch(() => null)) : null
        if (fresh) await $.state.set(snap, fresh)
      } catch (err: any) {
        busy = ''
        await $.state.set(snap, { ...s, busy })
        $.ui.toast(`Compactage impossible : ${String(err?.message ?? err).slice(0, 200)}`, { timeoutMs: 10000 })
      }
    }

    const limit = s.autoAt ?? 0
    const loading = !!s.busy
    const options = [{ value: '0', label: 'Désactivé' }]
    for (let n = MIN; n <= MAX; n += STEP) options.push({ value: String(n), label: n >= 1_000_000 ? '1M' : `${n / 1000}k` })
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
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${thick}" viewBox="0 0 1000 ${thick}" preserveAspectRatio="none"><rect width="1000" height="${thick}" rx="2" fill="rgba(128,128,128,0.22)"/><g opacity="${loading ? 0.45 : 1}">${rects}</g>${loading ? `<defs><linearGradient id="sh"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="-300" y="0" width="300" height="${thick}" fill="url(#sh)"><animate attributeName="x" from="-300" to="1000" dur="1.1s" repeatCount="indefinite"/></rect>` : ''}${limit > 0 ? `<rect x="${((limit / Math.max(1, s.max)) * 1000).toFixed(1)}" y="0" width="3" height="${thick}" fill="#f5f5f4"/>` : ''}</svg>`
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

    const row = (
      <Box width="100%" gap={2} alignItems="center">
        <Box flexShrink={0}><Text bold wrap="truncate">{s.busy === 'compact' ? 'Compactage…' : `${fmtPct(s.percent)} utilisé`}</Text></Box>
        <Box flexGrow={1} minWidth={0} overflow="hidden" marginX={2}>{bar}</Box>
        <Box flexShrink={0}><Text dimColor wrap="truncate">{`${fmtTokens(s.tokens)} / ${fmtTokens(s.max)}`}</Text></Box>
        <Box flexShrink={0} marginLeft={1}>
        <Select
          key="auto"
          label="Auto"
          options={options}
          value={String(limit)}
          disabled={s.busy === 'compact'}
          onSelect={async v => {
            if (busy === 'compact') return
            const n = Number(v)
            autoAt = n
            await $.store.set('threshold', n)
            await $.state.set(snap, { ...s, autoAt: n })
          }}
        />
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Button key="compact" label="Compacter" hotkey="c" disabled={s.busy === 'compact'} onPress={compact} />
        </Box>
      </Box>
    )

    return row
  })
}
