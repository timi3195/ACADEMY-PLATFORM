import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { MarketplaceProvider } from './context/MarketplaceContext'
import { LibraryProvider } from './context/LibraryContext'
import { ThemeProvider } from './context/ThemeContext'
import './styles.css'
import './styles/marketplace.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <MarketplaceProvider>
          <LibraryProvider>
            <App />
          </LibraryProvider>
        </MarketplaceProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
