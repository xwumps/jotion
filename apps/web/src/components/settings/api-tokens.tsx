'use client';

import type { ApiTokenDto, CreatedApiTokenDto } from '@jotion/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost, errorMessage } from '@/lib/api-client';
import { Field, inputClass } from '../ui/field';

const KEY = ['apiTokens'] as const;

/** Phase 12: persönliche API-Tokens (Konto → API-Tokens). */
export function ApiTokens() {
  const t = useTranslations('apiTokens');
  const f = useFormatter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState('');
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const list = useQuery({ queryKey: KEY, queryFn: () => apiGet<ApiTokenDto[]>('/me/tokens') });
  const create = useMutation({
    mutationFn: () =>
      apiPost<CreatedApiTokenDto>('/me/tokens', {
        name: name.trim(),
        scope,
        ...(Number(days) > 0 ? { expiresInDays: Number(days) } : {}),
      }),
    onSuccess: (tok) => {
      setCreated(tok);
      setName('');
      setDays('');
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/me/tokens/${id}`),
    onSuccess: () => {
      toast.success(t('revoked'));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4" data-testid="api-tokens">
      <form
        method="post"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="min-w-[180px] flex-1">
          <Field
            label={t('name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            maxLength={100}
            required
            data-testid="api-token-name"
          />
        </div>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-medium">{t('scope')}</span>
          <select
            className={inputClass}
            value={scope}
            onChange={(e) => setScope(e.target.value as 'read' | 'write')}
            data-testid="api-token-scope"
          >
            <option value="read">{t('scopes.read')}</option>
            <option value="write">{t('scopes.write')}</option>
          </select>
        </label>
        <label className="flex w-[120px] flex-col gap-1 text-[13px]">
          <span className="font-medium">{t('days')}</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder={t('never')}
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-accent px-3 text-[14px] font-medium text-white disabled:opacity-50"
          disabled={!name.trim() || create.isPending}
          data-testid="api-token-create"
        >
          {t('create')}
        </button>
      </form>
      {created && (
        <div
          className="rounded-md border border-[var(--c-green)] bg-[var(--cb-green)] p-3 text-[13px]"
          role="status"
        >
          <p className="font-medium">{t('createdOnce')}</p>
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={created.token}
              className={`${inputClass} font-mono text-[12px]`}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="api-token-value"
            />
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(created.token)
                  .then(() => toast.success(t('copied')))
              }
              className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 text-[13px] hover:bg-hover"
            >
              <Copy className="size-3.5" />
              {t('copy')}
            </button>
          </div>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {list.data?.length === 0 && (
          <li className="px-3 py-3 text-[13px] text-fg-muted">{t('empty')}</li>
        )}
        {list.data?.map((tok) => (
          <li
            key={tok.id}
            className="flex items-center gap-3 px-3 py-2 text-[13px]"
            data-testid="api-token"
            data-name={tok.name}
          >
            <KeyRound className="size-4 shrink-0 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {tok.name}{' '}
                <span className="font-mono text-[12px] text-fg-subtle">{tok.prefix}…</span>
              </div>
              <div className="text-[12px] text-fg-muted">
                {t(`scopes.${tok.scope}`)}
                {' · '}
                {tok.lastUsedAt
                  ? t('lastUsed', {
                      date: f.dateTime(new Date(tok.lastUsedAt), { dateStyle: 'medium' }),
                    })
                  : t('neverUsed')}
                {tok.expiresAt &&
                  ` · ${t('expires', { date: f.dateTime(new Date(tok.expiresAt), { dateStyle: 'medium' }) })}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove.mutate(tok.id)}
              aria-label={t('revoke')}
              className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-[var(--c-red)]"
              data-testid="api-token-revoke"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
