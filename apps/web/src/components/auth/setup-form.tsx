'use client';

import { PASSWORD_MIN_LENGTH } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Field, FormError } from '../ui/field';
import { submitClass } from './auth-shell';

export function SetupForm() {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await apiPost('/auth/setup', {
            name: f.get('name'),
            email: f.get('email'),
            password: f.get('password'),
            workspaceName: f.get('workspaceName'),
          });
          window.location.href = '/';
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Field label={t('name')} name="name" autoComplete="name" required maxLength={100} autoFocus />
      <Field
        label={t('email')}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={t('emailPlaceholder')}
        required
      />
      <Field
        label={t('password')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        hint={t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
      />
      <Field
        label={t('workspaceName')}
        name="workspaceName"
        placeholder={t('workspaceNamePlaceholder')}
        required
        maxLength={100}
      />
      <FormError>{error}</FormError>
      <button type="submit" className={submitClass} disabled={busy}>
        {t('setupSubmit')}
      </button>
    </form>
  );
}
