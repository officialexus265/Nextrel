import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  className,
  children,
  align = "end",
}: {
  className?: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        className={cn(
          "z-50 min-w-44 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2 p-1 shadow-[var(--shadow-panel)]",
          className,
        )}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2.5 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-3",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <Menu.Label className="px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-subtle">
      {children}
    </Menu.Label>
  );
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}
