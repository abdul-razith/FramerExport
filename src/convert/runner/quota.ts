export interface QuotaHit {
  line: string;
  resetHint?: string;
}

const DIRECT_PATTERN = /RESOURCE_EXHAUSTED|\b429\b/i;
const KEYWORDS_PATTERN = /quota|usage limit|rate limit/i;
const ACTIONS_PATTERN = /reached|exceeded|exhausted|hit/i;
const RESET_PATTERN_1 = /resets? in ([0-9hms ]+)/i;
const RESET_PATTERN_2 = /try again in ([^.]+)/i;

/**
 * Scans a line of output for quota, rate-limit, or resource-exhaustion indicators.
 * Matches `RESOURCE_EXHAUSTED` or `\b429\b`, or keywords (quota|usage limit|rate limit)
 * together with actions (reached|exceeded|exhausted|hit).
 * Extracts resetHint when available.
 */
export function detectQuota(line: string): QuotaHit | null {
  const isDirect = DIRECT_PATTERN.test(line);
  const isKeywordAndAction = KEYWORDS_PATTERN.test(line) && ACTIONS_PATTERN.test(line);

  if (!isDirect && !isKeywordAndAction) {
    return null;
  }

  const resetMatch = line.match(RESET_PATTERN_1) ?? line.match(RESET_PATTERN_2);
  const resetHint = resetMatch?.[1]?.trim();

  return resetHint ? { line, resetHint } : { line };
}
