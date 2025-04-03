import React, { useState, useEffect } from 'react';
import { PublicKey, Transaction, Connection, SendTransactionError } from '@solana/web3.js';
import { web3 } from '@coral-xyz/anchor';
// Xóa useConnection hook vì sẽ nhận connection từ props
// import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { 
  createTransferTx, 
  createSecp256r1Instruction,
  programID,
  SECP256R1_PROGRAM_ID
} from '../utils/transactionUtils';
import { getWebAuthnAssertion } from '../utils/webauthnUtils';
import { getGuardianPDA, getMultisigPDA } from '../utils/credentialUtils';
import { getWalletByCredentialId } from '../firebase/webAuthnService';
import { Buffer } from 'buffer';
import BN from 'bn.js';

// Thêm hằng số cho chuẩn hóa signature
const SECP256R1_ORDER = new BN('FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 16);
const SECP256R1_HALF_ORDER = SECP256R1_ORDER.shrn(1);

/**
 * Chuẩn hóa chữ ký về dạng Low-S
 * @param signature - Chữ ký raw
 * @returns Chữ ký đã chuẩn hóa
 */
const normalizeSignatureToLowS = (sig: Buffer): Buffer => {
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);
  
  const sBN = new BN(s);
  console.log("S value (BN):", sBN.toString(16));
  console.log("HALF_ORDER:", SECP256R1_HALF_ORDER.toString(16));
  
  // Kiểm tra nếu s > half_order
  if (sBN.gt(SECP256R1_HALF_ORDER)) {
    console.log("Chuẩn hóa signature về dạng Low-S");
    // Tính s' = order - s
    const sNormalized = SECP256R1_ORDER.sub(sBN);
    console.log("S normalized:", sNormalized.toString(16));
    const sNormalizedBuffer = sNormalized.toArrayLike(Buffer, 'be', 32);
    return Buffer.concat([r, sNormalizedBuffer]);
  }
  
  console.log("Signature đã ở dạng Low-S");
  return sig;
};

// Hàm chuyển đổi chữ ký DER sang raw (r, s) format
const convertDERtoRaw = (derSignature: Uint8Array): Uint8Array => {
  // Đảm bảo đây là DER signature
  if (derSignature[0] !== 0x30) {
    console.error('Chữ ký không phải định dạng DER');
    return new Uint8Array(64); // Trả về buffer rỗng nếu không đúng định dạng
  }
  
  // Parse DER format
  // Format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  const rLength = derSignature[3];
  const rStart = 4;
  const rEnd = rStart + rLength;
  
  const sLength = derSignature[rEnd + 1];
  const sStart = rEnd + 2;
  const sEnd = sStart + sLength;
  
  // Trích xuất r và s
  let r = derSignature.slice(rStart, rEnd);
  let s = derSignature.slice(sStart, sEnd);
  
  // Cần đảm bảo r và s đúng 32 bytes
  // - Nếu dài hơn 32 bytes, cắt bớt (thường r và s có thể có padding)
  // - Nếu ngắn hơn 32 bytes, thêm padding 0 vào đầu
  const rPadded = new Uint8Array(32);
  const sPadded = new Uint8Array(32);
  
  if (r.length <= 32) {
    // Trường hợp r ngắn hơn 32 bytes, thêm padding
    rPadded.set(r, 32 - r.length);
  } else {
    // Trường hợp r dài hơn 32 bytes, cắt bớt (thường là byte đầu tiên là 0)
    rPadded.set(r.slice(r.length - 32));
  }
  
  if (s.length <= 32) {
    // Trường hợp s ngắn hơn 32 bytes, thêm padding
    sPadded.set(s, 32 - s.length);
  } else {
    // Trường hợp s dài hơn 32 bytes, cắt bớt (thường là byte đầu tiên là 0)
    sPadded.set(s.slice(s.length - 32));
  }
  
  // Nối r và s lại
  const rawSignature = new Uint8Array(64);
  rawSignature.set(rPadded);
  rawSignature.set(sPadded, 32);
  
  console.log('Đã chuyển đổi signature từ DER sang raw format:');
  console.log('- DER length:', derSignature.length);
  console.log('- Raw length:', rawSignature.length);
  
  return rawSignature;
};

// Interface cho props của component
interface TransferFormProps {
  walletAddress: string;  
  credentialId: string;   
  guardianId: number;     
  onTransferSuccess?: () => void;
  onTransferError?: (error: Error) => void;
  // Thêm connection vào props
  connection: Connection;
  // Thêm pdaBalance để hiển thị số dư chính xác
  pdaBalance?: number;
}

// Enum cho các trạng thái giao dịch
enum TransactionStatus {
  IDLE = 'idle',
  PREPARING = 'preparing',
  SIGNING = 'signing',
  BUILDING_TX = 'building_tx',
  SUBMITTING = 'submitting',
  CONFIRMING = 'confirming',
  SUCCESS = 'success',
  ERROR = 'error'
}

// Thêm enum để theo dõi trạng thái xác minh chữ ký
enum VerificationStatus {
  IDLE = 'idle',
  VERIFYING = 'verifying',
  SUCCESS = 'success',
  ERROR = 'error'
}

