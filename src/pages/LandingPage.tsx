import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Bell,
  Eye,
  FileText,
  Globe2,
  Layers3,
  LineChart,
  LockKeyhole,
  MessageCircle,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Smartphone,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import SiteFooter from '../components/SiteFooter';

const features = [
  {
    icon: Repeat2,
    title: 'Swap with clarity',
    description: 'Move between supported digital assets through a focused, easy-to-follow exchange experience.',
  },
  {
    icon: TrendingUp,
    title: 'Trade global markets',
    description: 'Access crypto futures and CFDs from one consistent workspace built for fast decisions.',
  },
  {
    icon: Bot,
    title: 'Automate your strategy',
    description: 'Configure the arbitrage robot, allocate funds, and follow activity from a transparent dashboard.',
  },
  {
    icon: Layers3,
    title: 'Put assets to work',
    description: 'Explore staking opportunities and track active positions alongside the rest of your portfolio.',
  },
  {
    icon: Target,
    title: 'Build trading discipline',
    description: 'Take on structured prop-firm challenges with clear targets, limits, and progress tracking.',
  },
  {
    icon: Wallet,
    title: 'See the complete picture',
    description: 'Monitor balances, positions, transactions, and performance without jumping between tools.',
  },
];

const marketGroups = [
  { label: 'Crypto', detail: 'Spot, swaps & futures', icon: CircleDollarSign },
  { label: 'Forex', detail: 'Major & minor pairs', icon: Globe2 },
  { label: 'Indices', detail: 'Global benchmarks', icon: BarChart3 },
  { label: 'Commodities', detail: 'Popular contracts', icon: LineChart },
];

const steps = [
  { number: '01', title: 'Create your account', description: 'Set up your Point2Wealth profile in a few straightforward steps.' },
  { number: '02', title: 'Fund your wallet', description: 'Choose a supported funding method and keep your balances in one place.' },
  { number: '03', title: 'Choose your path', description: 'Trade, swap, stake, automate, or explore challenges from one dashboard.' },
];

