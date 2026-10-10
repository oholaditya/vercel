import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme.css';
import { bootstrapTheme } from './theme/ThemeProvider';
import App from './App';

bootstrapTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
