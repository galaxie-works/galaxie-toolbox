"use client";

// #1062 (UX12): ícone animado de Tachado pra família da toolbar do compose ficar
// consistente com Bold/Italic/Underline (registry animado), em vez do lucide cru.
// Modelado no `bold.tsx`: engrossa o traço (strokeWidth 2→3.5) no hover/foco.
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface StrikethroughIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface StrikethroughIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PATH_VARIANTS: Variants = {
  normal: { strokeWidth: 2 },
  animate: { strokeWidth: 3.5 },
};

const StrikethroughIcon = forwardRef<
  StrikethroughIconHandle,
  StrikethroughIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;

    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        controls.start("animate");
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("normal");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <div
      className={cn(className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.path
          animate={controls}
          d="M16 4H9a3 3 0 0 0-2.83 4"
          transition={{ duration: 0.6 }}
          variants={PATH_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M14 12a4 4 0 0 1 0 8H6"
          transition={{ duration: 0.6 }}
          variants={PATH_VARIANTS}
        />
        <motion.line
          animate={controls}
          x1="4"
          x2="20"
          y1="12"
          y2="12"
          transition={{ duration: 0.6 }}
          variants={PATH_VARIANTS}
        />
      </svg>
    </div>
  );
});

StrikethroughIcon.displayName = "StrikethroughIcon";

export { StrikethroughIcon };
