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

export class UnknownCmsTagError extends Error {
  constructor(
    public tag: number,
    public offset: number,
    public key: string,
  ) {
    super(`Unknown CMS tag 0x${tag.toString(16)} for field "${key}" at offset ${offset}`);
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

export function decodeChunk(buf: Buffer): { items: CmsItem[]; errors: UnknownCmsTagError[] } {
  const items: CmsItem[] = [];
  const errors: UnknownCmsTagError[] = [];
  let pos = 0;

  const text = (len: number): string => {
    if (pos + len > buf.length) throw new RangeError('CMS chunk truncated');
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  };

  try {
    while (pos + 2 <= buf.length) {
      const count = buf.readUInt16BE(pos);
      pos += 2;
      const fields: Record<string, CmsValue> = {};
      for (let i = 0; i < count; i++) {
        const keyLen = buf.readUInt32BE(pos);
        pos += 4;
        const key = text(keyLen);
        const tag = buf.readUInt8(pos);
        const tagOffset = pos;
        pos += 1;
        switch (tag) {
          case TAG_ENUM:
          case TAG_STRING: {
            const len = buf.readUInt32BE(pos);
            pos += 4;
            fields[key] = { type: 'string', value: text(len) };
            break;
          }
          case TAG_DATE: {
            fields[key] = { type: 'date', value: Number(buf.readBigUInt64BE(pos)) };
            pos += 8;
            break;
          }
          case TAG_JSON: {
            const len = buf.readUInt32BE(pos);
            pos += 4;
            fields[key] = { type: 'json', value: JSON.parse(text(len)) };
            break;
          }
          case TAG_RICHTEXT: {
            pos += 1; // flag byte
            const len = buf.readUInt32BE(pos);
            pos += 4;
            fields[key] = { type: 'richtext', value: JSON.parse(text(len)) };
            break;
          }
          default:
            errors.push(new UnknownCmsTagError(tag, tagOffset, key));
            return { items, errors };
        }
      }
      const id = fields.id;
      items.push({ id: id?.type === 'string' ? id.value : '', fields });
    }
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  return { items, errors };
}
