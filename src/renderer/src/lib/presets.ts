import type { GradientDef, MeshDef, Ratio } from '@shared/types'

export interface GradientPreset {
  id: string
  name: string
  group: 'Signature' | 'Warm' | 'Cool' | 'Neutral' | 'Vivid'
  def: GradientDef
}

const linear = (angle: number, ...colors: string[]): GradientDef => ({
  type: 'linear',
  angle,
  stops: colors.map((color, i) => ({
    color,
    pos: colors.length === 1 ? 0 : i / (colors.length - 1)
  }))
})

export const GRADIENTS: GradientPreset[] = [
  { id: 'aurora', name: 'Aurora', group: 'Signature', def: linear(135, '#6366f1', '#a855f7', '#ec4899') },
  { id: 'nebula', name: 'Nebula', group: 'Signature', def: linear(160, '#0f172a', '#4338ca', '#7c3aed') },
  { id: 'lagoon', name: 'Lagoon', group: 'Signature', def: linear(120, '#0ea5e9', '#22d3ee', '#a7f3d0') },
  { id: 'ember', name: 'Ember', group: 'Signature', def: linear(145, '#f97316', '#ef4444', '#be123c') },
  { id: 'orchid', name: 'Orchid', group: 'Signature', def: linear(150, '#a78bfa', '#f0abfc', '#fbcfe8') },
  { id: 'moss', name: 'Moss', group: 'Signature', def: linear(135, '#064e3b', '#10b981', '#a3e635') },

  { id: 'sunset', name: 'Sunset', group: 'Warm', def: linear(160, '#ff9a9e', '#fecfef', '#fecfef') },
  { id: 'peach', name: 'Peach', group: 'Warm', def: linear(140, '#ffecd2', '#fcb69f') },
  { id: 'mango', name: 'Mango', group: 'Warm', def: linear(120, '#fbbf24', '#f97316', '#db2777') },
  { id: 'clay', name: 'Clay', group: 'Warm', def: linear(150, '#d9a07c', '#b06b4a', '#6b3f2d') },
  { id: 'gold', name: 'Gold', group: 'Warm', def: linear(135, '#fde68a', '#f59e0b', '#b45309') },
  { id: 'rosewood', name: 'Rosewood', group: 'Warm', def: linear(155, '#fda4af', '#e11d48', '#4c0519') },

  { id: 'arctic', name: 'Arctic', group: 'Cool', def: linear(140, '#e0f2fe', '#93c5fd', '#3b82f6') },
  { id: 'deepsea', name: 'Deep sea', group: 'Cool', def: linear(165, '#020617', '#0c4a6e', '#0891b2') },
  { id: 'mint', name: 'Mint', group: 'Cool', def: linear(130, '#d1fae5', '#6ee7b7', '#14b8a6') },
  { id: 'twilight', name: 'Twilight', group: 'Cool', def: linear(170, '#1e1b4b', '#312e81', '#6d28d9') },
  { id: 'glacier', name: 'Glacier', group: 'Cool', def: linear(120, '#f8fafc', '#cbd5e1', '#64748b') },
  { id: 'indigo', name: 'Indigo', group: 'Cool', def: linear(145, '#312e81', '#4f46e5', '#818cf8') },

  { id: 'graphite', name: 'Graphite', group: 'Neutral', def: linear(150, '#1f2937', '#111827') },
  { id: 'paper', name: 'Paper', group: 'Neutral', def: linear(135, '#fafaf9', '#e7e5e4') },
  { id: 'slate', name: 'Slate', group: 'Neutral', def: linear(145, '#475569', '#1e293b') },
  { id: 'linen', name: 'Linen', group: 'Neutral', def: linear(130, '#fdfcfb', '#e2d1c3') },
  { id: 'obsidian', name: 'Obsidian', group: 'Neutral', def: linear(160, '#0b0b0f', '#26262e') },
  { id: 'sand', name: 'Sand', group: 'Neutral', def: linear(140, '#f5f0e8', '#d6c7ae') },

  { id: 'candy', name: 'Candy', group: 'Vivid', def: linear(135, '#22d3ee', '#a78bfa', '#f472b6') },
  { id: 'neon', name: 'Neon', group: 'Vivid', def: linear(120, '#84cc16', '#06b6d4', '#8b5cf6') },
  { id: 'punch', name: 'Punch', group: 'Vivid', def: linear(150, '#f43f5e', '#f97316', '#facc15') },
  { id: 'ultra', name: 'Ultraviolet', group: 'Vivid', def: linear(155, '#4c1d95', '#c026d3', '#f0abfc') },
  { id: 'radial-glow', name: 'Halo', group: 'Vivid', def: { type: 'radial', angle: 0, stops: [ { color: '#f9a8d4', pos: 0 }, { color: '#8b5cf6', pos: 0.55 }, { color: '#0f172a', pos: 1 } ] } },
  { id: 'conic-spin', name: 'Prism', group: 'Vivid', def: { type: 'conic', angle: 0, stops: [ { color: '#f43f5e', pos: 0 }, { color: '#f59e0b', pos: 0.25 }, { color: '#22d3ee', pos: 0.5 }, { color: '#8b5cf6', pos: 0.75 }, { color: '#f43f5e', pos: 1 } ] } }
]

