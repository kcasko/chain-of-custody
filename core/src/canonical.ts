// Canonical form v1: RFC 8785 (JCS) restricted to null, booleans, safe
// integers, NFC strings, arrays and plain objects. See
// docs/specs/canonicalization-and-verification-v1.md.

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${message} at ${path || '$'}`);
    this.name = 'CanonicalizationError';
    this.path = path;
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function checkString(s: string, path: string): void {
  if (LONE_SURROGATE.test(s)) throw new CanonicalizationError('string contains a lone surrogate', path);
  if (s.normalize('NFC') !== s) throw new CanonicalizationError('string is not Unicode NFC', path);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Compares by UTF-16 code units, as RFC 8785 requires.
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError('number must be a safe integer', path);
      if (Object.is(value, -0)) throw new CanonicalizationError('negative zero is not allowed', path);
      return String(value);
    case 'string':
      checkString(value, path);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(',')}]`;
      if (!isPlainObject(value)) throw new CanonicalizationError('only plain objects are allowed', path);
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareKeys);
      const parts: string[] = [];
      for (const key of keys) {
        checkString(key, `${path}.${key}`);
        const v = record[key];
        if (v === undefined) throw new CanonicalizationError('undefined is not allowed', `${path}.${key}`);
        parts.push(`${JSON.stringify(key)}:${encode(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`type ${typeof value} is not allowed`, path);
  }
}

export function canonicalize(value: unknown): string {
  return encode(value, '');
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}
