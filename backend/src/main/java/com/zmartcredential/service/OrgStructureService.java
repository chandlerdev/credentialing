package com.zmartcredential.service;

import com.zmartcredential.dto.organization.LocationResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.DeleteResult;
import com.zmartcredential.dto.organization.OrgStructureDtos.InviteCodeResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.OrgTreeResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.PracticeNode;
import com.zmartcredential.dto.organization.OrgStructureDtos.PracticeRequest;
import com.zmartcredential.dto.organization.OrgStructureDtos.PracticeResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.Totals;
import com.zmartcredential.dto.organization.OrganizationResponse;
import com.zmartcredential.dto.organization.OrganizationUpdateRequest;
import com.zmartcredential.entity.Location;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.LocationRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import com.zmartcredential.security.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import static com.zmartcredential.service.OrgLocationService.blankToNull;
import static com.zmartcredential.service.OrgLocationService.countMap;

/** Organization view: tenant org, its practices and locations (the org tree). Permission entity: location. */
@Service
@RequiredArgsConstructor
public class OrgStructureService {

    private final OrganizationRepository organizationRepository;
    private final OrgNames orgNames;
    private final SoftDeleteCascade softDeleteCascade;
    private final EmailRegistry emailRegistry;
    private final PracticeRepository practiceRepository;
    private final LocationRepository locationRepository;
    private final ProviderRepository providerRepository;
    private final OrgLocationService locationService;
    private final CryptoService cryptoService;
    private final AuthContext authContext;
    private final PermissionService permissionService;

    // ---------- tree ----------

    @Transactional(readOnly = true)
    public OrgTreeResponse tree(String q) {
        authContext.requireStaff();
        permissionService.require("location", "read");
        Long orgId = authContext.orgId();
        Organization org = loadOrg(orgId);
        String needle = q == null || q.isBlank() ? null : q.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);

        List<Practice> practices = practiceRepository.findByOrgIdOrderByNameAsc(orgId);
        List<LocationResponse> locations = locationService.toResponses(orgId,
                locationRepository.findByOrgIdOrderByNameAsc(orgId));
        Map<Long, Long> practiceCounts = countMap(providerRepository.orgCountByPractice(orgId));

        Map<Long, List<LocationResponse>> locByPractice = locations.stream().filter(l -> l.practiceId() != null)
                .collect(Collectors.groupingBy(LocationResponse::practiceId));

        // the organization's practices, each with its locations (no client level)
        List<PracticeNode> pNodes = new ArrayList<>();
        for (Practice p : practices) {
            List<LocationResponse> pLocs = locByPractice.getOrDefault(p.getId(), List.of());
            boolean practiceMatch = needle == null || has(p.getName(), needle) || has(p.getTaxId(), needle);
            List<LocationResponse> shown = practiceMatch ? pLocs
                    : pLocs.stream().filter(l -> locMatch(l, needle)).toList();
            if (!practiceMatch && shown.isEmpty()) continue;
            pNodes.add(new PracticeNode(p.getId(), p.getName(), p.getTaxId(), p.getAddress(),
                    p.getPhone(), p.getEmail(), pLocs.size(), practiceCounts.getOrDefault(p.getId(), 0L), shown));
        }
        List<LocationResponse> unassigned = locations.stream()
                .filter(l -> l.practiceId() == null && (needle == null || locMatch(l, needle))).toList();

