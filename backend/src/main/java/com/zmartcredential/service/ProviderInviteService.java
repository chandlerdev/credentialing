package com.zmartcredential.service;

import com.zmartcredential.dto.provider.ProviderInviteDtos.DocumentRequestBody;
import com.zmartcredential.dto.provider.ProviderInviteDtos.ProviderInviteNewRequest;
import com.zmartcredential.dto.provider.ProviderInviteDtos.ProviderInviteRequest;
import com.zmartcredential.dto.provider.ProviderInviteDtos.ProviderInviteResponse;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicInviteInfo;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicLinkStatus;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicProfile;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicProfileRequest;
import com.zmartcredential.dto.provider.ProviderInviteDtos.SecureLinkItem;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicMissingDocument;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicUploadResult;
import com.zmartcredential.dto.provider.ProviderInviteDtos.PublicUploadedFile;
import com.zmartcredential.dto.provider.ProviderDocumentDtos.ProviderDocumentRow;
import com.zmartcredential.entity.DocumentType;
import com.zmartcredential.entity.EmailLog;
import com.zmartcredential.entity.EmailTemplate;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.entity.ProviderDocument;
import com.zmartcredential.entity.ProviderInvite;
import com.zmartcredential.exception.ApiException;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ConflictException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.EmailLogRepository;
import com.zmartcredential.repository.EmailTemplateRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.ProviderInviteRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static com.zmartcredential.service.ProviderModuleSupport.blankToNull;
import static com.zmartcredential.service.ProviderModuleSupport.fullName;

/** "Send Link to Provider": secure upload invites (token + 6-digit PIN), emailed through MailService. */
@Service
@RequiredArgsConstructor
public class ProviderInviteService {

    private static final DateTimeFormatter EXPIRY_FMT = DateTimeFormatter.ofPattern("MMMM d, yyyy");

    private final ProviderInviteRepository inviteRepository;
    private final EmailRegistry emailRegistry;
    private final ProviderRepository providerRepository;
    private final EmailTemplateRepository templateRepository;
    private final EmailLogRepository emailLogRepository;
    private final OrganizationRepository organizationRepository;
    private final ProviderDocumentInitializer documentInitializer;
    private final ProviderDocumentService documentService;
    private final NotificationService notificationService;
    private final PermissionService permissionService;
    private final ProviderModuleSupport support;
    private final ProviderService providerService;
    private final com.zmartcredential.repository.AppUserRepository userRepository;
    private final OrgUserService orgUserService;
    private final MailTemplateService mailTemplateService;
    private final MailService mailService;
    private final CryptoService cryptoService;
    private final SecureLinkIssuer linkIssuer;
    private final ProviderExtraMapper extraMapper;
    private final AuthContext authContext;
    private final com.zmartcredential.repository.ClientRepository clientRepository;
    private final com.zmartcredential.repository.PracticeRepository practiceRepository;
    private final com.zmartcredential.repository.LocationRepository locationRepository;

    @Transactional
    public ProviderInviteResponse invite(Long providerId, ProviderInviteRequest req) {
        permissionService.require("provider", "update");
        Provider provider = support.loadForStaff(providerId);
        if (req.clientId() != null || req.practiceId() != null || req.locationId() != null) {
            ProviderService.Hierarchy h = providerService.resolveHierarchy(provider.getOrgId(), req.clientId(),
                    req.practiceId(), req.locationId());
            provider.setClientId(h.clientId());
            provider.setPracticeId(h.practiceId());
            provider.setLocationId(h.locationId());
        }
        return createInvite(provider, req.email().trim().toLowerCase());
    }

    @Transactional
    public ProviderInviteResponse inviteNew(ProviderInviteNewRequest req) {
        permissionService.require("provider", "create");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        emailRegistry.requireFreeForProvider(req.email(), null);
        ProviderService.Hierarchy h = providerService.resolveHierarchy(orgId, req.clientId(), req.practiceId(), req.locationId());
        Provider p = new Provider();
        p.setOrgId(orgId);
        p.setFirstName(req.firstName().trim());
        p.setLastName(req.lastName().trim());
        p.setEmail(req.email().trim().toLowerCase());
        p.setCaqhId(blankToNull(req.caqhId()));
        p.setClientId(h.clientId());
        p.setPracticeId(h.practiceId());
        p.setLocationId(h.locationId());
        p.setStatus("draft");
        p.setSource("invite");
        p.setDateAdded(LocalDate.now());
        p = providerRepository.save(p);
        documentInitializer.initialize(p);
        return createInvite(p, p.getEmail());
    }

