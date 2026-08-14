import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QueryLogDashboard from '@/components/admin/QueryLogDashboard';
import { getAuthenticatedAdminEmail } from '@/lib/admin/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI询问记录 · 管理后台',
  robots: { index: false, follow: false },
};

export default async function QueryLogsPage() {
  const requestHeaders = await headers();
  const adminEmail = getAuthenticatedAdminEmail(requestHeaders);
  if (!adminEmail) notFound();

  return <QueryLogDashboard adminEmail={adminEmail} />;
}
