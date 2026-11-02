/** Die zehn Inhaltsfarben für Text, Hintergründe, Select-Optionen und Callouts. */
export const CONTENT_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type ContentColor = (typeof CONTENT_COLORS)[number];
