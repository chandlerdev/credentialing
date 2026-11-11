"use client";

import { useMemo, useState } from "react";
import { cleanSearch } from "@/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccessDenied } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusPill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { useShell } from "@/stores/shell";
import { ROLE_LABEL } from "@/lib/constants";
import type { PageResponse } from "@/types";
import { AddPracticeLocationModal, EditLocationModal, EditPracticeModal } from "@/components/modals/OrgModals";
import { AddProviderModal } from "@/components/modals/AddProviderModal";
import { providerStatusPillKey, type DeleteResult, type Location, type LocationProviderRow, type OrgTree, type Practice, type TreePractice } from "@/types/organization";

type PendingDelete =
  | { kind: "practice"; id: number; name: string; providers: number }
  | { kind: "location"; id: number; name: string; providers: number };

const PROVIDER_PAGE_SIZE = 25;

export function OrganizationView() {
  const user = useUser();
  const { can } = useAuth();
  const toast = useToast();
  const { publish } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedLocationId = params.get("location") ? Number(params.get("location")) : null;

  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [showAdd, setShowAdd] = useState(false);
  const [editPractice, setEditPractice] = useState<TreePractice | Practice | null>(null);
  const [editLocation, setEditLocation] = useState<Location | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [providerPage, setProviderPage] = useState(0);
  // A practice can be selected as well (details on the right).
  const [selectedPracticeId, setSelectedPracticeId] = useState<number | null>(null);
  const [addPreset, setAddPreset] = useState<{ type: "practice" | "location"; parentId: number } | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);

  const canRead = can("read", "location");
  const canCreate = can("create", "location");
  const canUpdate = can("update", "location");
  const canDelete = can("delete", "location");

  const tree = useAsync<OrgTree>(canRead ? () => api.get<OrgTree>("/org-tree", { q }) : null, [q, canRead]);
  const practices = useAsync<Practice[]>(canRead && can("list", "location") ? () => api.get<Practice[]>("/practices") : null, [canRead]);
  const location = useAsync<Location>(selectedLocationId && canRead ? () => api.get<Location>("/locations/" + selectedLocationId) : null, [selectedLocationId, canRead]);
  const locationProviders = useAsync<PageResponse<LocationProviderRow>>(
    selectedLocationId ? () => api.get<PageResponse<LocationProviderRow>>("/providers", { locationId: selectedLocationId, page: providerPage, size: PROVIDER_PAGE_SIZE, sort: "lastName,asc" }) : null,
    [selectedLocationId, providerPage]
  );

  // Every practice (and the locations without a practice) can be expanded; everything is open while searching.
  const allNodeIds = useMemo(() => {
    const all = new Set<string>();
    tree.data?.practices.forEach((p) => all.add("p" + p.id));
    if (tree.data?.unassignedLocations.length) all.add("unassigned");
    return all;
  }, [tree.data]);

  // Adjust expansion when new tree / location data arrives (render-time state adjustment, no effect).
  const [seenTree, setSeenTree] = useState<OrgTree | undefined>(undefined);
  if (tree.data && tree.data !== seenTree) {
    setSeenTree(tree.data);
    if (q) setExpanded(new Set(allNodeIds));
  }

  // Make sure the selected location's branch is open.
  const [seenLocation, setSeenLocation] = useState<Location | undefined>(undefined);
  if (location.data && location.data !== seenLocation) {
    const loc = location.data;
    setSeenLocation(loc);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (loc.practiceId) next.add("p" + loc.practiceId);
      else next.add("unassigned");
      return next;
    });
  }

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const expandAll = () => setExpanded(new Set(allNodeIds));
  const collapseAll = () => setExpanded(new Set());

  const selectLocation = (id: number | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id == null) sp.delete("location");
    else sp.set("location", String(id));
    setProviderPage(0);
    if (id != null) setSelectedPracticeId(null);
    router.replace(pathname + (sp.toString() ? "?" + sp.toString() : ""), { scroll: false });
  };
  const selectPractice = (id: number) => {
    setSelectedPracticeId(id);
    if (selectedLocationId) selectLocation(null);
  };


  const reloadAll = () => {
    tree.reload();
    practices.reload();
    if (selectedLocationId) {
      location.reload();
      locationProviders.reload();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const path = pendingDelete.kind === "practice" ? "/practices/" : "/locations/";
      await api.delete<DeleteResult>(path + pendingDelete.id);
      toast(pendingDelete.kind === "practice" ? "Practice deleted" : "Location deleted");
      if (pendingDelete.kind === "location" && pendingDelete.id === selectedLocationId) selectLocation(null);
      setPendingDelete(null);
      publish("providers");
      reloadAll();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleting(false);
    }
  };

  if (!canRead) return <AccessDenied action="view" entity="the organization" role={ROLE_LABEL[user.role] || user.role} />;

  const data = tree.data;
  const totals = data?.totals;
  const selectedLocation = location.data && location.data.id === selectedLocationId ? location.data : null;
  // One loader for the whole page: while the tree, the open location or its providers are loading,
  // the page is blurred under a single spinner (no separate loaders in each panel).
  const pageLoading =
    (tree.loading && !tree.data) ||
    (!!selectedLocationId && !selectedLocation && !location.error) ||
    (!!selectedLocation && locationProviders.loading && !locationProviders.data && !locationProviders.error);
  const selectedPractice: TreePractice | Practice | null = selectedLocation?.practiceId
    ? data?.practices.find((p) => p.id === selectedLocation.practiceId) || practices.data?.find((p) => p.id === selectedLocation.practiceId) || null
    : null;
  const explicitPractice = !selectedLocationId && selectedPracticeId ? data?.practices.find((p) => p.id === selectedPracticeId) || null : null;
  const orgName = data?.organization.name || "Organization";

  const deleteMessage = (d: PendingDelete) => {
    if (d.kind === "practice")
      return d.providers > 0 ? "Delete practice \"" + d.name + "\"? " + d.providers + " provider(s) are linked and will be unassigned from this practice." : "Delete practice \"" + d.name + "\"?";
    return d.providers > 0 ? "Delete location \"" + d.name + "\"? " + d.providers + " provider(s) are at this location and will be unassigned." : "Delete location \"" + d.name + "\"?";
  };

  const iconBtn = (title: string, icon: string, onClick: () => void) => (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          onClick();
        }
      }}
      className="p-1 rounded hover:bg-soft-2 cursor-pointer inline-flex"
      title={title}
    >
      <Icon name={icon} size={12} className="text-ink-light" />
    </span>
  );

  const renderLocation = (loc: Location) => {
    const isSelected = selectedLocationId === loc.id;
    return (
      <div key={loc.id} className="flex items-center ml-4">
        <button onClick={() => selectLocation(loc.id)} className={"flex-1 min-w-0 flex items-center gap-2 px-2 py-2 rounded text-left " + (isSelected ? "bg-accent-soft" : "hover:bg-soft")}>
          <Icon name="MapPin" size={12} style={{ color: isSelected ? "var(--accent)" : "var(--ink-faint)" }} />
          <div className="flex-1 min-w-0">
            <div className={"text-sm " + (isSelected ? "font-semibold text-accent" : "font-medium text-ink")}>{loc.name}</div>
            <div className="text-[10px] text-ink-light">
              {loc.providerCount} providers{!loc.active ? " · Inactive" : ""}
            </div>
          </div>
          {canUpdate && iconBtn("Edit location", "Pencil", () => setEditLocation(loc))}
          {canDelete && iconBtn("Delete location", "Trash2", () => setPendingDelete({ kind: "location", id: loc.id, name: loc.name, providers: loc.providerCount }))}
        </button>
      </div>
    );
  };

  return (
    <div className="relative" aria-busy={pageLoading}>
      {pageLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.45)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}>
          <Loading compact label="Loading organization" />
        </div>
      )}
      <PageHeader
        title={data ? data.organization.name + "'s Organization" : "Organization"}
        subtitle="Manage your practices, locations, and providers"
        actions={
          canCreate && (
            <button onClick={() => setShowAdd(true)} className="btn btn-primary"><Icon name="Plus" size={13} /> Add Practice / Location</button>
          )
        }
      />

      <div className="flex items-center gap-4 mb-4 text-sm text-ink-light flex-wrap">
        <span className="flex items-center gap-1.5"><Icon name="Briefcase" size={13} /> {totals?.practices ?? "—"} practices</span>
        <span className="flex items-center gap-1.5"><Icon name="MapPin" size={13} /> {totals?.locations ?? "—"} locations</span>
        <span className="flex items-center gap-1.5"><Icon name="Users" size={13} /> {totals?.providers ?? "—"} providers</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Tree on left */}
        <div className="lg:col-span-2 card" style={{ minHeight: 600 }}>
          <div className="p-3 border-b border-line">
            <div className="relative mb-2">
              <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
              <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search..." className="input" style={{ paddingLeft: 32 }} />
            </div>
            <div className="flex gap-2">
              <button onClick={expandAll} className="btn btn-secondary flex-1" style={{ fontSize: 12 }}>Expand All</button>
              <button onClick={collapseAll} className="btn btn-secondary flex-1" style={{ fontSize: 12 }}>Collapse All</button>
              {canCreate && (
                <button onClick={() => setShowAdd(true)} className="btn btn-primary" style={{ fontSize: 12 }}><Icon name="Plus" size={12} /> Add</button>
              )}
            </div>
          </div>
          <div className="p-2 overflow-y-auto" style={{ maxHeight: 600 }}>
            {tree.error ? (
              <ErrorState message={tree.error} onRetry={tree.reload} />
            ) : tree.loading && !data ? (
              <div style={{ minHeight: 400 }} />
            ) : data && data.practices.length === 0 && data.unassignedLocations.length === 0 ? (
              <EmptyState
                icon={q ? "SearchX" : "Briefcase"}
                title={q ? "No matches" : "No practices yet"}
                description={q ? "No practice or location matches \"" + q + "\"." : "Add your first practice, then its locations."}
              />
            ) : (
              data && (
                <>
                  {data.practices.map((practice) => {
                    const pExp = expanded.has("p" + practice.id);
                    return (
                      <div key={practice.id} className="mb-1" data-tree-practice={practice.id}>
                        <button
                          onClick={() => {
                            toggle("p" + practice.id);
                            selectPractice(practice.id);
                          }}
                          className={"w-full flex items-center gap-2 px-2 py-2 rounded text-left " + (explicitPractice?.id === practice.id ? "bg-accent-soft" : "hover:bg-soft")}
                          aria-expanded={pExp}
                        >
                          <Icon name={pExp ? "ChevronDown" : "ChevronRight"} size={14} className="text-ink-faint" />
                          <Icon name="Briefcase" size={13} style={{ color: "#10b981" }} />
                          <div className="flex-1">
                            <div className={"text-sm font-medium " + (explicitPractice?.id === practice.id ? "text-accent" : "text-ink")}>{practice.name}</div>
                            <div className="text-[10px] text-ink-light">Tax ID: {practice.taxId || "—"}</div>
                            <div className="text-[10px] text-ink-light">
                              {practice.locationCount} locations · {practice.providerCount} providers
                            </div>
                          </div>
                          {canUpdate && iconBtn("Edit practice", "Pencil", () => setEditPractice(practice))}
                          {canDelete && iconBtn("Delete practice", "Trash2", () => setPendingDelete({ kind: "practice", id: practice.id, name: practice.name, providers: practice.providerCount }))}
                        </button>
                        {pExp && practice.locations.map(renderLocation)}
                        {pExp && practice.locations.length === 0 && <div className="ml-10 py-1 text-[11px] text-ink-faint">No locations</div>}
                      </div>
                    );
                  })}
                  {data.unassignedLocations.length > 0 && (
                    <div className="mb-1">
                      <button onClick={() => toggle("unassigned")} className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-soft text-left">
                        <Icon name={expanded.has("unassigned") ? "ChevronDown" : "ChevronRight"} size={14} className="text-ink-faint" />
                        <Icon name="MapPinned" size={14} className="text-ink-light" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-ink">Locations without a practice</div>
                          <div className="text-[10px] text-ink-light">{data.unassignedLocations.length} locations</div>
                        </div>
                      </button>
                      {expanded.has("unassigned") && data.unassignedLocations.map(renderLocation)}
                    </div>
                  )}
                </>
              )
            )}
          </div>
        </div>

        {/* Detail on right */}
        <div className="lg:col-span-3 card">
          {!selectedLocationId ? (
            <SelectionDetail
              orgName={orgName}
              practice={explicitPractice}
              canCreate={canCreate}
              canUpdate={canUpdate}
              onSelectLocation={selectLocation}
              onEditPractice={setEditPractice}
              onAddLocation={(practiceId) => setAddPreset({ type: "location", parentId: practiceId })}
            />
          ) : location.error ? (
            <div className="p-5">
              <ErrorState message={location.error} onRetry={location.reload} />
            </div>
          ) : !selectedLocation ? (
            <div style={{ minHeight: 400 }} />
          ) : (
            <div>
              {/* Breadcrumb */}
              <div className="px-5 pt-4 pb-3 border-b border-line">
                <div className="flex items-center gap-1 text-xs text-ink-light mb-2 flex-wrap">
                  {/* Organization › practice (opens the practice panel) › location */}
                  <span>{orgName}</span>
                  <Icon name="ChevronRight" size={11} className="text-ink-faint" />
                  {selectedLocation.practiceId ? (
                    <button
                      onClick={() => {
                        const id = selectedLocation.practiceId!;
                        setExpanded((prev) => new Set(prev).add("p" + id));
                        selectPractice(id);
                      }}
                      className="hover:text-accent hover:underline"
                      title="Open practice"
                    >
                      {selectedLocation.practiceName || "Practice"}
                    </button>
                  ) : (
                    <span>No practice</span>
                  )}
                  <Icon name="ChevronRight" size={11} className="text-ink-faint" />
                  <span className="text-ink font-medium">{selectedLocation.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Icon name="Building" size={16} className="text-ink-light" />
                  <h2 className="font-display text-xl font-semibold">{selectedLocation.name}</h2>
                </div>
              </div>

              {/* Practice + Location grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-soft-2 border-b border-line">
                <div className="bg-paper p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Practice</div>
                    {canUpdate && selectedPractice && (
                      <button onClick={() => setEditPractice(selectedPractice)} className="text-ink-faint hover:text-accent" title="Edit practice">
                        <Icon name="Pencil" size={13} />
                      </button>
                    )}
                  </div>
                  {selectedPractice ? (
                    <>
                      <div className="font-display font-semibold text-ink mb-2">{selectedPractice.name}</div>
                      <div className="space-y-1 text-xs text-ink-light">
                        <div><span className="text-ink-faint">Tax ID:</span> {selectedPractice.taxId || "—"}</div>
                        <div><span className="text-ink-faint">Address:</span> {selectedPractice.address || "—"}</div>
                        <div><span className="text-ink-faint">Ph.No:</span> {selectedPractice.phone || "—"}</div>
                        <div><span className="text-ink-faint">Email:</span> {selectedPractice.email || "—"}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-ink-light">This location is not linked to a practice.</div>
                  )}
                </div>

                <div className="bg-paper p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Location</div>
                    <div className="flex gap-1">
                      {canUpdate && (
                        <button onClick={() => setEditLocation(selectedLocation)} className="text-ink-faint hover:text-accent p-1" title="Edit location"><Icon name="Pencil" size={13} /></button>
                      )}
                    </div>
                  </div>
                  <div className="font-display font-semibold text-ink mb-2">{selectedLocation.name}</div>
                  <div className="space-y-1 text-xs text-ink-light">
                    <div><span className="text-ink-faint">Legal Name:</span> {selectedLocation.legalName || "—"}</div>
                    <div><span className="text-ink-faint">NPI:</span> {selectedLocation.npi || "—"}</div>
                    <div>
                      <span className="text-ink-faint">Address:</span>{" "}
                      {[selectedLocation.address, selectedLocation.city, [selectedLocation.state, selectedLocation.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
                    </div>
                    {selectedLocation.phone && <div><span className="text-ink-faint">Ph.No:</span> {selectedLocation.phone}</div>}
                  </div>
                </div>
              </div>

              {/* Providers at this location */}
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-ink">Providers</div>
                  {can("create", "provider") && (
                    <button onClick={() => setAddingProvider(true)} className="btn btn-primary" style={{ fontSize: 11, padding: "4px 8px" }}>
                      <Icon name="Plus" size={11} /> Add Provider
                    </button>
                  )}
                </div>
                {locationProviders.error ? (
                  <ErrorState message={locationProviders.error} onRetry={locationProviders.reload} />
                ) : locationProviders.loading && !locationProviders.data ? (
                  <div style={{ minHeight: 160 }} />
                ) : !locationProviders.data || locationProviders.data.content.length === 0 ? (
                  <EmptyState icon="UserX" title="No providers at this location" description="Use “Add Provider” to add one directly to this location." />
                ) : (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Specialty</th>
                            <th>NPI</th>
                            <th className="text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {locationProviders.data.content.map((p) => (
                            <tr key={p.id} className="cursor-pointer" onClick={() => router.push("/providers/" + p.id)}>
                              <td>
                                <div className="flex items-center gap-2">
                                  <Avatar name={p.firstName + " " + p.lastName} size={28} />
                                  <span className="font-medium">
                                    {p.firstName} {p.lastName}
                                    {p.suffix ? ", " + p.suffix : ""}
                                  </span>
                                </div>
                              </td>
                              <td><StatusPill status={providerStatusPillKey(p.status)} /></td>
                              <td className="text-ink-light">{p.specialty}</td>
                              <td className="font-mono text-xs text-ink-light">{p.npi}</td>
                              <td className="text-right">
                                <div className="flex justify-end gap-1">
                                  <button
                                    className="btn-ghost p-1"
                                    title="Open provider"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push("/providers/" + p.id);
                                    }}
                                  >
                                    <Icon name="Pencil" size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      page={locationProviders.data.page}
                      totalPages={locationProviders.data.totalPages}
                      totalElements={locationProviders.data.totalElements}
                      size={locationProviders.data.size}
                      onChange={setProviderPage}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddPracticeLocationModal
          organizationName={orgName}
          practices={practices.data || []}
          onClose={() => setShowAdd(false)}
          onSaved={reloadAll}
        />
      )}
      {addPreset && (
        <AddPracticeLocationModal
          organizationName={orgName}
          practices={practices.data || []}
          initialType={addPreset.type}
          initialParentId={addPreset.parentId}
          onClose={() => setAddPreset(null)}
          onSaved={reloadAll}
        />
      )}
      {addingProvider && selectedLocation && (
        <AddProviderModal
          placement={{
            practiceId: selectedLocation.practiceId,
            locationId: selectedLocation.id,
            label: [selectedLocation.practiceName, selectedLocation.name].filter(Boolean).join(" › "),
          }}
          onClose={() => setAddingProvider(false)}
          onCreated={() => {
            setAddingProvider(false);
            publish("providers");
            reloadAll();
          }}
        />
      )}
      {editPractice && <EditPracticeModal practice={editPractice} organizationName={orgName} onClose={() => setEditPractice(null)} onSaved={reloadAll} />}
      {editLocation && <EditLocationModal location={editLocation} onClose={() => setEditLocation(null)} onSaved={reloadAll} />}
      {pendingDelete && (
        <ConfirmDialog
          title={"Delete " + pendingDelete.kind}
          message={deleteMessage(pendingDelete)}
          busy={deleting}
          onConfirm={confirmDelete}
          onClose={() => !deleting && setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/** Right panel when a practice (not a location) is selected. */
function SelectionDetail({
  orgName,
  practice,
  canCreate,
  canUpdate,
  onSelectLocation,
  onEditPractice,
  onAddLocation,
}: {
  orgName: string;
  practice: TreePractice | null;
  canCreate: boolean;
  canUpdate: boolean;
  onSelectLocation: (id: number) => void;
  onEditPractice: (p: TreePractice) => void;
  onAddLocation: (practiceId: number) => void;
}) {
  const smallBtn = { fontSize: 11, padding: "4px 8px" };

  if (practice) {
    return (
      <div className="p-5">
        {/* Breadcrumb: organization › practice */}
        <div className="flex items-center gap-1 text-xs text-ink-light mb-3 flex-wrap">
          <span>{orgName}</span>
          <Icon name="ChevronRight" size={11} className="text-ink-faint" />
          <span className="text-ink font-medium">{practice.name}</span>
        </div>
        <div className="flex items-start gap-3 mb-4 pb-4 border-b border-line">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#10b98120" }}>
            <Icon name="Briefcase" size={22} style={{ color: "#10b981" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-ink-light uppercase font-semibold tracking-wider">Practice</div>
            <h3 className="font-display font-bold text-xl text-ink">{practice.name}</h3>
            <div className="text-xs text-ink-light mt-1">
              {orgName}
              {practice.taxId && (
                <>
                  {" "}· Tax ID: <span className="font-mono">{practice.taxId}</span>
                </>
              )}
            </div>
          </div>
          {canUpdate && (
            <button onClick={() => onEditPractice(practice)} className="btn btn-secondary"><Icon name="Pencil" size={12} /> Edit</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="card card-pad text-center">
            <Icon name="MapPin" size={16} className="mx-auto mb-1" style={{ color: "var(--info)" }} />
            <div className="font-display text-2xl font-bold text-ink">{practice.locationCount}</div>
            <div className="text-[10px] text-ink-light">Locations</div>
          </div>
          <div className="card card-pad text-center">
            <Icon name="Users" size={16} className="mx-auto mb-1" style={{ color: "var(--success)" }} />
            <div className="font-display text-2xl font-bold text-ink">{practice.providerCount}</div>
            <div className="text-[10px] text-ink-light">Providers</div>
          </div>
        </div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-ink">Locations</div>
          {canCreate && (
            <button onClick={() => onAddLocation(practice.id)} className="btn btn-primary" style={smallBtn}><Icon name="Plus" size={11} /> Add Location</button>
          )}
        </div>
        {practice.locations.length === 0 ? (
          <div className="p-6 text-center text-xs text-ink-faint">
            <Icon name="MapPin" size={20} className="mx-auto mb-2 text-ink-faint" />
            No locations yet. Use &quot;+ Add Location&quot; to create one.
          </div>
        ) : (
          <div className="space-y-1.5">
            {practice.locations.map((loc) => (
              <button key={loc.id} onClick={() => onSelectLocation(loc.id)} className="w-full flex items-center gap-2 p-2.5 rounded border border-line hover:border-accent text-left">
                <Icon name="MapPin" size={14} style={{ color: "var(--info)" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{loc.name}</div>
                  <div className="text-[10px] text-ink-light">{loc.address || "No address"}</div>
                </div>
                <Icon name="ChevronRight" size={14} className="text-ink-faint" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-10 text-center">
      <Icon name="MousePointerClick" size={32} className="mx-auto text-ink-faint mb-3" />
      <div className="font-display font-bold text-ink text-xl">Nothing selected</div>
      <div className="text-sm text-ink-light mt-2">Click a practice or location on the left to view its details.</div>
    </div>
  );
}
