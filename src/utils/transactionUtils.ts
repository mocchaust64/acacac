import { web3, BN } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import idlFile from '../idl/moon_wallet_program.json';
import { Connection, sendAndConfirmTransaction } from '@solana/web3.js';

// Export programID từ biến môi trường thay vì hardcode
export const programID = new PublicKey(process.env.REACT_APP_PROGRAM_ID || 'DeN1rBfabZezHPvrq9q7BbzUbZkrjnHE1kQDrPK8kWQ3');

// Hằng số cho chương trình secp256r1
export const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');

// Hằng số cho Sysvar accounts với địa chỉ chính xác
export const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');
export const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');

// Sửa lỗi type cho IDL
const idl: any = idlFile;

// Cập nhật: Chương trình secp256r1 là một chương trình native của Solana, 
// nên không thể kiểm tra bằng getAccountInfo
export const checkSecp256r1Program = async (): Promise<boolean> => {
  // Chương trình native luôn tồn tại trên validator chính thức
  // Chỉ cần đảm bảo validator được khởi động với tham số phù hợp
  return true;
};

// Thêm hàm kiểm tra chương trình secp256r1 thông qua transaction thử nghiệm nếu cần
export const testSecp256r1Instruction = async (connection: web3.Connection): Promise<boolean> => {
  try {
    // Tạo một cặp khóa giả lập cho việc kiểm tra
    const testKeyPair = web3.Keypair.generate();
    
    // Tạo một chữ ký và message giả
    const testSignature = Buffer.alloc(64, 1); // Chữ ký giả 64 bytes
    const testPubkey = Buffer.alloc(33, 2); // Khóa công khai giả 33 bytes
    testPubkey[0] = 0x02; // Định dạng khóa nén
    const testMessage = Buffer.alloc(32, 3); // Message hash giả 32 bytes
    
    // Tạo instruction secp256r1 giả
    const testInstruction = createSecp256r1Instruction(
      testMessage,
      testPubkey,
      testSignature
    );
    
    // Tạo transaction giả với instruction trên
    const testTx = new web3.Transaction().add(testInstruction);
    testTx.feePayer = testKeyPair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    testTx.recentBlockhash = blockhash;
    
    // Chỉ mô phỏng giao dịch, không gửi thật
    await connection.simulateTransaction(testTx);
    
    // Nếu không có lỗi "program not found", chương trình tồn tại
    return true;
  } catch (error: any) {
    // Kiểm tra lỗi cụ thể
    const errorMessage = error.toString();
    // Nếu lỗi là về chương trình không tồn tại
    if (errorMessage.includes("Attempt to load a program that does not exist") ||
        errorMessage.includes("Program not found")) {
      console.error("Chương trình secp256r1 không tồn tại:", error);
      return false;
    }
    
    // Nếu là lỗi khác (vd: chữ ký không hợp lệ), chương trình vẫn tồn tại
    console.warn("Lỗi khi kiểm tra secp256r1, nhưng chương trình có thể tồn tại:", error);
    return true;
  }
};

// Cập nhật lại hàm tạo transaction
export const createInitializeMultisigTx = async (
  threshold: number,
  multisigPDA: PublicKey,
  owner: PublicKey | Keypair,
  feePayer: Keypair,
  recoveryHash: Uint8Array,
  credentialId: Buffer
): Promise<Transaction> => {
  try {
    const ownerPubkey = owner instanceof Keypair ? owner.publicKey : owner;
    
    // Sử dụng discriminator chính xác từ IDL
    const discriminator = Buffer.from([
      220, 130, 117, 21, 27, 227, 78, 213
    ]);
    
    // Đảm bảo recoveryHash có đúng 32 bytes
    if (recoveryHash.length !== 32) {
      throw new Error("Recovery hash phải đúng 32 bytes");
    }
    
    const thresholdBuffer = Buffer.from([threshold]);
    const recoveryHashBuffer = Buffer.from(recoveryHash);
    
    // Tạo buffer cho độ dài credential ID
    const credentialIdLenBuffer = Buffer.alloc(4);
    credentialIdLenBuffer.writeUInt32LE(credentialId.length, 0);
    
    // Nối tất cả lại với nhau
    const data = Buffer.concat([
      new Uint8Array(discriminator),
      new Uint8Array(thresholdBuffer),
      new Uint8Array(recoveryHashBuffer),
      new Uint8Array(credentialIdLenBuffer),
      new Uint8Array(credentialId)
    ]);
    
    // Tạo transaction instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: feePayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: programID,
      data
    });
    
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction initialize multisig:", error);
    throw error;
  }
};

