import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

import { defaultTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, children, onClose }: ModalProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : defaultTransition}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, y: 28 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 28 }}
            transition={reduceMotion ? undefined : defaultTransition}
            className={cn("surface w-full max-w-lg rounded-xl p-6")}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-headline text-2xl">{title}</h3>
              <button className="text-sm text-muted-foreground" onClick={onClose}>
                Close
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
