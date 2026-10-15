export type Cat = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }
export type Item = { name: string; tokens: number }
export type Rate = { kind: string; percentUsed: number }

export type Snap = {
  tokens: number
  window: number
  max: number
  percent: number
  cats: Cat[]
  threshold?: number
  servers: Item[]
  memory: Item[]
  skills: Item[]
  rates: Rate[]
  cost?: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': { snap: Snap | null; isExpanded: boolean }
  }
}