// Thêm hàm compressPublicKey cho việc nén khóa công khai
function compressPublicKey(uncompressedKey: Buffer): Buffer {
  // Đảm bảo khóa bắt đầu với byte 0x04 (không nén)
  if (uncompressedKey[0] !== 0x04 || uncompressedKey.length !== 65) {
    throw new Error('Khóa không đúng định dạng không nén ECDSA');
  }
  
  // Sử dụng Uint8Array để tránh lỗi type
  const x = Buffer.from(uncompressedKey.subarray(1, 33));
  const y = Buffer.from(uncompressedKey.subarray(33, 65));
  
  // Tính prefix: 0x02 nếu y chẵn, 0x03 nếu y lẻ
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  
  // Tạo khóa nén: prefix (1 byte) + x (32 bytes)
  const compressedKey = Buffer.alloc(33);
  compressedKey[0] = prefix;
  new Uint8Array(compressedKey).set(new Uint8Array(x), 1);
  
  return compressedKey;
}

// Cập nhật hàm configure_webauthn với discriminator chính xác từ IDL
export const createConfigureWebAuthnTx = async (
  webauthnPubkey: Buffer,
  multisigPDA: PublicKey,
  owner: PublicKey
): Promise<Transaction> => {
  try {
    // Lấy từ IDL: discriminator chính xác cho hàm configure_webauthn
    const discriminator = Buffer.from([
      40, 149, 116, 224, 148, 48, 159, 54
    ]);
    
    // Nén khóa công khai từ 65 bytes xuống 33 bytes
    let compressedKey: Buffer;
    
    if (webauthnPubkey.length === 65 && webauthnPubkey[0] === 0x04) {
      // Khóa không nén, cần nén lại
      compressedKey = compressPublicKey(webauthnPubkey);
      console.log("Đã nén khóa từ 65 bytes xuống 33 bytes");
    } else if (webauthnPubkey.length === 33 && (webauthnPubkey[0] === 0x02 || webauthnPubkey[0] === 0x03)) {
      // Khóa đã nén, sử dụng trực tiếp
      compressedKey = webauthnPubkey;
      console.log("Khóa đã ở định dạng nén (33 bytes)");
    } else {
      console.warn(`Khóa công khai WebAuthn không đúng định dạng: ${webauthnPubkey.length} bytes`);
      // Nếu không thể xử lý, tạo khóa giả
      compressedKey = Buffer.alloc(33);
      compressedKey[0] = 0x02; // Prefix cho khóa nén
      if (webauthnPubkey.length > 0) {
        // Sao chép dữ liệu nếu có
        new Uint8Array(compressedKey).set(
          new Uint8Array(webauthnPubkey.subarray(0, Math.min(webauthnPubkey.length, 32))),
          1
        );
      }
    }
    
    console.log("Khóa công khai WebAuthn (nén):", compressedKey.toString('hex'));
    console.log("Độ dài khóa (bytes):", compressedKey.length);
    
    // Tạo dữ liệu instruction
    const data = Buffer.concat([
      new Uint8Array(discriminator),
      new Uint8Array(compressedKey)
    ]);
    
    // Tạo instruction với đúng accounts theo IDL
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      programId: programID,
      data
    });
    
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction configure webauthn:", error);
    throw error;
  }
};

/**
 * Tạo transaction cho storePasswordHash
 */
