import { PublicKey } from '@solana/web3.js';

// Định nghĩa type cho thông tin ví
export interface WalletInfo {
  address: string;
  credential_id: string;
  threshold: number; 
  recovery_seed: string;
  password_hash?: string;
}

// Định nghĩa type cho các tham số WebAuthn
export interface WebAuthnCredential {
  id: string;
  publicKey: string;
  type: string;
}

// Các type khác nếu cần 