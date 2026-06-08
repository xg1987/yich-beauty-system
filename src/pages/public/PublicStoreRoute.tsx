import { useMemo } from "react";
import { createApiClient } from "../../api/client";
import StorefrontPage from "./StorefrontPage";

export default function PublicStoreRoute({ shareCode }: { shareCode: string }) {
  const publicClient = useMemo(() => createApiClient(() => undefined), []);
  return (
    <StorefrontPage
      shareCode={shareCode}
      fetchPublicStore={publicClient.fetchPublicStore}
      createPublicBookingRequest={publicClient.createPublicBookingRequest}
    />
  );
}
