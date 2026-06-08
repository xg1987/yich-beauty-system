import { useMemo } from "react";
import { createApiClient } from "../../api/client";
import CustomerSignaturePage from "./CustomerSignaturePage";

export default function PublicSignatureRoute({ token }: { token: string }) {
  const publicClient = useMemo(() => createApiClient(() => undefined), []);
  return (
    <CustomerSignaturePage
      token={token}
      fetchSignature={publicClient.fetchPublicCustomerSignature}
      signSignature={publicClient.signPublicCustomerSignature}
    />
  );
}
