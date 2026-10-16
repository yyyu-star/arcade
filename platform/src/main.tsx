import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SessionProvider } from './session.tsx';
import { WalletProvider } from './wallet.tsx';
import './styles.css';

// 0.5.0 以前暗上线用的内测标记，?beta= 这套 0.10.17 删了：顺手清掉浏览器里还留着的（维护者 2026-10-16 定）
try {
  localStorage.removeItem('arcade.beta');
} catch {
  // 隐私模式等用不了 localStorage：那也就没存过
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </SessionProvider>
  </StrictMode>,
);
