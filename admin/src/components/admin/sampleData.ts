import type { DataBundle } from "@/types/admin";

/**
 * Self-consistent sample dataset for import testing (prototype v2 buildSampleJson): 3 practices, 5 locations,
 * 8 providers, 40 enrollments, 4 tasks — all linked practice → location → provider.
 * Same shape as GET /admin/test-data/export, so it can be loaded with "Import JSON".
 */
export function buildSampleJson(): DataBundle {
  const now = new Date();
  const dateOnly = (daysOffset: number) => new Date(now.getTime() + daysOffset * 86400000).toISOString().slice(0, 10);

  const practices = [
    { id: "pr_sample_metro_mi", name: "MetroHealth Michigan", taxId: "411234567" },
    { id: "pr_sample_metro_oh", name: "MetroHealth Ohio", taxId: "411234568" },
    { id: "pr_sample_pacific_ca", name: "Pacific CA Group", taxId: "954321098" },
  ];

  const locations = [
    { id: "loc_sample_detroit", name: "Detroit Main", practiceId: "pr_sample_metro_mi", legalName: "MetroHealth MI, PLLC", npi: "1234567890", address: "100 Woodward Ave", city: "Detroit", state: "MI", zip: "48226", phone: "(313) 555-1000", lat: 42.3314, lng: -83.0458 },
    { id: "loc_sample_annarbor", name: "Ann Arbor", practiceId: "pr_sample_metro_mi", legalName: "MetroHealth MI, PLLC", npi: "1234567891", address: "300 S Main St", city: "Ann Arbor", state: "MI", zip: "48104", phone: "(734) 555-1001", lat: 42.2808, lng: -83.743 },
    { id: "loc_sample_cleveland", name: "Cleveland Downtown", practiceId: "pr_sample_metro_oh", legalName: "MetroHealth OH, PLLC", npi: "1234567892", address: "200 Public Sq", city: "Cleveland", state: "OH", zip: "44114", phone: "(216) 555-1002", lat: 41.4993, lng: -81.6944 },
    { id: "loc_sample_sf", name: "San Francisco Clinic", practiceId: "pr_sample_pacific_ca", legalName: "Pacific CA Medical, Inc.", npi: "1234567893", address: "500 Market St", city: "San Francisco", state: "CA", zip: "94105", phone: "(415) 555-1003", lat: 37.7897, lng: -122.3972 },
    { id: "loc_sample_la", name: "Los Angeles Center", practiceId: "pr_sample_pacific_ca", legalName: "Pacific CA Medical, Inc.", npi: "1234567894", address: "350 S Grand Ave", city: "Los Angeles", state: "CA", zip: "90071", phone: "(213) 555-1004", lat: 34.0522, lng: -118.2437 },
  ];

  const seeds = [
    { fn: "Rachel", ln: "Kim", spec: "Family Medicine", loc: "loc_sample_detroit", suffix: "MD" },
    { fn: "Marcus", ln: "Chen", spec: "Internal Medicine", loc: "loc_sample_detroit", suffix: "MD" },
    { fn: "Diana", ln: "Nguyen", spec: "Pediatrics", loc: "loc_sample_annarbor", suffix: "MD" },
    { fn: "Yusuf", ln: "Patel", spec: "Cardiology", loc: "loc_sample_cleveland", suffix: "MD" },
    { fn: "Priya", ln: "Garcia", spec: "Psychiatry", loc: "loc_sample_sf", suffix: "MD" },
    { fn: "Kenji", ln: "Johnson", spec: "OB/GYN", loc: "loc_sample_sf", suffix: "MD" },
    { fn: "Elena", ln: "Williams", spec: "Dermatology", loc: "loc_sample_la", suffix: "MD" },
    { fn: "Olivia", ln: "Brown", spec: "Orthopedic Surgery", loc: "loc_sample_la", suffix: "MD" },
  ];

  const providers = seeds.map((s, i) => {
    const loc = locations.find((l) => l.id === s.loc)!;
    return {
      id: "p_sample_" + i,
      firstName: s.fn,
      lastName: s.ln,
      suffix: s.suffix,
      npi: String(1500000000 + i * 1097531).slice(0, 10),
      specialty: s.spec,
      email: (s.fn + "." + s.ln).toLowerCase() + "@sample.demo",
      phone: "(555) " + String(100 + i) + "-0" + String(100 + i * 7).slice(-3),
      licenseState: loc.state,
      licenseNumber: loc.state + "-" + String(100000 + i * 1337),
      licenseExpires: dateOnly(400 + i * 10),
      status: "active",
      dateAdded: dateOnly(-30 - i * 3),
      practiceId: loc.practiceId,
      locationId: s.loc,
      caqhId: String(10000000 + i * 1111111).slice(-8),
      documents: {
        medical_license: { status: "approved", expires: dateOnly(400 + i * 10) },
        dea: { status: i % 4 === 0 ? "expired" : "approved", expires: dateOnly(i % 4 === 0 ? -30 : 350) },
        malpractice: { status: "approved", expires: dateOnly(200 + i * 5) },
        board_cert: { status: "approved", expires: dateOnly(1200) },
        cv: { status: "approved" },
        w9: { status: "approved" },
        gov_id: { status: "approved", expires: dateOnly(900) },
      },
    };
  });

  const payerCodes = ["bcbs_tx", "aetna", "cigna", "uhc", "humana"];
  const enrollments = providers.flatMap((p, pi) =>
    payerCodes.map((payerCode, idx) => {
      const roll = (pi + idx) % 10;
      if (roll < 5) return { providerId: p.id, payerCode, status: "approved", submittedDate: dateOnly(-150 + idx * 10), effectiveDate: dateOnly(-100 + idx * 10) };
      if (roll < 7) return { providerId: p.id, payerCode, status: "submitted", submittedDate: dateOnly(-30) };
      if (roll < 8) return { providerId: p.id, payerCode, status: "in_progress" };
      if (roll < 9) return { providerId: p.id, payerCode, status: "needs_attention", submittedDate: dateOnly(-60) };
      return { providerId: p.id, payerCode, status: "draft" };
    })
  );

  const tasks = [
    { title: "Follow up on Dr. Kim's BCBS submission", description: "Submitted 30 days ago, no response yet", status: "open", priority: "high", dueDate: dateOnly(2), providerId: "p_sample_0" },
    { title: "Collect Dr. Chen DEA renewal", description: "DEA expired", status: "in_progress", priority: "high", dueDate: dateOnly(-2), providerId: "p_sample_1" },
    { title: "Verify malpractice COI for Dr. Nguyen", description: "Quarterly check", status: "open", priority: "medium", dueDate: dateOnly(14), providerId: "p_sample_2" },
    { title: "Submit UHC roster for Pacific CA", description: "Monthly roster update", status: "done", priority: "medium", dueDate: dateOnly(-5) },
  ];

  return {
    exportedAt: now.toISOString(),
    version: "zmart-v2-sample",
    description:
      "Self-consistent sample dataset: 3 practices, 5 locations, 8 providers, 40 enrollments, 4 tasks. All linked properly across practice -> location -> provider.",
    data: { orgName: "Sample Credentialing Co.", practices, locations, providers, enrollments, tasks },
  };
}
