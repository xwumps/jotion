import type { PageCover } from '@jotion/shared';

/** Eingebaute Cover als CSS-Verläufe (keine externen Bilder). */
export const GRADIENTS: Record<string, string> = {
  sunrise: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  ocean: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
  forest: 'linear-gradient(135deg, #b7e4a9 0%, #4f9a6b 100%)',
  dusk: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  sand: 'linear-gradient(135deg, #f3e7c9 0%, #d8b98a 100%)',
  slate: 'linear-gradient(135deg, #8e9eab 0%, #3d4a5a 100%)',
};

export function coverStyle(cover: PageCover): React.CSSProperties {
  if (cover.type === 'gradient') return { background: GRADIENTS[cover.value] };
  return {
    backgroundImage: `url(/api/files/${cover.fileId})`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${cover.positionY ?? 50}%`,
  };
}
