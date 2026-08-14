interface HeaderReader {
  get(name: string): string | null;
}

function getAllowedEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getAuthenticatedAdminEmail(headers: HeaderReader): string | null {
  const assertion = headers.get('cf-access-jwt-assertion');
  const email = headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (!assertion || !email) return null;

  const allowed = getAllowedEmails();
  return allowed.size > 0 && allowed.has(email) ? email : null;
}
