import { useState, useMemo, useRef, useEffect } from 'react';
import { FormField } from './Modal';

export interface CustomerOption {
  company: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  city?: string;
  gst?: string;
}

export interface CustomerAutocompleteProps {
  label?: string;
  required?: boolean;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelectCustomer?: (customer: CustomerOption) => void;
  companies: CustomerOption[];
  placeholder?: string;
  inputClass?: string;
  hint?: string;
  /** Compact variant: the label sits to the left of the field so it can share a row. */
  inlineLabel?: boolean;
}

export function CustomerAutocomplete({
  label = "Company",
  required = false,
  value,
  disabled = false,
  onChange,
  onSelectCustomer,
  companies = [],
  placeholder = "Type or select company...",
  inputClass = "w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500 bg-white",
  hint,
  inlineLabel = false,
}: CustomerAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = (value || '').toLowerCase().trim();
    if (!q) return companies.slice(0, 50);
    return companies
      .filter(c => c.company.toLowerCase().includes(q))
      .slice(0, 50);
  }, [value, companies]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <FormField label={label} required={required} hint={hint} inline={inlineLabel}>
      <div className="relative" ref={containerRef}>
        <input
          className={inputClass}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            if (!disabled) setIsOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {!disabled && isOpen && companies.length > 0 && (
          <div className="absolute z-50 left-0 min-w-full w-max max-w-[20rem] top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map((c, i) => (
                <div
                  key={`${c.company}-${i}`}
                  className="px-3.5 py-2.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-800 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(c.company);
                    if (onSelectCustomer) onSelectCustomer(c);
                    setIsOpen(false);
                  }}
                >
                  <div className="truncate">
                    <span className="font-semibold text-slate-800">{c.company}</span>
                    {c.city && <span className="text-xs text-slate-400 ml-1.5">• {c.city}</span>}
                  </div>
                  {c.contact_person && (
                    <span className="text-xs text-slate-500 ml-2 shrink-0 truncate max-w-[96px]">
                      {c.contact_person}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-3.5 py-2.5 text-xs text-slate-500 italic">
                No matching company found (continue typing custom name)
              </div>
            )}
          </div>
        )}
      </div>
    </FormField>
  );
}
