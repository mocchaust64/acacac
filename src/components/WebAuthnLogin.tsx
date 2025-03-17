import React, { useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { getWebAuthnAssertion } from '../utils/webauthnUtils';

interface WebAuthnLoginProps {
  onLoginSuccess: () => void;
}

export const WebAuthnLogin: React.FC<WebAuthnLoginProps> = ({ onLoginSuccess }) => {
  const { connection } = useConnection();
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Tạo challenge ngẫu nhiên
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      
      // Gọi WebAuthn authentication không chỉ định credential (cho phép người dùng chọn)
      const options: PublicKeyCredentialRequestOptions = {
        challenge: challenge,
        rpId: window.location.hostname,
        timeout: 60000,
        userVerification: 'preferred',
        // Không chỉ định allowCredentials để cho phép tất cả credential
      };
      
      console.log("Đang yêu cầu xác thực WebAuthn...");
      const assertion = await navigator.credentials.get({
        publicKey: options
      }) as PublicKeyCredential;
      
      if (!assertion || !assertion.response) {
        throw new Error("Không thể lấy thông tin xác thực");
      }
      
      // Lấy thông tin credential từ kết quả
      const credentialId = Buffer.from(assertion.rawId).toString('hex');
      console.log("Đã lấy Credential ID:", credentialId);
      
      // Kiểm tra xem đã có ví nào được lưu với credential này chưa
      const walletInfo = findWalletByCredentialId(credentialId);
      
      if (walletInfo) {
        // Đã có ví - đăng nhập
        console.log("Tìm thấy ví đã lưu với credential này:", walletInfo);
        localStorage.setItem('walletInfo', JSON.stringify(walletInfo));
        localStorage.setItem('isLoggedIn', 'true');
        setStatus('Đăng nhập thành công!');
        onLoginSuccess();
      } else {
        // Không tìm thấy ví - nếu muốn import ví, có thể cài đặt luồng import tại đây
        setError("Không tìm thấy ví nào liên kết với thiết bị này. Vui lòng tạo ví mới hoặc liên hệ hỗ trợ.");
      }
    } catch (error: any) {
      console.error("Lỗi khi xác thực WebAuthn:", error);
      setError(error.message || "Không thể xác thực với WebAuthn");
    } finally {
      setIsLoading(false);
    }
  };
  
  // Hàm tìm ví dựa trên credential ID
  const findWalletByCredentialId = (credentialId: string) => {
    // Kiểm tra trong danh sách credentials đã lưu
    const credentialsListStr = localStorage.getItem('webauthnCredentials');
    if (credentialsListStr) {
      try {
        const credentialsList = JSON.parse(credentialsListStr);
        const foundCredential = credentialsList.find((cred: any) => cred.credentialId === credentialId);
        
        if (foundCredential) {
          // Tạo walletInfo từ thông tin credential
          return {
            address: foundCredential.walletAddress,
            credential_id: foundCredential.credentialId,
            public_key: foundCredential.publicKey,
            name: foundCredential.displayName
          };
        }
      } catch (e) {
        console.error("Lỗi khi đọc danh sách credentials từ localStorage:", e);
      }
    }
    
    // Kiểm tra trong danh sách ví đã lưu
    const walletListStr = localStorage.getItem('walletList');
    if (walletListStr) {
      try {
        const walletList = JSON.parse(walletListStr);
        const foundWallet = walletList.find((wallet: any) => 
          (wallet.credential_id && wallet.credential_id === credentialId) ||
          (wallet.credentialId && wallet.credentialId === credentialId)
        );
        
        if (foundWallet) {
          return foundWallet;
        }
      } catch (e) {
        console.error("Lỗi khi đọc danh sách ví từ localStorage:", e);
      }
    }
    
    // Kiểm tra walletInfo hiện tại
    const walletInfoStr = localStorage.getItem('walletInfo');
    if (walletInfoStr) {
      try {
        const walletInfo = JSON.parse(walletInfoStr);
        if (
          (walletInfo.credential_id && walletInfo.credential_id === credentialId) ||
          (walletInfo.credentialId && walletInfo.credentialId === credentialId)
        ) {
          return walletInfo;
        }
      } catch (e) {
        console.error("Lỗi khi đọc thông tin ví từ localStorage:", e);
      }
    }
    
    return null;
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-6 max-w-md">
      <h2 className="text-xl font-semibold mb-4 text-white">Đăng nhập vào ví</h2>
      
      {status && <p className="text-blue-400 mb-4">{status}</p>}
      
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-300">Vui lòng xác thực trên thiết bị của bạn...</p>
        </div>
      ) : (
        <>
          <p className="text-gray-300 mb-4">
            Sử dụng xác thực sinh trắc học (vân tay, Face ID, v.v.) để đăng nhập vào ví của bạn.
          </p>
          
          {error && (
            <div className="bg-red-900 bg-opacity-20 border border-red-800 text-red-400 p-3 rounded mb-4">
              {error}
            </div>
          )}
          
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center"
            onClick={handleLogin}
            disabled={isLoading}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            Đăng nhập bằng WebAuthn
          </button>
        </>
      )}
    </div>
  );
}; 