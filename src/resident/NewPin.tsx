import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronUp, Search, X } from 'lucide-react';
import IssueMap from '../components/IssueMap';
import { isDemo } from '../config';
import { CATEGORIES } from '../data/meta';
import { distanceMeters } from '../data/geo';
import type { Category } from '../data/types';
import { formatMeters, plural } from '../lib/format';
import { labelFor } from '../lib/geocode';
import { insideDistrict, type Point } from '../lib/geometry';
import { useAddressSearch, usePlaceLabel } from '../lib/useGeocode';
import { useUserLocation } from '../lib/userLocation';
import { navigate } from '../router';
import { useStore } from '../store';
import { BUTTON, CategoryLabel, LABEL, LINK, goBack } from './shared';

interface Photo {
  blob: Blob;
  preview: string;
}

/**
 * Downscales a photo to `max` px on its longest side and re-encodes it as JPEG.
 * Drawing through a canvas also drops EXIF metadata, including GPS. Keep it that way.
 * The demo keeps photos in localStorage, so it stores them small.
 */
function resizeImage(file: File, max = isDemo ? 480 : 1280): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob((blob) => (blob ? resolve({ blob, preview: URL.createObjectURL(blob) }) : reject(new Error('Could not read photo'))), 'image/jpeg', 0.8);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export default function NewPin({ category: initialCategory, from }: { category: string | null; from: string | null }) {
  const store = useStore();
  const { district, track } = store;
  const scan = from ? store.scanPoints.find((p) => p.code === from) : undefined;
  // From a QR poster the pin starts at the poster; otherwise at the resident's position.
  const loc = useUserLocation({ ask: !scan });

  useEffect(() => {
    track({ name: 'pin_start', scanCode: scan?.code, props: { via: scan ? 'qr' : 'map' } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [category, setCategory] = useState<Category | null>(
    initialCategory && initialCategory in CATEGORIES ? (initialCategory as Category) : null,
  );
  // `label` is set for a searched address: the resident chose it by name, so keep that name.
  const [picked, setPicked] = useState<{ point: Point; how: 'map' | 'search'; label?: string } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [posting, setPosting] = useState(false);
  const [dismissedSimilar, setDismissedSimilar] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // Where the pin is: what the resident picked, else the QR poster, else their position if it's
  // inside the district. Outside the district or without a position there is no pin until they
  // tap the map or search, so nothing gets posted at a made-up spot.
  const device = loc.position;
  const deviceInside = device ? insideDistrict(device, district) : false;
  const origin: 'picked' | 'scan' | 'device' | 'none' = picked ? 'picked' : scan ? 'scan' : device && deviceInside ? 'device' : 'none';
  const pos = useMemo<Point | null>(() => {
    if (picked) return picked.point;
    if (scan) return { lat: scan.lat, lng: scan.lng };
    if (device && deviceInside) return { lat: device.lat, lng: device.lng };
    return null;
  }, [picked, scan, device, deviceInside]);
  const outside = pos ? !insideDistrict(pos, district) : false;

  const searchLabel = picked?.label;
  const { place, loading: lookingUp, fallback } = usePlaceLabel(searchLabel ? null : pos);
  const addresses = useAddressSearch(query, district.center);

  const similar = useMemo(() => {
    if (!category || !pos) return undefined;
    return store.issues
      .filter((i) => i.status !== 'fixed' && i.category === category && !dismissedSimilar.includes(i.id))
      .map((i) => ({ issue: i, d: distanceMeters(pos, i) }))
      .filter((x) => x.d < 250)
      .sort((a, b) => a.d - b.d)[0];
  }, [category, pos, store.issues, dismissedSimilar]);

  const canPost = Boolean(category && title.trim().length > 2 && pos && !outside);
  const label = !pos
    ? 'No spot picked yet'
    : (searchLabel ?? (lookingUp ? 'Finding the address…' : (place ?? fallback)?.label ?? ''));

  const accuracy = device?.accuracy;
  const sourceNote = (() => {
    if (origin === 'picked') return picked!.how === 'search' ? 'From your search' : 'Pinned on the map';
    if (origin === 'scan') return `From the ${scan!.name} QR`;
    if (origin === 'device') {
      if (loc.source === 'demo') return `Demo location in ${district.area}`;
      if (accuracy == null) return 'From your location';
      return accuracy > 50
        ? `From your location, accurate to about ${formatMeters(accuracy)}. Drag the pin to the exact spot.`
        : `From your location · ±${Math.round(accuracy)} m`;
    }
    return null;
  })();
  const whyNoPin = (() => {
    if (device && !deviceInside) return `You seem to be outside ${district.name}.`;
    if (loc.status === 'denied') return 'Location is off for this site.';
    if (loc.status === 'unavailable') return 'Your location isn’t available on this device.';
    if (loc.status === 'timeout') return 'Couldn’t find your location.';
    return 'Finding your location…';
  })();

  const pickPoint = (point: Point, how: 'map' | 'search', label?: string) => {
    setPicked({ point: { lat: point.lat, lng: point.lng }, how, label });
    setQuery('');
  };

  const submit = async () => {
    if (!category || !canPost || !pos || posting) return;
    setPosting(true);
    // Usually cached already; falls back to the offline label if GeoSearch is unreachable.
    const finalLabel = searchLabel ?? (await labelFor(pos)).label;
    const id = await store.addIssue(
      {
        title: title.trim(),
        description: description.trim(),
        category,
        lat: pos.lat,
        lng: pos.lng,
        locationLabel: finalLabel,
        via: scan ? `QR · ${scan.name} ${scan.code}` : 'the map',
        scanCode: scan?.code,
      },
      photos.map((p) => p.blob),
    );
    setPosting(false);
    if (id) navigate('/');
  };

  const sectionLabel = `${LABEL} mb-2`;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-2 pt-5">
        <h1 className="text-lg font-semibold">Pin a problem</h1>
        <button onClick={goBack} className="text-sm font-medium text-slate-600 hover:text-ink">
          Cancel
        </button>
      </header>

      <div className="flex-1 space-y-5 px-5 pb-6 pt-2">
        <section>
          <h2 className={sectionLabel}>Category</h2>
          <div className="grid grid-cols-2 gap-2">
            {district.categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  category === c ? 'border-ink font-semibold ring-1 ring-ink' : 'border-slate-200 font-medium hover:border-slate-300'
                }`}
              >
                <CategoryLabel category={c} iconClass={`h-4 w-4 ${category === c ? 'text-ink' : 'text-slate-500'}`} />
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className={sectionLabel}>Location</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="h-48">
              <IssueMap
                issues={[]}
                center={pos ?? district.center}
                zoom={pos ? 17 : district.zoom}
                pick={pos}
                onPick={(p) => pickPoint(p, 'map')}
                showYou
                you={device}
              />
            </div>
            <div className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className={`font-semibold ${pos && (searchLabel || !lookingUp) ? '' : 'text-slate-500'}`}>{label}</p>
                <p className="text-xs text-slate-500">
                  {sourceNote ?? (
                    <>
                      {whyNoPin} Search an address or tap the map where the problem is.
                    </>
                  )}
                </p>
              </div>
              {pos && <span className="shrink-0 text-xs text-slate-500">Drag or tap to adjust</span>}
            </div>
            <div className="border-t border-slate-100">
              <label className="flex items-center gap-2 px-3">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search an address"
                  aria-label="Search an address"
                  className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear address search">
                    <X className="h-4 w-4 text-slate-500" />
                  </button>
                )}
              </label>
              {query.trim().length >= 3 && (
                <ul className="border-t border-slate-100 text-sm">
                  {addresses.results.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => pickPoint(a, 'search', a.label)} className="w-full px-3 py-2 text-left hover:bg-slate-50">
                        <span className="font-medium">{a.label}</span>
                        {a.detail && <span className="text-slate-500"> · {a.detail}</span>}
                      </button>
                    </li>
                  ))}
                  {addresses.status === 'loading' && !addresses.results.length && (
                    <li className="px-3 py-2 text-slate-500">Searching…</li>
                  )}
                  {addresses.status === 'done' && !addresses.results.length && (
                    <li className="px-3 py-2 text-slate-500">No New York City address matches.</li>
                  )}
                  {addresses.status === 'error' && (
                    <li className="px-3 py-2 text-slate-500">Address search isn’t reachable. Tap the map instead.</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </section>

        {outside && (
          <section className="rounded-xl border border-slate-200 p-4">
            <p className="font-semibold">Outside {district.name}</p>
            <p className="mt-1 text-sm text-slate-700">
              {district.name} handles problems in {district.area} only, so it can’t take this pin. For other places in New
              York City, report it to 311.
            </p>
            <a
              href="https://portal.311.nyc.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className={`${LINK} mt-3 inline-block text-sm`}
            >
              Report it to NYC 311
            </a>
          </section>
        )}

        {similar && (
          <section className="rounded-xl border border-slate-200 p-4">
            <p className="font-semibold">Similar pin nearby</p>
            <p className="mt-1 text-sm text-slate-700">“{similar.issue.title}”</p>
            <p className="text-sm text-slate-700">
              {plural(similar.issue.votes, 'neighbor')} · {formatMeters(similar.d)} away
            </p>
            <div className="mt-3 flex items-center gap-4">
              <button
                onClick={() => {
                  store.vote(similar.issue.id, 'similar');
                  navigate(`/i/${similar.issue.id}`);
                }}
                className={`${BUTTON} flex items-center gap-1.5 px-3 py-2 text-sm`}
              >
                <ChevronUp className="h-4 w-4" strokeWidth={2.5} /> +1 that instead
              </button>
              <button onClick={() => setDismissedSimilar([...dismissedSimilar, similar.issue.id])} className="text-sm text-slate-600">
                No, it’s different
              </button>
            </div>
          </section>
        )}

        <section>
          <h2 className={sectionLabel}>Title</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. Sandwich board blocks the curb cut"
            aria-label="Title"
            className="h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-ink"
          />
        </section>

        <section>
          <h2 className={sectionLabel}>Photos</h2>
          <div className="flex gap-2">
            {photos.map((p, idx) => (
              <div key={p.preview} className="relative">
                <img src={p.preview} alt="" className="h-[68px] w-[68px] rounded-lg object-cover" />
                <button
                  onClick={() => setPhotos(photos.filter((_, i) => i !== idx))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {photos.length < 4 && (
              <button
                onClick={() => fileInput.current?.click()}
                className="flex h-[68px] w-[68px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-600 hover:border-slate-400"
              >
                <Camera className="mb-1 h-5 w-5" /> Add
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setPhotos([...photos, await resizeImage(file)]);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section>
          <h2 className={sectionLabel}>What’s wrong?</h2>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What did you see, and when?"
            aria-label="What’s wrong?"
            className="w-full rounded-xl border border-slate-200 p-3 text-[15px] outline-none focus:border-ink"
          />
        </section>
      </div>

      <footer className="sticky bottom-0 border-t border-slate-100 bg-white px-5 pb-4 pt-3">
        <button
          onClick={submit}
          disabled={!canPost || posting}
          className="w-full rounded-xl bg-brand py-3.5 text-lg font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {posting ? 'Posting…' : 'Post pin'}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          {!pos
            ? 'Search an address or tap the map to place the pin.'
            : outside
              ? `This spot is outside ${district.name}.`
              : canPost
                ? 'Posted publicly. Your name is not shown.'
                : 'Pick a category and add a short title.'}
        </p>
      </footer>
    </div>
  );
}
