import { Idl } from '@coral-xyz/anchor';

/**
 * Chuyển đổi IDL để phù hợp với định dạng Anchor cần
 */
export const convertIdl = (idl: any): Idl => {
  // Tạo bản sao để tránh thay đổi gốc
  const convertedIdl: Idl = {
    version: idl.metadata?.version || "0.1.0",
    name: idl.metadata?.name || "moon_wallet_program",
    instructions: idl.instructions.map((ix: any) => ({
      name: ix.name,
      accounts: ix.accounts.map((acc: any) => ({
        name: acc.name,
        isMut: acc.writable === true,
        isSigner: acc.signer === true,
      })),
      args: ix.args.map((arg: any) => ({
        name: arg.name,
        type: convertType(arg.type),
      })),
    })),
    accounts: idl.accounts ? idl.accounts.map((acc: any) => ({
      name: acc.name,
      type: {
        kind: "struct",
        fields: acc.type && acc.type.fields ? acc.type.fields.map((field: any) => ({
          name: field.name,
          type: convertType(field.type),
        })) : []
      }
    })) : [],
    errors: idl.errors ? idl.errors.map((err: any) => ({
      code: err.code,
      name: err.name,
      msg: err.msg
    })) : [],
  };
  
  return convertedIdl;
};

// Hàm chuyển đổi kiểu dữ liệu
function convertType(type: any): any {
  if (typeof type === 'string') {
    return type;
  }
  
  if (type.array) {
    return { array: [convertType(type.array[0]), type.array[1]] };
  }
  
  if (type.vec) {
    return { vec: convertType(type.vec) };
  }
  
  if (type.option) {
    return { option: convertType(type.option) };
  }
  
  if (type.defined) {
    return { defined: type.defined };
  }
  
  return type;
}