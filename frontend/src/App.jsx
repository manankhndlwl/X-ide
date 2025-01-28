import { useState } from 'react'
import './App.css'
import Terminal from './components/terminal'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className='playground-container' >
      <div className='editor-container'></div>
      <div className='terminal-container' >
        <Terminal />
      </div>
    </div>
  )
}

export default App
