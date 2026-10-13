const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL safe, collision resistant ids such as `tx_k3v9q2m1zp7c`. */
export function createId(prefix: string, length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let body = '';
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `${prefix}_${body}`;
}

export type IdFactory = (prefix: string) => string;
