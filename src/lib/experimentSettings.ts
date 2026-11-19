/**
 * Experiment thresholds. These belong to the team, not to the code: each one is `null`
 * until the team agrees a number (and writes down why) before looking at the results.
 * The Experiments page (`#/org/experiments`) shows `null` as "set by the team".
 *
 * `direction` says which side of the threshold counts as meeting it.
 */
export interface Threshold {
  label: string;
  unit: 'percent' | 'hours' | 'days' | 'count';
  direction: 'at_least' | 'at_most';
  value: number | null;
}

export type ThresholdKey =
  | 'scanToPinStart'
  | 'pinStartToSubmit'
  | 'scanToVote'
  | 'scansPerPointPerWeek'
  | 'staffResponseHours'
  | 'daysToFix';

export const EXPERIMENT_THRESHOLDS: Record<ThresholdKey, Threshold> = {
  /** Share of QR scans that go on to start a pin. */
  scanToPinStart: { label: 'QR scans → pins started', unit: 'percent', direction: 'at_least', value: null },
  /** Share of started pins that get submitted. */
  pinStartToSubmit: { label: 'Pins started → submitted', unit: 'percent', direction: 'at_least', value: null },
  /** Share of QR scans that end in a +1 on the scan page. */
  scanToVote: { label: 'QR scans → +1 on the scan page', unit: 'percent', direction: 'at_least', value: null },
  /** QR scans per poster per week. */
  scansPerPointPerWeek: { label: 'QR scans per poster per week', unit: 'count', direction: 'at_least', value: null },
  /** Median hours from a pin being submitted to the first staff action on it. */
  staffResponseHours: { label: 'Median staff response time', unit: 'hours', direction: 'at_most', value: null },
  /** Median days from a pin to it being marked fixed. */
  daysToFix: { label: 'Median days to fix', unit: 'days', direction: 'at_most', value: null },
};
