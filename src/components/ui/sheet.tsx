import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  children,
  title,
  side = "right",
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
  side?: "right" | "left" | "bottom";
}) {
  const pos =
    side === "bottom"
      ? "inset-x-0 bottom-0 rounded-t-[var(--radius-xl)] max-h-[78vh]"
      : side === "left"
        ? "inset-y-0 left-0 h-full w-[min(92vw,360px)]"
        : "inset-y-0 right-0 h-full w-[min(92vw,380px)]";
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
      <Dialog.Content
        className={cn(
          "fixed z-50 overflow-y-auto border border-border bg-surface p-4 shadow-[var(--shadow-panel)]",
          pos,
          className,
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          {title ? (
            <Dialog.Title className="text-sm font-semibold tracking-wide uppercase text-muted">
              {title}
            </Dialog.Title>
          ) : (
            <span />
          )}
          <Dialog.Close className="rounded-[var(--radius-xs)] p-1 text-muted hover:bg-surface-2">
            <X className="size-4" />
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
