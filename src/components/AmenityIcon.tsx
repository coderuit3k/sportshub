import { Wifi, SquareParking, Shirt, Dumbbell, CupSoda, Check, type LucideIcon } from "lucide-react";

/**
 * Amenity → lucide icon, keyed by the amenity's display name (the value
 * stored in VenueAmenity.name). All glyphs exist in lucide-react 0.544.
 * Unknown amenities fall back to a generic Check.
 */
const AMENITY_ICONS: Record<string, LucideIcon> = {
  Wifi: Wifi,
  "Bãi xe": SquareParking,
  "Phòng thay đồ": Shirt,
  "Cho thuê vợt/bóng": Dumbbell,
  "Nước uống": CupSoda,
};

export function amenityIcon(name: string): LucideIcon {
  return AMENITY_ICONS[name] ?? Check;
}

export default function AmenityIcon({ name, className }: { name: string; className?: string }) {
  const Icon = amenityIcon(name);
  return <Icon className={className ?? "h-4 w-4"} aria-hidden />;
}
