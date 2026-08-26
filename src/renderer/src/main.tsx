// The bridge installs `window.skirin`, so it has to land before any component
// module runs — this import must stay first.
import './lib/bridge'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
