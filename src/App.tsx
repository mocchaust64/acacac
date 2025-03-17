import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletManager } from './components/WalletManager';
import { WalletInfo } from './components/WalletInfo';
import { WebAuthnLogin } from './components/WebAuthnLogin';

// Default styles
require('@solana/wallet-adapter-react-ui/styles.css');

// Lấy thông tin ví từ localStorage
const getStoredWalletInfo = () => {
  const walletInfoStr = localStorage.getItem('walletInfo');
  if (walletInfoStr) {
    try {
      return JSON.parse(walletInfoStr);
    } catch (error) {
      console.error("Lỗi khi đọc thông tin ví từ localStorage:", error);
    }
  }
  return null;
};

function App() {
  // Có thể thay đổi network tùy theo nhu cầu
  const network = WalletAdapterNetwork.Devnet;
  
  // Endpoint cho Solana
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // Kiểm tra localStorage xem đã có ví chưa
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [showCreateWallet, setShowCreateWallet] = useState<boolean>(false);

  // Kiểm tra localStorage khi component được mount
  useEffect(() => {
    const walletInfo = getStoredWalletInfo();
    if (walletInfo && walletInfo.address) {
      console.log("Đã tìm thấy ví trong localStorage:", walletInfo.address);
      setWalletAddress(walletInfo.address);
    }
  }, []);

  // Hàm xử lý đăng nhập thành công
  const handleLoginSuccess = () => {
    console.log("Đăng nhập thành công!");
    const walletInfo = getStoredWalletInfo();
    if (walletInfo && walletInfo.address) {
      console.log("Đặt địa chỉ ví sau đăng nhập:", walletInfo.address);
      setWalletAddress(walletInfo.address);
    }
    setIsLoggedIn(true);
  };

  // Hàm xử lý khi ví được tạo
  const handleWalletCreated = (address: string) => {
    console.log("Ví đã được tạo, địa chỉ:", address);
    setWalletAddress(address);
    setIsLoggedIn(true);
    setShowCreateWallet(false);
  };

  const handleReset = () => {
    // Xóa thông tin ví khỏi localStorage và state
    localStorage.removeItem('walletInfo');
    setIsLoggedIn(false);
    setWalletAddress('');
  };

  return (
    <ConnectionProvider endpoint={endpoint}>
      <div className="App">
        <header className="App-header">
          <h1>Moon Wallet</h1>
          {isLoggedIn && (
            <button onClick={handleReset} className="reset-button">
              Đặt lại
            </button>
          )}
        </header>
        <main>
          {isLoggedIn ? (
            <div className="space-y-6">
              <WalletInfo walletAddress={walletAddress} />
              <button 
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                onClick={() => setIsLoggedIn(false)}
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <div className="min-h-screen bg-gray-900 text-white p-4">
              <h1 className="text-2xl font-bold mb-6">Moon Wallet</h1>
              
              {showCreateWallet ? (
                <>
                  <WalletManager onWalletCreated={handleWalletCreated} />
                  <button
                    className="text-blue-400 hover:text-blue-300 mt-4 block"
                    onClick={() => setShowCreateWallet(false)}
                  >
                    Quay lại đăng nhập
                  </button>
                </>
              ) : (
                <>
                  <WebAuthnLogin onLoginSuccess={handleLoginSuccess} />
                  <div className="text-center mt-4">
                    <span className="text-gray-400">Chưa có ví? </span>
                    <button
                      className="text-blue-400 hover:text-blue-300"
                      onClick={() => setShowCreateWallet(true)}
                    >
                      Tạo ví mới
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </ConnectionProvider>
  );
}

export default App;
