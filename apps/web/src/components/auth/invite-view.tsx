'use client';

import type { InvitationPreviewDto, MeDto } from '@jotion/shared';
import { PASSWORD_MIN_LENGTH } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Field, FormError } from '../ui/field';
import { AuthShell, submitClass } from './auth-shell';
import { LoginForm } from './login-form';

export function InviteView({
  token,
  preview,
  me,
}: {
  token: string;
  preview: InvitationPreviewDto | null;
  me: MeDto | null;
}) {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');

  if (!preview) {
    return (
      <AuthShell title={t('inviteInvalidTitle')} intro={t('inviteInvalid')}>
        <a href="/login" className="block text-center text-[14px] text-accent hover:underline">
          {t('toLogin')}
        </a>
      </AuthShell>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ workspaceId: string }>(`/auth/invitations/${token}/accept`);
      window.location.href = `/w/${res.workspaceId}`;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const title = t('inviteTitle', { workspace: preview.workspaceName });
  if (me) {
    return (
      <AuthShell title={title} intro={t('inviteLoggedInAs', { email: me.user.email })}>
        <FormError>{error}</FormError>
        <button type="button" className={submitClass} onClick={() => void accept()} disabled={busy}>
          {t('inviteJoin')}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} intro={mode === 'register' ? t('inviteIntro') : t('inviteLoginIntro')}>
      {mode === 'login' ? (
        <LoginForm onSuccess={() => void accept()} />
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError(null);
            try {
              await apiPost('/auth/register', {
                token,
                name: f.get('name'),
                email: f.get('email'),
                password: f.get('password'),
              });
              window.location.href = '/';
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <Field
            label={t('name')}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            autoFocus
          />
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
          <FormError>{error}</FormError>
          <button type="submit" className={submitClass} disabled={busy}>
            {t('inviteRegister')}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
        className="mt-4 block w-full text-center text-[13px] text-fg-muted hover:text-fg hover:underline"
      >
        {mode === 'register' ? t('inviteHaveAccount') : t('inviteNeedAccount')}
      </button>
    </AuthShell>
  );
}
