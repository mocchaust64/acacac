import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletManager } from './components/WalletManager';
import { WebAuthnLogin } from './components/WebAuthnLogin';
import './components/WebAuthnLogin.css'; // Import CSS

// Default styles
require('@solana/wallet-adapter-react-ui/styles.css');

function App() {
  // Có thể thay đổi network tùy theo nhu cầu
  const network = WalletAdapterNetwork.Devnet;
  
  // Endpoint cho Solana
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // Kiểm tra localStorage xem đã có ví chưa
  const [walletInfo, setWalletInfo] = useState<any>(null);

  // Kiểm tra localStorage khi component mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('walletInfo');
    if (savedWallet) {
      setWalletInfo(JSON.parse(savedWallet));
    }
  }, []);

  const handleLoginSuccess = () => {
    console.log('Đăng nhập thành công!');
    // Hiển thị thông báo thành công
    alert('Đăng nhập thành công!');
  };

  const handleWalletCreated = (info: any) => {
    // Lưu thông tin ví vào localStorage
    localStorage.setItem('walletInfo', JSON.stringify(info));
    setWalletInfo(info);
  };

  const handleReset = () => {
    // Xóa thông tin ví khỏi localStorage và state
    localStorage.removeItem('walletInfo');
    setWalletInfo(null);
  };

  return (
    <ConnectionProvider endpoint={endpoint}>
      <div className="App">
        <header className="App-header">
          <h1>Moon Wallet</h1>
          {walletInfo && (
            <button onClick={handleReset} className="reset-button">
              Đặt lại
            </button>
          )}
        </header>
        <main>
          {walletInfo ? (
            <WebAuthnLogin 
              walletInfo={walletInfo} 
              onLoginSuccess={handleLoginSuccess} 
            />
          ) : (
            <WalletManager onWalletCreated={handleWalletCreated} />
          )}
        </main>
      </div>
    </ConnectionProvider>
  );
}

export default App;
