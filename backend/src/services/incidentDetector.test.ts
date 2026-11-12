
import { describe, expect, it } from '@jest/globals';
import { thresholdMet } from './incidentDetector';

describe('Incident threshold evaluation', () => {
  it('triggers GTE when observed equals threshold', () => {
    expect(thresholdMet(5, 5, 'GTE')).toBe(true);
  });

  it('does not trigger GTE below threshold', () => {
    expect(thresholdMet(4, 5, 'GTE')).toBe(false);
  });

  it('triggers GT above threshold', () => {
    expect(thresholdMet(1001, 1000, 'GT')).toBe(true);
  });

  it('does not trigger GT when values are equal', () => {
    expect(thresholdMet(1000, 1000, 'GT')).toBe(false);
  });

  it('does not trigger GT below threshold', () => {
    expect(thresholdMet(999, 1000, 'GT')).toBe(false);
  });
});
