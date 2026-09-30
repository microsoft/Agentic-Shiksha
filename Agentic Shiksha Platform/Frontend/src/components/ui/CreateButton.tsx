import { LoadingButton } from "@/features/create/sharedUI";

interface CreateButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function CreateButton({
  onClick,
  loading = false,
  disabled = false,
  children = "Create",
  className,
}: CreateButtonProps) {
  return (
    <LoadingButton
      variant="white"
      loading={loading}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </LoadingButton>
  );
}
