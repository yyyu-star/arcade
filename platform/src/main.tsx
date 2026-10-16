import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SessionProvider } from './session.tsx';
import { installTapSound } from './sound.ts';
import { WalletProvider } from './wallet.tsx';
import './styles.css';

installTapSound();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </SessionProvider>
  </StrictMode>,
);
