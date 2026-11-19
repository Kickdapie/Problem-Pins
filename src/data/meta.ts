import type { Category, ReportReason, Status } from './types';

// Fixed vocabularies shared by every district. District-specific settings (name, teams,
// boundary, rules) live in the `District` record, see `demoDistrict.ts`.

// Categories carry no color: on screen, color means status. A category shows as an icon and a label.
export const CATEGORIES: Record<Category, { label: string }> = {
  lighting: { label: 'Lighting' },
  seating: { label: 'Seating' },
  accessibility: { label: 'Accessibility' },
  litter: { label: 'Litter' },
  noise: { label: 'Noise' },
  other: { label: 'Other' },
};

export const CATEGORY_ORDER: Category[] = ['lighting', 'seating', 'accessibility', 'litter', 'noise', 'other'];

export const STATUSES: Record<Status, { label: string; residentLabel: string; color: string; soft: string }> = {
  // The brand orange: orange means "act here", and an open issue is one to act on.
  open: { label: 'Open', residentLabel: 'Open', color: '#ef5a1f', soft: '#fff1ea' },
  in_review: { label: 'In review', residentLabel: 'In review', color: '#c98a1b', soft: '#fbf3e2' },
  scheduled: { label: 'Scheduled', residentLabel: 'Scheduled', color: '#2f6db5', soft: '#e9f0fa' },
  sent_to_city: { label: 'Sent to City', residentLabel: 'Waiting on City', color: '#8e63c7', soft: '#f1ebfa' },
  fixed: { label: 'Fixed', residentLabel: 'Fixed', color: '#2e8b57', soft: '#e6f4ec' },
};

export const STATUS_ORDER: Status[] = ['open', 'in_review', 'scheduled', 'sent_to_city', 'fixed'];

/** Why a resident reports a pin, in the order the report form lists them. */
export const REPORT_REASONS: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  offensive: 'Offensive or abusive',
  personal_info: 'Shows personal information',
  not_public_space: 'Not a public-space problem',
  other: 'Something else',
};

export const REPORT_REASON_ORDER: ReportReason[] = ['spam', 'offensive', 'personal_info', 'not_public_space', 'other'];

/** The hidden reason when the device that pinned an issue removes it. Staff see it under Hidden and can restore it. */
export const REMOVED_BY_PINNER = 'Removed by the person who pinned it';
