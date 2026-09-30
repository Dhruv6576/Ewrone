import { Metadata } from 'next';
import SettingsClient from './SettingsClient';

export const metadata: Metadata = {
  title: 'Profile Settings | Box Codex',
  description: 'Manage your profile and business settings.',
};

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <SettingsClient />
    </div>
  );
}
