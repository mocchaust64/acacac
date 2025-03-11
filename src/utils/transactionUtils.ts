import { web3 } from '@coral-xyz/anchor';

// Program ID của Moon Wallet
export const programID = new web3.PublicKey('CRUpX1Y9ednyJTrqwoesikmzyQ4uFhDntbsEYjsGu55B');

/**
 * Tạo transaction cho initializeMultisig
 */
export const createInitializeMultisigTx = async (
  walletName: string, 
  threshold: number,
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey,
  feePayerKeypair: web3.Keypair
): Promise<web3.Transaction> => {
  const tx = new web3.Transaction();
  
  // Tạo dữ liệu cho instruction theo format Anchor
  const nameBytes = Buffer.from(walletName);
  
  // Tạo instruction data với discriminator đúng từ IDL
  const instructionData = Buffer.concat([
    Buffer.from([220, 130, 117, 21, 27, 227, 78, 213]), // discriminator
    new Uint8Array(new Uint32Array([nameBytes.length]).buffer), // độ dài tên (u32 - 4 bytes)
    nameBytes, // nội dung tên
    new Uint8Array([threshold]), // threshold (u8 - 1 byte)
    feePayerKeypair.publicKey.toBuffer() // fee payer
  ]);
  
  const instruction = new web3.TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true },
      { pubkey: ownerPubkey, isSigner: false, isWritable: false },
      { pubkey: feePayerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    programId: programID,
    data: instructionData
  });
  
  tx.add(instruction);
  return tx;
};

/**
 * Tạo transaction cho configureWebauthn
 */
export const createConfigureWebauthnTx = async (
  webauthnPubkeyArray: number[],
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey
): Promise<web3.Transaction> => {
  // Tạo transaction mới
  const tx = new web3.Transaction();
  
  // Kiểm tra độ dài khóa
  if (webauthnPubkeyArray.length !== 65) {
    console.error(`Khóa WebAuthn không đúng độ dài: ${webauthnPubkeyArray.length} (cần 65 byte)`);
    throw new Error('Khóa WebAuthn không đúng định dạng');
  }
  
  // Kiểm tra byte đầu tiên phải là 0x04 (uncompressed EC point)
  if (webauthnPubkeyArray[0] !== 4) {
    console.error(`Khóa WebAuthn không đúng định dạng: byte đầu tiên là ${webauthnPubkeyArray[0]} (cần 4)`);
    throw new Error('Khóa WebAuthn không đúng định dạng');
  }
  
  // Tạo instruction data với discriminator đúng
  const instructionData = Buffer.concat([
    Buffer.from([40, 149, 116, 224, 148, 48, 159, 54]), // discriminator đúng cho configure_webauthn
    Buffer.from(new Uint8Array(webauthnPubkeyArray))
  ]);
  
  // Tạo instruction
  const instruction = new web3.TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true },
      { pubkey: ownerPubkey, isSigner: true, isWritable: false }
    ],
    programId: programID,
    data: instructionData
  });
  
  // Thêm instruction vào transaction
  tx.add(instruction);
  
  return tx;
};

/**
 * Tạo transaction cho storePasswordHash
 */
export const createStorePasswordHashTx = async (
  passwordHashArray: number[],
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey
): Promise<web3.Transaction> => {
  // Tạo transaction mới
  const tx = new web3.Transaction();
  
  // Tạo dữ liệu cho instruction
  const hashLenBuffer = Buffer.from(new Uint8Array([passwordHashArray.length]));
  const hashBuffer = Buffer.from(new Uint8Array(passwordHashArray));
  
  // Tạo instruction data với discriminator đúng
  const instructionData = Buffer.concat([
    Buffer.from([242, 169, 229, 238, 249, 138, 212, 106]), // discriminator đúng cho store_password_hash
    hashLenBuffer,
    hashBuffer
  ]);
  
  // Tạo instruction
  const instruction = new web3.TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true },
      { pubkey: ownerPubkey, isSigner: true, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    programId: programID,
    data: instructionData
  });
  
  // Thêm instruction vào transaction
  tx.add(instruction);
  
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