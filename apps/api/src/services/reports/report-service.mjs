import { getTaxonomyForEntityYear } from "../../domain/taxonomies.mjs";
import { isDateWithinRange } from "../../utils/time.mjs";

function resolveEntityTypeForYear({ tenantId, year, profiles }) {
  const date = `${year}-12-31`;
  const profile = profiles.find(
    (item) => item.tenantId === tenantId && isDateWithinRange(date, item.effectiveFrom, item.effectiveTo ?? null),
  );
  return profile?.entityType ?? "SOLE_PROP";
}

function createEmptyCategoryMap(taxonomy) {
  const out = new Map();
  for (const category of taxonomy.categories) {
    out.set(category.code, {
      categoryCode: category.code,
      displayName: category.label,
      irsForm: category.irsForm,
      irsLineRef: category.irsLineRef,
      total: 0,
      count: 0,
    });
  }
  return out;
}

export function buildTaxSummary({ tenantId, year, db }) {
  const entityType = resolveEntityTypeForYear({ tenantId, year, profiles: db.businessEntityProfiles });
  const taxonomy = getTaxonomyForEntityYear(entityType, year);
  if (!taxonomy) {
    throw new Error(`No taxonomy available for entityType=${entityType}, year=${year}`);
  }

  const categories = createEmptyCategoryMap(taxonomy);
  const transactions = db.transactions.filter((tx) => tx.tenantId === tenantId && tx.postedDate?.startsWith(`${year}-`));

  for (const tx of transactions) {
    const bucket = categories.get(tx.categoryCode) ?? categories.get("other_expense");
    if (!bucket) {
      continue;
    }
    bucket.total += tx.amount;
    bucket.count += 1;
  }

  const rows = [...categories.values()]
    .filter((row) => row.count > 0)
    .map((row) => ({
      ...row,
      total: Number.parseFloat(row.total.toFixed(2)),
    }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    tenantId,
    year,
    entityType,
    taxonomyId: taxonomy.id,
    taxonomyTitle: taxonomy.title,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

export function taxSummaryToCsv(summary) {
  const header = [
    "year",
    "entityType",
    "taxonomyId",
    "categoryCode",
    "displayName",
    "irsForm",
    "irsLineRef",
    "count",
    "total",
  ].join(",");

  const bodyLines = summary.rows.map((row) =>
    [
      summary.year,
      summary.entityType,
      summary.taxonomyId,
      row.categoryCode,
      `"${row.displayName.replaceAll('"', '""')}"`,
      row.irsForm,
      row.irsLineRef,
      row.count,
      row.total.toFixed(2),
    ].join(","),
  );

  return `${header}\n${bodyLines.join("\n")}\n`;
}
