"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface DatePickerDropdownProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

export function DatePickerDropdown({ value, onChange }: DatePickerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current selected date
  const [currentDate, setCurrentDate] = useState(new Date(value));
  const [viewDate, setViewDate] = useState(new Date(value));

  // Sync state if value prop changes externally
  useEffect(() => {
    const newDate = new Date(value);
    if (!isNaN(newDate.getTime())) {
      setCurrentDate(newDate);
      setViewDate(newDate);
    }
  }, [value]);

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleSelectDate = (day: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const isoString = newDate.toLocaleDateString('en-CA'); // Gets YYYY-MM-DD local
    // Fallback if toLocaleDateString en-CA isn't perfectly YYYY-MM-DD in some environments:
    const year = newDate.getFullYear();
    const month = String(newDate.getMonth() + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${year}-${month}-${d}`);
    setIsOpen(false);
  };

  const formatDisplayDate = (d: Date) => {
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-neutral-200/50 dark:bg-neutral-900/80 border border-neutral-300 dark:border-neutral-800 hover:border-[#1DB954] dark:hover:border-[#1DB954] rounded-xl cursor-pointer transition-all duration-300 group"
      >
        <span className="text-sm text-neutral-800 dark:text-neutral-200 font-medium whitespace-nowrap group-hover:text-[#1DB954] dark:group-hover:text-[#1DB954] transition-colors">
          {formatDisplayDate(currentDate)}
        </span>
        <CalendarIcon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 group-hover:text-[#1DB954] dark:group-hover:text-[#1DB954] transition-colors" />
      </div>

      {/* Calendar Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 p-4 w-72 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={handlePrevMonth} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-500 dark:text-neutral-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button onClick={handleNextMonth} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-500 dark:text-neutral-400">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} className="text-center text-xs font-semibold text-neutral-400 dark:text-neutral-500">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} className="p-2" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isSelected = day === currentDate.getDate() && viewDate.getMonth() === currentDate.getMonth() && viewDate.getFullYear() === currentDate.getFullYear();
              const isToday = day === new Date().getDate() && viewDate.getMonth() === new Date().getMonth() && viewDate.getFullYear() === new Date().getFullYear();

              return (
                <button
                  key={day}
                  onClick={() => handleSelectDate(day)}
                  className={`
                    p-1.5 text-sm rounded-lg flex items-center justify-center transition-colors
                    ${isSelected
                      ? 'bg-[#1DB954] text-white font-bold'
                      : isToday
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-[#1DB954] font-bold'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
