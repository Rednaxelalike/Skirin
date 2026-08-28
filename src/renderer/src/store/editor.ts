import { create } from 'zustand'
import type {
  Annotation,
  AnnotationType,
  AppSettings,
  Background,
  Capture,
  Crop,
  ExportSettings,
  FrameStyle,
  Preset,
  Scene,
  Watermark
} from '@shared/types'
import { defaultCrop, defaultScene } from '@shared/defaults'
import { GRADIENTS, LOOKS, MESHES } from '@/lib/presets'
import type { LookPreset } from '@/lib/presets'
import { createAnnotation, nextStepIndex } from '@/lib/annotations'
import { detectTrim, loadImage, uid } from '@/lib/utils'

export type Tool = 'select' | 'crop' | 'pan' | AnnotationType

const HISTORY_LIMIT = 80

interface ImageBundle {
  base: HTMLImageElement | null
  background: HTMLImageElement | null
  watermark: HTMLImageElement | null
}

export interface EditorState {
  capture: Capture | null
  images: ImageBundle
  /** Auto-detected content box of the current capture, for auto-balance. */
  trimHint: Crop | null

  scene: Scene
  past: Scene[]
  future: Scene[]

  tool: Tool
  selectedId: string | null
  editingTextId: string | null
  toolColor: string
  toolStroke: number

  exportSettings: ExportSettings
  settings: AppSettings | null
  presets: Preset[]

  zoom: number | 'fit'
  showGrid: boolean
  busy: string | null

  /* ------------------------------- actions ------------------------------ */
  loadCapture: (capture: Capture) => Promise<void>
  loadImageSource: (src: string, name: string) => Promise<void>
  reset: () => void

  snapshot: () => void
  undo: () => void
  redo: () => void

  patchScene: (patch: Partial<Scene>) => void
  patchFrame: (patch: Partial<FrameStyle>) => void
  patchShadow: (patch: Partial<FrameStyle['shadow']>) => void
  patchBorder: (patch: Partial<FrameStyle['border']>) => void
  patchBrowser: (patch: Partial<FrameStyle['browser']>) => void
  patchBackground: (patch: Partial<Background>) => void
  patchCanvas: (patch: Partial<Scene['canvas']>) => void
  patchCrop: (patch: Partial<Crop>) => void
  patchWatermark: (patch: Partial<Watermark>) => void

  addAnnotation: (type: AnnotationType, at: { x: number; y: number }) => Annotation
  pushAnnotations: (list: Annotation[]) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  reorderAnnotation: (id: string, direction: 'front' | 'back' | 'up' | 'down') => void
  clearAnnotations: () => void

  setTool: (tool: Tool) => void
  select: (id: string | null) => void
  setEditingText: (id: string | null) => void
  setToolColor: (color: string) => void
  setToolStroke: (width: number) => void

  applyLook: (look: LookPreset) => void
  applyGradient: (id: string) => void
  applyMesh: (id: string) => void
  savePreset: (name: string) => void
  applyPreset: (preset: Preset) => void
  deletePreset: (id: string) => void

