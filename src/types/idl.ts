import { Idl } from '@coral-xyz/anchor';

// Mở rộng kiểu Idl để phù hợp với IDL của bạn
export interface MoonWalletIdl extends Idl {
  address: string;
  metadata: {
    name: string;
    version: string;
    spec: string;
    description: string;
  };
  // Thêm các trường khác nếu cần
}