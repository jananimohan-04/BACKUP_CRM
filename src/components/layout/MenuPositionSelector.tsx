import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useNavPosition, type NavPosition } from '@/contexts/NavPositionContext';

const OPTIONS: { value: NavPosition; label: string; hint: string }[] = [
  { value: 'left', label: 'Left', hint: 'Sidebar docked to the left edge' },
  { value: 'right', label: 'Right', hint: 'Sidebar docked to the right edge' },
  { value: 'top', label: 'Top', hint: 'Horizontal bar with category menus' },
  { value: 'bottom', label: 'Bottom', hint: 'Compact bar with expandable panel' },
];

/** Mini illustration of the screen with the menu docked on the chosen side. */
function PositionPreview({ position, selected }: { position: NavPosition; selected: boolean }) {
  const bar = selected ? 'bg-navy-950' : 'bg-navy-800';
  const line = selected ? 'bg-brand-500' : 'bg-brand-500/60';
  const content = (
    <>
      <span className="absolute h-1.5 w-8 rounded-full bg-slate-300" />
      <span className="absolute h-1.5 w-12 rounded-full bg-slate-200" />
      <span className="absolute h-1.5 w-6 rounded-full bg-slate-200" />
    </>
  );
  return (
    <div className="relative w-full h-12 rounded-md border border-slate-200 bg-slate-100 overflow-hidden">
      {position === 'left' && (
        <>
          <div className={`absolute inset-y-0 left-0 w-[30%] ${bar}`} />
          <div className={`absolute inset-y-0 left-[30%] w-[3px] ${line}`} />
          <div className="absolute inset-y-0 left-[30%] right-0 flex flex-col justify-center gap-1 pl-2.5">{content}</div>
        </>
      )}
      {position === 'right' && (
        <>
          <div className={`absolute inset-y-0 right-0 w-[30%] ${bar}`} />
          <div className={`absolute inset-y-0 right-[30%] w-[3px] ${line}`} />
          <div className="absolute inset-y-0 left-0 right-[30%] flex flex-col justify-center gap-1 pl-2.5">{content}</div>
        </>
      )}
      {position === 'top' && (
        <>
          <div className={`absolute inset-x-0 top-0 h-[30%] ${bar}`} />
          <div className={`absolute inset-x-0 top-[30%] h-[3px] ${line}`} />
          <div className="absolute inset-x-0 top-[30%] bottom-0 flex flex-col justify-center gap-1 pl-2.5">{content}</div>
        </>
      )}
      {position === 'bottom' && (
        <>
          <div className={`absolute inset-x-0 bottom-0 h-[30%] ${bar}`} />
          <div className={`absolute inset-x-0 bottom-[30%] h-[3px] ${line}`} />
          <div className="absolute inset-x-0 top-0 bottom-[30%] flex flex-col justify-center gap-1 pl-2.5">{content}</div>
        </>
      )}
    </div>
  );
}

/**
 * Compact four-option picker opened from the profile dropdown ("Menu Position").
 * Selecting an option applies it instantly and persists it per user.
 */
export function MenuPositionSelector({ onClose }: { onClose: () => void }) {
  const { position, setPosition } = useNavPosition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu position"
        className="relative w-full max-w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-extrabold text-slate-800">Menu Position</h2>
            <p className="text-xs text-slate-500 mt-0.5">Choose where the main menu appears.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu position selector"
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-3 grid grid-cols-2 gap-2.5">
          {OPTIONS.map((o) => {
            const selected = position === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setPosition(o.value)}
                aria-pressed={selected}
                className={`group relative flex flex-col gap-2 p-2.5 rounded-xl border text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  selected
                    ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/40 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm'
                }`}
              >
                <PositionPreview position={o.value} selected={selected} />
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-xs font-bold ${selected ? 'text-brand-700' : 'text-slate-700'}`}>{o.label}</span>
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                      selected ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300 text-transparent group-hover:border-slate-400'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={11} strokeWidth={3} />
                  </span>
                </div>
                <span className="text-[10px] leading-snug text-slate-400">{o.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 text-[10px] text-slate-400">
          Applies instantly and is saved for your account on this device.
        </div>
      </div>
    </div>,
    document.body,
  );
}
