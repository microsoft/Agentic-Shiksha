import { useTheme } from "@/lib/ThemeProvider"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      style={{ "--width": "340px" } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-neutral-900 group-[.toaster]:text-neutral-100 group-[.toaster]:border-neutral-700/50 group-[.toaster]:shadow-lg group-[.toaster]:backdrop-blur-xl group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-neutral-400",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // All variants use same neutral background, only icon color varies
          loading: "!bg-neutral-900 !border-neutral-700/50 [&>svg]:text-blue-400",
          success: "!bg-neutral-900 !border-neutral-700/50 [&>svg]:text-green-400",
          error: "!bg-neutral-900 !border-neutral-700/50 [&>svg]:text-red-400",
          warning: "!bg-neutral-900 !border-neutral-700/50 [&>svg]:text-amber-400",
          info: "!bg-neutral-900 !border-neutral-700/50 [&>svg]:text-blue-400",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
