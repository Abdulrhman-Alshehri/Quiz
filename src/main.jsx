import React from 'react';
import { createRoot } from 'react-dom/client';
// Carlito is metric-compatible with Calibri, the deck font. Devices that have
// Calibri (Windows, Office) use it; everyone else downloads Carlito.
import '@fontsource/carlito/latin-400.css';
import '@fontsource/carlito/latin-700.css';
import '@fontsource/carlito/latin-ext-400.css';
import '@fontsource/carlito/latin-ext-700.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
