'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient, extractDatabaseErrorObject, ExtractedDatabaseError } from '@boxcodex/shared';
import { Building2, Save, Send, AlertCircle, CheckCircle, MapPin, Sparkles, Layers } from 'lucide-react';

interface AmenityItem {
  code: string;
  name: string;
}

const ISO_WEEKDAYS = [
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' },
  { day: 7, label: 'Sunday' },
];

export default function OnboardTurfPage() {
  const router = useRouter();
  const supabase = createBrowserClient('owner');

  // Form Fields
  const [name, setName] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [addressText, setAddressText] = useState('');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState('12.9716');
  const [lng, setLng] = useState('77.6413');

  // Amenities from DB
  const [availableAmenities, setAvailableAmenities] = useState<AmenityItem[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  // Initial Court
  const [courtName, setCourtName] = useState('Court 1');
  const [bookingIncrement, setBookingIncrement] = useState<number>(30);
  const [minDuration, setMinDuration] = useState<number>(60);
  const [maxDuration, setMaxDuration] = useState<number>(240);

  // Operating Hours
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('23:00');

  // Loading & Feedback
  const [loadingAmenities, setLoadingAmenities] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ExtractedDatabaseError | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch real amenities from database
  useEffect(() => {
    async function loadAmenities() {
      try {
        setLoadingAmenities(true);
        const { data, error } = await supabase
          .from('amenities')
          .select('code, name')
          .order('name', { ascending: true });

        if (error) throw error;
        if (data && data.length > 0) {
          setAvailableAmenities(data);
          // Default selection: floodlights and changing_room if present
          const defaults = data
            .filter((a) => ['floodlights', 'changing_room', 'parking'].includes(a.code))
            .map((a) => a.code);
          setSelectedAmenities(defaults);
        }
      } catch (err: unknown) {
        console.error('Failed to load amenities:', err);
        setErrorInfo(extractDatabaseErrorObject(err));
      } finally {
        setLoadingAmenities(false);
      }
    }

    loadAmenities();
  }, []);

  const toggleAmenity = (code: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSave = async (submitForApproval: boolean) => {
    setSubmitting(true);
    setErrorInfo(null);
    setSuccessMsg(null);

    try {
      // 1. Validation
      if (!name.trim()) {
        throw { message: 'Venue name is required', code: '22023' };
      }
      if (!city.trim()) {
        throw { message: 'City is required', code: '22023' };
      }
      if (!addressText.trim()) {
        throw { message: 'Physical address is required', code: '22023' };
      }

      // 2. Resolve Master Owner ID
      const { data: context, error: ctxErr } = await supabase.rpc('get_my_context');
      if (ctxErr) throw ctxErr;
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      if (!masterOwnerId) {
        throw {
          message: 'No active or onboarding master owner account found for this user',
          code: '42501',
        };
      }

      // 3. Location Point WKT
      const pointWkt = `POINT(${parseFloat(lng) || 77.6413} ${parseFloat(lat) || 12.9716})`;

      // 4. Create Draft Turf via public.create_turf RPC
      const { data: newTurfId, error: createErr } = await supabase.rpc('create_turf', {
        p_master_owner_id: masterOwnerId,
        p_name: name.trim(),
        p_city: city.trim(),
        p_address_text: addressText.trim(),
        p_location: pointWkt,
        p_description: description.trim() || 'Premier floodlit multi-sport box arena.',
        p_timezone: 'Asia/Kolkata',
      });

      if (createErr) throw createErr;
      if (!newTurfId) throw new Error('Venue creation returned empty identifier');

      // 5. Read actual current version from the created row
      const { data: turfRow, error: turfFetchErr } = await supabase
        .from('turfs')
        .select('id, version, approval_status')
        .eq('id', newTurfId)
        .single();

      if (turfFetchErr) throw turfFetchErr;
      const actualVersion = turfRow?.version ?? 1;

      // 6. Update turf onboarding with valid snake_case amenity codes
      const { error: updateErr } = await supabase.rpc('update_turf_onboarding', {
        p_turf_id: newTurfId,
        p_expected_version: actualVersion,
        p_description: description.trim() || 'Premier floodlit multi-sport box arena.',
        p_address_text: addressText.trim(),
        p_amenities: selectedAmenities,
        p_photos: [],
        p_resource_sports: null,
      });

      if (updateErr) throw updateErr;

      // 7. Insert initial court into public.resources
      const { data: resourceData, error: resErr } = await supabase
        .from('resources')
        .insert({
          master_owner_id: masterOwnerId,
          turf_id: newTurfId,
          name: courtName.trim() || 'Court 1',
          active: true,
          booking_increment_minutes: bookingIncrement,
          minimum_duration_minutes: minDuration,
          maximum_duration_minutes: maxDuration,
          schedule_version: 1,
        })
        .select('id')
        .single();

      if (resErr) throw resErr;
      const resourceId = resourceData.id;

      // 7b. Insert default sport into resource_sports
      const { error: sportErr } = await supabase
        .from('resource_sports')
        .insert({
          resource_id: resourceId,
          sport_code: 'cricket',
        });
      if (sportErr) throw sportErr;

      // 7c. Configure default pricing rule via upsert_pricing_rule so quotes/bookings succeed
      const todayStr = new Date().toISOString().split('T')[0];
      const { error: priceErr } = await supabase.rpc('upsert_pricing_rule', {
        p_rule_id: null,
        p_resource_id: resourceId,
        p_valid_from: todayStr,
        p_valid_until: null,
        p_iso_weekdays: [1, 2, 3, 4, 5, 6, 7],
        p_starts_local: `${openTime}:00`,
        p_ends_local: `${closeTime}:00`,
        p_amount_per_increment_minor: 50000,
        p_priority: 0,
        p_active: true,
      });
      if (priceErr) throw priceErr;

      // 8. Configure operating hours for this court (auto-materializes slots in migration 24)
      const hoursPayload = ISO_WEEKDAYS.map(({ day }) => ({
        iso_weekday: day,
        opens_at: `${openTime}:00`,
        closes_at: `${closeTime}:00`,
        closes_next_day: false,
      }));

      const { error: hoursErr } = await supabase.rpc('set_resource_operating_hours', {
        p_resource_id: resourceId,
        p_hours: hoursPayload,
      });

      if (hoursErr) throw hoursErr;

      // 9. Submit for approval if requested: draft -> pending
      if (submitForApproval) {
        const { error: submitErr } = await supabase.rpc('submit_turf_for_approval', {
          p_turf_id: newTurfId,
        });
        if (submitErr) throw submitErr;
        setSuccessMsg(
          `Venue "${name.trim()}" created as draft, configured with court & schedule, and submitted to Platform Admin for approval (Status: Pending Review).`
        );
      } else {
        setSuccessMsg(
          `Venue "${name.trim()}" successfully created as draft with configured amenities, court, and operating schedule.`
        );
      }
    } catch (err: unknown) {
      console.error('Venue onboarding error:', err);
      setErrorInfo(extractDatabaseErrorObject(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-emerald-400" />
          Venue Onboarding Wizard
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Register a new sports arena, configure amenities, court specs, and submit for platform review.
        </p>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="p-4 rounded-xl text-xs flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
          <span className="font-medium">{successMsg}</span>
        </div>
      )}

      {/* Diagnosable Error Banner with SQLSTATE */}
      {errorInfo && (
        <div className="p-4 rounded-xl text-xs bg-red-500/10 border border-red-500/20 text-red-300 space-y-1">
          <div className="flex items-center gap-2 font-semibold text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Onboarding Operation Failed</span>
            {errorInfo.code && (
              <span className="px-1.5 py-0.5 rounded bg-red-950/80 border border-red-800 text-[10px] font-mono text-red-300">
                SQLSTATE: {errorInfo.code}
              </span>
            )}
          </div>
          <p className="text-red-200 pl-6">{errorInfo.message}</p>
          {errorInfo.details && (
            <p className="text-slate-400 pl-6 text-[11px]">Details: {errorInfo.details}</p>
          )}
          {errorInfo.hint && (
            <p className="text-slate-400 pl-6 text-[11px]">Hint: {errorInfo.hint}</p>
          )}
        </div>
      )}

      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-6">
        {/* Section 1: Venue Information */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
            <MapPin className="w-4 h-4 text-emerald-400" />
            1. Core Venue Details
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Venue Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Apex Sports Arena"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                City <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Bengaluru"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Physical Address <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              placeholder="Plot No., Street, Area, Landmark"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Latitude</label>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="12.9716"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Longitude</label>
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="77.6413"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Venue Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe playing surfaces, lighting quality, seating, and special amenities..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Section 2: Validated Amenities from Database */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            2. Amenities & Facilities (Validated against Database)
          </h2>

          {loadingAmenities ? (
            <div className="text-xs text-slate-400 py-2 animate-pulse">Loading verified amenities...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {availableAmenities.map((amenity) => {
                const isSelected = selectedAmenities.includes(amenity.code);
                return (
                  <label
                    key={amenity.code}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition ${
                      isSelected
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAmenity(amenity.code)}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5"
                    />
                    <span>{amenity.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3: Initial Resource / Court */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            3. Court & Resource Configuration
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1">Court Name</label>
              <input
                type="text"
                value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
                placeholder="Court 1 (Box Pitch)"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Increment (min)</label>
              <input
                type="number"
                step="15"
                min="15"
                max="120"
                value={bookingIncrement}
                onChange={(e) => setBookingIncrement(parseInt(e.target.value) || 30)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Min Duration (min)</label>
              <input
                type="number"
                step="30"
                min="30"
                max="180"
                value={minDuration}
                onChange={(e) => setMinDuration(parseInt(e.target.value) || 60)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Opening Time (IST)</label>
              <input
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Closing Time (IST)</label>
              <input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-slate-800">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSave(false)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Save as Draft
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSave(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-lg shadow-emerald-950"
          >
            <Send className="w-4 h-4" /> Save & Submit for Approval
          </button>
        </div>
      </div>
    </div>
  );
}
