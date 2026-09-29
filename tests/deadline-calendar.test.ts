import { expect, test } from 'vitest';
import { monthDays } from '../src/deadline-calendar';
test('local Monday weeks cover leap February and year boundaries without duplicate days', () => {
  expect(monthDays(2024, 1)).toContain('2024-02-29');
  expect(monthDays(2025, 1)).not.toContain('2025-02-29');
  expect(monthDays(2026, 0)[0]).toBe('2025-12-29');
  for (let month = 0; month < 12; month++) {
    const days = monthDays(2026, month);
    expect(days.length % 7).toBe(0);
    expect(new Set(days).size).toBe(days.length);
    expect(new Date(`${days[0]}T12:00:00`).getDay()).toBe(1);
  }
});
