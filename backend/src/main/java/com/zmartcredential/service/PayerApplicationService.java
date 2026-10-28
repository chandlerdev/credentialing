package com.zmartcredential.service;

import com.zmartcredential.dto.enrollment.EnrollmentRequest;
import com.zmartcredential.dto.payer.FormMappingResponse;
import com.zmartcredential.dto.payer.PayerApplicationRequest;
import com.zmartcredential.dto.payer.PayerApplicationResponse;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.Location;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.entity.PayerForm;
import com.zmartcredential.entity.PayerFormField;
import com.zmartcredential.entity.Practice;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.LocationRepository;
import com.zmartcredential.repository.PayerFormFieldRepository;
import com.zmartcredential.repository.PayerFormRepository;
import com.zmartcredential.repository.PracticeRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanWrapper;
import org.springframework.beans.BeanWrapperImpl;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Payer application wizard (bulk draft enrollments) and form field mapping. */
@Service
@RequiredArgsConstructor
public class PayerApplicationService {

    private static final Set<String> HIDDEN_PROPERTIES = Set.of("class", "orgId", "clientId", "practiceId", "locationId",
            "testData", "selfSignup", "createdAt", "updatedAt", "caqhUsername");

    private final EnrollmentService enrollmentService;
    private final EnrollmentSupport support;
    private final PayerFormRepository formRepository;
    private final PayerFormFieldRepository fieldRepository;
    private final PracticeRepository practiceRepository;
    private final LocationRepository locationRepository;
    private final AuthContext authContext;
    private final PermissionService permissionService;

    @Transactional
    public PayerApplicationResponse start(PayerApplicationRequest req) {
        permissionService.require("enrollment", "create");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        Payer payer = support.payer(req.payerId());
        if (!Boolean.TRUE.equals(payer.getActive())) throw new BadRequestException(payer.getName() + " is inactive");
        if (req.formId() != null) {
            PayerForm form = formRepository.findById(req.formId()).orElseThrow(() -> NotFoundException.of("Form", req.formId()));
            if (!form.getPayerId().equals(payer.getId())) {
                throw new BadRequestException("The selected form does not belong to " + payer.getName());
            }
        }
        List<Enrollment> created = new ArrayList<>();
        List<PayerApplicationResponse.Skipped> skipped = new ArrayList<>();
        for (Long providerId : new LinkedHashSet<>(req.providerIds())) {
            Provider provider = support.provider(providerId, orgId);
            if ("initial".equals(req.applicationType())) {
                var existing = enrollmentService.findOpenInitial(orgId, providerId, payer.getId(), null);
                if (existing.isPresent()) {
                    skipped.add(new PayerApplicationResponse.Skipped(providerId, EnrollmentSupport.fullName(provider),
                            existing.get().getId(), "Already has an open enrollment with " + payer.getName()));
                    continue;
                }
            }
            EnrollmentRequest er = new EnrollmentRequest(providerId, payer.getId(), "draft", req.applicationType(),
                    null, req.formId(), null, null, null, null, null, null, null);
            created.add(enrollmentService.createEntity(er, false,
                    typeLabel(req.applicationType()) + " application started for " + payer.getName()));
        }
        return new PayerApplicationResponse(
                enrollmentService.toResponses(created, enrollmentService.context(orgId)), skipped);
    }

    @Transactional(readOnly = true)
    public FormMappingResponse mappingForEnrollment(Long enrollmentId) {
        Enrollment e = enrollmentService.loadReadable(enrollmentId);
        Provider provider = support.provider(e.getProviderId(), e.getOrgId());
        Payer payer = support.payer(e.getPayerId());
        PayerForm form = e.getFormId() == null ? null : formRepository.findById(e.getFormId()).orElse(null);
        Long practiceId = e.getPracticeId() != null ? e.getPracticeId() : provider.getPracticeId();
        return build(e.getId(), e.getApplicationType(), payer, form, provider, practiceId);
    }

    @Transactional(readOnly = true)
    public FormMappingResponse mappingForPayer(Long payerId, Long formId, Long providerId) {
        permissionService.require("enrollment", "read");
        if (providerId == null) throw new BadRequestException("providerId is required");
        Long orgId = authContext.orgId();
        authContext.requireProviderAccess(providerId);
        Provider provider = support.provider(providerId, orgId);
        PayerForm form = null;
        if (formId != null) {
            form = formRepository.findById(formId).orElseThrow(() -> NotFoundException.of("Form", formId));
            if (payerId == null) payerId = form.getPayerId();
            else if (!form.getPayerId().equals(payerId)) throw new BadRequestException("The form does not belong to this payer");
        }
        if (payerId == null) throw new BadRequestException("payerId is required");
        Payer payer = support.payer(payerId);
        return build(null, null, payer, form, provider, provider.getPracticeId());
    }

