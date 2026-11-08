export const qk = {
  me: ['me'] as const,
  sidebar: (ws: string) => ['sidebar', ws] as const,
  children: (pageId: string) => ['children', pageId] as const,
  page: (pageId: string) => ['page', pageId] as const,
  favorites: (ws: string) => ['favorites', ws] as const,
  recent: (ws: string) => ['recent', ws] as const,
  trash: (ws: string) => ['trash', ws] as const,
  archive: (ws: string) => ['archive', ws] as const,
  members: (ws: string) => ['members', ws] as const,
  invitations: (ws: string) => ['invitations', ws] as const,
  inbox: (ws: string) => ['inbox', ws] as const,
  comments: (pageId: string) => ['comments', pageId] as const,
};
