import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletManager } from './components/WalletManager';
import { WebAuthnLogin } from './components/WebAuthnLogin';
import './components/WebAuthnLogin.css'; // Import CSS
import { WalletInfo } from './components/WalletInfo';
import { WebAuthnImport } from './components/WebAuthnImport';

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
  const [walletInfo, setWalletInfo] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [showImport, setShowImport] = useState<boolean>(false);

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
    console.log("Ví đã được tạo, địa chỉ chuỗi:", address);
    setWalletAddress(address);
    setIsLoggedIn(true);
  };

  const handleReset = () => {
    // Xóa thông tin ví khỏi localStorage và state
    localStorage.removeItem('walletInfo');
    setWalletInfo(null);
    setIsLoggedIn(false);
  };

  // Hàm xử lý khi import credential thành công
  const handleCredentialImported = (address: string) => {
    console.log("Đã import credential thành công:", address);
    setWalletAddress(address);
    setIsLoggedIn(true);
    setShowImport(false);
  };

  console.log("Current wallet address in state:", walletAddress);

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
          {isLoggedIn ? (
            <div className="space-y-6">
              <WalletInfo walletAddress={walletAddress} />
              <button 
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                onClick={() => {
                  setIsLoggedIn(false);
                  // Không xóa walletAddress khi đăng xuất để có thể đăng nhập lại dễ dàng
                }}
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <div className="min-h-screen bg-gray-900 text-white p-4">
              <h1 className="text-2xl font-bold mb-6">Moon Wallet</h1>
              
              {!showImport ? (
                <>
                  <div className="flex space-x-4 mb-6">
                    <WalletManager onWalletCreated={handleWalletCreated} />
                    <WebAuthnLogin 
                      walletInfo={getStoredWalletInfo()}
                      onLoginSuccess={handleLoginSuccess} 
                    />
                  </div>
                  
                  <button
                    className="text-blue-400 hover:text-blue-300 mt-4 block"
                    onClick={() => setShowImport(true)}
                  >
                    Thiết bị mới? Đăng nhập bằng WebAuthn và khôi phục ví
                  </button>
                </>
              ) : (
                <>
                  <WebAuthnImport onCredentialImported={handleCredentialImported} />
                  
                  <button
                    className="text-blue-400 hover:text-blue-300 mt-4 block"
                    onClick={() => setShowImport(false)}
                  >
                    Quay lại đăng nhập/đăng ký
                  </button>
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
