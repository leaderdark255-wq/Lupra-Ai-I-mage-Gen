import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ children, content, position = 'top' }) => {
  const [isVisible, setIsVisible] = useState(false);

  const getPositionClasses = () => {
    switch (position) {
      case 'bottom': return 'top-full left-1/2 -translate-x-1/2 mt-2';
      case 'left': return 'right-full top-1/2 -translate-y-1/2 mr-2';
      case 'right': return 'left-full top-1/2 -translate-y-1/2 ml-2';
      default: return 'bottom-full left-1/2 -translate-x-1/2 mb-2';
    }
  };

  return (
    <div 
      className="relative flex items-center justify-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: position === 'top' ? 10 : -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: position === 'top' ? 10 : -10 }}
            className={`absolute z-[200] px-3 py-1.5 bg-black/90 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl pointer-events-none whitespace-nowrap ${getPositionClasses()}`}
          >
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">{content}</span>
            <div className={`absolute w-2 h-2 bg-black/90 border-t border-l border-white/10 rotate-45 ${
              position === 'bottom' ? '-top-1 left-1/2 -translate-x-1/2' :
              position === 'left' ? '-right-1 top-1/2 -translate-y-1/2 border-t-0 border-l-0 border-b border-r' :
              position === 'right' ? '-left-1 top-1/2 -translate-y-1/2 border-t-0 border-l-0 border-b border-r' :
              '-bottom-1 left-1/2 -translate-x-1/2 border-t-0 border-l-0 border-b border-r'
            }`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
