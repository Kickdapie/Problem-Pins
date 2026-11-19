import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../components/ui';
import { residentAccounts } from '../config';
import { plural, shortDate } from '../lib/format';
import { navigate } from '../router';
import { useStore } from '../store';
import { ConfirmAction, LABEL, LINK, goBack } from './shared';

/** Only resident paths; never back into the staff app or off the site. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/org') && !next.startsWith('/account')
    ? next
    : '/updates';
}

const FIELD = 'mt-1 h-12 w-full rounded-lg border border-slate-300 px-3 text-base';
const PRIMARY = 'h-12 w-full rounded-xl bg-brand font-semibold text-white hover:bg-brand-dark disabled:opacity-60';
const TEXT = 'text-[15px] leading-relaxed text-slate-700';

// The step "enter the code" survives a reload: on a phone, opening the mail app can reload the page.
const SENT_KEY = 'problem-pins-account-code-sent';
const CODE_LIFETIME = 60 * 60 * 1000;

interface Sent {
  email: string;
  demoCode?: string;
  at: number;
}

function readSent(): Sent | null {
  try {
    const sent = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? 'null') as Sent | null;
    return sent && Date.now() - sent.at < CODE_LIFETIME ? sent : null;
  } catch {
    return null;
  }
}

function writeSent(sent: Sent | null) {
  try {
    if (sent) sessionStorage.setItem(SENT_KEY, JSON.stringify(sent));
    else sessionStorage.removeItem(SENT_KEY);
  } catch {
    /* private mode: the step just doesn't survive a reload */
  }
}

/**
 * Optional resident account (`#/account?next=&from=`): an email, proved with a 6-digit code, so
 * the problems you pinned, +1’d and follow are kept beyond this browser. Signed in, it shows the
 * account. Pinning and +1 never need one. The demo shows the code instead of emailing it.
 */
export default function Account({ next, from }: { next: string | null; from: string | null }) {
  const { account, staff, mode, district } = useStore();
  let content: ReactNode;
  if (!residentAccounts) {
    content = (
      <>
        <h1 className="text-2xl font-bold">No account needed</h1>
        <p className={`mt-2 ${TEXT}`}>
          The problems you pinned, +1’d and follow are kept on this phone, under{' '}
          <a href="#/updates" className={LINK}>
            You
          </a>
          , behind the person button on the map.
        </p>
      </>
    );
  } else if (mode === 'live' && staff) {
    // Staff sessions and resident accounts don't mix on one device (docs/BACKEND.md).
    content = (
      <>
        <h1 className="text-2xl font-bold">Signed in as staff</h1>
        <p className={`mt-2 ${TEXT}`}>
          This phone is signed in to the {district.name} staff app. Sign out there to use a resident account.
        </p>
      </>
    );
  } else {
    content = account ? <SignedIn /> : <SignIn next={safeNext(next)} from={from} />;
  }
  return (
    <div className="px-5 pb-10 pt-6">
      <div className="mb-8 flex items-center gap-3">
        <button onClick={goBack} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Logo />
      </div>
      {content}
    </div>
  );
}

