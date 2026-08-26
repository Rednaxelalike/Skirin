import type { SkirinApi } from './index'

declare global {
  interface Window {
    skirin: SkirinApi
  }
}

export {}
