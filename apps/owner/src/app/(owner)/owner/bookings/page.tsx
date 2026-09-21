import { OwnerCapabilityGuard } from '@/components/owner/OwnerCapabilityGuard';
import BookingsClient from './BookingsClient';

export default function OwnerBookingsPage() {
  return (
    <OwnerCapabilityGuard anyCapability={['bookings.read', 'bookings.manage', 'bookings.create_walkin']}>
      <BookingsClient />
    </OwnerCapabilityGuard>
  );
}

