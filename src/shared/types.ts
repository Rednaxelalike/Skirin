/* ------------------------------------------------------------------ *
 * Skirin — shared types (Rust backend <-> bridge <-> editor)
 * ------------------------------------------------------------------ */

export type CaptureKind = 'display' | 'window' | 'area' | 'lastRegion' | 'file' | 'clipboard'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface DisplayInfo {
  id: number
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  isPrimary: boolean
  label: string
}

export interface WindowSource {
  id: string
  name: string
  appIcon: string | null
  thumbnail: string
}

/** A raw capture handed from the backend to the editor. */
export interface Capture {
  id: string
  /**
   * A `skirin://frame/<id>` URL, not a data URL. The pixels stay in Rust and
   * the webview streams them over the custom protocol, which is why a capture
   * no longer costs a base64 round-trip in both directions.
   */
  src: string
  width: number
  height: number
  scaleFactor: number
  kind: CaptureKind
  sourceName: string
  createdAt: number
  /**
   * Where on the virtual desktop this came from, in physical pixels. Set for
   * area and display captures; absent for a window, a pasted image or a file,
   * none of which have a fixed place on screen.
   */
  region?: Rect
}

/* -------------------------------- scene -------------------------------- */

export type Ratio =
  | 'auto'
  | '1:1'
  | '4:3'
  | '3:2'
  | '16:9'
  | '2:1'
  | '3:4'
  | '4:5'
  | '9:16'

export type BackgroundKind =
  | 'gradient'
  | 'mesh'
  | 'solid'
  | 'image'
  | 'auto'
  | 'transparent'

export interface GradientStop {
  color: string
  pos: number
}

export interface GradientDef {
  type: 'linear' | 'radial' | 'conic'
  angle: number
  stops: GradientStop[]
}

export interface MeshPoint {
  x: number
  y: number
  color: string
  radius: number
}

export interface MeshDef {
  base: string
  points: MeshPoint[]
}

export interface Background {
  kind: BackgroundKind
  solid: string
  gradient: GradientDef
  mesh: MeshDef
  image: {
    src: string | null
    fit: 'cover' | 'contain' | 'tile'
    blur: number
    scale: number
    opacity: number
  }
  /** Grain overlay strength, 0..1 */
  noise: number
  /** Corner darkening, 0..1 */
  vignette: number
}

export interface ShadowStyle {
  enabled: boolean
  x: number
  y: number
  blur: number
  spread: number
  color: string
  opacity: number
}

export interface BorderStyle {
  enabled: boolean
  width: number
  color: string
  /** Draw the border inside the image bounds instead of outside. */
  inset: boolean
}

export type BrowserFrameStyle = 'none' | 'macos' | 'macos-url' | 'windows' | 'minimal'

export interface BrowserFrame {
  style: BrowserFrameStyle
  url: string
  title: string
  dark: boolean
}

export interface FrameStyle {
  /** Corner radius in px, relative to the source image resolution. */
  radius: number
  shadow: ShadowStyle
  border: BorderStyle
  /** Z rotation, degrees. */
  rotate: number
  /** 3D tilt in degrees around the X and Y axes. */
  tiltX: number
  tiltY: number
  /** Perspective strength (lower = more extreme). */
  perspective: number
  /** Uniform scale of the framed image inside the canvas, 0.2..1.6 */
  scale: number
  offsetX: number
  offsetY: number
  /** Mirrored fade underneath the image, 0..1 */
  reflection: number
  browser: BrowserFrame
}

export interface CanvasSettings {
  ratio: Ratio
  /** Padding as a fraction of the longest edge of the image, 0..0.5 */
  padding: number
  /** Trim uniform borders from the source before composing. */
  autoBalance: boolean
}

/* ----------------------------- annotations ----------------------------- */

export type AnnotationType =
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'text'
  | 'step'
  | 'highlight'
  | 'blur'
  | 'pixelate'
  | 'spotlight'
  | 'redact'

export interface AnnotationBase {
  id: string
  type: AnnotationType
  /** Normalized to the cropped image: 0..1 on both axes. */
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeWidth: number
  opacity: number
  rotation: number
  locked: boolean
  hidden: boolean
}

