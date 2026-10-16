import React from 'react';

interface FreshwayLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  customLogoUrl?: string;
}

export const FreshwayLogo: React.FC<FreshwayLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  customLogoUrl,
}) => {
  if (customLogoUrl) {
    const sizeMap = {
      sm: 'h-8 w-auto',
      md: 'h-11 w-auto',
      lg: 'h-16 w-auto',
      xl: 'h-24 w-auto',
    };
    return (
      <img
        src={customLogoUrl}
        alt="Business Logo"
        className={`object-contain ${sizeMap[size]} ${className}`}
      />
    );
  }

  const dimensions = {
    sm: { w: 32, h: 32, textClass: 'text-base font-bold' },
    md: { w: 42, h: 42, textClass: 'text-xl font-extrabold' },
    lg: { w: 60, h: 60, textClass: 'text-2xl font-black' },
    xl: { w: 90, h: 90, textClass: 'text-4xl font-black' },
  }[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Precision Vector recreation of Freshway Water brand logo */}
      <div className="relative flex-shrink-0" style={{ width: dimensions.w, height: dimensions.h }}>
        <svg
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-sm transition-transform duration-300 hover:scale-105"
        >
          <defs>
            <linearGradient id="freshwayDrop" x1="40" y1="10" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop stopColor="#0284C7" />
              <stop offset="0.6" stopColor="#0EA5E9" />
              <stop offset="1" stopColor="#38BDF8" />
            </linearGradient>
            <linearGradient id="freshwayWave1" x1="10" y1="80" x2="110" y2="110" gradientUnits="userSpaceOnUse">
              <stop stopColor="#0284C7" />
              <stop offset="1" stopColor="#38BDF8" />
            </linearGradient>
            <linearGradient id="freshwayWave2" x1="45" y1="90" x2="115" y2="98" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E3A8A" />
              <stop offset="1" stopColor="#1D4ED8" />
            </linearGradient>
          </defs>

          {/* Water Drop with stylized human/partnership silhouette */}
          <path
            d="M80 18 C78 22, 66 42, 66 58 C66 74, 78 86, 94 86 C106 86, 114 76, 114 62 C114 42, 85 22, 80 18 Z"
            fill="url(#freshwayDrop)"
          />
          {/* Inner cutout shapes mimicking pure water droplet humans */}
          <circle cx="83" cy="53" r="5" fill="#FFFFFF" opacity="0.95" />
          <circle cx="95" cy="58" r="4.5" fill="#FFFFFF" opacity="0.95" />
          <path
            d="M74 72 C77 64, 88 64, 91 72 C85 76, 78 76, 74 72 Z"
            fill="#FFFFFF"
            opacity="0.9"
          />
          <path
            d="M86 76 C89 69, 100 69, 103 76 C97 80, 91 80, 86 76 Z"
            fill="#FFFFFF"
            opacity="0.9"
          />

          {/* Bottom Swooshing Waves */}
          <path
            d="M12 92 C25 80, 48 84, 68 94 C85 102, 102 103, 116 95 C102 108, 78 111, 56 102 C38 95, 22 93, 12 92 Z"
            fill="url(#freshwayWave1)"
          />
          <path
            d="M52 92 C68 97, 88 97, 108 89 C96 99, 78 101, 52 92 Z"
            fill="url(#freshwayWave2)"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-1.5">
            <span
              className={`tracking-tight font-extrabold text-blue-900 dark:text-blue-100 ${dimensions.textClass}`}
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              FRESHWAY
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold tracking-[0.25em] text-cyan-600 dark:text-cyan-400 uppercase">
              WATER POS
            </span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold ml-1">
              PRO
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