    private ProviderInviteResponse createInvite(Provider provider, String email) {
        // the link goes to this provider: the address must not belong to anybody else
        emailRegistry.requireFreeForProvider(email, provider.getId());
        if (provider.getEmail() == null) provider.setEmail(email);
        ProviderInvite inv = linkIssuer.issue(provider, email, authContext.userId());
        List<ProviderDocumentRow> missing = support.documentRows(provider).stream()
                .filter(r -> "missing".equals(r.status()) || "expired".equals(r.status())).toList();
        return sendLinkEmail(provider, inv, email, MailTemplateService.PROVIDER_LINK, null, missing);
    }

    /** Emails a secure link (Send Link / Request Documents) with the organization's template of that type. */
    private ProviderInviteResponse sendLinkEmail(Provider provider, ProviderInvite inv, String email, String type,
                                                 Long templateId, List<ProviderDocumentRow> docs) {
        Long orgId = provider.getOrgId();
        String uploadUrl = SecureLinkIssuer.uploadPath(inv);
        Organization org = organizationRepository.findById(orgId).orElse(null);
        String docList = docs.isEmpty() ? "(none)" : String.join("\n", docs.stream().map(r -> "- " + r.label()).toList());
        Map<String, String> vars = new java.util.HashMap<>();
        vars.put("provider_first_name", provider.getFirstName());
        vars.put("provider_last_name", provider.getLastName());
        vars.put("provider_name", fullName(provider));
        vars.put("pending_document_count", String.valueOf(docs.size()));
        vars.put("missing_document_list", docList);
        vars.put("requested_document_list", docList);
        vars.put("pin", inv.getPin());
        // emails need the full address; the API response keeps the relative path for the admin app
        vars.put("upload_link", mailService.publicUrl() + uploadUrl);
        vars.put("link_expires", inv.getExpiresAt().format(EXPIRY_FMT));
        vars.put("organization_name", org == null ? "" : org.getName());
        // the chosen template (when it belongs to this type and organization), else the one in use
        EmailTemplate tpl = null;
        if (templateId != null) {
            tpl = mailTemplateService.visible(orgId, type).stream().filter(t -> t.getId().equals(templateId)).findFirst()
                    .orElseThrow(() -> BadRequestException.onField("templateId", "Choose one of the listed templates"));
        }
        if (tpl == null) tpl = mailTemplateService.resolve(orgId, type).orElse(null);
        boolean docRequest = MailTemplateService.DOCUMENT_REQUEST.equals(type);
        String subject = tpl == null
                ? (docRequest ? "Documents needed for your credentialing" : "Please complete your credentialing profile")
                : MailTemplateService.render(tpl.getSubject(), vars);
        String body = tpl == null || tpl.getBody() == null
                ? "Hi " + provider.getFirstName() + ",\n\n"
                  + (docRequest ? "Please upload these documents:\n" + docList : "Please complete your credentialing profile and upload your documents.")
                  + "\n\nSecure Access PIN: " + inv.getPin() + "\n\nOpen your secure link: " + vars.get("upload_link")
                  + "\n\nLink expires: " + vars.get("link_expires")
                : MailTemplateService.render(tpl.getBody(), vars);
        // the provider can't open the link without these: added when a template leaves them out
        if (!body.contains(vars.get("upload_link"))) body += "\n\nOpen your secure link: " + vars.get("upload_link");
        if (!body.contains(inv.getPin())) body += "\nSecure access PIN: " + inv.getPin();

        MailService.Result mail = mailService.send(email, subject, body);
        EmailLog log = new EmailLog();
        log.setOrgId(orgId);
        log.setProviderId(provider.getId());
        log.setToEmail(email);
        log.setSubject(subject.length() > 255 ? subject.substring(0, 255) : subject);
        log.setStatus(mail.status());
        emailLogRepository.save(log);

        String how = switch (mail.status()) {
            case "sent" -> " emailed to ";
            case "failed" -> " could not be emailed to ";
            default -> " queued to ";
        };
        notificationService.notifyOrg(orgId, docRequest ? "Documents requested" : "Secure link sent",
                (docRequest ? "Document request for " : "Upload link for ") + fullName(provider) + how + email + ".", "Send",
                mail.sent() || "queued".equals(mail.status()) ? NotificationService.INFO : NotificationService.WARN);
        return new ProviderInviteResponse(inv.getId(), provider.getId(), fullName(provider), email, inv.getPin(),
                inv.getExpiresAt(), uploadUrl, mail.status(), mail.error());
    }

