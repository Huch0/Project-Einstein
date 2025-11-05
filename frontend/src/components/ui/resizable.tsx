"use client";

import * as React from "react";
import {
  Panel as PanelPrimitive,
  PanelGroup,
  PanelResizeHandle as PanelResizeHandlePrimitive,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = React.forwardRef<
  React.ElementRef<typeof PanelGroup>,
  React.ComponentPropsWithoutRef<typeof PanelGroup>
>(({ className, ...props }, ref) => (
  <PanelGroup
    ref={ref}
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
));
ResizablePanelGroup.displayName = "ResizablePanelGroup";

const ResizablePanel = React.forwardRef<
  React.ElementRef<typeof PanelPrimitive>,
  React.ComponentPropsWithoutRef<typeof PanelPrimitive>
>(({ ...props }, ref) => (
  <PanelPrimitive ref={ref} {...props} />
));
ResizablePanel.displayName = "ResizablePanel";

const ResizableHandle = ({
  className,
  withHandle = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof PanelResizeHandlePrimitive> & {
  withHandle?: boolean;
}) => (
  <PanelResizeHandlePrimitive
    className={cn(
      "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="bg-border z-10 flex h-16 w-3 items-center justify-center rounded-sm border">
        <div className="h-4 w-0.5 rounded-full bg-muted-foreground/70" />
      </div>
    )}
  </PanelResizeHandlePrimitive>
);
ResizableHandle.displayName = "ResizableHandle";

export { ResizablePanelGroup, ResizableHandle, ResizablePanel };