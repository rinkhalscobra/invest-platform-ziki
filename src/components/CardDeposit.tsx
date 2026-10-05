import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface CardDepositProps {
  amount: string;
  currency: 'USDT' | 'BTC';
  onPending: (result: { reference: string; amount: number; lastFour: string }) => void;
}

interface CardFormState {
  cardholderName: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
}

type FieldErrors = Partial<Record<keyof CardFormState | 'amount', string>>;

const initialForm: CardFormState = {
  cardholderName: '',
  cardNumber: '',
  expiryMonth: '',
  expiryYear: '',
  cvv: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  region: '',
  postcode: '',
  country: '',
};

const inputClass = 'w-full app-input rounded-xl px-4 py-3 text-white transition-all placeholder:text-slate-600';
const cardDigits = (value: string) => value.replace(/\D/g, '').slice(0, 19);
const formatCardNumber = (value: string) => cardDigits(value).replace(/(.{4})/g, '$1 ').trim();

const passesLuhnCheck = (number: string) => {
  let sum = 0;
  let shouldDouble = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return number.length >= 12 && sum % 10 === 0;
};

const getCardBrand = (number: string) => {
  if (/^4/.test(number)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(number)) return 'Mastercard';
  if (/^3[47]/.test(number)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(number)) return 'Discover';
  return 'Card';
};

