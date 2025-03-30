import { createContext } from "react";

export interface WalletInfo {
  publicKey: string;       // PDA của ví
  pda: string;             // Cũng là PDA
  webauthnCredentialId: string; // credential_id dùng để tạo PDA
  webauthnPubkey: string;  // pubkey để xác thực 
}

export const WalletContext = createContext<{
  walletInfo: WalletInfo | null;
  setWalletInfo: (info: WalletInfo | null) => void;
}>({
  walletInfo: null,
  setWalletInfo: () => {},
}); 