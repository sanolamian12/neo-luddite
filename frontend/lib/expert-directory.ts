import type { ExpertCard } from "./poc-schema";

export interface ExpertFilters {
  query?: string;
  specialty?: string;
  availability?: ExpertCard["availability"] | "all";
}

export function filterExperts(
  experts: ExpertCard[],
  filters: ExpertFilters,
): ExpertCard[] {
  const normalize = (text: string) =>
    text.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/g, "");
  const query = normalize(filters.query ?? "");
  return experts.filter((expert) => {
    if (filters.specialty && !expert.specialties.includes(filters.specialty))
      return false;
    if (
      filters.availability &&
      filters.availability !== "all" &&
      expert.availability !== filters.availability
    )
      return false;
    return (
      !query ||
      [
        expert.displayName,
        expert.bio,
        ...expert.specialties,
        ...expert.qualifications,
      ].some((value) => normalize(value).includes(query))
    );
  });
}

export function paginateExperts<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, pageCount));
  return {
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    page: currentPage,
    pageCount,
  };
}
