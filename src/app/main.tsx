import { createRoot } from 'react-dom/client'
import { App } from './App'
import { seedIfFirstRun } from './store'
import './styles.css'

seedIfFirstRun()
createRoot(document.getElementById('root')!).render(<App />)
