import type { StoreStatus } from "@/components/location/location-preview-data";

type StoreStatusBadgeProps = {
  status: StoreStatus;
  label: string;
  /** Render a compact inline variant for the secondary bar. */
  compact?: boolean;
};

const statusConfig: Record<
  StoreStatus,
  {
    dotColor: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
    ringPulse: string;
  }
> = {
  open: {
    dotColor: "bg-green-400",
    bgColor: "bg-green-400/15",
    textColor: "text-green-300",
    borderColor: "border-green-400/40",
    ringPulse: "animate-pulse",
  },
  closed: {
    dotColor: "bg-red-400",
    bgColor: "bg-red-400/12",
    textColor: "text-red-300",
    borderColor: "border-red-400/35",
    ringPulse: "",
  },
  delayed: {
    dotColor: "bg-amber-400",
    bgColor: "bg-amber-400/12",
    textColor: "text-amber-300",
    borderColor: "border-amber-400/35",
    ringPulse: "animate-pulse",
  },
};

export function StoreStatusBadge({ status, label, compact }: StoreStatusBadgeProps) {
  const config = statusConfig[status];

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border ${config.borderColor} ${config.bgColor} px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] ${config.textColor}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotColor} ${config.ringPulse}`} aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border ${config.borderColor} ${config.bgColor} px-4 py-2`}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dotColor} ${config.ringPulse}`} aria-hidden="true" />
      <span className={`text-xs font-black uppercase tracking-[0.18em] ${config.textColor}`}>{label}</span>
    </div>
  );
}
