import type { DormantItem, Item } from "../../shared/types";
import { daysBetween, isDateString } from "./util";

/**
 * 장롱템 기준 (docs/api-contract.md에도 같은 내용):
 * - never_worn : 등록한 지 30일이 넘었는데 한 번도 안 입음
 * - long_unworn: 마지막으로 입은 지 60일 이상
 * - high_cpw   : 구매 가격이 있고, 1회당 가격(가격 ÷ 착용 횟수, 0회면 가격 그대로)이 20,000원 이상이며
 *                10번 미만으로 입었고 등록한 지 30일이 넘음
 * 가방/액세서리도 포함한다. 점수(score)가 높은 순으로 정렬한다.
 */
export const DORMANT_RULES = {
  neverWornAfterDays: 30,
  unwornDays: 60,
  highCpw: 20000,
  highCpwMaxWears: 10,
} as const;

function dateOf(v: string | null): string | null {
  const d = v?.slice(0, 10) ?? null;
  return isDateString(d) ? d : null;
}

export function costPerWear(item: Pick<Item, "purchase_price" | "wear_count">): number | null {
  if (!item.purchase_price || item.purchase_price <= 0) return null;
  return Math.round(item.purchase_price / Math.max(item.wear_count, 1));
}

export function findDormantItems(items: Item[], today: string, limit = 8): DormantItem[] {
  const out: DormantItem[] = [];
  for (const item of items) {
    const created = dateOf(item.created_at);
    const lastWorn = dateOf(item.last_worn_date);
    const ownedDays = created ? daysBetween(created, today) : null;
    const idleFrom = lastWorn ?? created;
    const days_idle = idleFrom ? Math.max(0, daysBetween(idleFrom, today)) : null;
    const cpw = costPerWear(item);

    const reasons: DormantItem["reasons"] = [];
    const texts: string[] = [];
    if (item.wear_count === 0 && !lastWorn) {
      if (ownedDays !== null && ownedDays >= DORMANT_RULES.neverWornAfterDays) {
        reasons.push("never_worn");
        texts.push(`등록한 지 ${ownedDays}일째 한 번도 안 입었어요`);
      }
    } else if (lastWorn && days_idle !== null && days_idle >= DORMANT_RULES.unwornDays) {
      reasons.push("long_unworn");
      texts.push(`${days_idle}일째 안 입었어요`);
    }
    if (
      cpw !== null &&
      cpw >= DORMANT_RULES.highCpw &&
      item.wear_count < DORMANT_RULES.highCpwMaxWears &&
      ownedDays !== null &&
      ownedDays >= DORMANT_RULES.neverWornAfterDays
    ) {
      reasons.push("high_cpw");
      texts.push(`1회당 ${cpw.toLocaleString("ko-KR")}원 (${item.wear_count}번 입음)`);
    }
    if (!reasons.length) continue;
    const score = Math.round((Math.min(days_idle ?? 0, 365) / 365) * 50 + (Math.min(cpw ?? 0, 200000) / 200000) * 50);
    out.push({ item_id: item.id, reasons, reason: texts.join(", "), days_idle, cpw, score });
  }
  return out.sort((a, b) => b.score - a.score || a.item_id.localeCompare(b.item_id)).slice(0, limit);
}
