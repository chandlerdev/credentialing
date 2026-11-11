"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ErrorState, Loading } from "@/components/AsyncState";
import { ProviderReadView } from "@/components/superadmin/ProviderReadView";

export default function AllProvidersDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Route />
    </Suspense>
  );
}

function Route() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = Number(params.id);
  const org = Number(search.get("org"));
  // back to the same admin + organization selection
  const back = new URLSearchParams();
  if (search.get("admin")) back.set("admin", search.get("admin") as string);
  if (!Number.isInteger(id) || id <= 0) return <ErrorState message="Invalid provider." />;
  return (
    <ProviderReadView
      key={id}
      providerId={id}
      orgId={Number.isInteger(org) && org > 0 ? org : null}
      backHref={"/all-providers" + (back.toString() ? "?" + back : "")}
    />
  );
}
