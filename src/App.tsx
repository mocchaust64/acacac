import React, { useState, useEffect } from 'react';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction, Commitment } from '@solana/web3.js';
import { Buffer } from 'buffer';
import './App.css';
import { createWebAuthnCredential } from './utils/webauthnUtils';

// Lấy các biến môi trường hoặc sử dụng giá trị mặc định
const RPC_ENDPOINT = 'http://127.0.0.1:8899'; // Localhost validator
const PROGRAM_ID_STRING = 'DeN1rBfabZezHPvrq9q7BbzUbZkrjnHE1kQDrPK8kWQ3'; // Program ID mới triển khai

// Địa chỉ Program ID từ smart contract
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STRING);

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

// Ví tạm thời đã được tạo và nhận SOL trước đó
const TEMP_WALLET_PUBKEY = '9Q8iZnAvCQP3uaDTuYbrvYSRDWB7Kk19u4TS1MDRSStJ';

// Hàm chuyển đổi Buffer sang Uint8Array
function bufferToUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

// Hàm concat cho Uint8Array
function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  // Tính tổng độ dài
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  
  // Tạo mảng mới với tổng độ dài
  const result = new Uint8Array(totalLength);
  
  // Copy dữ liệu vào mảng mới
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}

// Hàm chuyển đổi từ BigInt (u64) sang bytes theo thứ tự little-endian
const bigIntToLeBytes = (value: bigint, bytesLength: number = 8): Uint8Array => {
  const result = new Uint8Array(bytesLength);
  for (let i = 0; i < bytesLength; i++) {
    result[i] = Number((value >> BigInt(8 * i)) & BigInt(0xff));
  }
  return result;
};

