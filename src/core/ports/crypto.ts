export interface CryptoPort {
  newId(): string;
  randomBytes(length: number): Uint8Array<ArrayBuffer>;
  digest(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}
