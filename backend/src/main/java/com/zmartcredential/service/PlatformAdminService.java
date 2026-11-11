package com.zmartcredential.service;

import com.zmartcredential.dto.auth.OrgSignupRequest;
import com.zmartcredential.dto.auth.PlatformDtos.AdminDetail;
import com.zmartcredential.dto.auth.PlatformDtos.AdminSummary;
import com.zmartcredential.dto.auth.PlatformDtos.AdminUpdateRequest;
import com.zmartcredential.dto.auth.PlatformDtos.PlatformSummary;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.PaymentMethod;
import com.zmartcredential.entity.Subscription;
import com.zmartcredential.entity.SubscriptionPackage;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.PaymentMethodRepository;
import com.zmartcredential.repository.RefreshTokenRepository;
import com.zmartcredential.repository.ProviderRepository;
import com.zmartcredential.repository.SubscriptionPackageRepository;
import com.zmartcredential.repository.SubscriptionRepository;
import com.zmartcredential.repository.UserRoleRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.Role;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Super admin: dashboard counts and "Create Admin". Creating an admin follows the organization sign-up workflow
 * (organization → admin account → plan → payment) and creates a new organization with its admin user, who has
 * access to every module of that organization.
 */
@Service
@RequiredArgsConstructor
public class PlatformAdminService {

    private final AuthService authService;
    private final AppUserRepository userRepository;
    private final OrganizationRepository organizationRepository;
    private final ProviderRepository providerRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionPackageRepository packageRepository;
    private final UserRoleRepository userRoleRepository;
    private final AuthContext authContext;
    private final PaymentMethodRepository paymentMethodRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final OrgNames orgNames;
    private final EmailRegistry emailRegistry;
    private final org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    @Transactional(readOnly = true)
    public PlatformSummary summary() {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        List<AdminSummary> admins = admins();
        long staff = userRepository.findAll().stream()
                .filter(u -> u.getOrgId() != null && !Role.PROVIDER.code().equals(u.getRole())).count();
        return new PlatformSummary(organizationRepository.count(), admins.size(), staff, providerRepository.count(),
                userRoleRepository.count(), admins.stream().limit(5).toList());
    }

    /** All organization admins, newest first. */
    @Transactional(readOnly = true)
    public List<AdminSummary> listAdmins() {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        return admins();
    }

    @Transactional
    public AdminSummary createAdmin(OrgSignupRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        AppUser admin = authService.createOrganizationWithAdmin(req, false);
        return admins().stream().filter(a -> a.userId().equals(admin.getId())).findFirst().orElseThrow();
    }

