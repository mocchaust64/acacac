import React, { useState, useEffect } from 'react';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction, Commitment, Signer, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import './App.css';
import { createWebAuthnCredential, getWebAuthnAssertionForLogin, calculateMultisigAddress, getWebAuthnAssertion } from './utils/webauthnUtils';
import { processCredentialIdForPDA, getMultisigPDA, getGuardianPDA, getAllGuardianPDAs } from './utils/credentialUtils';
import { QRCodeSVG } from 'qrcode.react';
import { 
  saveInvitation, 
  getInvitation, 
  getGuardianData, 
  updateGuardianStatus,
  getPendingInvites,
  deleteGuardianData
} from './firebase/guardianService';
import { getWalletByCredentialId } from './firebase/webAuthnService';
// Thêm import TransferForm
import { TransferForm } from './components/TransferForm';


const RPC_ENDPOINT = process.env.REACT_APP_RPC_ENDPOINT || 'http://127.0.0.1:8899'; // Localhost validator
const PROGRAM_ID_STRING = process.env.REACT_APP_PROGRAM_ID || 'DeN1rBfabZezHPvrq9q7BbzUbZkrjnHE1kQDrPK8kWQ3'; // Program ID mới triển khai

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STRING);



// Tùy chọn kết nối
const connectionOptions = {
  commitment: 'confirmed' as Commitment,
  confirmTransactionInitialTimeout: 60000,
  disableRetryOnRateLimit: false,
  fetch: fetch
};

// Connection với validator
const connection = new Connection(RPC_ENDPOINT, connectionOptions);

// Schema cho các struct của chương trình
class ActionParams {
  amount: number | null;
  destination: PublicKey | null;
  tokenMint: PublicKey | null;

  constructor(props: { 
    amount: number | null; 
    destination: PublicKey | null; 
    tokenMint: PublicKey | null 
  }) {
    this.amount = props.amount;
    this.destination = props.destination;
    this.tokenMint = props.tokenMint;
  }
}



function bufferToUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}


function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  // Tính tổng độ dài
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  

  const result = new Uint8Array(totalLength);
  

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}


const bigIntToLeBytes = (value: bigint, bytesLength: number = 8): Uint8Array => {
  const result = new Uint8Array(bytesLength);
  for (let i = 0; i < bytesLength; i++) {
    result[i] = Number((value >> BigInt(8 * i)) & BigInt(0xff));
  }
  return result;
};


const calculateMultisigPDA = async (programId: PublicKey, credentialId: string): Promise<[PublicKey, number]> => {

  const seedBuffer = processCredentialIdForPDA(credentialId);
  console.log("Xử lý credential ID:", credentialId);
  console.log("Seed buffer để tính PDA:", Buffer.from(seedBuffer).toString('hex'));
  
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      seedBuffer
    ],
    programId
  );
};

// Hàm nén khóa công khai từ dạng uncompressed (65 bytes) sang compressed (33 bytes)
const compressPublicKey = (uncompressedKey: Buffer): Buffer => {
  // Đảm bảo khóa bắt đầu với byte 0x04 (không nén)
  if (uncompressedKey[0] !== 0x04 || uncompressedKey.length !== 65) {
    console.warn('Khóa không đúng định dạng không nén ECDSA, tạo khóa ngẫu nhiên');
    // Tạo khóa random nếu không đúng định dạng
    const randomKey = Buffer.alloc(33);
    randomKey[0] = 0x02; // compressed, y is even
    
    // Tạo dữ liệu ngẫu nhiên cho 32 bytes còn lại
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    
    // Sao chép vào buffer
    for (let i = 0; i < 32; i++) {
      randomKey[i+1] = randomBytes[i];
    }
    
    return randomKey;
  }
  
  // Lấy tọa độ x và y
  const x = new Uint8Array(uncompressedKey.slice(1, 33));
  const y = new Uint8Array(uncompressedKey.slice(33, 65));
  
  // Tính prefix: 0x02 nếu y chẵn, 0x03 nếu y lẻ
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  
  // Tạo khóa nén: prefix (1 byte) + x (32 bytes)
  const compressedKey = Buffer.alloc(33);
  compressedKey[0] = prefix;
  
  // Copy x vào compressedKey từ vị trí 1
  for (let i = 0; i < 32; i++) {
    compressedKey[i + 1] = x[i];
  }
  
  return compressedKey;
};

// Hàm hash recovery phrase tại frontend
const hashRecoveryPhrase = async (phrase: string): Promise<Uint8Array> => {
  // Chuyển recovery phrase thành bytes
  const phraseBytes = new TextEncoder().encode(phrase);
  
  // Tạo buffer 32 bytes để lưu dữ liệu
  const inputBytes = new Uint8Array(32);
  
  // Sao chép dữ liệu từ phrase, đảm bảo không vượt quá 32 bytes
  inputBytes.set(phraseBytes.slice(0, Math.min(phraseBytes.length, 32)));
  
  // Hash bằng SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', inputBytes);
  
  // Chuyển kết quả thành Uint8Array
  return new Uint8Array(hashBuffer);
};

// Chuyển đổi secret key từ chuỗi trong .env thành mảng số
const convertSecretKeyStringToUint8Array = (secretKeyString: string | undefined): Uint8Array => {
  if (!secretKeyString) {
    throw new Error('Fee payer secret key không được định nghĩa trong biến môi trường');
  }
  
  // Chuyển đổi chuỗi "1,2,3,..." thành mảng số
  const numbers = secretKeyString.split(',').map(s => parseInt(s.trim(), 10));
  
  // Kiểm tra kích thước hợp lệ (64 bytes cho ed25519)
  if (numbers.length !== 64 && numbers.length !== 65) {
    throw new Error(`Secret key phải có 64 hoặc 65 bytes, nhưng có ${numbers.length} bytes`);
  }
  
  // Nếu có 65 bytes, bỏ qua byte cuối cùng (thường là checksum)
  const bytes = numbers.length === 65 ? numbers.slice(0, 64) : numbers;
  
  return new Uint8Array(bytes);
};


const hashCredentialId = async (credentialId: string): Promise<Uint8Array> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(credentialId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
};