export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow' | 'line'
  curve: number
  headSize: number
  dashed: boolean
  /** Arrowheads: end only, both ends, or none. */
  heads: 'end' | 'both' | 'none'
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'rect' | 'ellipse'
  fill: string | null
  radius: number
  dashed: boolean
}

export interface PenAnnotation extends AnnotationBase {
  type: 'pen'
  points: Point[]
  smooth: boolean
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  align: 'left' | 'center' | 'right'
  background: string | null
  padding: number
  radius: number
  shadow: boolean
}

export interface StepAnnotation extends AnnotationBase {
  type: 'step'
  index: number
  fontSize: number
  textColor: string
}

export interface EffectAnnotation extends AnnotationBase {
  type: 'blur' | 'pixelate' | 'highlight' | 'spotlight' | 'redact'
  amount: number
  radius: number
  /** Redaction label, e.g. the OCR class that matched. */
  label?: string
  shape: 'rect' | 'ellipse'
}

export type Annotation =
  | ArrowAnnotation
  | ShapeAnnotation
  | PenAnnotation
  | TextAnnotation
  | StepAnnotation
  | EffectAnnotation

export interface Watermark {
  enabled: boolean
  text: string
  imageSrc: string | null
  position:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'bottom-center'
  color: string
  opacity: number
  size: number
  margin: number
}

export interface Crop {
  /** Normalized crop window over the raw capture. */
  x: number
  y: number
  w: number
  h: number
  flipH: boolean
  flipV: boolean
  /** 90-degree steps. */
  quarterTurns: number
}

export interface Scene {
  canvas: CanvasSettings
  background: Background
  frame: FrameStyle
  crop: Crop
  annotations: Annotation[]
  watermark: Watermark
}

/* ------------------------------- export -------------------------------- */

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface ExportSettings {
  format: ExportFormat
  scale: number
  quality: number
  /** Iteratively lower quality until the file fits, in KB. */
  maxSizeKb: number | null
  transparent: boolean
}

/* ------------------------------ app config ----------------------------- */

export type AfterCapture = 'editor' | 'copy' | 'save' | 'copy-save' | 'editor-copy'

export interface Shortcuts {
  fullscreen: string
  window: string
  area: string
  lastRegion: string
  openEditor: string
}

/**
 * The screenshot keys Windows keeps for itself. Neither can be registered as
 * an ordinary accelerator — the shell owns them — so answering one means
 * intercepting it, and that is off until the user asks for it.
 */
export interface SystemKeys {
  /** Print Screen on its own. `Alt` and `Win` variants are left to Windows. */
  printScreen: boolean
  /** `Win + Shift + S`, the shell's snip. */
  snip: boolean
}

export interface AppSettings {
  shortcuts: Shortcuts
  systemKeys: SystemKeys
  afterCapture: AfterCapture
  saveDir: string
  filenameTemplate: string
  autoLaunch: boolean
  showTray: boolean
  captureSound: boolean
  captureDelay: number
  theme: 'system' | 'dark' | 'light'
  defaultPresetId: string
  exportDefaults: ExportSettings
  smartRedactOnCapture: boolean
  copyOnExport: boolean
  magnifier: boolean
  rememberLastRegion: boolean
  lastRegion: Rect | null
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  scene: Pick<Scene, 'canvas' | 'background' | 'frame' | 'watermark'>
}

export interface HistoryEntry {
  id: string
  file: string
  thumb: string
  createdAt: number
  width: number
  height: number
  sourceName: string
}

/* ------------------------------ ipc surface ---------------------------- */

export interface SaveResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** Payload handed to each per-display selection overlay. */
export interface OverlayInit {
  displayId: number
  /** Physical pixels, in virtual-desktop space. */
  bounds: Rect
  scaleFactor: number
  src: string
  magnifier: boolean
  lastRegion: Rect | null
  windows: Rect[]
}

/** Lifecycle of a background update check, mirrored into the renderer. */
export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  version: string | null
  notes: string | null
  percent: number
  error: string | null
}

/**
 * How this copy of Skirin was installed. Only `installed` can apply an update
 * in place — the other two send the user to the release page instead.
 */
export type BuildChannel = 'installed' | 'portable' | 'development'

/** Static facts about the running build, shown in Settings → About. */
export interface AppInfo {
  version: string
  platform: string
  arch: string
  saveDir: string
  channel: BuildChannel
  webview: string
  tauri: string
  rustc: string
}
