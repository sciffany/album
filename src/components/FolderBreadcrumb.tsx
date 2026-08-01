import Link from "next/link";

export function FolderBreadcrumb({
  crumbs,
}: {
  crumbs: { name: string; href: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-[var(--muted)]">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link
            href="/browse"
            className="font-medium text-[var(--ink)] hover:text-[var(--accent)]"
          >
            Library
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <Link
              href={crumb.href}
              className="font-medium text-[var(--ink)] hover:text-[var(--accent)]"
            >
              {crumb.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
