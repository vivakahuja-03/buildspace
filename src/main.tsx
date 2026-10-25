import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initTheme } from './theme/theme';

initTheme();
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);