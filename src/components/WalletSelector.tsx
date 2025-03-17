import React, { useEffect, useState } from 'react';

interface SavedWallet {
  address: string;
  credential_id: string;
  name?: string;
  created_at: string;
  lastUsed?: string;
}

interface WalletSelectorProps {
  onSelectWallet: (wallet: SavedWallet) => void;
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onSelectWallet }) => {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  
  useEffect(() => {
    // Lấy danh sách ví từ localStorage
    const walletListStr = localStorage.getItem('walletList');
    if (walletListStr) {
      try {
        const walletList = JSON.parse(walletListStr);
        setWallets(walletList);
      } catch (error) {
        console.error("Lỗi khi đọc danh sách ví:", error);
      }
    }
    
    // Hoặc quét localStorage để tìm tất cả các ví
    const allWallets: SavedWallet[] = [];
    // Duyệt qua tất cả các key trong localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('wallet_')) {
        try {
          const walletInfo = JSON.parse(localStorage.getItem(key) || '');
          allWallets.push({
            address: walletInfo.address,
            credential_id: walletInfo.credential_id || walletInfo.credentialId,
            name: key.replace('wallet_', ''),
            created_at: walletInfo.created_at || new Date().toISOString()
          });
        } catch (e) {
          // Bỏ qua nếu không phải JSON hợp lệ
        }
      }
    }
    
    if (allWallets.length > 0) {
      setWallets(allWallets);
    }
  }, []);
  
  return (
    <div className="wallet-selector p-4 bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Chọn ví để đăng nhập</h2>
      
      {wallets.length === 0 ? (
        <p>Không tìm thấy ví nào đã lưu</p>
      ) : (
        <ul className="space-y-2">
          {wallets.map((wallet, index) => (
            <li 
              key={index} 
              className="p-3 bg-gray-700 rounded-md hover:bg-gray-600 cursor-pointer"
              onClick={() => onSelectWallet(wallet)}
            >
              <div className="font-medium">{wallet.name || `Ví ${index + 1}`}</div>
              <div className="text-sm font-mono text-gray-300">
                {wallet.address.substring(0, 8)}...{wallet.address.substring(wallet.address.length - 8)}
              </div>
              <div className="text-xs text-gray-400">
                Tạo ngày: {new Date(wallet.created_at).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}; 