        long totalProviders = providerRepository.countByOrgId(orgId);
        long assigned = providerRepository.findByOrgId(orgId).stream()
                .filter(p -> p.getLocationId() != null || p.getPracticeId() != null).count();
        Totals totals = new Totals(practices.size(), locations.size(), totalProviders, totalProviders - assigned);
        return new OrgTreeResponse(OrganizationResponse.of(org), pNodes, unassigned, totals);
    }

    // ---------- organization ----------

    @Transactional(readOnly = true)
    public OrganizationResponse getOrganization() {
        authContext.requireStaff();
        return OrganizationResponse.of(loadOrg(authContext.orgId()));
    }

    @Transactional
    public OrganizationResponse updateOrganization(OrganizationUpdateRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        Organization o = loadOrg(authContext.orgId());
        // a renamed organization must not take another organization's name
        if (!OrgNames.normalize(req.name()).equals(OrgNames.normalize(o.getName()))) orgNames.requireFree(req.name(), o.getId(), "name");
        o.setName(req.name().trim());
        if (req.orgType() != null) o.setOrgType(blankToNull(req.orgType()));
        o.setTaxId(blankToNull(req.taxId()));
        o.setWebsite(blankToNull(req.website()));
        o.setAddress(blankToNull(req.address()));
        o.setCity(blankToNull(req.city()));
        o.setState(blankToNull(req.state()));
        o.setZip(blankToNull(req.zip()));
        o.setPhone(blankToNull(req.phone()));
        emailRegistry.requireFreeForOrganization(req.email(), o.getId());
        o.setEmail(req.email() == null || req.email().isBlank() ? null : req.email().trim().toLowerCase(Locale.ROOT));
        return OrganizationResponse.of(organizationRepository.save(o));
    }

    @Transactional
    public InviteCodeResponse inviteCode() {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        Organization o = loadOrg(authContext.orgId());
        if (o.getInviteCode() == null) {
            o.setInviteCode(newInviteCode());
            organizationRepository.save(o);
        }
        return new InviteCodeResponse(o.getInviteCode());
    }

    @Transactional
    public InviteCodeResponse regenerateInviteCode() {
        authContext.requireRole(Role.PLATFORM_ADMIN, Role.ORG_ADMIN);
        Organization o = loadOrg(authContext.orgId());
        o.setInviteCode(newInviteCode());
        organizationRepository.save(o);
        return new InviteCodeResponse(o.getInviteCode());
    }

    public String newInviteCode() {
        String code;
        do {
            code = "ZMARTC-" + cryptoService.randomToken(3).toUpperCase(Locale.ROOT);
        } while (organizationRepository.existsByInviteCode(code));
        return code;
    }

    // ---------- practices ----------

    @Transactional(readOnly = true)
    public List<PracticeResponse> listPractices() {
        authContext.requireStaff();
        permissionService.require("location", "list");
        Long orgId = authContext.orgId();
        return practiceRepository.findByOrgIdOrderByNameAsc(orgId).stream().map(p -> toPractice(orgId, p)).toList();
    }

    /** A practice belongs directly to the organization. */
    @Transactional
    public PracticeResponse createPractice(PracticeRequest req) {
        requireWrite("create");
        Long orgId = authContext.orgId();
        Practice p = new Practice();
        p.setOrgId(orgId);
        applyPractice(p, req);
        return toPractice(orgId, practiceRepository.save(p));
    }

    @Transactional
    public PracticeResponse updatePractice(Long id, PracticeRequest req) {
        requireWrite("update");
        Long orgId = authContext.orgId();
        Practice p = loadPractice(orgId, id);
        applyPractice(p, req);
        return toPractice(orgId, practiceRepository.save(p));
    }

    @Transactional
    public DeleteResult deletePractice(Long id) {
        requireWrite("delete");
        Long orgId = authContext.orgId();
        Practice p = loadPractice(orgId, id);
        int detached = detachLocations(p.getId());
        int unassigned = providerRepository.orgUnassignPractice(orgId, p.getId());
        softDeleteCascade.practice(p.getId());
        practiceRepository.deleteById(p.getId());
        return new DeleteResult(true, unassigned, detached);
    }

    // ---------- helpers ----------

    private int detachLocations(Long practiceId) {
        List<Location> locs = locationRepository.findByPracticeId(practiceId);
        for (Location l : locs) l.setPracticeId(null);
        locationRepository.saveAll(locs);
        return locs.size();
    }

    private void applyPractice(Practice p, PracticeRequest req) {
        p.setName(req.name().trim());
        p.setTaxId(blankToNull(req.taxId()));
        p.setAddress(blankToNull(req.address()));
        p.setPhone(blankToNull(req.phone()));
        p.setEmail(req.email() == null || req.email().isBlank() ? null : req.email().trim().toLowerCase(Locale.ROOT));
    }

    private PracticeResponse toPractice(Long orgId, Practice p) {
        long providers = providerRepository.countByOrgIdAndPracticeId(orgId, p.getId());
        int locs = p.getId() == null ? 0 : locationRepository.findByPracticeId(p.getId()).size();
        return new PracticeResponse(p.getId(), p.getName(), p.getTaxId(), p.getAddress(), p.getPhone(), p.getEmail(),
                locs, providers);
    }

    private void requireWrite(String action) {
        authContext.requireStaff();
        permissionService.require("location", action);
    }

    private Organization loadOrg(Long orgId) {
        return organizationRepository.findById(orgId).orElseThrow(() -> NotFoundException.of("Organization", orgId));
    }

    private Practice loadPractice(Long orgId, Long id) {
        return practiceRepository.findByIdAndOrgId(id, orgId).orElseThrow(() -> NotFoundException.of("Practice", id));
    }

    private static boolean locMatch(LocationResponse l, String needle) {
        return has(l.name(), needle) || has(l.legalName(), needle) || has(l.city(), needle)
                || has(l.address(), needle) || has(l.npi(), needle);
    }

    private static boolean has(String v, String needle) {
        return needle == null || com.zmartcredential.util.SearchText.matches(needle, v);
    }
}
