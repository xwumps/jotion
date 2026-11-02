'use client';

import { PASSWORD_MIN_LENGTH } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Field, FormError } from '../ui/field';
import { submitClass } from './auth-shell';

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-[14px] text-fg-muted">{t('resetDone')}</p>
        <a href="/login" className={`${submitClass} inline-flex items-center justify-center`}>
          {t('toLogin')}
        </a>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await apiPost('/auth/password-reset', { token, newPassword: f.get('password') });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field
        label={t('newPassword')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        autoFocus
        hint={t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
      />
      <FormError>{error}</FormError>
      <button type="submit" className={submitClass} disabled={busy}>
        {t('resetSubmit')}
      </button>
    </form>
  );
}