  setExportSettings: (patch: Partial<ExportSettings>) => void
  setSettings: (settings: AppSettings) => void
  setPresets: (presets: Preset[]) => void
  setZoom: (zoom: number | 'fit') => void
  setBusy: (label: string | null) => void
  toggleGrid: () => void
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

export const useEditor = create<EditorState>((set, get) => {
  /** Records the current scene so the next mutation can be undone. */
  const record = (): void => {
    const { scene, past } = get()
    set({ past: [...past, clone(scene)].slice(-HISTORY_LIMIT), future: [] })
  }

  const mutate = (fn: (scene: Scene) => void, history = true): void => {
    if (history) record()
    const scene = clone(get().scene)
    fn(scene)
    set({ scene })
  }

  return {
    capture: null,
    images: { base: null, background: null, watermark: null },
    trimHint: null,

    scene: defaultScene(),
    past: [],
    future: [],

    tool: 'select',
    selectedId: null,
    editingTextId: null,
    toolColor: '#ff3b30',
    toolStroke: 6,

    exportSettings: {
      format: 'png',
      scale: 2,
      quality: 0.92,
      maxSizeKb: null,
      transparent: false
    },
    settings: null,
    presets: [],

    zoom: 'fit',
    showGrid: false,
    busy: null,

    async loadCapture(capture) {
      const image = await loadImage(capture.src)
      const trim = detectTrim(image, capture.width, capture.height)
      const scene = defaultScene()

      // Carry the current look across captures so the studio feels continuous.
      const previous = get().scene
      if (get().capture) {
        scene.background = clone(previous.background)
        scene.frame = clone(previous.frame)
        scene.canvas = clone(previous.canvas)
        scene.watermark = clone(previous.watermark)
      } else {
        // Built-in looks and saved presets share one id space, because only
        // one of the two can be the chosen default.
        const { settings, presets } = get()
        const id = settings?.defaultPresetId
        const saved = presets.find((p) => p.id === id)
        const look = LOOKS.find((l) => l.id === id)
        if (saved) applyPresetTo(scene, saved)
        else if (look) applyLookTo(scene, look)
      }

      const hint: Crop = { ...defaultCrop(), ...trim }
      if (scene.canvas.autoBalance) {
        scene.crop = { ...scene.crop, x: hint.x, y: hint.y, w: hint.w, h: hint.h }
      }

      set({
        capture,
        images: { ...get().images, base: image },
        trimHint: hint,
        scene,
        past: [],
        future: [],
        selectedId: null,
        editingTextId: null,
        tool: 'select',
        zoom: 'fit'
      })
    },

    async loadImageSource(src, name) {
      const image = await loadImage(src)
      await get().loadCapture({
        id: uid('cap-'),
        src,
        width: image.naturalWidth,
        height: image.naturalHeight,
        scaleFactor: 1,
        kind: 'file',
        sourceName: name,
        createdAt: Date.now()
      })
    },

    reset() {
      set({
        capture: null,
        images: { base: null, background: null, watermark: null },
        scene: defaultScene(),
        past: [],
        future: [],
        selectedId: null,
        trimHint: null
      })
    },

    snapshot: record,

    undo() {
      const { past, future, scene } = get()
      if (!past.length) return
      const previous = past[past.length - 1]
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [clone(scene), ...future].slice(0, HISTORY_LIMIT),
        selectedId: null,
        editingTextId: null
      })
    },

    redo() {
      const { past, future, scene } = get()
      if (!future.length) return
      set({
        scene: future[0],
        past: [...past, clone(scene)].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedId: null,
        editingTextId: null
      })
    },

    patchScene(patch) {
      mutate((scene) => Object.assign(scene, patch))
    },
    patchFrame(patch) {
      mutate((scene) => Object.assign(scene.frame, patch), false)
    },
    patchShadow(patch) {
      mutate((scene) => Object.assign(scene.frame.shadow, patch), false)
    },
    patchBorder(patch) {
      mutate((scene) => Object.assign(scene.frame.border, patch), false)
    },
    patchBrowser(patch) {
      mutate((scene) => Object.assign(scene.frame.browser, patch), false)
    },
    patchBackground(patch) {
      mutate((scene) => Object.assign(scene.background, patch), false)
    },
    patchCanvas(patch) {
      mutate((scene) => {
        Object.assign(scene.canvas, patch)
        if (patch.autoBalance !== undefined) {
          const hint = get().trimHint
          if (patch.autoBalance && hint) {
            scene.crop = { ...scene.crop, x: hint.x, y: hint.y, w: hint.w, h: hint.h }
          } else if (!patch.autoBalance) {
            scene.crop = { ...scene.crop, x: 0, y: 0, w: 1, h: 1 }
          }
        }
      }, patch.autoBalance !== undefined)
    },
    patchCrop(patch) {
      mutate((scene) => Object.assign(scene.crop, patch), false)
    },
    patchWatermark(patch) {
      mutate((scene) => Object.assign(scene.watermark, patch), false)
    },

    addAnnotation(type, at) {
      const { toolColor, toolStroke, scene } = get()
      const annotation = createAnnotation(type, at, toolColor, nextStepIndex(scene.annotations))
      if ('strokeWidth' in annotation && annotation.strokeWidth > 0) {
        annotation.strokeWidth = toolStroke
      }
      record()
      set({
        scene: { ...scene, annotations: [...scene.annotations, annotation] },
        selectedId: annotation.id
      })
      return annotation
    },

    pushAnnotations(list) {
      if (!list.length) return
      record()
      const scene = get().scene
      set({ scene: { ...scene, annotations: [...scene.annotations, ...list] } })
    },

    updateAnnotation(id, patch) {
      const scene = get().scene
      set({
        scene: {
          ...scene,
          annotations: scene.annotations.map((a) =>
            a.id === id ? ({ ...a, ...patch } as Annotation) : a
          )
        }
      })
    },

    removeAnnotation(id) {
      record()
      const scene = get().scene
      set({
        scene: { ...scene, annotations: scene.annotations.filter((a) => a.id !== id) },
        selectedId: null,
        editingTextId: null
      })
    },

    reorderAnnotation(id, direction) {
      record()
      const scene = get().scene
      const list = [...scene.annotations]
      const index = list.findIndex((a) => a.id === id)
      if (index < 0) return
      const [item] = list.splice(index, 1)
      const target =
        direction === 'front'
          ? list.length
          : direction === 'back'
            ? 0
            : Math.max(0, Math.min(list.length, index + (direction === 'up' ? 1 : -1)))
      list.splice(target, 0, item)
      set({ scene: { ...scene, annotations: list } })
    },

    clearAnnotations() {
      record()
      set({ scene: { ...get().scene, annotations: [] }, selectedId: null })
    },

    setTool(tool) {
      set({ tool, selectedId: tool === 'select' ? get().selectedId : null, editingTextId: null })
    },
    select(id) {
      set({ selectedId: id })
    },
    setEditingText(id) {
      set({ editingTextId: id })
    },
    setToolColor(color) {
      const { selectedId, scene } = get()
      set({ toolColor: color })
      if (selectedId) {
        const target = scene.annotations.find((a) => a.id === selectedId)
        if (target) get().updateAnnotation(selectedId, { color } as Partial<Annotation>)
      }
    },
    setToolStroke(width) {
      const { selectedId } = get()
      set({ toolStroke: width })
      if (selectedId) get().updateAnnotation(selectedId, { strokeWidth: width } as Partial<Annotation>)
    },

    applyLook(look) {
      mutate((scene) => applyLookTo(scene, look))
    },

    applyGradient(id) {
      const preset = GRADIENTS.find((g) => g.id === id)
      if (!preset) return
      mutate((scene) => {
        scene.background.kind = 'gradient'
        scene.background.gradient = clone(preset.def)
      })
    },

    applyMesh(id) {
      const preset = MESHES.find((m) => m.id === id)
      if (!preset) return
      mutate((scene) => {
        scene.background.kind = 'mesh'
        scene.background.mesh = clone(preset.def)
      })
    },

    savePreset(name) {
      const { scene, presets } = get()
      const saved: Preset['scene'] = {
        canvas: clone(scene.canvas),
        background: clone(scene.background),
        frame: clone(scene.frame),
        watermark: clone(scene.watermark)
      }

      // Saving over a name that is already taken updates that preset. Two
      // entries reading the same in the list is not a thing anyone wants, and
      // it is how you iterate on a look you are still tuning.
      const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
      const next = existing
        ? presets.map((p) => (p.id === existing.id ? { ...p, scene: saved } : p))
        : [...presets, { id: uid('preset-'), name, builtin: false, scene: saved }]

      set({ presets: next })
      void window.skirin.presets.set(next)
    },

    applyPreset(preset) {
      mutate((scene) => applyPresetTo(scene, preset))
    },

    deletePreset(id) {
      const { presets, settings } = get()
      const next = presets.filter((p) => p.id !== id)
      set({ presets: next })
      void window.skirin.presets.set(next)

      // Deleting the preset a new session starts with would leave the setting
      // pointing at nothing, and every capture arriving bare.
      if (settings?.defaultPresetId === id) {
        void window.skirin.settings
          .set({ defaultPresetId: LOOKS[0].id })
          .then((updated) => get().setSettings(updated))
      }
    },

    setExportSettings(patch) {
      set({ exportSettings: { ...get().exportSettings, ...patch } })
    },
    setSettings(settings) {
      set({ settings, exportSettings: { ...get().exportSettings, ...settings.exportDefaults } })
    },
    setPresets(presets) {
      set({ presets })
    },
    setZoom(zoom) {
      set({ zoom })
    },
    setBusy(busy) {
      set({ busy })
    },
    toggleGrid() {
      set({ showGrid: !get().showGrid })
    }
  }
})

