import React, { useState, useEffect, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { web3 } from '@coral-xyz/anchor';
import idlFile from '../idl/moon_wallet_program.json';
import { Keypair, PublicKey as web3PublicKey } from '@solana/web3.js';

// Import các module đã tách
import { convertIdl } from '../utils/idlUtils';

import { 
  programID, 
  createInitializeMultisigTx, 
  createConfigureWebAuthnTx,
  createStorePasswordHashTx 
} from '../utils/transactionUtils';
import { 
  createWebAuthnCredential, 
  getWebAuthnCredential,
  isWebAuthnSupported 
} from '../utils/webauthnUtils';

// Chuyển đổi IDL một lần
const idl = convertIdl(idlFile);

// Thêm prop onWalletCreated vào interface
interface WalletManagerProps {
  onWalletCreated: (walletAddress: string) => void;
}

export const WalletManager: React.FC<WalletManagerProps> = ({ onWalletCreated }) => {
  const { connection } = useConnection();
  
  // State để quản lý luồng tạo ví
  const [step, setStep] = useState<number>(1);
  const [walletName, setWalletName] = useState<string>('');
  const [recoveryKey, setRecoveryKey] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [webauthnPubkey, setWebauthnPubkey] = useState<string>('');
  const [webauthnCredentialId, setWebauthnCredentialId] = useState<string>('');
  const [multisigPDA, setMultisigPDA] = useState<web3PublicKey | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  
  // Khởi tạo fee payer từ biến môi trường
  const feePayerKeypair = useMemo(() => {
    const feePayerSecretKeyStr = process.env.REACT_APP_FEE_PAYER_SECRET_KEY;
    
    if (!feePayerSecretKeyStr) {
      console.error('Không tìm thấy REACT_APP_FEE_PAYER_SECRET_KEY trong env');
      return null;
    }

    try {
      const secretKey = feePayerSecretKeyStr.split(',').map(num => parseInt(num.trim()));
      return Keypair.fromSecretKey(new Uint8Array(secretKey));
    } catch (error) {
      console.error('Lỗi khi tạo fee payer keypair:', error);
      return null;
    }
  }, []);

  // Bước 1: Tạo WebAuthn credential
  const handleCreateCredential = async () => {
    try {
      setIsCreating(true);
      setErrorMsg('');
      
      // Tạo credential WebAuthn mới với tên ví
      const credentialResult = await createWebAuthnCredential(
        '', // Chưa có địa chỉ ví
        walletName || 'Ví của tôi'
      );
      
      const { credentialId, publicKey } = credentialResult;
      
      setWebauthnPubkey(publicKey);
      setWebauthnCredentialId(credentialId);
      
      console.log("WebAuthn Public Key:", publicKey);
      console.log("WebAuthn Credential ID:", credentialId);
      
      // Chuyển sang bước 2 để nhập recovery key
      setStep(2);
    } catch (error: any) {
      console.error("Lỗi khi tạo WebAuthn credential:", error);
      setErrorMsg(error.message || "Lỗi không xác định");
    } finally {
      setIsCreating(false);
    }
  };

  // Tạo PDA từ credential ID
  const derivePDA = (credentialId: Buffer): web3PublicKey => {
    return web3PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"), 
        credentialId
      ],
      programID
    )[0];
  };

  // Bước 2: Hoàn tất tạo ví với recovery key
  const completeWalletCreation = async () => {
    setIsCreating(true);
    setErrorMsg('');
    
    try {
      // Kiểm tra xem đã nhập recovery key chưa
      if (!recoveryKey) {
        setErrorMsg("Vui lòng nhập recovery key");
        setIsCreating(false);
        return;
      }
      
      // Tạo recovery hash từ key
      const encoder = new TextEncoder();
      const data = encoder.encode(recoveryKey);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const recoveryHash = new Uint8Array(hashBuffer);
      
      // Lấy credential ID và pubkey từ state
      const credentialIdBytes = Buffer.from(webauthnCredentialId, 'hex');
      const webauthnPubkeyBytes = Buffer.from(webauthnPubkey, 'hex');
      
      // Tạo PDA từ credential ID
      const newMultisigPDA = derivePDA(credentialIdBytes);
      console.log("Multisig PDA mới:", newMultisigPDA.toString());
      
      // Lưu thông tin ví vào localStorage
      saveWalletToLocalStorage(
        newMultisigPDA.toString(),
        webauthnCredentialId, 
        webauthnPubkey,
        Array.from(recoveryHash),
        walletName || `Ví ${newMultisigPDA.toString().slice(0, 4)}...${newMultisigPDA.toString().slice(-4)}`
      );
      
      // Khởi tạo ví trên blockchain
      await initializeOnChain(
        newMultisigPDA, 
        credentialIdBytes, 
        webauthnPubkeyBytes, 
        recoveryHash
      );
      
      // Thông báo tạo ví thành công
      if (onWalletCreated) {
        onWalletCreated(newMultisigPDA.toString());
      }
      
      setMultisigPDA(newMultisigPDA);
      setSuccess(true);
      setStep(3);
    } catch (error: any) {
      console.error("Lỗi:", error);
      setErrorMsg(error.message || "Lỗi khi tạo ví");
    } finally {
      setIsCreating(false);
    }
  };

  // Lưu thông tin ví vào localStorage
  const saveWalletToLocalStorage = (
    address: string,
    webauthnCredentialId: string,
    publicKey: string,
    recoveryHash: number[],
    walletName?: string
  ) => {
    const walletInfo = {
      address,
      credential_id: webauthnCredentialId,
      credentialId: webauthnCredentialId,
      public_key: publicKey,
      webauthnPubkey: publicKey,
      pubkey: publicKey,
      name: walletName || `Ví ${address.slice(0, 4)}...${address.slice(-4)}`,
      threshold: 1,
      recovery_hash: Buffer.from(recoveryHash).toString('hex'),
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString()
    };
    
    // Lưu thông tin chi tiết ví
    localStorage.setItem(`wallet_${address}`, JSON.stringify(walletInfo));
    
    // Cập nhật danh sách ví
    let walletList: Array<{address: string, name?: string, created_at: string}> = [];
    const walletListStr = localStorage.getItem('walletList');
    if (walletListStr) {
      try {
        walletList = JSON.parse(walletListStr);
      } catch (e) {
        console.error("Lỗi khi đọc danh sách ví:", e);
      }
    }
    
    // Thêm ví mới vào danh sách nếu chưa có
    if (!walletList.some(w => w.address === address)) {
      walletList.push({
        address,
        name: walletInfo.name,
        created_at: walletInfo.created_at
      });
      localStorage.setItem('walletList', JSON.stringify(walletList));
    }
    
    // Lưu ví hiện tại
    localStorage.setItem('currentWallet', address);
    localStorage.setItem('walletInfo', JSON.stringify(walletInfo));
    
    console.log("Đã lưu thông tin ví vào localStorage:", walletInfo);
  };

  // Khởi tạo ví trên blockchain
  const initializeOnChain = async (
    multisigPDA: web3PublicKey,
    credentialId: Buffer,
    webauthnPubkey: Buffer,
    recoveryHash: Uint8Array
  ) => {
    // Kiểm tra feePayerKeypair có tồn tại không
    if (!feePayerKeypair) {
      throw new Error("Fee payer keypair không được khởi tạo");
    }

    try {
      // Tạo và gửi transaction initialize_multisig
      const tx = await createInitializeMultisigTx(
        1, // threshold = 1
        multisigPDA,
        feePayerKeypair.publicKey, // owner = feePayer
        feePayerKeypair,
        recoveryHash,
        credentialId
      );
      
      // Ký và gửi transaction
      tx.feePayer = feePayerKeypair.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(feePayerKeypair);
      
      const signature = await connection.sendRawTransaction(tx.serialize());
      console.log("Transaction đã gửi, chữ ký:", signature);
      
      await connection.confirmTransaction(signature, 'confirmed');
      console.log("Khởi tạo ví trên blockchain thành công!");
      
      // Cấu hình WebAuthn (không bắt buộc để thành công)
      try {
        const webauthnTx = await createConfigureWebAuthnTx(
          webauthnPubkey,
          multisigPDA,
          feePayerKeypair.publicKey
        );
        
        webauthnTx.feePayer = feePayerKeypair.publicKey;
        webauthnTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        webauthnTx.sign(feePayerKeypair);
        
        const webauthnSig = await connection.sendRawTransaction(webauthnTx.serialize());
        await connection.confirmTransaction(webauthnSig, 'confirmed');
        console.log("Cấu hình WebAuthn thành công!");
      } catch (webauthnError) {
        console.error("Lỗi khi cấu hình WebAuthn:", webauthnError);
        console.log("Ví vẫn được tạo thành công nhưng chưa cấu hình WebAuthn!");
      }
    } catch (error) {
      console.error("Lỗi:", error);
      throw error;
    }
  };

  // Render UI cho từng bước
  return (
    <div className="wallet-manager p-4 bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4 text-white">Tạo ví mới</h2>
      
      {step === 1 && (
        <div>
          <div className="mb-4">
            <label className="block text-sm mb-2 text-white">Tên ví (tùy chọn)</label>
            <input
              type="text"
              className="w-full p-2 rounded bg-gray-700 text-white"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="Ví của tôi"
            />
          </div>
          
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded text-white"
            onClick={handleCreateCredential}
            disabled={isCreating}
          >
            {isCreating ? "Đang xử lý..." : "Tiếp tục đăng ký"}
          </button>
        </div>
      )}
      
      {step === 2 && (
        <div>
          <p className="my-2 text-green-400">✅ WebAuthn đã được thiết lập</p>
          <div className="mb-4">
            <label className="block text-sm mb-2 text-white">Nhập recovery key (mật khẩu khôi phục)</label>
            <input
              type="password"
              className="w-full p-2 rounded bg-gray-700 text-white"
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              placeholder="Mật khẩu khôi phục"
            />
            <p className="text-xs text-gray-400 mt-1">
              Đây là mật khẩu bảo vệ ví của bạn. Hãy ghi nhớ hoặc lưu trữ an toàn.
            </p>
          </div>
          
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded text-white"
            onClick={completeWalletCreation}
            disabled={isCreating}
          >
            {isCreating ? "Đang tạo ví..." : "Hoàn tất đăng ký"}
          </button>
        </div>
      )}
      
      {step === 3 && success && (
        <div className="text-center">
          <p className="text-xl text-green-400 mt-4">✅ Tạo ví thành công!</p>
          <p className="text-white mt-2">Địa chỉ ví: {multisigPDA?.toString()}</p>
        </div>
      )}
      
      {errorMsg && <div className="text-red-400 mt-4">{errorMsg}</div>}
    </div>
  );
};

