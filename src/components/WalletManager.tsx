import React, { useState, useEffect, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { web3 } from '@coral-xyz/anchor';
import idlFile from '../idl/moon_wallet_program.json';
import { Keypair } from '@solana/web3.js';

// Import các module đã tách
import { convertIdl } from '../utils/idlUtils';
import { bufferToHex, hexToBuffer, hashPassword } from '../utils/bufferUtils';
import { 
  programID, 
  createInitializeMultisigTx, 
  createConfigureWebauthnTx, 
  createStorePasswordHashTx 
} from '../utils/transactionUtils';
import { 
  createNewWebAuthnCredential, 
  getWebAuthnCredential,  // Thay đổi tên import này
  isWebAuthnSupported 
} from '../utils/webauthnUtils';

// Chuyển đổi IDL một lần
const idl = convertIdl(idlFile);

// Thêm prop onWalletCreated vào interface
interface WalletManagerProps {
  onWalletCreated?: (walletInfo: any) => void;
}

export const WalletManager: React.FC<WalletManagerProps> = ({ onWalletCreated }) => {
  const { connection } = useConnection();
  
  // State cho từng bước
  const [step, setStep] = useState<number>(1);
  const [status, setStatus] = useState<string>('');
  const [walletName, setWalletName] = useState<string>('');
  const [newWallet, setNewWallet] = useState<web3.Keypair | null>(null);
  const [multisigPDA, setMultisigPDA] = useState<web3.PublicKey | null>(null);
  const [webauthnPubkey, setWebauthnPubkey] = useState<string>('');
  const [webauthnCredentialId, setWebauthnCredentialId] = useState<string>('');
  const [isWebAuthnConfigured, setIsWebAuthnConfigured] = useState(false);

  // Khởi tạo ví trả phí
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

  // Kiểm tra số dư ví trả phí
  const checkFeePayerBalance = async () => {
    if (!feePayerKeypair) {
      setStatus('Không tìm thấy thông tin ví trả phí');
      return false;
    }

    try {
      const balance = await connection.getBalance(feePayerKeypair.publicKey);
      const balanceInSOL = balance / web3.LAMPORTS_PER_SOL;
      
      setStatus(`Số dư ví trả phí: ${balanceInSOL} SOL`);
      
      return balance > 0;
    } catch (error) {
      console.error('Lỗi khi kiểm tra số dư:', error);
      setStatus('Lỗi khi kiểm tra số dư ví trả phí');
      return false;
    }
  };

  // Bước 1: Tạo ví mới
  const createNewWallet = () => {
    try {
      const wallet = web3.Keypair.generate();
      setNewWallet(wallet);
      console.log('Địa chỉ ví mới:', wallet.publicKey.toString());
      setStatus(`Đã tạo ví mới: ${wallet.publicKey.toString()}`);
      setStep(2);
    } catch (error) {
      console.error('Lỗi khi tạo ví mới:', error);
      setStatus('Lỗi khi tạo ví mới');
    }
  };

  // Bước 2: Tính PDA cho multisig
  const calculatePDA = () => {
    if (!newWallet) {
      setStatus('Chưa có ví để tính PDA');
      return;
    }

    try {
      const [pda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from('multisig'), newWallet.publicKey.toBuffer()],
        new web3.PublicKey(process.env.REACT_APP_PROGRAM_ID || '')
      );
      setMultisigPDA(pda);
      console.log('Multisig PDA:', pda.toString());
      setStatus(`Đã tính PDA: ${pda.toString()}`);
      setStep(3);
    } catch (error) {
      console.error('Lỗi khi tính PDA:', error);
      setStatus('Lỗi khi tính PDA');
    }
  };

  // Bước 3: Thiết lập WebAuthn
  const setupWebAuthn = async () => {
    if (!newWallet) {
      setStatus('Chưa có ví để thiết lập WebAuthn');
      return;
    }

    try {
      setStatus('Đang thiết lập WebAuthn...');
      const { publicKeyHex, credentialIdHex } = await createNewWebAuthnCredential();
      
      // Kiểm tra định dạng khóa
      const pubkeyBuffer = Buffer.from(publicKeyHex, 'hex');
      if (pubkeyBuffer.length !== 65 || pubkeyBuffer[0] !== 0x04) {
        throw new Error(`Khóa WebAuthn không đúng định dạng: độ dài ${pubkeyBuffer.length}, byte đầu ${pubkeyBuffer[0].toString(16)}`);
      }
      
      setWebauthnPubkey(publicKeyHex);
      setWebauthnCredentialId(credentialIdHex);
      
      console.log('WebAuthn Public Key:', publicKeyHex);
      console.log('WebAuthn Credential ID:', credentialIdHex);
      
      // Lưu khóa đầy đủ vào localStorage để dùng sau này
      localStorage.setItem(`webauthn_pubkey_${newWallet.publicKey.toString()}`, publicKeyHex);
      localStorage.setItem(`webauthn_credential_id_${newWallet.publicKey.toString()}`, credentialIdHex);
      
      setStatus('Đã thiết lập WebAuthn thành công');
      setIsWebAuthnConfigured(true);
      setStep(4);
    } catch (error: any) {
      console.error('Lỗi khi thiết lập WebAuthn:', error);
      setStatus(`Lỗi khi thiết lập WebAuthn: ${error.message}`);
    }
  };

  // Bước 4: Khởi tạo ví trên blockchain
  const initializeOnChain = async () => {
    if (!newWallet || !feePayerKeypair || !webauthnPubkey) {
      setStatus('Thiếu thông tin cần thiết để khởi tạo');
      return;
    }

    try {
      setStatus('Đang tạo PDA cho ví...');

      // Tạo PDA khớp với cách tạo trong program
      const [newMultisigPDA] = await web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("multisig"),
          newWallet.publicKey.toBuffer()
        ],
        programID
      );

      setStatus('Đang khởi tạo ví mới...');

      // Sử dụng PDA đã tạo để khởi tạo
      const initTx = await createInitializeMultisigTx(
        walletName || 'Moon Wallet',
        1, // threshold mặc định là 1
        newMultisigPDA,
        newWallet.publicKey,
        feePayerKeypair
      );
      
      // Set feePayer và recentBlockhash
      initTx.feePayer = feePayerKeypair.publicKey;
      initTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Chỉ ký với feePayerKeypair
      initTx.partialSign(feePayerKeypair);
      
      // Gửi và đợi transaction
      const signature = await connection.sendRawTransaction(initTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      
      setStatus('Đang đợi xác nhận transaction...');
      await connection.confirmTransaction(signature, 'confirmed');
      
      // Lưu PDA để sử dụng cho các bước tiếp theo
      setMultisigPDA(newMultisigPDA);
      
      setStatus('Ví đã được khởi tạo thành công! Đang cấu hình WebAuthn...');

      // 2. Tạo và gửi transaction cấu hình WebAuthn
      const webauthnPubkeyBytes = Buffer.from(webauthnPubkey, 'hex');
      const webauthnTx = await createConfigureWebauthnTx(
        Array.from(new Uint8Array(webauthnPubkeyBytes)),
        newMultisigPDA,
        newWallet.publicKey
      );
      
      // Thêm fee payer
      webauthnTx.feePayer = feePayerKeypair.publicKey;
      webauthnTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Ký với cả owner và fee payer
      webauthnTx.partialSign(newWallet);  // Owner phải ký vì là Signer trong instruction
      webauthnTx.partialSign(feePayerKeypair);
      
      const webauthnTxId = await connection.sendRawTransaction(webauthnTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      await connection.confirmTransaction(webauthnTxId, 'confirmed');

      // Kiểm tra dữ liệu account sau khi khởi tạo
      await checkMultisigAccount(newMultisigPDA);

      setStatus('Ví đã được khởi tạo và cấu hình thành công trên blockchain!');
      setStep(5);

      // Sau khi tạo ví thành công, thông báo lên component cha
      if (onWalletCreated) {
        const walletInfo = {
          publicKey: newWallet?.publicKey.toString(),
          pda: multisigPDA?.toString(),
          webauthnCredentialId,
          webauthnPubkey
        };
        onWalletCreated(walletInfo);
      }
    } catch (error: any) {
      console.error('Lỗi khi khởi tạo trên blockchain:', error);
      setStatus(`Lỗi khi khởi tạo: ${error.message}`);
    }
  };

  // Thêm hàm kiểm tra account data
  const checkMultisigAccount = async (pda: web3.PublicKey) => {
    try {
      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) {
        console.log('Account không tồn tại');
        return;
      }

      // Log raw data để kiểm tra
      console.log('Raw account data:', accountInfo.data);
      
      // Kiểm tra discriminator (8 bytes đầu tiên)
      const discriminator = accountInfo.data.slice(0, 8);
      console.log('Discriminator:', Buffer.from(discriminator).toString('hex'));
      
      // Kiểm tra owner (32 bytes tiếp theo)
      const ownerPubkey = new web3.PublicKey(accountInfo.data.slice(8, 40));
      console.log('Owner:', ownerPubkey.toString());
      
      // Đọc name (4 bytes độ dài + nội dung)
      const nameLength = accountInfo.data.slice(40, 44).readUInt32LE(0);
      const name = Buffer.from(accountInfo.data.slice(44, 44 + nameLength)).toString();
      console.log('Name:', name);
      
      // Đọc threshold (1 byte)
      const thresholdOffset = 44 + nameLength;
      const threshold = accountInfo.data[thresholdOffset];
      console.log('Threshold:', threshold);
      
      // Đọc has_webauthn (1 byte)
      const hasWebAuthnOffset = thresholdOffset + 1;
      const hasWebAuthn = accountInfo.data[hasWebAuthnOffset] === 1;
      console.log('Has WebAuthn:', hasWebAuthn);
      
      // Đọc webauthn_pubkey (65 bytes)
      const webauthnPubkeyOffset = hasWebAuthnOffset + 1;
      const webauthnPubkey = Buffer.from(accountInfo.data.slice(webauthnPubkeyOffset, webauthnPubkeyOffset + 65));
      console.log('WebAuthn Pubkey (full):', webauthnPubkey.toString('hex'));
      console.log('WebAuthn Pubkey length:', webauthnPubkey.length);
      
      // Lưu khóa đầy đủ vào localStorage để dùng sau này
      if (webauthnPubkey.length === 65) {
        localStorage.setItem('webauthn_pubkey_' + ownerPubkey.toString(), webauthnPubkey.toString('hex'));
        console.log('Đã lưu WebAuthn pubkey vào localStorage');
      }

    } catch (error) {
      console.error('Lỗi khi kiểm tra account:', error);
    }
  };

  // Render UI theo từng bước
  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="section">
            <h3>Bước 1: Kiểm tra ví trả phí và tạo ví mới</h3>
            <button onClick={checkFeePayerBalance}>Kiểm tra ví trả phí</button>
            <button onClick={createNewWallet}>Tạo ví mới</button>
          </div>
        );
      case 2:
        return (
          <div className="section">
            <h3>Bước 2: Thiết lập thông tin ví</h3>
            <input
              type="text"
              placeholder="Tên ví"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              className="input"
            />
            <button onClick={calculatePDA}>Tính PDA</button>
          </div>
        );
      case 3:
        return (
          <div className="section">
            <h3>Bước 3: Thiết lập WebAuthn</h3>
            <p>Địa chỉ ví: {newWallet?.publicKey.toString()}</p>
            <p>PDA: {multisigPDA?.toString()}</p>
            <button onClick={setupWebAuthn}>Thiết lập WebAuthn</button>
          </div>
        );
      case 4:
        return (
          <div className="section">
            <h3>Bước 4: Khởi tạo trên Blockchain</h3>
            <p>WebAuthn đã được thiết lập</p>
            <p>Credential ID: {webauthnCredentialId}</p>
            <button onClick={initializeOnChain}>Khởi tạo trên Blockchain</button>
          </div>
        );
      case 5:
        return (
          <div className="section">
            <h3>Hoàn tất!</h3>
            <p>Địa chỉ ví: {newWallet?.publicKey.toString()}</p>
            <p>Tên ví: {walletName || 'Moon Wallet'}</p>
            <p>PDA: {multisigPDA?.toString()}</p>
            <p>WebAuthn Credential ID: {webauthnCredentialId}</p>
            <button onClick={() => {
              // Tạo object chứa thông tin ví
              const walletInfo = {
                publicKey: newWallet?.publicKey.toString(),
                secretKey: Array.from(newWallet?.secretKey || []),
                name: walletName || 'Moon Wallet',
                pda: multisigPDA?.toString(),
                webauthnCredentialId,
                webauthnPubkey
              };
              
              // Tạo và tải file JSON
              const dataStr = "data:text/json;charset=utf-8," + 
                encodeURIComponent(JSON.stringify(walletInfo, null, 2));
              const downloadAnchorNode = document.createElement('a');
              downloadAnchorNode.setAttribute("href", dataStr);
              downloadAnchorNode.setAttribute("download", "wallet_info.json");
              document.body.appendChild(downloadAnchorNode);
              downloadAnchorNode.click();
              downloadAnchorNode.remove();
            }}>
              Tải thông tin ví
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="wallet-manager">
      <h2>Moon Wallet Manager</h2>
      {renderStep()}
      <div className="status">
        <h3>Trạng thái:</h3>
        <p style={{ whiteSpace: 'pre-line' }}>{status}</p>
      </div>
    </div>
  );
};