export interface MeshPreset {
  id: string
  name: string
  def: MeshDef
}

export const MESHES: MeshPreset[] = [
  {
    id: 'mesh-dusk',
    name: 'Dusk',
    def: {
      base: '#1e1b4b',
      points: [
        { x: 0.18, y: 0.2, color: '#6366f1', radius: 0.75 },
        { x: 0.82, y: 0.24, color: '#ec4899', radius: 0.65 },
        { x: 0.5, y: 0.88, color: '#22d3ee', radius: 0.7 }
      ]
    }
  },
  {
    id: 'mesh-bloom',
    name: 'Bloom',
    def: {
      base: '#fdf2f8',
      points: [
        { x: 0.15, y: 0.8, color: '#fbcfe8', radius: 0.8 },
        { x: 0.85, y: 0.15, color: '#c7d2fe', radius: 0.75 },
        { x: 0.6, y: 0.6, color: '#fef9c3', radius: 0.6 }
      ]
    }
  },
  {
    id: 'mesh-reef',
    name: 'Reef',
    def: {
      base: '#042f2e',
      points: [
        { x: 0.2, y: 0.3, color: '#14b8a6', radius: 0.7 },
        { x: 0.78, y: 0.7, color: '#0ea5e9', radius: 0.7 },
        { x: 0.55, y: 0.12, color: '#a3e635', radius: 0.5 }
      ]
    }
  },
  {
    id: 'mesh-solar',
    name: 'Solar',
    def: {
      base: '#7c2d12',
      points: [
        { x: 0.25, y: 0.25, color: '#facc15', radius: 0.7 },
        { x: 0.8, y: 0.45, color: '#f97316', radius: 0.75 },
        { x: 0.45, y: 0.85, color: '#dc2626', radius: 0.6 }
      ]
    }
  },
  {
    id: 'mesh-ink',
    name: 'Ink',
    def: {
      base: '#09090b',
      points: [
        { x: 0.3, y: 0.25, color: '#27272a', radius: 0.85 },
        { x: 0.75, y: 0.75, color: '#3f3f46', radius: 0.7 },
        { x: 0.85, y: 0.2, color: '#52525b', radius: 0.45 }
      ]
    }
  },
  {
    id: 'mesh-cotton',
    name: 'Cotton',
    def: {
      base: '#eef2ff',
      points: [
        { x: 0.2, y: 0.2, color: '#e0e7ff', radius: 0.8 },
        { x: 0.8, y: 0.3, color: '#fae8ff', radius: 0.7 },
        { x: 0.5, y: 0.9, color: '#cffafe', radius: 0.75 }
      ]
    }
  }
]

export const SOLIDS = [
  '#ffffff',
  '#f4f4f5',
  '#d4d4d8',
  '#71717a',
  '#3f3f46',
  '#18181b',
  '#000000',
  '#1e293b',
  '#0f172a',
  '#4f46e5',
  '#7c3aed',
  '#db2777',
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#0284c7'
]

