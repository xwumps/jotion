import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Verschlüsselung von Zugangsdaten (Passwörter, Tokens) mit AES-256-GCM.
 * Format: "v1:<schlüssel-id>:<iv>:<tag>:<daten>" (base64url). Die Schlüssel-ID sind die ersten
 * 8 Hex-Zeichen von SHA-256 über den Schlüssel; so findet der Schlüsselring nach einer Rotation
 * den passenden alten Schlüssel. Zusätzliche Bindung (AAD) an den Verwendungszweck, damit ein
 * Geheimnis nicht in eine andere Verbindung kopiert werden kann.
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

export const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new CryptoError('Schlüssel muss 32 Byte lang sein');
  return key;
}

export class SecretBox {
  private readonly current: Buffer;
  private readonly ring = new Map<string, Buffer>();

  /** current: JOTION_MASTER_KEY; previous: frühere Schlüssel (Rotation), base64 */
  constructor(current: string, previous: string[] = []) {
    this.current = parseKey(current);
    for (const k of [current, ...previous]) {
      const key = parseKey(k);
      this.ring.set(keyId(key), key);
    }
  }

  get currentKeyId(): string {
    return keyId(this.current);
  }

  encrypt(plain: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.current, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', this.currentKeyId, b64(iv), b64(cipher.getAuthTag()), b64(data)].join(':');
  }

  decrypt(box: string, context: string): string {
    const [v, id, iv, tag, data] = box.split(':');
    if (v !== 'v1' || !id || !iv || !tag || data === undefined)
      throw new CryptoError('Unbekanntes Format');
    const key = this.ring.get(id);
    if (!key) throw new CryptoError('Schlüssel nicht vorhanden (Rotation ohne alten Schlüssel?)');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, unb64(iv));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(unb64(tag));
      return Buffer.concat([decipher.update(unb64(data)), decipher.final()]).toString('utf8');
    } catch {
      throw new CryptoError('Entschlüsseln fehlgeschlagen');
    }
  }

  /** Braucht der Wert eine Neu-Verschlüsselung mit dem aktuellen Schlüssel? */
  needsRotation(box: string): boolean {
    return box.split(':')[1] !== this.currentKeyId;
  }

  /** Mit dem aktuellen Schlüssel neu verschlüsseln (nach einer Rotation). */
  rotate(box: string, context: string): string {
    return this.needsRotation(box) ? this.encrypt(this.decrypt(box, context), context) : box;
  }
}
