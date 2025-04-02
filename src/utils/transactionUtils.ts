import { web3, BN } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import idlFile from '../idl/moon_wallet_program.json';

// Export programID để có thể import được từ các file khác
export const programID = new PublicKey('HN8JJdo8c9iLQPzbTqjoioW61BDgyevHaGkCPSYLuDy');

// Lấy discriminator từ IDL mới
function getDiscriminatorFromIdl(instructionName: string): Buffer {
  const instruction = idlFile.instructions.find(ix => ix.name === instructionName);
  if (!instruction || !instruction.discriminator) {
    throw new Error(`Không tìm thấy discriminator cho instruction: ${instructionName}`);
  }
  return Buffer.from(instruction.discriminator);
}

// Sửa lỗi type cho IDL
const idl: any = idlFile;

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

/**
 * Tạo transaction cho chức năng chuyển tiền (transfer)
 * @param multisigPDA PDA của ví đa chữ ký
 * @param guardian Thông tin guardian có quyền ký
 * @param destination Địa chỉ đích để chuyển tiền
 * @param amountLamports Số lượng lamports cần chuyển
 * @param nonce Nonce giao dịch
 * @param timestamp Thời gian giao dịch (unix timestamp)
 * @param message Thông điệp đã ký
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
    
    // Tạo instruction verify_and_execute
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPDA, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
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

/**
 * Tạo instruction data cho chương trình Secp256r1SigVerify
 * @param publicKey Khóa công khai của guardian (nén)
 * @param signature Chữ ký cho message
 * @param message Message đã hash bằng SHA-256
 */
export const createSecp256r1Instruction = (
  publicKey: Buffer, 
  signature: Buffer, 
  message: Buffer
): TransactionInstruction => {
  // Constants
  const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');
  const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;
  const SIGNATURE_OFFSETS_START = 2;
  const DATA_START = SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START;
  const SIGNATURE_SERIALIZED_SIZE = 64;
  const COMPRESSED_PUBKEY_SERIALIZED_SIZE = 33;
  
  // Tính toán tổng kích thước instruction data
  const totalSize = DATA_START + SIGNATURE_SERIALIZED_SIZE + COMPRESSED_PUBKEY_SERIALIZED_SIZE + message.length;
  const instructionData = Buffer.alloc(totalSize);
  
  // Header
  instructionData.writeUInt8(1, 0); // num_signatures = 1
  instructionData.writeUInt8(0, 1); // padding
  
  // Offsets
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;
  
  // Write offsets
  instructionData.writeUInt16LE(signatureOffset, SIGNATURE_OFFSETS_START);
  instructionData.writeUInt16LE(0xffff, SIGNATURE_OFFSETS_START + 2);
  instructionData.writeUInt16LE(publicKeyOffset, SIGNATURE_OFFSETS_START + 4);
  instructionData.writeUInt16LE(0xffff, SIGNATURE_OFFSETS_START + 6);
  instructionData.writeUInt16LE(messageDataOffset, SIGNATURE_OFFSETS_START + 8);
  instructionData.writeUInt16LE(message.length, SIGNATURE_OFFSETS_START + 10);
  instructionData.writeUInt16LE(0xffff, SIGNATURE_OFFSETS_START + 12);
  
  // Write data
  publicKey.copy(instructionData, publicKeyOffset);
  signature.copy(instructionData, signatureOffset);
  message.copy(instructionData, messageDataOffset);
  
  // Tạo instruction
  return new TransactionInstruction({
    keys: [],
    programId: SECP256R1_PROGRAM_ID,
    data: instructionData
  });
};