    // ---------- Request Documents / Resend ----------

    /** Provider page → Request Documents: a link that asks only for the chosen missing / expired documents. */
    @Transactional
    public ProviderInviteResponse requestDocuments(Long providerId, DocumentRequestBody req) {
        permissionService.require("provider", "update");
        authContext.requireStaff();
        Provider provider = support.loadForStaff(providerId);
        if (isDraftInvitee(provider)) {
            throw new ConflictException(fullName(provider) + " hasn't completed their profile yet. Resend the invitation instead.");
        }
        if (blankToNull(provider.getEmail()) == null) throw new BadRequestException("Add the provider's email first");
        List<ProviderDocumentRow> open = support.documentRows(provider).stream()
                .filter(r -> "missing".equals(r.status()) || "expired".equals(r.status())).toList();
        java.util.Set<String> wanted = new java.util.LinkedHashSet<>(req.docTypes());
        List<ProviderDocumentRow> chosen = open.stream().filter(r -> wanted.contains(r.docType())).toList();
        if (chosen.size() != wanted.size()) {
            throw BadRequestException.onField("docTypes", "Choose only documents that are missing or expired");
        }
        ProviderInvite inv = linkIssuer.issue(provider, provider.getEmail(), authContext.userId(), "documents",
                chosen.stream().map(ProviderDocumentRow::docType).toList());
        return sendLinkEmail(provider, inv, provider.getEmail(), MailTemplateService.DOCUMENT_REQUEST, req.templateId(), chosen);
    }

    /** Secure Links → Resend: a new link + PIN for the same purpose; the earlier links stop working. */
    @Transactional
    public ProviderInviteResponse resend(Long inviteId) {
        permissionService.require("provider", "update");
        authContext.requireStaff();
        ProviderInvite inv = inviteRepository.findByIdAndOrgId(inviteId, authContext.orgId())
                .orElseThrow(() -> new NotFoundException("Secure link not found"));
        return resendFor(support.loadForStaff(inv.getProviderId()), inv);
    }

    /** Provider page → Resend Invitation: resends the provider's latest link. */
    @Transactional
    public ProviderInviteResponse resendForProvider(Long providerId) {
        permissionService.require("provider", "update");
        authContext.requireStaff();
        Provider provider = support.loadForStaff(providerId);
        ProviderInvite last = inviteRepository.findByProviderIdOrderByCreatedAtDesc(providerId).stream().findFirst()
                .orElseThrow(() -> new BadRequestException("No invitation was sent to this provider yet"));
        return resendFor(provider, last);
    }

    private ProviderInviteResponse resendFor(Provider provider, ProviderInvite last) {
        if ("documents".equals(last.getPurpose())) {
            java.util.Set<String> requested = requestedTypes(last);
            List<ProviderDocumentRow> still = support.documentRows(provider).stream()
                    .filter(r -> requested.contains(r.docType()))
                    .filter(r -> "missing".equals(r.status()) || "expired".equals(r.status())).toList();
            if (still.isEmpty()) {
                throw new ConflictException(fullName(provider) + " has already submitted all the requested documents. No email was sent.");
            }
            ProviderInvite inv = linkIssuer.issue(provider, last.getEmail(), authContext.userId(), "documents",
                    still.stream().map(ProviderDocumentRow::docType).toList());
            return sendLinkEmail(provider, inv, last.getEmail(), MailTemplateService.DOCUMENT_REQUEST, null, still);
        }
        // the invitation: only while the provider hasn't completed their profile
        if (!isDraftInvitee(provider)) {
            throw new ConflictException(fullName(provider) + " already has an account (user ID and password). No email was sent.");
        }
        return createInvite(provider, last.getEmail());
    }

