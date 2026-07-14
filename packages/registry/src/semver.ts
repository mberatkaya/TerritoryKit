export function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (const index of [0, 1, 2] as const) {
    const diff = leftParts[index] - rightParts[index];

    if (diff !== 0) {
      return diff;
    }
  }

  if (leftParts.prerelease && !rightParts.prerelease) {
    return -1;
  }

  if (!leftParts.prerelease && rightParts.prerelease) {
    return 1;
  }

  return (leftParts.prerelease ?? "").localeCompare(rightParts.prerelease ?? "");
}

export function isPrerelease(version: string): boolean {
  return parseSemver(version).prerelease !== undefined;
}

export function matchesVersionRange(version: string, range: string | undefined): boolean {
  if (!range || range === "*" || range === "latest" || range === "latest-compatible") {
    return true;
  }

  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(range)) {
    return version === range;
  }

  const clauses = range.split(/\s+/).filter(Boolean);
  return clauses.every((clause) => {
    const match = /^(>=|>|<=|<|=)?(.+)$/.exec(clause);

    if (!match) {
      return false;
    }

    const operator = match[1] ?? "=";
    const target = match[2] ?? "";
    const diff = compareSemver(version, target);

    if (operator === ">=") {
      return diff >= 0;
    }

    if (operator === ">") {
      return diff > 0;
    }

    if (operator === "<=") {
      return diff <= 0;
    }

    if (operator === "<") {
      return diff < 0;
    }

    return diff === 0;
  });
}

function parseSemver(version: string): [number, number, number] & { prerelease?: string } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);

  if (!match) {
    throw new Error(`Invalid semver '${version}'.`);
  }

  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as [
    number,
    number,
    number
  ] & { prerelease?: string };

  if (match[4]) {
    parsed.prerelease = match[4];
  }

  return parsed;
}
