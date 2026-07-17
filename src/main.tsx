import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { OutputWindow } from './components/OutputWindow.tsx'

const isOutputWindow = new URLSearchParams(window.location.search).get('output') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOutputWindow ? <OutputWindow /> : <App />}
  </StrictMode>,
)
