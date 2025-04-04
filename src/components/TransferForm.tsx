import React, { useState, useEffect } from 'react';
import { PublicKey, Transaction, Connection, SendTransactionError } from '@solana/web3.js';
import { web3 } from '@coral-xyz/anchor';

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
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from '@noble/hashes/utils';
import { BorshAccountsCoder } from '@coral-xyz/anchor';

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

// Function helper để định dạng số giống Rust - format!("{}", f64)
function formatLikeRust(num: number): string {
  // Chuyển thành chuỗi với đủ số thập phân
  const str = num.toString();
  
  // Loại bỏ các số 0 ở cuối và dấu thập phân nếu không cần thiết
  return str.replace(/\.?0+$/, '');
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
      
      // Lấy PDA từ credential ID
      const multisigPDA = await getMultisigPDA(credentialId);
      console.log('MultisigPDA:', multisigPDA.toBase58());
      
      // Lấy PDA của guardian
      const guardianPDA = await getGuardianPDA(multisigPDA, guardianId);
      console.log('GuardianPDA:', guardianPDA.toBase58());
      
      // Chuyển đổi SOL sang lamports
      const amountLamports = parseFloat(amount) * LAMPORTS_PER_SOL;
      
      // Kiểm tra số dư
      const balance = await connection.getBalance(multisigPDA);
      if (balance < amountLamports) {
        throw new Error(
          `Số dư không đủ. Hiện tại: ${
            balance / LAMPORTS_PER_SOL
          } SOL, Cần: ${amount} SOL`
        );
      }
      
      // Kiểm tra địa chỉ hợp lệ
      let destinationPublicKey: PublicKey;
      try {
        destinationPublicKey = new PublicKey(destinationAddress);
      } catch (error) {
        throw new Error('Địa chỉ đích không hợp lệ');
      }
      
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
        console.log(
          `Fee payer balance: ${feePayerBalance / LAMPORTS_PER_SOL} SOL`
        );
        
        if (feePayerBalance === 0) {
          throw new Error("Không thể airdrop SOL cho fee payer");
        }
      } catch (airdropError) {
        console.warn("Không thể airdrop SOL để trả phí:", airdropError);
        // Tiếp tục thực hiện vì có thể account đã có sẵn SOL
      }
      
      // ĐỌC NONCE TỪ BLOCKCHAIN
      console.log('=== ĐỌC TRANSACTION NONCE HIỆN TẠI TỪ BLOCKCHAIN ===');
      
      // Đọc thông tin tài khoản multisig từ blockchain
      const multisigAccountInfo = await connection.getAccountInfo(multisigPDA);
      if (!multisigAccountInfo) {
          throw new Error(`Không tìm thấy tài khoản multisig: ${multisigPDA.toString()}`);
      }
      
      console.log('Tài khoản multisig tồn tại, độ dài data:', multisigAccountInfo.data.length);
      
      // Offset của transaction_nonce
      // 8 bytes (discriminator) + 1 byte (threshold) + 1 byte (guardian_count) + 8 bytes (recovery_nonce) + 1 byte (bump) = 19
      const nonceOffset = 19;
      
      // Đọc 8 bytes của transaction_nonce
      const nonceBytes = multisigAccountInfo.data.slice(nonceOffset, nonceOffset + 8);
      const currentNonce = new BN(nonceBytes, 'le');
      
      // Tính nonce tiếp theo
      const nextNonce = currentNonce.addn(1).toNumber();
      
      console.log('Nonce hiện tại (hex):', Buffer.from(nonceBytes).toString('hex'));
      console.log('Nonce hiện tại:', currentNonce.toString());
      console.log('Nonce tiếp theo (sẽ sử dụng):', nextNonce);
      
      // Lấy timestamp hiện tại (giây)
      const timestamp = Math.floor(Date.now() / 1000);
      
      // LẤY WEBAUTHN PUBLIC KEY
      console.log('Lấy WebAuthn public key...');
      let webAuthnPubKey: Buffer;
      
      // Thử tìm trong Firebase
      const credentialMapping = await getWalletByCredentialId(credentialId);
      
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
      
      // Tính toán hash của WebAuthn public key - thực hiện đúng như trong contract
      console.log('WebAuthn Public Key (Hex):', Buffer.from(webAuthnPubKey).toString('hex'));
      
      // Tính hash sử dụng sha256 giống contract
      const hashBytes = sha256(Buffer.from(webAuthnPubKey));
      const fullHashHex = Buffer.from(hashBytes).toString('hex');
      console.log('Full SHA-256 Hash (Hex):', fullHashHex);
      
      // Lấy 6 bytes đầu tiên của hash
      const hashBytesStart = hashBytes.slice(0, 6);
      
      // Chuyển đổi sang hex string giống hàm to_hex trong contract
      const pubkeyHashHex = Array.from(hashBytesStart)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('First 6 bytes of Hash (12 hex chars):', pubkeyHashHex);
      
      // Thử thêm log để debug từng byte
      console.log('Hash bytes (first 6):', Array.from(hashBytesStart));
      console.log('Hash hex format with contract matching:');
      Array.from(hashBytesStart).forEach((byte, i) => {
        const hex = byte.toString(16).padStart(2, '0');
        console.log(`Byte ${i}: ${byte} -> hex: ${hex}`);
      });
      
      // Thêm log để kiểm tra nếu nonce, timestamp, và các giá trị khác được xử lý đúng
      console.log('Nonce:', nextNonce);
      console.log('Timestamp:', timestamp);
      console.log('Destination address:', destinationAddress);
      console.log('===========================');
      
      // Format số lượng SOL để khớp với Rust
      // Rust sẽ tính lại: amount as f64 / 1_000_000_000.0
      // Rust sẽ chuyển số thực sang chuỗi sử dụng format! không có trailing zeros
      const amountInSol = amountLamports / LAMPORTS_PER_SOL;
      
      // Thử các cách định dạng số khác nhau
      console.log('===== DEBUG AMOUNT FORMAT =====');
      console.log('Amount (lamports):', amountLamports);
      console.log('Amount (SOL):', amountInSol);
      
      // Cách 1: Loại bỏ số 0 ở cuối và trong một số trường hợp cả dấu chấm thập phân
      const amount1 = amountInSol.toString().replace(/\.?0+$/, '');
      console.log('Format 1 (remove trailing zeros):', amount1);
      
      // Cách 2: Định dạng số theo Rust - format!("{}", f64)
      const amount2 = formatLikeRust(amountInSol);
      console.log('Format 2 (Rust format!):', amount2);
      
      // Cách 3: Sử dụng phương thức Rust thực tế gọi là Display 
      const amount3 = parseFloat(amountInSol.toString()).toString();
      console.log('Format 3 (parseFloat):', amount3);
      
      // Sử dụng định dạng giống Rust nhất
      const formattedAmount = amount2;
      console.log('Formatted amount được sử dụng:', formattedAmount);
      console.log('============================');
      
      // Thêm phần này để kiểm tra các giá trị trước khi gửi
      console.log('===== TEST MESSAGE WITH DIFFERENT HASH VALUES =====');
      
      // Tạo các hash thử nghiệm khác nhau
      const testHashes = [
        pubkeyHashHex,               // Hash tính từ frontend
        "e6cda2b8e0ad",              // Hash tính từ log trước đó
        "000000000000",              // Hash zero
        "cafebabe1234",              // Hash tùy ý khác
      ];
      
      // Thử từng hash và in ra message tương ứng
      for (const testHash of testHashes) {
        const testMessage = `transfer:${formattedAmount}_SOL_to_${destinationAddress},nonce:${nextNonce},timestamp:${timestamp},pubkey:${testHash}`;
        console.log(`Test message với hash [${testHash}]:`, testMessage);
      }
      
      console.log('=================================================');
      
      // Sử dụng hash tính được để tạo message
      const messageString = `transfer:${formattedAmount}_SOL_to_${destinationAddress},nonce:${nextNonce},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
      
      // Debug chi tiết hơn
      console.log('===== DEBUG MESSAGE =====');
      console.log('Message gốc:', messageString);
      console.log('Message length:', messageString.length);
      console.log('Message bytes array:', Array.from(new TextEncoder().encode(messageString)));
      console.log('Message bytes detailed:', Array.from(new TextEncoder().encode(messageString))
        .map((b, i) => `[${i}] ${b} (${String.fromCharCode(b)})`).join(', '));
      console.log('Message hex:', Buffer.from(messageString).toString('hex'));
      console.log('========================');
      
      // Chuyển message thành bytes
      const messageBytes = new TextEncoder().encode(messageString);
      
      // Thử ký bằng WebAuthn
      setTxStatus(TransactionStatus.SIGNING);
      
      // Hiển thị thông báo
      console.log('Đang yêu cầu xác thực WebAuthn...');
      setError(''); // Xóa thông báo lỗi trước đó
      setSuccess('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực giao dịch...');
      
      // Sử dụng trực tiếp message làm dữ liệu để ký với WebAuthn
      const assertion = await getWebAuthnAssertion(credentialId, messageString, true);
      
      if (!assertion) {
        throw new Error('Lỗi khi ký message bằng WebAuthn hoặc người dùng đã hủy xác thực');
      }
      
      console.log('Đã ký thành công bằng WebAuthn');
      console.log('ClientDataJSON:', new TextDecoder().decode(assertion.clientDataJSON));
      
      setSuccess(''); // Xóa thông báo thành công tạm thời
      
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
      
      // Tạo instruction secp256r1
      setTxStatus(TransactionStatus.BUILDING_TX);
      
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
      
      // Tạo instruction cho secp256r1 với verification data
      const secp256r1Ix = createSecp256r1Instruction(
        Buffer.from(verificationData), // Sử dụng verification data
        webAuthnPubKey, // publicKey
        normalizedSignature, // signature đã chuẩn hóa
        false // Không đảo ngược public key
      );
      
        console.log("Secp256r1 instruction data:", {
          programId: secp256r1Ix.programId.toString(),
          dataLength: secp256r1Ix.data.length,
          dataHex: Buffer.from(secp256r1Ix.data).toString('hex').substring(0, 60) + '...',
          pubkeyLength: webAuthnPubKey.length,
          signatureLength: normalizedSignature.length,
        messageLength: verificationData.length
      });
      
      // Tiếp tục quá trình xử lý transaction như bình thường
      const transferTx = createTransferTx(
        multisigPDA,
        guardianPDA,
        destinationPublicKey,
        amountLamports,
        nextNonce,
        timestamp,
        Buffer.from(messageBytes), // Sử dụng message gốc, không phải hash
        feePayer.publicKey,
        credentialId  // Truyền credential ID gốc
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
      
      const clientDataObj = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON));
     
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