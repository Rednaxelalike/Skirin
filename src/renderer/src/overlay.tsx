import './lib/bridge'

import { createRoot } from 'react-dom/client'
import { Overlay } from './overlay/Overlay'
import './styles.css'

createRoot(document.getElementById('overlay-root') as HTMLElement).render(<Overlay />)
