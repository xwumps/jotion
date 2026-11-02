import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Argon2id mit OWASP-Empfehlung (19 MiB, 2 Iterationen)
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  // Gültiger Hash für Zeitausgleich bei unbekannten E-Mail-Adressen
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Gleicher Rechenaufwand wie eine echte Prüfung, damit Antwortzeiten nichts verraten. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('jotion-dummy-password');
    await this.verify(await this.dummyHash, password);
  }
}
