import { ENTITY_TYPES, TAXONOMY_IDS } from "./constants.mjs";

const BASE_CATEGORIES = Object.freeze([
  {
    code: "advertising",
    label: "Advertising",
    scheduleCLine: "8",
    form1120Line: "26",
  },
  {
    code: "car_truck",
    label: "Car and Truck Expenses",
    scheduleCLine: "9",
    form1120Line: "26",
  },
  {
    code: "commissions_fees",
    label: "Commissions and Fees",
    scheduleCLine: "10",
    form1120Line: "26",
  },
  {
    code: "contract_labor",
    label: "Contract Labor",
    scheduleCLine: "11",
    form1120Line: "26",
  },
  {
    code: "insurance",
    label: "Insurance",
    scheduleCLine: "15",
    form1120Line: "26",
  },
  {
    code: "interest",
    label: "Interest Expense",
    scheduleCLine: "16",
    form1120Line: "18",
  },
  {
    code: "legal_professional",
    label: "Legal and Professional Services",
    scheduleCLine: "17",
    form1120Line: "26",
  },
  {
    code: "office_expense",
    label: "Office Expense",
    scheduleCLine: "18",
    form1120Line: "26",
  },
  {
    code: "rent_lease",
    label: "Rent or Lease",
    scheduleCLine: "20",
    form1120Line: "16",
  },
  {
    code: "repairs_maintenance",
    label: "Repairs and Maintenance",
    scheduleCLine: "21",
    form1120Line: "26",
  },
  {
    code: "supplies",
    label: "Supplies",
    scheduleCLine: "22",
    form1120Line: "22",
  },
  {
    code: "taxes_licenses",
    label: "Taxes and Licenses",
    scheduleCLine: "23",
    form1120Line: "17",
  },
  {
    code: "travel",
    label: "Travel",
    scheduleCLine: "24a",
    form1120Line: "26",
  },
  {
    code: "meals",
    label: "Meals",
    scheduleCLine: "24b",
    form1120Line: "26",
  },
  {
    code: "utilities",
    label: "Utilities",
    scheduleCLine: "25",
    form1120Line: "26",
  },
  {
    code: "wages",
    label: "Wages",
    scheduleCLine: "26",
    form1120Line: "13",
  },
  {
    code: "owner_draw",
    label: "Owner Draw (Non-deductible)",
    scheduleCLine: "Non-deductible",
    form1120Line: "N/A",
  },
  {
    code: "other_expense",
    label: "Other Expense",
    scheduleCLine: "27a",
    form1120Line: "26",
  },
]);

export const TAXONOMIES = Object.freeze([
  {
    id: TAXONOMY_IDS.SCHEDULE_C_2024,
    version: "2024.1",
    title: "IRS Form 1040 Schedule C (2024)",
    entityType: ENTITY_TYPES.SOLE_PROP,
    taxYear: 2024,
    categories: BASE_CATEGORIES.map((item) => ({
      code: item.code,
      label: item.label,
      irsForm: "Schedule C",
      irsLineRef: item.scheduleCLine,
    })),
  },
  {
    id: TAXONOMY_IDS.FORM_1120_2025,
    version: "2025.1",
    title: "IRS Form 1120 (2025)",
    entityType: ENTITY_TYPES.C_CORP,
    taxYear: 2025,
    categories: BASE_CATEGORIES.filter((item) => item.code !== "owner_draw").map((item) => ({
      code: item.code,
      label: item.label,
      irsForm: "Form 1120",
      irsLineRef: item.form1120Line,
    })),
  },
]);

export function getTaxonomyById(taxonomyId) {
  return TAXONOMIES.find((taxonomy) => taxonomy.id === taxonomyId) ?? null;
}

export function getTaxonomyForEntityYear(entityType, year) {
  if (entityType === ENTITY_TYPES.SOLE_PROP) {
    return getTaxonomyById(TAXONOMY_IDS.SCHEDULE_C_2024);
  }
  if (entityType === ENTITY_TYPES.C_CORP) {
    return getTaxonomyById(TAXONOMY_IDS.FORM_1120_2025);
  }

  if (year <= 2024) {
    return getTaxonomyById(TAXONOMY_IDS.SCHEDULE_C_2024);
  }
  return getTaxonomyById(TAXONOMY_IDS.FORM_1120_2025);
}

export function categoryExistsInTaxonomy(taxonomyId, categoryCode) {
  const taxonomy = getTaxonomyById(taxonomyId);
  if (!taxonomy) {
    return false;
  }
  return taxonomy.categories.some((category) => category.code === categoryCode);
}
