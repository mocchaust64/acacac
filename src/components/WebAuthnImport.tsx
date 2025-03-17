import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';

interface WebAuthnImportProps {
  onCredentialImported: (walletAddress: string) => void;
}

export const WebAuthnImport: React.FC<WebAuthnImportProps> = ({ onCredentialImported }) => {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [step, setStep] = useState<number>(1);
  const [credentialInfo, setCredentialInfo] = useState<{id: string, publicKey?: string}|null>(null);

  const handleWebAuthnAuthenticate = async () => {
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
      
      // Lưu thông tin credential
      setCredentialInfo({
        id: credentialId
      });
      
      // Chuyển sang bước tiếp theo
      setStep(2);
      
    } catch (error: any) {
      console.error("Lỗi khi xác thực WebAuthn:", error);
      setError(error.message || "Không thể xác thực với WebAuthn");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAddress = () => {
    try {
      if (!walletAddress.trim()) {
        throw new Error("Vui lòng nhập địa chỉ ví");
      }
      
      // Kiểm tra địa chỉ Solana hợp lệ
      try {
        new PublicKey(walletAddress);
      } catch (e) {
        throw new Error("Địa chỉ ví Solana không hợp lệ");
      }

      if (!credentialInfo) {
        throw new Error("Thông tin xác thực không hợp lệ");
      }

      // Lưu thông tin vào localStorage
      const walletInfo = {
        address: walletAddress,
        credential_id: credentialInfo.id,
        credentialId: credentialInfo.id,
        created_at: new Date().toISOString()
      };

      localStorage.setItem('walletInfo', JSON.stringify(walletInfo));
      onCredentialImported(walletAddress);
      
    } catch (error: any) {
      setError(error.message || "Không thể lưu thông tin ví");
    }
  };

  return (
    <div className="webauthn-import p-4 bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Khôi phục ví bằng WebAuthn</h2>
      
      {step === 1 ? (
        <>
          <p className="mb-4">
            Sử dụng WebAuthn (TouchID, FaceID, Windows Hello...) để xác thực và lấy thông tin credential của bạn.
          </p>
          
          {error && <div className="text-red-400 mb-4">{error}</div>}
          
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded"
            onClick={handleWebAuthnAuthenticate}
            disabled={isLoading}
          >
            {isLoading ? "Đang xác thực..." : "Xác thực với WebAuthn"}
          </button>
        </>
      ) : (
        <>
          <div className="mb-4">
            <p className="text-green-400 mb-4">✓ Xác thực WebAuthn thành công!</p>
            <p className="text-sm mb-2">Credential ID: {credentialInfo?.id.substring(0, 8)}...{credentialInfo?.id.substring(credentialInfo.id.length - 8)}</p>
            
            <label className="block text-sm mb-2">Địa chỉ ví Solana</label>
            <input
              type="text"
              className="w-full p-2 rounded bg-gray-700 text-white"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="Nhập địa chỉ ví của bạn"
            />
          </div>
          
          {error && <div className="text-red-400 mb-4">{error}</div>}
          
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded mb-2"
            onClick={handleSubmitAddress}
          >
            Hoàn tất khôi phục
          </button>
          
          <button
            className="w-full bg-gray-600 hover:bg-gray-700 py-2 rounded"
            onClick={() => setStep(1)}
          >
            Quay lại
          </button>
        </>
      )}
    </div>
  );
}; 