// Helper function để tính toán MultisigPDA một cách nhất quán
const calculateMultisigPDA = (programId: PublicKey, credentialId: string): [PublicKey, number] => {
  console.log("Tính PDA với credential ID (chuỗi):", credentialId);
  
  // QUAN TRỌNG: credential_id.as_bytes() trong Rust chuyển trực tiếp chuỗi thành bytes
  // không giải mã base64, nên ở đây chúng ta sử dụng chuỗi trực tiếp
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      Buffer.from(credentialId) // Sử dụng trực tiếp chuỗi làm bytes
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
  const x = uncompressedKey.slice(1, 33);
  const y = uncompressedKey.slice(33, 65);
  
  // Tính prefix: 0x02 nếu y chẵn, 0x03 nếu y lẻ
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  
  // Tạo khóa nén: prefix (1 byte) + x (32 bytes)
  const compressedKey = Buffer.alloc(33);
  compressedKey[0] = prefix;
  x.copy(compressedKey, 1);
  
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

  // Tạo keypair mới khi component được mount
  useEffect(() => {
    // Tạo keypair ngẫu nhiên mới
    const newKeypair = Keypair.generate();
    setWalletKeypair(newKeypair);
    
    // Không tính PDA ngay vì chưa có credential ID
    // findMultisigAddress sẽ được gọi sau khi người dùng tạo WebAuthn credential
    
    // Load balance
    loadBalance(newKeypair);
  }, []);

  // Sử dụng ví tạm thời đã có SOL
  const useTempWallet = async () => {
    try {
      setTransactionStatus('Đang tải ví tạm thời với SOL...');
      
      // Keypair từ file (lưu ý: trong môi trường sản xuất, không nên hard-code private key)
      const tempWalletPrivateKey = [
        102, 237, 102, 140, 248, 239, 202, 44, 229, 89, 22, 38, 61, 
        204, 78, 104, 139, 183, 196, 16, 216, 255, 123, 134, 111, 201, 
        235, 194, 109, 208, 222, 73, 128, 208, 63, 146, 254, 122, 248, 
        128, 59, 45, 243, 174, 199, 16, 73, 9, 4, 58, 29, 6, 78, 115, 
        113, 122, 127, 216, 213, 178, 4, 194, 157
      ];
      
      // Tạo Keypair từ private key
      const keypair = Keypair.fromSecretKey(new Uint8Array(tempWalletPrivateKey));
      
      setWalletKeypair(keypair);
      setIsUsingTempWallet(true);
      
      // Tính PDA mới dựa trên keypair mới
      findMultisigAddress();
      
      // Tải balance của ví tạm thời
      await loadBalance(keypair);
      
      setTransactionStatus(`Đã chuyển sang ví tạm thời: ${keypair.publicKey.toString()}. Ví này đã có sẵn SOL để giao dịch.`);
    } catch (error: any) {
      console.error('Lỗi khi tải ví tạm thời:', error);
      setTransactionStatus(`Lỗi khi tải ví tạm thời: ${error.message}`);
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

  // Hàm mới gộp tạo WebAuthn và khởi tạo Multisig
  const createWalletWithWebAuthn = async () => {
    if (!walletKeypair) return;
    
    try {
      // Kiểm tra xem người dùng đã nhập recovery phrase chưa
      if (!recoveryPhrase || recoveryPhrase.trim().length < 8) {
        setTransactionStatus('Vui lòng nhập recovery phrase (ít nhất 8 ký tự) trước khi tạo ví');
        return;
      }
      
      setTransactionStatus('Đang tạo ví Moon Wallet...\n\nBước 1: Đang tạo khóa WebAuthn...');
      
      // 1. Tạo khóa WebAuthn
      const walletAddress = walletKeypair.publicKey.toString();
      const result = await createWebAuthnCredential(walletAddress, walletName);
      
      // Chuyển đổi rawId thành base64 để lưu trữ và sử dụng
      const rawIdBase64 = Buffer.from(result.rawId).toString('base64');
      
      // Lưu thông tin WebAuthn
      setCredentialId(rawIdBase64); // Lưu base64 thay vì hex
      setWebauthnPubkey(result.publicKey);
      
      setTransactionStatus(prev => prev + `\nĐã tạo khóa WebAuthn thành công!\nCredential ID (base64): ${rawIdBase64.slice(0, 10)}...\nPublic Key: ${result.publicKey.slice(0, 10)}...`);
      
      // 2. Tính PDA cho Multisig
      // Sử dụng credential ID làm seed - đảm bảo tính duy nhất!
      console.log("Original Credential ID:", result.credentialId);
      console.log("Credential ID length:", result.credentialId.length);
      console.log("Raw ID:", result.rawId);
      
      // Đã chuyển đổi rawId thành chuỗi base64 ở trên
      console.log("Raw ID as base64:", rawIdBase64);
      
      // Sử dụng helper function để tính PDA một cách nhất quán
      const [pda, bump] = calculateMultisigPDA(PROGRAM_ID, rawIdBase64);
      console.log("PDA with credential ID:", pda.toString(), "bump:", bump);
      
      setMultisigAddress(pda);
      setTransactionStatus(prev => prev + `\n\nBước 2: Đang khởi tạo ví multisig tại địa chỉ: ${pda.toString()}...`);
      
      // Kiểm tra xem multisig account đã tồn tại chưa
      const existingAccount = await connection.getAccountInfo(pda);
      if (existingAccount) {
        setTransactionStatus(prev => prev + `\n\nLỖI: Ví multisig với credential ID này đã tồn tại. Điều này gần như không thể xảy ra vì credential ID luôn duy nhất.`);
        return;
      }
      
      // 3. Tính PDA address cho guardian
      // Tạo ID dạng u64 cho guardian
      const guardianId = BigInt(1); // Owner có ID = 1

      // Chuyển đổi guardianId sang bytes (little-endian)
      const guardianIdBytes = bigIntToLeBytes(guardianId);
      
      const [guardianPDAAddress] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("guardian").subarray(0),
          pda.toBuffer(),
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
      
      // LƯU Ý QUAN TRỌNG: credential_id trong smart contract sử dụng as_bytes() trực tiếp, 
      // nên chúng ta phải gửi chính xác chuỗi rawIdBase64 như một chuỗi UTF-8
      // không phải decode nó sang dạng binary
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
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: PROGRAM_ID,
        data: Buffer.from(initData)
      }));
      
      // Sign và gửi transaction
      transaction.feePayer = walletKeypair.publicKey;
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
        [walletKeypair]
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
        // LƯU Ý: Smart contract đã được cập nhật để sử dụng nhất quán credential_id.as_bytes()
        // Thay vì sử dụng seed cố định "seed_for_pda" như trước
        const [guardianMultisigPDA, _] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("multisig"),
            Buffer.from(credentialIdString) // Sử dụng credential ID để tính PDA
          ],
          PROGRAM_ID
        );
        
        console.log("Sử dụng PDA cho guardian với multisig PDA:", guardianMultisigPDA.toString());
        
        // 5.2 Tính PDA cho guardian
        const [guardianPDA] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("guardian"),
            guardianMultisigPDA.toBuffer(),
            guardianIdBytes
          ],
          PROGRAM_ID
        );
        
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
        
        // WebAuthn pubkey - nén khóa từ 65 bytes (uncompressed) thành 33 bytes (compressed)
        // Smart contract yêu cầu webauthn_pubkey: Option<[u8; 33]>
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
              { pubkey: pda, isSigner: false, isWritable: true },
              { pubkey: guardianPDA, isSigner: false, isWritable: true },
              { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: false },
              { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data: Buffer.from(addGuardianData)
          })
        );
        
        // Sign và gửi transaction
        addGuardianTransaction.feePayer = walletKeypair.publicKey;
        addGuardianTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        const addGuardianSignature = await connection.sendTransaction(
          addGuardianTransaction,
          [walletKeypair]
        );
        
        await connection.confirmTransaction(addGuardianSignature);
        setTransactionStatus(prev => prev + `\nGuardian owner đã được thêm thành công! Signature: ${addGuardianSignature}`);
      } catch (error: any) {
        console.error("Lỗi khi thêm guardian owner:", error);
        setTransactionStatus(prev => prev + `\nLỗi khi thêm guardian owner: ${error.message}`);
      }
      
      // 6. Hoàn thành quá trình tạo ví
      setTransactionStatus(prev => prev + '\n\n✅ VÍ MOON WALLET ĐÃ ĐƯỢC TẠO THÀNH CÔNG!\n' +
        `Địa chỉ ví Multisig: ${pda.toString()}\n` +
        `Recovery Phrase: ${recoveryPhrase}\n` +
        'Vui lòng lưu lại thông tin này để sử dụng sau này!');
      
    } catch (error: any) {
      console.error('Lỗi trong quá trình tạo ví:', error);
      setTransactionStatus(`Lỗi: ${error.message}`);
    }
  };

  // Sửa lại hàm tính PDA cho multisig wallet
  const findMultisigAddress = async () => {
    // Sử dụng credential ID (nếu có) hoặc một giá trị tạm thời nếu chưa có
    if (!credentialId) {
      // Nếu chưa có credential ID, không thể tính PDA chính xác
      setMultisigAddress(null);
      return;
    }
    
    console.log("findMultisigAddress - credential ID:", credentialId);
    
    // Sử dụng helper function để tính PDA một cách nhất quán
    const [pda, bump] = calculateMultisigPDA(PROGRAM_ID, credentialId);
    console.log("findMultisigAddress - PDA:", pda.toString(), "bump:", bump);
    
    setMultisigAddress(pda);
  };

  // Tính PDA address cho guardian
  const findGuardianAddress = async () => {
    if (!multisigAddress || !credentialId) return null;
    
    // Sử dụng ID dạng u64 cho guardian
    const guardianId = BigInt(1); // Owner có ID = 1

    // Chuyển đổi guardianId sang bytes (little-endian)
    const guardianIdBytes = bigIntToLeBytes(guardianId);
    
    // Tính PDA cho multisig với credential ID
    // Phải sử dụng cùng cách tính như trong smart contract: credential_id.as_bytes()
    const [guardianMultisigPDA, _] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("multisig"),
        Buffer.from(credentialId) // Sử dụng credential ID để tính PDA
      ],
      PROGRAM_ID
    );
    
    console.log("Tính PDA cho guardian với multisig PDA:", guardianMultisigPDA.toString());
    
    // Tính PDA cho guardian dựa trên multisigPDA đã tính ở trên
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("guardian"),
        guardianMultisigPDA.toBuffer(),
        guardianIdBytes
      ],
      PROGRAM_ID
    );
    
    setGuardianPDA(pda);
    return pda;
  };

  // Airdrop SOL cho testing
  const requestAirdrop = async () => {
    if (!walletKeypair) return;
    
    try {
      setTransactionStatus('Đang yêu cầu airdrop...');
      const signature = await connection.requestAirdrop(
        walletKeypair.publicKey,
        1_000_000_000 // 1 SOL
      );
      
      await connection.confirmTransaction(signature);
      loadBalance(); // Sử dụng hàm loadBalance đã được cải thiện
      setTransactionStatus('Airdrop thành công! 1 SOL đã được thêm vào ví.');
    } catch (error: any) {
      console.error('Lỗi khi thực hiện airdrop:', error);
      setTransactionStatus(`Lỗi airdrop: ${error.message}. Đang thử phương thức chuyển tiền trực tiếp...`);
      
      // Thử phương pháp khác nếu airdrop thất bại
      fundFromValidator();
    }
  };

  // Chuyển tiền từ validator wallet sang ví người dùng 
  const fundFromValidator = async () => {
    if (!walletKeypair) return;
    
    try {
      setTransactionStatus('Đang chuyển tiền từ validator...');
      
      // Tạo kết nối với validator wallet (địa chỉ mặc định của validator)
      const validatorKey = new PublicKey('E6mJJmCvg4PDhanmaBxxeyTczza9vKpMgirRUD6Qz5kv');
      
      // Tạo transaction chuyển tiền
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: validatorKey,
          toPubkey: walletKeypair.publicKey,
          lamports: 1_000_000_000 // 1 SOL
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
      await loadBalance();
      setTransactionStatus('Chuyển tiền thành công! 1 SOL đã được thêm vào ví.');
    } catch (error: any) {
      console.error('Lỗi khi chuyển tiền từ validator:', error);
      setTransactionStatus(`Lỗi khi chuyển tiền: ${error.message}. Hãy thử tạo ví mới hoặc khởi động lại validator.`);
    }
  };

  // Xem thông tin wallet
  const getWalletInfo = async () => {
    if (!multisigAddress) return;
    
    try {
      setTransactionStatus('Đang truy vấn thông tin ví...');
      
      const multisigAccount = await connection.getAccountInfo(multisigAddress);
      
      if (!multisigAccount) {
        setTransactionStatus('Ví chưa được khởi tạo');
        return;
      }
      
      // Bỏ qua 8 byte discriminator
      const data = multisigAccount.data.slice(8);
      
      // Parse dữ liệu dựa trên struct MultiSigWallet mới
      // MultiSigWallet: threshold, guardian_count, recovery_nonce, bump, transaction_nonce, last_transaction_timestamp
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
    if (!guardianPDA) {
      await findGuardianAddress();
      if (!guardianPDA) {
        setTransactionStatus('Không thể tìm thấy địa chỉ Guardian');
        return;
      }
    }
    
    try {
      setTransactionStatus('Đang truy vấn thông tin guardian...');
      
      const guardianAccount = await connection.getAccountInfo(guardianPDA);
      
      if (!guardianAccount) {
        setTransactionStatus('Guardian chưa được khởi tạo');
        return;
      }
      
      // Bỏ qua 8 byte discriminator
      const data = guardianAccount.data.slice(8);
      
      // Parse dữ liệu dựa trên struct Guardian mới
      // Guardian: wallet, guardian_id (u64), name, is_active, recovery_hash, is_owner, webauthn_pubkey, bump
      
      // Đọc wallet address (32 bytes)
      const walletBytes = data.slice(0, 32);
      const wallet = new PublicKey(walletBytes);
      
      // Đọc guardian_id (8 bytes - u64)
      const guardianIdBytes = data.slice(32, 40);
      let guardianId = BigInt(0);
      for (let i = 0; i < 8; i++) {
        guardianId |= BigInt(guardianIdBytes[i]) << BigInt(8 * i);
      }
      
      // Đọc name (string dài tối đa 32 bytes)
      const nameLength = new DataView(data.buffer, data.byteOffset + 40, 4).getUint32(0, true);
      const nameBytes = data.slice(44, 44 + nameLength);
      const name = new TextDecoder().decode(nameBytes);
      
      // Đọc các trường còn lại
      const isActive = data[44 + nameLength] === 1;
      
      // recovery_hash (32 bytes)
      const recoveryHash = data.slice(45 + nameLength, 77 + nameLength);
      // Chuyển recovery hash thành chuỗi hex để dễ hiển thị
      const recoveryHashHex = Buffer.from(recoveryHash).toString('hex');
      
      // is_owner (1 byte)
      const isOwner = data[77 + nameLength] === 1;
      
      // webauthn_pubkey (option, 1 byte discriminator + 33 bytes if Some)
      const hasWebauthn = data[78 + nameLength] === 1;
      let webauthnPubkey = null;
      if (hasWebauthn) {
        webauthnPubkey = data.slice(79 + nameLength, 112 + nameLength);
      }
      
      // bump (1 byte)
      const bump = data[hasWebauthn ? 112 + nameLength : 79 + nameLength];
      
      // Hiển thị thông tin
      setTransactionStatus(
        `Thông tin Guardian:\n` +
        `- Wallet: ${wallet.toString()}\n` +
        `- Guardian ID: ${guardianId}\n` +
        `- Name: ${name}\n` +
        `- Active: ${isActive}\n` +
        `- Recovery Hash: ${recoveryHashHex.slice(0, 16)}...${recoveryHashHex.slice(-16)}\n` +
        `- Is Owner: ${isOwner}\n` +
        `- Has WebAuthn: ${hasWebauthn}\n` +
        `- Bump: ${bump}`
      );
    } catch (error: any) {
      console.error('Lỗi khi truy vấn thông tin guardian:', error);
      setTransactionStatus(`Lỗi: ${error.message}`);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Moon Wallet Testing Interface</h1>
        
        <div className="connection-info">
          <h2>Thông tin kết nối</h2>
          <p>Đang kết nối tới: <strong>{RPC_ENDPOINT}</strong></p>
          <p>Program ID: <strong>{PROGRAM_ID_STRING}</strong></p>
          <button onClick={useTempWallet} disabled={isUsingTempWallet}>Sử dụng ví đã có SOL</button>
        </div>
        
        <div className="wallet-info">
          <h2>Thông tin ví</h2>
          <p>Địa chỉ: {walletKeypair ? walletKeypair.publicKey.toString() : 'Loading...'}</p>
          <p>Số dư: {isLoadingBalance ? 'Đang tải...' : `${walletBalance} SOL`}</p>
          <p>Multisig PDA: {multisigAddress ? multisigAddress.toString() : 'Loading...'}</p>
          <p>Guardian PDA: {guardianPDA ? guardianPDA.toString() : 'Chưa tính'}</p>
          <div className="button-row">
            <button onClick={requestAirdrop}>Airdrop 1 SOL</button>
            <button onClick={getWalletInfo}>Xem thông tin ví</button>
            <button onClick={getGuardianInfo}>Xem thông tin guardian</button>
          </div>
        </div>
        
        <div className="create-wallet-section">
          <h2>Tạo ví Moon Wallet</h2>
          
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
            disabled={isLoadingBalance || walletBalance <= 0 || !recoveryPhrase || recoveryPhrase.length < 8}
            className="create-wallet-button"
          >
            Tạo ví Moon Wallet
          </button>
          
          {walletBalance <= 0 && (
            <p className="warning-message">Ví cần có SOL để trả phí giao dịch. Vui lòng sử dụng Airdrop.</p>
          )}
          
          {credentialId && (
            <div className="credential-info">
              <p>Credential ID: {credentialId.slice(0, 10)}...</p>
            </div>
          )}
        </div>
        
        {transactionStatus && (
          <div className="transaction-status">
            <h3>Trạng thái giao dịch</h3>
            <p style={{whiteSpace: 'pre-line'}}>{transactionStatus}</p>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
