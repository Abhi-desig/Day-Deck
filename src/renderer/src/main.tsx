import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { applyCachedTheme } from './store/usePrefs'
import { App } from './App'

// The real theme lives in SQLite, an IPC round trip away, and the document
// would paint long before that resolves. The browser cannot paint part-way
// through this module, so setting the attribute anywhere above `render` is
// early enough — there is no frame in which the wrong theme is on screen. The
// window's own background colour is handled separately, in main.
applyCachedTheme()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
