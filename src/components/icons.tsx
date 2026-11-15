import type { ReactNode, SVGProps } from "react";

/**
 * 선 아이콘 세트. 24 격자, 선 굵기 1.6, 끝은 둥글게.
 * 크기는 size(기본 22)로, 색은 currentColor. 장식용이므로 기본 aria-hidden.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };
export type IconComponent = (props: IconProps) => ReactNode;

function make(children: ReactNode): IconComponent {
  return function Icon({ size = 22, ...p }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false} {...p}>
        {children}
      </svg>
    );
  };
}

/* 내비게이션 */
export const SunIcon = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>);
export const HangerIcon = make(<><path d="M12 7.2a2 2 0 1 1 2-2c0 1-1 1.6-2 2.4v1.6" /><path d="M12 9.2 3.2 15.4a1.5 1.5 0 0 0 .9 2.8h15.8a1.5 1.5 0 0 0 .9-2.8L12 9.2Z" /></>);
export const LayersIcon = make(<><path d="m12 3.5 8.5 4.6-8.5 4.6-8.5-4.6L12 3.5Z" /><path d="m3.5 12.4 8.5 4.6 8.5-4.6" /></>);
export const BookmarkIcon = make(<path d="M6.5 4.5h11a1 1 0 0 1 1 1v14.2l-6.5-4.2-6.5 4.2V5.5a1 1 0 0 1 1-1Z" />);
export const HeartIcon = make(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />);
export const SuitcaseIcon = make(<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5.8v1.7M3.5 12.5h17" /></>);
export const PersonIcon = make(<><circle cx="12" cy="8.2" r="3.7" /><path d="M4.5 20c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5" /></>);
export const GearIcon = make(<><circle cx="12" cy="12" r="2.8" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /></>);
export const MoreIcon = make(<><circle cx="5.5" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="18.5" cy="12" r="1.1" fill="currentColor" /></>);
export const CalendarIcon = make(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v3.5M16 3v3.5" /></>);

/* 동작 */
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const BackIcon = make(<path d="m14.5 5.5-6.5 6.5 6.5 6.5" />);
export const ChevronRightIcon = make(<path d="m9.5 5.5 6.5 6.5-6.5 6.5" />);
export const ChevronDownIcon = make(<path d="m5.5 9.5 6.5 6.5 6.5-6.5" />);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7" />);
export const SearchIcon = make(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>);
export const TrashIcon = make(<><path d="M4.5 7h15M9.5 7V5.3a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" /></>);
export const PencilIcon = make(<><path d="m5 19 .8-3.8L15.9 5.1a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8.8 18.2 5 19Z" /><path d="m14.5 6.5 3 3" /></>);
export const RefreshIcon = make(<><path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.8M4.5 12a7.5 7.5 0 0 1 13.3-4.8" /><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4" /></>);
export const LinkIcon = make(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const ExternalIcon = make(<><path d="M13.5 5H19v5.5M19 5l-8 8" /><path d="M17 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10" /></>);
export const CopyIcon = make(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-8.5A1.5 1.5 0 0 1 5 4h8.5A1.5 1.5 0 0 1 15 5.5V6" /></>);

/* 내용 */
export const ImageIcon = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.7" /><path d="m20.5 15.5-4.5-4.5-8.5 8.5" /></>);
export const CameraIcon = make(<><path d="M4.5 8.5h2.7L8.7 6h6.6l1.5 2.5h2.7a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V10a1.5 1.5 0 0 1 1.5-1.5Z" /><circle cx="12" cy="13.2" r="3.2" /></>);
export const SparkIcon = make(<><path d="M12 3.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" /><path d="M19 16.5v4M17 18.5h4" /></>);
export const PinIcon = make(<><path d="M12 21s6.5-5.8 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21Z" /><circle cx="12" cy="9.8" r="2.3" /></>);
export const AlertIcon = make(<><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></>);
export const InfoIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.7v.1" /></>);
export const MoonIcon = make(<path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7Z" />);
export const PhoneIcon = make(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>);
export const ShareIcon = make(<><path d="M12 15V3.5M8 7l4-4 4 4" /><path d="M6.5 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-.5" /></>);
export const LogoutIcon = make(<><path d="M14 4.5H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.5h7" /><path d="M10.5 12H20M16.5 8.5 20 12l-3.5 3.5" /></>);
export const WandIcon = make(<><path d="m4.5 19.5 10-10M13 8l3 3" /><path d="M17.5 3.5v3M16 5h3M20 10.5v2M19 11.5h2M9.5 3.5v2M8.5 4.5h2" /></>);
export const ShirtIcon = make(<path d="M8.5 4 4 6.5l1.5 4 2-.8V20h9V9.7l2 .8 1.5-4L15.5 4a3.5 3.5 0 0 1-7 0Z" />);
