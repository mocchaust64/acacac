import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { PROGRAM_ID } from '../App';

/**
 * Xử lý credential ID để tạo seed cho PDA
 * Cách xử lý này phải khớp với hàm process_credential_id_seed trong smart contract
 */
export const processCredentialIdForPDA = (credentialId: string): Uint8Array => {
  const credentialBuffer = Buffer.from(credentialId);
  
  console.log("FRONTEND - processCredentialIdForPDA");
  console.log("Input credential ID:", credentialId);
  console.log("Credential buffer length:", credentialBuffer.length);
  console.log("Credential buffer bytes:", Array.from(credentialBuffer));
  
  // Seed tối đa cho PDA là 32 bytes, trừ đi "multisig" (8 bytes) còn 24 bytes
  let seedBuffer: Uint8Array;
  
  if (credentialBuffer.length > 24) {
    console.log("Credential ID dài quá 24 bytes, thực hiện hash để đảm bảo đồng nhất với smart contract");
    
    // Dùng cách XOR hash giống như trong smart contract
    const hashResult = new Uint8Array(24);
    for (let i = 0; i < credentialBuffer.length; i++) {
      hashResult[i % 24] ^= credentialBuffer[i];
    }
    
    seedBuffer = hashResult;
    console.log("Seed buffer sau khi hash:", Array.from(seedBuffer));
  } else {
    // Nếu không quá dài, tạo buffer mới với độ dài cố định 24 bytes, padding với 0
    seedBuffer = new Uint8Array(24);
    seedBuffer.set(credentialBuffer);
    console.log("Seed buffer không hash (padded):", Array.from(seedBuffer));
  }
  
  return seedBuffer;
};

/**
 * Lấy multisig PDA dựa vào credential ID
 */
export const getMultisigPDA = (credentialId: string): PublicKey => {
  const seedBuffer = processCredentialIdForPDA(credentialId);
  
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("multisig"), seedBuffer],
    PROGRAM_ID
  );
  
  return pda;
};

/**
 * Lấy guardian PDA dựa vào multisig PDA và guardian ID
 */
export const getGuardianPDA = (multisigPDA: PublicKey, guardianId: number): PublicKey => {
  const guardianIdBytes = new Uint8Array(8);
  const view = new DataView(guardianIdBytes.buffer);
  view.setBigUint64(0, BigInt(guardianId), true);
  
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("guardian"),
      multisigPDA.toBuffer(),
      guardianIdBytes
    ],
    PROGRAM_ID
  );
  
  return pda;
};

/**
 * Lấy tất cả guardian PDAs cho một multisig
 */
export const getAllGuardianPDAs = (multisigPDA: PublicKey, numGuardians: number): PublicKey[] => {
  const guardianPDAs: PublicKey[] = [];
  for (let i = 1; i <= numGuardians; i++) {
    guardianPDAs.push(getGuardianPDA(multisigPDA, i));
  }
  return guardianPDAs;
}; 