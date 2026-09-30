export default function Loading() {
  return (
    <div className="w-full min-h-[70vh] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
      {/* Top Banner Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="h-6 w-36 bg-slate-200 dark:bg-slate-800 rounded-full mb-3" />
          <div className="h-9 w-64 sm:w-80 bg-slate-200 dark:bg-slate-800 rounded-xl mb-2" />
          <div className="h-4 w-72 sm:w-96 bg-slate-200 dark:bg-slate-800/60 rounded-md" />
        </div>
        <div className="h-10 w-32 bg-slate-200 dark:bg-slate-800/80 rounded-xl hidden sm:block" />
      </div>

      {/* Grid Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0c1017] overflow-hidden flex flex-col justify-between"
          >
            {/* Card Image Shimmer */}
            <div className="w-full h-48 bg-slate-200 dark:bg-slate-800/70 relative">
              <div className="absolute top-3 left-3 h-5 w-24 rounded-full bg-slate-300 dark:bg-slate-700/80" />
            </div>

            {/* Card Body Shimmer */}
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded-md" />
                <div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="h-6 w-44 bg-slate-200 dark:bg-slate-800 rounded-lg" />
              <div className="h-4 w-full bg-slate-200 dark:bg-slate-800/60 rounded-md" />
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex justify-between items-center">
                <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded-md" />
                <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
