import React, { useState, useEffect } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

interface WalletInfoProps {
  walletAddress: string;
}

export const WalletInfo: React.FC<WalletInfoProps> = ({ walletAddress }) => {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [validAddress, setValidAddress] = useState<boolean>(false);

  useEffect(() => {
    // Kiểm tra địa chỉ ví hợp lệ
    let isValid = false;
    try {
      if (walletAddress && typeof walletAddress === 'string' && walletAddress.trim() !== '') {
        // Kiểm tra xem địa chỉ có đúng định dạng Solana không
        new PublicKey(walletAddress);
        isValid = true;
        console.log("Địa chỉ ví hợp lệ:", walletAddress);
      } else {
        console.log("Địa chỉ ví không hợp lệ hoặc trống");
      }
    } catch (err) {
      console.error("Lỗi khi kiểm tra địa chỉ ví:", err);
    }
    
    setValidAddress(isValid);
  }, [walletAddress]);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        setIsLoading(true);
        setError('');
        
        if (!validAddress) {
          setBalance(null);
          return;
        }
        
        console.log("Đang lấy số dư cho địa chỉ:", walletAddress);
        
        // Chuyển đổi chuỗi địa chỉ thành đối tượng PublicKey
        const pubKey = new PublicKey(walletAddress);
        const balanceLamports = await connection.getBalance(pubKey);
        const balanceSOL = balanceLamports / LAMPORTS_PER_SOL;
        
        console.log("Số dư (SOL):", balanceSOL);
        setBalance(balanceSOL);
      } catch (error: any) {
        console.error('Lỗi khi lấy số dư:', error);
        setError('Không thể lấy số dư ví');
      } finally {
        setIsLoading(false);
      }
    };

    if (validAddress) {
      fetchBalance();
      
      // Thiết lập interval để cập nhật số dư mỗi 30 giây
      const intervalId = setInterval(fetchBalance, 30000);
      return () => clearInterval(intervalId);
    }
  }, [walletAddress, connection, validAddress]);

  // Format địa chỉ ví ngắn gọn hơn
  const formatAddress = (address: string | any): string => {
    // Kiểm tra nếu address không phải là chuỗi hoặc rỗng
    if (!address || typeof address !== 'string') {
      return 'Chưa có địa chỉ';
    }
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className="wallet-info p-4 bg-gray-800 rounded-lg shadow-md text-white">
      <h2 className="text-xl font-bold mb-4">Thông tin ví</h2>
      
      <div className="mb-2">
        <span className="font-semibold">Địa chỉ: </span>
        {validAddress ? (
          <>
            <span className="font-mono" title={walletAddress}>{formatAddress(walletAddress)}</span>
            <button 
              className="ml-2 text-xs bg-blue-600 px-2 py-1 rounded hover:bg-blue-700"
              onClick={() => navigator.clipboard.writeText(walletAddress)}
            >
              Sao chép
            </button>
          </>
        ) : (
          <span className="text-red-400">Địa chỉ ví không hợp lệ</span>
        )}
      </div>
      
      <div className="mb-2">
        <span className="font-semibold">Số dư: </span>
        {!validAddress ? (
          <span className="text-red-400">Không thể hiển thị số dư</span>
        ) : isLoading ? (
          <span>Đang tải...</span>
        ) : error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          <span>{balance !== null ? `${balance.toFixed(6)} SOL` : 'Chưa có dữ liệu'}</span>
        )}
      </div>
    </div>
  );
}; 