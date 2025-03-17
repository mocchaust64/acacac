// Utility để chuyển đổi giữa các định dạng dữ liệu
export const bufferToArray = (buffer: Buffer): number[] => {
  return Array.from(buffer);
};

export const uint8ArrayToArray = (array: Uint8Array): number[] => {
  return Array.from(array);
};

export const hexToBuffer = (hex: string): Buffer => {
  return Buffer.from(hex, 'hex');
};

export const arrayToUint8Array = (array: number[]): Uint8Array => {
  return new Uint8Array(array);
}; 