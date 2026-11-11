package com.zmartcredential.service;

import com.zmartcredential.dto.organization.LocationRequest;
import com.zmartcredential.dto.organization.LocationResponse;
import com.zmartcredential.dto.organization.OrgStructureDtos.DeleteResult;
import com.zmartcredential.entity.Location;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.LocationRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Practice locations (LocationsCrudView / Edit Location modal). Permission entity: location. */
@Service
@RequiredArgsConstructor
public class OrgLocationService {

    private final LocationRepository locationRepository;
    private final PracticeRepository practiceRepository;
    private final ProviderRepository providerRepository;
    private final AuthContext authContext;
    private final PermissionService permissionService;

    @Transactional(readOnly = true)
    public List<LocationResponse> list(String q, Boolean active, Long practiceId) {
        authContext.requireStaff();
        permissionService.require("location", "list");
        Long orgId = authContext.orgId();
        String needle = q == null || q.isBlank() ? null : q.trim().toLowerCase(Locale.ROOT);
        List<Location> rows = locationRepository.findByOrgIdOrderByNameAsc(orgId).stream()
                .filter(l -> active == null || active.equals(Boolean.TRUE.equals(l.getActive())))
                .filter(l -> practiceId == null || practiceId.equals(l.getPracticeId()))
                .filter(l -> needle == null || matches(l, needle))
                .toList();
        return toResponses(orgId, rows);
    }

    @Transactional(readOnly = true)
    public LocationResponse get(Long id) {
        authContext.requireStaff();
        permissionService.require("location", "read");
        Long orgId = authContext.orgId();
        return toResponses(orgId, List.of(load(orgId, id))).getFirst();
    }

    @Transactional
    public LocationResponse create(LocationRequest req) {
        authContext.requireStaff();
        permissionService.require("location", "create");
        Long orgId = authContext.orgId();
        Location l = new Location();
        l.setOrgId(orgId);
        apply(orgId, l, req);
        l = locationRepository.save(l);
        return toResponses(orgId, List.of(l)).getFirst();
    }

    @Transactional
    public LocationResponse update(Long id, LocationRequest req) {
        authContext.requireStaff();
        permissionService.require("location", "update");
        Long orgId = authContext.orgId();
        Location l = load(orgId, id);
        apply(orgId, l, req);
        l = locationRepository.save(l);
        return toResponses(orgId, List.of(l)).getFirst();
    }

    @Transactional
    public DeleteResult delete(Long id) {
        authContext.requireStaff();
        permissionService.require("location", "delete");
        Long orgId = authContext.orgId();
        Location l = load(orgId, id);
        int unassigned = providerRepository.orgUnassignLocation(orgId, l.getId());
        locationRepository.deleteById(l.getId());
        return new DeleteResult(true, unassigned, 0);
    }

    Location load(Long orgId, Long id) {
        return locationRepository.findByIdAndOrgId(id, orgId).orElseThrow(() -> NotFoundException.of("Location", id));
    }

    private void apply(Long orgId, Location l, LocationRequest req) {
        if (req.practiceId() != null) {
            practiceRepository.findByIdAndOrgId(req.practiceId(), orgId)
                    .orElseThrow(() -> new BadRequestException("Selected practice does not exist"));
        }
        l.setPracticeId(req.practiceId());
        l.setName(req.name().trim());
        l.setLegalName(blankToNull(req.legalName()));
        l.setNpi(blankToNull(req.npi()));
        l.setLocationType(blankToNull(req.locationType()) == null ? "Primary" : req.locationType());
        l.setAddress(blankToNull(req.address()));
        l.setCity(blankToNull(req.city()));
        l.setState(blankToNull(req.state()));
        l.setZip(blankToNull(req.zip()));
        l.setPhone(blankToNull(req.phone()));
        l.setLat(req.lat());
        l.setLng(req.lng());
        l.setActive(req.active() == null || req.active());
    }

    /** Maps locations to DTOs with practice names and computed provider counts. */
    public List<LocationResponse> toResponses(Long orgId, List<Location> rows) {
        Map<Long, Long> counts = countMap(providerRepository.orgCountByLocation(orgId));
        Map<Long, Practice> practices = practiceRepository.findByOrgId(orgId).stream()
                .collect(Collectors.toMap(Practice::getId, Function.identity()));
        return rows.stream().map(l -> {
            Practice p = l.getPracticeId() == null ? null : practices.get(l.getPracticeId());
            return new LocationResponse(l.getId(), l.getPracticeId(), p == null ? null : p.getName(),
                    l.getName(), l.getLegalName(),
                    l.getNpi(), l.getLocationType(), l.getAddress(), l.getCity(), l.getState(), l.getZip(),
                    l.getPhone(), l.getLat(), l.getLng(), Boolean.TRUE.equals(l.getActive()),
                    Boolean.TRUE.equals(l.getTestData()), counts.getOrDefault(l.getId(), 0L), l.getCreatedAt(),
                    l.getUpdatedAt());
        }).toList();
    }

    static Map<Long, Long> countMap(List<Object[]> rows) {
        Map<Long, Long> m = new HashMap<>();
        for (Object[] r : rows) m.put(((Number) r[0]).longValue(), ((Number) r[1]).longValue());
        return m;
    }

    private static boolean matches(Location l, String needle) {
        return com.zmartcredential.util.SearchText.matches(needle, l.getName(), l.getLegalName(), l.getCity(), l.getState(), l.getAddress(), l.getNpi(), l.getZip());
    }

    private static boolean contains(String v, String needle) {
        return v != null && v.toLowerCase(Locale.ROOT).contains(needle);
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
