import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { StoreProvider } from './lib/store';
import { AuthProvider } from './lib/AuthContext';
import { queryClient } from './lib/query';
import { registerOperzaServiceWorker } from './lib/pwa';
import './styles/tokens.css';
import './styles/app.css';

void registerOperzaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