    /** Create Admin → Edit: the admin, their organization, plan and card on file. */
    @Transactional(readOnly = true)
    public AdminDetail adminDetail(Long userId) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        AppUser u = loadAdmin(userId);
        Organization o = organizationRepository.findById(u.getOrgId())
                .orElseThrow(() -> com.zmartcredential.exception.NotFoundException.of("Organization", u.getOrgId()));
        Subscription sub = subscriptionRepository.findByOrgId(o.getId()).orElse(null);
        PaymentMethod pm = card(o.getId());
        return new AdminDetail(u.getId(), o.getId(), o.getName(), o.getOrgType(), o.getTaxId(), o.getWebsite(), o.getAddress(),
                o.getCity(), o.getState(), o.getZip(), u.getFirstName(), u.getLastName(), u.getEmail(), u.getPhone(),
                sub == null ? null : sub.getPackageCode(), sub == null ? null : sub.getProviderCount(),
                pm == null ? null : pm.getBrand(), pm == null ? null : pm.getLast4(), pm == null ? null : pm.getExp(),
                pm == null ? null : pm.getBillingName(), pm == null ? null : pm.getBillingZip(),
                o.getStatus(), Boolean.TRUE.equals(u.getDisabled()), u.getCreatedAt());
    }

    /**
     * Create Admin → Edit: every detail of the organization, the admin's account (a changed email is also the new
     * username), the plan and the card. Same rules as creating; a blank password keeps the current one.
     */
    @Transactional
    public AdminSummary updateAdmin(Long userId, AdminUpdateRequest req) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        AppUser u = loadAdmin(userId);
        Organization o = organizationRepository.findById(u.getOrgId())
                .orElseThrow(() -> com.zmartcredential.exception.NotFoundException.of("Organization", u.getOrgId()));
        var a = req.admin();
        var pay = req.paymentMethod();
        String exp = pay.exp();
        java.time.YearMonth cardMonth = java.time.YearMonth.of(2000 + Integer.parseInt(exp.substring(3)), Integer.parseInt(exp.substring(0, 2)));
        if (cardMonth.isBefore(java.time.YearMonth.now())) {
            throw com.zmartcredential.exception.BadRequestException.onField("paymentMethod.exp", "The card has expired — enter a current expiration date");
        }
        boolean newCard = pay.last4() != null && !pay.last4().isBlank();
        PaymentMethod pm = card(o.getId());
        if (pm == null && !newCard) throw com.zmartcredential.exception.BadRequestException.onField("paymentMethod.last4", "Enter the card number");
        SubscriptionPackage pkg = packageRepository.findById(req.plan().packageId())
                .filter(p -> Boolean.TRUE.equals(p.getActive()))
                .orElseThrow(() -> com.zmartcredential.exception.BadRequestException.onField("plan.packageId", "Unknown plan"));
        if (pkg.getProviderCap() != null && req.plan().estimatedProviders() > pkg.getProviderCap()) {
            throw com.zmartcredential.exception.BadRequestException.onField("plan.packageId", "The " + pkg.getName()
                    + " plan supports up to " + pkg.getProviderCap() + " providers. Choose a larger plan.");
        }
        // the admin's email is their username: it must be free (their own address is fine)
        String email = a.email().trim().toLowerCase(java.util.Locale.ROOT);
        boolean emailChanged = !email.equalsIgnoreCase(u.getEmail());
        if (emailChanged) {
            if (userRepository.existsByUsername(email) && !email.equalsIgnoreCase(u.getUsername())) {
                throw com.zmartcredential.exception.ConflictException.onField("admin.email", "An account with this email already exists");
            }
            emailRegistry.requireFreeForUser(email, u.getId(), null, o.getId());
        }
        orgNames.requireFree(req.org().name(), o.getId(), "org.name");

        var org = req.org();
        String oldEmail = o.getEmail();
        String oldPhone = o.getPhone();
        o.setName(org.name().trim());
        o.setOrgType(org.type());
        o.setTaxId(org.taxId());
        o.setWebsite(org.website());
        o.setAddress(org.address());
        o.setCity(org.city());
        o.setState(org.state());
        o.setZip(org.zip());
        // the organization's contact email / phone came from the admin: kept in step unless set differently
        if (oldEmail == null || oldEmail.equalsIgnoreCase(u.getEmail())) o.setEmail(email);
        if (oldPhone == null || oldPhone.equals(u.getPhone())) o.setPhone(a.phone());
        organizationRepository.save(o);

        u.setFirstName(a.firstName().trim());
        u.setLastName(a.lastName().trim());
        u.setDisplayName(u.getFirstName() + " " + u.getLastName());
        u.setPhone(a.phone());
        if (emailChanged) {
            u.setEmail(email);
            u.setUsername(email);
        }
        boolean newPassword = a.password() != null && !a.password().isBlank();
        if (newPassword) u.setPasswordHash(passwordEncoder.encode(a.password()));
        userRepository.save(u);
        // a new sign-in (email or password): the admin's other sessions end
        if (newPassword || emailChanged) refreshTokenRepository.revokeAllForUser(u.getId(), java.time.LocalDateTime.now());

        Subscription sub = subscriptionRepository.findByOrgId(o.getId()).orElseGet(() -> {
            Subscription x = new Subscription();
            x.setOrgId(o.getId());
            x.setStatus("active");
            x.setStartedAt(java.time.LocalDateTime.now());
            x.setNextRenewalDate(java.time.LocalDate.now().plusDays(30));
            return x;
        });
        sub.setPackageCode(pkg.getCode());
        sub.setProviderCount(req.plan().estimatedProviders());
        subscriptionRepository.save(sub);

        if (pm == null) {
            pm = new PaymentMethod();
            pm.setOrgId(o.getId());
            pm.setDefaultMethod(true);
        }
        if (newCard) {
            pm.setBrand(pay.brand() == null || pay.brand().isBlank() ? "Card" : pay.brand());
            pm.setLast4(pay.last4());
        }
        pm.setExp(exp);
        pm.setBillingName(pay.billingName().trim());
        pm.setBillingZip(pay.billingZip());
        paymentMethodRepository.save(pm);

        return admins().stream().filter(x -> x.userId().equals(u.getId())).findFirst().orElseThrow();
    }

    private AppUser loadAdmin(Long userId) {
        return userRepository.findById(userId)
                .filter(u -> u.getOrgId() != null && Boolean.TRUE.equals(u.getOrgOwner()))
                .orElseThrow(() -> new com.zmartcredential.exception.NotFoundException("Admin not found"));
    }

    /** The organization's card on file (the default one, else the first). */
    private PaymentMethod card(Long orgId) {
        List<PaymentMethod> cards = paymentMethodRepository.findByOrgIdOrderByCreatedAtAsc(orgId);
        return cards.stream().filter(c -> Boolean.TRUE.equals(c.getDefaultMethod())).findFirst()
                .orElse(cards.isEmpty() ? null : cards.get(0));
    }

    private List<AdminSummary> admins() {
        Map<Long, Organization> orgs = organizationRepository.findAll().stream()
                .collect(Collectors.toMap(Organization::getId, Function.identity()));
        Map<Long, Long> providers = counts(providerRepository.countGroupedByOrg());
        Map<Long, Long> users = counts(userRepository.countGroupedByOrg());
        Map<Long, Subscription> subs = subscriptionRepository.findAll().stream()
                .collect(Collectors.toMap(Subscription::getOrgId, Function.identity(), (a, b) -> a));
        Map<String, String> plans = packageRepository.findAll().stream()
                .collect(Collectors.toMap(SubscriptionPackage::getCode, SubscriptionPackage::getName));
        return userRepository.findAll().stream()
                // only each organization's own admin (created through Create Admin / sign-up)
                .filter(u -> u.getOrgId() != null && Boolean.TRUE.equals(u.getOrgOwner()))
                .sorted(Comparator.comparing(AppUser::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(u -> {
                    Organization o = orgs.get(u.getOrgId());
                    Subscription s = subs.get(u.getOrgId());
                    return new AdminSummary(u.getId(), u.getDisplayName(), u.getEmail(), u.getPhone(), u.getOrgId(),
                            o == null ? null : o.getName(), o == null ? null : o.getStatus(),
                            s == null ? null : plans.get(s.getPackageCode()),
                            providers.getOrDefault(u.getOrgId(), 0L), users.getOrDefault(u.getOrgId(), 0L),
                            Boolean.TRUE.equals(u.getDisabled()), u.getCreatedAt());
                })
                .toList();
    }

    private static Map<Long, Long> counts(List<Object[]> rows) {
        Map<Long, Long> out = new HashMap<>();
        for (Object[] r : rows) out.put((Long) r[0], (Long) r[1]);
        return out;
    }
}
