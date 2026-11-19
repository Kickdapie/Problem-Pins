import { ArrowLeft } from 'lucide-react';
import { Logo } from '../components/ui';
import { residentAccounts } from '../config';
import { useStore } from '../store';
import { LINK, goBack } from './shared';

/** What a resident should know before pinning. Says only what the app and the district office really do. */
export default function About() {
  const { district } = useStore();
  const heading = 'mt-6 font-semibold';
  const text = 'mt-1 text-[15px] leading-relaxed text-slate-700';
  return (
    <div className="px-5 pb-10 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={goBack} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Logo />
      </div>

      <h1 className="text-2xl font-bold">About Problem Pins</h1>
      <p className={text}>
        A map where neighbors pin problems in public space and +1 the ones that are their problem too. In {district.area}, Problem Pins
        runs with {district.name}, and every pin goes to its office.
      </p>

      <h2 className={heading}>What happens to a pin</h2>
      <p className={text}>
        {district.name} reviews every new pin. When a City agency is responsible for the problem, the office files it with NYC 311 and
        follows up. The status on each problem is the office’s own tracking, not an official NYC 311 status. Once a problem is marked
        fixed, anyone can say whether the fix held.
      </p>

      <h2 className={heading}>What others can see</h2>
      <p className={text}>
        Pins, photos, notes and +1 counts are public. You don’t need an account, and your name is not asked for or shown. Photos have
        their location data removed before they are uploaded. Your +1s and the problems you follow are remembered on this phone, in
        this browser, so they show under{' '}
        <a href="#/updates" className={LINK}>
          You
        </a>{' '}
        here
        {residentAccounts ? (
          <>
            . To have them on another phone too, you can{' '}
            <a href="#/account?from=about" className={LINK}>
              keep them with your email
            </a>
            {' '}
            (no password: you sign in with a 6-digit code). Neighbors and {district.name} don’t see that email.
          </>
        ) : (
          ' and nowhere else.'
        )}
      </p>

      <h2 className={heading}>Emergencies</h2>
      <p className={text}>Problem Pins does not replace 911. If someone is in danger, call 911.</p>

      {district.contactEmail && (
        <>
          <h2 className={heading}>Contact</h2>
          <p className={text}>
            Questions about a pin or about this map go to {district.name}:{' '}
            <a href={`mailto:${district.contactEmail}`} className={LINK}>
              {district.contactEmail}
            </a>
          </p>
        </>
      )}
    </div>
  );
}
