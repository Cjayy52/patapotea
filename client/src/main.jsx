import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SoundProvider, ToastProvider } from './context/ToastContext.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <SoundProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </SoundProvider>
    </ToastProvider>
  </React.StrictMode>,
);
