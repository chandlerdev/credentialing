package com.zmartcredential.service;

import com.zmartcredential.entity.Organization;
import com.zmartcredential.entity.Provider;
import com.zmartcredential.repository.OrganizationRepository;
import com.zmartcredential.repository.ProviderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/** Emails a new provider their sign-in: the sign-in page, their username and their password. Never throws. */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProviderWelcomeMailer {

    private final ProviderRepository providerRepository;
    private final OrganizationRepository organizationRepository;
    private final MailService mailService;
    private final MailTemplateService mailTemplateService;

    /** password: shown in the email; null when the provider chose it themselves (secure link). */
    public void send(Long providerId, String username, String password) {
        try {
            Provider p = providerRepository.findById(providerId).orElse(null);
            if (p == null || p.getEmail() == null || p.getEmail().isBlank()) return;
            String org = organizationRepository.findById(p.getOrgId()).map(Organization::getName).orElse("your credentialing team");
            String first = p.getFirstName() == null || p.getFirstName().isBlank() ? "there" : p.getFirstName();
            String signIn = mailService.publicUrl() + "/admin/signin";
            String subject = org + ": your provider portal sign-in";
            String body = "Hi " + first + ",\n\n"
                    + "You have been added as a provider with " + org + ". Sign in to the provider portal to follow your "
                    + "credentialing, upload documents and keep your profile up to date.\n\n"
                    + "Sign-in page: " + signIn + "\n"
                    + "Username: " + username + "\n"
                    + (password != null
                        ? "Password: " + password + "\n\nFor your security, please change your password after you sign in "
                          + "(the key icon next to Sign out).\n"
                        : "Password: the password you chose when you completed your profile.\n")
                    + "\nThank you,\n" + org;
            MailService.Result r = mailService.send(p.getOrgId(), p.getEmail(), subject, body);
            mailTemplateService.log(p.getOrgId(), p.getId(), p.getEmail(), subject, r.status());
        } catch (Exception e) {
            log.warn("Sign-in email for provider {} failed: {}", providerId, e.getMessage());
        }
    }
}
