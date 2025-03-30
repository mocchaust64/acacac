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
  createStorePasswordHashTx,
  createAddGuardianTx
} from '../utils/transactionUtils';
import { 
  createWebAuthnCredential, 
  getWebAuthnCredential,
  isWebAuthnSupported 
} from '../utils/webauthnUtils';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

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
  
  // Khởi tạo keypair cho feePayer (cần kiểm tra tính hợp lệ)
  const [feePayerKeypair, setFeePayerKeypair] = useState<Keypair | null>(null);

  // Khởi tạo fee payer từ đầu component
  useEffect(() => {
    // Tạo keypair mới nếu chưa có
    if (!feePayerKeypair) {
      const keypair = Keypair.generate();
      setFeePayerKeypair(keypair);
      
      // Xin airdrop SOL để trả phí giao dịch
      const requestAirdrop = async () => {
        try {
          const airdropSignature = await connection.requestAirdrop(
            keypair.publicKey,
            LAMPORTS_PER_SOL * 1 // 1 SOL
          );
          await connection.confirmTransaction(airdropSignature);
          console.log("Đã nhận SOL airdrop:", keypair.publicKey.toBase58());
        } catch (error) {
          console.error("Lỗi khi xin airdrop:", error);
        }
      };
      
      requestAirdrop();
    }
  }, [connection, feePayerKeypair]);

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
  const createWallet = async () => {
    try {
      setIsCreating(true);
      setErrorMsg('');
      
      if (!webauthnCredentialId || !webauthnPubkey || !recoveryKey) {
        setErrorMsg('Thiếu thông tin cần thiết để tạo ví');
        return;
      }
      
      // Kiểm tra keypair
      if (!feePayerKeypair) {
        setErrorMsg('Fee payer keypair chưa được khởi tạo, vui lòng thử lại sau');
        return;
      }
      
      // Tạo buffer từ credentialId
      const credentialIdBuffer = Buffer.from(webauthnCredentialId, 'hex');
      
      // Tạo recovery hash từ recovery phrase
      const recoveryHashBytes = new Uint8Array(32);
      const phraseBytes = new TextEncoder().encode(recoveryKey);
      recoveryHashBytes.set(phraseBytes.slice(0, Math.min(phraseBytes.length, 32)));
      
      // Tạo PDA cho multisig wallet
      const multisigPDA = derivePDA(credentialIdBuffer);
      
      console.log("Khởi tạo ví với PDA:", multisigPDA.toBase58());
      console.log("Sử dụng fee payer:", feePayerKeypair.publicKey.toBase58());
      
      // 1. Tạo transaction khởi tạo multisig
      const tx = await createInitializeMultisigTx(
        1, // threshold = 1
        multisigPDA,
        feePayerKeypair.publicKey,
        feePayerKeypair,
        recoveryHashBytes,
        credentialIdBuffer
      );
      
      tx.feePayer = feePayerKeypair.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(feePayerKeypair);
      
      const signature = await connection.sendRawTransaction(tx.serialize());
      console.log("Đã khởi tạo ví multisig, signature:", signature);
      await connection.confirmTransaction(signature, 'confirmed');
      
      // 2. Tự động thêm guardian (owner)
      // Tính PDA cho guardian
      const [guardianPDA] = web3PublicKey.findProgramAddressSync(
        [
          Buffer.from('guardian'),
          multisigPDA.toBuffer(),
          feePayerKeypair.publicKey.toBuffer()
        ],
        programID
      );
      
      console.log("Thêm guardian với PDA:", guardianPDA.toBase58());
      
      // Tạo transaction add guardian
      const webauthnPubkeyBuffer = Buffer.from(webauthnPubkey, 'hex');
      
      // Tạo và gửi transaction add guardian
      const addGuardianTx = createAddGuardianTx(
        multisigPDA,
        guardianPDA,
        feePayerKeypair.publicKey,
        walletName || "Owner",
        recoveryHashBytes,
        true, // is_owner = true
        webauthnPubkeyBuffer
      );
      
      addGuardianTx.feePayer = feePayerKeypair.publicKey;
      addGuardianTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      addGuardianTx.sign(feePayerKeypair);
      
      const addGuardianSignature = await connection.sendRawTransaction(addGuardianTx.serialize());
      console.log("Đã thêm guardian, signature:", addGuardianSignature);
      await connection.confirmTransaction(addGuardianSignature, 'confirmed');
      
      // 3. Lưu thông tin ví
      const walletInfo = {
        publicKey: multisigPDA.toBase58(),
        pda: multisigPDA.toBase58(),
        webauthnCredentialId: webauthnCredentialId,
        webauthnPubkey: webauthnPubkey,
      };
      
      // Lưu vào localStorage
      saveWalletInfo(multisigPDA.toBase58(), {
        id: webauthnCredentialId,
        publicKey: webauthnPubkey
      }, walletName || 'My Moon Wallet');
      
      // Thông báo thành công
      setStep(4); // Chuyển đến bước hoàn thành
      
      // Gọi callback để thông báo cho component cha
      onWalletCreated(multisigPDA.toBase58());
      
    } catch (error: any) {
      console.error("Lỗi khi tạo ví:", error);
      setErrorMsg(error.message || "Lỗi không xác định");
    } finally {
      setIsCreating(false);
    }
  };

  // Lưu thông tin ví vào localStorage
  const saveWalletInfo = (address: string, credentials: any, name: string) => {
    // Lưu thông tin ví
    const walletInfo = {
      address,
      credential_id: credentials.id,
      public_key: credentials.publicKey,
      name: name,
      created_at: new Date().toISOString()
    };
    
    // Lưu thông tin ví hiện tại vào localStorage
    localStorage.setItem('currentWallet', JSON.stringify(walletInfo));
    
    // Lưu vào danh sách ví
    let walletList = [];
    const savedList = localStorage.getItem('walletList');
    if (savedList) {
      try {
        walletList = JSON.parse(savedList);
      } catch (e) {
        console.error('Lỗi khi parse danh sách ví:', e);
      }
    }
    
    // Thêm ví mới vào danh sách nếu chưa có
    const exists = walletList.find((w: any) => w.address === address);
    if (!exists) {
      walletList.push(walletInfo);
      localStorage.setItem('walletList', JSON.stringify(walletList));
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
            onClick={createWallet}
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