const CardDeposit: React.FC<CardDepositProps> = ({ amount, currency, onPending }) => {
  const [form, setForm] = useState<CardFormState>(initialForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingReference, setPendingReference] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const expiryYears = useMemo(
    () => Array.from({ length: 12 }, (_, index) => String(currentYear + index)),
    [currentYear],
  );

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user?.email) {
        setForm(current => current.email ? current : { ...current, email: data.user?.email || '' });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const updateField = (field: keyof CardFormState, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
    setSubmitError(null);
  };

  const validate = () => {
    const nextErrors: FieldErrors = {};
    const numericAmount = Number(amount);
    const number = cardDigits(form.cardNumber);
    const now = new Date();
    const expiryMonth = Number(form.expiryMonth);
    const expiryYear = Number(form.expiryYear);

    if (!Number.isFinite(numericAmount) || numericAmount < 10) nextErrors.amount = 'Enter an amount of at least 10 USDT above.';
    if (currency !== 'USDT') nextErrors.amount = 'Card deposits are currently available in USDT only.';
    if (form.cardholderName.trim().length < 3) nextErrors.cardholderName = 'Enter the name shown on the card.';
    if (!passesLuhnCheck(number)) nextErrors.cardNumber = 'Enter a valid card number.';
    if (!expiryMonth || !expiryYear) {
      nextErrors.expiryMonth = 'Select the card expiry date.';
    } else if (expiryYear < now.getFullYear() || (expiryYear === now.getFullYear() && expiryMonth < now.getMonth() + 1)) {
      nextErrors.expiryMonth = 'This card has expired.';
    }
    const expectedCvvLength = /^3[47]/.test(number) ? 4 : 3;
    if (form.cvv.length !== expectedCvvLength) nextErrors.cvv = `Enter the ${expectedCvvLength}-digit security code.`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (form.phone.replace(/\D/g, '').length < 7) nextErrors.phone = 'Enter a valid phone number.';
    if (form.address.trim().length < 4) nextErrors.address = 'Enter the billing street address.';
    if (form.city.trim().length < 2) nextErrors.city = 'Enter the billing city.';
    if (!form.region.trim()) nextErrors.region = 'Enter the state, province, or region.';
    if (form.postcode.trim().length < 3) nextErrors.postcode = 'Enter the billing postal code.';
    if (form.country.trim().length < 2) nextErrors.country = 'Enter the billing country.';

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);
    const number = cardDigits(form.cardNumber);
    const lastFour = number.slice(-4);

    try {
      // PAN, expiry and CVV intentionally stay in browser memory. The server receives
      // only the masked card identity needed for an admin-reviewed pending request.
      const { data, error } = await supabase.rpc('create_pending_card_deposit', {
        p_amount: Number(amount),
        p_card_last_four: lastFour,
        p_card_brand: getCardBrand(number),
        p_cardholder_name: form.cardholderName.trim(),
        p_email: form.email.trim(),
        p_phone: form.phone.trim(),
        p_billing_address: form.address.trim(),
        p_billing_city: form.city.trim(),
        p_billing_region: form.region.trim(),
        p_billing_postcode: form.postcode.trim(),
        p_billing_country: form.country.trim(),
      });
      if (error) throw new Error(error.message || 'Unable to submit the card deposit.');
      const result = data as { success?: boolean; reference?: string; error?: string } | null;
      if (!result?.success || !result.reference) throw new Error(result?.error || 'The deposit request was not created.');

      setPendingReference(result.reference);
      setForm(current => ({ ...current, cardNumber: '', expiryMonth: '', expiryYear: '', cvv: '' }));
      onPending({ reference: result.reference, amount: Number(amount), lastFour });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit the card deposit.');
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingReference) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-6" role="status" aria-live="polite">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-400/15 p-3">
            <Clock size={24} className="text-amber-300" />
          </div>
          <div>
            <h4 className="text-lg font-semibold text-white">Card deposit pending</h4>
            <p className="mt-1 text-sm text-slate-300">Your request has been submitted for review. Your balance will update after the deposit is approved.</p>
            <p className="mt-3 text-xs text-amber-200">Reference: {pendingReference}</p>
            <button type="button" onClick={() => setPendingReference(null)} className="mt-5 rounded-xl border border-amber-300/30 px-4 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-400/10">
              Make another deposit
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fieldError = (field: keyof FieldErrors) => errors[field] ? <p className="mt-1.5 text-xs text-red-400">{errors[field]}</p> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="app-surface-muted rounded-2xl p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h4 className="flex items-center gap-2 text-lg font-semibold text-white"><CreditCard size={20} className="text-blue-400" />Card details</h4>
            <p className="mt-1 text-xs text-slate-400">Visa, Mastercard, American Express and Discover</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300"><Lock size={13} /> Secure</div>
        </div>

        {errors.amount && <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertTriangle size={18} className="shrink-0" /> {errors.amount}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm text-slate-300">
            Name on card
            <input value={form.cardholderName} onChange={event => updateField('cardholderName', event.target.value)} className={`${inputClass} mt-2`} placeholder="Full name" autoComplete="cc-name" />
            {fieldError('cardholderName')}
          </label>
          <label className="sm:col-span-2 text-sm text-slate-300">
            Card number
            <div className="relative mt-2">
              <input value={form.cardNumber} onChange={event => updateField('cardNumber', formatCardNumber(event.target.value))} className={`${inputClass} pr-20 font-mono tracking-wide`} placeholder="1234 5678 9012 3456" inputMode="numeric" autoComplete="cc-number" maxLength={23} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">{getCardBrand(cardDigits(form.cardNumber))}</span>
            </div>
            {fieldError('cardNumber')}
          </label>
          <div>
            <span className="text-sm text-slate-300">Expiry date</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select value={form.expiryMonth} onChange={event => updateField('expiryMonth', event.target.value)} className={`${inputClass} custom-select`} aria-label="Expiry month" autoComplete="cc-exp-month">
                <option value="">MM</option>
                {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(month => <option key={month} value={month}>{month}</option>)}
              </select>
              <select value={form.expiryYear} onChange={event => updateField('expiryYear', event.target.value)} className={`${inputClass} custom-select`} aria-label="Expiry year" autoComplete="cc-exp-year">
                <option value="">YYYY</option>
                {expiryYears.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            {fieldError('expiryMonth')}
          </div>
          <label className="text-sm text-slate-300">
            Security code
            <input type="password" value={form.cvv} onChange={event => updateField('cvv', event.target.value.replace(/\D/g, '').slice(0, 4))} className={`${inputClass} mt-2 font-mono`} placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" maxLength={4} />
            {fieldError('cvv')}
          </label>
        </div>
      </div>

      <div className="app-surface-muted rounded-2xl p-5 sm:p-6">
        <h4 className="mb-5 text-lg font-semibold text-white">Billing information</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Email address<input type="email" value={form.email} onChange={event => updateField('email', event.target.value)} className={`${inputClass} mt-2`} placeholder="you@example.com" autoComplete="email" />{fieldError('email')}</label>
          <label className="text-sm text-slate-300">Phone number<input type="tel" value={form.phone} onChange={event => updateField('phone', event.target.value)} className={`${inputClass} mt-2`} placeholder="+1 555 123 4567" autoComplete="tel" />{fieldError('phone')}</label>
          <label className="sm:col-span-2 text-sm text-slate-300">Billing address<input value={form.address} onChange={event => updateField('address', event.target.value)} className={`${inputClass} mt-2`} placeholder="Street and house number" autoComplete="street-address" />{fieldError('address')}</label>
          <label className="text-sm text-slate-300">City<input value={form.city} onChange={event => updateField('city', event.target.value)} className={`${inputClass} mt-2`} placeholder="City" autoComplete="address-level2" />{fieldError('city')}</label>
          <label className="text-sm text-slate-300">State / region<input value={form.region} onChange={event => updateField('region', event.target.value)} className={`${inputClass} mt-2`} placeholder="State or region" autoComplete="address-level1" />{fieldError('region')}</label>
          <label className="text-sm text-slate-300">Postal code<input value={form.postcode} onChange={event => updateField('postcode', event.target.value)} className={`${inputClass} mt-2`} placeholder="Postal code" autoComplete="postal-code" />{fieldError('postcode')}</label>
          <label className="text-sm text-slate-300">Country<input value={form.country} onChange={event => updateField('country', event.target.value)} className={`${inputClass} mt-2`} placeholder="Country" autoComplete="country-name" />{fieldError('country')}</label>
        </div>
      </div>

      {submitError && <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert"><AlertTriangle size={19} className="mt-0.5 shrink-0" /><span>{submitError}</span></div>}

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-slate-400">
        <div className="flex gap-3"><ShieldCheck size={18} className="shrink-0 text-blue-400" /><p>Your full card number and security code are never saved or sent with this pending request. Only the card brand and last four digits are retained for identification.</p></div>
      </div>

      <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 py-3.5 font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:from-blue-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? <><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Submitting securely...</> : <><CheckCircle size={19} /> Submit card deposit</>}
      </button>
    </form>
  );
};

export default CardDeposit;
