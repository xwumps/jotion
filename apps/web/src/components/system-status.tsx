import type { HealthReport } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { getTranslations } from 'next-intl/server';

const SERVICES = ['database', 'redis', 'worker'] as const;

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 rounded-full',
        ok ? 'bg-[var(--c-green)]' : 'bg-[var(--c-red)]',
      )}
    />
  );
}

export async function SystemStatus({ report }: { report: HealthReport | null }) {
  const t = await getTranslations('home');
  const overall = report === null ? 'unreachable' : report.status;
  const summary =
    overall === 'ok'
      ? t('statusOk')
      : overall === 'error'
        ? t('statusError')
        : t('statusUnreachable');

  return (
    <section
      aria-labelledby="status-title"
      data-testid="system-status"
      data-status={overall}
      className="rounded-lg border border-border p-4"
    >
      <h2 id="status-title" className="text-[13px] font-medium text-fg-muted">
        {t('statusTitle')}
      </h2>
      <p className="mt-1 flex items-center gap-2 text-[15px] font-medium">
        <Dot ok={overall === 'ok'} />
        {summary}
      </p>
      {report && (
        <ul className="mt-3 space-y-1.5">
          {SERVICES.map((name) => {
            const check = report.checks[name];
            const ok = check?.status === 'ok';
            return (
              <li key={name} className="flex items-center gap-2 text-[14px] text-fg-muted">
                <Dot ok={ok} />
                <span className="text-fg">{t(`service.${name}`)}</span>
                <span className="ml-auto tabular-nums text-fg-subtle">
                  {ok ? `${check?.latencyMs ?? 0} ms` : (check?.error ?? '')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
