import React from 'react';
import { createRoot } from 'react-dom/client';
// Calibri is the deck font. Carlito has the same metrics and stands in where
// Calibri is not installed; both cover Latin letters and digits only, so Arabic
// text uses IBM Plex Sans Arabic (open licence), which sits well next to them.
import '@fontsource/carlito/latin-400.css';
import '@fontsource/carlito/latin-700.css';
import '@fontsource/carlito/latin-ext-400.css';
import '@fontsource/carlito/latin-ext-700.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