/** Everything a saved preset carries, over whatever the scene has now. */
function applyPresetTo(scene: Scene, preset: Preset): void {
  scene.canvas = clone(preset.scene.canvas)
  scene.background = clone(preset.scene.background)
  scene.frame = clone(preset.scene.frame)
  scene.watermark = clone(preset.scene.watermark)
}

function applyLookTo(scene: Scene, look: LookPreset): void {

  const a = look.apply
  scene.background.kind = a.kind
  if (a.gradientId) {
    const g = GRADIENTS.find((x) => x.id === a.gradientId)
    if (g) scene.background.gradient = clone(g.def)
  }
  if (a.meshId) {
    const m = MESHES.find((x) => x.id === a.meshId)
    if (m) scene.background.mesh = clone(m.def)
  }
  if (a.solid) scene.background.solid = a.solid
  scene.background.noise = a.noise ?? 0
  scene.canvas.padding = a.padding
  scene.frame.radius = a.radius
  scene.frame.shadow = {
    ...scene.frame.shadow,
    enabled: a.shadow.opacity > 0,
    blur: a.shadow.blur,
    y: a.shadow.y,
    opacity: a.shadow.opacity
  }
  scene.frame.tiltX = a.tiltX ?? 0
  scene.frame.tiltY = a.tiltY ?? 0
  scene.frame.rotate = a.rotate ?? 0
  scene.frame.reflection = a.reflection ?? 0
  scene.frame.border.enabled = a.border ?? false
}

/** Loads a background or watermark bitmap into the shared image bundle. */
export async function setSceneImage(
  slot: 'background' | 'watermark',
  src: string | null
): Promise<void> {
  const state = useEditor.getState()
  if (!src) {
    useEditor.setState({ images: { ...state.images, [slot]: null } })
    return
  }
  const image = await loadImage(src)
  useEditor.setState({ images: { ...useEditor.getState().images, [slot]: image } })
}