function SignIn({ next, from }: { next: string; from: string | null }) {
  const store = useStore();
  const [sent, setSentState] = useState<Sent | null>(readSent);
  const [email, setEmail] = useState(sent?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  const setSent = (value: Sent | null) => {
    setSentState(value);
    writeSent(value);
  };

  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);

  const askForCode = async (address: string) => {
    setError(null);
    setBusy(true);
    const result = await store.requestResidentCode(address);
    setBusy(false);
    if ('error' in result) return setError(result.error);
    setSent({ email: address.trim().toLowerCase(), demoCode: result.demoCode, at: Date.now() });
    setCode('');
    return true;
  };

  const verify = async (value: string) => {
    if (!sent || busy) return;
    setError(null);
    if (value.replace(/\s/g, '').length !== 6) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    const result = await store.verifyResidentCode(sent.email, value, from ?? undefined);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      codeInput.current?.select();
      return;
    }
    setSent(null);
    store.toast(result.returning ? 'Signed in. Your problems are on this phone' : `Saved to ${sent.email}`);
    navigate(next);
  };

  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  );

  if (!sent) {
    return (
      <>
        <h1 className="text-2xl font-bold leading-tight">Keep your problems with your email</h1>
        <p className={`mt-3 ${TEXT}`}>
          The problems you pinned, +1’d and follow are kept in this browser only. Add your email to get them back on a new phone,
          or after the browser clears its data.
        </p>
        <form
          noValidate
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void askForCode(email);
          }}
        >
          <label className="block text-sm font-medium">
            Email
            <input
              ref={emailInput}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby="account-email-note"
              className={FIELD}
            />
          </label>
          {errorBox}
          <button disabled={busy || !email.trim()} className={PRIMARY}>
            Send me a code
          </button>
        </form>
        <p id="account-email-note" className="mt-4 text-sm leading-relaxed text-slate-600">
          No password: you sign in with a 6-digit code. Neighbors and {store.district.name} don’t see your email. Pinning and +1
          never need an account.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold leading-tight">Enter the code</h1>
      <p className={`mt-3 ${TEXT}`}>
        {sent.demoCode ? 'The 6-digit code for ' : 'We emailed a 6-digit code to '}
        <span className="font-semibold text-ink">{sent.email}</span>. It works for an hour.
      </p>
      {sent.demoCode && (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-700">
          This demo sends no email. Your code is <span className="font-semibold tabular-nums text-ink">{sent.demoCode}</span>.{' '}
          <button
            type="button"
            onClick={() => {
              setCode(sent.demoCode!);
              void verify(sent.demoCode!);
            }}
            className={LINK}
          >
            Use it
          </button>
        </p>
      )}
      <form
        noValidate
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        <label className="block text-sm font-medium">
          Code
          <input
            ref={codeInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => {
              const value = e.target.value.replace(/[^\d\s]/g, '');
              setCode(value);
              // A pasted or autofilled code signs in straight away.
              if (value.replace(/\s/g, '').length === 6 && value.length > code.length + 1) void verify(value);
            }}
            aria-invalid={Boolean(error)}
            className={`${FIELD} text-lg tabular-nums tracking-[0.3em]`}
          />
        </label>
        {errorBox}
        <button disabled={busy} className={PRIMARY}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button
          disabled={busy}
          onClick={async () => {
            if (await askForCode(sent.email)) store.toast('New code sent');
          }}
          className={LINK}
        >
          Send a new code
        </button>
        <button
          onClick={() => {
            setSent(null);
            setError(null);
            setTimeout(() => emailInput.current?.focus(), 0);
          }}
          className={LINK}
        >
          Use a different email
        </button>
      </p>
    </>
  );
}

function SignedIn() {
  const store = useStore();
  const account = store.account!;
  // Same set as the You page: what this account pinned, +1’d or follows.
  const ids = new Set([...store.voted, ...store.following]);
  const saved = store.issues.filter((i) => ids.has(i.id) || i.isUserReport).length;

  return (
    <>
      <h1 className="text-2xl font-bold">Your account</h1>
      <p className="mt-1 text-[15px] text-slate-600">
        <span className="font-semibold text-ink">{account.email}</span> · since {shortDate(account.since)}
      </p>

      <p className={`mt-5 ${TEXT}`}>
        {saved
          ? `${plural(saved, 'problem')} you pinned, +1’d or follow ${saved === 1 ? 'is' : 'are'} saved with this email, with your notes and answers.`
          : 'Nothing saved yet. What you pin, +1 or follow from now on is saved with this email.'}{' '}
        <a href="#/updates" className={LINK}>
          See them under You
        </a>
      </p>

      <h2 className={`mt-7 ${LABEL}`}>On another phone</h2>
      <p className={`mt-1 ${TEXT}`}>
        Open Problem Pins, tap the person button on the map and sign in with this email. What you did on that phone is added, and a problem you
        +1’d on both counts once.
      </p>

      <h2 className={`mt-6 ${LABEL}`}>Who sees your email</h2>
      <p className={`mt-1 ${TEXT}`}>
        Only you. Neighbors and {store.district.name} see your pins, notes and +1s as before, without a name or an email.
      </p>

      <div className="mt-8 space-y-4 border-t border-slate-100 pt-5 text-[15px]">
        <div>
          <ConfirmAction
            label="Sign out"
            question="Your problems leave this phone until you sign in again. Your +1s still count."
            confirmLabel="Sign out"
            onConfirm={async () => {
              if (await store.signOutResident()) {
                store.toast('Signed out');
                navigate('/updates');
              }
            }}
          />
        </div>
        <div>
          <ConfirmAction
            label="Delete account"
            question="Your email is deleted and any other phone is signed out. Your pins, notes and +1s stay on the map, and on this phone."
            confirmLabel="Delete account"
            onConfirm={async () => {
              if (await store.deleteResidentAccount()) {
                store.toast('Account deleted');
                navigate('/updates');
              }
            }}
          />
        </div>
      </div>
    </>
  );
}
