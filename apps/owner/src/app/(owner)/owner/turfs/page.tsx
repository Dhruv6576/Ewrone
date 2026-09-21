import { OwnerCapabilityGuard } from '@/components/owner/OwnerCapabilityGuard';
import TurfsClient from './TurfsClient';

export default function OwnerTurfsPage() {
  return (
    <OwnerCapabilityGuard anyCapability={['listing.edit']}>
      <TurfsClient />
    </OwnerCapabilityGuard>
  );
}
