import React from 'react';
import { WatchShape } from '../types';
import { Wifi, BatteryMedium } from 'lucide-react';

interface SmartwatchFrameProps {
  children: React.ReactNode;
  shape: WatchShape;
  setShape: (shape: WatchShape) => void;
  wearableSerial: string;
  synced: boolean;
  battery: number | null;
}

export const SmartwatchFrame: React.FC<SmartwatchFrameProps> = ({
  children,
  shape,
  setShape,
  wearableSerial,
  synced,
  battery,
}) => {
  return (
    <div className="flex flex-col items-center justify-center select-none py-2">
      
      {/* Watch Shape Selector Bar */}
      <div className="flex flex-wrap justify-center items-center gap-2 mb-4 bg-slate-900/90 border border-slate-800 p-1.5 rounded-full text-xs shadow-lg">
        <span className="text-slate-400 font-medium px-2 text-[11px]">Watch Style:</span>
        <button
          onClick={() => setShape('round')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            shape === 'round' 
              ? 'bg-cyan-500 text-white font-semibold shadow-md shadow-cyan-500/30' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ⭕ Round
        </button>
        <button
          onClick={() => setShape('square')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            shape === 'square' 
              ? 'bg-cyan-500 text-white font-semibold shadow-md shadow-cyan-500/30' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          📱 Square
        </button>
      </div>

      {/* Smartwatch Container with Watch Straps */}
      <div className="relative flex flex-col items-center group origin-top scale-[0.82] -mb-20 sm:scale-100 sm:mb-0">
        
        {/* Top Strap */}
        <div className="w-36 h-16 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 rounded-t-2xl border-t border-x border-slate-700/60 shadow-md relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:8px_8px] opacity-40" />
        </div>

        {/* Watch Outer Case & Bezel */}
        <div className={`relative bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 p-4 watch-bezel-shadow border border-slate-700/80 transition-all duration-500 ${
          shape === 'round' 
            ? 'w-[360px] h-[360px] rounded-full' 
            : 'w-[340px] h-[410px] rounded-[44px]'
        }`}>
          
          {/* Side Crown / Button Mockup */}
          <div className={`absolute bg-gradient-to-r from-slate-600 to-slate-800 border border-slate-500 shadow-lg rounded-r-md ${
            shape === 'round'
              ? 'right-[-12px] top-[40%] w-3 h-12 rounded-r-lg'
              : 'right-[-12px] top-[30%] w-3 h-14 rounded-r-lg'
          }`} />

          {/* Inner Screen Display Frame */}
          <div className={`relative w-full h-full bg-slate-950 overflow-hidden text-slate-100 flex flex-col border border-slate-800/80 shadow-inner ${
            shape === 'round' ? 'rounded-full' : 'rounded-[36px]'
          }`}>
            
            {/* Top Status Bar on Watch Screen */}
            <div className={`pt-3 px-6 flex items-center justify-between text-[10px] font-mono text-slate-400 z-30 ${
              shape === 'round' ? 'pt-6 px-10' : 'pt-3 px-6'
            }`}>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${synced ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span>{synced ? 'Synced' : 'Offline'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Wifi className="w-3 h-3 text-cyan-400" />
                <BatteryMedium className="w-3.5 h-3.5 text-slate-300" />
                {battery !== null && <span>{battery}%</span>}
              </div>
            </div>

            {/* Watch Screen Core Content */}
            <div className={`relative flex-1 flex flex-col justify-between z-20 overflow-y-auto custom-scrollbar ${
              shape === 'round' ? 'px-10 pt-1 pb-9' : 'px-4 py-2'
            }`}>
              {children}
            </div>

            {/* Glass Glare Overlay */}
            <div className="absolute inset-0 smartwatch-glare pointer-events-none z-30" />
          </div>

        </div>

        {/* Bottom Strap */}
        <div className="w-36 h-16 bg-gradient-to-t from-slate-800 via-slate-900 to-slate-950 rounded-b-2xl border-b border-x border-slate-700/60 shadow-md relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:8px_8px] opacity-40" />
        </div>

      </div>

      <p className="mt-3 text-[11px] font-mono text-slate-400">
        Linked Hardware ID: <span className="text-cyan-400 font-semibold">{wearableSerial}</span>
      </p>

    </div>
  );
};
