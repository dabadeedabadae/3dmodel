'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { register, saveToken, updateProfile } from '../../lib/api';

/*
 * Sign-up is a chain of steps on top of the existing API, without new endpoints:
 *   1. account  -> POST /auth/register (email, password)
 *   2. profile  -> PATCH /users/me (name, city)
 *   3. about    -> PATCH /users/me (bio)
 * Nothing is sent until the last step; then the account is created and the
 * optional profile fields are saved with the new token in one PATCH.
 * Field limits mirror RegisterDto and UpdateProfileDto on the API.
 */

const STEPS = ['Account', 'Profile', 'About you'] as const;
const LIMITS = { name: 80, city: 100, bio: 300 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // set once the account exists, so a retry after a failed profile save does not register again
  const [accountCreated, setAccountCreated] = useState(false);

  function validateAccount(): string | null {
    if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
    if (password.length < 8) return 'The password must be at least 8 characters.';
    if (password !== confirm) return 'The passwords do not match.';
    return null;
  }

  function goTo(next: number) {
    setError(null);
    setStep(next);
  }

  async function finish() {
    setError(null);
    setLoading(true);

    if (!accountCreated) {
      try {
        const { accessToken } = await register(email.trim(), password);
        saveToken(accessToken);
        setAccountCreated(true);
      } catch (err) {
        setLoading(false);
        setStep(0);
        setError(err instanceof Error ? err.message : 'Could not sign up');
        return;
      }
    }

    const profile = { name: name.trim(), city: city.trim(), bio: bio.trim() };
    if (profile.name || profile.city || profile.bio) {
      try {
        await updateProfile(profile);
      } catch (err) {
        setLoading(false);
        setError(
          (err instanceof Error ? err.message : 'Could not save the profile.') +
            ' Your account is created — try again or skip this step.',
        );
        return;
      }
    }

    router.replace('/profile');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (step === 0) {
      const problem = validateAccount();
      if (problem) { setError(problem); return; }
      goTo(1);
    } else if (step === 1) {
      goTo(2);
    } else {
      void finish();
    }
  }

  return (
    <div className="container">
      <div className="card">
        <span className="fig-label fig-label-left">FORM_002</span>
        <h1>Sign up</h1>

        <ol className="reg-steps" aria-label="Sign-up steps">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i === step ? 'is-current' : i < step ? 'is-done' : undefined}
              aria-current={i === step ? 'step' : undefined}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {label}
            </li>
          ))}
        </ol>

        {error && <div className="error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          {step === 0 && (
            <>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  disabled={accountCreated}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password (at least 8 characters)</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={accountCreated}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="confirm">Repeat the password</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={accountCreated}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="reg-hint">Optional — you can fill this in later in your profile.</p>
              <div className="field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  autoFocus
                  maxLength={LIMITS.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="city">City (used for the weather forecast)</label>
                <input
                  id="city"
                  type="text"
                  autoComplete="address-level2"
                  maxLength={LIMITS.city}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="field">
                <label htmlFor="bio">About you ({bio.length}/{LIMITS.bio})</label>
                <textarea
                  id="bio"
                  rows={4}
                  autoFocus
                  maxLength={LIMITS.bio}
                  placeholder="Style, favourite colours, what you dress for…"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>
              <dl className="reg-summary">
                <dt>Email</dt><dd>{email.trim()}</dd>
                <dt>Name</dt><dd>{name.trim() || '—'}</dd>
                <dt>City</dt><dd>{city.trim() || '—'}</dd>
              </dl>
            </>
          )}

          <button className="primary" type="submit" disabled={loading}>
            {step < STEPS.length - 1
              ? 'Next'
              : loading
                ? 'Creating account…'
                : accountCreated
                  ? 'Save profile'
                  : 'Create account'}
          </button>
          {step > 0 && !loading && (
            <button className="secondary" type="button" onClick={() => goTo(step - 1)}>
              Back
            </button>
          )}
          {accountCreated && !loading && (
            <button className="secondary" type="button" onClick={() => router.replace('/profile')}>
              Skip to profile
            </button>
          )}
        </form>

        <div className="switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
