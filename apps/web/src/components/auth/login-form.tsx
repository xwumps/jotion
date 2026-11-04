'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Field, FormError } from '../ui/field';
import { submitClass } from './auth-shell';

/** Nur interne Pfade als Rücksprungziel zulassen (kein Open Redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await apiPost('/auth/login', { email: f.get('email'), password: f.get('password') });
          if (onSuccess) onSuccess();
          else window.location.href = safeNext(params.get('next'));
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Field
        label={t('email')}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={t('emailPlaceholder')}
        required
        autoFocus
      />
      <Field
        label={t('password')}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError>{error}</FormError>
      <button type="submit" className={submitClass} disabled={busy}>
        {t('loginSubmit')}
      </button>
    </form>
  );
}
