import Image from 'next/image';

interface Props {
  children: React.ReactNode;
  /**
   * When true (default), the overlay leans darker so white text on the photo
   * reads cleanly. Pages that show a white card ONLY and no text-on-photo can
   * pass `lightOverlay` for a brighter backdrop.
   */
  darkOverlay?: boolean;
}

/**
 * Shared background for all `/auth/*` screens: the community photo behind a
 * brand-green gradient overlay, with the children centered on top. Keeps the
 * four auth pages visually consistent with the dashboard hero.
 *
 * The image is served from /public/community.webp (see the dashboard page for
 * the same asset). Setting `priority` so it loads fast on first paint.
 */
export default function AuthShell({ children, darkOverlay = true }: Props) {
  const overlay = darkOverlay
    ? 'bg-gradient-to-br from-[#0A3D02]/92 via-[#1B5E20]/85 to-[#2E7D32]/85'
    : 'bg-gradient-to-br from-[#0A3D02]/75 via-[#1B5E20]/70 to-[#2E7D32]/70';

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-[#1B5E20]">
      <Image
        src="/community.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className={`absolute inset-0 ${overlay}`} />
      <div className="relative w-full flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
