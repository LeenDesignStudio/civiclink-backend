/** ASCII C0 controls and DEL. User-supplied text must not contain them. */
// eslint-disable-next-line no-control-regex -- rejects ASCII control characters in user-supplied text
export const ASCII_CONTROLS = /[\u0000-\u001F\u007F]/g;

export function hasAsciiControls(value: string): boolean {
  ASCII_CONTROLS.lastIndex = 0;
  return ASCII_CONTROLS.test(value);
}

export function stripAsciiControls(value: string): string {
  ASCII_CONTROLS.lastIndex = 0;
  return value.replace(ASCII_CONTROLS, '');
}
