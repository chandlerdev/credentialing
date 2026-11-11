"use client";

import { useRef, useState } from "react";
import { AsyncBoundary } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { Pagination } from "@/components/Pagination";
import { api } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useFitRows } from "@/lib/useFitRows";
import { cleanSearch } from "@/lib/utils";
import type { Location, OrgTree, TreePractice } from "@/types/organization";

const ROW_H = 58;
const plural = (n: number, word: string) => n + " " + word + (n === 1 ? "" : "s");

/** One organization's practices → locations, read-only, with search and paging (super admin). */
export function OrgStructurePanel({ orgId }: { orgId: number }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const tree = useAsync<OrgTree>(() => api.get<OrgTree>("/org-tree", { q }, { orgId }), [orgId, q]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const size = useFitRows(listRef, ROW_H, 90);

  const data = tree.data;
  const searching = q.length > 0;
  const isOpen = (key: string) => searching || open.has(key);
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // top-level rows: the practices, then locations without a practice (one group)
  const groups: ({ kind: "practice"; practice: TreePractice } | { kind: "unassigned"; locations: Location[] })[] = (data?.practices || []).map((p) => ({ kind: "practice" as const, practice: p }));
  if (data && data.unassignedLocations.length) groups.push({ kind: "unassigned", locations: data.unassignedLocations });
  const totalPages = Math.max(1, Math.ceil(groups.length / size));
  const current = Math.min(page, totalPages - 1);
  const pageGroups = groups.slice(current * size, current * size + size);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 220 }}>
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(cleanSearch(e.target.value));
              setPage(0);
            }}
            placeholder="Search practice, location, city..."
            className="input"
            style={{ paddingLeft: 32 }}
            aria-label="Search organization structure"
          />
        </div>
        {data && (
          <div className="flex gap-4 text-xs text-ink-light">
            <span><strong className="text-ink">{data.totals.practices}</strong> practices</span>
            <span><strong className="text-ink">{data.totals.locations}</strong> locations</span>
            <span><strong className="text-ink">{data.totals.providers}</strong> providers</span>
          </div>
        )}
      </div>
      <div className="card overflow-hidden" ref={listRef}>
        <AsyncBoundary loading={tree.loading && !tree.data} error={tree.error} onRetry={tree.reload}>
          {pageGroups.length === 0 ? (
            <div className="text-center text-sm text-ink-light py-8">{searching ? "Nothing matches “" + q + "”" : "This organization has no practices yet"}</div>
          ) : (
            <div className="divide-y divide-line">
              {pageGroups.map((g) =>
                g.kind === "practice" ? (
                  <PracticeNode key={"p" + g.practice.id} practice={g.practice} isOpen={isOpen} toggle={toggle} />
                ) : (
                  <div key="unassigned">
                    <Row depth={0} icon="MapPin" title="Locations without a practice" subtitle={plural(g.locations.length, "location")} open={isOpen("u")} onToggle={() => toggle("u")} />
                    {isOpen("u") && g.locations.map((l) => <LocationNode key={l.id} location={l} depth={1} />)}
                  </div>
                )
              )}
            </div>
          )}
          <Pagination page={current} totalPages={totalPages} totalElements={groups.length} size={size} onChange={setPage} />
        </AsyncBoundary>
      </div>
    </div>
  );
}

function PracticeNode({ practice, isOpen, toggle }: { practice: TreePractice; isOpen: (k: string) => boolean; toggle: (k: string) => void }) {
  const key = "p" + practice.id;
  return (
    <div>
      <Row
        depth={0}
        icon="Briefcase"
        accent
        title={practice.name}
        subtitle={(practice.taxId ? "Tax ID: " + practice.taxId + " · " : "") + plural(practice.locationCount, "location") + " · " + plural(practice.providerCount, "provider")}
        open={isOpen(key)}
        onToggle={() => toggle(key)}
      />
      {isOpen(key) &&
        (practice.locations.length === 0 ? (
          <div className="text-xs text-ink-faint py-2" style={{ paddingLeft: 52 }}>No locations</div>
        ) : (
          practice.locations.map((l) => <LocationNode key={l.id} location={l} depth={1} />)
        ))}
    </div>
  );
}

function LocationNode({ location, depth }: { location: Location; depth: number }) {
  const where = [location.city, location.state].filter(Boolean).join(", ");
  return <Row depth={depth} icon="MapPin" title={location.name} subtitle={(where ? where + " · " : "") + plural(location.providerCount, "provider")} />;
}

function Row({ depth, icon, title, subtitle, open, onToggle, accent }: { depth: number; icon: string; title: string; subtitle: string; open?: boolean; onToggle?: () => void; accent?: boolean }) {
  const expandable = !!onToggle;
  return (
    <div
      className={"flex items-center gap-3 py-2.5 pr-4 " + (expandable ? "cursor-pointer hover:bg-soft" : "")}
      style={{ paddingLeft: 16 + depth * 32 }}
      onClick={onToggle}
      role={expandable ? "button" : undefined}
      aria-expanded={expandable ? !!open : undefined}
    >
      <span className="w-4 flex-shrink-0 text-ink-faint">{expandable && <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} />}</span>
      <Icon name={icon} size={16} className={accent ? "text-success" : "text-ink-light"} />
      <div className="min-w-0">
        <div className={"text-sm font-semibold truncate " + (accent ? "text-accent" : "text-ink")}>{title}</div>
        <div className="text-xs text-ink-light truncate">{subtitle}</div>
      </div>
    </div>
  );
}
