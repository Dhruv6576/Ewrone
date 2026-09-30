'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import TurfCard from '@/components/TurfCard';
import { 
  Search, MapPin, Calendar, Clock, Filter, 
  Sparkles, Trophy, Star, ArrowUpDown, X, ShieldCheck 
} from 'lucide-react';

interface Turf {
  id: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  description?: string;
  resourcesCount?: number;
  startingPriceMinor?: number;
  startingAdvanceMinor?: number;
  advanceMode?: 'fixed_per_slot' | 'percentage' | 'full';
  advanceBasisPoints?: number;
  imageUrl?: string;
}

const CITIES = [
  'All Areas',
  'Koramangala',
  'Indiranagar',
  'HSR Layout',
  'Whitefield',
  'JP Nagar',
  'Bellandur',
];

const DATE_OPTIONS = [
  { id: 'today', label: 'Today', sublabel: 'Sep 28' },
  { id: 'tomorrow', label: 'Tomorrow', sublabel: 'Sep 29' },
  { id: 'tue', label: 'Tue', sublabel: 'Sep 30' },
  { id: 'wed', label: 'Wed', sublabel: 'Oct 1' },
  { id: 'weekend', label: 'Weekend', sublabel: 'Sat/Sun' },
];

const TIME_SLOTS = [
  { id: 'all', label: 'All Hours' },
  { id: 'morning', label: 'Morning (6 AM - 12 PM)' },
  { id: 'afternoon', label: 'Afternoon (12 PM - 5 PM)' },
  { id: 'evening', label: 'Evening Prime (5 PM - 9 PM)' },
  { id: 'night', label: 'Night Floodlit (9 PM - 2 AM)' },
];

