# Map tiles

The maps are Leaflet with raster tiles from a third-party provider. The app turns any provider's
tiles grayscale with CSS (`.leaflet-tile-pane` in `src/index.css`), so the restrained look doesn't
depend on the style we pick. The provider is configured with two env vars, read in `src/config.ts`:

```
VITE_MAP_TILE_URL=      # Leaflet URL template, {z}/{x}/{y}, optional {s} subdomain and {r} retina suffix
VITE_MAP_ATTRIBUTION=   # HTML credit shown in the map corner (required by every provider)
```

`tile.openstreetmap.org`, the old default, is a volunteer-run server whose
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) rules out apps like ours.

## Current default (no env vars)

Stadia Maps "Alidade Smooth", **without a key**:
`https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png`.
Stadia serves `localhost` and `127.0.0.1` without a key (rate-limited), so `npm run dev` and demos
from a laptop work with zero setup. **On a deployed domain it returns 401** until that domain is
registered with Stadia, so every deployment must set the env vars (or register the domain).

## Options compared

Checked 13 Nov 2026. Prices and limits change, so re-check the linked pages before signing up.
"Request" = one 256 px tile; a phone-sized map view loads roughly 12 to 20 tiles.

| | CARTO basemaps | Stadia Maps | MapTiler Cloud |
|---|---|---|---|
| Grayscale-friendly style | Positron (`light_all`) | Alidade Smooth, Stamen Toner Lite | Dataviz, Basic, Toner |
| Key needed | Yes now: a free key by email, no card ([basemaps](https://carto.com/basemaps/)). Keyless URLs show an "API key required" tile. | No on localhost. Production: domain registration in the dashboard (no key in code) | Yes, always (key in the URL) |
| Free tier | 1M requests/month **commercial**, 5M non-commercial | 200k credits/month (1 tile = 1 credit), **non-commercial only** | ~100k requests/month, **non-commercial** (and R&D for commercial products) |
| Paid | $500/month or $5,000/year for 10M requests | Starter $20/month, 1M credits, commercial OK ([pricing](https://stadiamaps.com/pricing/)) | Flex ~$25 to $30/month, commercial OK ([pricing](https://www.maptiler.com/cloud/pricing/)) |
| Attribution | © OpenStreetMap contributors, © CARTO | © Stadia Maps, © OpenMapTiles, © OpenStreetMap | © MapTiler, © OpenStreetMap contributors |
| Terms | [basemap terms](https://carto.com/legal/basemap-terms/). Keys registered before 23 Sep 2026 and used commercially keep their old terms until 30 Nov 2026. | [service limits](https://docs.stadiamaps.com/limits), [auth](https://docs.stadiamaps.com/authentication/) | [cloud terms](https://www.maptiler.com/cloud/terms/) |

A paid pilot (a BID or district office paying us) counts as commercial use for all three.

## Recommendation (team to confirm)

- **Pilot:** CARTO Positron with a free CARTO key. It's the only option with a free *commercial*
  allowance, and 1M requests a month is roughly 50,000 map views, far more than a one-district pilot
  needs. Cost: $0. Set:

  ```
  VITE_MAP_TILE_URL=https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=YOUR_CARTO_KEY
  VITE_MAP_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>
  ```

  The key sits in the browser's tile requests; that's how CARTO's raster keys work. Check the exact
  URL in the email CARTO sends with the key.
- **Fallback:** Stadia Starter ($20/month). Register the production domain in the Stadia dashboard
  (no key in the code) and keep the default URL, adding only the attribution if it changes.
- **Development and demos:** nothing to set (Stadia keyless on localhost). If a demo laptop hits
  Stadia's rate limit (HTTP 429), set the CARTO values above in `.env.local`.

Whichever we pick, keep the attribution visible: every provider requires it, and removing it can get
the key suspended.
