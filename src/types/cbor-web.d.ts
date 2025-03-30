declare module 'cbor-web' {
  export function decode(data: Uint8Array | ArrayBuffer): any;
  export function encode(data: any): Uint8Array;
  export function encodeCanonical(data: any): Uint8Array;
  export function decodeFirst(data: Uint8Array | ArrayBuffer): any;
  export function decodeAll(data: Uint8Array | ArrayBuffer): any[];
  export const Encoder: any;
  export const Decoder: any;
  export const Tagged: any;
  export const Simple: any;
} 