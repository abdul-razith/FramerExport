export type CmsValue =
  | { type: 'string'; value: string }
  | { type: 'date'; value: number }
  | { type: 'json'; value: unknown }
  | { type: 'richtext'; value: unknown }
  | { type: 'boolean'; value: boolean }
  | { type: 'number'; value: number };

export interface CmsItem {
  id: string;
  fields: Record<string, CmsValue>;
}


export class CmsDecodeError extends Error {
  constructor(
    public reason: 'unknown-tag' | 'truncated' | 'invalid-json',
    public offset: number,
    public key?: string,
    message?: string,
  ) {
    super(message ?? `CMS decode error (${reason}) at offset ${offset}${key ? ` for field "${key}"` : ''}`);
    this.name = 'CmsDecodeError';
  }
}

export class UnknownCmsTagError extends CmsDecodeError {
  declare key: string;
  constructor(
    public tag: number,
    offset: number,
    key: string,
  ) {
    super(
      'unknown-tag',
      offset,
      key,
      `Unknown CMS tag 0x${tag.toString(16)} for field "${key}" at offset ${offset}`,
    );
    this.name = 'UnknownCmsTagError';
  }
}

const TAG_DATE = 0x04;
const TAG_ENUM = 0x05; // enum option id: same layout as string (u32 len + utf8)
const TAG_JSON = 0x0a;
const TAG_RICHTEXT = 0x0b;
const TAG_STRING = 0x0c;

export function collectionIdFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.split('-')[0] ?? base;
}

export function decodeChunk(buf: Buffer): { items: CmsItem[]; errors: CmsDecodeError[] } {
  const items: CmsItem[] = [];
  const errors: CmsDecodeError[] = [];
  let pos = 0;
  let itemStart = 0;

  const need = (n: number): void => {
    if (n < 0 || pos + n > buf.length) throw new CmsDecodeError('truncated', itemStart);
  };
  const u32 = (): number => {
    need(4);
    const v = buf.readUInt32BE(pos);
    pos += 4;
    return v;
  };
  const text = (len: number): string => {
    need(len);
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  };
  const json = (len: number, key: string, offset: number): unknown => {
    const raw = text(len);
    try {
      return JSON.parse(raw);
    } catch {
      throw new CmsDecodeError('invalid-json', offset, key);
    }
  };

  try {
    while (pos < buf.length) {
      itemStart = pos;
      need(2);
      const count = buf.readUInt16BE(pos);
      pos += 2;
      const fields: Record<string, CmsValue> = {};
      for (let i = 0; i < count; i++) {
        const key = text(u32());
        need(1);
        const tagOffset = pos;
        const tag = buf.readUInt8(pos);
        pos += 1;
        switch (tag) {
          case TAG_ENUM:
          case TAG_STRING:
            fields[key] = { type: 'string', value: text(u32()) };
            break;
          case TAG_DATE:
            need(8);
            fields[key] = { type: 'date', value: Number(buf.readBigUInt64BE(pos)) };
            pos += 8;
            break;
          case TAG_JSON:
            fields[key] = { type: 'json', value: json(u32(), key, tagOffset) };
            break;
          case TAG_RICHTEXT:
            need(1);
            pos += 1; // flag byte
            fields[key] = { type: 'richtext', value: json(u32(), key, tagOffset) };
            break;
          default:
            throw new UnknownCmsTagError(tag, tagOffset, key);
        }
      }
      const id = fields.id;
      items.push({ id: id?.type === 'string' ? id.value : '', fields });
    }
  } catch (err) {
    if (err instanceof CmsDecodeError) errors.push(err);
    else throw err;
  }
  return { items, errors };
}
