import React from 'react';

interface MediPalMascotProps {
  mood?: 'happy' | 'cheering' | 'supportive' | 'calm' | 'celebrate' | 'pulse';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const MediPalMascot: React.FC<MediPalMascotProps> = ({
  mood = 'happy',
  size = 'md',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'w-10 h-10 text-xs',
    md: 'w-16 h-16 text-sm',
    lg: 'w-24 h-24 text-base',
  };

  const getEyeExpression = () => {
    switch (mood) {
      case 'cheering':
      case 'celebrate':
        return { left: '^', right: '^', mouth: '▽' };
      case 'supportive':
        return { left: 'u', right: 'u', mouth: '◡' };
      case 'calm':
        return { left: '•', right: '•', mouth: '‿' };
      case 'pulse':
        return { left: '★', right: '★', mouth: 'o' };
      case 'happy':
      default:
        return { left: '•', right: '•', mouth: '◡' };
    }
  };

  const expr = getEyeExpression();

  return (
    <div className={`relative inline-flex items-center justify-center flex-shrink-0 animate-float ${sizeClasses[size]} ${className}`}>
      {/* Outer ambient glow */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500 via-sky-400 to-indigo-500 blur-md opacity-70 animate-pulse-glow" />

      {/* Mascot pill-robot body */}
      <div className="relative w-full h-full rounded-3xl bg-gradient-to-b from-cyan-400 via-sky-500 to-indigo-600 p-[2px] shadow-lg border border-cyan-200/40 flex flex-col items-center justify-center overflow-hidden">
        {/* Shiny capsule top highlight */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/20 rounded-t-3xl backdrop-blur-[1px]" />
        
        {/* Face screen */}
        <div className="relative z-10 w-4/5 h-3/5 rounded-xl bg-slate-950/90 border border-cyan-400/50 flex flex-col items-center justify-center shadow-inner text-cyan-300 font-mono select-none">
          {/* Eyes */}
          <div className="flex items-center justify-center gap-1.5 font-bold tracking-widest text-cyan-300">
            <span className="inline-block transform transition-transform duration-300">{expr.left}</span>
            <span className="inline-block transform transition-transform duration-300">{expr.right}</span>
          </div>
          {/* Mouth */}
          <div className="text-[10px] leading-none text-sky-400 mt-[1px]">
            {expr.mouth}
          </div>
        </div>

        {/* Floating sparkles for cheering */}
        {(mood === 'cheering' || mood === 'celebrate') && (
          <>
            <span className="absolute -top-1 -right-1 text-amber-300 text-xs animate-bounce">✨</span>
            <span className="absolute -bottom-1 -left-1 text-cyan-300 text-xs animate-pulse">🌟</span>
          </>
        )}
      </div>
    </div>
  );
};
