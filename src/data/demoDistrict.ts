import { CATEGORY_ORDER } from './meta';
import { NEIGHBORHOOD_CENTER, at } from './geo';
import type { District, ScanPoint } from './types';

const corner = (street: number, ave: number): [number, number] => {
  const p = at(street, ave);
  return [p.lng, p.lat];
};

/**
 * The fictional district office the demo is set in. The name, area and boundary are placeholders
 * until the pilot district is confirmed. Live deployments load their district from the backend.
 */
export const DEMO_DISTRICT: District = {
  id: 'west-side-demo',
  name: 'West Side District',
  area: 'West Chelsea',
  center: NEIGHBORHOOD_CENTER,
  zoom: 16,
  // W 13th to W 23rd St, 8th to 11th Ave.
  boundary: {
    type: 'Polygon',
    coordinates: [[corner(13, -1), corner(23, -1), corner(23, 2), corner(13, 2), corner(13, -1)]],
  },
  categories: CATEGORY_ORDER,
  teams: ['District office staff'],
  rules: { cityNoReplyDays: 10, quietDays: 14 },
  contactEmail: 'office@westside.example',
};

export const DEMO_SCAN_POINTS: ScanPoint[] = [
  {
    code: 'Q-12',
    name: 'Community noticeboard, W 16th St',
    detail: 'Between 9th and 10th Ave',
    ...at(16, 0.45),
    issueId: 'PP-2402',
  },
];
