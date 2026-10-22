export function getAdminSeedCredentials(environment) {
  const missing = ['ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter((key) => !environment[key]);
  if (missing.length) {
    throw new Error(`Missing required seed environment variables: ${missing.join(', ')}`);
  }

  return {
    adminEmail: environment.ADMIN_EMAIL,
    adminPassword: environment.ADMIN_PASSWORD,
  };
}