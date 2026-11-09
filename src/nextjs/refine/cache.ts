import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Edit } from './edits.js';

/** Accepted provider replies per section, so a stopped run resumes without new requests. */
export class RefineCache {
  constructor(private dir: string) {}

  key(sectionSource: string, provider: string, model: string): string {
    return crypto.createHash('sha256').update(`${provider}\n${model}\n${sectionSource}`).digest('hex');
  }

  get(key: string): Edit[] | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, `${key}.json`), 'utf8')) as Edit[];
    } catch {
      return undefined;
    }
  }

  set(key: string, edits: Edit[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${key}.json`), JSON.stringify(edits, null, 2));
  }
}