export const TransferForm: React.FC<TransferFormProps> = ({
  walletAddress,
  credentialId,
  guardianId,
  onTransferSuccess,
  onTransferError,
  // Thêm connection và pdaBalance vào tham số destructuring
  connection,
  pdaBalance = 0
}) => {
  // State
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [nonce, setNonce] = useState<number>(0);
  const [txStatus, setTxStatus] = useState<TransactionStatus>(TransactionStatus.IDLE);
  const [txId, setTxId] = useState<string>('');
  const [isMoonWalletAvailable, setIsMoonWalletAvailable] = useState<boolean>(false);
  const [connectionEndpoint, setConnectionEndpoint] = useState<string>('');
  // Thêm state cho chức năng xác minh chữ ký
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(VerificationStatus.IDLE);
  const [verificationMessage, setVerificationMessage] = useState<string>('');
  
  // Kiểm tra chương trình MoonWallet
  useEffect(() => {
    const checkPrograms = async () => {
      try {
        // Lấy endpoint của connection để hiển thị
        const endpoint = connection.rpcEndpoint;
        setConnectionEndpoint(endpoint);
        console.log("Đang kết nối đến:", endpoint);
        
        // Chỉ kiểm tra chương trình MoonWallet
        try {
          const moonWalletInfo = await connection.getAccountInfo(programID);
          setIsMoonWalletAvailable(moonWalletInfo !== null);
          
          if (moonWalletInfo === null) {
            console.warn("Chương trình MoonWallet không tồn tại trên validator này!");
          } else {
            console.log("Đã tìm thấy chương trình MoonWallet:", programID.toString());
          }
        } catch (error) {
          console.error("Lỗi khi kiểm tra chương trình MoonWallet:", error);
          setIsMoonWalletAvailable(false);
        }
      } catch (error) {
        console.error("Lỗi khi kiểm tra chương trình:", error);
      }
    };
    
    checkPrograms();
  }, [connection]);
  
  // Cập nhật walletBalance khi pdaBalance thay đổi
  useEffect(() => {
    if (pdaBalance !== undefined) {
      setWalletBalance(pdaBalance);
    }
  }, [pdaBalance]);
  
  // Lấy số dư ví và nonce hiện tại từ blockchain
  useEffect(() => {
    const loadWalletInfo = async () => {
      try {
        if (!walletAddress) return;
        
        // Tính PDA của ví từ credential ID
        const multisigPDA = await getMultisigPDA(credentialId);
        
        // Lấy thông tin account
        const accountInfo = await connection.getAccountInfo(multisigPDA);
        
        if (!accountInfo) {
          console.error('Không tìm thấy thông tin ví');
          return;
        }
        
        try {
          // Đọc nonce từ account data (từ vị trí thích hợp theo layout)
          // Giả sử nonce nằm ở offset 18 (8 bytes for discriminator + 1 byte threshold + 1 byte guardian_count + 8 bytes recovery_nonce)
          const transactionNonce = accountInfo.data.readBigUInt64LE(18);
          setNonce(Number(transactionNonce));
          console.log("Transaction nonce hiện tại:", Number(transactionNonce));
        } catch (error) {
          console.error("Lỗi khi đọc nonce từ account data:", error);
          // Fallback về nonce = 0 nếu không đọc được
          setNonce(0);
        }
        
      } catch (error) {
        console.error('Lỗi khi tải thông tin ví:', error);
      }
    };
    
    loadWalletInfo();
  }, [walletAddress, credentialId, connection]);
  
  // Xử lý khi nhập địa chỉ đích
  const handleDestinationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDestinationAddress(e.target.value);
    // Reset thông báo lỗi và thành công
    setError('');
    setSuccess('');
    setTxStatus(TransactionStatus.IDLE);
    setTxId('');
  };
  
  // Xử lý khi nhập số lượng SOL
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Chỉ cho phép nhập số dương và dấu chấm (số thập phân)
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      // Reset thông báo lỗi và thành công
      setError('');
      setSuccess('');
      setTxStatus(TransactionStatus.IDLE);
      setTxId('');
    }
  };
  
  // Xử lý khi submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsTransferring(true);
    setError('');
    setSuccess('');
    setTxStatus(TransactionStatus.PREPARING);
    setTxId('');
    
    try {
      // Kiểm tra nếu MoonWallet program không khả dụng
      if (!isMoonWalletAvailable) {
        let errorMsg = "Không thể thực hiện giao dịch vì chương trình MoonWallet không tồn tại trên validator.\n";
        errorMsg += `Địa chỉ chương trình: ${programID.toString()}\n\n`;
        errorMsg += `Đảm bảo chạy validator với lệnh:\n`;
        errorMsg += `solana-test-validator --bpf-program ${programID.toString()} path/to/moon_wallet.so`;
        
        throw new Error(errorMsg);
      }
      
      // Kiểm tra đầu vào
      if (!destinationAddress) {
        throw new Error('Vui lòng nhập địa chỉ đích');
      }
      
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Vui lòng nhập số lượng SOL hợp lệ');
      }
      
      // Chuyển đổi số lượng SOL sang lamports
      const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
      
      // Kiểm tra số dư
      if (amountLamports > pdaBalance * LAMPORTS_PER_SOL) {
        throw new Error('Số dư không đủ để thực hiện giao dịch');
      }
      
      // Kiểm tra địa chỉ hợp lệ
      let destinationPublicKey: PublicKey;
      try {
        destinationPublicKey = new PublicKey(destinationAddress);
      } catch (error) {
        throw new Error('Địa chỉ đích không hợp lệ');
      }
      
      // Thêm 1 vào nonce hiện tại
      const nextNonce = nonce + 1;
      
      // Lấy timestamp hiện tại (giây)
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Tạo message chuẩn theo format phía backend yêu cầu:
      // "transfer:{amount}_SOL_to_{destination},nonce:{nonce},timestamp:{timestamp}"
      const formattedAmount = parseFloat(amount).toString(); // Đảm bảo định dạng số không có số 0 thừa
      const messageString = `transfer:${formattedAmount}_SOL_to_${destinationAddress},nonce:${nextNonce},timestamp:${timestamp}`;
      console.log('Message gốc:', messageString);
      
      // Chuyển message thành bytes
      const messageBytes = new TextEncoder().encode(messageString);
      
      console.log('Message bytes (UTF-8):', Array.from(messageBytes));
      console.log('Message bytes (hex):', Array.from(messageBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      
      // Tính hash của message
      const messageHash = await crypto.subtle.digest('SHA-256', messageBytes);
      const messageHashBytes = new Uint8Array(messageHash);
      console.log('Message hash bytes (hex):', Buffer.from(messageHashBytes).toString('hex'));
      console.log('Message hash bytes (array):', Array.from(messageHashBytes));
      
      // Lấy PDA từ credential ID
      const multisigPDA = await getMultisigPDA(credentialId);
      console.log('MultisigPDA:', multisigPDA.toBase58());
      
      // Lấy PDA của guardian
      const guardianPDA = await getGuardianPDA(multisigPDA, guardianId);
      console.log('GuardianPDA:', guardianPDA.toBase58());
      
      // Ký message bằng WebAuthn
      setTxStatus(TransactionStatus.SIGNING);
      
      // Hiển thị thông báo
      console.log('Đang yêu cầu xác thực WebAuthn...');
      setError(''); // Xóa thông báo lỗi trước đó
      setSuccess('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực giao dịch...');
      
      // Sử dụng trực tiếp message gốc làm dữ liệu để ký với WebAuthn
      // WebAuthn sẽ tự động hash dữ liệu này với SHA-256 trước khi ký
      const assertion = await getWebAuthnAssertion(credentialId, messageString, true);
      
      if (!assertion) {
        throw new Error('Lỗi khi ký message bằng WebAuthn hoặc người dùng đã hủy xác thực');
      }
      
      console.log('Đã ký thành công bằng WebAuthn');
      console.log('ClientDataJSON:', new TextDecoder().decode(assertion.clientDataJSON));
      
      // Phân tích clientDataJSON để hiểu cách WebAuthn hash message
      try {
        const clientDataObj = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON));
        console.log('ClientData object:', clientDataObj);
        
        // Lấy challenge từ clientData
        if (clientDataObj.challenge) {
          const challengeBase64 = clientDataObj.challenge;
          // Fix lỗi base64url encoding
          const base64Standard = challengeBase64
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(challengeBase64.length + (4 - challengeBase64.length % 4) % 4, '=');
          const challengeBytes = Buffer.from(base64Standard, 'base64');
          
          console.log('Challenge từ WebAuthn (hex):', challengeBytes.toString('hex'));
        }
      } catch (e) {
        console.error('Lỗi khi phân tích clientDataJSON:', e);
      }
      
      setSuccess(''); // Xóa thông báo thành công tạm thời
      
      // Lấy chữ ký từ WebAuthn assertion và chuyển đổi từ DER sang raw format
      console.log('Signature từ WebAuthn (DER format):', Buffer.from(assertion.signature).toString('hex'));
      console.log('Độ dài signature ban đầu:', assertion.signature.byteLength);
      
      // Chuyển đổi signature từ DER sang raw format (r, s)
      // Sử dụng hàm từ utils/webauthnUtils.ts
      const derToRaw = (derSignature: Uint8Array): Uint8Array => {
        try {
          // Kiểm tra format DER
          if (derSignature[0] !== 0x30) {
            throw new Error('Chữ ký không đúng định dạng DER: byte đầu tiên không phải 0x30');
          }
          
          // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
          const rLength = derSignature[3];
          const rStart = 4;
          const rEnd = rStart + rLength;
          
          const sLength = derSignature[rEnd + 1];
          const sStart = rEnd + 2;
          const sEnd = sStart + sLength;
          
          // Trích xuất r và s
          let r = derSignature.slice(rStart, rEnd);
          let s = derSignature.slice(sStart, sEnd);
          
          console.log('DER r length:', r.length, 'r (hex):', Buffer.from(r).toString('hex'));
          console.log('DER s length:', s.length, 's (hex):', Buffer.from(s).toString('hex'));
          
          // Chuẩn bị r và s cho định dạng raw (mỗi phần 32 bytes)
          const rPadded = new Uint8Array(32);
          const sPadded = new Uint8Array(32);
          
          if (r.length <= 32) {
            // Trường hợp r ngắn hơn 32 bytes, thêm padding
            rPadded.set(r, 32 - r.length);
          } else {
            // Trường hợp r dài hơn 32 bytes (thường là có byte 0x00 ở đầu), lấy 32 bytes cuối
            rPadded.set(r.slice(r.length - 32));
          }
          
          if (s.length <= 32) {
            // Trường hợp s ngắn hơn 32 bytes, thêm padding
            sPadded.set(s, 32 - s.length);
          } else {
            // Trường hợp s dài hơn 32 bytes, lấy 32 bytes cuối
            sPadded.set(s.slice(s.length - 32));
          }
          
          // Nối r và s lại
          const rawSignature = new Uint8Array(64);
          rawSignature.set(rPadded);
          rawSignature.set(sPadded, 32);
          
          console.log('Raw signature sau khi chuyển đổi (r||s):');
          console.log('- Length:', rawSignature.length);
          console.log('- Hex:', Buffer.from(rawSignature).toString('hex'));
          
          return rawSignature;
        } catch (e) {
          console.error('Lỗi khi chuyển đổi DER sang raw:', e);
          throw e;
        }
      };
      
      const rawSignature = derToRaw(assertion.signature);
      const signature = Buffer.from(rawSignature);
      
      console.log('Signature sau khi chuyển đổi (raw format):', signature.toString('hex'));
      console.log('Độ dài signature sau khi chuyển đổi:', signature.length);
      
      // Thêm bước chuẩn hóa signature về dạng Low-S
      const normalizedSignature = normalizeSignatureToLowS(signature);
      console.log("Signature sau khi chuẩn hóa (Low-S format):", normalizedSignature.toString("hex"));
      
      // LẤY WEBAUTHN PUBLIC KEY TỪ FIREBASE
      console.log('Lấy WebAuthn public key từ Firebase...');
      const credentialMapping = await getWalletByCredentialId(credentialId);
      
      if (!credentialMapping || !credentialMapping.guardianPublicKey || credentialMapping.guardianPublicKey.length === 0) {
        // Thử tìm trong localStorage nếu không có trong Firebase
        console.log('Không tìm thấy trong Firebase, thử tìm trong localStorage...');
        try {
          const localStorageData = localStorage.getItem('webauthn_credential_' + credentialId);
          if (localStorageData) {
            const localMapping = JSON.parse(localStorageData);
            if (localMapping && localMapping.guardianPublicKey && localMapping.guardianPublicKey.length > 0) {
              console.log('Đã tìm thấy WebAuthn public key trong localStorage:', localMapping);
              
              // Tạo webAuthnPubKey từ dữ liệu trong localStorage
              const webAuthnPubKey = Buffer.from(new Uint8Array(localMapping.guardianPublicKey));
              
              // Kiểm tra độ dài
              if (webAuthnPubKey.length !== 33) {
                console.warn(`WebAuthn public key từ localStorage có độ dài không đúng: ${webAuthnPubKey.length} bytes, cần 33 bytes`);
              }
              
              // Tạo instruction secp256r1
              setTxStatus(TransactionStatus.BUILDING_TX);
              
              // Quan trọng: Đảm bảo message được sử dụng ở đây là đúng
              // Sử dụng message gốc từ messageString để hash lại
              const messageBytes = new TextEncoder().encode(messageString);
              const messageHash = await crypto.subtle.digest('SHA-256', messageBytes);
              const messageHashBuffer = Buffer.from(new Uint8Array(messageHash));
              
              console.log('Message gốc:', messageString);
              console.log('Message hash (SHA-256):', messageHashBuffer.toString('hex'));
              
              // Tạo instruction cho secp256r1
              const secp256r1Ix = createSecp256r1Instruction(
                messageHashBuffer, // Sử dụng hash của message
                webAuthnPubKey, // publicKey
                normalizedSignature, // signature đã chuẩn hóa
                true // Thử đảo ngược public key
              );
              
              console.log("Secp256r1 instruction data:", {
                programId: secp256r1Ix.programId.toString(),
                dataLength: secp256r1Ix.data.length,
                dataHex: Buffer.from(secp256r1Ix.data).toString('hex').substring(0, 60) + '...',
                pubkeyLength: webAuthnPubKey.length,
                signatureLength: normalizedSignature.length,
                messageLength: messageHashBuffer.length
              });
              
              // Tạo ví tạm để trả phí giao dịch
              const feePayer = web3.Keypair.generate();
              
              // Xin SOL airdrop để trả phí
              try {
                const airdropSignature = await connection.requestAirdrop(
                  feePayer.publicKey,
                  web3.LAMPORTS_PER_SOL / 50 // 0.02 SOL để trả phí
                );
                await connection.confirmTransaction(airdropSignature);
                
                // Kiểm tra số dư sau khi airdrop
                const feePayerBalance = await connection.getBalance(feePayer.publicKey);
                console.log(`Fee payer balance: ${feePayerBalance / LAMPORTS_PER_SOL} SOL`);
                
                if (feePayerBalance === 0) {
                  throw new Error('Không thể airdrop SOL cho fee payer');
                }
              } catch (airdropError) {
                console.warn('Không thể airdrop SOL để trả phí:', airdropError);
                // Tiếp tục thực hiện vì có thể account đã có sẵn SOL
              }
              
              // Tiếp tục quá trình xử lý transaction như bình thường
              const transferTx = createTransferTx(
                multisigPDA,
                guardianPDA,
                destinationPublicKey,
                amountLamports,
                nextNonce,
                timestamp,
                Buffer.from(messageHashBuffer), // Sử dụng hash đã tính toán
                feePayer.publicKey
              );
              
              // QUAN TRỌNG: Đặt secp256r1 instruction là ix đầu tiên (phải đứng trước verify_and_execute)
              transferTx.instructions.unshift(secp256r1Ix);
              
              // Đặt fee payer và blockhash
              transferTx.feePayer = feePayer.publicKey;
              const { blockhash } = await connection.getLatestBlockhash();
              transferTx.recentBlockhash = blockhash;
              
              // Ký transaction bằng fee payer
              transferTx.sign(feePayer);
              
              // Log transaction để debug
              console.log("Transaction info:", {
                feePayer: feePayer.publicKey.toString(),
                instructions: transferTx.instructions.map(ix => ({
                  programId: ix.programId.toString(),
                  keys: ix.keys.map(k => ({
                    pubkey: k.pubkey.toString(),
                    isSigner: k.isSigner,
                    isWritable: k.isWritable
                  })),
                  dataSize: ix.data.length
                }))
              });
              
              // Gửi transaction
              setTxStatus(TransactionStatus.SUBMITTING);
              
              try {
                console.log('Sending transaction with secp256r1 instruction...');
                console.log('Skip preflight:', true);
                
                const transactionId = await connection.sendRawTransaction(transferTx.serialize(), {
                  skipPreflight: true, // Bỏ qua preflight để tránh lỗi với instruction phức tạp
                  preflightCommitment: 'confirmed'
                });
                
                console.log('Transaction đã được gửi với ID:', transactionId);
                
                setTxId(transactionId);
                console.log('Transaction ID:', transactionId);
                
                // Chờ xác nhận
                setTxStatus(TransactionStatus.CONFIRMING);
                
                const confirmation = await connection.confirmTransaction(transactionId, 'confirmed');
                
                if (confirmation.value.err) {
                  throw new Error(`Lỗi khi xác nhận giao dịch: ${JSON.stringify(confirmation.value.err)}`);
                }
                
                // Hiển thị thông báo thành công
                setTxStatus(TransactionStatus.SUCCESS);
                setSuccess(`Đã chuyển ${amount} SOL đến ${destinationAddress} thành công! ID giao dịch: ${transactionId}`);
                setAmount('');
                setDestinationAddress('');
                
                // Gọi callback nếu có
                if (onTransferSuccess) {
                  onTransferSuccess();
                }
                
                return; // Không tiếp tục chạy code bên dưới
              } catch (sendError: any) {
                // Xử lý lỗi SendTransactionError
                if (sendError instanceof SendTransactionError) {
                  console.error("Transaction simulation failed:", sendError);
                  console.error("Error details:", sendError.message);
                  
                  if (sendError.logs) {
                    console.error("Transaction logs:", sendError.logs);
                  }
                  
                  // Cố gắng lấy logs chi tiết
                  let logs = "";
                  try {
                    if (sendError.logs && Array.isArray(sendError.logs)) {
                      logs = sendError.logs.join('\n');
                    } else {
                      logs = "Không có logs chi tiết.";
                    }
                  } catch (logError) {
                    logs = "Không thể lấy logs chi tiết.";
                  }
                  
                  // Phân tích lỗi để đưa ra hướng dẫn cụ thể
                  let errorMessage = `Lỗi khi gửi giao dịch: ${sendError.message}\n\n`;
                  
                  if (logs.includes("Attempt to load a program that does not exist")) {
                    // Xử lý lỗi chương trình không tồn tại
                    if (logs.includes(programID.toString())) {
                      errorMessage += `Chương trình MoonWallet chưa được cài đặt trên validator.\n`;
                      errorMessage += `Địa chỉ chương trình: ${programID.toString()}\n\n`;
                      errorMessage += `Hãy cài đặt chương trình với lệnh:\n`;
                      errorMessage += `solana-test-validator --bpf-program ${programID.toString()} path/to/moon_wallet.so`;
                    } else if (logs.includes(SECP256R1_PROGRAM_ID.toString())) {
                      errorMessage += `Chương trình Secp256r1 chưa được cài đặt trên validator.\n`;
                      errorMessage += `Địa chỉ chương trình: ${SECP256R1_PROGRAM_ID.toString()}\n\n`;
                      errorMessage += `Hãy cài đặt chương trình với lệnh:\n`;
                      errorMessage += `solana-test-validator --bpf-program ${SECP256R1_PROGRAM_ID.toString()} path/to/secp256r1_verify.so`;
                    } else {
                      errorMessage += `Một chương trình cần thiết không tồn tại trên validator.\n\n`;
                      errorMessage += `Chi tiết lỗi: ${logs}\n\n`;
                      errorMessage += `Thông tin kết nối:\n`;
                      errorMessage += `- Endpoint validator: ${connectionEndpoint}\n`;
                    }
                  } else {
                    // Lỗi khác
                    errorMessage += `Chi tiết lỗi: ${logs}\n\n`;
                    errorMessage += `Thông tin kết nối:\n`;
                    errorMessage += `- Endpoint validator: ${connectionEndpoint}\n`;
                    errorMessage += `- MoonWallet Program: ${isMoonWalletAvailable ? '✅ Đã cài đặt' : '❌ Chưa cài đặt'} (${programID.toString()})`;
                  }
                  
                  throw new Error(errorMessage);
                } else {
                  throw sendError;
                }
              }
            }
          }
        } catch (localStorageError) {
          console.error('Lỗi khi đọc từ localStorage:', localStorageError);
        }
        
        // Nếu không tìm thấy trong localStorage, thử lấy từ account data
        console.warn('Không tìm thấy WebAuthn public key trong localStorage, thử lấy từ guardian account...');
        
        // Lấy dữ liệu tài khoản guardian để lấy public key
      const guardianAccount = await connection.getAccountInfo(guardianPDA);
      
      if (!guardianAccount) {
        throw new Error('Không thể tìm thấy thông tin guardian');
      }
      
        // Lấy WebAuthn public key từ guardian account
        // Giả sử webauthn_pubkey nằm ở vị trí phù hợp trong account data
        // Offset phụ thuộc vào layout của Anchor account
        // NOTE: Đây là ví dụ, offset thực tế cần được xác định chính xác dựa trên layout của account
        // +8 (discriminator) + 32 (wallet) + 8 (guardian_id) + nameLen + 1 (is_active) + 32 (recovery_hash) + 1 (is_owner) = ~82
        // webauthn_pubkey là Option<[u8; 33]> nên có thêm 1 byte đánh dấu Some(1) hoặc None(0)
        
        let webAuthnPubKey: Buffer; 
        // Giả định cho mục đích demo - trong thực tế bạn cần đọc đúng vị trí
        if (guardianAccount.data.length > 100) {
          const hasWebAuthnPubKey = guardianAccount.data[83] === 1; // 1 = Some, 0 = None
          if (hasWebAuthnPubKey) {
            webAuthnPubKey = Buffer.from(guardianAccount.data.slice(84, 84 + 33));
          } else {
            throw new Error('Guardian không có WebAuthn public key trong account data');
          }
        } else {
          // Nếu không thể đọc được dữ liệu, báo lỗi
          throw new Error('Không thể đọc được public key từ guardian account (dữ liệu quá ngắn)');
        }
      } else {
        // Sử dụng WebAuthn public key từ Firebase
        console.log('Đã tìm thấy WebAuthn public key trong Firebase:', credentialMapping.guardianPublicKey);
        // Chuyển đổi từ mảng số về Buffer
        const webAuthnPubKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey));
        
        // Kiểm tra độ dài khóa
        if (webAuthnPubKey.length !== 33) {
          console.warn(`WebAuthn public key từ Firebase có độ dài không đúng: ${webAuthnPubKey.length} bytes, cần 33 bytes`);
        }
      
      // Tạo instruction secp256r1
      setTxStatus(TransactionStatus.BUILDING_TX);
      
        // Thêm tham số để thử với public key bị đảo
      const secp256r1Ix = createSecp256r1Instruction(
        Buffer.from(messageHashBytes), // Sử dụng hash của message thay vì message gốc
        webAuthnPubKey, // publicKey
        normalizedSignature, // signature đã chuẩn hóa
        true // Đảo ngược public key để thử
      );
      
        console.log("Secp256r1 instruction data:", {
          programId: secp256r1Ix.programId.toString(),
          dataLength: secp256r1Ix.data.length,
          dataHex: Buffer.from(secp256r1Ix.data).toString('hex').substring(0, 60) + '...',
          pubkeyLength: webAuthnPubKey.length,
          signatureLength: normalizedSignature.length,
          messageLength: messageHashBytes.length
        });
        
        // Tạo ví tạm để trả phí giao dịch
      const feePayer = web3.Keypair.generate();
      
      // Xin SOL airdrop để trả phí
        try {
      const airdropSignature = await connection.requestAirdrop(
        feePayer.publicKey,
            web3.LAMPORTS_PER_SOL / 50 // 0.02 SOL để trả phí
      );
      await connection.confirmTransaction(airdropSignature);
      
          // Kiểm tra số dư sau khi airdrop
          const feePayerBalance = await connection.getBalance(feePayer.publicKey);
          console.log(`Fee payer balance: ${feePayerBalance / LAMPORTS_PER_SOL} SOL`);
          
          if (feePayerBalance === 0) {
            throw new Error('Không thể airdrop SOL cho fee payer');
          }
        } catch (airdropError) {
          console.warn('Không thể airdrop SOL để trả phí:', airdropError);
          // Tiếp tục thực hiện vì có thể account đã có sẵn SOL
        }
        
        // Tạo transaction với verify_and_execute instruction
      const transferTx = createTransferTx(
        multisigPDA,
        guardianPDA,
        destinationPublicKey,
        amountLamports,
        nextNonce,
        timestamp,
          Buffer.from(messageHashBytes), // Sử dụng messageHashBytes (message gốc, chưa hash) cho verify_and_execute
        feePayer.publicKey
      );
      
        // Đặt secp256r1 instruction là ix đầu tiên (phải đứng trước verify_and_execute)
        transferTx.instructions.unshift(secp256r1Ix);
      
      // Đặt fee payer và blockhash
      transferTx.feePayer = feePayer.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      transferTx.recentBlockhash = blockhash;
      
      // Ký transaction bằng fee payer
      transferTx.sign(feePayer);
        
        // Log transaction để debug
        console.log("Transaction info:", {
          feePayer: feePayer.publicKey.toString(),
          instructions: transferTx.instructions.map(ix => ({
            programId: ix.programId.toString(),
            keys: ix.keys.map(k => ({
              pubkey: k.pubkey.toString(),
              isSigner: k.isSigner,
              isWritable: k.isWritable
            })),
            dataSize: ix.data.length
          }))
        });
      
      // Gửi transaction
      setTxStatus(TransactionStatus.SUBMITTING);
      
        try {
          const transactionId = await connection.sendRawTransaction(transferTx.serialize(), {
            skipPreflight: true, // Bỏ qua preflight để tránh lỗi với instruction phức tạp
            preflightCommitment: 'confirmed'
          });
          
          console.log('Transaction đã được gửi với ID:', transactionId);
          
      setTxId(transactionId);
      console.log('Transaction ID:', transactionId);
      
      // Chờ xác nhận
      setTxStatus(TransactionStatus.CONFIRMING);
      
          const confirmation = await connection.confirmTransaction(transactionId, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Lỗi khi xác nhận giao dịch: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      // Hiển thị thông báo thành công
      setTxStatus(TransactionStatus.SUCCESS);
      setSuccess(`Đã chuyển ${amount} SOL đến ${destinationAddress} thành công! ID giao dịch: ${transactionId}`);
      setAmount('');
      setDestinationAddress('');
      
      // Gọi callback nếu có
      if (onTransferSuccess) {
        onTransferSuccess();
          }
        } catch (sendError: any) {
          // Xử lý lỗi SendTransactionError
          if (sendError instanceof SendTransactionError) {
            console.error("Transaction simulation failed:", sendError);
            console.error("Error details:", sendError.message);
            
            if (sendError.logs) {
              console.error("Transaction logs:", sendError.logs);
            }
            
            // Cố gắng lấy logs chi tiết
            let logs = "";
            try {
              if (sendError.logs && Array.isArray(sendError.logs)) {
                logs = sendError.logs.join('\n');
              } else {
                logs = "Không có logs chi tiết.";
              }
            } catch (logError) {
              logs = "Không thể lấy logs chi tiết.";
            }
            
            // Phân tích lỗi để đưa ra hướng dẫn cụ thể
            let errorMessage = `Lỗi khi gửi giao dịch: ${sendError.message}\n\n`;
            
            if (logs.includes("Attempt to load a program that does not exist")) {
              // Xử lý lỗi chương trình không tồn tại
              if (logs.includes(programID.toString())) {
                errorMessage += `Chương trình MoonWallet chưa được cài đặt trên validator.\n`;
                errorMessage += `Địa chỉ chương trình: ${programID.toString()}\n\n`;
                errorMessage += `Hãy cài đặt chương trình với lệnh:\n`;
                errorMessage += `solana-test-validator --bpf-program ${programID.toString()} path/to/moon_wallet.so`;
              } else if (logs.includes(SECP256R1_PROGRAM_ID.toString())) {
                errorMessage += `Chương trình Secp256r1 chưa được cài đặt trên validator.\n`;
                errorMessage += `Địa chỉ chương trình: ${SECP256R1_PROGRAM_ID.toString()}\n\n`;
                errorMessage += `Hãy cài đặt chương trình với lệnh:\n`;
                errorMessage += `solana-test-validator --bpf-program ${SECP256R1_PROGRAM_ID.toString()} path/to/secp256r1_verify.so`;
              } else {
                errorMessage += `Một chương trình cần thiết không tồn tại trên validator.\n\n`;
                errorMessage += `Chi tiết lỗi: ${logs}\n\n`;
                errorMessage += `Thông tin kết nối:\n`;
                errorMessage += `- Endpoint validator: ${connectionEndpoint}\n`;
              }
            } else {
              // Lỗi khác
              errorMessage += `Chi tiết lỗi: ${logs}\n\n`;
              errorMessage += `Thông tin kết nối:\n`;
              errorMessage += `- Endpoint validator: ${connectionEndpoint}\n`;
              errorMessage += `- MoonWallet Program: ${isMoonWalletAvailable ? '✅ Đã cài đặt' : '❌ Chưa cài đặt'} (${programID.toString()})`;
            }
            
            throw new Error(errorMessage);
          } else {
            throw sendError;
          }
        }
      }
    } catch (error: any) {
      console.error('Lỗi khi chuyển tiền:', error);
      setError(error.message || 'Đã xảy ra lỗi khi chuyển tiền');
      setTxStatus(TransactionStatus.ERROR);
      
      // Gọi callback lỗi nếu có
      if (onTransferError) {
        onTransferError(error);
      }
    } finally {
      setIsTransferring(false);
    }
  };
  
  // Hàm chỉ xác minh chữ ký, không thực hiện chuyển tiền
  const handleVerifySignatureOnly = async () => {
    setVerificationStatus(VerificationStatus.VERIFYING);
    setVerificationMessage('');
    
    try {
      // Kiểm tra nếu MoonWallet program không khả dụng
      if (!isMoonWalletAvailable) {
        throw new Error("Chương trình MoonWallet không tồn tại trên validator");
      }
      
      // Tạo message mẫu để xác minh (có thể thay đổi theo yêu cầu)
      const testMessage = `Test message for signature verification,timestamp:${Math.floor(Date.now() / 1000)}`;
      console.log('Message gốc:', testMessage);
      
      // Chuyển message thành bytes
      const messageBytes = new TextEncoder().encode(testMessage);
      
      console.log('Message bytes (UTF-8):', Array.from(messageBytes));
      console.log('Message bytes (hex):', Array.from(messageBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      
      // Tính hash của message
      const messageHash = await crypto.subtle.digest('SHA-256', messageBytes);
      const messageHashBytes = new Uint8Array(messageHash);
      console.log('Message hash bytes (hex):', Buffer.from(messageHashBytes).toString('hex'));
      console.log('Message hash bytes (array):', Array.from(messageHashBytes));
      
      // Hiển thị thông báo
      console.log('Đang yêu cầu xác thực WebAuthn...');
      setVerificationMessage('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực...');
      
      // Sử dụng trực tiếp message gốc làm dữ liệu để ký với WebAuthn
      const assertion = await getWebAuthnAssertion(credentialId, testMessage, true);
      
      if (!assertion) {
        throw new Error('Lỗi khi ký message bằng WebAuthn hoặc người dùng đã hủy xác thực');
      }
      
      console.log('Đã ký thành công bằng WebAuthn');
      console.log('ClientDataJSON:', new TextDecoder().decode(assertion.clientDataJSON));
      
      // Phân tích clientDataJSON
      const clientDataObj = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON));
      console.log('ClientData object:', clientDataObj);
      
      // Lấy chữ ký từ WebAuthn assertion và chuyển đổi từ DER sang raw format
      console.log('Signature từ WebAuthn (DER format):', Buffer.from(assertion.signature).toString('hex'));
      
      // Chuyển đổi signature từ DER sang raw format (r, s)
      const derToRaw = (derSignature: Uint8Array): Uint8Array => {
        try {
          // Kiểm tra format DER
          if (derSignature[0] !== 0x30) {
            throw new Error('Chữ ký không đúng định dạng DER: byte đầu tiên không phải 0x30');
          }
          
          // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
          const rLength = derSignature[3];
          const rStart = 4;
          const rEnd = rStart + rLength;
          
          const sLength = derSignature[rEnd + 1];
          const sStart = rEnd + 2;
          const sEnd = sStart + sLength;
          
          // Trích xuất r và s
          let r = derSignature.slice(rStart, rEnd);
          let s = derSignature.slice(sStart, sEnd);
          
          console.log('DER r length:', r.length, 'r (hex):', Buffer.from(r).toString('hex'));
          console.log('DER s length:', s.length, 's (hex):', Buffer.from(s).toString('hex'));
          
          // Chuẩn bị r và s cho định dạng raw (mỗi phần 32 bytes)
          const rPadded = new Uint8Array(32);
          const sPadded = new Uint8Array(32);
          
          if (r.length <= 32) {
            // Trường hợp r ngắn hơn 32 bytes, thêm padding
            rPadded.set(r, 32 - r.length);
          } else {
            // Trường hợp r dài hơn 32 bytes (thường là có byte 0x00 ở đầu), lấy 32 bytes cuối
            rPadded.set(r.slice(r.length - 32));
          }
          
          if (s.length <= 32) {
            // Trường hợp s ngắn hơn 32 bytes, thêm padding
            sPadded.set(s, 32 - s.length);
          } else {
            // Trường hợp s dài hơn 32 bytes, lấy 32 bytes cuối
            sPadded.set(s.slice(s.length - 32));
          }
          
          // Nối r và s lại
          const rawSignature = new Uint8Array(64);
          rawSignature.set(rPadded);
          rawSignature.set(sPadded, 32);
          
          console.log('Raw signature sau khi chuyển đổi (r||s):');
          console.log('- Length:', rawSignature.length);
          console.log('- Hex:', Buffer.from(rawSignature).toString('hex'));
          
          return rawSignature;
        } catch (e) {
          console.error('Lỗi khi chuyển đổi DER sang raw:', e);
          throw e;
        }
      };
      
      const rawSignature = derToRaw(assertion.signature);
      const signature = Buffer.from(rawSignature);
      
      console.log('Signature sau khi chuyển đổi (raw format):', signature.toString('hex'));
      
      // Chuẩn hóa signature về dạng Low-S
      const normalizedSignature = normalizeSignatureToLowS(signature);
      console.log("Signature sau khi chuẩn hóa (Low-S format):", normalizedSignature.toString("hex"));
      
      // LẤY WEBAUTHN PUBLIC KEY
      console.log('Lấy WebAuthn public key...');
      const credentialMapping = await getWalletByCredentialId(credentialId);
      
      let webAuthnPubKey: Buffer;
      
      if (!credentialMapping || !credentialMapping.guardianPublicKey || credentialMapping.guardianPublicKey.length === 0) {
        // Thử tìm trong localStorage
        console.log('Không tìm thấy trong Firebase, thử tìm trong localStorage...');
        const localStorageData = localStorage.getItem('webauthn_credential_' + credentialId);
        if (localStorageData) {
          const localMapping = JSON.parse(localStorageData);
          if (localMapping && localMapping.guardianPublicKey && localMapping.guardianPublicKey.length > 0) {
            webAuthnPubKey = Buffer.from(new Uint8Array(localMapping.guardianPublicKey));
          } else {
            throw new Error('Không tìm thấy WebAuthn public key trong localStorage');
          }
        } else {
          throw new Error('Không tìm thấy WebAuthn public key');
        }
      } else {
        // Sử dụng WebAuthn public key từ Firebase
        webAuthnPubKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey));
      }
      
      // Kiểm tra độ dài khóa
      if (webAuthnPubKey.length !== 33) {
        console.warn(`WebAuthn public key có độ dài không đúng: ${webAuthnPubKey.length} bytes, cần 33 bytes`);
      }
      
      // ĐÚNG QUY TRÌNH XÁC MINH WEBAUTHN:
      // 1. Tính hash của clientDataJSON
      const clientDataHash = await crypto.subtle.digest('SHA-256', assertion.clientDataJSON);
      const clientDataHashBytes = new Uint8Array(clientDataHash);
      console.log('clientDataJSON hash:', Buffer.from(clientDataHashBytes).toString('hex'));
      
      // 2. Tạo verification data đúng cách: authenticatorData + hash(clientDataJSON)
      const verificationData = new Uint8Array(assertion.authenticatorData.length + clientDataHashBytes.length);
      verificationData.set(new Uint8Array(assertion.authenticatorData), 0);
      verificationData.set(clientDataHashBytes, assertion.authenticatorData.length);
      
      console.log('Verification data length:', verificationData.length);
      console.log('Verification data (hex):', Buffer.from(verificationData).toString('hex'));
      
      // Tạo ví tạm để trả phí giao dịch
      const feePayer = web3.Keypair.generate();
      
      // Xin SOL airdrop để trả phí
      try {
        const airdropSignature = await connection.requestAirdrop(
          feePayer.publicKey,
          web3.LAMPORTS_PER_SOL / 50 // 0.02 SOL để trả phí
        );
        await connection.confirmTransaction(airdropSignature);
      } catch (airdropError) {
        console.warn('Không thể airdrop SOL để trả phí:', airdropError);
        // Tiếp tục thực hiện vì có thể account đã có sẵn SOL
      }
      
      // Thử cả hai cách: đảo và không đảo byte đầu tiên của public key
      const verificationDataBuffer = Buffer.from(verificationData);
      
      // Cách 1: Không đảo byte đầu tiên
      try {
        console.log("Thử xác minh với public key không đảo ngược...");
        
        const secp256r1Ix1 = createSecp256r1Instruction(
          verificationDataBuffer,
          webAuthnPubKey,
          normalizedSignature,
          false // Không đảo ngược public key
        );
        
        const transaction1 = new Transaction().add(secp256r1Ix1);
        transaction1.feePayer = feePayer.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        transaction1.recentBlockhash = blockhash;
        transaction1.sign(feePayer);
        
        console.log("Gửi transaction với public key không đảo ngược...");
        const txid1 = await connection.sendRawTransaction(transaction1.serialize(), {
          skipPreflight: true,
          preflightCommitment: 'confirmed'
        });
        
        console.log('Transaction xác minh chữ ký đã được gửi với ID:', txid1);
        
        const confirmation1 = await connection.confirmTransaction(txid1, 'confirmed');
        if (confirmation1.value.err) {
          console.error("Lỗi khi xác minh với public key không đảo ngược:", confirmation1.value.err);
          throw new Error(`Lỗi: ${JSON.stringify(confirmation1.value.err)}`);
        } else {
          console.log("XÁC MINH THÀNH CÔNG với public key không đảo ngược!");
          setVerificationStatus(VerificationStatus.SUCCESS);
          setVerificationMessage(`Xác minh chữ ký thành công! ID giao dịch: ${txid1}`);
          return;
        }
      } catch (error1) {
        console.error("Lỗi khi xác minh với public key không đảo ngược:", error1);
        
        // Cách 2: Đảo byte đầu tiên
        try {
          console.log("Thử xác minh với public key đảo ngược...");
          
          const secp256r1Ix2 = createSecp256r1Instruction(
            verificationDataBuffer,
            webAuthnPubKey,
            normalizedSignature,
            true // Đảo ngược public key
          );
          
          const transaction2 = new Transaction().add(secp256r1Ix2);
          transaction2.feePayer = feePayer.publicKey;
          const { blockhash } = await connection.getLatestBlockhash();
          transaction2.recentBlockhash = blockhash;
          transaction2.sign(feePayer);
          
          console.log("Gửi transaction với public key đảo ngược...");
          const txid2 = await connection.sendRawTransaction(transaction2.serialize(), {
            skipPreflight: true,
            preflightCommitment: 'confirmed'
          });
          
          console.log('Transaction xác minh chữ ký đã được gửi với ID:', txid2);
          
          const confirmation2 = await connection.confirmTransaction(txid2, 'confirmed');
          if (confirmation2.value.err) {
            console.error("Lỗi khi xác minh với public key đảo ngược:", confirmation2.value.err);
            throw new Error(`Lỗi: ${JSON.stringify(confirmation2.value.err)}`);
          } else {
            console.log("XÁC MINH THÀNH CÔNG với public key đảo ngược!");
            setVerificationStatus(VerificationStatus.SUCCESS);
            setVerificationMessage(`Xác minh chữ ký thành công! ID giao dịch: ${txid2}`);
            return;
          }
        } catch (error2) {
          console.error("Lỗi khi xác minh với public key đảo ngược:", error2);
          throw new Error('Không thể xác minh chữ ký với cả hai cách: đảo và không đảo public key');
        }
      }
    } catch (error: any) {
      console.error('Lỗi khi xác minh chữ ký:', error);
      setVerificationStatus(VerificationStatus.ERROR);
      setVerificationMessage(error.message || 'Đã xảy ra lỗi khi xác minh chữ ký');
    }
  };
  
  // Render status message dựa trên txStatus
  const renderStatusMessage = () => {
    switch (txStatus) {
      case TransactionStatus.PREPARING:
        return 'Đang chuẩn bị giao dịch...';
      case TransactionStatus.SIGNING:
        return 'Vui lòng xác thực bằng WebAuthn (vân tay hoặc Face ID) khi được yêu cầu...';
      case TransactionStatus.BUILDING_TX:
        return 'Đang xây dựng giao dịch...';
      case TransactionStatus.SUBMITTING:
        return 'Đang gửi giao dịch lên blockchain...';
      case TransactionStatus.CONFIRMING:
        return 'Đang chờ xác nhận giao dịch...';
      case TransactionStatus.SUCCESS:
        return 'Giao dịch thành công!';
      case TransactionStatus.ERROR:
        return 'Giao dịch thất bại!';
      default:
        return '';
    }
  };
  
  // Hiển thị ghi chú về validator cục bộ
  const renderValidatorNote = () => {
    if (connectionEndpoint.includes('localhost') || connectionEndpoint.includes('127.0.0.1')) {
      return (
        <div className="info-note">
          <p><strong>Lưu ý:</strong> Bạn đang kết nối đến validator cục bộ.</p>
          <p>Cần khởi động validator với các tham số đúng để cài đặt chương trình MoonWallet:</p>
          <pre>
            solana-test-validator --bpf-program {programID.toString()} path/to/moon_wallet.so
          </pre>
        </div>
      );
    }
    return null;
  };
  
  // Thêm các hàm tiện ích
  const findMultisigPDA = async () => {
    const credentialId = localStorage.getItem('currentCredentialId');
    if (!credentialId) {
      throw new Error("Không tìm thấy credential ID");
    }
    return getMultisigPDA(credentialId);
  };

  const findGuardianPDA = async (multisigPDA: PublicKey, guardianId: number) => {
    return getGuardianPDA(multisigPDA, guardianId);
  };

  // Hàm chuyển đổi base64Url thành Buffer
  const base64UrlToBuffer = (base64Url: string): ArrayBuffer => {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };
  
  return (
    <div className="transfer-form">
      <h2>Chuyển SOL</h2>
      
      <div className="wallet-info">
        <p>Kết nối đến: <strong>{connectionEndpoint}</strong></p>
        <p>Số dư hiện tại: <strong>{pdaBalance.toFixed(5)} SOL</strong></p>
        
        {/* Hiển thị trạng thái MoonWallet program */}
        <div className={!isMoonWalletAvailable ? "warning-message" : "info-message"}>
          <p><strong>Trạng thái chương trình:</strong></p>
          <ul>
            <li>
              <span className={isMoonWalletAvailable ? "status-ok" : "status-error"}>
                {isMoonWalletAvailable ? '✅' : '❌'}
              </span> 
              MoonWallet: <code>{programID.toString()}</code>
            </li>
          </ul>
          
          {renderValidatorNote()}
          
          {!isMoonWalletAvailable && (
            <div>
              <p><strong>Lưu ý:</strong> Chương trình MoonWallet chưa được cài đặt trên validator.</p>
              <p>Để cài đặt, chạy validator với lệnh:</p>
              <pre>
                solana-test-validator --bpf-program {programID.toString()} path/to/moon_wallet.so
              </pre>
            </div>
          )}
        </div>
      </div>
      
      {/* Thêm nút "Chỉ xác minh chữ ký" */}
      <div className="verify-signature-section">
        <h3>Xác minh chữ ký</h3>
        <p>Kiểm tra xem WebAuthn của bạn có hoạt động đúng trước khi thực hiện giao dịch.</p>
        
        {verificationStatus !== VerificationStatus.IDLE && (
          <div className={
            verificationStatus === VerificationStatus.SUCCESS ? "success-message" : 
            verificationStatus === VerificationStatus.ERROR ? "error-message" : 
            "status-message"
          }>
            {verificationMessage}
          </div>
        )}
        
        <button 
          type="button" 
          className="secondary-button" 
          onClick={handleVerifySignatureOnly}
          disabled={verificationStatus === VerificationStatus.VERIFYING || !isMoonWalletAvailable}
        >
          {verificationStatus === VerificationStatus.VERIFYING ? 'Đang xác minh...' : 'Chỉ xác minh chữ ký'}
        </button>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="destination">Địa chỉ đích:</label>
          <input
            type="text"
            id="destination"
            value={destinationAddress}
            onChange={handleDestinationChange}
            placeholder="Nhập địa chỉ Solana"
            disabled={isTransferring}
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="amount">Số lượng SOL:</label>
          <input
            type="text"
            id="amount"
            value={amount}
            onChange={handleAmountChange}
            placeholder="Ví dụ: 0.1"
            disabled={isTransferring}
            required
          />
        </div>
        
        {success && <div className="success-message">{success}</div>}
        {error && <div className="error-message">{error}</div>}
        
        {txStatus !== TransactionStatus.IDLE && (
          <div className="status-message">
            <p>{renderStatusMessage()}</p>
            {txStatus === TransactionStatus.CONFIRMING && (
              <div className="loading-indicator">Đang xác nhận...</div>
            )}
            {txId && (
              <p className="transaction-id">
                ID Giao dịch: <a href={`https://explorer.solana.com/tx/${txId}`} target="_blank" rel="noopener noreferrer">{txId.slice(0, 8)}...{txId.slice(-8)}</a>
              </p>
            )}
          </div>
        )}
        
        <button 
          type="submit" 
          className="primary-button" 
          disabled={isTransferring || !isMoonWalletAvailable}
        >
          {isTransferring ? 'Đang xử lý...' : 'Chuyển SOL'}
        </button>
      </form>
      
      <style>
        {`
          .success-message, .error-message, .warning-message, .info-message {
            margin: 12px 0;
            padding: 10px;
            border-radius: 4px;
            font-weight: 500;
          }
          
          .success-message {
            background-color: rgba(0, 200, 83, 0.1);
            color: #00C853;
            border: 1px solid #00C853;
          }
          
          .error-message {
            background-color: rgba(255, 87, 34, 0.1);
            color: #FF5722;
            border: 1px solid #FF5722;
          }
          
          .warning-message {
            background-color: rgba(255, 152, 0, 0.1);
            color: #FF9800;
            border: 1px solid #FF9800;
          }
          
          .info-message {
            background-color: rgba(33, 150, 243, 0.1);
            color: #333;
            border: 1px solid #2196F3;
          }
          
          .status-message {
            margin: 12px 0;
            padding: 10px;
            background-color: rgba(33, 150, 243, 0.1);
            border: 1px solid #2196F3;
            border-radius: 4px;
            color: #2196F3;
          }
          
          .loading-indicator {
            margin-top: 8px;
            font-style: italic;
          }
          
          .transaction-id {
            margin-top: 8px;
            word-break: break-all;
            font-size: 14px;
          }
          
          .transaction-id a {
            color: #2196F3;
            text-decoration: none;
          }
          
          .transaction-id a:hover {
            text-decoration: underline;
          }
          
          .status-ok {
            color: #00C853;
          }
          
          .status-error {
            color: #FF5722;
          }
          
          pre {
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 12px;
          }
          
          ul {
            padding-left: 20px;
          }
          
          code {
            font-family: monospace;
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 2px;
          }
          
          .info-note {
            margin-top: 12px;
            padding: 8px;
            background-color: #f8f9fa;
            border-left: 4px solid #2196F3;
            font-size: 0.9em;
          }
          
          .verify-signature-section {
            margin: 20px 0;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 4px;
            border: 1px solid #e9ecef;
          }
          
          .secondary-button {
            background-color: #6c757d;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            margin-top: 10px;
          }
          
          .secondary-button:hover {
            background-color: #5a6268;
          }
          
          .secondary-button:disabled {
            background-color: #adb5bd;
            cursor: not-allowed;
          }
        `}
      </style>
    </div>
  );
}; 