import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Alert, Button } from "./ui";

const SessionExpiryBanner = () => {
  const { sessionExpiresAt, keepSessionAlive } = useAuth();
  const [remaining, setRemaining] = useState(() => sessionExpiresAt ? sessionExpiresAt - Date.now() : Infinity);

  useEffect(() => {
    const update = () => setRemaining(sessionExpiresAt ? sessionExpiresAt - Date.now() : Infinity);
    update();
    const timer = window.setInterval(update, remaining <= 5 * 60_000 ? 1000 : 15_000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt, remaining <= 5 * 60_000]);

  if (!sessionExpiresAt || remaining <= 0 || remaining > 5 * 60_000) return null;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.max(0, Math.floor((remaining % 60_000) / 1000));

  return (
    <Alert tone="warning" title="Your session will expire soon" actions={<Button type="button" variant="secondary" onClick={keepSessionAlive}>Stay Signed In</Button>}>
      <p>For your security, you'll be signed out in {minutes}:{String(seconds).padStart(2, "0")} unless you continue using the portal.</p>
    </Alert>
  );
};

export default SessionExpiryBanner;