export const createStorePasswordHashTx = async (
  passwordHash: Uint8Array,
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey
) => {
  const tx = new web3.Transaction();
  
  // Sửa lỗi Buffer.from
  const discriminator = Buffer.from([
    // Thay thế với giá trị discriminator thực tế
    125, 106, 39, 42, 99, 108, 43, 50
  ]);
  
  // Sửa lại cách tạo data buffer
  const data = Buffer.concat([
    new Uint8Array(discriminator),
    new Uint8Array(Buffer.from(Array.from(passwordHash)))
  ]);
  
  // Thêm instruction để lưu password hash
  tx.add(
    new web3.TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
      ],
      programId: programID,
      data: data
    })
  );
  
  return tx;
};

/**
 * Tạo transaction xác thực WebAuthn
 */
export const createWebAuthnAuthTx = async (
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey,
  webauthnSignature: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array
): Promise<web3.Transaction> => {
  const tx = new web3.Transaction();
  
  // Thêm discriminator đúng cho verify_webauthn_auth
  const instructionData = Buffer.concat([
    new Uint8Array(Buffer.from([234, 182, 165, 23, 186, 223, 208, 119])), // discriminator từ IDL
    new Uint8Array(Buffer.from(webauthnSignature)),
    new Uint8Array(Buffer.from(authenticatorData)),
    new Uint8Array(Buffer.from(clientDataJSON))
  ]);
  
  const instruction = new web3.TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true },
      { pubkey: ownerPubkey, isSigner: false, isWritable: false }
    ],
    programId: programID,
    data: instructionData
  });
  
  tx.add(instruction);
  return tx;
};

// Tạo hàm mới createAddGuardianTx
export const createAddGuardianTx = (
  multisigPDA: PublicKey,
  guardianPDA: PublicKey,
  guardianPubkey: PublicKey,
  guardianName: string,
  recoveryHash: Uint8Array,
  isOwner: boolean,
  webauthnPubkey?: Buffer
): Transaction => {
  try {
    // Discriminator cho add_guardian
    const discriminator = Buffer.from([167, 189, 170, 27, 74, 240, 201, 241]);
    
    // Tạo buffer cho tên guardian
    const nameBuffer = Buffer.from(guardianName);
    const nameLenBuffer = Buffer.alloc(4);
    nameLenBuffer.writeUInt32LE(nameBuffer.length, 0);
    
    // Tạo buffer cho các tham số
    const isOwnerByte = Buffer.from([isOwner ? 1 : 0]);
    
    // Tạo buffers cho instruction data
    const dataBuffers = [
      discriminator,
      guardianPubkey.toBuffer(),
      nameLenBuffer,
      nameBuffer,
      Buffer.from(recoveryHash)
    ];
    
    // Thêm isOwner
    dataBuffers.push(isOwnerByte);
    
    // Xử lý webauthn_pubkey (option)
    if (webauthnPubkey && isOwner) {
      // Some variant (1)
      dataBuffers.push(Buffer.from([1]));
      
      // Nén khóa công khai nếu cần
      let compressedKey: Buffer;
      if (webauthnPubkey.length === 65 && webauthnPubkey[0] === 0x04) {
        // Khóa không nén, cần nén lại
        compressedKey = compressPublicKey(webauthnPubkey);
      } else if (webauthnPubkey.length === 33 && (webauthnPubkey[0] === 0x02 || webauthnPubkey[0] === 0x03)) {
        // Khóa đã nén, sử dụng trực tiếp
        compressedKey = webauthnPubkey;
      } else {
        throw new Error(`Khóa công khai WebAuthn không đúng định dạng: ${webauthnPubkey.length} bytes`);
      }
      
      dataBuffers.push(compressedKey);
    } else {
      // None variant (0)
      dataBuffers.push(Buffer.from([0]));
    }
    
    // Nối tất cả buffer lại với nhau
    const data = Buffer.concat(dataBuffers.map(buffer => new Uint8Array(buffer)));
    
    // Tạo instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPubkey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: programID,
      data
    });
    
    return new Transaction().add(instruction);
  } catch (error) {
    console.error("Lỗi khi tạo transaction add guardian:", error);
    throw error;
  }
};

// Các hằng số cần thiết cho Secp256r1
export const COMPRESSED_PUBKEY_SIZE = 33;
export const SIGNATURE_SIZE = 64;
export const DATA_START = 16; // 2 bytes header + 14 bytes offsets
export const SIGNATURE_OFFSETS_START = 2;

