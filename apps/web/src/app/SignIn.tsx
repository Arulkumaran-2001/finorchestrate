import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Icon, Logo, type IconName } from '../components/Icon';
import { Field, TextInput } from '../components/forms';
import { session, type SessionInfo } from '../lib/session';
import './signin.css';

const POINTS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'microphone', title: 'Ask by voice', text: '"How many months of runway do we have?" Answers come from your real ledger, not a guess.' },
  { icon: 'shield', title: 'A guardian that acts', text: 'Rebalances envelopes inside the limits you set and asks before anything bigger.' },
  { icon: 'anomaly', title: 'Catches odd charges', text: 'Duplicate invoices and egress spikes are flagged the moment they land.' },
];

export function SignIn({ demoAvailable, onSignedIn }: { demoAvailable: boolean; onSignedIn: (info: SessionInfo) => void }) {
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'key' | 'demo' | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) {
      setError('Enter the access key from your server.');
      return;
    }
    setPending('key');
    setError(null);
    try {
      onSignedIn(await session.signIn(key.trim()));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(null);
    }
  };

  const demo = async () => {
    setPending('demo');
    setError(null);
    try {
      onSignedIn(await session.demo());
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="signin">
      <section className="signin__story" aria-labelledby="signin-headline">
        <div className="signin__brand">
          <Logo size={40} />
          <span className="signin__brand-name">FinOrchestrate</span>
        </div>
        <h1 id="signin-headline" className="signin__headline">
          Hear about a runaway cloud bill <em>before</em> it lands.
        </h1>
        <p className="signin__lead">
          A budget guardian for small product teams. Talk to it through Alexa+ or any MCP client, and let it keep your envelopes in balance while you build.
        </p>
        <ul className="signin__points">
          {POINTS.map((point) => (
            <li key={point.title} className="signin__point">
              <span className="signin__point-icon">
                <Icon name={point.icon} size={20} />
              </span>
              <div>
                <p className="signin__point-title">{point.title}</p>
                <p className="signin__point-text">{point.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="signin__panel" aria-labelledby="signin-title">
        <form className="signin__card" onSubmit={submit} noValidate>
          <span className="signin__lock">
            <Icon name="key" size={22} />
          </span>
          <h2 id="signin-title" className="signin__title">
            Sign in to your workspace
          </h2>
          <p className="signin__subtitle">Use the access key your server printed on start, or the FINO_API_TOKEN you configured.</p>
          <Field label="Access key" error={error}>
            {({ inputId, describedBy, invalid }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                invalid={invalid}
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                spellCheck={false}
                leadingIcon="lock"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                trailing={
                  <button type="button" className="signin__reveal" aria-label={reveal ? 'Hide access key' : 'Show access key'} onClick={() => setReveal((value) => !value)}>
                    <Icon name={reveal ? 'eyeOff' : 'eye'} size={18} />
                  </button>
                }
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={pending === 'key'} iconAfter="chevronRight">
            Sign in
          </Button>
          {demoAvailable ? (
            <>
              <div className="signin__divider">
                <span>or</span>
              </div>
              <Button variant="secondary" size="lg" block icon="microphone" loading={pending === 'demo'} onClick={demo}>
                Explore the demo workspace
              </Button>
              <p className="signin__note">The demo uses Lumen Labs, a four person studio with five months of real looking history.</p>
            </>
          ) : null}
        </form>
      </section>
    </div>
  );
}
