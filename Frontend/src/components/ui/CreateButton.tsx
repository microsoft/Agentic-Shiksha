import { LoadingButton } from "@/features/create/sharedUI";

interface CreateButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function CreateButton({
  onClick,
  loading = false,
  disabled = false,
  children = "Create",
}: CreateButtonProps) {
  return (
    <LoadingButton
      variant="white"
      loading={loading}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </LoadingButton>
  );
}
