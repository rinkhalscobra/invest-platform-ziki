import React from 'react';
import { MapPin } from 'lucide-react';
import BrandLogo from './BrandLogo';

const SiteFooter: React.FC = () => (
  <footer className="mt-auto border-t border-slate-700/50 bg-slate-950/30">
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-3 px-4 py-4 text-center md:flex-row md:gap-4 md:py-3">
      <BrandLogo className="h-10 w-auto max-w-32" />

      <span className="hidden h-6 w-px bg-slate-700/80 md:block" aria-hidden="true" />

      <p className="whitespace-nowrap text-xs text-slate-500">
        &copy; {new Date().getFullYear()} Point2Wealth
      </p>

      <span className="hidden h-6 w-px bg-slate-700/80 md:block" aria-hidden="true" />

      <address className="flex items-center justify-center gap-2 not-italic text-sm text-slate-400">
        <MapPin size={16} className="shrink-0 text-purple-400" aria-hidden="true" />
        <span>
          <span className="font-medium text-slate-300">Office:</span>{' '}
          Canary Wharf Estate, London, UK <span className="text-slate-600">&middot;</span> E14 5AB
        </span>
      </address>
    </div>
  </footer>
);

export default SiteFooter;
