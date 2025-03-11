import React, { useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { web3 } from '@coral-xyz/anchor';
import { getWebAuthnCredential } from '../utils/webauthnUtils';
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

  const handleLogin = async () => {
    try {
      setStatus('Đang xác thực với WebAuthn...');
      
      // Kiểm tra webauthnPubkey có tồn tại không
      if (!walletInfo.webauthnPubkey) {
        console.error('webauthnPubkey không tồn tại trong thông tin ví');
        setStatus('Lỗi: Thiếu thông tin xác thực WebAuthn');
        return;
      }
      
      // Log để debug
      console.log('WebAuthn Pubkey:', walletInfo.webauthnPubkey);
      console.log('WebAuthn CredentialId:', walletInfo.webauthnCredentialId);

      // Tạo thông điệp ngẫu nhiên để ký
      const message = new Uint8Array(32);
      window.crypto.getRandomValues(message);
      
      const credentialIdBuffer = Buffer.from(walletInfo.webauthnCredentialId, 'hex');
      
      // Lấy chữ ký và dữ liệu liên quan từ thiết bị
      const { 
        signature: webAuthnSignature, 
        authenticatorData, 
        clientDataJSON 
      } = await getWebAuthnCredential(credentialIdBuffer, message);

      // Đọc public key từ dữ liệu đã lưu
      let webAuthnPubkey = Buffer.from(walletInfo.webauthnPubkey, 'hex');
      
      // Thử lấy khóa từ localStorage nếu có
      const storedPubkey = localStorage.getItem('webauthn_pubkey_' + walletInfo.publicKey);
      if (storedPubkey) {
        console.log('Sử dụng khóa từ localStorage');
        webAuthnPubkey = Buffer.from(storedPubkey, 'hex');
      }
      
      // Xác minh chữ ký trực tiếp trên frontend
      const isValid = await verifyWebAuthnSignature(
        webAuthnPubkey,
        webAuthnSignature,
        authenticatorData,
        clientDataJSON
      );

      if (isValid) {
        setStatus('Đăng nhập thành công!');
        onLoginSuccess();
      } else {
        setStatus('Xác thực không thành công. Vui lòng thử lại.');
      }

    } catch (error: any) {
      console.error('Lỗi khi đăng nhập:', error);
      setStatus(`Lỗi khi đăng nhập: ${error.message}`);
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