    /**
     * Invited through Send Link and hasn't created their account yet: no sign-in (user ID + password). The status
     * doesn't matter. Providers added manually have their sign-in from the start.
     */
    private boolean isDraftInvitee(Provider p) {
        if (userRepository.findByProviderId(p.getId()).isPresent()) return false;
        return inviteRepository.findByProviderIdOrderByCreatedAtDesc(p.getId()).stream()
                .anyMatch(i -> !"documents".equals(i.getPurpose()));
    }

    private static java.util.Set<String> requestedTypes(ProviderInvite inv) {
        if (inv.getRequestedDocTypes() == null || inv.getRequestedDocTypes().isBlank()) return java.util.Set.of();
        return new java.util.LinkedHashSet<>(java.util.Arrays.asList(inv.getRequestedDocTypes().split(",")));
    }

    /**
     * Secure link → Remove: takes back a file the provider uploaded through this link (wrong file); the document
     * goes back to Missing and its expiration date is cleared.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public List<PublicMissingDocument> removeUpload(String token, String pin, String docType) {
        ProviderInvite inv = checkInvite(token, pin);
        Provider provider = providerRepository.findById(inv.getProviderId())
                .orElseThrow(() -> new NotFoundException("This link is no longer valid"));
        ProviderDocument d = documentService.providerDocument(provider, docType)
                .orElseThrow(() -> new NotFoundException("Document not found"));
        boolean viaThisLink = d.getStorageKey() != null && d.getUploadedBy() == null && "pending_review".equals(d.getStatus())
                && d.getUploadedAt() != null && inv.getCreatedAt() != null && !d.getUploadedAt().isBefore(inv.getCreatedAt());
        if (!viaThisLink) throw new BadRequestException("Only a file you uploaded through this link can be removed");
        documentService.clearFile(d);
        return missing(provider);
    }

    /** Document request portal → Submit Documents: closes the link (the uploads wait for review). */
    @Transactional(noRollbackFor = ApiException.class)
    public PublicLinkStatus finishDocuments(String token, String pin) {
        ProviderInvite inv = checkInvite(token, pin);
        if (!"documents".equals(inv.getPurpose())) throw new BadRequestException("Submit your profile to finish");
        Provider provider = providerRepository.findById(inv.getProviderId())
                .orElseThrow(() -> new NotFoundException("This link is no longer valid"));
        inv.setStatus("submitted");
        inv.setSubmittedAt(LocalDateTime.now());
        notificationService.notifyOrg(provider.getOrgId(), "Requested documents submitted",
                fullName(provider) + " submitted the requested documents through a secure link.", "FileCheck", NotificationService.SUCCESS);
        return status(token);
    }

