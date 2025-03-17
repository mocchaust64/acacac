import { programID } from "./transactionUtils";

import { web3 } from "@coral-xyz/anchor";

// Tạo hàm để lấy multisig PDA dựa vào credential ID
export const getMultisigPDA = (credentialId: string): web3.PublicKey => {
  const credentialIdBuffer = Buffer.from(credentialId, 'hex');
  
  const [pda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("multisig"), credentialIdBuffer],
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