import Link from 'next/link';
import { 
  Trophy, Search, ShieldCheck, Zap, Sparkles, MapPin, Calendar, Users, 
  Clock, ArrowRight, ArrowUpRight, CheckCircle2, Star, Quote, ChevronRight, Lock,
  CreditCard, QrCode, SlidersHorizontal
} from 'lucide-react';

export const revalidate = 60;

export default async function LandingPage() {
  const exploreTarget = '/explore';

  return (
    <div className="flex flex-col w-full text-slate-900 dark:text-white selection:bg-[#00df81] selection:text-slate-950 transition-colors duration-200 bg-[#080b0e]">
      {/* ========================================================================= */}
      {/* 1. HERO SECTION (EXACT MATCH TO PHOTO) */}
      {/* ========================================================================= */}
      <section className="relative w-full overflow-hidden bg-[#080b0e] min-h-screen flex items-center pt-24 pb-20 lg:pt-32 lg:pb-28 border-b border-slate-800/80">
        {/* Full-width box cricket arena photo background */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <img
            alt="Premium outdoor box cricket arena with AstroTurf pitch and city skyline"
            className="w-full h-full object-cover object-center lg:object-right brightness-[0.88] contrast-105"
            src="/images/box-cricket-arena.jpg"
          />
          {/* Subtle gradient overlay to keep text crisp while keeping the arena photo clearly visible */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#080b0e]/95 via-[#080b0e]/65 sm:via-[#080b0e]/55 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080b0e] via-transparent to-[#080b0e]/25" />
        </div>

        {/* Ambient Subtle Green Glow */}
        <div className="pointer-events-none absolute -top-40 left-0 w-[550px] h-[550px] rounded-full bg-[#00df81]/10 blur-[140px]" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl flex flex-col items-start text-left">
            {/* Tagline Overline: — OWN THE NEXT INNINGS */}
            <div className="flex items-center gap-3 mb-4">
              <span className="w-8 h-0.5 bg-[#00df81] inline-block" />
              <span className="text-xs font-extrabold text-slate-300 uppercase tracking-[0.25em] font-display">
                OWN THE NEXT INNINGS
              </span>
            </div>

            {/* Main Headline: EWRONE */}
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black text-white tracking-tight uppercase leading-none font-display drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
              EWRONE
            </h1>

            {/* Sub-headline: FIND IT. BOOK IT. PLAY IT. */}
            <div className="text-xl sm:text-2xl lg:text-3xl font-black text-[#00df81] tracking-[0.18em] uppercase mt-3.5 font-display drop-shadow-[0_2px_12px_rgba(0,223,129,0.35)]">
              FIND IT. BOOK IT. PLAY IT.
            </div>

            {/* Subtitle / Paragraph */}
            <p className="mt-5 text-sm sm:text-base text-slate-200 max-w-lg leading-relaxed font-normal font-sans-ui drop-shadow-md">
              Find the right box-cricket turf, lock your preferred slot, and get straight to the game. Premium venues, real-time availability, zero sideline hassle.
            </p>

            {/* Two Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/explore"
                className="px-6 py-3.5 rounded-lg text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center gap-2 shadow-lg shadow-[#00df81]/25 active:scale-95 cursor-pointer font-display"
              >
                <span>BOOK A TURF</span>
                <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
              </Link>

              <Link
                href="/explore"
                className="px-6 py-3.5 rounded-lg text-xs sm:text-sm font-extrabold uppercase tracking-wider text-white bg-slate-950/70 hover:bg-slate-900 border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-2 backdrop-blur-md active:scale-95 cursor-pointer font-display"
              >
                <span>EXPLORE TURFS</span>
                <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
              </Link>
            </div>

            {/* Guarantee Trust Row */}
            <div className="mt-6 flex items-center gap-2 text-xs text-slate-300 font-medium font-sans-ui">
              <CheckCircle2 className="w-4 h-4 text-[#00df81] shrink-0" />
              <span>Verified venues · Secure booking · Instant confirmation</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 2. HOW BOOKING WORKS (MATCHING EXACT DESIGN) */}
      {/* ========================================================================= */}
      <section id="how-it-works" className="w-full py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="flex items-center justify-center gap-3 mb-3">
            <span className="w-10 sm:w-12 h-0.5 bg-[#00df81]" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-[0.25em] font-display">
              HOW IT WORKS
            </span>
            <span className="w-10 sm:w-12 h-0.5 bg-[#00df81]" />
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight font-display">
            Book Your Turf in <span className="text-[#00df81]">3 Simple Steps</span>
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed font-sans-ui">
            From finding the perfect turf to stepping on the ground — the entire process is quick, transparent, and hassle-free.
          </p>
        </div>

        {/* 3 Step Cards with connecting line */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative pt-4">
          {/* Connecting Line for desktop */}
          <div className="hidden md:block absolute top-[48%] left-8 right-8 h-px bg-[#00df81] shadow-[0_0_8px_rgba(0,223,129,0.4)] -z-0 pointer-events-none" />

          {/* Step 1 */}
          <div className="rounded-[22px] pt-9 pb-8 px-7 bg-[#0a0e14] border border-slate-800/80 relative z-10 flex flex-col justify-between hover:border-[#00df81]/40 transition-all shadow-xl backdrop-blur-md group">
            {/* Top Badge */}
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-[#070b0f] border border-[#00df81] text-[#00df81] font-black text-sm flex items-center justify-center shadow-lg shadow-[#00df81]/15 group-hover:scale-105 transition-transform font-display">
              01
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-white font-display mb-3 text-left">
                Discover Your Arena
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-left font-sans-ui">
                Search and explore verified turfs near you. Filter by location, sport, price, facilities, and availability to find the perfect match.
              </p>
            </div>

            <div className="space-y-3.5 mt-8">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <MapPin className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>Search by city or area</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <SlidersHorizontal className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>Smart filters for sport, price & facilities</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <Star className="w-4 h-4 text-[#00df81] shrink-0 fill-[#00df81]" />
                <span>Verified venues only</span>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="rounded-[22px] pt-9 pb-8 px-7 bg-[#0a0e14] border border-slate-800/80 relative z-10 flex flex-col justify-between hover:border-[#00df81]/40 transition-all shadow-xl backdrop-blur-md group">
            {/* Top Badge */}
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-[#070b0f] border border-[#00df81] text-[#00df81] font-black text-sm flex items-center justify-center shadow-lg shadow-[#00df81]/15 group-hover:scale-105 transition-transform font-display">
              02
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-white font-display mb-3 text-left">
                Lock Real-Time Slot
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-left font-sans-ui">
                Choose your preferred date and time with live slot availability. Our system temporarily holds your slot for 10 minutes so no one else can take it.
              </p>
            </div>

            <div className="space-y-3.5 mt-8">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <Calendar className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>Live slot availability</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <Clock className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>10-minute hold</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <Zap className="w-4 h-4 text-[#00df81] shrink-0 fill-[#00df81]" />
                <span>Instant confirmation</span>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-[22px] pt-9 pb-8 px-7 bg-[#0a0e14] border border-slate-800/80 relative z-10 flex flex-col justify-between hover:border-[#00df81]/40 transition-all shadow-xl backdrop-blur-md group">
            {/* Top Badge */}
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-[#070b0f] border border-[#00df81] text-[#00df81] font-black text-sm flex items-center justify-center shadow-lg shadow-[#00df81]/15 group-hover:scale-105 transition-transform font-display">
              03
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-white font-display mb-3 text-left">
                Pay Advance & Play
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed text-left font-sans-ui">
                Confirm your booking by paying a small advance online. Get your match pass with QR check-in and head to the venue.
              </p>
            </div>

            <div className="space-y-3.5 mt-8">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <CreditCard className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>Secure online payments</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <QrCode className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>QR match pass</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-300 font-medium">
                <ShieldCheck className="w-4 h-4 text-[#00df81] shrink-0" />
                <span>Hassle-free check-in</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Feature Bar matching photo */}
        <div className="mt-12 rounded-2xl bg-[#0a0e14] border border-slate-800/80 p-5 sm:p-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-center shadow-xl">
          {/* Feature 1: Verified Venues */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] shrink-0">
              <ShieldCheck className="w-6 h-6 text-[#00df81]" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-extrabold text-sm sm:text-base text-white font-display">Verified Venues</span>
              <span className="text-xs text-slate-400 mt-0.5">Only trusted & quality turfs</span>
            </div>
          </div>

          {/* Feature 2: Secure Payments */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] shrink-0">
              <Zap className="w-6 h-6 text-[#00df81] fill-[#00df81]" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-extrabold text-sm sm:text-base text-white font-display">Secure Payments</span>
              <span className="text-xs text-slate-400 mt-0.5">100% safe and encrypted</span>
            </div>
          </div>

          {/* Feature 3: Instant Confirmation */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] shrink-0">
              <Users className="w-6 h-6 text-[#00df81]" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-extrabold text-sm sm:text-base text-white font-display">Instant Confirmation</span>
              <span className="text-xs text-slate-400 mt-0.5">Get your match pass instantly</span>
            </div>
          </div>

          {/* Feature 4: No Double Booking */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] shrink-0">
              <Calendar className="w-6 h-6 text-[#00df81]" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-extrabold text-sm sm:text-base text-white font-display">No Double Booking</span>
              <span className="text-xs text-slate-400 mt-0.5">Real-time slot locking system</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. WHY CHOOSE US */}
      {/* ========================================================================= */}
      <section id="why-us" className="w-full bg-slate-100/70 dark:bg-slate-900/40 border-y border-slate-200 dark:border-slate-800/80 py-20 px-4 sm:px-6 lg:px-8 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30 mb-3">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>The EWRONE Standard</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Why Box Cricket Players Choose Us
            </h2>
            <p className="mt-3 text-base text-slate-600 dark:text-slate-400">
              Built specifically for cricket teams who want guaranteed game times, transparent pricing, and tournament-grade pitches.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Zero Double-Booking</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Powered by PostgreSQL EXCLUDE constraints, our backend guarantees that no two teams can ever book the same slot at the same time.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Low Advance Lock Fee</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Don't front the entire turf fee when organizing a match. Lock the court instantly with the owner's advance fee and pay the balance at the venue.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">24/7 Floodlit Arenas</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Every listed venue is verified for high-lumen, flicker-free LED floodlights so your night matches are crystal clear.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Real-Time Sync</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Direct integration with turf owner management consoles ensures available slots on your screen are 100% accurate.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <Trophy className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">AstroTurf & Safety Nets</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Tournament-grade shock-absorbent artificial grass, boundary ropes, and high-tensile cage netting for competitive gameplay.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#00df81]/40 transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Transparent Pricing</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                No hidden convenience charges or surge surcharges. The price you see is the exact price you pay for your cricket game.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. REVIEWS */}
      {/* ========================================================================= */}
      <section id="reviews" className="w-full py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-20">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30 mb-3">
            <Star className="w-3.5 h-3.5 fill-[#00df81] text-[#00df81]" />
            <span>Player Testimonials</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Loved by Over 25,000+ Cricket Teams
          </h2>
          <p className="mt-3 text-base text-slate-600 dark:text-slate-400">
            See what captains, tournament organizers, and weekend warriors say about booking on EWRONE.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Review 1 */}
          <div className="glass-panel p-6 sm:p-7 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between hover:border-[#00df81]/40 transition-all">
            <div>
              <div className="flex items-center gap-1 mb-4 text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-500" />
                ))}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 italic leading-relaxed">
                "EWRONE completely eliminated the chaos of calling 5 different turf owners on Saturday evening. We booked our 8 PM slot in Koramangala in 30 seconds and the advance slot lock gave our team complete peace of mind."
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#00df81]/15 text-[#00df81] font-bold flex items-center justify-center border border-[#00df81]/30">
                RV
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">Rahul Venkatesh</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Captain · Bangalore Strikers</div>
              </div>
            </div>
          </div>

          {/* Review 2 */}
          <div className="glass-panel p-6 sm:p-7 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between hover:border-[#00df81]/40 transition-all">
            <div>
              <div className="flex items-center gap-1 mb-4 text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-500" />
                ))}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 italic leading-relaxed">
                "We organized a 12-team corporate league across 3 pitches. The real-time hold timer and zero double-booking lock meant there were no schedule conflicts. Absolutely game changing experience!"
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#00df81]/15 text-[#00df81] font-bold flex items-center justify-center border border-[#00df81]/30">
                AS
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">Ananya Sharma</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Tech Mahindra Sports Club</div>
              </div>
            </div>
          </div>

          {/* Review 3 */}
          <div className="glass-panel p-6 sm:p-7 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between hover:border-[#00df81]/40 transition-all">
            <div>
              <div className="flex items-center gap-1 mb-4 text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-500" />
                ))}
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 italic leading-relaxed">
                "Paying just the low advance fee to hold the court while our team gathered funds was super convenient. Seamless payment, verified floodlights, and instant WhatsApp confirmation."
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#00df81]/15 text-[#00df81] font-bold flex items-center justify-center border border-[#00df81]/30">
                MZ
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">Mohammed Zeeshan</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Weekend Warriors XI · HSR</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. CALL TO ACTION BANNER */}
      {/* ========================================================================= */}
      <section className="w-full py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="glass-panel rounded-3xl p-8 sm:p-12 relative overflow-hidden border border-[#00df81]/30 text-center flex flex-col items-center shadow-2xl bg-gradient-to-br from-[#00df81]/15 via-white to-[#00df81]/5 dark:from-[#080b0e] dark:via-[#0c1017] dark:to-[#080b0e]">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#00df81]/10 rounded-full blur-3xl pointer-events-none" />
          
          <span className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30 mb-4 shadow-sm">
            Floodlit Matches Active Today
          </span>

          <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight max-w-2xl">
            Ready to Step on the Turf Tonight?
          </h2>

          <p className="mt-4 text-base text-slate-600 dark:text-slate-300 max-w-xl">
            Find an open floodlit cricket box in Bengaluru, lock your slot with flexible advance, and rally your squad.
          </p>

          <Link
            href={exploreTarget}
            className="mt-8 px-8 py-4 rounded-md text-xs font-black tracking-wider uppercase text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center gap-2 shadow-xl shadow-[#00df81]/20 active:scale-95 transform hover:scale-[1.03]"
          >
            <span>EXPLORE AVAILABLE TURFS</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. FOOTER */}
      {/* ========================================================================= */}
      <footer className="w-full bg-slate-100 dark:bg-[#080b0e] border-t border-slate-200 dark:border-slate-800/80 py-12 px-4 sm:px-6 lg:px-8 transition-colors duration-200">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#00df81] to-[#00b4d8] flex items-center justify-center shadow-md shadow-[#00df81]/20">
                <svg className="w-5 h-5 text-slate-950" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="font-black text-base tracking-wider text-slate-900 dark:text-white leading-none">
                  EWRONE
                </span>
                <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase mt-0.5">
                  FIND IT. BOOK IT. PLAY IT.
                </span>
              </div>
            </Link>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">
              Find it. Book it. Play it. India's premier real-time sports venue & box cricket reservation platform with guaranteed zero double-bookings.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-300 uppercase tracking-wider mb-3">Navigation</h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <li><Link href="/" className="hover:text-[#00df81] transition-colors">Home</Link></li>
              <li><Link href="/explore" className="hover:text-[#00df81] transition-colors">Explore Turfs</Link></li>
              <li><a href="/#how-it-works" className="hover:text-[#00df81] transition-colors">How It Works</a></li>
              <li><a href="/#why-us" className="hover:text-[#00df81] transition-colors">Why EWRONE</a></li>
              <li><a href="/#reviews" className="hover:text-[#00df81] transition-colors">Player Reviews</a></li>
            </ul>
          </div>

          {/* Bengaluru Hubs */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-300 uppercase tracking-wider mb-3">Bengaluru Hubs</h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <li><Link href="/explore?city=Koramangala" className="hover:text-[#00df81] transition-colors">Koramangala</Link></li>
              <li><Link href="/explore?city=Indiranagar" className="hover:text-[#00df81] transition-colors">Indiranagar</Link></li>
              <li><Link href="/explore?city=HSR+Layout" className="hover:text-[#00df81] transition-colors">HSR Layout</Link></li>
              <li><Link href="/explore?city=Whitefield" className="hover:text-[#00df81] transition-colors">Whitefield</Link></li>
              <li><Link href="/explore?city=JP+Nagar" className="hover:text-[#00df81] transition-colors">JP Nagar</Link></li>
            </ul>
          </div>

          {/* Legal & Security */}
          <div>
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-300 uppercase tracking-wider mb-3">Security & Trust</h4>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1.5 text-[#00df81] font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>100% ACID Exclusion Locks</span>
              </div>
              <div className="flex items-center gap-1.5 text-[#00df81] font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Low Advance Slot Lock</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">
                Protected by 256-bit SSL encryption & automated Razorpay payment webhooks.
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-10 pt-6 border-t border-slate-200 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div>© 2026 EWRONE Arena Network. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Player Login</Link>
            <span>·</span>
            <a href={(process.env.NEXT_PUBLIC_OWNER_URL || 'http://localhost:3001') + '/login'} className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Turf Owner Portal</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
