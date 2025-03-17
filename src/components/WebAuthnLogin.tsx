import React, { useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { web3 } from '@coral-xyz/anchor';
import { getWebAuthnCredential, getWebAuthnAssertion } from '../utils/webauthnUtils';
import { verifyWebAuthnSignature } from '../utils/webauthnUtils';
import './WebAuthnLogin.css';

interface WebAuthnLoginProps {
  walletInfo: {
    publicKey: string;
    pda: string;
    webauthnCredentialId: string;
    webauthnPubkey: string;
  };
  onLoginSuccess: () => void;
}

export const WebAuthnLogin: React.FC<WebAuthnLoginProps> = ({ 
  walletInfo, 
  onLoginSuccess 
}) => {
  const { connection } = useConnection();
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Lấy thông tin ví từ localStorage
      const walletInfoStr = localStorage.getItem('walletInfo');
      if (!walletInfoStr) {
        throw new Error("Không tìm thấy thông tin ví");
      }
      
      const walletInfo = JSON.parse(walletInfoStr);
      console.log("Thông tin ví đọc được:", walletInfo);
      
      // Kiểm tra tất cả các trường có thể chứa khóa công khai
      const webauthnPubkey = walletInfo.public_key || walletInfo.webauthnPubkey || walletInfo.pubkey;
      if (!webauthnPubkey) {
        console.error("Không tìm thấy khóa công khai WebAuthn trong thông tin ví");
        throw new Error("Thông tin ví không hợp lệ");
      }
      
      // Lấy thông tin từ walletInfo - kiểm tra cả credentialId và credential_id
      const credentialId = walletInfo.credential_id || walletInfo.credentialId;
      if (!credentialId) {
        throw new Error("Không tìm thấy credential ID trong thông tin ví");
      }
      
      const walletAddress = walletInfo.address;
      
      console.log("Sử dụng credential ID:", credentialId);
      console.log("Sử dụng khóa công khai:", webauthnPubkey);
      
      // Thực hiện đăng nhập WebAuthn
      const authResult = await getWebAuthnAssertion(credentialId);
      console.log("Đăng nhập WebAuthn thành công:", authResult);
      
      // Phân tích kết quả
      const { signature, authenticatorData, clientDataJSON } = authResult;
      
      // Xác minh chữ ký nếu cần
      
      // Đăng nhập thành công
      if (onLoginSuccess) {
        onLoginSuccess();
      }
    } catch (error: any) {
      console.error("Lỗi đăng nhập:", error);
      setError(error.message || "Đăng nhập thất bại");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="webauthn-login">
      <h2>Đăng nhập bằng WebAuthn</h2>
      <p>Sử dụng xác thực sinh trắc học (vân tay, Face ID) để đăng nhập vào ví của bạn.</p>
      
      <button 
        onClick={handleLogin} 
        className="primary-button"
      >
        Đăng nhập với WebAuthn
      </button>
      
      {status && <p className="status-message">{status}</p>}
    </div>
  );
}; 