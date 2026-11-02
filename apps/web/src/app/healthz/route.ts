export const dynamic = 'force-dynamic';

/** Liveness des Web-Containers (unabhängig von der API). */
export function GET() {
  return Response.json({ status: 'ok', service: 'web' });
}