export const ANNOTATION_COLORS = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#007aff',
  '#5856d6',
  '#af52de',
  '#ff2d55',
  '#ffffff',
  '#8e8e93',
  '#000000'
]

export interface RatioOption {
  id: Ratio
  label: string
  hint: string
  value: number | null
}

export const RATIOS: RatioOption[] = [
  { id: 'auto', label: 'Auto', hint: 'Match the capture', value: null },
  { id: '1:1', label: '1:1', hint: 'Square post', value: 1 },
  { id: '4:3', label: '4:3', hint: 'Classic', value: 4 / 3 },
  { id: '3:2', label: '3:2', hint: 'Photo', value: 3 / 2 },
  { id: '16:9', label: '16:9', hint: 'Slide / video', value: 16 / 9 },
  { id: '2:1', label: '2:1', hint: 'Open Graph', value: 2 },
  { id: '3:4', label: '3:4', hint: 'Portrait', value: 3 / 4 },
  { id: '4:5', label: '4:5', hint: 'Feed post', value: 4 / 5 },
  { id: '9:16', label: '9:16', hint: 'Story / Reel', value: 9 / 16 }
]

export function ratioValue(id: Ratio): number | null {
  return RATIOS.find((r) => r.id === id)?.value ?? null
}

/* -------------------------- full look presets --------------------------- */

export interface LookPreset {
  id: string
  name: string
  description: string
  apply: {
    gradientId?: string
    meshId?: string
    solid?: string
    kind: 'gradient' | 'mesh' | 'solid' | 'transparent'
    padding: number
    radius: number
    shadow: { blur: number; y: number; opacity: number }
    tiltX?: number
    tiltY?: number
    rotate?: number
    border?: boolean
    noise?: number
    reflection?: number
  }
}

export const LOOKS: LookPreset[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'The signature Skirin look',
    apply: {
      kind: 'gradient',
      gradientId: 'aurora',
      padding: 0.09,
      radius: 14,
      shadow: { blur: 60, y: 24, opacity: 0.38 }
    }
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'Soft neutral, deep shadow',
    apply: {
      kind: 'gradient',
      gradientId: 'graphite',
      padding: 0.12,
      radius: 18,
      shadow: { blur: 90, y: 40, opacity: 0.55 },
      noise: 0.05
    }
  },
  {
    id: 'tilt',
    name: 'Tilt',
    description: 'Perspective hero shot',
    apply: {
      kind: 'mesh',
      meshId: 'mesh-dusk',
      padding: 0.14,
      radius: 16,
      shadow: { blur: 100, y: 50, opacity: 0.5 },
      tiltX: 8,
      tiltY: -14,
      rotate: -2
    }
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Light, editorial, hairline border',
    apply: {
      kind: 'gradient',
      gradientId: 'paper',
      padding: 0.1,
      radius: 10,
      shadow: { blur: 40, y: 16, opacity: 0.18 },
      border: true
    }
  },
  {
    id: 'flat',
    name: 'Flat',
    description: 'No frills, just the capture',
    apply: {
      kind: 'transparent',
      padding: 0,
      radius: 0,
      shadow: { blur: 0, y: 0, opacity: 0 }
    }
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Reflection under a cool gradient',
    apply: {
      kind: 'gradient',
      gradientId: 'deepsea',
      padding: 0.13,
      radius: 16,
      shadow: { blur: 70, y: 28, opacity: 0.45 },
      reflection: 0.35
    }
  },
  {
    id: 'punch',
    name: 'Punch',
    description: 'High-energy social card',
    apply: {
      kind: 'gradient',
      gradientId: 'punch',
      padding: 0.11,
      radius: 20,
      shadow: { blur: 80, y: 30, opacity: 0.42 },
      rotate: 1.5
    }
  },
  {
    id: 'ink',
    name: 'Ink',
    description: 'Near-black, grain, subtle border',
    apply: {
      kind: 'mesh',
      meshId: 'mesh-ink',
      padding: 0.12,
      radius: 14,
      shadow: { blur: 70, y: 26, opacity: 0.6 },
      border: true,
      noise: 0.09
    }
  }
]
