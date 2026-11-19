# Problem-Pins

Residents pin and +1 public-space problems; district staff triage them, post updates and forward
City-owned ones to 311. Built with React, TypeScript, Tailwind, Leaflet and Supabase.

```
npm install
npm run dev
```

Then open http://localhost:5173.

- **Demo mode** (default when no Supabase keys are set): sample data for West Chelsea, saved in
  your browser. Use the top bar to switch between the Resident and District office views, and
  "Reset demo" to restore the sample data. Add `?mode=demo` to any deployment's URL to get it.
- **Live mode**: copy `.env.example` to `.env.local` and fill in the Supabase values.

```
npm test          # unit tests (Vitest)
npm run build     # typecheck + production build
```

How the app is structured, and who works on what: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
