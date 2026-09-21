import { OwnerCapabilityGuard } from '@/components/owner/OwnerCapabilityGuard';
import CalendarClient from './CalendarClient';

export default function OwnerCalendarPage() {
  return (
    <OwnerCapabilityGuard anyCapability={['calendar.read']}>
      <CalendarClient />
    </OwnerCapabilityGuard>
  );
}