    private FormMappingResponse build(Long enrollmentId, String appType, Payer payer, PayerForm form, Provider provider, Long practiceId) {
        Long orgId = provider.getOrgId();
        Practice practice = practiceId == null ? null : practiceRepository.findByIdAndOrgId(practiceId, orgId).orElse(null);
        Location location = resolveLocation(provider, practice, orgId);

        List<PayerFormField> fields = form == null ? List.of() : fieldRepository.findByFormIdOrderBySortOrderAsc(form.getId());
        boolean usesDefault = fields.isEmpty();
        if (usesDefault) fields = fieldRepository.findByFormIdIsNullOrderBySortOrderAsc();

        Map<String, List<FormMappingResponse.Field>> sections = new LinkedHashMap<>();
        int high = 0, medium = 0, low = 0;
        for (PayerFormField f : fields) {
            String value = resolve(f.getMapsTo(), provider, practice, location);
            String configured = f.getConfidence() == null ? "high" : f.getConfidence();
            String confidence = value == null ? "low" : configured;
            switch (confidence) {
                case "high" -> high++;
                case "medium" -> medium++;
                default -> low++;
            }
            sections.computeIfAbsent(f.getSectionName(), k -> new ArrayList<>())
                    .add(new FormMappingResponse.Field(f.getId(), f.getLabel(), value, confidence, configured, f.getMapsTo()));
        }
        List<FormMappingResponse.Section> sectionList = sections.entrySet().stream().map(en -> {
            int filled = (int) en.getValue().stream().filter(x -> x.value() != null).count();
            int total = en.getValue().size();
            return new FormMappingResponse.Section(en.getKey(), filled + "/" + total, filled, total, en.getValue());
        }).toList();
        int total = fields.size();
        int pct = total == 0 ? 0 : (int) Math.round((high + medium) * 100.0 / total);

        FormMappingResponse.Form formDto = form != null
                ? new FormMappingResponse.Form(form.getId(), form.getCode(), form.getLabel(), form.getDescription(), usesDefault)
                : new FormMappingResponse.Form(null, "default",
                payer.getAppForm() != null ? payer.getAppForm() : "Standard Application", null, true);
        return new FormMappingResponse(enrollmentId, appType,
                new FormMappingResponse.Payer(payer.getId(), payer.getCode(), payer.getName(), payer.getFullName(), payer.getColor()),
                formDto,
                new FormMappingResponse.Provider(provider.getId(), EnrollmentSupport.fullName(provider), provider.getNpi(),
                        provider.getSpecialty(), provider.getCaqhId()),
                practice == null ? null : new FormMappingResponse.Ref(practice.getId(), practice.getName()),
                location == null ? null : new FormMappingResponse.Ref(location.getId(), location.getName()),
                sectionList, new FormMappingResponse.Stats(total, high, medium, low, pct), LocalDateTime.now());
    }

    private Location resolveLocation(Provider provider, Practice practice, Long orgId) {
        if (provider.getLocationId() != null) {
            Location l = locationRepository.findByIdAndOrgId(provider.getLocationId(), orgId).orElse(null);
            if (l != null) return l;
        }
        if (practice != null) {
            return locationRepository.findByPracticeId(practice.getId()).stream()
                    .filter(l -> !Boolean.FALSE.equals(l.getActive()))
                    .sorted((a, b) -> Boolean.compare(!"Primary".equals(a.getLocationType()), !"Primary".equals(b.getLocationType())))
                    .findFirst().orElse(null);
        }
        return null;
    }

    /** Resolves a maps_to path such as provider.npi, provider.fullName, practice.taxId, location.cityStateZip. */
    static String resolve(String path, Provider provider, Practice practice, Location location) {
        if (path == null || !path.contains(".")) return null;
        String root = path.substring(0, path.indexOf('.'));
        String prop = path.substring(path.indexOf('.') + 1);
        Object bean = switch (root) {
            case "provider" -> provider;
            case "practice" -> practice;
            case "location" -> location;
            default -> null;
        };
        if (bean == null) return null;
        if (bean instanceof Provider p && ("fullName".equals(prop) || "name".equals(prop))) return EnrollmentSupport.fullName(p);
        if (bean instanceof Location l && "cityStateZip".equals(prop)) {
            String cs = join(", ", l.getCity(), l.getState());
            String v = join(" ", cs, l.getZip());
            return v == null || v.isBlank() ? null : v;
        }
        if (HIDDEN_PROPERTIES.contains(prop)) return null;
        BeanWrapper bw = new BeanWrapperImpl(bean);
        if (!bw.isReadableProperty(prop)) return null;
        Object v = bw.getPropertyValue(prop);
        if (v == null) return null;
        String s = v.toString();
        return s.isBlank() ? null : s;
    }

    private static String join(String sep, String a, String b) {
        boolean ha = a != null && !a.isBlank();
        boolean hb = b != null && !b.isBlank();
        if (ha && hb) return a + sep + b;
        if (ha) return a;
        if (hb) return b;
        return null;
    }

    private static String typeLabel(String t) {
        return switch (t) {
            case "recred" -> "Re-credentialing";
            case "update" -> "Demographic update";
            case "terminate" -> "Termination";
            default -> "Initial enrollment";
        };
    }
}
