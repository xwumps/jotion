'use client';

import type { PageTreeNodeDto } from '@jotion/shared';
import { Archive, Link2, MoreHorizontal, Star, StarOff, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { pageHref } from '@/lib/format';
import { useFavorites, usePageActions } from '@/lib/hooks';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu';

/** "…"-Menü einer Seite in der Sidebar. */
export function PageItemMenu({
  ws,
  node,
}: {
  ws: string;
  node: Pick<PageTreeNodeDto, 'id' | 'title'>;
}) {
  const t = useTranslations('sidebar');
  const favorites = useFavorites(ws);
  const { favorite, archive, trash } = usePageActions(ws);
  const isFav = favorites.data?.some((f) => f.id === node.id) ?? false;

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      new URL(pageHref(ws, node.id), window.location.origin).toString(),
    );
    toast.success(t('linkCopied'));
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton aria-label={t('more')}>
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuItem
          icon={isFav ? StarOff : Star}
          onSelect={() => favorite.mutate({ id: node.id, on: !isFav })}
        >
          {isFav ? t('removeFavorite') : t('addFavorite')}
        </MenuItem>
        <MenuItem icon={Link2} onSelect={() => void copyLink()}>
          {t('copyLink')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={Archive}
          onSelect={() =>
            archive.mutate(
              { id: node.id, archived: true },
              { onSuccess: () => toast.success(t('archived')) },
            )
          }
        >
          {t('archive')}
        </MenuItem>
        <MenuItem
          icon={Trash2}
          destructive
          onSelect={() =>
            trash.mutate(node.id, { onSuccess: () => toast.success(t('movedToTrash')) })
          }
        >
          {t('moveToTrash')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