const LandingPage: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-[#070b16] text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#070b16]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] w-full max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link to="/" aria-label="Point2Wealth home" className="shrink-0">
            <BrandLogo className="h-11 w-auto max-w-36 sm:h-12 sm:max-w-40" />
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex" aria-label="Main navigation">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#markets" className="transition-colors hover:text-white">Markets</a>
            <a href="#how-it-works" className="transition-colors hover:text-white">How it works</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/auth"
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white sm:px-4"
            >
              Sign in
            </Link>
            <Link
              to="/auth/register"
              className="app-action-primary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold sm:px-5"
            >
              <span className="hidden sm:inline">Create account</span>
              <span className="sm:hidden">Join</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative isolate overflow-hidden px-5 pb-24 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:pt-28">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute left-[-12rem] top-[-10rem] h-[34rem] w-[34rem] rounded-full bg-cyan-500/10 blur-[110px]" />
            <div className="absolute right-[-10rem] top-[-8rem] h-[38rem] w-[38rem] rounded-full bg-violet-600/15 blur-[120px]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-400/25 to-transparent" />
          </div>

          <div className="mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-[1.03fr_0.97fr] lg:gap-16">
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-purple-400/20 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-200">
                <Sparkles size={14} />
                A connected wealth and trading workspace
              </div>

              <h1 className="text-5xl font-bold leading-[1.04] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                One platform.
                <span className="mt-2 block bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                  More ways forward.
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-lg leading-8 text-slate-300 sm:text-xl">
                Bring trading, digital assets, automation, staking, and portfolio oversight together in a single modern experience.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/auth/register"
                  className="app-action-primary inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold"
                >
                  Get started
                  <ArrowRight size={18} />
                </Link>
                <Link
                  to="/auth"
                  className="app-action-soft inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold"
                >
                  Sign in to your account
                </Link>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
                <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-400" /> Account protection tools</span>
                <span className="flex items-center gap-2"><Zap size={16} className="text-cyan-400" /> Live market workspace</span>
                <span className="flex items-center gap-2"><Check size={16} className="text-purple-400" /> One connected portfolio</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-cyan-500/10 to-purple-500/15 blur-3xl" />
              <figure className="relative h-[390px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900 shadow-2xl shadow-black/40 sm:h-[500px] lg:h-[540px]">
                <img
                  src="/images/landing-hero-canary-wharf.jpg"
                  alt="Contemporary financial workspace overlooking Canary Wharf at blue hour"
                  className="h-full w-full object-cover object-center"
                  fetchPriority="high"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#070b16]/35 via-transparent to-white/[0.03]" />
              </figure>
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-slate-800/80 bg-slate-950/30 px-5 py-24 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">The platform</div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Built around the way you manage wealth.</h2>
              <p className="mt-5 text-lg leading-8 text-slate-400">A focused toolkit for exploring markets, acting on opportunities, and understanding your portfolio.</p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, description }) => (
                <article key={title} className="app-surface-muted group rounded-2xl p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/25">
                  <div className="app-icon-tile flex h-11 w-11 items-center justify-center rounded-xl">
                    <Icon size={21} />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
                </article>
              ))}
            </div>

            <div className="mt-20 grid overflow-hidden rounded-[2rem] border border-slate-700/60 bg-slate-950/50 shadow-2xl shadow-black/20 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="relative min-h-[360px] overflow-hidden lg:min-h-[520px]">
                <img
                  src="/images/landing-london-office.jpg"
                  alt="Financial professional reviewing markets from a modern London office"
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070b16]/70 via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-[#090f1d]/70" />
                <div className="absolute bottom-5 left-5 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    Built for focused decisions
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-12">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">Connected by design</div>
                <h3 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Your strategy deserves more than disconnected tools.</h3>
                <p className="mt-5 leading-7 text-slate-400">
                  Point2Wealth brings essential account information and market workflows into one environment, helping you move from insight to action with less friction.
                </p>

                <div className="mt-8 space-y-5">
                  {[
                    { icon: Eye, title: 'One portfolio view', detail: 'See balances, exposure, open positions, and performance in context.' },
                    { icon: SlidersHorizontal, title: 'Controls that stay close', detail: 'Manage trading, staking, and automation without losing your place.' },
                    { icon: FileText, title: 'Records you can revisit', detail: 'Keep transaction history and downloadable statements within reach.' },
                  ].map(({ icon: Icon, title, detail }) => (
                    <div key={title} className="flex gap-4">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/15 bg-cyan-400/10 text-cyan-300">
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-100">{title}</div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="markets" className="px-5 py-24 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-end gap-8 lg:grid-cols-2">
              <div className="max-w-2xl">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-purple-400">Market access</div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Move across markets without losing perspective.</h2>
              </div>
              <p className="max-w-xl text-lg leading-8 text-slate-400 lg:justify-self-end">A unified interface helps you keep context as you explore different instruments and strategies.</p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {marketGroups.map(({ label, detail, icon: Icon }) => (
                <div key={label} className="app-surface-primary rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <Icon size={22} className="text-cyan-300" />
                    <ChevronRight size={18} className="text-slate-600" />
                  </div>
                  <div className="mt-7 text-lg font-semibold">{label}</div>
                  <div className="mt-1 text-sm text-slate-500">{detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-20 grid items-center gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
              <div className="lg:py-8">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-purple-400">Everyday access</div>
                <h3 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Keep your portfolio in reach wherever the day takes you.</h3>
                <p className="mt-5 text-lg leading-8 text-slate-400">
                  The responsive Point2Wealth experience keeps the information that matters clear across desktop and mobile, whether you are checking a position or reviewing recent activity.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  {[
                    { icon: Smartphone, title: 'Responsive workspace', detail: 'A consistent experience across screen sizes.' },
                    { icon: Bell, title: 'Useful account context', detail: 'Statuses and activity stay easy to understand.' },
                    { icon: MessageCircle, title: 'Support close at hand', detail: 'Reach the support area from your profile.' },
                  ].map(({ icon: Icon, title, detail }) => (
                    <div key={title} className="app-surface-muted flex items-start gap-3 rounded-xl p-4">
                      <Icon size={19} className="mt-0.5 shrink-0 text-purple-300" />
                      <div>
                        <div className="text-sm font-semibold text-slate-200">{title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative min-h-[380px] overflow-hidden rounded-[2rem] border border-slate-700/60 shadow-2xl shadow-black/30 sm:min-h-[500px]">
                <img
                  src="/images/landing-mobile-portfolio.jpg"
                  alt="Professional checking a portfolio from London's Canary Wharf district"
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070b16]/75 via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
                  <div className="max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-5 backdrop-blur-md">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Designed around real life</div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">Clear information, practical controls, and a workspace that travels with you.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-slate-800/80 bg-gradient-to-b from-slate-950/20 to-indigo-950/20 px-5 py-24 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="text-center">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">Getting started</div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">From account to action in three steps.</h2>
            </div>

            <div className="relative mt-14 grid gap-5 lg:grid-cols-3">
              <div className="absolute left-[16.66%] right-[16.66%] top-8 hidden h-px bg-gradient-to-r from-cyan-500/30 via-blue-500/40 to-purple-500/30 lg:block" />
              {steps.map((step) => (
                <article key={step.number} className="app-surface-secondary relative rounded-2xl p-7">
                  <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-[#0b1425] text-lg font-bold text-cyan-300">
                    {step.number}
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-3 leading-7 text-slate-400">{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 py-24 sm:px-8">
          <div className="app-surface-raised relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-purple-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
            <LockKeyhole size={28} className="relative mx-auto text-cyan-300" />
            <h2 className="relative mt-5 text-3xl font-bold tracking-tight sm:text-5xl">Your next move starts here.</h2>
            <p className="relative mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-300">Create your account and explore the full Point2Wealth platform from one connected dashboard.</p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/auth/register" className="app-action-primary inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 font-semibold">
                Create your account <ArrowRight size={18} />
              </Link>
              <Link to="/auth" className="rounded-xl border border-slate-600/70 bg-slate-900/60 px-7 py-3.5 font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/70">
                Sign in
              </Link>
            </div>
            <p className="relative mx-auto mt-6 max-w-2xl text-xs leading-5 text-slate-500">
              Trading and investing involve risk. Product availability may vary by account and jurisdiction.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
};

export default LandingPage;
