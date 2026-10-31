import * as clack from '@clack/prompts';
import chalk from 'chalk';

export function formatShortcutHint(key: string, description: string): string {
  return `${chalk.dim('[')}${chalk.cyan.bold(key)}${chalk.dim(']')} ${chalk.dim(description)}`;
}

export function sanitizeInputText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim();
}

export function isCancelOperation(value: unknown): boolean {
  if (!value) return false;
  if (clack.isCancel(value)) return true;
  if (typeof value === 'symbol' && value.toString().includes('clack:cancel')) return true;
  return false;
}

export function uiIntro(title: string): void {
  clack.intro(chalk.bgHex('#FAB283').hex('#23170F').bold(` ${title} `));
}

export function uiOutro(message: string): void {
  clack.outro(chalk.hex('#FAB283')(message));
}

export function uiCancelAndExit(message: string = 'Operation cancelled.'): never {
  clack.cancel(chalk.dim(message));
  process.exit(0);
}

export async function uiSelect<T extends string | number | boolean>(
  message: string,
  options: { label: string; value: T; hint?: string }[],
  initialValue?: T
): Promise<T> {
  const result = await clack.select({
    message,
    options: options as any,
    initialValue,
  });

  if (isCancelOperation(result)) {
    uiCancelAndExit();
  }

  return result as T;
}

export async function uiText(
  message: string,
  options?: {
    placeholder?: string;
    defaultValue?: string;
    validate?: (val: string | undefined) => string | void;
  }
): Promise<string> {
  const result = await clack.text({
    message,
    placeholder: options?.placeholder,
    initialValue: options?.defaultValue,
    validate: options?.validate as any,
  });

  if (isCancelOperation(result)) {
    uiCancelAndExit();
  }

  return sanitizeInputText(result);
}

export async function uiConfirm(
  message: string,
  initialValue: boolean = true
): Promise<boolean> {
  const result = await clack.confirm({
    message,
    initialValue,
  });

  if (isCancelOperation(result)) {
    uiCancelAndExit();
  }

  return Boolean(result);
}

export function uiSpinner(): ReturnType<typeof clack.spinner> {
  return clack.spinner();
}

export function uiNote(message: string, title?: string): void {
  clack.note(message, title);
}
