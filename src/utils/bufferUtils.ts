/**
 * Các hàm tiện ích để xử lý buffer và chuyển đổi dữ liệu
 */

// Hàm chuyển đổi ArrayBuffer hoặc Uint8Array thành chuỗi hex
export const bufferToHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const uintArray = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(uintArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// Hàm chuyển đổi chuỗi hex thành ArrayBuffer
export const hexToBuffer = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  return bytes.buffer;
};

// Hàm hash mật khẩu
export const hashPassword = async (password: string): Promise<Uint8Array> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
};