import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Sets or replaces one KEY=value line in an env file. The value is written to
 * disk only and must never be printed, so secrets stay out of terminal output.
 */
export function updateEnvVar(filePath: string, key: string, value: string): void {
  const content = readFileSync(filePath, 'utf8');
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const next = pattern.test(content)
    ? content.replace(pattern, () => line)
    : `${content.replace(/\n?$/, '\n')}${line}\n`;
  writeFileSync(filePath, next);
}
