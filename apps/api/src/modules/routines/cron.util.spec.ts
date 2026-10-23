import { isValidCron, isValidTimezone } from './cron.util';

describe('isValidCron', () => {
  it.each([
    '* * * * *',
    '0 8 * * 1-5',
    '*/15 * * * *',
    '0 0 1,15 * *',
    '30 6 * JAN-MAR MON',
    '0 12 ? * SUN',
    '5 4 * * 7',
  ])('acepta "%s"', (expr) => expect(isValidCron(expr)).toBe(true));
  it.each([
    '',
    '* * * *',
    '* * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '5-1 * * * *',
    '*/0 * * * *',
    'a b c d e',
    '1,,2 * * * *',
    42,
  ])('rechaza %p', (expr) => expect(isValidCron(expr)).toBe(false));
});

describe('isValidTimezone', () => {
  it('acepta zonas IANA y UTC', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/Bogota')).toBe(true);
    expect(isValidTimezone('Europe/Madrid')).toBe(true);
  });
  it('rechaza zonas inexistentes', () => {
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});