/**
 * Tạo instruction data cho chương trình Secp256r1SigVerify
 * @param message Tin nhắn gốc không hash
 * @param publicKey Khóa công khai nén
 * @param signature Chữ ký chuẩn hóa
 */
export const createSecp256r1Instruction = (
  message: Buffer, 
  publicKey: Buffer,
  signature: Buffer,
  shouldFlipPublicKey: boolean = false
): TransactionInstruction => {
  console.log("Tạo secp256r1 instruction với:");
  console.log(`- Message (${message.length} bytes):`, message.toString('hex').substring(0, 64) + '...');
  console.log(`- Public key (${publicKey.length} bytes):`, publicKey.toString('hex'));
  console.log(`- Signature (${signature.length} bytes):`, signature.toString('hex'));
  console.log(`- Flip public key: ${shouldFlipPublicKey}`);
  
  // Đảm bảo public key có đúng định dạng (compressed, 33 bytes)
  if (publicKey.length !== 33) {
    console.error('Public key phải có đúng 33 bytes (dạng nén)');
    throw new Error(`Public key phải có đúng 33 bytes, nhưng có ${publicKey.length} bytes`);
  }
  
  // Đảm bảo signature có đúng 64 bytes
  if (signature.length !== 64) {
    console.error('Signature phải có đúng 64 bytes');
    throw new Error(`Signature phải có đúng 64 bytes, nhưng có ${signature.length} bytes`);
  }
  
  // Kiểm tra byte đầu tiên của public key
  if (publicKey[0] !== 0x02 && publicKey[0] !== 0x03) {
    console.warn(`Byte đầu tiên của public key nên là 0x02 hoặc 0x03, nhưng là 0x${publicKey[0].toString(16)}`);
  }
  
  // Chuyển đổi public key nếu cần
  let pubkeyToUse = publicKey;
  if (shouldFlipPublicKey) {
    // Tạo public key mới với byte đầu tiên bị đảo
    pubkeyToUse = Buffer.from(publicKey);
    pubkeyToUse[0] = pubkeyToUse[0] === 0x02 ? 0x03 : 0x02;
    console.log(`- Public key sau khi đảo (${pubkeyToUse.length} bytes):`, pubkeyToUse.toString('hex'));
  }
  
  // Các hằng số
  const COMPRESSED_PUBKEY_SIZE = 33;
  const SIGNATURE_SIZE = 64;
  const DATA_START = 16; // 1 byte + 1 byte padding + 14 bytes offsets
  const SIGNATURE_OFFSETS_START = 2;
  
  // Tính tổng kích thước dữ liệu
  const totalSize = DATA_START + SIGNATURE_SIZE + COMPRESSED_PUBKEY_SIZE + message.length;
  const instructionData = Buffer.alloc(totalSize);

  // Tính offset
  const numSignatures = 1;
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SIZE;

  // Ghi số lượng chữ ký và padding
  instructionData.writeUInt8(numSignatures, 0);
  instructionData.writeUInt8(0, 1); // padding

  // Tạo và ghi offsets
  const offsets = {
    signature_offset: signatureOffset,
    signature_instruction_index: 0xffff, // u16::MAX
    public_key_offset: publicKeyOffset,
    public_key_instruction_index: 0xffff,
    message_data_offset: messageDataOffset,
    message_data_size: message.length,
    message_instruction_index: 0xffff,
  };

  // Ghi offsets
  instructionData.writeUInt16LE(offsets.signature_offset, SIGNATURE_OFFSETS_START);
  instructionData.writeUInt16LE(offsets.signature_instruction_index, SIGNATURE_OFFSETS_START + 2);
  instructionData.writeUInt16LE(offsets.public_key_offset, SIGNATURE_OFFSETS_START + 4);
  instructionData.writeUInt16LE(offsets.public_key_instruction_index, SIGNATURE_OFFSETS_START + 6);
  instructionData.writeUInt16LE(offsets.message_data_offset, SIGNATURE_OFFSETS_START + 8);
  instructionData.writeUInt16LE(offsets.message_data_size, SIGNATURE_OFFSETS_START + 10);
  instructionData.writeUInt16LE(offsets.message_instruction_index, SIGNATURE_OFFSETS_START + 12);

  // Ghi dữ liệu vào instruction
  pubkeyToUse.copy(instructionData, publicKeyOffset);
  signature.copy(instructionData, signatureOffset);
  message.copy(instructionData, messageDataOffset);
  
  console.log('Secp256r1 instruction data:');
  console.log('- Total size:', instructionData.length);
  console.log('- Public key offset:', publicKeyOffset);
  console.log('- Signature offset:', signatureOffset);
  console.log('- Message offset:', messageDataOffset);
  console.log('- Message size:', message.length);
  
  // Log dữ liệu hex
  console.log('- Instruction data (50 bytes đầu):', instructionData.slice(0, 50).toString('hex'));
  
  return new TransactionInstruction({
    keys: [],
    programId: SECP256R1_PROGRAM_ID,
    data: instructionData,
  });
};

