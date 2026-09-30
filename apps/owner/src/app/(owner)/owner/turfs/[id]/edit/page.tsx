'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient, extractDatabaseErrorObject, ExtractedDatabaseError } from '@boxcodex/shared';
import { Building2, Save, Send, AlertCircle, CheckCircle, MapPin, Sparkles, Layers, ImagePlus, X } from 'lucide-react';

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

export default function EditTurfPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createBrowserClient('owner');

  // Form Fields
  const [name, setName] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [addressText, setAddressText] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<File[]>([]);

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
          // Do not pre-select any amenities
          setSelectedAmenities([]);
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
        setErrorInfo({ message: 'Venue name is required', code: 'VALIDATION' } as ExtractedDatabaseError);
        return;
      }
      if (!city.trim()) {
        setErrorInfo({ message: 'City is required', code: 'VALIDATION' } as ExtractedDatabaseError);
        return;
      }
      if (!addressText.trim()) {
        setErrorInfo({ message: 'Physical address is required', code: 'VALIDATION' } as ExtractedDatabaseError);
        return;
      }

      // Update core turf data
      const { error: updateCoreErr } = await supabase
        .from('turfs')
        .update({
          name: name.trim(),
          city: city.trim()
        })
        .eq('id', params.id);
        
      if (updateCoreErr) throw updateCoreErr;

      // Read actual current version from the created row
      const { data: turfRow, error: turfFetchErr } = await supabase
        .from('turfs')
        .select('id, version, approval_status')
        .eq('id', params.id)
        .single();

      if (turfFetchErr) throw turfFetchErr;
      const actualVersion = turfRow?.version ?? 1;

      // Update turf onboarding with valid snake_case amenity codes
      const { error: updateErr } = await supabase.rpc('update_turf_onboarding', {
        p_turf_id: params.id,
        p_expected_version: actualVersion,
        p_description: description.trim(),
        p_address_text: addressText.trim(),
        p_amenities: selectedAmenities,
        p_photos: [],
        p_resource_sports: null,
      });

      if (updateErr) throw updateErr;

      setSuccessMsg(`Venue "${name.trim()}" successfully updated.`);
    } catch (err: unknown) {

      console.error('Venue onboarding error:', err);
      setErrorInfo(extractDatabaseErrorObject(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2.5">
          <Building2 className="w-6 h-6 text-neutral-900 dark:text-white" />
          Venue Editing Wizard
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Edit your venue details and amenities.
        </p>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="p-4 rounded-xl text-xs flex items-center gap-2 bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/20 text-neutral-200">
          <CheckCircle className="w-5 h-5 shrink-0 text-neutral-200" />
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
            <p className="text-neutral-500 dark:text-neutral-400 pl-6 text-[11px]">Details: {errorInfo.details}</p>
          )}
          {errorInfo.hint && (
            <p className="text-neutral-500 dark:text-neutral-400 pl-6 text-[11px]">Hint: {errorInfo.hint}</p>
          )}
        </div>
      )}

      <div className="p-8 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-2xl shadow-sm space-y-8">
        {/* Section 1: Venue Information */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-200 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <MapPin className="w-5 h-5 text-neutral-900" />
            1. Core Venue Details
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-neutral-900 dark:text-neutral-300 uppercase tracking-wider mb-2">
                Venue Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Apex Sports Arena"
                className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-900 dark:border-white focus:ring-1 focus:ring-neutral-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-neutral-900 dark:text-neutral-300 uppercase tracking-wider mb-2">
                City <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Bengaluru"
                className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-900 dark:border-white focus:ring-1 focus:ring-neutral-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-neutral-900 dark:text-neutral-300 uppercase tracking-wider mb-2">
              Physical Address <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              placeholder="Plot No., Street, Area, Landmark"
              className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-900 dark:border-white focus:ring-1 focus:ring-neutral-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-neutral-900 dark:text-neutral-300 uppercase tracking-wider mb-2">Venue Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe playing surfaces, lighting quality, seating, and special amenities..."
              className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-xl text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-900 dark:border-white focus:ring-1 focus:ring-neutral-900"
            />
          </div>
        </div>

        {/* NEW Section: Image Upload */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-200 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <ImagePlus className="w-5 h-5 text-neutral-900" />
            Images & Media
          </h2>
          <div className="space-y-3">
            <label className="block text-[11px] font-bold text-neutral-900 dark:text-neutral-300 uppercase tracking-wider mb-2">
              Venue Photos <span className="text-red-400">*</span>
            </label>
            <div className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl p-6 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center text-center transition hover:bg-neutral-100 cursor-pointer relative group">
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.files) {
                    setImages((prev) => [...prev, ...Array.from(e.target.files as FileList)]);
                  }
                }}
              />
              <div className="w-12 h-12 bg-white dark:bg-neutral-900 rounded-full flex items-center justify-center border border-neutral-200 dark:border-neutral-800 shadow-sm mb-3 pointer-events-none transition group-hover:scale-105">
                <ImagePlus className="w-5 h-5 text-neutral-400" />
              </div>
              <p className="text-sm font-bold text-neutral-700 dark:text-neutral-300 pointer-events-none">Click or drag images to upload</p>
              <p className="text-[11px] text-neutral-500 mt-1 pointer-events-none">High resolution JPEG or PNG. Max 5MB each.</p>
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-4">
                {images.map((img, idx) => (
                  <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-neutral-200 bg-neutral-100 flex items-center justify-center group/img">
                    <img src={URL.createObjectURL(img)} alt="preview" className="object-cover w-full h-full" />
                    <button 
                      type="button" 
                      className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-red-500"
                      onClick={() => setImages(images.filter((_, i) => i !== idx))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Validated Amenities from Database */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-200 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <Sparkles className="w-5 h-5 text-neutral-900" />
            2. Amenities & Facilities (Validated against Database)
          </h2>

          {loadingAmenities ? (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 py-2 animate-pulse">Loading verified amenities...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {availableAmenities.map((amenity) => {
                const isSelected = selectedAmenities.includes(amenity.code);
                return (
                  <label
                    key={amenity.code}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-sm font-semibold cursor-pointer transition ${isSelected
                        ? 'bg-neutral-900 dark:bg-white/10 border-neutral-900 dark:border-white/40 text-white'
                        : 'bg-neutral-50 dark:bg-neutral-950 border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-neutral-500'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAmenity(amenity.code)}
                      className="rounded border-neutral-700 text-neutral-900 dark:text-white focus:ring-neutral-900 dark:ring-white h-3.5 w-3.5"
                    />
                    <span>{amenity.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Form Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-neutral-300 dark:border-neutral-800">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSave(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-neutral-900 hover:bg-black dark:bg-white text-white rounded-xl text-sm font-bold transition disabled:opacity-50 shadow-lg shadow-neutral-950/20"
          >
            <Save className="w-4 h-4" /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