function App() {
  const [walletKeypair, setWalletKeypair] = useState<Keypair | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [multisigAddress, setMultisigAddress] = useState<PublicKey | null>(null);
  const [threshold, setThreshold] = useState<number>(1);
  const [guardianName, setGuardianName] = useState<string>('Owner');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string>('');
  const [transactionStatus, setTransactionStatus] = useState<string>('');
  const [guardianPDA, setGuardianPDA] = useState<PublicKey | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(false);
  const [credentialId, setCredentialId] = useState<string>('');
  const [webauthnPubkey, setWebauthnPubkey] = useState<string>('');
  const [walletName, setWalletName] = useState<string>('My Moon Wallet');
  const [isUsingTempWallet, setIsUsingTempWallet] = useState<boolean>(false);
  // Thêm state cho new guardian
  const [newGuardianName, setNewGuardianName] = useState<string>('');
  const [newRecoveryPhrase, setNewRecoveryPhrase] = useState<string>('');
  const [existingGuardians, setExistingGuardians] = useState<number[]>([]);  // Lưu các guardian ID đã tồn tại
  const [showAddGuardianForm, setShowAddGuardianForm] = useState<boolean>(false);
  // Thêm state cho fee payer của dự án
  const [projectFeePayerKeypair, setProjectFeePayerKeypair] = useState<Keypair | null>(null);
  const [usingProjectFeePayer, setUsingProjectFeePayer] = useState<boolean>(true);
  const [feePayerBalance, setFeePayerBalance] = useState<number>(0);
  const [isLoadingFeePayerBalance, setIsLoadingFeePayerBalance] = useState<boolean>(false);
  // Thêm state cho số dư PDA
  const [pdaBalance, setPdaBalance] = useState<number>(0);
  const [isLoadingPdaBalance, setIsLoadingPdaBalance] = useState<boolean>(false);
  // Thêm state cho việc chọn guardian ID
  const [selectedGuardianId, setSelectedGuardianId] = useState<number>(1);
  // State cho form nạp tiền
  const [depositAmount, setDepositAmount] = useState<number>(0.1);
  // State cho form rút tiền
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0.05);
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  // State cho form đăng nhập ví
  const [loginCredentialId, setLoginCredentialId] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [showLoginForm, setShowLoginForm] = useState<boolean>(false);
  
  // Thêm state cho chức năng tạo invitation
  const [inviteLink, setInviteLink] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [showQRCode, setShowQRCode] = useState<boolean>(false);
  const [showInviteInput, setShowInviteInput] = useState<boolean>(false);
  const [pendingInvites, setPendingInvites] = useState<string[]>([]);

  // Tạo keypair mới khi component được mount
  useEffect(() => {
   
    const projectPayerPrivateKey = convertSecretKeyStringToUint8Array(process.env.REACT_APP_FEE_PAYER_SECRET_KEY);
    
    // Sử dụng keypair cố định cho fee payer
    const feePayerKeypair = Keypair.fromSecretKey(projectPayerPrivateKey);
    setProjectFeePayerKeypair(feePayerKeypair);
    
    // Load balance cho fee payer
    loadFeePayerBalance(feePayerKeypair);
    
  }, []);

  // Thêm hàm để load balance của fee payer
  const loadFeePayerBalance = async (keypair: Keypair) => {
    try {
      setIsLoadingFeePayerBalance(true);
      const balance = await connection.getBalance(keypair.publicKey);
      console.log(`Fee payer balance: ${balance / 1_000_000_000} SOL`);
      
      // Nếu balance quá thấp, có thể gửi thông báo cảnh báo
      if (balance < 100_000_000) { // dưới 0.1 SOL
        console.warn("Fee payer balance thấp, cần nạp thêm SOL");
      }
      
      setFeePayerBalance(balance / 1_000_000_000);
    } catch (error) {
      console.error("Lỗi khi load balance của fee payer:", error);
    } finally {
      setIsLoadingFeePayerBalance(false);
    }
  };


  // Tải balance với xử lý lỗi tốt hơn
  const loadBalance = async (keypair?: Keypair) => {
    const publicKey = keypair?.publicKey || walletKeypair?.publicKey;
    if (!publicKey) return;
    
    setIsLoadingBalance(true);
    try {
      console.log("Đang tải balance cho địa chỉ:", publicKey.toString());
      const balance = await connection.getBalance(publicKey);
      console.log("Balance đã tải thành công:", balance / 1_000_000_000);
      setWalletBalance(balance / 1_000_000_000); // Chuyển từ lamports sang SOL
    } catch (error: any) {
      console.error('Lỗi khi tải balance:', error);
      // Không hiển thị lỗi cho người dùng, chỉ log ra console
    } finally {
      setIsLoadingBalance(false);
    }
  };

  // Tạo ví với WebAuthn
  const createWalletWithWebAuthn = async () => {
    try {
      // Kiểm tra xem người dùng đã nhập recovery phrase chưa
      if (!recoveryPhrase || recoveryPhrase.trim().length < 8) {
        setTransactionStatus('Vui lòng nhập recovery phrase (ít nhất 8 ký tự) trước khi tạo ví');
        return;
      }
      
      // Kiểm tra xem có fee payer hay không
      if (!projectFeePayerKeypair) {
        setTransactionStatus('Không tìm thấy fee payer của dự án. Vui lòng thử lại sau.');
        return;
      }
      
      setTransactionStatus('Đang tạo ví Moon Wallet...\n\nBước 1: Đang tạo khóa WebAuthn...');
      
      // 1. Tạo khóa WebAuthn
      const walletAddress = projectFeePayerKeypair.publicKey.toString(); // Sử dụng địa chỉ của fee payer
      const result = await createWebAuthnCredential(walletAddress, walletName);
      
      // Chuyển đổi rawId thành base64 để lưu trữ và sử dụng
      const rawIdBase64 = Buffer.from(result.rawId).toString('base64');
      

      setCredentialId(rawIdBase64); 
      setWebauthnPubkey(result.publicKey);
      
      setTransactionStatus(prev => prev + `\nĐã tạo khóa WebAuthn thành công!\nCredential ID (base64): ${rawIdBase64.slice(0, 10)}...\nPublic Key: ${result.publicKey.slice(0, 10)}...`);
      
 
      const multisigPDA = getMultisigPDA(rawIdBase64);
      console.log("Multisig PDA:", multisigPDA.toString());
      
      setMultisigAddress(multisigPDA);
      setTransactionStatus(prev => prev + `\n\nBước 2: Đang khởi tạo ví multisig tại địa chỉ: ${multisigPDA.toString()}...`);
      
      const existingAccount = await connection.getAccountInfo(multisigPDA);
      if (existingAccount) {
        setTransactionStatus(prev => prev + `\n\nLỖI: Ví multisig với credential ID này đã tồn tại. Điều này gần như không thể xảy ra vì credential ID luôn duy nhất.`);
        return;
      }
      
      const guardianId = BigInt(1); // Owner có ID = 1

  
      const guardianIdBytes = bigIntToLeBytes(guardianId);
      
      const [guardianPDAAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("guardian").subarray(0),
          multisigPDA.toBuffer(),
          guardianIdBytes
        ],
        PROGRAM_ID
      );
      
      setGuardianPDA(guardianPDAAddress);
      
      // 4. Tạo transaction tích hợp để khởi tạo multisig và thêm guardian owner
      const transaction = new Transaction();
      
      // 4.1 Khởi tạo Multisig
      // Đây là discriminator cho initialize_multisig (sử dụng giá trị chính xác từ Anchor IDL)
      const initMultisigDiscriminator = new Uint8Array([220, 130, 117, 21, 27, 227, 78, 213]);
      const thresholdBytes = new Uint8Array([threshold]);
      const credentialIdString = rawIdBase64;
      const credentialIdBuffer = Buffer.from(credentialIdString);
      console.log("Credential ID gửi đi (chuỗi gốc):", credentialIdString);
      
      const credentialIdLenBuffer = Buffer.alloc(4);
      credentialIdLenBuffer.writeUInt32LE(credentialIdBuffer.length, 0);
      const credentialIdLenBytes = bufferToUint8Array(credentialIdLenBuffer);
      const credentialIdDataBytes = bufferToUint8Array(credentialIdBuffer);
      
      // Tạo dữ liệu instruction theo đúng cấu trúc contract yêu cầu
      const initData = concatUint8Arrays(
        initMultisigDiscriminator,
        thresholdBytes,
        credentialIdLenBytes,
        credentialIdDataBytes
      );
      
      // Thêm instruction khởi tạo multisig vào transaction
      transaction.add(new TransactionInstruction({
        keys: [
          { pubkey: multisigPDA, isSigner: false, isWritable: true },
          { pubkey: projectFeePayerKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: Buffer.from(initData)
      }));
      
      // Sign và gửi transaction
      transaction.feePayer = projectFeePayerKeypair.publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Thông báo cho người dùng
      setTransactionStatus(prev => prev + '\nĐang gửi transaction để khởi tạo ví và thêm guardian owner...');
      
      // Log dữ liệu transaction để debug
      console.log("Transaction data:", {
        instructions: transaction.instructions.map((ix, index) => ({
          programId: ix.programId.toString(),
          keys: ix.keys.map(k => ({
            pubkey: k.pubkey.toString(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          })),
          data: index === 1 ? {
            discriminator: Array.from(initMultisigDiscriminator),
            threshold: threshold,
            credentialIdLength: credentialIdBuffer.length,
            credentialId: Array.from(credentialIdBuffer),
            isOwner: true,
            hasWebauthn: true,
            webauthnPubkeyLength: result.publicKey.length
          } : "initMultisig"
        }))
      });
      
      const signature = await connection.sendTransaction(
        transaction,
        [projectFeePayerKeypair]
      );
      
      await connection.confirmTransaction(signature);
      setTransactionStatus(prev => prev + `\nVí multisig đã được khởi tạo thành công! Signature: ${signature}`);
      
      // 5. Thêm guardian đầu tiên (owner)
      setTransactionStatus(prev => prev + '\n\nBước 3: Đang thêm guardian owner đầu tiên...');

      try {
        // Tính PDA cho guardian
        const guardianId = BigInt(1); // Owner có ID = 1
        const guardianIdBytes = bigIntToLeBytes(guardianId);
        
        // 5.1 Tính PDA cho multisig với credential_id
        const guardianMultisigPDA = multisigPDA;
        
        console.log("Sử dụng PDA cho guardian với multisig PDA:", guardianMultisigPDA.toString());
        
        // 5.2 Tính PDA cho guardian
        const guardianPDA = getGuardianPDA(guardianMultisigPDA, 1); // Owner có ID = 1
        
        setGuardianPDA(guardianPDA);
        
        // Hash recovery phrase tại frontend
        console.log("Recovery phrase gốc:", recoveryPhrase);
        const hashedRecoveryBytes = await hashRecoveryPhrase(recoveryPhrase);
        console.log("Recovery phrase sau khi hash tại frontend:", Buffer.from(hashedRecoveryBytes).toString('hex'));
        
        // Tạo discriminator cho add_guardian
        const addGuardianDiscriminator = new Uint8Array([167, 189, 170, 27, 74, 240, 201, 241]);
        
        // Chuyển guardian ID thành bytes
        const guardianIdBigIntBytes = bigIntToLeBytes(guardianId);
        
        // Chuẩn bị tên guardian
        const guardianNameBuffer = Buffer.from(guardianName || 'Owner');
        const guardianNameLenBuffer = Buffer.alloc(4);
        guardianNameLenBuffer.writeUInt32LE(guardianNameBuffer.length, 0);
        
        // Chuẩn bị recovery hash - sử dụng giá trị đã hash
        const recoveryHashIntermediateBytes = hashedRecoveryBytes;
        
        // Chuẩn bị các tham số khác
        const isOwnerByte = new Uint8Array([1]); // true = 1
    
        const uncompressedKeyBuffer = Buffer.from(result.publicKey, 'hex');
        console.log("WebAuthn key (uncompressed, 65 bytes):", result.publicKey);
        
        // Nén khóa thành 33 bytes
        const compressedKeyBuffer = compressPublicKey(uncompressedKeyBuffer);
        console.log("WebAuthn key (compressed, 33 bytes):", compressedKeyBuffer.toString('hex'));
        
        // Nối tất cả lại với nhau
        const addGuardianData = concatUint8Arrays(
          addGuardianDiscriminator,
          // guardian_id (u64)
          bufferToUint8Array(Buffer.from(guardianIdBigIntBytes)),
          // guardian_name (string)
          bufferToUint8Array(guardianNameLenBuffer),
          bufferToUint8Array(guardianNameBuffer),
          // recovery_hash_intermediate ([u8; 32])
          recoveryHashIntermediateBytes,
          // is_owner (bool)
          isOwnerByte,
          // webauthn_pubkey (Option<[u8; 33]>)
          new Uint8Array([1]), // Some variant
          bufferToUint8Array(compressedKeyBuffer) // Sử dụng khóa đã được nén
        );
        
        // Tạo transaction add guardian
        const addGuardianTransaction = new Transaction();
        addGuardianTransaction.add(
          new TransactionInstruction({
            keys: [
              { pubkey: multisigPDA, isSigner: false, isWritable: true },
              { pubkey: guardianPDA, isSigner: false, isWritable: true },
              { pubkey: projectFeePayerKeypair.publicKey, isSigner: false, isWritable: false },
              { pubkey: projectFeePayerKeypair.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data: Buffer.from(addGuardianData)
          })
        );
        
        // Sign và gửi transaction
        addGuardianTransaction.feePayer = projectFeePayerKeypair.publicKey;
        addGuardianTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        const addGuardianSignature = await connection.sendTransaction(
          addGuardianTransaction,
          [projectFeePayerKeypair]
        );
        
        await connection.confirmTransaction(addGuardianSignature);
        setTransactionStatus(prev => prev + `\nGuardian owner đã được thêm thành công! Signature: ${addGuardianSignature}`);
      } catch (error: any) {
        console.error("Lỗi khi thêm guardian owner:", error);
        setTransactionStatus(prev => prev + `\nLỗi khi thêm guardian owner: ${error.message}`);
      }
      
      // 6. Hoàn thành quá trình tạo ví
      setTransactionStatus(prev => prev + '\n\n✅ VÍ MOON WALLET ĐÃ ĐƯỢC TẠO THÀNH CÔNG!\n' +
        `Địa chỉ ví Multisig: ${multisigPDA.toString()}\n` +
        `Recovery Phrase: ${recoveryPhrase}\n` +
        'Vui lòng lưu lại thông tin này để sử dụng sau này!');
      
      // Kiểm tra số dư của ví PDA sau khi tạo
      await loadPdaBalance(multisigPDA);
      
    } catch (error: any) {
      console.error('Lỗi trong quá trình tạo ví:', error);
      setTransactionStatus(`Lỗi: ${error.message}`);
    }
  };




  const loadPdaBalance = async (pdaAddress: PublicKey) => {
    try {
      setIsLoadingPdaBalance(true);
      const balance = await connection.getBalance(pdaAddress);
      console.log(`PDA balance: ${balance / 1_000_000_000} SOL`);
      setPdaBalance(balance / 1_000_000_000);
    } catch (error) {
      console.error("Lỗi khi load balance của PDA:", error);
    } finally {
      setIsLoadingPdaBalance(false);
    }

  };
  const findGuardianAddress = async (guardianId: number = 1) => {
    if (!multisigAddress) return null;
    
    try {
   
      const guardianIdBigInt = BigInt(guardianId);
      const guardianIdBytes = bigIntToLeBytes(guardianIdBigInt);
      
      // Tính PDA cho guardian trực tiếp từ multisigAddress
      const [guardianPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("guardian"),
          multisigAddress.toBuffer(),
          guardianIdBytes
        ],
        PROGRAM_ID
      );
      
      console.log(`Tính PDA cho guardian ID ${guardianId} với multisig: ${multisigAddress.toString()}`);
      console.log(`Guardian PDA: ${guardianPDA.toString()}`);
      
      if (guardianId === 1) {
        setGuardianPDA(guardianPDA); // Chỉ set state cho guardian chính (ID=1)
      }
      return guardianPDA;
    } catch (error) {
      console.error(`Lỗi khi tính PDA cho guardian ID ${guardianId}:`, error);
      return null;
    }
  };

  // Airdrop SOL cho testing
  const requestAirdrop = async () => {
    if (!projectFeePayerKeypair) {
      setTransactionStatus('Không tìm thấy fee payer của dự án.');
      return;
    }
    
    try {
      setTransactionStatus('Đang yêu cầu airdrop cho fee payer của dự án...');
      const signature = await connection.requestAirdrop(
        projectFeePayerKeypair.publicKey,
        2_000_000_000 // 2 SOL
      );
      
      await connection.confirmTransaction(signature);
      // Tải lại số dư của fee payer
      await loadFeePayerBalance(projectFeePayerKeypair);
      setTransactionStatus('Airdrop thành công! 2 SOL đã được thêm vào ví fee payer của dự án.');
    } catch (error: any) {
      console.error('Lỗi khi thực hiện airdrop:', error);
      setTransactionStatus(`Lỗi airdrop: ${error.message}. Đang thử phương thức chuyển tiền trực tiếp...`);
      
      // Thử phương pháp khác nếu airdrop thất bại
      fundFromValidator(projectFeePayerKeypair);
    }
  };
  const fundFromValidator = async (keypair: Keypair) => {
    try {
      setTransactionStatus('Đang chuyển tiền từ validator vào fee payer...');
      
      // Tạo kết nối với validator wallet (địa chỉ mặc định của validator)
      const validatorKey = new PublicKey('E6mJJmCvg4PDhanmaBxxeyTczza9vKpMgirRUD6Qz5kv');
      
      // Tạo transaction chuyển tiền
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: validatorKey,
          toPubkey: keypair.publicKey,
          lamports: 2_000_000_000 // 2 SOL
        })
      );
      
      // Lấy các thông tin cần thiết cho transaction
      transaction.feePayer = validatorKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Không thể ký transaction vì không có private key của validator
      // Thay vào đó, sử dụng phương thức sendTransactionWithRetry không cần chữ ký
      const signature = await connection.sendTransaction(
        transaction,
        [] // Không cần signers khi gửi đến validator local
      );
      
      await connection.confirmTransaction(signature);
      
      // Tải lại số dư
      if (keypair === projectFeePayerKeypair) {
        await loadFeePayerBalance(keypair);
        setTransactionStatus('Chuyển tiền thành công! 2 SOL đã được thêm vào ví fee payer của dự án.');
      } else {
        await loadBalance(keypair);
        setTransactionStatus('Chuyển tiền thành công! 2 SOL đã được thêm vào ví.');
      }
    } catch (error: any) {
      console.error('Lỗi khi chuyển tiền từ validator:', error);
      setTransactionStatus(`Lỗi khi chuyển tiền: ${error.message}. Hãy thử khởi động lại validator.`);
    }
  };


  const getWalletInfo = async () => {
    if (!multisigAddress) return;
    
    try {
      setTransactionStatus('Đang truy vấn thông tin ví...');
      
      // Load balance trước
      await loadPdaBalance(multisigAddress);
      
      const multisigAccount = await connection.getAccountInfo(multisigAddress);
      
      if (!multisigAccount) {
        setTransactionStatus('Ví chưa được khởi tạo');
        return;
      }
      
      const data = multisigAccount.data.slice(8);
      
      const threshold = data[0];
      const guardian_count = data[1];
      const recovery_nonce = new DataView(data.buffer, data.byteOffset + 2, 8).getBigUint64(0, true);
      const bump = data[10];
      const transaction_nonce = new DataView(data.buffer, data.byteOffset + 11, 8).getBigUint64(0, true);
      const last_transaction_timestamp = new DataView(data.buffer, data.byteOffset + 19, 8).getBigInt64(0, true);
      
      // Hiển thị thông tin
      setTransactionStatus(
        `Thông tin ví:\n` +
        `- Threshold: ${threshold}\n` +
        `- Guardian Count: ${guardian_count}\n` +
        `- Recovery Nonce: ${recovery_nonce}\n` +
        `- Bump: ${bump}\n` +
        `- Transaction Nonce: ${transaction_nonce}\n` +
        `- Last Transaction Timestamp: ${last_transaction_timestamp}`
      );
    } catch (error: any) {
      console.error('Lỗi khi truy vấn thông tin ví:', error);
      setTransactionStatus(`Lỗi: ${error.message}`);
    }
  };
  
  // Xem thông tin guardian
  const getGuardianInfo = async () => {
    if (!multisigAddress) {
      setTransactionStatus('Vui lòng tạo ví trước khi xem thông tin guardian');
      return;
    }
    
    try {
      setTransactionStatus(`Đang truy vấn thông tin guardian ID=${selectedGuardianId}...`);
      
      // Tính guardian PDA dựa trên ID được chọn
      const guardianPDA = await findGuardianAddress(selectedGuardianId);
      
      if (!guardianPDA) {
        setTransactionStatus('Không thể tìm thấy địa chỉ Guardian');
        return;
      }
      
      console.log(`Đang truy vấn thông tin guardian ID=${selectedGuardianId} với PDA: ${guardianPDA.toString()}`);
      const guardianAccount = await connection.getAccountInfo(guardianPDA);
      
      if (!guardianAccount) {
        console.log(`Không tìm thấy thông tin account tại địa chỉ: ${guardianPDA.toString()}`);
        setTransactionStatus(`Guardian với ID=${selectedGuardianId} chưa được khởi tạo hoặc không tồn tại`);
        return;
      }
      
      console.log(`Đã tìm thấy account tại địa chỉ: ${guardianPDA.toString()}`);
      console.log(`Data size: ${guardianAccount.data.length} bytes`);
      console.log(`Owner: ${guardianAccount.owner.toString()}`);
      
      // Kiểm tra xem account có thuộc về program của chúng ta không
      if (!guardianAccount.owner.equals(PROGRAM_ID)) {
        console.error(`Account không thuộc về program của chúng ta. Owner: ${guardianAccount.owner.toString()}`);
        setTransactionStatus(`Guardian với ID=${selectedGuardianId} không thuộc về program của chúng ta`);
        return;
      }
      
      // Bỏ qua 8 byte discriminator
      const data = guardianAccount.data.slice(8);
      console.log(`Data sau khi bỏ qua discriminator: ${data.length} bytes`);
      console.log(`Raw data: ${Buffer.from(data).toString('hex').substring(0, 100)}...`);
      
      try {
    
        
        // Đọc wallet address (32 bytes)
        const walletBytes = data.slice(0, 32);
        const wallet = new PublicKey(walletBytes);
        console.log(`Wallet address parsed: ${wallet.toString()}`);
        
        // Đọc guardian_id (8 bytes - u64)
        const guardianIdBytes = data.slice(32, 40);
        let guardianId = BigInt(0);
        for (let i = 0; i < 8; i++) {
          guardianId |= BigInt(guardianIdBytes[i]) << BigInt(8 * i);
        }
        console.log(`Guardian ID parsed: ${guardianId}`);
        
        // Đọc name (string dài tối đa 32 bytes)
        const nameLength = new DataView(data.buffer, data.byteOffset + 40, 4).getUint32(0, true);
        console.log(`Guardian name length: ${nameLength}`);
        
        if (nameLength > 100) {
          console.error(`Name length quá lớn: ${nameLength}, có thể không đúng cấu trúc dữ liệu`);
          throw new Error("Lỗi parse dữ liệu guardian: Name length không hợp lệ");
        }
        
        // Vị trí bắt đầu của name bytes
        const nameOffset = 44;
        const nameBytes = data.slice(nameOffset, nameOffset + nameLength);
        const name = new TextDecoder().decode(nameBytes);
        console.log(`Guardian name parsed: ${name}`);
        
        // Vị trí tiếp theo sau name
        let currentOffset = nameOffset + nameLength;
        
        // Đọc is_active (1 byte)
        const isActive = data[currentOffset] === 1;
        console.log(`Is active byte: ${data[currentOffset]} (offset: ${currentOffset})`);
        currentOffset += 1;
        
        // Đọc recovery_hash (32 bytes)
        const recoveryHash = data.slice(currentOffset, currentOffset + 32);
        const recoveryHashHex = Buffer.from(recoveryHash).toString('hex');
        console.log(`Recovery hash (hex): ${recoveryHashHex} (offset: ${currentOffset})`);
        currentOffset += 32;
        
        // Đọc is_owner (1 byte)
        const isOwner = data[currentOffset] === 1;
        console.log(`Is owner byte: ${data[currentOffset]} (offset: ${currentOffset})`);
        currentOffset += 1;
        
        // Đọc webauthn_pubkey (option, 1 byte discriminator + 33 bytes if Some)
        const hasWebauthn = data[currentOffset] === 1;
        console.log(`Has webauthn byte: ${data[currentOffset]} (offset: ${currentOffset})`);
        currentOffset += 1;
        
        let webauthnPubkey = null;
        if (hasWebauthn) {
          webauthnPubkey = data.slice(currentOffset, currentOffset + 33);
          const webauthnHex = Buffer.from(webauthnPubkey).toString('hex');
          console.log(`WebAuthn pubkey: ${webauthnHex} (offset: ${currentOffset})`);
          // Log thêm thông tin về format của key
          console.log(`WebAuthn key format byte: 0x${webauthnHex.slice(0, 2)} (${webauthnPubkey[0]})`);
          currentOffset += 33;
        }
        
        // Đọc bump (1 byte)
        const bump = data[currentOffset];
        console.log(`Bump: ${bump} (offset: ${currentOffset})`);
        
        // Hiển thị thông tin
        setTransactionStatus(
          `Thông tin Guardian (ID=${guardianId}):\n` +
          `- Loại Guardian: ${isOwner ? 'Owner (Quản trị viên)' : 'Regular (Thành viên)'}\n` +
          `- Wallet: ${wallet.toString()}\n` +
          `- Guardian ID: ${guardianId}\n` +
          `- Name: ${name}\n` +
          `- Active: ${isActive ? 'Có' : 'Không'}\n` +
          `- Recovery Hash: ${recoveryHashHex.slice(0, 10)}...${recoveryHashHex.slice(-10)}\n` +
          (hasWebauthn ? `- WebAuthn Key: ${Buffer.from(webauthnPubkey!).toString('hex')}\n` : '') +
          (hasWebauthn ? `- WebAuthn Key Format: ${webauthnPubkey![0] === 2 ? '02 (even y)' : 
                                                (webauthnPubkey![0] === 3 ? '03 (odd y)' : 
                                                webauthnPubkey![0].toString())}\n` : '') +
          (hasWebauthn ? `- Công dụng: ${isOwner ? 'Dùng để ký giao dịch và quản lý ví' : 'Dùng để xác thực từ thiết bị này'}\n` : '') +
          `- Bump: ${bump}\n` +
          `- PDA: ${guardianPDA.toString()}`
        );
      } catch (parseError) {
        console.error("Lỗi khi parse dữ liệu guardian:", parseError);
        
        // Hiển thị thông tin thô nếu không thể parse
        setTransactionStatus(
          `Không thể parse dữ liệu guardian chi tiết. Dữ liệu thô:\n` +
          `- PDA: ${guardianPDA.toString()}\n` +
          `- Data size: ${guardianAccount.data.length} bytes\n` +
          `- Raw data: ${Buffer.from(guardianAccount.data).toString('hex').substring(0, 100)}...\n` +
          `- Error: ${parseError}`
        );
      }
    } catch (error: any) {
      console.error('Lỗi khi truy vấn thông tin guardian:', error);
      setTransactionStatus(`Lỗi: ${error.message}`);
    }
  };

  // Hàm để lấy danh sách guardian ID hiện có
  const getExistingGuardianIds = async () => {
    if (!multisigAddress) return [];
    
    try {
      setTransactionStatus('Đang kiểm tra danh sách Guardian ID...');
      
      const guardianIds: number[] = [];
      
      // Kiểm tra guardian từ ID 1 đến 8
      for (let i = 1; i <= 8; i++) {
        try {
          // Tính PDA cho guardian với ID i sử dụng hàm đã sửa
          const guardianPDA = await findGuardianAddress(i);
          
          if (!guardianPDA) {
            console.log(`Guardian ID ${i}: Không tính được PDA`);
            continue;
          }
          
          // Kiểm tra xem guardian với ID này có tồn tại không
          console.log(`Đang kiểm tra Guardian ID ${i} tại địa chỉ: ${guardianPDA.toString()}`);
          const guardianAccount = await connection.getAccountInfo(guardianPDA);
          
          if (guardianAccount) {
            guardianIds.push(i);
            console.log(`Guardian ID ${i} đã tồn tại - PDA: ${guardianPDA.toString()}`);
            console.log(`  - Owner: ${guardianAccount.owner.toString()}`);
            console.log(`  - Data size: ${guardianAccount.data.length} bytes`);
            
            // Kiểm tra discriminator (8 bytes đầu)
            const discriminator = guardianAccount.data.slice(0, 8);
            console.log(`  - Discriminator: ${Buffer.from(discriminator).toString('hex')}`);
          } else {
            console.log(`Guardian ID ${i}: Account không tồn tại tại địa chỉ ${guardianPDA.toString()}`);
          }
        } catch (error) {
          console.error(`Lỗi khi kiểm tra guardian ID ${i}:`, error);
        }
      }
      
      console.log("Danh sách guardian ID hiện tại:", guardianIds);
      
      // Nếu không có guardian nào, thêm ID 1 vào danh sách để có thể chọn
      if (guardianIds.length === 0) {
        guardianIds.push(1);
        console.log("Không tìm thấy guardian nào, thêm ID 1 mặc định vào danh sách");
      }
      
      setExistingGuardians(guardianIds);
      
      // Đảm bảo selectedGuardianId nằm trong danh sách các ID hiện có
      if (!guardianIds.includes(selectedGuardianId)) {
        console.log(`Selected Guardian ID ${selectedGuardianId} không tồn tại, chuyển sang ID ${guardianIds[0]}`);
        setSelectedGuardianId(guardianIds[0]);
      }
      
      setTransactionStatus(`Đã tìm thấy ${guardianIds.length} guardian. IDs: ${guardianIds.join(', ')}`);
      return guardianIds;
    } catch (error) {
      console.error("Lỗi khi lấy danh sách guardian:", error);
      return [];
    }
  };
  
  // Hàm sinh guardian ID mới không bị trùng
  const generateNewGuardianId = (existingIds: number[]) => {
    // Nếu không có ID nào tồn tại, bắt đầu từ 2 (vì ID 1 thường là owner)
    if (existingIds.length === 0) return 2;
    
    // Tìm ID nhỏ nhất không bị trùng
    let newId = 1;
    while (existingIds.includes(newId)) {
      newId++;
    }
    
    return newId;
  };
  
  // Hàm thêm guardian mới với chữ ký WebAuthn riêng
  const addNewGuardian = async () => {
    try {
      // Kiểm tra xem ví đã được tạo chưa
      if (!multisigAddress) {
        setTransactionStatus('Vui lòng tạo ví trước khi thêm guardian.');
        return;
      }
      
      // Kiểm tra xem có fee payer hay không
      if (!projectFeePayerKeypair) {
        setTransactionStatus('Không tìm thấy fee payer của dự án. Vui lòng thử lại sau.');
        return;
      }
      
      // Kiểm tra các trường bắt buộc
      if (!newGuardianName || !newRecoveryPhrase || newRecoveryPhrase.length < 8) {
        setTransactionStatus('Vui lòng nhập tên guardian và recovery phrase (ít nhất 8 ký tự).');
        return;
      }
      
      setTransactionStatus('Đang thêm guardian mới...\n\nBước 1: Tạo khóa WebAuthn cho guardian mới...');
      
      // Lấy danh sách guardian ID hiện tại
      const existingIds = await getExistingGuardianIds();
      
      // Sinh guardian ID mới không bị trùng
      const newGuardianId = generateNewGuardianId(existingIds);
      console.log("=== ADD GUARDIAN === Guardian ID mới được sinh:", newGuardianId);
      
      // 1. Tạo khóa WebAuthn cho guardian mới
      try {
        // Sử dụng một định danh duy nhất cho khóa mới
        const guardianIdentifier = `${multisigAddress?.toString()}_guardian_${newGuardianId}`;
        const webAuthnResult = await createWebAuthnCredential(guardianIdentifier, newGuardianName);
        
        // Log thông tin WebAuthn
        console.log("=== ADD GUARDIAN === WebAuthn credential mới đã được tạo:");
        console.log("=== ADD GUARDIAN === Credential ID:", webAuthnResult.credentialId);
        console.log("=== ADD GUARDIAN === Public Key:", webAuthnResult.publicKey);
        
        setTransactionStatus(prev => prev + `\nĐã tạo khóa WebAuthn thành công!`);
        
        // 2. Tính PDA cho guardian mới
        const guardianPDA = await findGuardianAddress(newGuardianId);
        
        if (!guardianPDA) {
          setTransactionStatus('Không thể tính PDA cho guardian mới.');
          return;
        }
        
        console.log("=== ADD GUARDIAN === Guardian PDA mới:", guardianPDA.toString());
        
        // Kiểm tra trước xem guardian account đã tồn tại chưa
        const existingGuardian = await connection.getAccountInfo(guardianPDA);
        if (existingGuardian) {
          console.log("=== ADD GUARDIAN === Guardian account đã tồn tại!", existingGuardian);
          setTransactionStatus(`Guardian với ID=${newGuardianId} đã tồn tại rồi. Hãy chọn ID khác.`);
          return;
        }
        
        // 3. Hash recovery phrase
        const hashedRecoveryBytes = await hashRecoveryPhrase(newRecoveryPhrase);
        console.log("=== ADD GUARDIAN === Recovery phrase sau khi hash:", Buffer.from(hashedRecoveryBytes).toString('hex'));
        
        // 4. Chuyển đổi guardian ID thành bytes (little-endian)
        const guardianIdBigInt = BigInt(newGuardianId);
        const guardianIdBytes = bigIntToLeBytes(guardianIdBigInt);
        
        // 5. Nén khóa WebAuthn từ 65 bytes (uncompressed) thành 33 bytes (compressed)
        const uncompressedKeyBuffer = Buffer.from(webAuthnResult.publicKey, 'hex');
        console.log("=== ADD GUARDIAN === WebAuthn key (uncompressed, 65 bytes):", webAuthnResult.publicKey);
        
        // Nén khóa thành 33 bytes
        const compressedKeyBuffer = compressPublicKey(uncompressedKeyBuffer);
        console.log("=== ADD GUARDIAN === WebAuthn key (compressed, 33 bytes):", compressedKeyBuffer.toString('hex'));
        
        // 6. Tạo discriminator cho add_guardian
        const addGuardianDiscriminator = new Uint8Array([167, 189, 170, 27, 74, 240, 201, 241]);
        
        // 7. Chuẩn bị tên guardian
        const guardianNameBuffer = Buffer.from(newGuardianName);
        const guardianNameLenBuffer = Buffer.alloc(4);
        guardianNameLenBuffer.writeUInt32LE(guardianNameBuffer.length, 0);
        
        // 8. Đặt is_owner = false vì đây là guardian member, không phải owner
        const isOwnerByte = new Uint8Array([0]); // false = 0
        
        // 9. Cấu hình webauthn_pubkey là Some(compressed_key)
        const hasWebauthn = new Uint8Array([1]); // Some variant
        
        // 10. Tạo dữ liệu instruction
        const addGuardianData = concatUint8Arrays(
          addGuardianDiscriminator,
          // guardian_id (u64)
          bufferToUint8Array(Buffer.from(guardianIdBytes)),
          // guardian_name (string)
          bufferToUint8Array(guardianNameLenBuffer),
          bufferToUint8Array(guardianNameBuffer),
          // recovery_hash_intermediate ([u8; 32])
          hashedRecoveryBytes,
          // is_owner (bool)
          isOwnerByte,
          // webauthn_pubkey (Option<[u8; 33]>) - Some variant + compressed key
          hasWebauthn,
          bufferToUint8Array(compressedKeyBuffer)
        );
        
        // Log dữ liệu instruction để debug
        console.log("=== ADD GUARDIAN === Dữ liệu instruction:", {
          discriminator: Buffer.from(addGuardianDiscriminator).toString('hex'),
          guardianId: newGuardianId.toString(),
          guardianIdBytes: Buffer.from(guardianIdBytes).toString('hex'),
          nameLength: guardianNameBuffer.length,
          name: newGuardianName,
          recoveryHashHex: Buffer.from(hashedRecoveryBytes).toString('hex'),
          isOwner: false,
          hasWebauthn: true,
          webauthnPubkey: compressedKeyBuffer.toString('hex')
        });
        
        setTransactionStatus(prev => prev + `\n\nBước 2: Đang thêm guardian vào blockchain...`);
        
        // 11. Tạo transaction add guardian
        const addGuardianTransaction = new Transaction();
        addGuardianTransaction.add(
          new TransactionInstruction({
            keys: [
              { pubkey: multisigAddress, isSigner: false, isWritable: true },
              { pubkey: guardianPDA, isSigner: false, isWritable: true },
              { pubkey: projectFeePayerKeypair.publicKey, isSigner: false, isWritable: false },
              { pubkey: projectFeePayerKeypair.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data: Buffer.from(addGuardianData)
          })
        );
        
        // Sign và gửi transaction với fee payer của dự án
        addGuardianTransaction.feePayer = projectFeePayerKeypair.publicKey;
        addGuardianTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        console.log("=== ADD GUARDIAN === Đang gửi transaction...");
        const addGuardianSignature = await connection.sendTransaction(
          addGuardianTransaction,
          [projectFeePayerKeypair] as Signer[]
        );
        
        console.log("=== ADD GUARDIAN === Transaction đã gửi. Signature:", addGuardianSignature);
        
        setTransactionStatus(prev => prev + `\nĐang xác nhận transaction thêm guardian...`);
        await connection.confirmTransaction(addGuardianSignature);
        
        setTransactionStatus(`Guardian mới đã được thêm thành công với ID: ${newGuardianId}!\n` +
          `Chữ ký WebAuthn đã được lưu cho guardian này.\n` +
          `Signature: ${addGuardianSignature}`
        );
        
        // Kiểm tra xem guardian đã được thêm thành công chưa
        console.log("=== ADD GUARDIAN === Đang kiểm tra guardian vừa thêm...");
        await new Promise(resolve => setTimeout(resolve, 2000)); // Đợi 2 giây
        
        const newGuardianAccount = await connection.getAccountInfo(guardianPDA);
        if (newGuardianAccount) {
          console.log("=== ADD GUARDIAN === Guardian đã được thêm thành công!");
          console.log(`=== ADD GUARDIAN === Data size: ${newGuardianAccount.data.length} bytes`);
          
          // Kiểm tra discriminator
          const discriminator = newGuardianAccount.data.slice(0, 8);
          console.log(`=== ADD GUARDIAN === Discriminator: ${Buffer.from(discriminator).toString('hex')}`);
        } else {
          console.log("=== ADD GUARDIAN === Guardian không được tìm thấy sau khi thêm!");
          setTransactionStatus(prev => prev + '\n\nCẢNH BÁO: Guardian có vẻ như chưa được khởi tạo trên blockchain mặc dù transaction đã thành công!');
        }
        
        // Cập nhật danh sách guardian
        await getExistingGuardianIds();
        
        // Cập nhật số dư của ví PDA
        await loadPdaBalance(multisigAddress);
        
        // Reset form
        setNewGuardianName('');
        setNewRecoveryPhrase('');
      } catch (webAuthnError: any) {
        console.error("=== ADD GUARDIAN === Lỗi khi tạo khóa WebAuthn:", webAuthnError);
        setTransactionStatus(`Lỗi khi tạo khóa WebAuthn: ${webAuthnError.message || 'Không xác định'}. Vui lòng thử lại.`);
        return;
      }
    } catch (error: any) {
      console.error("=== ADD GUARDIAN === Lỗi khi thêm guardian mới:", error);
      setTransactionStatus(`Lỗi khi thêm guardian mới: ${error.message}`);
    }
  };

  // Hàm để nạp SOL vào ví multisig
  const depositToMultisig = async () => {
    try {
      // Kiểm tra xem ví đã được tạo chưa
      if (!multisigAddress) {
        setTransactionStatus('Vui lòng tạo ví trước khi nạp tiền.');
        return;
      }
      
      // Kiểm tra xem có fee payer hay không
      if (!projectFeePayerKeypair) {
        setTransactionStatus('Không tìm thấy fee payer của dự án. Vui lòng thử lại sau.');
        return;
      }
      
      // Kiểm tra số tiền hợp lệ
      if (!depositAmount || depositAmount <= 0) {
        setTransactionStatus('Vui lòng nhập số tiền hợp lệ để nạp.');
        return;
      }
      
      // Kiểm tra số dư của fee payer
      const feePayerBalance = await connection.getBalance(projectFeePayerKeypair.publicKey);
      const lamportsToSend = depositAmount * LAMPORTS_PER_SOL;
      
      if (feePayerBalance < lamportsToSend + 5000) { // 5000 lamports cho phí giao dịch
        setTransactionStatus(`Số dư fee payer không đủ. Hiện tại: ${feePayerBalance / LAMPORTS_PER_SOL} SOL`);
        return;
      }
      
      setTransactionStatus(`Đang nạp ${depositAmount} SOL vào ví...`);
      
      // Tạo transaction chuyển tiền
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: projectFeePayerKeypair.publicKey,
          toPubkey: multisigAddress,
          lamports: lamportsToSend
        })
      );
      
      // Cấu hình transaction
      transaction.feePayer = projectFeePayerKeypair.publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      
      // Ký và gửi transaction
      const signature = await connection.sendTransaction(
        transaction,
        [projectFeePayerKeypair]
      );
      
      await connection.confirmTransaction(signature);
      
      // Cập nhật số dư
      await loadPdaBalance(multisigAddress);
      await loadFeePayerBalance(projectFeePayerKeypair);
      
      setTransactionStatus(`Đã nạp thành công ${depositAmount} SOL vào ví! Signature: ${signature}`);
    } catch (error: any) {
      console.error('Lỗi khi nạp tiền vào ví:', error);
      setTransactionStatus(`Lỗi khi nạp tiền: ${error.message}`);
    }
  };

  

  // Tự động cập nhật danh sách guardians khi multisigAddress thay đổi
  useEffect(() => {
    if (multisigAddress) {
      // Load lại danh sách guardian IDs
      getExistingGuardianIds();
      
      // Load số dư của PDA
      loadPdaBalance(multisigAddress);
    }
  }, [multisigAddress]);

  // Hàm để kiểm tra guardian ID cụ thể
  const testGuardianInfo = async (id: number) => {
    if (!multisigAddress) {
      setTransactionStatus('Ví chưa được khởi tạo');
      return;
    }
    
    setTransactionStatus(`Đang kiểm tra chi tiết Guardian ID ${id}...`);
    
    try {
      // Tính PDA 
      const guardianPDA = await findGuardianAddress(id);
      if (!guardianPDA) {
        setTransactionStatus(`Không thể tính PDA cho Guardian ID ${id}`);
        return;
      }
      
      console.log(`=== TEST === Đang kiểm tra chi tiết Guardian ID ${id} tại ${guardianPDA.toString()}`);
      
      const guardianAccount = await connection.getAccountInfo(guardianPDA);
      if (!guardianAccount) {
        console.log(`=== TEST === Account không tồn tại tại địa chỉ ${guardianPDA.toString()}`);
        setTransactionStatus(`Guardian ID ${id} không tồn tại trên blockchain`);
        return;
      }
      
      console.log(`=== TEST === Account tồn tại!`);
      console.log(`=== TEST === Owner: ${guardianAccount.owner.toString()}`);
      console.log(`=== TEST === Data size: ${guardianAccount.data.length} bytes`);
      
      // Kiểm tra discriminator
      const discriminator = guardianAccount.data.slice(0, 8);
      console.log(`=== TEST === Discriminator: ${Buffer.from(discriminator).toString('hex')}`);
      
      // Bỏ qua 8 byte discriminator
      const data = guardianAccount.data.slice(8);
      
      try {
        // Wallet (32 bytes)
        const walletBytes = data.slice(0, 32);
        const wallet = new PublicKey(walletBytes);
        console.log(`=== TEST === Wallet: ${wallet.toString()}`);
        
        // Guardian ID (8 bytes)
        const guardianIdBytes = data.slice(32, 40);
        let guardianId = BigInt(0);
        for (let i = 0; i < 8; i++) {
          guardianId |= BigInt(guardianIdBytes[i]) << BigInt(8 * i);
        }
        console.log(`=== TEST === Guardian ID parsed: ${guardianId}`);
        
        // Name
        const nameLength = new DataView(data.buffer, data.byteOffset + 40, 4).getUint32(0, true);
        console.log(`=== TEST === Name length: ${nameLength}`);
        
        // Nếu name length hợp lệ, tiếp tục parse
        if (nameLength <= 100) {
          const nameBytes = data.slice(44, 44 + nameLength);
          const name = new TextDecoder().decode(nameBytes);
          console.log(`=== TEST === Name: ${name}`);
          
          setTransactionStatus(`Guardian ID ${id} tồn tại!\n- PDA: ${guardianPDA.toString()}\n- Wallet: ${wallet.toString()}\n- Name: ${name}\n- Guardian ID: ${guardianId}`);
        } else {
          console.log(`=== TEST === Name length không hợp lệ`);
          setTransactionStatus(`Guardian ID ${id} tồn tại nhưng có cấu trúc dữ liệu không hợp lệ`);
        }
      } catch (parseError) {
        console.error(`=== TEST === Lỗi khi parse dữ liệu:`, parseError);
        setTransactionStatus(`Guardian ID ${id} tồn tại nhưng không thể parse dữ liệu: ${parseError}`);
      }
      
    } catch (error: any) {
      console.error(`=== TEST === Lỗi:`, error);
      setTransactionStatus(`Lỗi khi kiểm tra: ${error.message}`);
    }
  };

  // Hàm đăng nhập vào ví đã tạo
  const loginToWallet = async () => {
    try {
      setIsLoggingIn(true);
      setTransactionStatus('Đang đăng nhập vào ví...\n\nBước 1: Đang yêu cầu xác thực WebAuthn...');
      
      // 1. Yêu cầu người dùng xác thực với thiết bị (không cần nhập credential ID cụ thể)
      try {
        // Gọi hàm getWebAuthnAssertionForLogin với allowEmpty=true để cho phép người dùng chọn từ bất kỳ credential nào
        const assertionResult = await getWebAuthnAssertionForLogin('', true);
        
        if (!assertionResult.success || !assertionResult.rawId) {
          throw new Error(assertionResult.error || 'Không thể xác thực với thiết bị');
        }
        
        // Lấy thông tin credential từ phản hồi
        const credentialRawData = assertionResult.rawId;
        
        // Chuyển rawId thành hex để sử dụng làm key trong bảng webauthn_credentials
        const credentialIdHex = Buffer.from(credentialRawData).toString('hex');
        console.log("Credential ID (hex):", credentialIdHex);
        
        // Chuyển rawId thành base64 để sử dụng trong blockchain
        const rawIdBase64 = Buffer.from(credentialRawData).toString('base64');
        console.log("Raw credential ID (base64):", rawIdBase64);
        
        setTransactionStatus(prev => prev + '\nXác thực WebAuthn thành công!\n\nBước 2: Đang tìm thông tin ví...');
        
        // 2. Truy vấn thông tin ví từ bảng webauthn_credentials
        const credentialMapping = await getWalletByCredentialId(credentialIdHex);
        
        if (credentialMapping) {
          // Nếu tìm thấy trong bảng ánh xạ
          setTransactionStatus(prev => prev + `\nĐã tìm thấy thông tin ví trong database!`);
          
          // Chuyển đổi từ chuỗi sang PublicKey
          const walletAddressFromDB = new PublicKey(credentialMapping.walletAddress);
          console.log("Wallet address from database:", walletAddressFromDB.toString());
          
          // 3. Kiểm tra xem ví có tồn tại trên blockchain không
          const walletAccount = await connection.getAccountInfo(walletAddressFromDB);
          
          if (!walletAccount) {
            setTransactionStatus(`Ví tìm thấy trong database không tồn tại trên blockchain. Địa chỉ: ${walletAddressFromDB.toString()}`);
            setIsLoggingIn(false);
            return;
          }
          
          // 4. Cập nhật state với thông tin ví
          setMultisigAddress(walletAddressFromDB);
          setCredentialId(rawIdBase64); // Lưu credential ID gốc
          
          setTransactionStatus(prev => prev + `\nĐã tìm thấy ví tại địa chỉ: ${walletAddressFromDB.toString()}\n\nBước 3: Đang tải thông tin ví...`);
        } else {
          // Nếu không tìm thấy trong bảng ánh xạ, sử dụng phương pháp tính toán cũ
          setTransactionStatus(prev => prev + '\nKhông tìm thấy thông tin trong database, đang tính toán địa chỉ ví...');
          
          // Tính địa chỉ ví từ credential ID
          const multisigPDA = getMultisigPDA(rawIdBase64);
          console.log("Computed Multisig PDA:", multisigPDA.toString());
          
          // Kiểm tra xem ví có tồn tại không
          const walletAccount = await connection.getAccountInfo(multisigPDA);
          
          if (!walletAccount) {
            setTransactionStatus(`Không tìm thấy ví với credential này. Có thể bạn cần tạo ví mới.`);
            setIsLoggingIn(false);
            return;
          }
          
          setTransactionStatus(prev => prev + `\nĐã tìm thấy ví tại địa chỉ: ${multisigPDA.toString()}\n\nBước 3: Đang tải thông tin ví...`);
          
          // Cập nhật state với thông tin ví
          setMultisigAddress(multisigPDA);
          setCredentialId(rawIdBase64); // Lưu credential ID gốc
        }
        
        // 5. Tìm guardian PDA
        await findGuardianAddress(1); // Tìm guardian chính (owner)
        
        // 6. Tải số dư và danh sách guardian
        await loadPdaBalance(multisigAddress!);
        await getExistingGuardianIds();
        
        // 7. Hoàn thành đăng nhập
        setIsLoggedIn(true);
        setIsLoggingIn(false);
        setTransactionStatus(`Đăng nhập thành công!\n\nĐịa chỉ ví: ${multisigAddress!.toString()}\nSố guardian: ${existingGuardians.length}`);
        
        // 8. Ẩn form đăng nhập
        setShowLoginForm(false);
      } catch (webAuthnError: any) {
        console.error("Lỗi khi xác thực WebAuthn:", webAuthnError);
        setTransactionStatus(`Lỗi khi xác thực: ${webAuthnError.message}`);
        setIsLoggingIn(false);
      }
    } catch (error: any) {
      console.error('Lỗi khi đăng nhập:', error);
      setTransactionStatus(`Lỗi khi đăng nhập: ${error.message}`);
      setIsLoggingIn(false);
    }
  };

  // Hàm tạo mã mời ngẫu nhiên
  const generateRandomCode = (length: number): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
      result += chars.charAt(randomValues[i] % chars.length);
    }
    return result;
  };

  // Hàm tạo link mời guardian mới
  const generateGuardianInvite = async () => {
    try {
      // Kiểm tra ví đã được tạo chưa
      if (!multisigAddress) {
        setTransactionStatus('Vui lòng tạo ví trước khi mời guardian.');
        return;
      }
      
      const existingIds = await getExistingGuardianIds();
      const newGuardianId = generateNewGuardianId(existingIds);
      const inviteCode = generateRandomCode(8);
      const ngrokUrl = process.env.REACT_APP_NGROK_URL || window.location.origin;
      const inviteLink = `${ngrokUrl}/#/guardian-signup/${inviteCode}`;
      
      setInviteCode(inviteCode);
      setInviteLink(inviteLink);
      setShowQRCode(true);

      try {
        await saveInvitation({
          multisigAddress: multisigAddress.toString(),
          guardianId: newGuardianId,
          inviteCode,
          status: 'pending',
          ownerId: projectFeePayerKeypair?.publicKey.toString() || ''
        });
      } catch (error) {
        console.error("Lỗi khi lưu vào Firebase:", error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setTransactionStatus(`Đã tạo link mời guardian: ${inviteLink}\nLưu ý: Có lỗi khi lưu thông tin: ${errorMessage}`);
        return inviteLink;
      }
      
      setTransactionStatus(`Đã tạo link mời guardian: ${inviteLink}`);
      
      return inviteLink;
    } catch (error: any) {
      console.error("Lỗi khi tạo link mời guardian:", error);
      setTransactionStatus(`Lỗi khi tạo link mời guardian: ${error.message}`);
      return null;
    }
  };

  const loadPendingInvites = async () => {
    try {
      if (!projectFeePayerKeypair || !multisigAddress) return;
      
      const ownerId = projectFeePayerKeypair.publicKey.toString();
      // Chỉ lọc guardian của chính ví multisig hiện tại
      const multisigAddressStr = multisigAddress.toString();
      const invitesList = await getPendingInvites(ownerId, multisigAddressStr);
      setPendingInvites(invitesList);
      
      if (invitesList.length > 0) {
        console.log(`Tìm thấy ${invitesList.length} guardian đang chờ hoàn tất cho ví ${multisigAddressStr}. Mã mời: ${invitesList.join(', ')}`);
      }
    } catch (error) {
      console.error("Lỗi khi tải danh sách mã mời:", error);
    }
  };

 
  useEffect(() => {
    if (projectFeePayerKeypair && multisigAddress) {
      loadPendingInvites();
    }
  }, [projectFeePayerKeypair, multisigAddress]);



  // Hoàn tất quá trình đăng ký guardian dựa trên mã mời
  const completeGuardianSetup = async (inviteCode: string) => {
    try {
      setTransactionStatus(`Đang hoàn tất quá trình đăng ký guardian với mã mời: ${inviteCode}...`);
      
      // 1. Lấy thông tin guardian
      const guardianData = await getGuardianData(inviteCode);
      if (!guardianData) {
        setTransactionStatus('Không tìm thấy thông tin guardian. Vui lòng đảm bảo guardian đã hoàn tất đăng ký.');
        return;
      }
      
      if (guardianData.status !== 'ready') {
        setTransactionStatus(`Guardian có trạng thái không hợp lệ: ${guardianData.status}`);
        return;
      }
      
      // 2. Thêm guardian vào blockchain
      setTransactionStatus(prev => prev + '\n\nĐang thêm guardian vào blockchain...');
      
      // Tạo multisig PDA từ địa chỉ multisig
      const multisigPubkey = new PublicKey(guardianData.multisigAddress);
      
      // Tạo WebAuthn public key từ dữ liệu lưu trữ
      const webauthnPubkey = Buffer.from(new Uint8Array(guardianData.webauthnPublicKey));
      
      // Chuẩn bị dữ liệu guardian
      const guardianIndex = guardianData.guardianId;
      const guardianName = guardianData.guardianName;
      const guardianType = 0; // 0 = Guardian thường
      const recoveryHash = Uint8Array.from(guardianData.hashedRecoveryBytes);
      
      // Thêm guardian vào blockchain
      if (projectFeePayerKeypair) {
        // Tạo transaction
        const tx = new Transaction();
        
        // Tìm PDA cho guardian
        const guardianIdBigInt = BigInt(guardianIndex);
        const guardianIdBytes = bigIntToLeBytes(guardianIdBigInt);
        
        const [guardianPDA] = await PublicKey.findProgramAddress(
          [
            Buffer.from("guardian"),
            multisigPubkey.toBuffer(),
            guardianIdBytes
          ],
          PROGRAM_ID
        );
        
        const addGuardianDiscriminator = new Uint8Array([167, 189, 170, 27, 74, 240, 201, 241]);
        
        // Chuẩn bị tên guardian
        const guardianNameBuffer = Buffer.from(guardianName);
        const guardianNameLenBuffer = Buffer.alloc(4);
        guardianNameLenBuffer.writeUInt32LE(guardianNameBuffer.length, 0);
        
        // Đặt is_owner = false vì đây là guardian member, không phải owner
        const isOwnerByte = new Uint8Array([1]); // false = 0
        
        // Cấu hình webauthn_pubkey là Some(webauthnPubkey)
        const hasWebauthn = new Uint8Array([1]); // Some variant
        
        // Tạo dữ liệu instruction
        const instructionData = concatUint8Arrays(
          addGuardianDiscriminator,
          guardianIdBytes,
          bufferToUint8Array(guardianNameLenBuffer),
          bufferToUint8Array(guardianNameBuffer),
          recoveryHash,
          isOwnerByte,
          hasWebauthn,
          bufferToUint8Array(webauthnPubkey)
        );
        
        const addGuardianIx = new TransactionInstruction({
          keys: [
            { pubkey: multisigPubkey, isSigner: false, isWritable: true },
            { pubkey: guardianPDA, isSigner: false, isWritable: true },
            { pubkey: projectFeePayerKeypair.publicKey, isSigner: false, isWritable: false },
            { pubkey: projectFeePayerKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
          ],
          programId: PROGRAM_ID,
          data: Buffer.from(instructionData)
        });
        
        tx.add(addGuardianIx);
        
        // Gửi transaction
        setTransactionStatus(prev => prev + '\nĐang gửi transaction...');
        const signature = await sendAndConfirmTransaction(
          connection,
          tx,
          [projectFeePayerKeypair],
          {
            commitment: 'confirmed',
            skipPreflight: true,
          }
        );
        
        // Xác nhận transaction đã thành công
        setTransactionStatus(prev => prev + '\nĐang xác nhận transaction...');
        await connection.confirmTransaction(signature, 'confirmed');
        
        // Cập nhật trạng thái guardian
        await updateGuardianStatus(inviteCode, 'completed', signature);
        
        // Thông báo kết quả
        setTransactionStatus(`Guardian đã được thêm thành công vào blockchain!
- Tên: ${guardianData.guardianName}
- ID: ${guardianData.guardianId}
- Địa chỉ: ${guardianPDA.toString()}
- Signature: ${signature}

Guardian đã sẵn sàng để sử dụng trong ví multisig của bạn.`);
        
        // Xóa dữ liệu guardian từ database sau khi hoàn tất
        setTransactionStatus(prev => prev + '\n\nĐang xóa dữ liệu guardian từ database...');
        console.log(`Bắt đầu xóa dữ liệu guardian với mã mời: ${inviteCode}`);
        const deleteResult = await deleteGuardianData(inviteCode);
        
        if (deleteResult) {
          console.log(`✅ ĐÃ XÓA THÀNH CÔNG dữ liệu guardian, invitation và lookup với mã mời: ${inviteCode}`);
          
          // Cập nhật thông báo thành công rõ ràng hơn
          setTransactionStatus(`✅ HOÀN TẤT THÀNH CÔNG!
          
          Guardian "${guardianData.guardianName}" (ID: ${guardianData.guardianId}) đã được thêm thành công vào ví.
          
          Địa chỉ Guardian: ${guardianPDA.toString()}
          Signature: ${signature}
          
          ✅ Dữ liệu đã được xóa khỏi database để bảo vệ quyền riêng tư.
          
          ✅ Guardian hiện đã sẵn sàng sử dụng và đã được ẩn khỏi danh sách chờ.`);
          
          // Bỏ mã mời đã sử dụng khỏi danh sách
          setPendingInvites(prev => prev.filter(code => code !== inviteCode));
          
        } else {
          console.error(`❌ KHÔNG THỂ XÓA dữ liệu guardian với mã mời: ${inviteCode}`);
          setTransactionStatus(prev => prev + '\n❌ Không thể xóa dữ liệu guardian từ database.');
        }
        
        // Làm mới danh sách guardian và cập nhật UI
        await getExistingGuardianIds();
        await loadPendingInvites();
        
        // Cập nhật số dư của ví
        if (multisigAddress) {
          await loadPdaBalance(multisigAddress);
        }
      } else {
        setTransactionStatus('Lỗi: Fee payer không khả dụng');
      }
    } catch (error) {
      console.error("Lỗi khi hoàn tất quá trình đăng ký guardian:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTransactionStatus(`Lỗi khi hoàn tất quá trình đăng ký guardian: ${errorMessage}`);
    }
  };

  return (
    <div className="App">
      <header className="bg-blue-600 text-white p-4 mb-4">
        <h1 className="text-2xl font-bold">Moon Wallet - Quản lý Ví Đa Chữ Ký</h1>
      </header>
      <div className="container mx-auto p-4 flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded shadow">
            <h2 className="text-xl font-bold mb-4">Quản lý Ví</h2>
            
            {/* Form để tạo ví mới */}
            <div className="mb-4">
              <input
                type="text"
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                placeholder="Recovery Phrase (tối thiểu 8 ký tự)"
                className="w-full p-2 border rounded mb-2"
              />
            
            </div>
            
            {/* Phần đăng nhập ví, hiển thị khi chưa tạo ví hoặc chưa đăng nhập */}
            {!multisigAddress && (
              <div className="login-section">
                <h2>Ví Moon Wallet</h2>
                
                <div className="wallet-actions">
                  <button 
                    onClick={loginToWallet}
                    className="btn btn-primary"
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? 'Đang đăng nhập...' : 'Đăng nhập bằng WebAuthn'}
                  </button>
                  
                  
                </div>
              </div>
            )}
            
            <div className="connection-info">
              <h2>Thông tin kết nối</h2>
              <p>Đang kết nối tới: <strong>{RPC_ENDPOINT}</strong></p>
              <p>Program ID: <strong>{PROGRAM_ID_STRING}</strong></p>
              <p>Fee Payer: <strong>{projectFeePayerKeypair ? projectFeePayerKeypair.publicKey.toString() : 'Chưa khởi tạo'}</strong></p>
              <p>Số dư Fee Payer: <strong>{isLoadingFeePayerBalance ? 'Đang tải...' : `${feePayerBalance} SOL`}</strong></p>
              <div className="button-row">
                <button 
                  onClick={requestAirdrop}
                  disabled={isLoadingFeePayerBalance}
                >
                  Airdrop 2 SOL cho Fee Payer
                </button>
              </div>
              <div className="info-text">
                Fee payer của dự án cần có SOL để trả phí giao dịch. Nếu số dư = 0, vui lòng Airdrop trước khi tạo ví hoặc thêm guardian.
              </div>
            </div>
            
            <div className="wallet-info">
              <h2>Thông tin ví Moon Wallet</h2>
              <p>Multisig PDA: {multisigAddress ? multisigAddress.toString() : 'Chưa tạo ví'}</p>
              <p>Số dư Ví: <strong>{isLoadingPdaBalance ? 'Đang tải...' : `${pdaBalance} SOL`}</strong></p>
              <p>Guardian PDA: {guardianPDA ? guardianPDA.toString() : 'Chưa có guardian'}</p>
              <div className="button-row">
                <button onClick={getWalletInfo}>Xem thông tin ví</button>
                <div className="guardian-selection">
                  <select 
                    value={selectedGuardianId} 
                    onChange={(e) => setSelectedGuardianId(parseInt(e.target.value))}
                    style={{ margin: '0 10px', padding: '8px' }}
                  >
                    {existingGuardians.map(id => (
                      <option key={id} value={id}>Guardian ID {id}</option>
                    ))}
                  </select>
                  <button 
                    onClick={getGuardianInfo}
                    disabled={!multisigAddress || existingGuardians.length === 0}
                  >
                    Xem thông tin guardian
                  </button>
                </div>
                <button 
                  onClick={() => {
                    if (multisigAddress) {
                      loadPdaBalance(multisigAddress);
                      getExistingGuardianIds();
                    }
                  }}
                  disabled={isLoadingPdaBalance || !multisigAddress}
                >
                  Cập nhật dữ liệu
                </button>
              </div>
              
              {/* Thêm TransferForm khi đã đăng nhập vào ví */}
              {multisigAddress && credentialId && selectedGuardianId && (
                <div className="transfer-section mt-4">
                  <TransferForm 
                    walletAddress={multisigAddress.toString()}
                    credentialId={credentialId}
                    guardianId={selectedGuardianId}
                    onTransferSuccess={() => {
                      // Cập nhật số dư sau khi chuyển tiền thành công
                      if (multisigAddress) {
                        loadPdaBalance(multisigAddress);
                      }
                    }}
                    // Thêm props connection và pdaBalance
                    connection={connection}
                    pdaBalance={pdaBalance}
                  />
                </div>
              )}
            </div>
            
            <div className="create-wallet-section">
              <h2>Tạo ví Moon Wallet</h2>
              
              <p className="info-text">Dự án sẽ trả phí giao dịch tạo ví. Bạn không cần có SOL.</p>
              
              <div className="input-group">
                <label>Tên ví: </label>
                <input 
                  type="text" 
                  value={walletName} 
                  onChange={(e) => setWalletName(e.target.value)} 
                  maxLength={32}
                  placeholder="Nhập tên cho ví của bạn"
                />
              </div>
              
              <div className="input-group">
                <label>Recovery Key: <span className="required">*</span></label>
                <input 
                  type="text" 
                  value={recoveryPhrase} 
                  onChange={(e) => setRecoveryPhrase(e.target.value)} 
                  placeholder="Nhập recovery key (ít nhất 8 ký tự)"
                  style={{width: '300px'}}
                  required
                />
                {recoveryPhrase && recoveryPhrase.length < 8 && (
                  <p className="error-message">Recovery key phải có ít nhất 8 ký tự</p>
                )}
              </div>
              
              <div className="input-group">
                <label>Threshold: </label>
                <input 
                  type="number" 
                  min="1" 
                  max="8" 
                  value={threshold} 
                  onChange={(e) => setThreshold(parseInt(e.target.value))} 
                />
              </div>
              
              <div className="input-group">
                <label>Tên Guardian: </label>
                <input 
                  type="text" 
                  value={guardianName} 
                  onChange={(e) => setGuardianName(e.target.value)} 
                  maxLength={32}
                  placeholder="Tên cho guardian đầu tiên (mặc định: Owner)"
                />
              </div>
              
              <button 
                onClick={createWalletWithWebAuthn} 
                disabled={isLoadingBalance || !recoveryPhrase || recoveryPhrase.length < 8}
                className="create-wallet-button"
              >
                Tạo ví Moon Wallet
              </button>
              
              {credentialId && (
                <div className="credential-info">
                  <p>Credential ID: {credentialId.slice(0, 10)}...</p>
                </div>
              )}
            </div>
            
            {/* Thêm phần UI cho việc thêm guardian mới */}
            {multisigAddress && (
              <div className="add-guardian-section">
                <h2>Quản lý Guardian</h2>
                
                <div className="existing-guardians">
                  <p><strong>Các Guardian hiện có:</strong></p>
                  {existingGuardians.length > 0 ? (
                    <ul className="guardian-list">
                      {existingGuardians.map(id => (
                        <li key={id} className="guardian-item">
                          Guardian ID {id}
                          {id === 1 && " (Owner)"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Chưa có Guardian nào</p>
                  )}
                </div>

                <div className="guardian-actions">
                  <button 
                    onClick={generateGuardianInvite}
                    className="primary-button"
                  >
                    Tạo lời mời Guardian mới
                  </button>
                  
                  <button 
                    onClick={() => {
                      setShowInviteInput(!showInviteInput);
                      loadPendingInvites();
                    }}
                    className="toggle-button"
                  >
                    {showInviteInput ? 'Ẩn form nhập mã mời' : 'Hoàn tất đăng ký Guardian'}
                  </button>
                  
                  <button 
                    onClick={getExistingGuardianIds}
                    className="update-button"
                  >
                    Cập nhật danh sách guardian
                  </button>
                </div>
                
                {/* Form tạo mã mời */}
                {showQRCode && inviteLink && (
                  <div className="invite-container">
                    <h3>Link mời Guardian</h3>
                    <div className="qr-code">
                      <QRCodeSVG 
                        value={inviteLink}
                        size={200}
                        level="H"
                        includeMargin={true}
                      />
                    </div>
                    <div className="invite-info">
                      <p>Link mời: <a href={inviteLink} target="_blank" rel="noopener noreferrer">{inviteLink}</a></p>
                      <p>Mã mời: <strong>{inviteCode}</strong></p>
                      <p className="note">Gửi link này cho người bạn muốn thêm làm guardian. Họ sẽ hoàn thành quá trình đăng ký và sau đó bạn có thể hoàn tất việc thêm guardian bằng mã mời.</p>
                    </div>
                    <button onClick={() => {
                      setShowQRCode(false);
                      setInviteLink('');
                      setInviteCode('');
                    }}>Đóng</button>
                  </div>
                )}
                
                {/* Form nhập mã mời đã đăng ký */}
                {showInviteInput && (
                  <div className="invite-input-container">
                    <h3>Hoàn tất đăng ký Guardian</h3>
                    
                    {pendingInvites.length > 0 ? (
                      <div className="pending-invites">
                        <p>Các mã mời đang chờ xử lý:</p>
                        <div className="invite-codes">
                          {pendingInvites.map(code => (
                            <div key={code} className="invite-code-item">
                              <span className="code">{code}</span>
                              <button 
                                onClick={() => completeGuardianSetup(code)}
                                className="complete-button"
                              >
                                Hoàn tất
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p>Không có mã mời nào đang chờ xử lý.</p>
                    )}
                    
                    <div className="manual-input">
                      <p>Hoặc nhập mã mời thủ công:</p>
                      <input 
                        type="text" 
                        placeholder="Nhập mã mời" 
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        className="invite-input"
                      />
                      <button 
                        onClick={() => inviteCode && completeGuardianSetup(inviteCode)}
                        disabled={!inviteCode}
                        className="complete-button"
                      >
                        Hoàn tất đăng ký
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="guardian-test-actions mt-3" style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                  <button onClick={() => testGuardianInfo(1)} className="btn btn-sm btn-info">Kiểm tra Guardian 1</button>
                  <button onClick={() => testGuardianInfo(2)} className="btn btn-sm btn-info">Kiểm tra Guardian 2</button>
                  <button onClick={() => testGuardianInfo(3)} className="btn btn-sm btn-info">Kiểm tra Guardian 3</button>
                </div>
              </div>
            )}
            
            {/* Chức năng nạp tiền vào ví multisig */}
            <div className="card mb-3">
              <div className="card-header bg-primary text-white">
                <h5 className="mb-0">Nạp tiền vào ví Multisig</h5>
              </div>
              <div className="card-body">
                <div className="form-group mb-3">
                  <label htmlFor="depositAmount">Số lượng SOL:</label>
                  <input
                    type="number"
                    id="depositAmount"
                    className="form-control"
                    step="0.01"
                    min="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(parseFloat(e.target.value))}
                    placeholder="Nhập số lượng SOL"
                  />
                </div>
                <button 
                  className="btn btn-primary w-100"
                  onClick={depositToMultisig}
                  disabled={!multisigAddress}
                >
                  Nạp tiền vào ví
                </button>
              </div>
            </div>
            
            {transactionStatus && (
              <div className="transaction-status">
                <h3>Trạng thái giao dịch</h3>
                <p style={{whiteSpace: 'pre-line'}}>{transactionStatus}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;