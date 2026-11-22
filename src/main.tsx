import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/themes.css'
import './styles/app.css'
import './styles/markdown.css'

createRoot(document.getElementById('root')!).render(<App />)
