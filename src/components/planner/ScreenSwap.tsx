"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export type SwapDirection = "forward" | "back" | "fade";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const DURATION = 0.4;
const OFFSET = 16;

function xFor(direction: SwapDirection, phase: "enter" | "exit") {
  if (direction === "fade") return 0;
  if (direction === "forward") return phase === "enter" ? OFFSET : -OFFSET;
  return phase === "enter" ? -OFFSET : OFFSET;
}

export function ScreenSwap({
  id,
  direction,
  children,
}: {
  id: string;
  direction: SwapDirection;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <AnimatePresence mode="sync" initial={false} custom={direction}>
        <motion.div
          key={id}
          custom={direction}
          className="flex h-full min-h-0 w-full flex-1 flex-col"
          variants={{
            enter: (dir: SwapDirection) =>
              reduce
                ? { opacity: 0 }
                : { opacity: 0, x: xFor(dir, "enter") },
            center: { opacity: 1, x: 0 },
            exit: (dir: SwapDirection) =>
              reduce
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    x: xFor(dir, "exit"),
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                  },
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reduce ? 0 : DURATION, ease: EASE }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
