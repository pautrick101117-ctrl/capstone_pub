import { useEffect, useState } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button, Card } from "../ui";

export default function RouteError() {
  const error = useRouteError();
  const [reference] = useState(() => `UI-${crypto.randomUUID().slice(0, 8)}`);
  useEffect(() => {
    if (import.meta.env.DEV) console.error(reference, error);
  }, [error, reference]);
  const dashboard = window.location.pathname.startsWith("/admin")
    ? "/admin"
    : "/portal";
  return (
    <main className="mx-auto max-w-xl p-8">
      <Card>
        <h1 className="text-2xl font-bold">This page could not be loaded</h1>
        <p className="my-4">
          {isRouteErrorResponse(error) && error.status === 404
            ? "The requested page was not found."
            : "Please try again. If the problem continues, share the reference below with barangay staff."}
        </p>
        <p className="mb-6 text-sm">Reference: {reference}</p>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <a className="rounded-full border px-5 py-3" href={dashboard}>
            Return to dashboard
          </a>
        </div>
      </Card>
    </main>
  );
}

