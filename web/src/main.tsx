import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <div className="aurora-bg" aria-hidden />
        <div className="grain-overlay" aria-hidden />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
