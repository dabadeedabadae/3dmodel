'use client';

import { InputHTMLAttributes, useState } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * A password field with an eye button at the end: the password is visible only while the button is held down
 * (mouse, finger, or Space / Enter on the keyboard) and hidden again on release.
 */
export default function PasswordInput({ disabled, ...props }: Props) {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);

  return (
    <div className="password-input">
      <input {...props} disabled={disabled} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="password-eye"
        aria-label={shown ? 'Hide password' : 'Hold to show password'}
        aria-pressed={shown}
        title="Hold to show password"
        disabled={disabled}
        // keep the caret in the field while the button is pressed
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); show(); }}
        onPointerUp={hide}
        onPointerCancel={hide}
        onLostPointerCapture={hide}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); show(); } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') hide(); }}
        onBlur={hide}
        onContextMenu={(e) => e.preventDefault()}
      >
        {shown ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.8 9.8 0 0 0 5.4-1.6" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
