import { formatDistanceToNow } from "date-fns";
import { enUS as dateFnsEnUS } from "date-fns/locale";

export function formatTimeAgo(date: Date | string | number) {
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: dateFnsEnUS,
  });
}
