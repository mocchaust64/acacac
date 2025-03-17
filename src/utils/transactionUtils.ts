import { web3, BN } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { utils } from '@coral-xyz/anchor';
import { Buffer } from 'buffer';
import idlFile from '../idl/moon_wallet_program.json';
import { Program } from '@coral-xyz/anchor';
import { getProvider } from '../config/provider';
import { connection } from '../config/solana';
import * as borsh from '@coral-xyz/borsh';

// Export programID để có thể import được từ các file khác
export const programID = new PublicKey('8z1cp83P8qTvmQzrF6PJfjq565MnKcpKkk2EUe4g574C');

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
    
    // Tạo dữ liệu cho instruction
    // Format: [discriminator(8)][threshold(1)][recovery_hash(32)][credential_id_len(4)][credential_id(n)]
    
    // Tạo buffer cho threshold
    const thresholdBuffer = Buffer.from([threshold]);
    
    // Tạo buffer cho recovery hash
    const recoveryHashBuffer = Buffer.from(recoveryHash);
    
    // Tạo buffer cho độ dài credential ID
    const credentialIdLenBuffer = Buffer.alloc(4);
    credentialIdLenBuffer.writeUInt32LE(credentialId.length, 0);
    
    // Nối tất cả lại với nhau
    const data = Buffer.concat([
      discriminator,
      thresholdBuffer,
      recoveryHashBuffer,
      credentialIdLenBuffer,
      credentialId
    ]);
    
    // Tạo instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: false, isWritable: false },
        { pubkey: feePayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: programID,
      data
    });
    
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction:", error);
    throw error;
  }
};

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
    
    // Đảm bảo webauthnPubkey có đúng 65 bytes như yêu cầu trong IDL
    if (webauthnPubkey.length !== 65) {
      console.log(`Cảnh báo: Khóa công khai WebAuthn có ${webauthnPubkey.length} bytes, cần 65 bytes`);
      // Tạo buffer 65 bytes
      const paddedKey = Buffer.alloc(65);
      // Sao chép dữ liệu hoặc pad nếu cần
      webauthnPubkey.copy(paddedKey, 0, 0, Math.min(webauthnPubkey.length, 65));
      webauthnPubkey = paddedKey;
    }
    
    console.log("Khóa công khai WebAuthn (độ dài):", webauthnPubkey.length);
    console.log("Khóa công khai WebAuthn (hex):", webauthnPubkey.toString('hex'));
    
    // Tạo dữ liệu instruction
    const data = Buffer.concat([
      discriminator,
      webauthnPubkey
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
    discriminator,
    Buffer.from(Array.from(passwordHash))
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
    Buffer.from([234, 182, 165, 23, 186, 223, 208, 119]), // discriminator từ IDL
    Buffer.from(webauthnSignature),
    Buffer.from(authenticatorData),
    Buffer.from(clientDataJSON)
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