export default function ExploreCatalog({ initialTurfs }: { initialTurfs: Turf[] }) {
  const searchParams = useSearchParams();
  const initialCity = searchParams.get('city') || 'All Areas';

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState(initialCity);
  const [selectedDate, setSelectedDate] = useState('today');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('all');
  
  // Specific Filters
  const [priceFilter, setPriceFilter] = useState<'all' | 'under800' | '800to1200' | 'above1200'>('all');
  const [distanceFilter, setDistanceFilter] = useState<'all' | '5km' | '10km' | '15km'>('all');
  const [turfTypeFilter, setTurfTypeFilter] = useState<'all' | 'indoor' | 'outdoor'>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | '4.8' | '4.5' | '4.0'>('all');
  const [sortBy, setSortBy] = useState<'recommended' | 'price_asc' | 'price_desc' | 'rating'>('recommended');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Active filter count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedCity !== 'All Areas') count++;
    if (selectedTimeSlot !== 'all') count++;
    if (priceFilter !== 'all') count++;
    if (distanceFilter !== 'all') count++;
    if (turfTypeFilter !== 'all') count++;
    if (ratingFilter !== 'all') count++;
    return count;
  }, [selectedCity, selectedTimeSlot, priceFilter, distanceFilter, turfTypeFilter, ratingFilter]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCity('All Areas');
    setSelectedDate('today');
    setSelectedTimeSlot('all');
    setPriceFilter('all');
    setDistanceFilter('all');
    setTurfTypeFilter('all');
    setRatingFilter('all');
    setSortBy('recommended');
  };

  // Filtered & Sorted Turfs
  const filteredTurfs = useMemo(() => {
    return initialTurfs.filter((turf) => {
      // 1. Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = turf.name?.toLowerCase().includes(q);
        const matchesCity = turf.city?.toLowerCase().includes(q);
        const matchesAddr = turf.address_text?.toLowerCase().includes(q);
        if (!matchesName && !matchesCity && !matchesAddr) return false;
      }

      // 2. City Filter
      if (selectedCity !== 'All Areas') {
        const cityMatch = turf.city?.toLowerCase().includes(selectedCity.toLowerCase()) ||
                          turf.address_text?.toLowerCase().includes(selectedCity.toLowerCase());
        if (!cityMatch) return false;
      }

      // 3. Price Filter (startingPriceMinor is in paise, so 800 INR = 80000)
      const hourlyPrice = (turf.startingPriceMinor || 80000) / 100;
      if (priceFilter === 'under800' && hourlyPrice >= 800) return false;
      if (priceFilter === '800to1200' && (hourlyPrice < 800 || hourlyPrice > 1200)) return false;
      if (priceFilter === 'above1200' && hourlyPrice <= 1200) return false;

      // 4. Rating Filter
      const rating = 4.7 + ((turf.name.charCodeAt(0) % 3) * 0.1);
      if (ratingFilter === '4.8' && rating < 4.8) return false;
      if (ratingFilter === '4.5' && rating < 4.5) return false;
      if (ratingFilter === '4.0' && rating < 4.0) return false;

      return true;
    }).sort((a, b) => {
      const priceA = (a.startingPriceMinor || 80000) / 100;
      const priceB = (b.startingPriceMinor || 80000) / 100;
      const ratingA = 4.7 + ((a.name.charCodeAt(0) % 3) * 0.1);
      const ratingB = 4.7 + ((b.name.charCodeAt(0) % 3) * 0.1);

      if (sortBy === 'price_asc') return priceA - priceB;
      if (sortBy === 'price_desc') return priceB - priceA;
      if (sortBy === 'rating') return ratingB - ratingA;
      return 0; // recommended
    });
  }, [initialTurfs, searchQuery, selectedCity, priceFilter, ratingFilter, sortBy]);

  return (
    <div className="w-full">
      {/* ========================================================================= */}
      {/* 1. TOP DISCOVERY SEARCH & DATE PANEL */}
      {/* ========================================================================= */}
      <div className="glass-panel rounded-3xl p-5 sm:p-7 mb-8 border border-slate-200 dark:border-slate-800 shadow-xl relative overflow-hidden bg-white/95 dark:bg-[#0c1017] text-slate-900 dark:text-white transition-colors duration-200">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#00df81]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Search Bar Input */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch relative z-10 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by arena name, area, or locality (e.g., Koramangala, Indiranagar)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100 dark:bg-[#080b0e] border border-slate-200 dark:border-slate-800 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#00df81] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className="md:hidden flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-100 dark:bg-[#080b0e] border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <Filter className="w-4 h-4 text-[#00df81]" />
            <span>Filters {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
          </button>
        </div>

        {/* City Location Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none mb-5">
          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 shrink-0 mr-1 font-medium">
            <MapPin className="w-3.5 h-3.5 text-[#00df81]" />
            <span>Location:</span>
          </span>
          {CITIES.map((city) => (
            <button
              key={city}
              onClick={() => setSelectedCity(city)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                selectedCity === city
                  ? 'bg-[#00df81] text-slate-950 font-black shadow-md shadow-[#00df81]/25'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 dark:bg-[#080b0e] dark:text-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
              }`}
            >
              {city}
            </button>
          ))}
        </div>

        {/* Date Selector Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-4 border-t border-slate-200 dark:border-slate-800/80">
          {DATE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedDate(opt.id)}
              className={`p-2.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                selectedDate === opt.id
                  ? 'bg-[#00df81]/15 border-2 border-[#00df81] text-[#00df81] shadow-sm font-black'
                  : 'bg-slate-50 dark:bg-[#080b0e] border border-slate-200 dark:border-slate-800/80 text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#131d27]'
              }`}
            >
              <div className="text-xs font-bold">{opt.label}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">{opt.sublabel}</div>
            </button>
          ))}
        </div>

        {/* Time / Slot Selector Row */}
        <div className="flex items-center gap-2 overflow-x-auto pt-4 mt-3 border-t border-slate-200 dark:border-slate-800/60 scrollbar-none">
          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 shrink-0 mr-1 font-medium">
            <Clock className="w-3.5 h-3.5 text-[#00df81]" />
            <span>Preferred Time:</span>
          </span>
          {TIME_SLOTS.map((slot) => (
            <button
              key={slot.id}
              onClick={() => setSelectedTimeSlot(slot.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer ${
                selectedTimeSlot === slot.id
                  ? 'bg-[#00df81] text-slate-950 font-black shadow-sm'
                  : 'bg-slate-100 dark:bg-[#080b0e] text-slate-700 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-200'
              }`}
            >
              {slot.label}
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN LAYOUT: FILTERS SIDEBAR + TURF CARDS GRID */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Filters Sidebar (Desktop) */}
        <div className={`lg:block ${showMobileFilters ? 'block' : 'hidden'} lg:col-span-1 space-y-6`}>
          <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 sticky top-24 bg-white/95 dark:bg-[#0c1017] transition-colors duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                <Filter className="w-4 h-4 text-[#00df81]" />
                <span>Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#00df81] text-slate-950 font-bold">
                    {activeFiltersCount}
                  </span>
                )}
              </div>

              {activeFiltersCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="text-xs text-slate-500 hover:text-[#00df81] dark:text-slate-400 dark:hover:text-[#00df81] transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Filter: Price */}
            <div className="py-4 border-b border-slate-200 dark:border-slate-800/80">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-300 uppercase tracking-wider block mb-2.5">
                Hourly Price
              </label>
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { id: 'all', label: 'All Prices' },
                  { id: 'under800', label: 'Under ₹800/hr' },
                  { id: '800to1200', label: '₹800 - ₹1,200/hr' },
                  { id: 'above1200', label: '₹1,200+/hr' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-white">
                    <input
                      type="radio"
                      name="priceFilter"
                      checked={priceFilter === item.id}
                      onChange={() => setPriceFilter(item.id as any)}
                      className="accent-[#00df81]"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Filter: Distance */}
            <div className="py-4 border-b border-slate-200 dark:border-slate-800/80">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-300 uppercase tracking-wider block mb-2.5">
                Distance
              </label>
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { id: 'all', label: 'Any Distance' },
                  { id: '5km', label: 'Within 5 km' },
                  { id: '10km', label: 'Within 10 km' },
                  { id: '15km', label: 'Within 15 km' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-white">
                    <input
                      type="radio"
                      name="distFilter"
                      checked={distanceFilter === item.id}
                      onChange={() => setDistanceFilter(item.id as any)}
                      className="accent-[#00df81]"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Filter: Indoor / Outdoor */}
            <div className="py-4 border-b border-slate-200 dark:border-slate-800/80">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-300 uppercase tracking-wider block mb-2.5">
                Turf Setup
              </label>
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { id: 'all', label: 'All Setups' },
                  { id: 'indoor', label: 'Covered / Indoor Box Nets' },
                  { id: 'outdoor', label: 'Open-Air Floodlit Turf' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-white">
                    <input
                      type="radio"
                      name="turfType"
                      checked={turfTypeFilter === item.id}
                      onChange={() => setTurfTypeFilter(item.id as any)}
                      className="accent-[#00df81]"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Filter: Ratings */}
            <div className="pt-4">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-300 uppercase tracking-wider block mb-2.5">
                Player Ratings
              </label>
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { id: 'all', label: 'All Ratings' },
                  { id: '4.8', label: '⭐ 4.8 & Above' },
                  { id: '4.5', label: '⭐ 4.5 & Above' },
                  { id: '4.0', label: '⭐ 4.0 & Above' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-white">
                    <input
                      type="radio"
                      name="ratingFilter"
                      checked={ratingFilter === item.id}
                      onChange={() => setRatingFilter(item.id as any)}
                      className="accent-[#00df81]"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Lock Assurance Tag */}
            <div className="mt-6 p-3 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 text-[11px] text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-1.5 text-[#00df81] font-semibold mb-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Instant Slot Lock</span>
              </div>
              <div>Lock your arena slot online with owner advance. Rest payable directly at the venue.</div>
            </div>
          </div>
        </div>

        {/* Turf Cards Grid (3 Columns on desktop) */}
        <div className="lg:col-span-3">
          {/* Header Row: Result count & Sort Dropdown */}
          <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-200 dark:border-slate-800/80">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <Trophy className="w-5 h-5 text-[#00df81]" />
                <span>Available Cricket Turfs</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Showing {filteredTurfs.length} verified arenas in {selectedCity}
              </p>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 hidden sm:block" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-100 dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:border-[#00df81] cursor-pointer"
              >
                <option value="recommended">Recommended</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="rating">Highest Rated</option>
              </select>
            </div>
          </div>

          {/* Cards Grid */}
          {filteredTurfs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredTurfs.map((turf, idx) => (
                <TurfCard key={turf.id} turf={turf} index={idx} />
              ))}
            </div>
          ) : (
            <div className="glass-panel rounded-3xl p-12 text-center border border-slate-200 dark:border-slate-800 my-8 bg-white/95 dark:bg-[#0c1017]">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-[#080b0e] text-slate-500 flex items-center justify-center mx-auto mb-4 border border-slate-200 dark:border-slate-800">
                <Search className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">No matching arenas found</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-2">
                No turfs match your selected filters. Try broadening your search or resetting filters.
              </p>
              <button
                onClick={resetFilters}
                className="mt-5 px-6 py-2.5 rounded-md text-xs font-black tracking-wider uppercase text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25 cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
