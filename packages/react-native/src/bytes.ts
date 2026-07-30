export function utf8ToBytes(input: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }

  return new Uint8Array(bytes);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let result = "";

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const first = bytes[index]!;

    if (first < 0x80) {
      result += String.fromCharCode(first);
      continue;
    }

    if ((first & 0xe0) === 0xc0) {
      const second = readContinuation(bytes, index + 1);
      result += String.fromCharCode(((first & 0x1f) << 6) | second);
      index += 1;
      continue;
    }

    if ((first & 0xf0) === 0xe0) {
      const second = readContinuation(bytes, index + 1);
      const third = readContinuation(bytes, index + 2);
      result += String.fromCharCode(((first & 0x0f) << 12) | (second << 6) | third);
      index += 2;
      continue;
    }

    const second = readContinuation(bytes, index + 1);
    const third = readContinuation(bytes, index + 2);
    const fourth = readContinuation(bytes, index + 3);
    const codePoint = ((first & 0x07) << 18) | (second << 12) | (third << 6) | fourth;
    const shifted = codePoint - 0x10000;
    result += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
    index += 3;
  }

  return result;
}

export function jsonToBytes(input: unknown): Uint8Array {
  return utf8ToBytes(`${JSON.stringify(sortJson(input), null, 2)}\n`);
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(bytesToUtf8(bytes)) as unknown;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function readContinuation(bytes: Uint8Array, index: number): number {
  const value = bytes[index];

  if (value === undefined) {
    return 0;
  }

  return value & 0x3f;
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sortJson(item));
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }

  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
