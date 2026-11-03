'use client';

import type { WorkspaceSummaryDto } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Field, FormError } from '../ui/field';
import { submitClass } from './auth-shell';

export function CreateWorkspaceForm() {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const w = await apiPost<WorkspaceSummaryDto>('/workspaces', {
            name: new FormData(e.currentTarget).get('name'),
          });
          window.location.href = `/w/${w.id}`;
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field
        label={t('workspaceName')}
        name="name"
        placeholder={t('workspaceNamePlaceholder')}
        required
        maxLength={100}
        autoFocus
      />
      <FormError>{error}</FormError>
      <button type="submit" className={submitClass}>
        {t('startSubmit')}
      </button>
    </form>
  );
}
