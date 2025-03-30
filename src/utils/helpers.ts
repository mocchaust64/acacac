import { programID } from "./transactionUtils";

import { web3 } from "@coral-xyz/anchor";

// Tạo hàm để lấy multisig PDA dựa vào credential ID
export const getMultisigPDA = (credentialId: string): web3.PublicKey => {
  // Sử dụng hàm processCredentialIdForPDA để đồng bộ với cách tính trong smart contract
  const seedBuffer = processCredentialIdForPDA(credentialId);
  
  const [pda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("multisig"), seedBuffer],
    programID
  );
  
  return pda;
};

// Tạo hàm lấy guardian PDA (cập nhật để sử dụng credential ID)
export const getGuardianPDA = (walletPDA: web3.PublicKey, guardianPubkey: web3.PublicKey): web3.PublicKey => {
  const [pda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("guardian"), walletPDA.toBuffer(), guardianPubkey.toBuffer()],
    programID
  );
  
  return pda;
};

/**
 * Xử lý credential ID để tính PDA đồng nhất với smart contract
 * Cách xử lý này phải khớp với hàm process_credential_id_seed trong smart contract
 */
export const processCredentialIdForPDA = (credentialId: string): Uint8Array => {
  const credentialBuffer = Buffer.from(credentialId);
  
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
  } else {
    // Nếu không quá dài, tạo buffer mới với độ dài cố định 24 bytes, padding với 0
    seedBuffer = new Uint8Array(24);
    seedBuffer.set(credentialBuffer.subarray(0, Math.min(credentialBuffer.length, 24)));
  }
  
  return seedBuffer;
}; 