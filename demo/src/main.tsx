import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { validateLicense } from 'vise-workflow-engine';
import '@fontsource-variable/inter';
import 'vise-workflow-engine/react/style.css';
import './demo.css';
import App from './App';

validateLicense('eyJvcmciOiJEZW1vIiwicGxhbiI6InBybyJ9.c61270d419656170');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
