import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import {
  Menu,
  Moon,
  Sun,
  PlusCircle,
  FlaskConical,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import type { ActiveTab } from './Sidebar';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onOpenSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenSidebar,
}) => {
  const { isDisconnected, connectionError, isTestMode, toggleTestMode, checkAuthStatus } = useAuth();
  const { theme, toggleTheme } = useSettings();
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('en-PK', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const tabTitles: Record<ActiveTab, { title: string; subtitle: string }> = {
    dashboard: { title: 'Business Overview', subtitle: 'Live real-time operational statistics' },
    pos: { title: 'POS Billing & Sales', subtitle: 'Quick sale checkout & invoice creation' },
    ledger: { title: 'Customer Ledger & Monthly Billing', subtitle: 'Monthly customer statements & running balances' },
    customers: { title: 'Customer Directory', subtitle: 'Registered accounts, contact info & balances' },
    payments: { title: 'Payment Collection & Udhaar', subtitle: 'Collect customer dues & generate vouchers' },
    invoices: { title: 'Sales Invoices', subtitle: 'Full invoice history, reprints & audit voiding' },
    inventory: { title: 'Products & Inventory', subtitle: 'Stock control, prices, units & adjustments' },
    suppliers: { title: 'Suppliers & Purchases', subtitle: 'Vendor records & inventory stock intake' },
    expenses: { title: 'Operating Expenses', subtitle: 'Utilities, fuel, maintenance & expense tracking' },
    reports: { title: 'Reports & Analytics', subtitle: 'Financial statements, P&L & CSV exports' },
    settings: { title: 'System & Brand Settings', subtitle: 'Business profile, backup/restore & user roles' },
  };

  const currentTabInfo = tabTitles[activeTab] || { title: 'POS System', subtitle: '' };

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
      {/* Offline Alert Bar if Disconnected */}
      {isDisconnected && (
        <div className="mb-2 p-2.5 rounded-xl bg-rose-500 text-white text-xs font-semibold flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 animate-bounce" />
            <span>{connectionError || 'Database connection lost. Operating in protected offline error mode.'}</span>
          </div>
          <button
            onClick={() => checkAuthStatus()}
            className="px-2.5 py-1 bg-white text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-50 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        {/* Left: Mobile hamburger & breadcrumbs */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSidebar}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden cursor-pointer"
            aria-label="Toggle Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-800 dark:text-white leading-tight">
              {currentTabInfo.title}
            </h1>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 hidden sm:block">
              {currentTabInfo.subtitle}
            </p>
          </div>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Date Time Display */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 font-medium">
            <Clock className="w-3.5 h-3.5 text-blue-500" />
            <span>{currentTime}</span>
          </div>

          {/* Test Sandbox Mode Toggle */}
          <button
            onClick={toggleTestMode}
            title={isTestMode ? 'Test Mode Active' : 'Toggle Test Sandbox Mode'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              isTestMode
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-950/40 hover:text-amber-700'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isTestMode ? 'Test Sandbox Active' : 'Test Mode'}</span>
          </button>

          {/* New Sale Button */}
          {activeTab !== 'pos' && (
            <button
              onClick={() => setActiveTab('pos')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer transform active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>New Sale</span>
            </button>
          )}

          {/* Dark / Light Toggle */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </div>
    </header>
  );
};
