"use client";

// #1062 (UX12): ícone animado de "templates" (file-type-2 do lucide) pra a toolbar
// do compose ficar na mesma família animada do registry. Modelado no `bold.tsx`:
// engrossa o traço (strokeWidth 2→3.5) no hover/foco.
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface FileType2IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface FileType2IconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PATH_VARIANTS: Variants = {
  normal: { strokeWidth: 2 },
  animate: { strokeWidth: 3.5 },
};

const FileType2Icon = forwardRef<FileType2IconHandle, FileType2IconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
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
            d="M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6"
            transition={{ duration: 0.6 }}
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="M14 2v5a1 1 0 0 0 1 1h5"
            transition={{ duration: 0.6 }}
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16"
            transition={{ duration: 0.6 }}
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="M6 22h2"
            transition={{ duration: 0.6 }}
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="M7 14v8"
            transition={{ duration: 0.6 }}
            variants={PATH_VARIANTS}
          />
        </svg>
      </div>
    );
  }
);

FileType2Icon.displayName = "FileType2Icon";

export { FileType2Icon };
