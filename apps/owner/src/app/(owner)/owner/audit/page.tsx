import { OwnerCapabilityGuard } from '@/components/owner/OwnerCapabilityGuard';
import AuditClient from './AuditClient';

export default function OwnerAuditPage() {
  return (
    <OwnerCapabilityGuard anyCapability={['audit.read']}>
      <AuditClient />
    </OwnerCapabilityGuard>
  );
}
