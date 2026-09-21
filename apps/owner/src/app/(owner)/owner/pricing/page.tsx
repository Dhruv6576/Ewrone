import { OwnerCapabilityGuard } from '@/components/owner/OwnerCapabilityGuard';
import PricingClient from './PricingClient';

export default function OwnerPricingPage() {
  return (
    <OwnerCapabilityGuard anyCapability={['pricing.read', 'pricing.edit']}>
      <PricingClient />
    </OwnerCapabilityGuard>
  );
}