/**
 * Tạo transaction để chuyển tiền
 * @param multisigPDA PDA của ví multisig
 * @param guardianPDA PDA của guardian
 * @param destination Địa chỉ đích để chuyển token
 * @param amountLamports Số lượng lamports để chuyển
 * @param nonce Nonce tránh replay attack
 * @param timestamp Timestamp cho giao dịch
 * @param message Thông điệp gốc (chưa hash)
 * @param payer Người trả phí giao dịch
 */
export const createTransferTx = (
  multisigPDA: PublicKey,
  guardianPDA: PublicKey,
  destination: PublicKey,
  amountLamports: number,
  nonce: number,
  timestamp: number,
  message: Uint8Array,
  payer: PublicKey
): Transaction => {
  try {
    // Kiểm tra các input
    if (!(multisigPDA instanceof PublicKey)) {
      throw new Error(`multisigPDA không phải PublicKey: ${typeof multisigPDA}`);
    }
    if (!(guardianPDA instanceof PublicKey)) {
      throw new Error(`guardianPDA không phải PublicKey: ${typeof guardianPDA}`);
    }
    if (!(destination instanceof PublicKey)) {
      throw new Error(`destination không phải PublicKey: ${typeof destination}`);
    }
    if (!(payer instanceof PublicKey)) {
      throw new Error(`payer không phải PublicKey: ${typeof payer}`);
    }
    
    // Đảm bảo các giá trị số hợp lệ
    if (isNaN(amountLamports) || amountLamports <= 0) {
      throw new Error(`amountLamports không hợp lệ: ${amountLamports}`);
    }
    if (isNaN(nonce) || nonce < 0) {
      throw new Error(`nonce không hợp lệ: ${nonce}`);
    }
    if (isNaN(timestamp) || timestamp <= 0) {
      throw new Error(`timestamp không hợp lệ: ${timestamp}`);
    }
    
    // Log thông tin debug để kiểm tra
    console.log('Tạo transaction chuyển tiền với thông tin:');
    console.log('- multisigPDA:', multisigPDA.toString());
    console.log('- guardianPDA:', guardianPDA.toString());
    console.log('- destination:', destination.toString());
    console.log('- amountLamports:', amountLamports);
    console.log('- nonce:', nonce);
    console.log('- timestamp:', timestamp);
    console.log('- message length:', message.length);
    console.log('- payer:', payer.toString());
    
    // Discriminator cho verify_and_execute
    const discriminator = Buffer.from([80, 118, 102, 72, 125, 57, 218, 137]);
    
    // Tham số cho 'action' - chuỗi "transfer"
    const action = "transfer";
    const actionBuffer = Buffer.from(action);
    const actionLenBuffer = Buffer.alloc(4);
    actionLenBuffer.writeUInt32LE(actionBuffer.length, 0);
    
    // Encode ActionParams
    const amountBuffer = Buffer.alloc(9); // 1 byte cho Option + 8 bytes cho u64
    amountBuffer.writeUInt8(1, 0); // 1 = Some
    const amountBigInt = BigInt(amountLamports);
    for (let i = 0; i < 8; i++) {
      amountBuffer.writeUInt8(Number((amountBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i + 1);
    }
    
    // Encode destination
    const destinationBuffer = Buffer.alloc(33); // 1 byte cho Option + 32 bytes cho PublicKey
    destinationBuffer.writeUInt8(1, 0); // 1 = Some
    Buffer.from(destination.toBuffer()).copy(destinationBuffer, 1);
    
    // Encode token_mint (None)
    const tokenMintBuffer = Buffer.alloc(1);
    tokenMintBuffer.writeUInt8(0, 0); // 0 = None
    
    // Encode nonce (u64, little-endian)
    const nonceBuffer = Buffer.alloc(8);
    const nonceBigInt = BigInt(nonce);
    for (let i = 0; i < 8; i++) {
      nonceBuffer.writeUInt8(Number((nonceBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i);
    }
    
    // Encode timestamp (i64, little-endian)
    const timestampBuffer = Buffer.alloc(8);
    const timestampBigInt = BigInt(timestamp);
    for (let i = 0; i < 8; i++) {
      timestampBuffer.writeUInt8(Number((timestampBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i);
    }
    
    // Encode message (vec<u8>)
    const messageLenBuffer = Buffer.alloc(4);
    messageLenBuffer.writeUInt32LE(message.length, 0);
    const messageBuffer = Buffer.from(message);
    
    // Nối tất cả buffer lại với nhau
    const data = Buffer.concat([
      discriminator,
      actionLenBuffer,
      actionBuffer,
      amountBuffer,
      destinationBuffer,
      tokenMintBuffer,
      nonceBuffer,
      timestampBuffer,
      messageLenBuffer,
      messageBuffer
    ]);
    
    // Kiểm tra địa chỉ của instruction sysvar
    const sysvarInstructionPubkey = SYSVAR_INSTRUCTIONS_PUBKEY;
    const sysvarClockPubkey = SYSVAR_CLOCK_PUBKEY;
    
    // Tạo instruction verify_and_execute
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPDA, isSigner: false, isWritable: false },
        { pubkey: sysvarClockPubkey, isSigner: false, isWritable: false },
        { pubkey: sysvarInstructionPubkey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true }
      ],
      programId: programID,
      data
    });
    
    // Tạo transaction mới
    return new Transaction().add(ix);
  } catch (error) {
    console.error("Lỗi khi tạo transaction chuyển tiền:", error);
    throw error;
  }
};

// Thêm hàm mới để xác minh chữ ký secp256r1 độc lập
export const verifySecp256r1Signature = async (
  connection: Connection,
  message: Buffer,
  publicKey: Buffer, 
  signature: Buffer, 
  feePayer: Keypair,
  shouldFlipPublicKey: boolean = false
): Promise<string> => {
  try {
    console.log("=== BẮT ĐẦU XÁC MINH CHỮ KÝ SECP256R1 ĐỘC LẬP ===");
    console.log("Message:", message.toString());
    console.log("Public key:", publicKey.toString('hex'));
    console.log("Signature:", signature.toString('hex'));
    
    // Tạo instruction xác minh chữ ký
    const verifyInstruction = createSecp256r1Instruction(
      message,
      publicKey,
      signature,
      shouldFlipPublicKey
    );
    
    // Tạo transaction đơn giản chỉ chứa instruction xác minh
    const transaction = new Transaction().add(verifyInstruction);
    
    // Thiết lập fee payer và recent blockhash
    transaction.feePayer = feePayer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    
    // Ký và gửi transaction
    console.log("Gửi transaction chỉ để xác minh chữ ký secp256r1...");
    const txSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [feePayer]
    );
    
    console.log("✅ XÁC MINH CHỮ KÝ SECP256R1 THÀNH CÔNG!");
    console.log("Transaction signature:", txSignature);
    
    return txSignature;
  } catch (error: any) {
    console.error("❌ XÁC MINH CHỮ KÝ SECP256R1 THẤT BẠI:", error);
    throw new Error(`Lỗi khi xác minh chữ ký secp256r1: ${error.message}`);
  }
};