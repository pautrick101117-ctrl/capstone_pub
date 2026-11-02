export const isResidentSession = (auth) => Boolean(auth?.isAuthenticated && auth.user?.role === 'resident');

export const residentDestination = (auth, destination = '/portal') => isResidentSession(auth)
  ? destination : destination === '/portal' ? '/login' : `/login?next=${encodeURIComponent(destination)}`;