    private static String render(String text, Map<String, String> vars) {
        String out = text;
        for (Map.Entry<String, String> e : vars.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    // ---------- admin: Secure Links ----------

    @Transactional(readOnly = true)
    public List<SecureLinkItem> list() {
        permissionService.require("provider", "read");
        authContext.requireStaff();
        Long orgId = authContext.orgId();
        List<ProviderInvite> invites = inviteRepository.findByOrgId(orgId);
        Map<Long, Provider> providers = new java.util.HashMap<>();
        providerRepository.findAllById(invites.stream().map(ProviderInvite::getProviderId).distinct().toList())
                .forEach(p -> providers.put(p.getId(), p));
        LocalDateTime now = LocalDateTime.now();
        return invites.stream()
                .sorted(Comparator.comparing(ProviderInvite::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(inv -> {
                    Provider p = providers.get(inv.getProviderId());
                    return new SecureLinkItem(inv.getId(), inv.getProviderId(), p == null ? inv.getEmail() : fullName(p),
                            inv.getEmail(), inv.getPin(), linkStatus(inv, now), attempts(inv), maxAttempts(inv),
                            "/admin/upload/" + inv.getToken(), inv.getCreatedAt(), inv.getExpiresAt(), inv.getAccessedAt(),
                            inv.getSubmittedAt(), inv.getPurpose());
                })
                .toList();
    }

    @Transactional
    public void delete(Long id) {
        permissionService.require("provider", "update");
        authContext.requireStaff();
        ProviderInvite inv = inviteRepository.findByIdAndOrgId(id, authContext.orgId())
                .orElseThrow(() -> new NotFoundException("Secure link not found"));
        inviteRepository.delete(inv);
    }

    /** pending | accessed | submitted | expired | locked | replaced */
    private static String linkStatus(ProviderInvite inv, LocalDateTime now) {
        String s = inv.getStatus();
        if ("submitted".equals(s) || "completed".equals(s)) return "submitted";
        if ("revoked".equals(s)) return "replaced";
        if ("expired".equals(s) || inv.getExpiresAt().isBefore(now)) return "expired";
        if (attempts(inv) >= maxAttempts(inv)) return "locked";
        return "opened".equals(s) ? "accessed" : "pending";
    }

    private static int attempts(ProviderInvite inv) {
        return inv.getAttempts() == null ? 0 : inv.getAttempts();
    }

    private static int maxAttempts(ProviderInvite inv) {
        return inv.getMaxAttempts() == null ? 5 : inv.getMaxAttempts();
    }

    // ---------- public (token + PIN) ----------

    /** What the portal shows before the PIN is entered (no provider data beyond the first name). */
    @Transactional(readOnly = true)
    public PublicLinkStatus status(String token) {
        ProviderInvite inv = findByToken(token);
        String state = switch (linkStatus(inv, LocalDateTime.now())) {
            case "submitted" -> "submitted";
            case "replaced" -> "replaced";
            case "expired" -> "expired";
            case "locked" -> "locked";
            default -> "active";
        };
        String firstName = providerRepository.findById(inv.getProviderId()).map(Provider::getFirstName).orElse(null);
        String orgName = organizationRepository.findById(inv.getOrgId()).map(Organization::getName).orElse(null);
        return new PublicLinkStatus(state, firstName, orgName, inv.getExpiresAt(),
                Math.max(0, maxAttempts(inv) - attempts(inv)), inv.getSubmittedAt(), inv.getPurpose());
    }

    @Transactional(noRollbackFor = ApiException.class)
    public PublicInviteInfo verify(String token, String pin) {
        ProviderInvite inv = checkInvite(token, pin);
        if ("sent".equals(inv.getStatus())) inv.setStatus("opened");
        if (inv.getAccessedAt() == null) inv.setAccessedAt(LocalDateTime.now());
        Provider provider = providerRepository.findById(inv.getProviderId())
                .orElseThrow(() -> new NotFoundException("This link is no longer valid"));
        String orgName = organizationRepository.findById(inv.getOrgId()).map(Organization::getName).orElse(null);
        PublicProfile profile = new PublicProfile(provider.getNpi(), provider.getCaqhId(), provider.getSuffix(),
                provider.getSpecialty(), provider.getPhone(), provider.getDateOfBirth(), provider.getLicenseNumber(),
                provider.getLicenseState(), provider.getLicenseExpires(), provider.getDeaNumber(), provider.getDeaExpires(),
                userRepository.findByProviderId(provider.getId()).isPresent(), provider.getEmail(),
                provider.getStatus(),
                provider.getClientId() == null ? null : clientRepository.findById(provider.getClientId()).map(com.zmartcredential.entity.Client::getName).orElse(null),
                provider.getPracticeId() == null ? null : practiceRepository.findById(provider.getPracticeId()).map(com.zmartcredential.entity.Practice::getName).orElse(null),
                provider.getLocationId() == null ? null : locationRepository.findById(provider.getLocationId()).map(com.zmartcredential.entity.Location::getName).orElse(null),
                extraMapper.view(provider));
        List<PublicMissingDocument> docs = missing(provider);
        if ("documents".equals(inv.getPurpose())) {
            // a document request: only the requested documents, each one needed
            java.util.Set<String> requested = requestedTypes(inv);
            docs = docs.stream().filter(d -> requested.contains(d.docType()))
                    .map(d -> new PublicMissingDocument(d.docType(), d.label(), false, d.expires(), d.status())).toList();
        }
        return new PublicInviteInfo(fullName(provider), orgName, inv.getEmail(), docs, inv.getExpiresAt(),
                provider.getFirstName(), provider.getLastName(), profile, inv.getPurpose());
    }

    /** Portal "Review & Submit": saves the provider's professional details and closes the link. */
    @Transactional(noRollbackFor = ApiException.class)
    public PublicLinkStatus submitProfile(String token, PublicProfileRequest req) {
        ProviderInvite inv = checkInvite(token, req.pin());
        if ("documents".equals(inv.getPurpose())) throw new BadRequestException("This link is for uploading documents only");
        Provider p = providerRepository.findById(inv.getProviderId())
                .orElseThrow(() -> new NotFoundException("This link is no longer valid"));
        // Only the sign-in password is required (below); the other details are optional and checked when filled in.
        String npi = blankToNull(req.npi());
        if (npi != null) providerRepository.findByOrgIdAndNpi(p.getOrgId(), npi)
                .filter(other -> !Objects.equals(other.getId(), p.getId()))
                .ifPresent(other -> {
                    throw new ConflictException("NPI " + npi + " is already registered with this organization");
                });
        if (blankToNull(req.phone()) != null && !com.zmartcredential.util.PhoneNumber.isValid(req.phone())) {
            throw BadRequestException.onField("phone", com.zmartcredential.util.PhoneNumber.MESSAGE);
        }
        if (req.licenseExpires() != null && req.licenseExpires().isBefore(java.time.LocalDate.now())) throw new BadRequestException("License Expiration can't be in the past");
        if (req.deaExpires() != null && req.deaExpires().isBefore(java.time.LocalDate.now())) throw new BadRequestException("DEA Expiration can't be in the past");
        p.setNpi(npi);
        if (blankToNull(req.firstName()) != null) p.setFirstName(req.firstName().trim());
        if (blankToNull(req.lastName()) != null) p.setLastName(req.lastName().trim());
        if (blankToNull(req.caqhId()) != null) p.setCaqhId(req.caqhId().trim());
        p.setCaqhUsername(blankToNull(req.caqhUsername()));
        if (blankToNull(req.caqhPassword()) != null) p.setCaqhPasswordEnc(cryptoService.encrypt(req.caqhPassword()));
        p.setPecosAccessGranted(req.pecosAccessGranted());
        p.setPecosUsername(Boolean.TRUE.equals(req.pecosAccessGranted()) ? blankToNull(req.pecosUsername()) : null);
        p.setSuffix(blankToNull(req.suffix()));
        p.setSpecialty(blankToNull(req.specialty()));
        p.setPhone(blankToNull(req.phone()));
        p.setDateOfBirth(req.dateOfBirth());
        p.setLicenseNumber(blankToNull(req.licenseNumber()));
        String state = blankToNull(req.licenseState());
        p.setLicenseState(state == null ? null : state.toUpperCase());
        p.setLicenseExpires(req.licenseExpires());
        String dea = blankToNull(req.deaNumber());
        p.setDeaNumber(dea == null ? null : dea.toUpperCase());
        p.setDeaExpires(req.deaExpires());
        extraMapper.apply(p, req.extra());
        if (!Boolean.TRUE.equals(req.pecosAccessGranted())) p.setPecosPasswordEnc(null);
        if ("draft".equals(p.getStatus()) || "pending".equals(p.getStatus())) p.setStatus("active");
        // the provider's sign-in: their email + the password they chose (when they have no login yet)
        if (userRepository.findByProviderId(p.getId()).isEmpty()) {
            if (req.password() == null || req.password().length() < 8) {
                throw com.zmartcredential.exception.BadRequestException.onField("password", "Choose a password of at least 8 characters");
            }
            orgUserService.createProviderLogin(p.getId(), req.password(), null, true);
        }
        inv.setStatus("submitted");
        inv.setSubmittedAt(LocalDateTime.now());
        notificationService.notifyOrg(p.getOrgId(), "Provider profile submitted",
                fullName(p) + " completed their profile through a secure link.", "UserCheck", NotificationService.SUCCESS);
        return status(token);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public PublicUploadResult publicUpload(String token, String pin, List<MultipartFile> files, List<String> docTypes,
                                           List<String> expiresAts) {
        ProviderInvite inv = checkInvite(token, pin);
        Provider provider = providerRepository.findById(inv.getProviderId())
                .orElseThrow(() -> new NotFoundException("This link is no longer valid"));
        if (files == null || files.isEmpty()) throw new BadRequestException("Choose at least one file to upload");
        if (docTypes == null || docTypes.size() < files.size()) {
            throw new BadRequestException("Choose a document type for each file");
        }
        Map<String, DocumentType> types = support.docTypes();
        for (int i = 0; i < files.size(); i++) {
            String code = blankToNull(docTypes.get(i));
            if (code == null || !types.containsKey(code)) {
                throw new BadRequestException("Choose a valid document type for " + files.get(i).getOriginalFilename());
            }
            if (files.get(i) == null || files.get(i).isEmpty()) {
                throw new BadRequestException("File " + (i + 1) + " is empty");
            }
        }
        for (int i = 0; files != null && i < files.size(); i++) {
            LocalDate given = ProviderDocumentService.parseDate(expiresAts != null && i < expiresAts.size() ? expiresAts.get(i) : null);
            if (given != null && given.isBefore(LocalDate.now())) throw new BadRequestException("Expiration dates can't be in the past");
            // documents that expire (licenses, DEA, insurance, ...) need their expiration date
            if (given == null && Boolean.TRUE.equals(types.get(docTypes.get(i).trim()).getExpires())) {
                throw new BadRequestException("Enter the expiration date of the " + types.get(docTypes.get(i).trim()).getLabel());
            }
        }
        List<PublicUploadedFile> uploaded = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            LocalDate exp = ProviderDocumentService.parseDate(
                    expiresAts != null && i < expiresAts.size() ? expiresAts.get(i) : null);
            ProviderDocument d = documentService.storeInto(provider, docTypes.get(i).trim(), files.get(i), exp,
                    false, null, null);
            uploaded.add(new PublicUploadedFile(d.getFileName(), d.getDocType(), types.get(d.getDocType()).getLabel(),
                    d.getExpiresAt()));
        }
        // the link stays open until the provider submits the profile (status "submitted")
        List<PublicMissingDocument> stillMissing = missing(provider);
        documentService.notifyUpload(provider, uploaded.size(), "Documents received via secure link");
        return new PublicUploadResult(uploaded, stillMissing);
    }

    private ProviderInvite findByToken(String token) {
        if (token == null || token.length() != 64) throw new NotFoundException("This link is not valid");
        return inviteRepository.findByToken(token)
                .orElseThrow(() -> new NotFoundException("This link is not valid"));
    }

    /** Callers must not roll back on ApiException, so failed attempts and expiry are persisted. */
    private ProviderInvite checkInvite(String token, String pin) {
        ProviderInvite inv = findByToken(token);
        if ("revoked".equals(inv.getStatus())) {
            throw new BadRequestException("This link has been replaced by a newer one. Please use the latest email.");
        }
        if ("submitted".equals(inv.getStatus())) {
            throw new BadRequestException("documents".equals(inv.getPurpose())
                    ? "These documents have already been submitted. Contact your credentialing team for changes."
                    : "This profile has already been submitted. Contact your credentialing team for changes.");
        }
        if (inv.getExpiresAt().isBefore(LocalDateTime.now())) {
            if (!"expired".equals(inv.getStatus())) inv.setStatus("expired");
            throw new BadRequestException("This link has expired. Please contact your credentialing team for a new one.");
        }
        if (attempts(inv) >= maxAttempts(inv)) {
            throw new BadRequestException("This link is locked after too many incorrect PIN attempts. Contact your credentialing team for a new one.");
        }
        if (pin == null || !java.security.MessageDigest.isEqual(pin.trim().getBytes(), inv.getPin().getBytes())) {
            inv.setAttempts(attempts(inv) + 1);
            int left = maxAttempts(inv) - attempts(inv);
            throw new BadRequestException(left > 0
                    ? "Incorrect PIN. " + left + " attempt(s) remaining."
                    : "Incorrect PIN. This link is now locked; contact your credentialing team for a new one.");
        }
        return inv;
    }

    private List<PublicMissingDocument> missing(Provider provider) {
        return support.documentRows(provider).stream()
                .filter(r -> !"approved".equals(r.status()) && !"na".equals(r.status()))
                .filter(r -> !Objects.equals(r.status(), "pending_review"))
                .map(r -> new PublicMissingDocument(r.docType(), r.label(), r.critical(), r.expires(), r.status()))
                .toList();
    }
}
